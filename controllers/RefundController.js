const db = require('../db');
const Order = require('../models/order');
const refundRequestModel = require('../models/refundRequest');
const refundRequestItemModel = require('../models/refundRequestItem');
const refundModel = require('../models/refund');

const REFUND_WINDOW_DAYS = 14;
const ELIGIBLE_ORDER_STATUSES = new Set(['delivered', 'completed']);

const renderView = (res, name, data = {}) => res.render(name, { ...data, user: res.locals.user || res.req.session.user });

const getRemainingAmount = (order) => {
    const total = Number(order.total_amount || order.total || 0);
    const refunded = Number(order.refunded_amount || 0);
    return Number(Math.max(0, total - refunded).toFixed(2));
};

const buildItemMap = (items = []) => {
    return items.reduce((acc, item) => {
        acc[item.id] = item;
        return acc;
    }, {});
};

const buildRefundEligibility = (order) => {
    const paymentStatus = String(order.payment_status || '').toLowerCase();
    const orderStatus = String(order.status || '').toLowerCase();
    const paid = paymentStatus === 'paid';
    const statusEligible = ELIGIBLE_ORDER_STATUSES.has(orderStatus);
    let withinWindow = true;
    let daysSince = null;

    const createdAt = order && order.created_at ? new Date(order.created_at) : null;
    if (createdAt && !Number.isNaN(createdAt.getTime())) {
        const diffMs = Date.now() - createdAt.getTime();
        daysSince = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        withinWindow = diffMs <= (REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    }

    const eligible = paid && statusEligible && withinWindow;
    return {
        eligible,
        paid,
        statusEligible,
        withinWindow,
        daysSince
    };
};

// Prorate order-level discounts across items so refunds return only the amount actually paid.
const buildRefundPricing = (order, orderItems = []) => {
    const discountAmount = Math.max(0, Number(order.discount_amount || 0));
    const deliveryFee = Math.max(0, Number(order.shipping_amount || order.delivery_fee || 0));
    const lineTotals = orderItems.map((item) => {
        const qty = Number(item.quantity || 0);
        const unit = Number(item.price || item.unit_price || 0);
        return Math.max(0, unit * qty);
    });
    const subtotal = lineTotals.reduce((sum, value) => sum + value, 0);
    const discountPool = subtotal > 0 ? Math.min(discountAmount, subtotal) : 0;

    const pricingByItem = {};
    orderItems.forEach((item, index) => {
        const lineTotal = lineTotals[index] || 0;
        const qty = Number(item.quantity || 0) || 0;
        const share = subtotal > 0 ? (lineTotal / subtotal) : 0;
        const lineDiscount = Number((discountPool * share).toFixed(2));
        const netLineTotal = Math.max(0, lineTotal - lineDiscount);
        const netUnitPrice = qty > 0 ? Number((netLineTotal / qty).toFixed(2)) : 0;
        pricingByItem[item.id] = {
            netUnitPrice,
            lineDiscount
        };
    });

    return {
        pricingByItem,
        discountAmount: discountPool,
        deliveryFee
    };
};

const extractItemsPayload = (body = {}) => {
    if (body.items && typeof body.items === 'object') {
        return body.items;
    }

    const items = {};
    Object.keys(body || {}).forEach((key) => {
        const match = /^items\[(\d+)\]$/.exec(key);
        if (!match) {
            return;
        }
        items[match[1]] = body[key];
    });
    return items;
};

module.exports = {
    list(req, res) {
        const userId = req.session.user.id;
        refundRequestModel.getByUser(userId, (err, requests = []) => {
            if (err) {
                console.error('Error loading refund requests:', err);
                req.flash('error', 'Unable to load refunds right now.');
                return res.redirect('/orders/history');
            }

            return renderView(res, 'refunds', {
                requests,
                messages: req.flash('success'),
                errors: req.flash('error')
            });
        });
    },

    showRequestForm(req, res) {
        const userId = req.session.user.id;
        const orderId = Number(req.params.orderId);
        if (!Number.isFinite(orderId)) {
            req.flash('error', 'Invalid order selected.');
            return res.redirect('/orders/history');
        }

        Order.findByIdForUser(orderId, userId, (err, order) => {
            if (err) {
                console.error('Error loading order for refund:', err);
                req.flash('error', 'Unable to load refund request.');
                return res.redirect('/orders/history');
            }
            if (!order) {
                req.flash('error', 'Order not found.');
                return res.redirect('/orders/history');
            }

            refundRequestModel.getOpenByOrder(orderId, userId, (pendingErr, pending) => {
                if (pendingErr) {
                    console.error('Error checking pending refunds:', pendingErr);
                    req.flash('error', 'Unable to load refund request.');
                    return res.redirect('/orders/history');
                }

                if (pending) {
                    req.flash('error', 'You already have a pending refund request for this order.');
                    return res.redirect('/refunds');
                }

                const remaining = getRemainingAmount(order);
                const eligibility = buildRefundEligibility(order);

                if (remaining <= 0) {
                    eligibility.eligible = false;
                    eligibility.reason = 'No refundable balance remaining.';
                }

                Order.findItemsByOrderIds([orderId], (itemsErr, orderItems = []) => {
                    if (itemsErr) {
                        console.error('Error loading order items for refund:', itemsErr);
                        req.flash('error', 'Unable to load refund request.');
                        return res.redirect('/orders/history');
                    }

                    refundRequestItemModel.getRefundedQuantitiesByOrder(orderId, (qtyErr, qtyRows = []) => {
                        if (qtyErr) {
                            console.error('Error loading refunded quantities:', qtyErr);
                        }

                        const refundedQtyByItem = (qtyRows || []).reduce((acc, row) => {
                            acc[row.orderItemId] = Number(row.refundedQty || 0);
                            return acc;
                        }, {});

                        const pricing = buildRefundPricing(order, orderItems);
                        const enhancedItems = (orderItems || []).map((item) => {
                            const purchasedQty = Number(item.quantity || 0);
                            const refundedQty = Number(refundedQtyByItem[item.id] || 0);
                            const refundableQty = Math.max(0, purchasedQty - refundedQty);
                            const priceMeta = pricing.pricingByItem[item.id] || {};
                            return {
                                ...item,
                                refundableQty,
                                refundableUnitPrice: Number(priceMeta.netUnitPrice || 0)
                            };
                        });

                        return renderView(res, 'refundRequest', {
                            order,
                            remaining,
                            eligibility,
                            refundWindowDays: REFUND_WINDOW_DAYS,
                            orderItems: enhancedItems,
                            messages: req.flash('success'),
                            errors: req.flash('error')
                        });
                    });
                });
            });
        });
    },

    submitRequest(req, res) {
        const userId = req.session.user.id;
        const orderId = Number(req.params.orderId);
        const reason = req.body.reason ? String(req.body.reason).trim() : '';
        const selectedItemsRaw = extractItemsPayload(req.body || {});

        if (!Number.isFinite(orderId)) {
            req.flash('error', 'Invalid order selected.');
            return res.redirect('/orders/history');
        }
        if (!reason) {
            req.flash('error', 'Please provide a reason for your refund request.');
            return res.redirect(`/refunds/request/${orderId}`);
        }

        Order.findByIdForUser(orderId, userId, (err, order) => {
            if (err) {
                console.error('Error loading order for refund:', err);
                req.flash('error', 'Unable to submit refund request.');
                return res.redirect('/orders/history');
            }
            if (!order) {
                req.flash('error', 'Order not found.');
                return res.redirect('/orders/history');
            }

            const remaining = getRemainingAmount(order);
            const eligibility = buildRefundEligibility(order);
            if (!eligibility.eligible) {
                req.flash('error', 'This order is not eligible for a refund.');
                return res.redirect('/orders/history');
            }
            if (remaining <= 0) {
                req.flash('error', 'No refundable balance remaining.');
                return res.redirect('/orders/history');
            }

            Order.findItemsByOrderIds([orderId], (itemsErr, orderItems = []) => {
                if (itemsErr) {
                    console.error('Error loading order items for refund:', itemsErr);
                    req.flash('error', 'Unable to submit refund request.');
                    return res.redirect(`/refunds/request/${orderId}`);
                }

                refundRequestItemModel.getRefundedQuantitiesByOrder(orderId, (qtyErr, qtyRows = []) => {
                    if (qtyErr) {
                        console.error('Error loading refunded quantities:', qtyErr);
                        req.flash('error', 'Unable to submit refund request.');
                        return res.redirect(`/refunds/request/${orderId}`);
                    }

                    refundRequestModel.getOpenByOrder(orderId, userId, (pendingErr, pending) => {
                        if (pendingErr) {
                            console.error('Error checking pending refunds:', pendingErr);
                            req.flash('error', 'Unable to submit refund request.');
                            return res.redirect(`/refunds/request/${orderId}`);
                        }

                        if (pending) {
                            req.flash('error', 'You already have a pending refund request for this order.');
                            return res.redirect('/refunds');
                        }

                        const refundedQtyByItem = (qtyRows || []).reduce((acc, row) => {
                            acc[row.orderItemId] = Number(row.refundedQty || 0);
                            return acc;
                        }, {});

                        const pricing = buildRefundPricing(order, orderItems);
                        const itemMap = buildItemMap(orderItems);
                        const selections = [];
                        const selectedQtyByItem = {};

                        Object.keys(selectedItemsRaw || {}).forEach((key) => {
                            const orderItemId = Number(key);
                            const requestedQty = Number(selectedItemsRaw[key]);
                            const item = itemMap[orderItemId];
                            if (!item || !Number.isFinite(requestedQty) || requestedQty <= 0) {
                                return;
                            }

                            const purchasedQty = Number(item.quantity || 0);
                            const refundedQty = Number(refundedQtyByItem[orderItemId] || 0);
                            const remainingQty = Math.max(0, purchasedQty - refundedQty);
                            if (remainingQty <= 0) {
                                return;
                            }

                            const finalQty = Math.min(requestedQty, remainingQty);
                            if (finalQty <= 0) {
                                return;
                            }

                            const priceMeta = pricing.pricingByItem[orderItemId] || {};
                            const netUnitPrice = Number(priceMeta.netUnitPrice || 0);
                            const lineRefund = Number((netUnitPrice * finalQty).toFixed(2));

                            selections.push({
                                orderItemId,
                                productId: item.product_id,
                                variantId: item.product_variant_id,
                                quantity: finalQty,
                                unitPrice: netUnitPrice,
                                lineRefundAmount: lineRefund
                            });
                            selectedQtyByItem[orderItemId] = finalQty;
                        });

                        if (!selections.length) {
                            req.flash('error', 'Select at least one item to refund.');
                            return res.redirect(`/refunds/request/${orderId}`);
                        }

                        const allRemainingSelected = (orderItems || []).every((item) => {
                            const purchasedQty = Number(item.quantity || 0);
                            const refundedQty = Number(refundedQtyByItem[item.id] || 0);
                            const remainingQty = Math.max(0, purchasedQty - refundedQty);
                            if (remainingQty <= 0) {
                                return true;
                            }
                            return Number(selectedQtyByItem[item.id] || 0) === remainingQty;
                        });

                        let requestedAmount = selections.reduce((sum, item) => sum + Number(item.lineRefundAmount || 0), 0);
                        // Delivery fee is refunded only when all remaining items are being returned.
                        if (allRemainingSelected) {
                            const deliveryFee = Number(order.shipping_amount || order.delivery_fee || 0);
                            if (Number.isFinite(deliveryFee) && deliveryFee > 0) {
                                requestedAmount += deliveryFee;
                            }
                        }

                        requestedAmount = Number(requestedAmount.toFixed(2));
                        if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
                            req.flash('error', 'Invalid refund selection.');
                            return res.redirect(`/refunds/request/${orderId}`);
                        }

                        if (requestedAmount > remaining + 0.01) {
                            req.flash('error', 'Refund amount exceeds remaining balance.');
                            return res.redirect(`/refunds/request/${orderId}`);
                        }

                        db.beginTransaction((txErr) => {
                            if (txErr) {
                                console.error('Error starting refund transaction:', txErr);
                                req.flash('error', 'Unable to submit refund request.');
                                return res.redirect(`/refunds/request/${orderId}`);
                            }

                            refundRequestModel.create(orderId, userId, requestedAmount, order.payment_method, reason, (createErr, result) => {
                                if (createErr) {
                                    console.error('Error creating refund request:', createErr);
                                    return db.rollback(() => {
                                        req.flash('error', 'Unable to submit refund request.');
                                        return res.redirect(`/refunds/request/${orderId}`);
                                    });
                                }

                                const requestId = result && result.insertId;
                                if (!requestId) {
                                    return db.rollback(() => {
                                        req.flash('error', 'Unable to submit refund request.');
                                        return res.redirect(`/refunds/request/${orderId}`);
                                    });
                                }

                                refundRequestItemModel.createMany(requestId, selections, (itemErr) => {
                                    if (itemErr) {
                                        console.error('Error saving refund items:', itemErr);
                                        return db.rollback(() => {
                                            req.flash('error', 'Refund submitted, but failed to save item details.');
                                            return res.redirect('/refunds');
                                        });
                                    }

                                    db.commit((commitErr) => {
                                        if (commitErr) {
                                            console.error('Error committing refund request:', commitErr);
                                            return db.rollback(() => {
                                                req.flash('error', 'Unable to submit refund request.');
                                                return res.redirect(`/refunds/request/${orderId}`);
                                            });
                                        }

                                        req.flash('success', 'Refund request submitted.');
                                        return res.redirect('/refunds');
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    },

    details(req, res) {
        const userId = req.session.user.id;
        const requestId = Number(req.params.id);
        if (!Number.isFinite(requestId)) {
            return res.redirect('/refunds');
        }

        refundRequestModel.getByIdForUser(requestId, userId, (err, request) => {
            if (err) {
                console.error('Error loading refund request:', err);
                req.flash('error', 'Unable to load refund request.');
                return res.redirect('/refunds');
            }
            if (!request) {
                return res.redirect('/refunds');
            }

            refundModel.getByRequestId(requestId, (refundErr, refunds = []) => {
                if (refundErr) {
                    console.error('Error loading refunds:', refundErr);
                    req.flash('error', 'Unable to load refund request.');
                    return res.redirect('/refunds');
                }

                const latestRefund = refunds && refunds.length ? refunds[0] : null;
                const requestStatus = String(request.status || '').toLowerCase();
                const refundStatus = latestRefund ? String(latestRefund.status || '').toLowerCase() : '';
                const shouldMarkCompleted = latestRefund && refundStatus === 'completed' && requestStatus !== 'completed';

                const renderDetails = () => refundRequestItemModel.getByRequestId(requestId, (itemsErr, items = []) => {
                    if (itemsErr) {
                        console.error('Error loading refund items:', itemsErr);
                        req.flash('error', 'Unable to load refund request.');
                        return res.redirect('/refunds');
                    }

                    return renderView(res, 'refundDetails', {
                        request,
                        refunds,
                        items,
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
    }
};
