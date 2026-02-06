//I declare that this code was written by me. 
// I will not copy or allow others to copy my code. 
// I understand that copying code is considered as plagiarism.

// Student Name: Zoey Liaw En Yi
// Student ID:24049473
// Class: C372_002_E63C
// Date created: 06/02/2026


const Order = require('../models/order');
const Product = require('../models/product');
const OrderItem = require('../models/orderItem');
const Wishlist = require('../models/wishlist');
const OrderReview = require('../models/orderReview');
const ReturnRequest = require('../models/returnRequest');
const refundRequestModel = require('../models/refundRequest');
const loyaltyService = require('../services/loyaltyService');
const orderStatusService = require('../services/orderStatusService');

const normalisePrice = (value) => {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return 0;
    }
    return Number(parsed.toFixed(2));
};

const normaliseOrderItem = (item) => {
    if (!item) {
        return item;
    }
    const name = item.productName || 'Deleted product';
    const isDeleted = !item.productName;
    return {
        ...item,
        productName: name,
        is_deleted: isDeleted ? 1 : 0
    };
};

const decorateWishlistItem = (item) => {
    const basePrice = normalisePrice(item.price);
    const discountPercentage = Math.min(100, Math.max(0, Number(item.discountPercentage) || 0));
    const hasDiscount = discountPercentage > 0;
    const effectivePrice = hasDiscount
        ? normalisePrice(basePrice * (1 - discountPercentage / 100))
        : basePrice;

    return {
        ...item,
        price: basePrice,
        discountPercentage,
        offerMessage: item.offerMessage || null,
        hasDiscount,
        effectivePrice
    };
};

const isShopper = (user) => user && user.role === 'customer';
const isAdmin = (user) => user && user.role === 'admin';

const getRedirectPath = (user) => (user && user.role === 'admin' ? '/admin/deliveries' : '/orders/history');

const buildTotals = (order) => {
    const subtotal = normalisePrice(order.subtotal || 0);
    const tax = normalisePrice(order.tax_amount || 0);
    const shipping = normalisePrice(order.shipping_amount || 0);
    const discount = normalisePrice(order.discount_amount || 0);
    const total = normalisePrice(order.total_amount || order.total || 0);
    return {
        subtotal,
        tax,
        shipping,
        discount,
        total
    };
};

const computeRefundEligibility = (order) => {
    const statusEligible = order && orderStatusService.isCompletedStatus(order.status);
    const paymentStatus = order && order.payment_status ? String(order.payment_status).toLowerCase() : 'pending';
    const paymentEligible = paymentStatus === 'paid';
    let withinWindow = true;
    let daysSince = null;

    const completedAt = order && order.completed_at ? new Date(order.completed_at) : null;
    const fallbackDate = order && order.created_at ? new Date(order.created_at) : null;
    const referenceDate = completedAt && !Number.isNaN(completedAt.getTime()) ? completedAt : fallbackDate;
    if (referenceDate && !Number.isNaN(referenceDate.getTime())) {
        const diffMs = Date.now() - referenceDate.getTime();
        daysSince = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        withinWindow = diffMs <= (14 * 24 * 60 * 60 * 1000);
    }

    return {
        statusEligible,
        paymentEligible,
        withinWindow,
        daysSince,
        allowed: statusEligible && withinWindow && paymentEligible
    };
};

const buildRefundTimeline = (refundData) => {
    const status = refundData ? String(refundData.status || '').toLowerCase() : '';
    const requested = ['pending', 'approved', 'processing', 'completed', 'rejected', 'failed'].includes(status);
    const approved = ['approved', 'processing', 'completed'].includes(status);
    const rejected = status === 'rejected';
    const completed = status === 'completed';
    const failed = status === 'failed';

    return [
        { key: 'requested', label: 'Requested', active: requested },
        { key: 'approved', label: 'Approved', active: approved },
        { key: 'rejected', label: 'Rejected', active: rejected },
        { key: 'completed', label: 'Completed', active: completed },
        { key: 'failed', label: 'Failed', active: failed }
    ];
};

const buildTrackingTimeline = (order) => {
    const paymentStatus = order && order.payment_status ? String(order.payment_status).toLowerCase() : 'pending';
    const rawStatus = orderStatusService.mapLegacyStatus(order && order.status ? order.status : 'processing');
    const fallbackMethod = order && (order.delivery_address || order.shipping_address) ? 'delivery' : 'pickup';
    const deliveryMethod = orderStatusService.resolveDeliveryMethod(order && order.delivery_method ? order.delivery_method : fallbackMethod);
    const flow = orderStatusService.getFlowForMethod(deliveryMethod);
    const isCancelled = orderStatusService.isCancelledStatus(rawStatus);
    const isReturned = orderStatusService.isReturnedStatus(rawStatus);
    const isRefunded = paymentStatus === 'refunded' || isCancelled || isReturned;
    const effectiveStatus = isRefunded ? 'completed' : rawStatus;
    const statusIndex = flow.indexOf(effectiveStatus);
    const isPaid = paymentStatus === 'paid' || paymentStatus === 'refunded';
    const readyLabel = deliveryMethod === 'pickup' ? 'Ready for pickup' : 'Shipped';
    const readyKey = deliveryMethod === 'pickup' ? 'ready_for_pickup' : 'shipped';

    const steps = [
        { key: 'placed', label: 'Order placed', active: true },
        { key: 'paid', label: 'Payment confirmed', active: isPaid }
    ];

    steps.push(
        { key: 'processing', label: 'Processing', active: statusIndex >= flow.indexOf('processing') },
        { key: 'packing', label: 'Packing', active: statusIndex >= flow.indexOf('packing') },
        { key: readyKey, label: readyLabel, active: statusIndex >= flow.indexOf(readyKey) }
    );

    if (deliveryMethod === 'delivery') {
        steps.push({ key: 'delivered', label: 'Delivered', active: statusIndex >= flow.indexOf('delivered') });
    }

    steps.push({ key: 'completed', label: 'Completed', active: statusIndex >= flow.indexOf('completed') });

    if (isCancelled) {
        steps.push({ key: 'cancelled', label: 'Cancelled', active: true });
    } else if (isReturned) {
        steps.push({ key: 'returned', label: 'Returned', active: true });
    }

    if (isRefunded) {
        steps.push({ key: 'refunded', label: 'Refunded', active: true });
    }

    return steps;
};

const fetchOrderWithItems = (orderId, callback) => {
    Order.findById(orderId, (orderErr, orderRows) => {
        if (orderErr) {
            return callback(orderErr);
        }

        if (!orderRows || !orderRows.length) {
            return callback(null, null, []);
        }

        const rawOrder = orderRows[0];
        const fallbackMethod = rawOrder.delivery_address || rawOrder.shipping_address ? 'delivery' : 'pickup';
        const deliveryMethod = rawOrder.delivery_method
            ? orderStatusService.resolveDeliveryMethod(rawOrder.delivery_method)
            : orderStatusService.resolveDeliveryMethod(fallbackMethod);
        const deliveryAddress = rawOrder.delivery_address || rawOrder.shipping_address || null;
        const order = {
            ...rawOrder,
            status: orderStatusService.mapLegacyStatus(rawOrder.status || 'processing'),
            delivery_method: deliveryMethod,
            delivery_address: deliveryAddress
        };
        OrderItem.findByOrderIds([orderId], (itemsErr, itemRows) => {
            if (itemsErr) {
                return callback(itemsErr);
            }
            const items = (itemRows || []).map(normaliseOrderItem);
            return callback(null, order, items);
        });
    });
};

const details = (req, res) => {
    const orderId = parseInt(req.params.id, 10);
    const sessionUser = req.session.user;
    const redirectPath = getRedirectPath(sessionUser);

    if (!Number.isFinite(orderId)) {
        req.flash('error', 'Invalid order selected.');
        return res.redirect(redirectPath);
    }

    fetchOrderWithItems(orderId, (orderErr, order, items) => {
        if (orderErr) {
            console.error('Error fetching order details:', orderErr);
            req.flash('error', 'Unable to load order details.');
            return res.redirect(redirectPath);
        }

        if (!order) {
            req.flash('error', 'Order not found.');
            return res.redirect(redirectPath);
        }

        const owner = sessionUser && order.user_id === sessionUser.id;
        if (!isAdmin(sessionUser) && !owner) {
            req.flash('error', 'You are not authorised to view this order.');
            return res.redirect(redirectPath);
        }

        const userId = isAdmin(sessionUser) ? null : sessionUser.id;
        refundRequestModel.getLatestByOrderIds([orderId], userId, (refundErr, refundRows = []) => {
            if (refundErr) {
                console.error('Error loading refund data:', refundErr);
            }

            const refundData = refundRows && refundRows.length ? refundRows[0] : null;
            const eligibility = computeRefundEligibility(order);
            const normalizedStatus = orderStatusService.mapLegacyStatus(order.status || 'processing');
            const canReview = isShopper(sessionUser) && normalizedStatus === 'completed';
            const backLink = req.get('referer') || getRedirectPath(sessionUser);
            res.render('orderDetails', {
                user: sessionUser,
                order,
                items,
                totals: buildTotals(order),
                canReview,
                refundEligibility: eligibility,
                refundRequest: refundData,
                refundTimeline: buildRefundTimeline(refundData),
                backLink,
                messages: req.flash('success'),
                errors: req.flash('error')
            });
        });
    });
};

const track = (req, res) => {
    const orderId = parseInt(req.params.id, 10);
    const sessionUser = req.session.user;
    const redirectPath = getRedirectPath(sessionUser);

    if (!Number.isFinite(orderId)) {
        req.flash('error', 'Invalid order selected.');
        return res.redirect(redirectPath);
    }

    fetchOrderWithItems(orderId, (orderErr, order, items) => {
        if (orderErr) {
            console.error('Error fetching order tracking:', orderErr);
            req.flash('error', 'Unable to load tracking details.');
            return res.redirect(redirectPath);
        }

        if (!order) {
            req.flash('error', 'Order not found.');
            return res.redirect(redirectPath);
        }

        const owner = sessionUser && order.user_id === sessionUser.id;
        if (!isAdmin(sessionUser) && !owner) {
            req.flash('error', 'You are not authorised to view this order.');
            return res.redirect(redirectPath);
        }

        res.render('orderTracking', {
            user: sessionUser,
            order,
            items,
            timeline: buildTrackingTimeline(order),
            totals: buildTotals(order),
            messages: req.flash('success'),
            errors: req.flash('error')
        });
    });
};

const reviewForm = (req, res) => {
    const orderId = parseInt(req.params.id, 10);
    const sessionUser = req.session.user;
    const redirectPath = getRedirectPath(sessionUser);

    if (!Number.isFinite(orderId)) {
        req.flash('error', 'Invalid order selected.');
        return res.redirect(redirectPath);
    }

    fetchOrderWithItems(orderId, (orderErr, order, items) => {
        if (orderErr) {
            console.error('Error fetching order review data:', orderErr);
            req.flash('error', 'Unable to load review form.');
            return res.redirect(redirectPath);
        }

        if (!order) {
            req.flash('error', 'Order not found.');
            return res.redirect(redirectPath);
        }

        const owner = sessionUser && order.user_id === sessionUser.id;
        if (!owner || !isShopper(sessionUser)) {
            req.flash('error', 'Only shoppers can review completed orders.');
            return res.redirect(`/order/${orderId}`);
        }

        if (!orderStatusService.isCompletedStatus(order.status)) {
            req.flash('error', 'Reviews are available after the order is completed.');
            return res.redirect(`/order/${orderId}`);
        }

        const itemIds = items.filter(item => item.product_id).map(item => item.id).filter(Boolean);
        OrderReview.findByUserAndOrderItems(sessionUser.id, itemIds, (reviewErr, reviewRows) => {
            if (reviewErr) {
                console.error('Error fetching reviews for order:', reviewErr);
                req.flash('error', 'Unable to load existing reviews.');
                return res.redirect(`/order/${orderId}`);
            }

            const reviewByItem = (reviewRows || []).reduce((acc, review) => {
                acc[review.order_item_id] = review;
                return acc;
            }, {});

            res.render('orderReview', {
                user: sessionUser,
                order,
                items,
                reviewByItem,
                messages: req.flash('success'),
                errors: req.flash('error')
            });
        });
    });
};

const submitReview = (req, res) => {
    const orderId = parseInt(req.params.id, 10);
    const sessionUser = req.session.user;
    const redirectPath = getRedirectPath(sessionUser);

    if (!Number.isFinite(orderId)) {
        req.flash('error', 'Invalid order selected.');
        return res.redirect(redirectPath);
    }

    if (!isShopper(sessionUser)) {
        req.flash('error', 'Only shoppers can submit reviews.');
        return res.redirect(`/order/${orderId}`);
    }

    const orderItemId = parseInt(req.body.orderItemId, 10);
    const productId = parseInt(req.body.productId, 10);
    const rating = parseInt(req.body.rating, 10);
    const comment = (req.body.comment || '').trim();

    if (!Number.isFinite(orderItemId) || !Number.isFinite(productId)) {
        req.flash('error', 'Invalid review submission.');
        return res.redirect(`/order/${orderId}/review`);
    }

    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
        req.flash('error', 'Please select a rating between 1 and 5.');
        return res.redirect(`/order/${orderId}/review`);
    }

    if (!comment) {
        req.flash('error', 'Please share a short comment with your rating.');
        return res.redirect(`/order/${orderId}/review`);
    }

    fetchOrderWithItems(orderId, (orderErr, order, items) => {
        if (orderErr) {
            console.error('Error validating review submission:', orderErr);
            req.flash('error', 'Unable to submit review.');
            return res.redirect(`/order/${orderId}/review`);
        }

        if (!order) {
            req.flash('error', 'Order not found.');
            return res.redirect(redirectPath);
        }

        if (order.user_id !== sessionUser.id) {
            req.flash('error', 'You are not authorised to review this order.');
            return res.redirect(redirectPath);
        }

        if (!orderStatusService.isCompletedStatus(order.status)) {
            req.flash('error', 'Reviews are available after the order is completed.');
            return res.redirect(`/order/${orderId}`);
        }

        const itemMatch = items.find(item => item.id === orderItemId);
        if (!itemMatch || Number(itemMatch.product_id) !== productId) {
            req.flash('error', 'The selected item is not part of this order.');
            return res.redirect(`/order/${orderId}/review`);
        }

        OrderReview.findByUserAndOrderItem(sessionUser.id, orderItemId, (lookupErr, reviewRows) => {
            if (lookupErr) {
                console.error('Error checking existing review:', lookupErr);
                req.flash('error', 'Unable to submit review.');
                return res.redirect(`/order/${orderId}/review`);
            }

            if (reviewRows && reviewRows.length) {
                const reviewId = reviewRows[0].id;
                return OrderReview.update(reviewId, { rating, comment }, (updateErr) => {
                    if (updateErr) {
                        console.error('Error updating review:', updateErr);
                        req.flash('error', 'Unable to update review.');
                        return res.redirect(`/order/${orderId}/review`);
                    }
                    req.flash('success', 'Your review has been updated.');
                    return res.redirect(`/order/${orderId}/review`);
                });
            }

            return OrderReview.create({
                productId,
                userId: sessionUser.id,
                orderItemId,
                rating,
                comment
            }, (createErr) => {
                if (createErr) {
                    console.error('Error saving review:', createErr);
                    req.flash('error', 'Unable to submit review.');
                    return res.redirect(`/order/${orderId}/review`);
                }
                loyaltyService.awardPointsForReview({
                    userId: sessionUser.id,
                    orderId,
                    orderItemId,
                    productId
                }).then((award) => {
                    if (req.session.user && Number.isFinite(award.balance)) {
                        req.session.user.loyalty_points = award.balance;
                    }
                }).catch((awardErr) => {
                    console.error('Error awarding EcoPoints for review:', awardErr);
                });
                req.flash('success', 'Thanks for sharing your feedback.');
                return res.redirect(`/order/${orderId}/review`);
            });
        });
    });
};

const returnForm = (req, res) => {
    const orderId = parseInt(req.params.id, 10);
    const sessionUser = req.session.user;
    const redirectPath = getRedirectPath(sessionUser);

    if (!Number.isFinite(orderId)) {
        req.flash('error', 'Invalid order selected.');
        return res.redirect(redirectPath);
    }

    fetchOrderWithItems(orderId, (orderErr, order, items) => {
        if (orderErr) {
            console.error('Error fetching return details:', orderErr);
            req.flash('error', 'Unable to load return request.');
            return res.redirect(redirectPath);
        }

        if (!order) {
            req.flash('error', 'Order not found.');
            return res.redirect(redirectPath);
        }

        const owner = sessionUser && order.user_id === sessionUser.id;
        if (!owner || !isShopper(sessionUser)) {
            req.flash('error', 'Only shoppers can request returns or exchanges.');
            return res.redirect(`/order/${orderId}`);
        }

        ReturnRequest.getByOrderId(orderId, (returnErr, returnData) => {
            if (returnErr) {
                console.error('Error loading return data:', returnErr);
                req.flash('error', 'Unable to load return request.');
                return res.redirect(`/order/${orderId}`);
            }

            const eligibility = computeReturnEligibility(order);
            res.render('orderReturn', {
                user: sessionUser,
                order,
                items,
                totals: buildTotals(order),
                returnEligibility: eligibility,
                returnRequest: returnData,
                returnTimeline: buildReturnTimeline(returnData),
                messages: req.flash('success'),
                errors: req.flash('error')
            });
        });
    });
};

const processReturn = (req, res) => {
    const orderId = parseInt(req.params.id, 10);
    const sessionUser = req.session.user;
    const redirectPath = getRedirectPath(sessionUser);

    if (!Number.isFinite(orderId)) {
        req.flash('error', 'Invalid order selected.');
        return res.redirect(redirectPath);
    }

    if (!isShopper(sessionUser)) {
        req.flash('error', 'Only shoppers can request returns or exchanges.');
        return res.redirect(`/order/${orderId}`);
    }

    const requestType = req.body.requestType === 'exchange' ? 'exchange' : 'return';
    const reason = (req.body.reason || '').trim();
    const notes = (req.body.notes || '').trim();

    if (!reason) {
        req.flash('error', 'Please add a short reason for your request.');
        return res.redirect(`/order/${orderId}/return`);
    }

    fetchOrderWithItems(orderId, (orderErr, order) => {
        if (orderErr) {
            console.error('Error validating return request:', orderErr);
            req.flash('error', 'Unable to submit return request.');
            return res.redirect(`/order/${orderId}/return`);
        }

        if (!order) {
            req.flash('error', 'Order not found.');
            return res.redirect(redirectPath);
        }

        if (order.user_id !== sessionUser.id) {
            req.flash('error', 'You are not authorised to manage this order.');
            return res.redirect(redirectPath);
        }

        const eligibility = computeReturnEligibility(order);
        if (!eligibility.allowed) {
            req.flash('error', 'This order is not eligible for returns or exchanges.');
            return res.redirect(`/order/${orderId}/return`);
        }

        ReturnRequest.getByOrderId(orderId, (returnErr, returnData) => {
            if (returnErr) {
                console.error('Error checking return data:', returnErr);
                req.flash('error', 'Unable to submit return request.');
                return res.redirect(`/order/${orderId}/return`);
            }

            const existingStatus = returnData ? returnData.status : null;
            if (['approved', 'rejected', 'completed'].includes(existingStatus)) {
                req.flash('error', 'This return request has already been reviewed.');
                return res.redirect(`/order/${orderId}/return`);
            }

            const now = new Date().toISOString();
            const payload = {
                ...(returnData || {}),
                status: 'requested',
                requestType,
                reason,
                notes,
                requestedAt: returnData && returnData.requestedAt ? returnData.requestedAt : now,
                lastUpdatedAt: now
            };

            ReturnRequest.upsert(orderId, payload, (updateErr) => {
                if (updateErr) {
                    console.error('Error saving return request:', updateErr);
                    req.flash('error', 'Unable to submit return request.');
                    return res.redirect(`/order/${orderId}/return`);
                }

                req.flash('success', 'Return request submitted. We will update you soon.');
                return res.redirect(`/order/${orderId}/return`);
            });
        });
    });
};

const wishlist = (req, res) => {
    const sessionUser = req.session.user;

    if (!isShopper(sessionUser)) {
        req.flash('error', 'Only shoppers can access wishlists.');
        return res.redirect('/shopping');
    }

    Wishlist.getByUser(sessionUser.id, (wishErr, rows) => {
        if (wishErr) {
            console.error('Error loading wishlist:', wishErr);
            req.flash('error', 'Unable to load wishlist.');
            return res.redirect('/shopping');
        }

        const items = (rows || []).map(decorateWishlistItem);

        res.render('wishlist', {
            user: sessionUser,
            items,
            messages: req.flash('success'),
            errors: req.flash('error')
        });
    });
};

const addWishlist = (req, res) => {
    const sessionUser = req.session.user;
    const productId = parseInt(req.params.id, 10);
    const fallback = req.get('referer') || '/wishlist';

    if (!isShopper(sessionUser)) {
        req.flash('error', 'Only shoppers can manage wishlists.');
        return res.redirect('/shopping');
    }

    if (!Number.isFinite(productId)) {
        req.flash('error', 'Invalid product selected.');
        return res.redirect(fallback);
    }

    Product.getById(productId, (productErr, productRows) => {
        if (productErr) {
            console.error('Error validating wishlist product:', productErr);
            req.flash('error', 'Unable to update wishlist.');
            return res.redirect(fallback);
        }

        if (!productRows || !productRows.length) {
            req.flash('error', 'Product not found.');
            return res.redirect(fallback);
        }

        Wishlist.add(sessionUser.id, productId, (addErr, result) => {
            if (addErr) {
                console.error('Error adding wishlist item:', addErr);
                req.flash('error', 'Unable to update wishlist.');
                return res.redirect(fallback);
            }

            const added = result && result.affectedRows > 0;
            req.flash('success', added ? 'Saved to your wishlist.' : 'Item already in your wishlist.');
            return res.redirect(fallback);
        });
    });
};

const removeWishlist = (req, res) => {
    const sessionUser = req.session.user;
    const productId = parseInt(req.params.id, 10);

    if (!isShopper(sessionUser)) {
        req.flash('error', 'Only shoppers can manage wishlists.');
        return res.redirect('/shopping');
    }

    if (!Number.isFinite(productId)) {
        req.flash('error', 'Invalid product selected.');
        return res.redirect('/wishlist');
    }

    Wishlist.remove(sessionUser.id, productId, (removeErr) => {
        if (removeErr) {
            console.error('Error removing wishlist item:', removeErr);
            req.flash('error', 'Unable to update wishlist.');
            return res.redirect('/wishlist');
        }

        req.flash('success', 'Item removed from wishlist.');
        return res.redirect('/wishlist');
    });
};

module.exports = {
    details,
    track,
    reviewForm,
    submitReview,
    returnForm,
    processReturn,
    wishlist,
    addWishlist,
    removeWishlist
};
