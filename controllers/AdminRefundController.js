const refundRequestModel = require('../models/refundRequest');
const refundRequestItemModel = require('../models/refundRequestItem');
const refundModel = require('../models/refund');
const Order = require('../models/order');
const Product = require('../models/product');
const paypalRefund = require('../services/paypalRefund');

const renderView = (res, name, data = {}) => res.render(name, { ...data, user: res.locals.user || res.req.session.user });

const getRemainingAmount = (order) => {
    const total = Number(order.total_amount || order.total || 0);
    const refunded = Number(order.refunded_amount || 0);
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

const finalizeRefund = (req, res, requestId, adminNote, restockItems, successMessage) => {
    refundRequestModel.updateStatus(requestId, 'COMPLETED', adminNote, () => {
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
    });
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
                const requestStatus = String(request.status || '').toUpperCase();
                const refundStatus = latestRefund ? String(latestRefund.status || '').toUpperCase() : '';
                const shouldMarkCompleted = latestRefund && refundStatus === 'COMPLETED' && requestStatus !== 'COMPLETED';

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

                refundRequestModel.updateStatus(requestId, 'COMPLETED', null, (statusErr) => {
                    if (statusErr) {
                        console.error('Error reconciling refund status:', statusErr);
                    } else {
                        request.status = 'COMPLETED';
                        request.adminNote = null;
                    }
                    return renderDetails();
                });
            });
        });
    },

    async approve(req, res) {
        const requestId = Number(req.params.id);
        const adminNote = req.body.adminNote;
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

            if (request.status !== 'PENDING') {
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

            const paymentMethod = String(request.paymentMethod || '').toLowerCase();
            const captureId = request.paypalCaptureId || null;

            if (paymentMethod === 'paypal' && captureId) {
                try {
                    const result = await paypalRefund.refundCapture(captureId, amount, 'USD');
                    if (result.status >= 200 && result.status < 300) {
                        const refundData = result.data || {};
                        const createdAt = refundData.create_time
                            ? new Date(refundData.create_time)
                            : new Date();

                        refundModel.create(request.orderId, requestId, {
                            amount,
                            currency: 'USD',
                            status: refundData.status || 'COMPLETED',
                            paypalRefundId: refundData.id,
                            paypalCaptureId: captureId,
                            createdAt
                        }, (createErr) => {
                            if (createErr) {
                                console.error('Error saving refund record:', createErr);
                                req.flash('error', 'Refund processed but failed to save record.');
                                return res.redirect(`/admin/refunds/${requestId}`);
                            }

                            Order.addRefundedAmount(request.orderId, amount, (amountErr) => {
                                if (amountErr) {
                                    console.error('Error updating refunded amount:', amountErr);
                                    req.flash('error', 'Refund processed but failed to update order.');
                                    return res.redirect(`/admin/refunds/${requestId}`);
                                }

                                return finalizeRefund(
                                    req,
                                    res,
                                    requestId,
                                    adminNote,
                                    restockItems,
                                    'Refund processed through PayPal.'
                                );
                            });
                        });
                        return;
                    }

                    const errorMsg = result.data && result.data.message
                        ? result.data.message
                        : 'PayPal refund failed.';
                    refundRequestModel.updateStatus(requestId, 'FAILED', errorMsg, () => {
                        req.flash('error', errorMsg);
                        return res.redirect(`/admin/refunds/${requestId}`);
                    });
                } catch (error) {
                    console.error('PayPal refund error:', error);
                    refundRequestModel.updateStatus(requestId, 'FAILED', 'PayPal refund failed.', () => {
                        req.flash('error', 'PayPal refund failed.');
                        return res.redirect(`/admin/refunds/${requestId}`);
                    });
                }
                return;
            }

            refundModel.create(request.orderId, requestId, {
                amount,
                currency: 'USD',
                status: 'MANUAL',
                paypalRefundId: null,
                paypalCaptureId: null,
                createdAt: new Date()
            }, (createErr) => {
                if (createErr) {
                    console.error('Error saving refund record:', createErr);
                    req.flash('error', 'Unable to record manual refund.');
                    return res.redirect(`/admin/refunds/${requestId}`);
                }

                Order.addRefundedAmount(request.orderId, amount, (amountErr) => {
                    if (amountErr) {
                        console.error('Error updating refunded amount:', amountErr);
                        req.flash('error', 'Manual refund recorded but failed to update order.');
                        return res.redirect(`/admin/refunds/${requestId}`);
                    }

                    return finalizeRefund(
                        req,
                        res,
                        requestId,
                        adminNote,
                        restockItems,
                        'Refund marked as completed.'
                    );
                });
            });
        });
    },

    reject(req, res) {
        const requestId = Number(req.params.id);
        const adminNote = req.body.adminNote;

        if (!Number.isFinite(requestId)) {
            return res.redirect('/admin/refunds');
        }

        refundRequestModel.updateStatus(requestId, 'REJECTED', adminNote, (err) => {
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
