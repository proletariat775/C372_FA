const db = require('../db');
const refundRequestModel = require('../models/refundRequest');
const refundRequestItemModel = require('../models/refundRequestItem');
const refundModel = require('../models/refund');
const Order = require('../models/order');
const Product = require('../models/product');
const paypalRefund = require('../services/paypalRefund');
const stripeService = require('../services/stripe');
const loyaltyService = require('../services/loyaltyService');

const renderView = (res, name, data = {}) => res.render(name, { ...data, user: res.locals.user || res.req.session.user });

const getRemainingAmount = (order) => {
    const total = Number(order.total_amount || order.total || 0);
    const refunded = Number(order.refunded_amount || order.refundedAmount || 0);
    return Number(Math.max(0, total - refunded).toFixed(2));
};

const restockRequestItems = (requestId, callback) => {
    refundRequestItemModel.getByRequestId(requestId, (err, items = []) => {
        if (err) {
            return callback(err);
        }
        if (!items.length) {
            return callback(null);
        }

        let pending = items.length;
        let failed = false;

        items.forEach((item) => {
            const productId = item.productId;
            const variantId = item.variantId;
            const quantity = Number(item.quantity);
            if (!Number.isFinite(productId) || !Number.isFinite(variantId) || !Number.isFinite(quantity) || quantity <= 0) {
                pending -= 1;
                if (!pending && !failed) {
                    callback(null);
                }
                return;
            }

            Product.increaseVariantQuantity(variantId, productId, quantity, (updateErr) => {
                if (failed) {
                    return;
                }
                if (updateErr) {
                    failed = true;
                    return callback(updateErr);
                }
                pending -= 1;
                if (!pending) {
                    callback(null);
                }
            });
        });
    });
};

const completeRefundTransaction = (request, approvedAmount, adminReason, refundRecord, callback) => {
    const previousRefunded = Number(request && (request.refundedAmount || request.refunded_amount) ? (request.refundedAmount || request.refunded_amount) : 0);
    const total = Number(request && request.total ? request.total : 0);
    const safeApproved = Number(approvedAmount || 0);
    const newRefunded = Number((Math.max(0, previousRefunded) + Math.max(0, safeApproved)).toFixed(2));
    const fullRefund = total > 0 && newRefunded >= total - 0.01;

    db.beginTransaction((txErr) => {
        if (txErr) {
            return callback(txErr);
        }

        refundModel.create(request.orderId, request.id, refundRecord, (createErr) => {
            if (createErr) {
                return db.rollback(() => callback(createErr));
            }

            refundRequestModel.updateRequest(request.id, 'completed', adminReason, safeApproved, (updateErr) => {
                if (updateErr) {
                    return db.rollback(() => callback(updateErr));
                }

                Order.updateRefundTotals(request.orderId, newRefunded, fullRefund, (statusErr) => {
                    if (statusErr) {
                        return db.rollback(() => callback(statusErr));
                    }

                    return db.commit((commitErr) => {
                        if (commitErr) {
                            return db.rollback(() => callback(commitErr));
                        }
                        return callback(null, { fullRefund, newRefunded });
                    });
                });
            });
        });
    });
};

const finalizeRefund = (req, res, requestId, restockItems, successMessage) => {
    if (!restockItems) {
        req.flash('success', successMessage);
        return res.redirect(`/admin/refunds/${requestId}`);
    }

    restockRequestItems(requestId, (restockErr) => {
        if (restockErr) {
            console.error('Error restocking items:', restockErr);
            req.flash('error', 'Refund processed, but restocking failed.');
            return res.redirect(`/admin/refunds/${requestId}`);
        }

        req.flash('success', `${successMessage} Stock has been returned.`);
        return res.redirect(`/admin/refunds/${requestId}`);
    });
};

// EcoPoints: reverse earned points proportional to refunded value; redeemed points are returned only on full refunds.
const applyRefundLoyaltyClawback = async ({ req, request, requestId, amount }) => {
    const previousRefunded = Number(request && (request.refundedAmount || request.refunded_amount) ? (request.refundedAmount || request.refunded_amount) : 0);
    const safeAmount = Number(amount || 0);
    const cumulativeRefunded = Number((Math.max(0, previousRefunded) + Math.max(0, safeAmount)).toFixed(2));

    try {
        const result = await loyaltyService.clawbackPointsForRefund({
            userId: request.userId,
            orderId: request.orderId,
            cumulativeRefundedAmount: cumulativeRefunded,
            orderTotalAmount: Number(request.total || 0),
            refundReference: `request #${requestId}`
        });
        return {
            ok: true,
            result
        };
    } catch (error) {
        console.error('Error reversing EcoPoints for refund:', error);
        req.flash('error', 'Refund completed, but EcoPoints reversal could not be applied.');
        return {
            ok: false,
            error
        };
    }
};

module.exports = {
    list(req, res) {
        refundRequestModel.getAll((err, requests = []) => {
            if (err) {
                console.error('Error loading refund requests:', err);
                req.flash('error', 'Unable to load refund requests.');
                return res.redirect('/admin/deliveries');
            }

            return renderView(res, 'adminRefunds', {
                requests,
                messages: req.flash('success'),
                errors: req.flash('error')
            });
        });
    },

    details(req, res) {
        const requestId = Number(req.params.id);
        if (!Number.isFinite(requestId)) {
            return res.redirect('/admin/refunds');
        }

        refundRequestModel.getById(requestId, (err, request) => {
            if (err) {
                console.error('Error loading refund request:', err);
                req.flash('error', 'Unable to load refund request.');
                return res.redirect('/admin/refunds');
            }
            if (!request) {
                return res.redirect('/admin/refunds');
            }

            refundModel.getByRequestId(requestId, (refundErr, refunds = []) => {
                if (refundErr) {
                    console.error('Error loading refunds:', refundErr);
                    req.flash('error', 'Unable to load refund request.');
                    return res.redirect('/admin/refunds');
                }

                const latestRefund = refunds && refunds.length ? refunds[0] : null;
                const requestStatus = String(request.status || '').toLowerCase();
                const refundStatus = latestRefund ? String(latestRefund.status || '').toLowerCase() : '';
                const shouldMarkCompleted = latestRefund && refundStatus === 'completed' && requestStatus !== 'completed';

                const renderDetails = () => refundRequestItemModel.getByRequestId(requestId, (itemsErr, items = []) => {
                    if (itemsErr) {
                        console.error('Error loading refund items:', itemsErr);
                        req.flash('error', 'Unable to load refund request.');
                        return res.redirect('/admin/refunds');
                    }

                    return renderView(res, 'adminRefundDetails', {
                        request,
                        refunds,
                        items,
                        remaining: getRemainingAmount(request),
                        messages: req.flash('success'),
                        errors: req.flash('error')
                    });
                });

                if (!shouldMarkCompleted) {
                    return renderDetails();
                }

                refundRequestModel.updateRequest(requestId, 'completed', null, request.approvedAmount || null, (statusErr) => {
                    if (statusErr) {
                        console.error('Error reconciling refund status:', statusErr);
                    } else {
                        request.status = 'completed';
                        request.adminNote = null;
                    }
                    return renderDetails();
                });
            });
        });
    },

    async approve(req, res) {
        const requestId = Number(req.params.id);
        const adminReason = req.body.adminNote ? String(req.body.adminNote).trim() : null;
        const overrideAmount = req.body.amount;
        const restockItems = String(req.body.restock || '') === 'on';

        if (!Number.isFinite(requestId)) {
            return res.redirect('/admin/refunds');
        }

        refundRequestModel.getById(requestId, async (err, request) => {
            if (err) {
                console.error('Error loading refund request:', err);
                req.flash('error', 'Unable to process refund request.');
                return res.redirect('/admin/refunds');
            }
            if (!request) {
                return res.redirect('/admin/refunds');
            }

            const currentStatus = String(request.status || '').toLowerCase();
            if (currentStatus !== 'pending') {
                req.flash('error', 'Refund request is no longer pending.');
                return res.redirect(`/admin/refunds/${requestId}`);
            }

            const remaining = getRemainingAmount(request);
            const requestedAmount = Number(request.requestedAmount || 0);
            const amount = Number(overrideAmount || requestedAmount || 0);
            if (!Number.isFinite(amount) || amount <= 0) {
                req.flash('error', 'Invalid refund amount.');
                return res.redirect(`/admin/refunds/${requestId}`);
            }
            if (amount > remaining) {
                req.flash('error', 'Refund amount exceeds remaining balance.');
                return res.redirect(`/admin/refunds/${requestId}`);
            }
            if (Number.isFinite(requestedAmount) && requestedAmount > 0 && amount > requestedAmount) {
                req.flash('error', 'Refund amount cannot exceed requested amount.');
                return res.redirect(`/admin/refunds/${requestId}`);
            }

            const paymentMethod = String(request.paymentMethod || request.payment_method || '').toLowerCase();
            const captureId = request.paypalCaptureId || null;
            const stripeIntentId = request.stripePaymentIntentId || null;

            const markFailed = (reason) => {
                const safeReason = reason || 'Refund failed.';
                refundRequestModel.updateRequest(requestId, 'failed', safeReason, amount, () => {
                    req.flash('error', safeReason);
                    return res.redirect(`/admin/refunds/${requestId}`);
                });
            };

            refundRequestModel.updateRequest(requestId, 'processing', adminReason, amount, async (processingErr) => {
                if (processingErr) {
                    console.error('Error updating refund request status:', processingErr);
                    req.flash('error', 'Unable to process refund request.');
                    return res.redirect(`/admin/refunds/${requestId}`);
                }

                const handleSuccess = (refundRecord) => {
                    completeRefundTransaction(request, amount, adminReason, refundRecord, (persistErr, result = {}) => {
                        if (persistErr) {
                            console.error('Error saving refund record:', persistErr);
                            return markFailed('Refund processed but failed to save record.');
                        }

                        return applyRefundLoyaltyClawback({
                            req,
                            request,
                            requestId,
                            amount
                        }).then(async (clawback) => {
                            const clawedPoints = Number(clawback && clawback.result ? clawback.result.clawedBackPoints : 0);
                            const fullRefund = Boolean(result.fullRefund);

                            if (fullRefund && Number(request.loyaltyPointsRedeemed || 0) > 0) {
                                try {
                                    await loyaltyService.returnRedeemedPointsForOrder({
                                        userId: request.userId,
                                        orderId: request.orderId,
                                        pointsToReturn: Number(request.loyaltyPointsRedeemed || 0),
                                        reference: `request #${requestId}`
                                    });
                                } catch (returnErr) {
                                    console.error('Error returning redeemed EcoPoints:', returnErr);
                                }
                            }

                            const successMessage = clawedPoints > 0
                                ? `Refund processed. Reversed ${clawedPoints} EcoPoints.`
                                : 'Refund processed.';

                            return finalizeRefund(
                                req,
                                res,
                                requestId,
                                restockItems,
                                successMessage
                            );
                        });
                    });
                };

                if (paymentMethod === 'paypal' && captureId) {
                    try {
                        const result = await paypalRefund.refundCapture(captureId, amount, 'USD');
                        if (result.status >= 200 && result.status < 300) {
                            const refundData = result.data || {};
                            const createdAt = refundData.create_time
                                ? new Date(refundData.create_time)
                                : new Date();

                            return handleSuccess({
                                amount,
                                currency: 'USD',
                                status: (refundData.status || 'COMPLETED').toLowerCase(),
                                paypalRefundId: refundData.id,
                                paypalCaptureId: captureId,
                                createdAt
                            });
                        }

                        const errorMsg = result.data && result.data.message
                            ? result.data.message
                            : 'PayPal refund failed.';
                        return markFailed(errorMsg);
                    } catch (error) {
                        console.error('PayPal refund error:', error);
                        return markFailed('PayPal refund failed.');
                    }
                }

                if (paymentMethod === 'stripe' && stripeIntentId) {
                    try {
                        const stripeRefund = await stripeService.refundPayment(stripeIntentId, amount);
                        return handleSuccess({
                            amount,
                            currency: String(stripeRefund.currency || 'USD').toUpperCase(),
                            status: String(stripeRefund.status || 'completed').toLowerCase(),
                            paypalRefundId: stripeRefund.id || null,
                            paypalCaptureId: stripeIntentId,
                            createdAt: stripeRefund.created ? new Date(stripeRefund.created * 1000) : new Date()
                        });
                    } catch (stripeErr) {
                        console.error('Stripe refund error:', stripeErr);
                        return markFailed('Stripe refund failed.');
                    }
                }

                return handleSuccess({
                    amount,
                    currency: 'USD',
                    status: 'completed',
                    paypalRefundId: null,
                    paypalCaptureId: captureId || stripeIntentId || null,
                    createdAt: new Date()
                });
            });
        });
    },

    reject(req, res) {
        const requestId = Number(req.params.id);
        const adminReason = req.body.adminNote ? String(req.body.adminNote).trim() : '';

        if (!Number.isFinite(requestId)) {
            return res.redirect('/admin/refunds');
        }
        if (!adminReason) {
            req.flash('error', 'Rejection reason is required.');
            return res.redirect(`/admin/refunds/${requestId}`);
        }

        refundRequestModel.updateRequest(requestId, 'rejected', adminReason, null, (err) => {
            if (err) {
                console.error('Error rejecting refund request:', err);
                req.flash('error', 'Unable to reject refund request.');
                return res.redirect(`/admin/refunds/${requestId}`);
            }

            req.flash('success', 'Refund request rejected.');
            return res.redirect(`/admin/refunds/${requestId}`);
        });
    }
};
