const Order = require('../models/order');
const Product = require('../models/product');
const User = require('../models/user');
const Coupon = require('../models/coupon');
const couponService = require('../services/couponService');

const DELIVERY_FEE = 1.5;

const normalisePrice = (value) => {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return 0;
    }
    return Number(parsed.toFixed(2));
};

const decorateProduct = (product) => {
    if (!product) {
        return product;
    }

    const basePrice = normalisePrice(product.price);
    const discountPercentage = Math.min(
        100,
        Math.max(0, Number.parseFloat(product.discountPercentage) || 0)
    );
    const hasDiscount = discountPercentage > 0;
    const offerMessage = product.offerMessage ? String(product.offerMessage).trim() : null;
    const effectivePrice = hasDiscount
        ? normalisePrice(basePrice * (1 - discountPercentage / 100))
        : basePrice;

    return {
        ...product,
        price: basePrice,
        discountPercentage,
        offerMessage,
        effectivePrice,
        hasDiscount
    };
};

const ensureSessionCart = (req) => {
    if (!Array.isArray(req.session.cart)) {
        req.session.cart = [];
    }
    return req.session.cart;
};

const clampDiscount = (value) => {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return 0;
    }
    if (parsed > 100) {
        return 100;
    }
    return Number(parsed.toFixed(2));
};

const normaliseOfferMessage = (message) => {
    if (!message) {
        return null;
    }
    const trimmed = String(message).trim();
    if (!trimmed) {
        return null;
    }
    return trimmed.slice(0, 255);
};

const buildCartItem = (product, quantity) => {
    const basePrice = normalisePrice(product.price);
    const discountPercentage = clampDiscount(product.discountPercentage);
    const hasDiscount = discountPercentage > 0;
    const finalPrice = hasDiscount
        ? normalisePrice(basePrice * (1 - discountPercentage / 100))
        : basePrice;

    const cartItem = {
        productId: product.id,
        productName: product.productName,
        price: finalPrice,
        quantity,
        image: product.image || null,
        hasDiscount
    };

    if (hasDiscount) {
        cartItem.originalPrice = basePrice;
        cartItem.discountPercentage = discountPercentage;
        cartItem.offerMessage = normaliseOfferMessage(product.offerMessage);
    }

    return cartItem;
};

const fetchProductById = (productId) => new Promise((resolve, reject) => {
    Product.getById(productId, (err, rows) => {
        if (err) {
            return reject(err);
        }
        return resolve(rows && rows[0]);
    });
});

const validateCartForCheckout = async (req) => {
    const cart = ensureSessionCart(req);
    if (!cart.length) {
        return { cart: [], changed: false, issues: [] };
    }

    const issues = [];
    const updatedCart = [];
    let changed = false;

    for (const item of cart) {
        const productId = Number(item.productId);
        const requestedQty = Number(item.quantity);

        if (!Number.isFinite(productId)) {
            issues.push('Invalid product detected in cart. It has been removed.');
            changed = true;
            continue;
        }

        if (!Number.isFinite(requestedQty) || requestedQty <= 0) {
            issues.push('Invalid quantity detected in cart. The item has been removed.');
            changed = true;
            continue;
        }

        const product = await fetchProductById(productId);
        if (!product) {
            issues.push('A product in your cart is no longer available and was removed.');
            changed = true;
            continue;
        }

        const stock = Number.parseInt(product.quantity, 10) || 0;
        if (stock <= 0) {
            issues.push(`"${product.productName}" is out of stock and was removed.`);
            changed = true;
            continue;
        }

        let finalQty = requestedQty;
        if (requestedQty > stock) {
            finalQty = stock;
            issues.push(`"${product.productName}" quantity was reduced to available stock (${stock}).`);
            changed = true;
        }

        const rebuilt = buildCartItem(product, finalQty);
        const previousPrice = Number(item.price);
        if (!Number.isFinite(previousPrice) || Number(previousPrice.toFixed(2)) !== rebuilt.price) {
            issues.push(`Price updated for "${product.productName}". Please review before checkout.`);
            changed = true;
        }

        updatedCart.push(rebuilt);
    }

    req.session.cart = updatedCart;
    return { cart: updatedCart, changed, issues };
};

const normaliseOrderItem = (item) => {
    if (!item) {
        return item;
    }
    const name = item.productName || 'Deleted product';
    const isDeleted = item.is_deleted === 1 || name === 'Deleted product';
    return {
        ...item,
        productName: name,
        is_deleted: isDeleted ? 1 : 0
    };
};

const computeDeliveryFee = (user, deliveryMethod, waiveFee = false) => {
    if (deliveryMethod !== 'delivery') {
        return 0;
    }

    if (waiveFee) {
        return 0;
    }

    if (user && (user.free_delivery || user.free_delivery === 1)) {
        return 0;
    }

    return DELIVERY_FEE;
};

const sanitiseDeliveryAddress = (address) => {
    if (!address) {
        return null;
    }
    const trimmed = address.trim();
    return trimmed.length ? trimmed.slice(0, 255) : null;
};

/**
 * Handle checkout and order creation.
 */
const checkout = (req, res) => {
    if (!req.session.user || req.session.user.role !== 'user') {
        req.flash('error', 'Only shoppers can complete checkout.');
        return res.redirect('/cart');
    }

    validateCartForCheckout(req)
        .then(({ cart, changed, issues }) => {
            if (!cart.length) {
                req.flash('error', 'Your cart is empty.');
                return res.redirect('/cart');
            }

            if (issues.length) {
                issues.forEach((issue) => req.flash('error', issue));
            }

            if (changed) {
                req.flash('error', 'We updated your cart based on the latest stock and pricing.');
                return res.redirect('/cart');
            }

            const deliveryMethod = req.body.deliveryMethod === 'delivery' ? 'delivery' : 'pickup';
            const providedAddress = sanitiseDeliveryAddress(req.body.deliveryAddress) || req.session.user.address;
            const deliveryAddress = deliveryMethod === 'delivery' ? sanitiseDeliveryAddress(providedAddress) : null;

            if (deliveryMethod === 'delivery' && !deliveryAddress) {
                req.flash('error', 'Please provide a delivery address.');
                return res.redirect('/cart');
            }

            const deliveryFee = computeDeliveryFee(req.session.user, deliveryMethod);
            const subtotal = couponService.calculateSubtotal(cart);

            const cartContainer = ensureSessionCart(req);
            let appliedCoupon = cartContainer.appliedCoupon || null;
            let discountAmount = 0;
            let promoCode = null;
            let couponId = null;

            if (appliedCoupon && subtotal > 0) {
                return couponService.validateCoupon(appliedCoupon.code, req.session.user.id, subtotal)
                    .then((validation) => {
                        if (!validation.valid) {
                            delete cartContainer.appliedCoupon;
                            req.flash('error', validation.message || 'Coupon is no longer valid.');
                            return res.redirect('/cart');
                        }

                        discountAmount = validation.discountAmount;
                        promoCode = validation.coupon.code;
                        couponId = validation.coupon.id;
                        cartContainer.appliedCoupon = couponService.buildAppliedCoupon(validation.coupon, discountAmount);

                        return createOrderWithCoupon({
                            req,
                            res,
                            cart,
                            deliveryAddress,
                            deliveryFee,
                            discountAmount,
                            promoCode,
                            couponId
                        });
                    })
                    .catch((error) => {
                        console.error('Error validating coupon during checkout:', error);
                        req.flash('error', 'Unable to validate your coupon right now.');
                        return res.redirect('/cart');
                    });
            }

            return createOrderWithCoupon({
                req,
                res,
                cart,
                deliveryAddress,
                deliveryFee,
                discountAmount,
                promoCode,
                couponId
            });
        })
        .catch((error) => {
            console.error('Error validating cart for checkout:', error);
            req.flash('error', 'Unable to validate your cart right now.');
            return res.redirect('/cart');
        });
};

const createOrderWithCoupon = ({ req, res, cart, deliveryAddress, deliveryFee, discountAmount, promoCode, couponId }) => {
    return Order.create(req.session.user.id, cart, {
        shipping_address: deliveryAddress,
        shipping_amount: deliveryFee,
        discount_amount: discountAmount,
        promo_code: promoCode
    }, (error, result) => {
        if (error) {
            console.error('Error during checkout:', error);
            req.flash('error', error.message || 'Unable to complete checkout. Please try again.');
            return res.redirect('/cart');
        }

        if (couponId && discountAmount > 0) {
            Coupon.recordUsage(couponId, req.session.user.id, result.orderId, discountAmount, (usageErr) => {
                if (usageErr) {
                    console.error('Error recording coupon usage:', usageErr);
                }
            });

            Coupon.incrementUsage(couponId, (usageErr) => {
                if (usageErr) {
                    console.error('Error incrementing coupon usage count:', usageErr);
                }
            });
        }

        req.session.cart = [];
        req.flash('success', `Thanks for your purchase! ${deliveryAddress ? 'We will deliver your order shortly.' : 'Pickup details will be shared soon.'}`);
        return res.redirect('/orders/history');
    });
};

/**
 * Display purchase history for the logged-in user.
 */
const history = (req, res) => {
    if (!req.session.user) {
        req.flash('error', 'Please log in to view purchases.');
        return res.redirect('/login');
    }

    const sessionUser = req.session.user;
    const isAdmin = sessionUser && sessionUser.role === 'admin';
    const onErrorRedirect = isAdmin ? '/admin/deliveries' : '/shopping';

    const ordersFetcher = isAdmin
        ? (cb) => Order.findAllWithUsers(cb)
        : (cb) => Order.findByUser(sessionUser.id, cb);

    ordersFetcher((ordersError, orderRows) => {
        if (ordersError) {
            console.error('Error fetching purchase history:', ordersError);
            req.flash('error', 'Unable to load purchase history.');
            return res.redirect(onErrorRedirect);
        }

        const orders = (orderRows || []).map((order) => ({
            ...order,
            delivery_method: order.shipping_address ? 'delivery' : 'pickup',
            delivery_address: order.shipping_address,
            delivery_fee: Number(order.shipping_amount || 0),
            total: Number(order.total_amount || order.total || 0)
        }));
        const orderIds = orders.map(order => order.id);

        Order.findItemsByOrderIds(orderIds, (itemsError, itemRows) => {
            if (itemsError) {
                console.error('Error fetching order items:', itemsError);
                req.flash('error', 'Unable to load purchase history.');
                return res.redirect(onErrorRedirect);
            }

            const itemsByOrder = orderIds.reduce((acc, id) => {
                acc[id] = [];
                return acc;
            }, {});

            (itemRows || []).forEach((item) => {
                const safeItem = normaliseOrderItem(item);
                if (!itemsByOrder[safeItem.order_id]) {
                    itemsByOrder[safeItem.order_id] = [];
                }
                itemsByOrder[safeItem.order_id].push(safeItem);
            });

            Order.getBestSellers(4, (bestErr, bestRows) => {
                if (bestErr) {
                    console.error('Error fetching best sellers:', bestErr);
                }

                res.render('orderHistory', {
                    user: sessionUser,
                    orders,
                    orderItems: itemsByOrder,
                    bestSellers: (bestRows || []).map(decorateProduct),
                    messages: req.flash('success'),
                    errors: req.flash('error')
                });
            });
        });
    });
};

const listAllDeliveries = (req, res) => {
    Order.findAllWithUsers((orderErr, orderRows) => {
        if (orderErr) {
            console.error('Error fetching deliveries:', orderErr);
            req.flash('error', 'Unable to load deliveries.');
            return res.redirect('/inventory');
        }

        const orders = orderRows || [];
        const orderIds = orders.map(order => order.id);

        Order.findItemsByOrderIds(orderIds, (itemsErr, itemRows) => {
            if (itemsErr) {
                console.error('Error fetching delivery items:', itemsErr);
                req.flash('error', 'Unable to load deliveries.');
                return res.redirect('/inventory');
            }

            const itemsByOrder = orderIds.reduce((acc, id) => {
                acc[id] = [];
                return acc;
            }, {});

            (itemRows || []).forEach((item) => {
                const safeItem = normaliseOrderItem(item);
                if (!itemsByOrder[safeItem.order_id]) {
                    itemsByOrder[safeItem.order_id] = [];
                }
                itemsByOrder[safeItem.order_id].push(safeItem);
            });

            res.render('adminDeliveries', {
                user: req.session.user,
                orders,
                orderItems: itemsByOrder,
                messages: req.flash('success'),
                errors: req.flash('error')
            });
        });
    });
};

const updateDeliveryDetails = (req, res) => {
    const orderId = parseInt(req.params.id, 10);
    if (!Number.isFinite(orderId)) {
        req.flash('error', 'Invalid order selected.');
        return res.redirect(req.session.user && req.session.user.role === 'admin' ? '/admin/deliveries' : '/orders/history');
    }

    Order.findById(orderId, (orderErr, orderRows) => {
        if (orderErr) {
            console.error('Error locating order for delivery update:', orderErr);
            req.flash('error', 'Unable to update delivery.');
            return res.redirect(req.session.user && req.session.user.role === 'admin' ? '/admin/deliveries' : '/orders/history');
        }

        if (!orderRows || !orderRows.length) {
            req.flash('error', 'Order not found.');
            return res.redirect(req.session.user && req.session.user.role === 'admin' ? '/admin/deliveries' : '/orders/history');
        }

        const order = orderRows[0];
        const sessionUser = req.session.user;
        const isAdmin = sessionUser && sessionUser.role === 'admin';
        const isOwner = sessionUser && sessionUser.id === order.user_id;

        if (!isAdmin && !isOwner) {
            req.flash('error', 'You are not authorised to update this delivery.');
            return res.redirect('/orders/history');
        }

        User.findById(order.user_id, (userErr, userRows) => {
            if (userErr) {
                console.error('Error fetching user for delivery update:', userErr);
                req.flash('error', 'Unable to update delivery.');
                return res.redirect(isAdmin ? '/admin/deliveries' : '/orders/history');
            }

            const account = userRows && userRows[0];
            const deliveryMethod = req.body.deliveryMethod === 'delivery' ? 'delivery' : 'pickup';
            const requestedAddress = sanitiseDeliveryAddress(req.body.deliveryAddress) || (account ? account.address : null);
            const waiveFee = isAdmin && (req.body.waiveFee === 'on' || req.body.waiveFee === 'true');
            const deliveryFee = computeDeliveryFee(account, deliveryMethod, waiveFee);
            const redirectPath = isAdmin ? '/admin/deliveries' : '/orders/history';

            if (deliveryMethod === 'delivery' && !requestedAddress) {
                req.flash('error', 'Delivery address is required.');
                return res.redirect(redirectPath);
            }

            Order.updateDelivery(orderId, {
                shipping_address: deliveryMethod === 'delivery' ? requestedAddress : null,
                shipping_amount: deliveryFee
            }, (updateErr) => {
                if (updateErr) {
                    console.error('Error updating delivery details:', updateErr);
                    req.flash('error', 'Unable to update delivery right now.');
                    return res.redirect(redirectPath);
                }

                if (!isAdmin && sessionUser && deliveryMethod === 'delivery') {
                    sessionUser.address = requestedAddress;
                }

                req.flash('success', 'Delivery details updated.');
                return res.redirect(redirectPath);
            });
        });
    });
};

/**
 * Render a printable invoice for an order.
 */
const invoice = (req, res) => {
    const orderId = parseInt(req.params.id, 10);
    const sessionUser = req.session.user;
    const redirectPath = sessionUser && sessionUser.role === 'admin' ? '/admin/deliveries' : '/orders/history';

    if (!Number.isFinite(orderId)) {
        req.flash('error', 'Invalid order selected.');
        return res.redirect(redirectPath);
    }

    Order.findById(orderId, (orderErr, orderRows) => {
        if (orderErr) {
            console.error('Error fetching order for invoice:', orderErr);
            req.flash('error', 'Unable to load invoice.');
            return res.redirect(redirectPath);
        }

        if (!orderRows || !orderRows.length) {
            req.flash('error', 'Order not found.');
            return res.redirect(redirectPath);
        }

        const order = orderRows[0];
        const isAdmin = sessionUser && sessionUser.role === 'admin';
        const isOwner = sessionUser && sessionUser.id === order.user_id;

        if (!isAdmin && !isOwner) {
            req.flash('error', 'You are not authorised to view this invoice.');
            return res.redirect(redirectPath);
        }

        User.findById(order.user_id, (userErr, userRows) => {
            if (userErr) {
                console.error('Error fetching customer for invoice:', userErr);
                req.flash('error', 'Unable to load invoice.');
                return res.redirect(redirectPath);
            }

            const customer = userRows && userRows[0] ? userRows[0] : {};

            Order.findItemsByOrderIds([orderId], (itemsErr, itemRows) => {
                if (itemsErr) {
                    console.error('Error fetching items for invoice:', itemsErr);
                    req.flash('error', 'Unable to load invoice.');
                    return res.redirect(redirectPath);
                }

                const items = (itemRows || [])
                    .filter((row) => row.order_id === orderId)
                    .map(normaliseOrderItem);
                const deliveryFee = Number(order.shipping_amount || 0);
                const subtotal = Number(order.subtotal || 0);

                res.render('invoice', {
                    user: sessionUser,
                    order,
                    customer,
                    items,
                    totals: {
                        subtotal: subtotal < 0 ? 0 : Number(subtotal.toFixed(2)),
                        deliveryFee: deliveryFee > 0 ? Number(deliveryFee.toFixed(2)) : 0,
                        total: Number(order.total_amount || order.total || 0).toFixed(2)
                    }
                });
            });
        });
    });
};

module.exports = {
    checkout,
    history,
    listAllDeliveries,
    updateDeliveryDetails,
    invoice
};
