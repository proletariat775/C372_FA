const Order = require('../models/order');
const refundRequestModel = require('../models/refundRequest');
const refundRequestItemModel = require('../models/refundRequestItem');
const refundModel = require('../models/refund');

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

const parseSelectedItems = (rawItems = {}, orderItems = []) => {
    const itemMap = buildItemMap(orderItems);
    const selections = [];

    Object.keys(rawItems || {}).forEach((key) => {
        const orderItemId = Number(key);
        const requestedQty = Number(rawItems[key]);
        const item = itemMap[orderItemId];
        if (!item || !Number.isFinite(requestedQty) || requestedQty <= 0) {
            return;
        }

        const maxQty = Number(item.quantity) || 0;
        const finalQty = Math.min(requestedQty, maxQty);
        if (finalQty <= 0) {
            return;
        }

        selections.push({
            orderItemId,
            productId: item.product_id,
            variantId: item.product_variant_id,
            quantity: finalQty,
            unitPrice: Number(item.price) || 0
        });
    });

    return selections;
};

const sumSelectionAmount = (selections = []) => {
    return selections.reduce((sum, item) => {
        return sum + (Number(item.unitPrice) * Number(item.quantity));
    }, 0);
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

            refundRequestModel.getPendingByOrder(orderId, userId, (pendingErr, pending) => {
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
                if (remaining <= 0) {
                    req.flash('error', 'No refundable balance remaining.');
                    return res.redirect('/orders/history');
                }

                Order.findItemsByOrderIds([orderId], (itemsErr, orderItems = []) => {
                    if (itemsErr) {
                        console.error('Error loading order items for refund:', itemsErr);
                        req.flash('error', 'Unable to load refund request.');
                        return res.redirect('/orders/history');
                    }

                    return renderView(res, 'refundRequest', {
                        order,
                        remaining,
                        orderItems,
                        messages: req.flash('success'),
                        errors: req.flash('error')
                    });
                });
            });
        });
    },

    submitRequest(req, res) {
        const userId = req.session.user.id;
        const orderId = Number(req.params.orderId);
        const requestedAmount = Number(req.body.amount);
        const reason = req.body.reason;
        const selectedItemsRaw = extractItemsPayload(req.body || {});

        if (!Number.isFinite(orderId)) {
            req.flash('error', 'Invalid order selected.');
            return res.redirect('/orders/history');
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

            Order.findItemsByOrderIds([orderId], (itemsErr, orderItems = []) => {
                if (itemsErr) {
                    console.error('Error loading order items for refund:', itemsErr);
                    req.flash('error', 'Unable to submit refund request.');
                    return res.redirect(`/refunds/request/${orderId}`);
                }

                const selections = parseSelectedItems(selectedItemsRaw, orderItems);
                if (!selections.length) {
                    req.flash('error', 'Select at least one item to refund.');
                    return res.redirect(`/refunds/request/${orderId}`);
                }

                const deliveryFee = Number(order.delivery_fee || 0);
                const maxSelectableAmount = Number((sumSelectionAmount(selections) + deliveryFee).toFixed(2));
                if (maxSelectableAmount <= 0) {
                    req.flash('error', 'Invalid refund selection.');
                    return res.redirect(`/refunds/request/${orderId}`);
                }

                if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
                    req.flash('error', 'Refund amount must be greater than 0.');
                    return res.redirect(`/refunds/request/${orderId}`);
                }
                if (requestedAmount > remaining) {
                    req.flash('error', 'Refund amount exceeds remaining balance.');
                    return res.redirect(`/refunds/request/${orderId}`);
                }
                if (requestedAmount > maxSelectableAmount) {
                    req.flash('error', 'Refund amount exceeds selected items total.');
                    return res.redirect(`/refunds/request/${orderId}`);
                }

                refundRequestModel.getPendingByOrder(orderId, userId, (pendingErr, pending) => {
                    if (pendingErr) {
                        console.error('Error checking pending refunds:', pendingErr);
                        req.flash('error', 'Unable to submit refund request.');
                        return res.redirect(`/refunds/request/${orderId}`);
                    }

                    if (pending) {
                        req.flash('error', 'You already have a pending refund request for this order.');
                        return res.redirect('/refunds');
                    }

                    refundRequestModel.create(orderId, userId, requestedAmount, reason, (createErr, result) => {
                        if (createErr) {
                            console.error('Error creating refund request:', createErr);
                            req.flash('error', 'Unable to submit refund request.');
                            return res.redirect(`/refunds/request/${orderId}`);
                        }

                        const requestId = result && result.insertId;
                        if (!requestId) {
                            req.flash('error', 'Unable to submit refund request.');
                            return res.redirect(`/refunds/request/${orderId}`);
                        }

                        refundRequestItemModel.createMany(requestId, selections, (itemErr) => {
                            if (itemErr) {
                                console.error('Error saving refund items:', itemErr);
                                req.flash('error', 'Refund submitted, but failed to save item details.');
                                return res.redirect('/refunds');
                            }

                            req.flash('success', 'Refund request submitted.');
                            return res.redirect('/refunds');
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
                const requestStatus = String(request.status || '').toUpperCase();
                const refundStatus = latestRefund ? String(latestRefund.status || '').toUpperCase() : '';
                const shouldMarkCompleted = latestRefund && refundStatus === 'COMPLETED' && requestStatus !== 'COMPLETED';

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
    }
};
