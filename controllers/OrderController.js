const Cart = require('../models/cart');
const Order = require('../models/order');
const User = require('../models/user');

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

const loadCartFromDb = (req, callback) => {
    if (!req.session.user) {
        req.session.cart = [];
        return callback(null, []);
    }

    Cart.getItemsWithProducts(req.session.user.id, (err, rows) => {
        if (err) {
            return callback(err);
        }

        const cartItems = (rows || []).map((item) => {
            const decorated = decorateProduct(item);
            return {
                productId: item.product_id,
                product_variant_id: item.product_variant_id,
                variant_size: item.variant_size,
                variant_color: item.variant_color,
                productName: item.productName,
                price: decorated.effectivePrice,
                originalPrice: decorated.price,
                discountPercentage: decorated.discountPercentage,
                offerMessage: decorated.offerMessage,
                hasDiscount: decorated.hasDiscount,
                quantity: item.quantity,
                image: item.image
            };
        });

        req.session.cart = cartItems;
        return callback(null, cartItems);
    });
};

/**
 * Handle checkout and order creation.
 */
const checkout = (req, res) => {
    if (!req.session.user || req.session.user.role !== 'user') {
        req.flash('error', 'Only shoppers can complete checkout.');
        return res.redirect('/cart');
    }

    loadCartFromDb(req, (cartErr, cartItems) => {
        if (cartErr) {
            console.error('Error loading cart for checkout:', cartErr);
            req.flash('error', 'Unable to load your cart right now.');
            return res.redirect('/cart');
        }

        if (!cartItems.length) {
            req.flash('error', 'Your cart is empty.');
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

        Order.create(req.session.user.id, cartItems, { deliveryMethod, deliveryAddress, deliveryFee }, (error) => {
            if (error) {
                console.error('Error during checkout:', error);
                req.flash('error', error.message || 'Unable to complete checkout. Please try again.');
                return res.redirect('/cart');
            }

            Cart.clear(req.session.user.id, (clearErr) => {
                if (clearErr) {
                    console.error('Error clearing cart after checkout:', clearErr);
                }
                req.session.cart = [];
            });

            req.flash('success', `Thanks for your purchase! ${deliveryMethod === 'delivery' ? 'We will deliver your order shortly.' : 'Pickup details will be shared soon.'}`);
            return res.redirect('/orders/history');
        });
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
            delivery_method: order.delivery_method || 'pickup',
            delivery_address: order.delivery_address,
            delivery_fee: Number(order.delivery_fee || 0)
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
                deliveryMethod,
                deliveryAddress: deliveryMethod === 'delivery' ? requestedAddress : null,
                deliveryFee
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
                const deliveryFee = Number(order.delivery_fee || 0);
                const subtotal = Number(order.total || 0) - deliveryFee;

                res.render('invoice', {
                    user: sessionUser,
                    order,
                    customer,
                    items,
                    totals: {
                        subtotal: subtotal < 0 ? 0 : Number(subtotal.toFixed(2)),
                        deliveryFee: deliveryFee > 0 ? Number(deliveryFee.toFixed(2)) : 0,
                        total: Number(order.total || 0).toFixed(2)
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
