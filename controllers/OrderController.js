const Order = require('../models/order');
const Product = require('../models/product');
const User = require('../models/user');
const Coupon = require('../models/coupon');
const OrderReview = require('../models/orderReview');
const couponService = require('../services/couponService');
const sustainabilityService = require('../services/sustainabilityService');
const paypalService = require('../services/paypalService');
const netsQrService = require('../services/netsQrService');

const DELIVERY_FEE = 1.5;
const ADMIN_STATUS_FLOW = ['pending', 'packed', 'shipped', 'delivered', 'completed'];
const PAYMENT_METHODS = [
    { value: 'card', label: 'Credit/Debit Card' },
    { value: 'paypal', label: 'PayPal (Sandbox)' },
    { value: 'nets_qr', label: 'NETS QR' },
    { value: 'ewallet', label: 'E-Wallet' }
];
const INLINE_PAYMENT_METHODS = ['card', 'ewallet'];

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

const buildCartItem = (product, variant, quantity) => {
    const basePrice = normalisePrice(product.price);
    const discountPercentage = clampDiscount(product.discountPercentage || product.discount_percent);
    const hasDiscount = discountPercentage > 0;
    const finalPrice = hasDiscount
        ? normalisePrice(basePrice * (1 - discountPercentage / 100))
        : basePrice;

    const variantId = variant && (variant.id || variant.variant_id || variant.variantId)
        ? Number(variant.id || variant.variant_id || variant.variantId)
        : null;
    const size = variant && variant.size ? variant.size : null;

    const cartItem = {
        productId: product.id,
        variantId,
        product_variant_id: variantId,
        size,
        productName: product.productName || product.name,
        price: finalPrice,
        quantity,
        image: product.image || null,
        hasDiscount
    };

    if (hasDiscount) {
        cartItem.originalPrice = basePrice;
        cartItem.discountPercentage = discountPercentage;
        cartItem.offerMessage = normaliseOfferMessage(product.offerMessage || product.description);
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

const fetchVariantById = (variantId) => new Promise((resolve, reject) => {
    Product.getVariantById(variantId, (err, rows) => {
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
        const variantId = Number(item.variantId || item.product_variant_id || item.variant_id);

        if ((!Number.isFinite(productId) && !Number.isFinite(variantId)) || !Number.isFinite(requestedQty)) {
            issues.push('Invalid product detected in cart. It has been removed.');
            changed = true;
            continue;
        }

        if (requestedQty <= 0) {
            issues.push('Invalid quantity detected in cart. The item has been removed.');
            changed = true;
            continue;
        }

        if (Number.isFinite(variantId)) {
            const variant = await fetchVariantById(variantId);
            if (!variant) {
                issues.push('A selected size in your cart is no longer available and was removed.');
                changed = true;
                continue;
            }

            const stock = Number.parseInt(variant.variant_quantity || variant.quantity, 10) || 0;
            if (stock <= 0) {
                issues.push(`"${variant.name}" in size ${variant.size || ''} is out of stock and was removed.`);
                changed = true;
                continue;
            }

            let finalQty = requestedQty;
            if (requestedQty > stock) {
                finalQty = stock;
                issues.push(`"${variant.name}" quantity was reduced to available stock (${stock}).`);
                changed = true;
            }

            const product = {
                id: variant.product_id,
                name: variant.name,
                price: variant.price,
                discount_percent: variant.discount_percent,
                description: variant.description,
                image: variant.image
            };

            const rebuilt = buildCartItem(product, variant, finalQty);
            const previousPrice = Number(item.price);
            if (!Number.isFinite(previousPrice) || Number(previousPrice.toFixed(2)) !== rebuilt.price) {
                issues.push(`Price updated for "${variant.name}". Please review before checkout.`);
                changed = true;
            }

            updatedCart.push(rebuilt);
            continue;
        }

        if (!Number.isFinite(productId)) {
            issues.push('Invalid product detected in cart. It has been removed.');
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
            issues.push(`"${product.productName || product.name}" is out of stock and was removed.`);
            changed = true;
            continue;
        }

        let finalQty = requestedQty;
        if (requestedQty > stock) {
            finalQty = stock;
            issues.push(`"${product.productName || product.name}" quantity was reduced to available stock (${stock}).`);
            changed = true;
        }

        const rebuilt = buildCartItem(product, null, finalQty);
        const previousPrice = Number(item.price);
        if (!Number.isFinite(previousPrice) || Number(previousPrice.toFixed(2)) !== rebuilt.price) {
            issues.push(`Price updated for "${product.productName || product.name}". Please review before checkout.`);
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

const resolveOrderStatus = (value) => {
    const selected = String(value || '').trim().toLowerCase();
    return ADMIN_STATUS_FLOW.includes(selected) ? selected : null;
};

const resolvePaymentMethod = (value, allowedValues = PAYMENT_METHODS.map((method) => method.value)) => {
    const selected = String(value || '').trim().toLowerCase();
    return allowedValues.includes(selected) ? selected : null;
};

const calculateBundleDiscount = (cart, bundle) => {
    if (!bundle || !Array.isArray(bundle.productIds) || !bundle.productIds.length) {
        return 0;
    }

    const rate = Number(bundle.discountRate || 0);
    if (!Number.isFinite(rate) || rate <= 0) {
        return 0;
    }

    const idSet = new Set(bundle.productIds.map(id => Number(id)));
    const eligibleTotal = (cart || []).reduce((sum, item) => {
        const productId = Number(item.productId);
        if (!idSet.has(productId)) {
            return sum;
        }
        const price = Number(item.price);
        const qty = Number(item.quantity);
        if (!Number.isFinite(price) || !Number.isFinite(qty)) {
            return sum;
        }
        return sum + (price * qty);
    }, 0);

    if (!eligibleTotal) {
        return 0;
    }

    return Number((eligibleTotal * rate).toFixed(2));
};

const clearBundleIfEmpty = (req) => {
    if (req.session && req.session.bundle && (!req.session.cart || req.session.cart.length === 0)) {
        delete req.session.bundle;
    }
};

const resolveBaseUrl = (req) => process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;

const buildCheckoutSnapshot = async (req, deliveryMethod, deliveryAddress) => {
    const { cart, changed, issues } = await validateCartForCheckout(req);
    if (!cart.length) {
        clearBundleIfEmpty(req);
        return { error: 'Your cart is empty.' };
    }

    if (changed) {
        return { error: 'We updated your cart based on the latest stock and pricing. Please review your cart.' };
    }

    if (issues.length) {
        return { error: issues[0] || 'Please review your cart before checkout.', issues };
    }

    const subtotal = couponService.calculateSubtotal(cart);
    const cartContainer = ensureSessionCart(req);
    let appliedCoupon = cartContainer.appliedCoupon || null;
    let discountAmount = 0;
    let promoCode = null;
    let couponId = null;

    if (appliedCoupon && subtotal > 0) {
        try {
            const validation = await couponService.validateCoupon(
                appliedCoupon.code,
                req.session.user.id,
                subtotal
            );

            if (!validation.valid) {
                delete cartContainer.appliedCoupon;
                appliedCoupon = null;
            } else {
                discountAmount = validation.discountAmount;
                promoCode = validation.coupon.code;
                couponId = validation.coupon.id;
                appliedCoupon = couponService.buildAppliedCoupon(validation.coupon, discountAmount);
                cartContainer.appliedCoupon = appliedCoupon;
            }
        } catch (error) {
            console.error('Error validating coupon during payment:', error);
            delete cartContainer.appliedCoupon;
            appliedCoupon = null;
        }
    }

    const bundleDiscount = calculateBundleDiscount(cart, req.session.bundle);
    if (!bundleDiscount && req.session.bundle) {
        delete req.session.bundle;
    }

    const baseTotal = Math.max(0, subtotal - discountAmount - bundleDiscount);
    const resolvedDeliveryMethod = deliveryMethod === 'delivery' ? 'delivery' : 'pickup';
    const resolvedAddress = resolvedDeliveryMethod === 'delivery'
        ? sanitiseDeliveryAddress(deliveryAddress || (req.session.user ? req.session.user.address : null))
        : null;

    if (resolvedDeliveryMethod === 'delivery' && !resolvedAddress) {
        return { error: 'Please provide a delivery address.' };
    }

    const deliveryFee = computeDeliveryFee(req.session.user, resolvedDeliveryMethod);
    const total = Number((baseTotal + (resolvedDeliveryMethod === 'delivery' ? deliveryFee : 0)).toFixed(2));

    return {
        cart: cart.map(item => ({ ...item })),
        subtotal,
        discountAmount,
        bundleDiscount,
        baseTotal,
        deliveryFee,
        total,
        appliedCoupon,
        promoCode,
        couponId,
        couponDiscount: discountAmount,
        deliveryMethod: resolvedDeliveryMethod,
        deliveryAddress: resolvedAddress
    };
};

const finalizePaidOrder = (req, snapshot, paymentMethod) => new Promise((resolve, reject) => {
    const discountTotal = Number(snapshot.discountAmount || 0) + Number(snapshot.bundleDiscount || 0);
    const deliveryFee = snapshot.deliveryMethod === 'delivery' ? Number(snapshot.deliveryFee || 0) : 0;

    Order.create(req.session.user.id, snapshot.cart, {
        shipping_address: snapshot.deliveryMethod === 'delivery' ? snapshot.deliveryAddress : null,
        shipping_amount: deliveryFee,
        discount_amount: discountTotal,
        promo_code: snapshot.promoCode,
        delivery_method: snapshot.deliveryMethod,
        delivery_address: snapshot.deliveryMethod === 'delivery' ? snapshot.deliveryAddress : null,
        delivery_fee: deliveryFee,
        payment_method: paymentMethod,
        payment_status: 'paid',
        status: 'processing'
    }, (error, result) => {
        if (error) {
            return reject(error);
        }

        const appliedCouponDiscount = Number(snapshot.couponDiscount || 0);
        if (snapshot.couponId && appliedCouponDiscount > 0) {
            Coupon.recordUsage(snapshot.couponId, req.session.user.id, result.orderId, appliedCouponDiscount, (usageErr) => {
                if (usageErr) {
                    console.error('Error recording coupon usage:', usageErr);
                }
            });

            Coupon.incrementUsage(snapshot.couponId, (usageErr) => {
                if (usageErr) {
                    console.error('Error incrementing coupon usage count:', usageErr);
                }
            });
        }

        req.session.cart = [];
        if (req.session.bundle) {
            delete req.session.bundle;
        }

        return resolve(result);
    });
});

/**
 * Display checkout page before order creation.
 */
const showCheckout = async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'customer') {
        req.flash('error', 'Only shoppers can complete checkout.');
        return res.redirect('/cart');
    }

    try {
        const { cart, changed, issues } = await validateCartForCheckout(req);
        if (!cart.length) {
            clearBundleIfEmpty(req);
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

        const subtotal = couponService.calculateSubtotal(cart);
        const cartContainer = ensureSessionCart(req);
        let appliedCoupon = cartContainer.appliedCoupon || null;
        let discountAmount = 0;

        if (appliedCoupon && subtotal > 0) {
            try {
                const validation = await couponService.validateCoupon(
                    appliedCoupon.code,
                    req.session.user.id,
                    subtotal
                );

                if (!validation.valid) {
                    delete cartContainer.appliedCoupon;
                    req.flash('error', validation.message || 'Coupon is no longer valid.');
                    appliedCoupon = null;
                } else {
                    discountAmount = validation.discountAmount;
                    appliedCoupon = couponService.buildAppliedCoupon(validation.coupon, discountAmount);
                    cartContainer.appliedCoupon = appliedCoupon;
                }
            } catch (error) {
                console.error('Error validating coupon during checkout preview:', error);
                delete cartContainer.appliedCoupon;
                appliedCoupon = null;
                req.flash('error', 'Unable to validate your coupon right now.');
            }
        }

        const bundleDiscount = calculateBundleDiscount(cart, req.session.bundle);
        if (!bundleDiscount && req.session.bundle) {
            delete req.session.bundle;
        }

        const baseTotal = Math.max(0, subtotal - discountAmount - bundleDiscount);
        const deliveryFee = computeDeliveryFee(req.session.user, 'delivery');
        const impactSummary = sustainabilityService.estimateImpact(cart);

        return res.render('checkout', {
            user: req.session.user,
            cart,
            subtotal,
            discountAmount,
            appliedCoupon,
            bundleDiscount,
            bundleInfo: req.session.bundle || null,
            baseTotal,
            deliveryFee,
            impactSummary,
            paymentMethods: PAYMENT_METHODS,
            selectedPayment: 'card',
            messages: req.flash('success'),
            errors: req.flash('error')
        });
    } catch (error) {
        console.error('Error preparing checkout:', error);
        req.flash('error', 'Unable to load checkout right now.');
        return res.redirect('/cart');
    }
};

/**
 * Handle checkout and order creation.
 */
const checkout = (req, res) => {
    if (!req.session.user || req.session.user.role !== 'customer') {
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
            const requestedPayment = String(req.body.paymentMethod || '').trim().toLowerCase();
            if (requestedPayment === 'paypal' || requestedPayment === 'nets_qr') {
                req.flash('error', 'Please complete payment using the PayPal or NETS QR button.');
                return res.redirect('/checkout');
            }
            const paymentMethod = resolvePaymentMethod(requestedPayment, INLINE_PAYMENT_METHODS);
            const providedAddress = sanitiseDeliveryAddress(req.body.deliveryAddress) || req.session.user.address;
            const deliveryAddress = deliveryMethod === 'delivery' ? sanitiseDeliveryAddress(providedAddress) : null;

            if (deliveryMethod === 'delivery' && !deliveryAddress) {
                req.flash('error', 'Please provide a delivery address.');
                return res.redirect('/cart');
            }

            if (!paymentMethod) {
                req.flash('error', 'Please select a payment method.');
                return res.redirect('/checkout');
            }

            const deliveryFee = computeDeliveryFee(req.session.user, deliveryMethod);
            const subtotal = couponService.calculateSubtotal(cart);
            const bundleDiscount = calculateBundleDiscount(cart, req.session.bundle);
            if (!bundleDiscount && req.session.bundle) {
                delete req.session.bundle;
            }

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
                            deliveryMethod,
                            paymentMethod,
                            discountAmount: discountAmount + bundleDiscount,
                            couponDiscount: discountAmount,
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
                deliveryMethod,
                paymentMethod,
                discountAmount: discountAmount + bundleDiscount,
                couponDiscount: discountAmount,
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

const createOrderWithCoupon = ({ req, res, cart, deliveryAddress, deliveryFee, deliveryMethod, paymentMethod, discountAmount, couponDiscount, promoCode, couponId }) => {
    return Order.create(req.session.user.id, cart, {
        shipping_address: deliveryAddress,
        shipping_amount: deliveryFee,
        discount_amount: discountAmount,
        promo_code: promoCode,
        delivery_method: deliveryMethod,
        delivery_address: deliveryAddress,
        delivery_fee: deliveryFee,
        payment_method: paymentMethod
    }, (error, result) => {
        if (error) {
            console.error('Error during checkout:', error);
            req.flash('error', error.message || 'Unable to complete checkout. Please try again.');
            return res.redirect('/cart');
        }

        const appliedCouponDiscount = Number(couponDiscount || 0);
        if (couponId && appliedCouponDiscount > 0) {
            Coupon.recordUsage(couponId, req.session.user.id, result.orderId, appliedCouponDiscount, (usageErr) => {
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
        if (req.session.bundle) {
            delete req.session.bundle;
        }
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
    const isCustomer = sessionUser && sessionUser.role === 'customer';
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

            const normalisedItems = (itemRows || []).map(normaliseOrderItem);
            normalisedItems.forEach((item) => {
                if (!itemsByOrder[item.order_id]) {
                    itemsByOrder[item.order_id] = [];
                }
                itemsByOrder[item.order_id].push(item);
            });

            const itemIds = normalisedItems.map(item => item.id).filter(Boolean);

            const renderHistory = (reviewRows) => {
                const reviewByItem = (reviewRows || []).reduce((acc, review) => {
                    acc[review.order_item_id] = review;
                    return acc;
                }, {});

                if (isCustomer) {
                    Object.values(itemsByOrder).forEach((items) => {
                        items.forEach((item) => {
                            item.review = reviewByItem[item.id] || null;
                        });
                    });
                }

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
            };

            if (!isCustomer || itemIds.length === 0) {
                return renderHistory([]);
            }

            return OrderReview.findByUserAndOrderItems(sessionUser.id, itemIds, (reviewErr, reviewRows) => {
                if (reviewErr) {
                    console.error('Error fetching existing reviews:', reviewErr);
                    return renderHistory([]);
                }
                return renderHistory(reviewRows);
            });
        });
    });
};

const listAllDeliveries = (req, res) => {
    const statusFilter = req.query.status ? String(req.query.status).trim().toLowerCase() : 'all';
    const methodFilter = req.query.method ? String(req.query.method).trim().toLowerCase() : 'all';
    const searchTerm = req.query.search ? String(req.query.search).trim().toLowerCase() : '';
    const userFilter = req.query.userId ? Number.parseInt(req.query.userId, 10) : null;

    Order.findAllWithUsers((orderErr, orderRows) => {
        if (orderErr) {
            console.error('Error fetching deliveries:', orderErr);
            req.flash('error', 'Unable to load deliveries.');
            return res.redirect('/inventory');
        }

        const orders = (orderRows || []).map((order) => {
            const deliveryMethod = order.delivery_method
                ? String(order.delivery_method).toLowerCase()
                : (order.shipping_address ? 'delivery' : 'pickup');
            const deliveryAddress = order.delivery_address || order.shipping_address || order.account_address || '';
            return {
                ...order,
                status: order.status || 'pending',
                delivery_method: deliveryMethod,
                delivery_address: deliveryAddress,
                total: Number(order.total_amount || order.total || 0)
            };
        });

        const filteredOrders = orders.filter((order) => {
            if (Number.isFinite(userFilter) && Number(order.user_id) !== userFilter) {
                return false;
            }
            if (statusFilter !== 'all' && order.status !== statusFilter) {
                return false;
            }
            if (methodFilter !== 'all' && order.delivery_method !== methodFilter) {
                return false;
            }
            if (searchTerm) {
                const haystack = [
                    String(order.id || ''),
                    String(order.order_number || ''),
                    String(order.username || ''),
                    String(order.email || '')
                ].join(' ').toLowerCase();
                if (!haystack.includes(searchTerm)) {
                    return false;
                }
            }
            return true;
        });

        const orderIds = filteredOrders.map(order => order.id);

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
                orders: filteredOrders,
                orderItems: itemsByOrder,
                filters: {
                    status: statusFilter,
                    method: methodFilter,
                    search: searchTerm,
                    userId: Number.isFinite(userFilter) ? userFilter : ''
                },
                statusOptions: ADMIN_STATUS_FLOW,
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
                shipping_amount: deliveryFee,
                delivery_method: deliveryMethod,
                delivery_address: deliveryMethod === 'delivery' ? requestedAddress : null,
                delivery_fee: deliveryFee
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

const updateAdminOrder = (req, res) => {
    const orderId = parseInt(req.params.id, 10);
    if (!Number.isFinite(orderId)) {
        req.flash('error', 'Invalid order selected.');
        return res.redirect('/admin/deliveries');
    }

    const status = resolveOrderStatus(req.body.status);
    if (!status) {
        req.flash('error', 'Please select a valid order status.');
        return res.redirect('/admin/deliveries');
    }

    const shippingProvider = req.body.shippingProvider ? String(req.body.shippingProvider).trim().slice(0, 120) : null;
    const trackingNumber = req.body.trackingNumber ? String(req.body.trackingNumber).trim() : null;
    if (trackingNumber && trackingNumber.length > 80) {
        req.flash('error', 'Tracking number must be 80 characters or fewer.');
        return res.redirect('/admin/deliveries');
    }

    let estDeliveryDate = req.body.estDeliveryDate ? String(req.body.estDeliveryDate).trim() : null;
    if (estDeliveryDate) {
        const dateValue = new Date(estDeliveryDate);
        if (Number.isNaN(dateValue.getTime())) {
            req.flash('error', 'Estimated delivery date is invalid.');
            return res.redirect('/admin/deliveries');
        }
        estDeliveryDate = estDeliveryDate.slice(0, 10);
    }

    const adminNotes = req.body.adminNotes ? String(req.body.adminNotes).trim().slice(0, 1000) : null;
    const deliveryMethod = req.body.deliveryMethod === 'delivery' ? 'delivery' : 'pickup';
    const deliveryAddress = sanitiseDeliveryAddress(req.body.deliveryAddress);

    if (deliveryMethod === 'delivery' && !deliveryAddress) {
        req.flash('error', 'Delivery address is required for delivery orders.');
        return res.redirect('/admin/deliveries');
    }

    Order.findById(orderId, (orderErr, orderRows) => {
        if (orderErr) {
            console.error('Error fetching order for admin update:', orderErr);
            req.flash('error', 'Unable to update order.');
            return res.redirect('/admin/deliveries');
        }

        if (!orderRows || !orderRows.length) {
            req.flash('error', 'Order not found.');
            return res.redirect('/admin/deliveries');
        }

        const order = orderRows[0];
        if (order.status === 'completed') {
            req.flash('error', 'Completed orders are locked from further edits.');
            return res.redirect('/admin/deliveries');
        }

        User.findById(order.user_id, (userErr, userRows) => {
            if (userErr) {
                console.error('Error fetching user for admin update:', userErr);
                req.flash('error', 'Unable to update order.');
                return res.redirect('/admin/deliveries');
            }

            const account = userRows && userRows[0] ? userRows[0] : null;
            const deliveryFee = computeDeliveryFee(account, deliveryMethod);
            const shippingAddress = deliveryMethod === 'delivery' ? deliveryAddress : null;

            Order.updateDelivery(orderId, {
                shipping_address: shippingAddress,
                shipping_amount: deliveryFee,
                delivery_method: deliveryMethod,
                delivery_address: shippingAddress,
                delivery_fee: deliveryFee
            }, (deliveryErr) => {
                if (deliveryErr) {
                    console.error('Error updating delivery info:', deliveryErr);
                    req.flash('error', 'Unable to update delivery details.');
                    return res.redirect('/admin/deliveries');
                }

                Order.updateAdminOrder(orderId, {
                    status,
                    shipping_provider: shippingProvider,
                    tracking_number: trackingNumber,
                    est_delivery_date: estDeliveryDate,
                    admin_notes: adminNotes
                }, (updateErr) => {
                    if (updateErr) {
                        console.error('Error updating admin order info:', updateErr);
                        req.flash('error', 'Unable to update order.');
                        return res.redirect('/admin/deliveries');
                    }

                    req.flash('success', `Order #${orderId} updated successfully.`);
                    return res.redirect('/admin/deliveries');
                });
            });
        });
    });
};

const createPayPalOrder = async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'customer') {
        return res.status(403).json({ success: false, message: 'Only shoppers can complete payment.' });
    }

    try {
        const deliveryMethod = req.body.deliveryMethod === 'delivery' ? 'delivery' : 'pickup';
        const deliveryAddress = req.body.deliveryAddress ? String(req.body.deliveryAddress).trim() : '';
        const snapshot = await buildCheckoutSnapshot(req, deliveryMethod, deliveryAddress);

        if (snapshot.error) {
            return res.status(400).json({ success: false, message: snapshot.error, issues: snapshot.issues || [] });
        }

        const baseUrl = resolveBaseUrl(req);
        const result = await paypalService.createOrder({
            amount: snapshot.total,
            currency: 'USD',
            returnUrl: `${baseUrl}/checkout?paypal=1`,
            cancelUrl: `${baseUrl}/checkout?paypal=cancel`
        });

        if (!result.approvalUrl) {
            return res.status(500).json({ success: false, message: 'Unable to start PayPal checkout.' });
        }

        req.session.pendingPayment = {
            method: 'paypal',
            paypalOrderId: result.id,
            snapshot,
            createdAt: Date.now()
        };

        return res.json({ success: true, approvalUrl: result.approvalUrl, orderId: result.id });
    } catch (error) {
        console.error('Error creating PayPal order:', error);
        return res.status(500).json({ success: false, message: 'Unable to start PayPal checkout.' });
    }
};

const capturePayPalOrder = async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'customer') {
        return res.status(403).json({ success: false, message: 'Only shoppers can complete payment.' });
    }

    const orderId = req.body.orderId ? String(req.body.orderId).trim() : '';
    const pending = req.session.pendingPayment;

    if (!orderId || !pending || pending.method !== 'paypal' || pending.paypalOrderId !== orderId) {
        return res.status(400).json({ success: false, message: 'PayPal session expired. Please try again.' });
    }

    try {
        const capture = await paypalService.captureOrder(orderId);
        const captureStatus = capture.status || (capture.purchase_units && capture.purchase_units[0] && capture.purchase_units[0].payments && capture.purchase_units[0].payments.captures && capture.purchase_units[0].payments.captures[0] && capture.purchase_units[0].payments.captures[0].status);
        if (captureStatus !== 'COMPLETED') {
            return res.status(400).json({ success: false, message: 'PayPal payment was not completed.' });
        }

        const captureAmount = capture.purchase_units
            && capture.purchase_units[0]
            && capture.purchase_units[0].payments
            && capture.purchase_units[0].payments.captures
            && capture.purchase_units[0].payments.captures[0]
            && capture.purchase_units[0].payments.captures[0].amount
            ? Number(capture.purchase_units[0].payments.captures[0].amount.value)
            : null;

        if (Number.isFinite(captureAmount) && captureAmount < pending.snapshot.total) {
            return res.status(400).json({ success: false, message: 'Captured amount does not match order total.' });
        }

        await finalizePaidOrder(req, pending.snapshot, 'paypal');
        delete req.session.pendingPayment;

        return res.json({ success: true, redirect: '/orders/history' });
    } catch (error) {
        console.error('Error capturing PayPal order:', error);
        return res.status(500).json({ success: false, message: 'Unable to capture PayPal payment.' });
    }
};

const createNetsQrPayment = async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'customer') {
        return res.status(403).json({ success: false, message: 'Only shoppers can complete payment.' });
    }

    try {
        const deliveryMethod = req.body.deliveryMethod === 'delivery' ? 'delivery' : 'pickup';
        const deliveryAddress = req.body.deliveryAddress ? String(req.body.deliveryAddress).trim() : '';
        const snapshot = await buildCheckoutSnapshot(req, deliveryMethod, deliveryAddress);

        if (snapshot.error) {
            return res.status(400).json({ success: false, message: snapshot.error, issues: snapshot.issues || [] });
        }

        const payment = await netsQrService.createPayment({
            amount: snapshot.total,
            currency: 'SGD'
        });

        req.session.pendingPayment = {
            method: 'nets_qr',
            netsRef: payment.reference,
            status: 'pending',
            expiresAt: payment.expiresAt,
            snapshot,
            createdAt: Date.now()
        };

        if (payment.qrImageBase64) {
            console.info('NETS QR base64 length:', String(payment.qrImageBase64.length));
        }

        return res.json({
            success: true,
            qrImageBase64: payment.qrImageBase64,
            qrImageDataUrl: payment.qrImageDataUrl,
            qrData: payment.qrData,
            reference: payment.reference,
            amount: payment.amount,
            currency: payment.currency,
            expiresAt: payment.expiresAt
        });
    } catch (error) {
        console.error('Error creating NETS QR payment:', error);
        return res.status(500).json({ success: false, message: 'Unable to generate NETS QR.' });
    }
};

const getNetsQrStatus = (req, res) => {
    if (!req.session.user || req.session.user.role !== 'customer') {
        return res.status(403).json({ success: false, message: 'Only shoppers can view payment status.' });
    }

    const ref = req.query.ref ? String(req.query.ref).trim() : '';
    const pending = req.session.pendingPayment;

    if (!ref || !pending || pending.method !== 'nets_qr' || pending.netsRef !== ref) {
        return res.json({ success: false, status: 'not_found' });
    }

    const now = Date.now();
    if (pending.expiresAt && now > pending.expiresAt) {
        pending.status = 'expired';
    }

    return res.json({ success: true, status: pending.status || 'pending', expiresAt: pending.expiresAt });
};

const finalizeNetsQrPayment = async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'customer') {
        return res.status(403).json({ success: false, message: 'Only shoppers can complete payment.' });
    }

    const ref = req.body.ref ? String(req.body.ref).trim() : '';
    const pending = req.session.pendingPayment;

    if (!ref || !pending || pending.method !== 'nets_qr' || pending.netsRef !== ref) {
        return res.status(400).json({ success: false, message: 'NETS QR session expired. Please try again.' });
    }

    if (pending.expiresAt && Date.now() > pending.expiresAt) {
        pending.status = 'expired';
        return res.status(400).json({ success: false, message: 'NETS QR has expired. Please generate a new code.' });
    }

    if (pending.status === 'paid') {
        return res.json({ success: true, redirect: '/orders/history' });
    }

    try {
        pending.status = 'paid';
        await finalizePaidOrder(req, pending.snapshot, 'nets_qr');
        delete req.session.pendingPayment;
        return res.json({ success: true, redirect: '/orders/history' });
    } catch (error) {
        console.error('Error finalizing NETS QR payment:', error);
        pending.status = 'failed';
        return res.status(500).json({ success: false, message: 'Unable to finalize NETS QR payment.' });
    }
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
    showCheckout,
    checkout,
    history,
    listAllDeliveries,
    updateDeliveryDetails,
    updateAdminOrder,
    createPayPalOrder,
    capturePayPalOrder,
    createNetsQrPayment,
    getNetsQrStatus,
    finalizeNetsQrPayment,
    invoice
};
