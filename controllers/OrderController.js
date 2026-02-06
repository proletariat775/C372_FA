const Order = require('../models/order');
const Product = require('../models/product');
const User = require('../models/user');
const Coupon = require('../models/coupon');
const OrderReview = require('../models/orderReview');
const refundRequestModel = require('../models/refundRequest');
const couponService = require('../services/couponService');
const bundleService = require('../services/bundleService');
const sustainabilityService = require('../services/sustainabilityService');
const paypalService = require('../services/paypalService');
const stripeService = require('../services/stripe');
const loyaltyService = require('../services/loyaltyService');
const orderStatusService = require('../services/orderStatusService');

const DELIVERY_FEE = 1.5;
const REFUND_WINDOW_DAYS = 14;
const ADMIN_STATUS_FLOW = orderStatusService.ALL_STATUSES;
const PAYMENT_METHODS = [
    { value: 'paypal', label: 'PayPal (Sandbox)' },
    { value: 'stripe', label: 'Stripe (Card)' }
];
const INLINE_PAYMENT_METHODS = [];
const LOYALTY_REDEMPTION_ENABLED = loyaltyService.isRedemptionEnabled();

const normalisePrice = (value) => {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return 0;
    }
    return Number(parsed.toFixed(2));
};

const parseWholePoints = (value) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return 0;
    }
    return parsed;
};

const buildLoyaltyFlashMessage = (earnedPoints, redeemedPoints) => {
    const safeEarned = Math.max(0, Number.parseInt(earnedPoints, 10) || 0);
    const safeRedeemed = Math.max(0, Number.parseInt(redeemedPoints, 10) || 0);

    if (!safeEarned && !safeRedeemed) {
        return null;
    }

    if (safeEarned && safeRedeemed) {
        return `EcoPoints update: redeemed ${safeRedeemed} points and earned ${safeEarned} points.`;
    }

    if (safeEarned) {
        return `You earned ${safeEarned} EcoPoints from this order.`;
    }

    return `You redeemed ${safeRedeemed} EcoPoints on this order.`;
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
        brandId: product.brand_id || product.brandId || null,
        brand: product.brand || product.brand_name || null,
        category: product.category || product.category_name || null,
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
                brand_id: variant.brand_id,
                brand: variant.brand_name,
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

const resolveOrderStatus = (value) => orderStatusService.resolveStatus(value);

const resolvePaymentMethod = (value, allowedValues = PAYMENT_METHODS.map((method) => method.value)) => {
    const selected = String(value || '').trim().toLowerCase();
    return allowedValues.includes(selected) ? selected : null;
};

// FEATURE 1/2: Delivery slot + order notes validation helpers.
const normaliseOrderNotes = (value) => {
    if (!value) {
        return '';
    }
    const trimmed = String(value).trim();
    if (!trimmed) {
        return '';
    }
    return trimmed.slice(0, 200);
};

const clearBundleIfEmpty = (req) => {
    if (!req.session || (req.session.cart && req.session.cart.length > 0)) {
        return;
    }
    if (req.session.bundleDefinitions) {
        delete req.session.bundleDefinitions;
    }
    if (req.session.bundle) {
        delete req.session.bundle;
    }
};

const resolveBaseUrl = (req) => process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;

const buildCheckoutSnapshot = async (req, deliveryMethod, deliveryAddress, orderNotes, loyaltyPointsToRedeemInput = 0) => {
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
    let appliedCoupon = (req.session && req.session.appliedCoupon) || cartContainer.appliedCoupon || null;
    let discountAmount = 0;
    let promoCode = null;
    let couponId = null;

    if (appliedCoupon && subtotal > 0) {
        try {
            const validation = await couponService.validateCoupon(
                appliedCoupon.code,
                req.session.user.id,
                subtotal,
                cart
            );

            if (!validation.valid) {
                delete cartContainer.appliedCoupon;
                if (req.session && req.session.appliedCoupon) {
                    delete req.session.appliedCoupon;
                }
                appliedCoupon = null;
            } else {
                discountAmount = validation.discountAmount;
                promoCode = validation.coupon.code;
                couponId = validation.coupon.id;
                appliedCoupon = couponService.buildAppliedCoupon(validation.coupon, discountAmount);
                cartContainer.appliedCoupon = appliedCoupon;
                if (req.session) {
                    req.session.appliedCoupon = appliedCoupon;
                }
            }
        } catch (error) {
            console.error('Error validating coupon during payment:', error);
            delete cartContainer.appliedCoupon;
            if (req.session && req.session.appliedCoupon) {
                delete req.session.appliedCoupon;
            }
            appliedCoupon = null;
        }
    }

    const bundleSource = req.session.bundleDefinitions || req.session.bundle || [];
    const bundleResult = bundleService.calculateBundleDiscount(cart, bundleSource);
    const bundleDiscount = bundleResult.discountAmount;

    const baseTotal = Math.max(0, subtotal - discountAmount - bundleDiscount);
    const resolvedDeliveryMethod = deliveryMethod === 'delivery' ? 'delivery' : 'pickup';
    const resolvedAddress = resolvedDeliveryMethod === 'delivery'
        ? sanitiseDeliveryAddress(deliveryAddress || (req.session.user ? req.session.user.address : null))
        : null;

    if (resolvedDeliveryMethod === 'delivery' && !resolvedAddress) {
        return { error: 'Please provide a delivery address.' };
    }

    // Delivery slot selection removed; ignore any slot inputs.
    const slotValidation = { valid: true, slot: null };

    const rawNotes = orderNotes ? String(orderNotes) : '';
    if (rawNotes && rawNotes.trim().length > 200) {
        return { error: 'Order notes must be 200 characters or fewer.' };
    }
    const safeNotes = normaliseOrderNotes(rawNotes);

    const deliveryFee = computeDeliveryFee(req.session.user, resolvedDeliveryMethod);
    const totalBeforeLoyalty = Number((baseTotal + (resolvedDeliveryMethod === 'delivery' ? deliveryFee : 0)).toFixed(2));

    let loyaltyBalance = 0;
    try {
        loyaltyBalance = await loyaltyService.getBalance(req.session.user.id);
        if (req.session && req.session.user) {
            req.session.user.loyalty_points = loyaltyBalance;
        }
    } catch (error) {
        console.error('Error loading EcoPoints balance for checkout snapshot:', error);
    }

    let loyaltyPointsRequested = 0;
    let loyaltyPointsRedeemed = 0;
    let loyaltyDiscountAmount = 0;

    if (LOYALTY_REDEMPTION_ENABLED) {
        loyaltyPointsRequested = parseWholePoints(loyaltyPointsToRedeemInput);
        const redemption = loyaltyService.calculateRedemption({
            requestedPoints: loyaltyPointsRequested,
            availablePoints: loyaltyBalance,
            maxDiscountableAmount: totalBeforeLoyalty
        });

        // Server-side EcoPoints validation to prevent over-redemption.
        if (!redemption.valid && redemption.requestedPoints > 0) {
            return { error: redemption.message || 'Invalid EcoPoints redemption request.' };
        }

        loyaltyPointsRedeemed = redemption.pointsToRedeem;
        loyaltyDiscountAmount = redemption.discountAmount;
    }

    const total = Number(Math.max(0, totalBeforeLoyalty - loyaltyDiscountAmount).toFixed(2));
    const estimatedPointsToEarn = loyaltyService.calculateEarnPoints(total);

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
        loyaltyBalance,
        loyaltyRedemptionEnabled: LOYALTY_REDEMPTION_ENABLED,
        loyaltyPointsRequested,
        loyaltyPointsRedeemed,
        loyaltyDiscountAmount,
        estimatedPointsToEarn,
        totalBeforeLoyalty,
        deliveryMethod: resolvedDeliveryMethod,
        deliveryAddress: resolvedAddress,
        deliverySlot: slotValidation.slot,
        orderNotes: safeNotes
    };
};

const finalizePaidOrder = (req, snapshot, paymentMethod, paymentMeta = {}) => new Promise((resolve, reject) => {
    const loyaltyDiscountAmount = Number(snapshot.loyaltyDiscountAmount || 0);
    const loyaltyPointsRedeemed = Number(snapshot.loyaltyPointsRedeemed || 0);
    const discountTotal = Number(snapshot.discountAmount || 0) + Number(snapshot.bundleDiscount || 0) + loyaltyDiscountAmount;
    const deliveryFee = snapshot.deliveryMethod === 'delivery' ? Number(snapshot.deliveryFee || 0) : 0;

    Order.create(req.session.user.id, snapshot.cart, {
        shipping_address: snapshot.deliveryMethod === 'delivery' ? snapshot.deliveryAddress : null,
        shipping_amount: deliveryFee,
        discount_amount: discountTotal,
        loyalty_points_redeemed: loyaltyPointsRedeemed,
        loyalty_discount_amount: loyaltyDiscountAmount,
        promo_code: snapshot.promoCode,
        delivery_method: snapshot.deliveryMethod,
        delivery_address: snapshot.deliveryMethod === 'delivery' ? snapshot.deliveryAddress : null,
        delivery_fee: deliveryFee,
        payment_method: paymentMethod,
        payment_status: 'paid',
        status: 'processing',
        delivery_slot_date: snapshot.deliverySlot ? snapshot.deliverySlot.date : null,
        delivery_slot_window: snapshot.deliverySlot ? snapshot.deliverySlot.window : null,
        order_notes: snapshot.orderNotes || null,
        paypal_capture_id: paymentMeta.paypalCaptureId || null,
        stripe_payment_intent_id: paymentMeta.stripePaymentIntentId || null
    }, async (error, result) => {
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

        let loyaltyRedeemResult = { redeemedPoints: 0, balance: null };
        if (loyaltyPointsRedeemed > 0) {
            try {
                loyaltyRedeemResult = await loyaltyService.redeemPointsForOrder({
                    userId: req.session.user.id,
                    orderId: result.orderId,
                    pointsToRedeem: loyaltyPointsRedeemed
                });
            } catch (loyaltyError) {
                // EcoPoints must not block successful order placement/payment completion.
                console.error('Error redeeming EcoPoints:', loyaltyError);
            }
        }

        let loyaltyAwardResult = { awardedPoints: 0, balance: null };
        try {
            // Earning flow: award points from the final paid amount after all discounts.
            loyaltyAwardResult = await loyaltyService.awardPointsForPaidOrder({
                userId: req.session.user.id,
                orderId: result.orderId,
                amountPaid: Number(result.total_amount || snapshot.total || 0),
                paymentStatus: 'paid',
                orderStatus: 'processing'
            });
        } catch (loyaltyError) {
            // EcoPoints are additive-only and should not fail payment flow.
            console.error('Error awarding EcoPoints:', loyaltyError);
        }

        const resolvedBalance = Number.isFinite(loyaltyAwardResult.balance)
            ? loyaltyAwardResult.balance
            : (Number.isFinite(loyaltyRedeemResult.balance) ? loyaltyRedeemResult.balance : null);
        if (req.session.user && Number.isFinite(resolvedBalance)) {
            req.session.user.loyalty_points = resolvedBalance;
        }

        req.session.lastLoyaltyOrder = {
            orderId: result.orderId,
            earnedPoints: Number(loyaltyAwardResult.awardedPoints || 0),
            redeemedPoints: Number(loyaltyRedeemResult.redeemedPoints || loyaltyPointsRedeemed || 0),
            loyaltyDiscountAmount
        };

        req.session.lastOrderSuccess = {
            orderId: result.orderId,
            createdAt: Date.now()
        };

        req.session.cart = [];
        if (req.session.bundleDefinitions) {
            delete req.session.bundleDefinitions;
        }
        if (req.session.bundle) {
            delete req.session.bundle;
        }

        return resolve({
            ...result,
            loyaltyAwardedPoints: Number(loyaltyAwardResult.awardedPoints || 0),
            loyaltyRedeemedPoints: Number(loyaltyRedeemResult.redeemedPoints || loyaltyPointsRedeemed || 0),
            loyaltyDiscountAmount
        });
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
        let appliedCoupon = (req.session && req.session.appliedCoupon) || cartContainer.appliedCoupon || null;
        let discountAmount = 0;

        if (appliedCoupon && subtotal > 0) {
            try {
                const validation = await couponService.validateCoupon(
                    appliedCoupon.code,
                    req.session.user.id,
                    subtotal,
                    cart
                );

                if (!validation.valid) {
                    delete cartContainer.appliedCoupon;
                    if (req.session && req.session.appliedCoupon) {
                        delete req.session.appliedCoupon;
                    }
                    req.flash('error', validation.message || 'Coupon is no longer valid.');
                    appliedCoupon = null;
                } else {
                    discountAmount = validation.discountAmount;
                    appliedCoupon = couponService.buildAppliedCoupon(validation.coupon, discountAmount);
                    cartContainer.appliedCoupon = appliedCoupon;
                    if (req.session) {
                        req.session.appliedCoupon = appliedCoupon;
                    }
                }
            } catch (error) {
                console.error('Error validating coupon during checkout preview:', error);
                delete cartContainer.appliedCoupon;
                if (req.session && req.session.appliedCoupon) {
                    delete req.session.appliedCoupon;
                }
                appliedCoupon = null;
                req.flash('error', 'Unable to validate your coupon right now.');
            }
        }

        const bundleSource = req.session.bundleDefinitions || req.session.bundle || [];
        const bundleResult = bundleService.calculateBundleDiscount(cart, bundleSource);
        const bundleDiscount = bundleResult.discountAmount;

        const baseTotal = Math.max(0, subtotal - discountAmount - bundleDiscount);
        const deliveryFee = computeDeliveryFee(req.session.user, 'delivery');
        let loyaltyBalance = 0;
        try {
            loyaltyBalance = await loyaltyService.getBalance(req.session.user.id);
            if (req.session.user) {
                req.session.user.loyalty_points = loyaltyBalance;
            }
        } catch (loyaltyError) {
            console.error('Error loading EcoPoints balance for checkout page:', loyaltyError);
        }

        const estimatedPointsToEarn = loyaltyService.calculateEarnPoints(baseTotal);
        const impactSummary = sustainabilityService.estimateImpact(cart);

        return res.render('checkout', {
            user: req.session.user,
            cart,
            subtotal,
            discountAmount,
            appliedCoupon,
            bundleDiscount,
            bundleInfo: bundleResult,
            baseTotal,
            deliveryFee,
            loyaltyBalance,
            loyaltyRedemptionEnabled: LOYALTY_REDEMPTION_ENABLED,
            loyaltyDiscountAmount: 0,
            loyaltyPointsToRedeem: 0,
            estimatedPointsToEarn,
            impactSummary,
            paymentMethods: PAYMENT_METHODS,
            selectedPayment: 'paypal',
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
            if (requestedPayment === 'paypal' || requestedPayment === 'stripe') {
                req.flash('error', 'Please complete payment using the PayPal or Stripe button.');
                return res.redirect('/checkout');
            }
            const paymentMethod = resolvePaymentMethod(requestedPayment, INLINE_PAYMENT_METHODS);
            const providedAddress = sanitiseDeliveryAddress(req.body.deliveryAddress) || req.session.user.address;
            const deliveryAddress = deliveryMethod === 'delivery' ? sanitiseDeliveryAddress(providedAddress) : null;

            if (deliveryMethod === 'delivery' && !deliveryAddress) {
                req.flash('error', 'Please provide a delivery address.');
                return res.redirect('/cart');
            }

            // Delivery slot selection removed; keep order notes optional.
            const rawNotes = req.body.orderNotes ? String(req.body.orderNotes) : '';
            if (rawNotes && rawNotes.trim().length > 200) {
                req.flash('error', 'Order notes must be 200 characters or fewer.');
                return res.redirect('/checkout');
            }
            const orderNotes = normaliseOrderNotes(rawNotes);

            if (!paymentMethod) {
                req.flash('error', 'Please select a payment method.');
                return res.redirect('/checkout');
            }

            const deliveryFee = computeDeliveryFee(req.session.user, deliveryMethod);
            const subtotal = couponService.calculateSubtotal(cart);
            const bundleSource = req.session.bundleDefinitions || req.session.bundle || [];
            const bundleResult = bundleService.calculateBundleDiscount(cart, bundleSource);
            const bundleDiscount = bundleResult.discountAmount;

            const cartContainer = ensureSessionCart(req);
            let appliedCoupon = (req.session && req.session.appliedCoupon) || cartContainer.appliedCoupon || null;
            let discountAmount = 0;
            let promoCode = null;
            let couponId = null;
            const requestedLoyaltyPoints = parseWholePoints(req.body.loyaltyPointsToRedeem);

            const createOrderWithLoyalty = () => loyaltyService.getBalance(req.session.user.id)
                .then((loyaltyBalance) => {
                    if (req.session.user) {
                        req.session.user.loyalty_points = loyaltyBalance;
                    }

                    const totalBeforeLoyalty = Number(Math.max(0, subtotal - discountAmount - bundleDiscount) + (deliveryMethod === 'delivery' ? deliveryFee : 0));
                    let loyaltyPointsRedeemed = 0;
                    let loyaltyDiscountAmount = 0;

                    if (LOYALTY_REDEMPTION_ENABLED) {
                        const redemption = loyaltyService.calculateRedemption({
                            requestedPoints: requestedLoyaltyPoints,
                            availablePoints: loyaltyBalance,
                            maxDiscountableAmount: totalBeforeLoyalty
                        });

                        // Server-side validation prevents invalid point redemption requests.
                        if (!redemption.valid && redemption.requestedPoints > 0) {
                            req.flash('error', redemption.message || 'Invalid EcoPoints redemption request.');
                            return res.redirect('/checkout');
                        }

                        loyaltyPointsRedeemed = redemption.pointsToRedeem;
                        loyaltyDiscountAmount = redemption.discountAmount;
                    }

                    return createOrderWithCoupon({
                        req,
                        res,
                        cart,
                        deliveryAddress,
                        deliveryFee,
                        deliveryMethod,
                        paymentMethod,
                        discountAmount: discountAmount + bundleDiscount + loyaltyDiscountAmount,
                        couponDiscount: discountAmount,
                        promoCode,
                        couponId,
                        loyaltyPointsRedeemed,
                        loyaltyDiscountAmount,
                        deliverySlotDate: null,
                        deliverySlotWindow: null,
                        orderNotes
                    });
                })
                .catch((loyaltyError) => {
                    console.error('Error processing EcoPoints redemption during checkout:', loyaltyError);
                    req.flash('error', 'Unable to validate EcoPoints right now.');
                    return res.redirect('/checkout');
                });

            if (appliedCoupon && subtotal > 0) {
                return couponService.validateCoupon(appliedCoupon.code, req.session.user.id, subtotal, cart)
                    .then((validation) => {
                        if (!validation.valid) {
                            delete cartContainer.appliedCoupon;
                            if (req.session && req.session.appliedCoupon) {
                                delete req.session.appliedCoupon;
                            }
                            req.flash('error', validation.message || 'Coupon is no longer valid.');
                            return res.redirect('/cart');
                        }

                        discountAmount = validation.discountAmount;
                        promoCode = validation.coupon.code;
                        couponId = validation.coupon.id;
                        cartContainer.appliedCoupon = couponService.buildAppliedCoupon(validation.coupon, discountAmount);
                        if (req.session) {
                            req.session.appliedCoupon = cartContainer.appliedCoupon;
                        }

                        return createOrderWithLoyalty();
                    })
                    .catch((error) => {
                        console.error('Error validating coupon during checkout:', error);
                        req.flash('error', 'Unable to validate your coupon right now.');
                        return res.redirect('/cart');
                    });
            }

            return createOrderWithLoyalty();
        })
        .catch((error) => {
            console.error('Error validating cart for checkout:', error);
            req.flash('error', 'Unable to validate your cart right now.');
            return res.redirect('/cart');
        });
};

const createOrderWithCoupon = ({
    req,
    res,
    cart,
    deliveryAddress,
    deliveryFee,
    deliveryMethod,
    paymentMethod,
    discountAmount,
    couponDiscount,
    promoCode,
    couponId,
    loyaltyPointsRedeemed = 0,
    loyaltyDiscountAmount = 0,
    deliverySlotDate,
    deliverySlotWindow,
    orderNotes
}) => {
    return Order.create(req.session.user.id, cart, {
        shipping_address: deliveryAddress,
        shipping_amount: deliveryFee,
        discount_amount: discountAmount,
        loyalty_points_redeemed: loyaltyPointsRedeemed,
        loyalty_discount_amount: loyaltyDiscountAmount,
        promo_code: promoCode,
        delivery_method: deliveryMethod,
        delivery_address: deliveryAddress,
        delivery_fee: deliveryFee,
        payment_method: paymentMethod,
        delivery_slot_date: deliverySlotDate,
        delivery_slot_window: deliverySlotWindow,
        order_notes: orderNotes || null
    }, async (error, result) => {
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

        let redeemedPoints = 0;
        if (Number(loyaltyPointsRedeemed) > 0) {
            try {
                const loyaltyResult = await loyaltyService.redeemPointsForOrder({
                    userId: req.session.user.id,
                    orderId: result.orderId,
                    pointsToRedeem: Number(loyaltyPointsRedeemed)
                });
                redeemedPoints = Number(loyaltyResult.redeemedPoints || 0);
                if (req.session.user && Number.isFinite(loyaltyResult.balance)) {
                    req.session.user.loyalty_points = loyaltyResult.balance;
                }
            } catch (loyaltyError) {
                console.error('Error redeeming EcoPoints for direct checkout:', loyaltyError);
            }
        }

        req.session.cart = [];
        if (req.session.bundleDefinitions) {
            delete req.session.bundleDefinitions;
        }
        if (req.session.bundle) {
            delete req.session.bundle;
        }

        req.session.lastOrderSuccess = {
            orderId: result.orderId,
            createdAt: Date.now()
        };

        const loyaltyMessage = buildLoyaltyFlashMessage(0, redeemedPoints || Number(loyaltyPointsRedeemed || 0));
        if (loyaltyMessage) {
            req.flash('success', loyaltyMessage);
        }
        return res.redirect(`/orders/success?orderId=${result.orderId}`);
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

          const orders = (orderRows || []).map((order) => {
            const fallbackMethod = order.shipping_address || order.delivery_address ? 'delivery' : 'pickup';
            const deliveryMethod = order.delivery_method
                ? orderStatusService.resolveDeliveryMethod(order.delivery_method)
                : orderStatusService.resolveDeliveryMethod(fallbackMethod);
            const deliveryAddress = order.delivery_address || order.shipping_address || null;

            return {
                ...order,
                status: orderStatusService.mapLegacyStatus(order.status || 'processing'),
                delivery_method: deliveryMethod,
                delivery_address: deliveryAddress,
                delivery_fee: Number(order.delivery_fee || order.shipping_amount || 0),
                total: Number(order.total_amount || order.total || 0)
            };
        });
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

                const attachRefundStatus = (next) => {
                    if (!orderIds.length) {
                        return next();
                    }
                    refundRequestModel.getLatestByOrderIds(orderIds, isCustomer ? sessionUser.id : null, (refundErr, refundRows = []) => {
                        if (refundErr) {
                            console.error('Error loading refund status for order history:', refundErr);
                        }
                        const refundByOrder = (refundRows || []).reduce((acc, row) => {
                            acc[row.orderId] = {
                                status: row.status,
                                requestId: row.id,
                                requestedAmount: row.requestedAmount,
                                approvedAmount: row.approvedAmount,
                                adminReason: row.adminReason,
                                createdAt: row.createdAt,
                                updatedAt: row.updatedAt
                            };
                            return acc;
                        }, {});
                        orders.forEach((order) => {
                            const refundInfo = refundByOrder[order.id] || {};
                            order.refund_status = refundInfo.status || null;
                            order.refund_request_id = refundInfo.requestId || null;
                            order.refund_requested_amount = refundInfo.requestedAmount || null;
                            order.refund_approved_amount = refundInfo.approvedAmount || null;
                            order.refund_admin_reason = refundInfo.adminReason || null;
                            order.refund_created_at = refundInfo.createdAt || null;
                            order.refund_updated_at = refundInfo.updatedAt || null;
                        });
                        return next();
                    });
                };

                const renderWithLoyalty = (loyaltySummary = {}) => {
                    orders.forEach((order) => {
                        const summary = loyaltySummary[order.id] || {};
                        order.loyalty_points_earned = Number(summary.earnedPoints || 0);
                        order.loyalty_points_redeemed = Number(summary.redeemedPoints || order.loyalty_points_redeemed || 0);
                        order.loyalty_points_net = Number(summary.netPoints || (order.loyalty_points_earned - order.loyalty_points_redeemed));
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
                            refundWindowDays: REFUND_WINDOW_DAYS,
                            messages: req.flash('success'),
                            errors: req.flash('error')
                        });
                    });
                };

                attachRefundStatus(() => {
                    loyaltyService.getOrderPointsSummary({
                        orderIds,
                        userId: isCustomer ? sessionUser.id : null
                    })
                        .then(renderWithLoyalty)
                        .catch((loyaltyErr) => {
                            console.error('Error loading EcoPoints summary for order history:', loyaltyErr);
                            renderWithLoyalty({});
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
    const statusFilterRaw = req.query.status ? String(req.query.status).trim().toLowerCase() : 'all';
    const statusFilter = statusFilterRaw === 'all' ? 'all' : (orderStatusService.resolveStatus(statusFilterRaw) || 'all');
    const methodFilterRaw = req.query.method ? String(req.query.method).trim().toLowerCase() : 'all';
    const methodFilter = methodFilterRaw === 'all'
        ? 'all'
        : (['pickup', 'delivery'].includes(methodFilterRaw) ? orderStatusService.resolveDeliveryMethod(methodFilterRaw) : 'all');
    const searchTerm = req.query.search ? String(req.query.search).trim().toLowerCase() : '';
    const userFilter = req.query.userId ? Number.parseInt(req.query.userId, 10) : null;

    Order.findAllWithUsers((orderErr, orderRows) => {
        if (orderErr) {
            console.error('Error fetching deliveries:', orderErr);
            req.flash('error', 'Unable to load deliveries.');
            return res.redirect('/inventory');
        }

        const orders = (orderRows || []).map((order) => {
            const fallbackMethod = order.shipping_address || order.delivery_address ? 'delivery' : 'pickup';
            const deliveryMethod = order.delivery_method
                ? orderStatusService.resolveDeliveryMethod(order.delivery_method)
                : orderStatusService.resolveDeliveryMethod(fallbackMethod);
            const deliveryAddress = order.delivery_address || order.shipping_address || order.account_address || '';
            const normalizedStatus = orderStatusService.mapLegacyStatus(order.status || 'processing');
            const flow = orderStatusService.getFlowForMethod(deliveryMethod);
            const currentIndex = flow.indexOf(normalizedStatus);
            const allowedStatuses = [];

            if (orderStatusService.isTerminalStatus(normalizedStatus)) {
                allowedStatuses.push(normalizedStatus);
            } else if (currentIndex < 0) {
                allowedStatuses.push(flow[0]);
            } else {
                allowedStatuses.push(normalizedStatus);
                if (currentIndex < flow.length - 1) {
                    allowedStatuses.push(flow[currentIndex + 1]);
                }
            }

              return {
                  ...order,
                  status: normalizedStatus,
                  delivery_method: deliveryMethod,
                  delivery_address: deliveryAddress,
                  total: Number(order.total_amount || order.total || 0),
                  allowed_statuses: allowedStatuses,
                  next_status: orderStatusService.getNextStatus(normalizedStatus, deliveryMethod)
              };
          });

          const kpis = orders.reduce((acc, order) => {
              const statusKey = order.status;
              const paymentKey = order.payment_status ? String(order.payment_status).toLowerCase() : '';
              const isRefunded = paymentKey === 'refunded' || ['cancelled', 'returned'].includes(statusKey);

              if (!['completed', 'cancelled', 'returned'].includes(statusKey)) {
                  acc.openOrders += 1;
              }
              if (statusKey === 'packing') {
                  acc.pendingPacking += 1;
              }
              if (order.delivery_method === 'pickup' && statusKey === 'ready_for_pickup') {
                  acc.awaitingFulfilment += 1;
              }
              if (order.delivery_method === 'delivery' && statusKey === 'shipped') {
                  acc.awaitingFulfilment += 1;
              }
              if (isRefunded) {
                  acc.refundedOrders += 1;
              }
              return acc;
          }, {
              openOrders: 0,
              pendingPacking: 0,
              awaitingFulfilment: 0,
              refundedOrders: 0
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

            refundRequestModel.getLatestByOrderIds(orderIds, null, (refundErr, refundRows = []) => {
                if (refundErr) {
                    console.error('Error loading refund status for admin deliveries:', refundErr);
                }
                const refundByOrder = (refundRows || []).reduce((acc, row) => {
                    acc[row.orderId] = {
                        status: row.status,
                        requestId: row.id,
                        requestedAmount: row.requestedAmount,
                        approvedAmount: row.approvedAmount,
                        adminReason: row.adminReason,
                        createdAt: row.createdAt,
                        updatedAt: row.updatedAt
                    };
                    return acc;
                }, {});
                filteredOrders.forEach((order) => {
                    const refundInfo = refundByOrder[order.id] || {};
                    order.refund_status = refundInfo.status || null;
                    order.refund_request_id = refundInfo.requestId || null;
                    order.refund_requested_amount = refundInfo.requestedAmount || null;
                    order.refund_approved_amount = refundInfo.approvedAmount || null;
                    order.refund_admin_reason = refundInfo.adminReason || null;
                    order.refund_created_at = refundInfo.createdAt || null;
                    order.refund_updated_at = refundInfo.updatedAt || null;
                });

                  res.render('adminDeliveries', {
                      user: req.session.user,
                      orders: filteredOrders,
                      orderItems: itemsByOrder,
                      kpis,
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
    if (status === 'cancelled' || status === 'returned') {
        req.flash('error', 'Cancelled/returned status can only be set by the refund process.');
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
    const deliveryMethodInput = req.body.deliveryMethod ? String(req.body.deliveryMethod) : null;
    const deliveryAddress = sanitiseDeliveryAddress(req.body.deliveryAddress);

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
        const currentStatus = orderStatusService.mapLegacyStatus(order.status || 'processing');
        const currentMethod = order.delivery_method
            ? orderStatusService.resolveDeliveryMethod(order.delivery_method)
            : orderStatusService.resolveDeliveryMethod(order.shipping_address ? 'delivery' : 'pickup');
        const effectiveMethod = deliveryMethodInput
            ? orderStatusService.resolveDeliveryMethod(deliveryMethodInput)
            : currentMethod;

        if (effectiveMethod === 'delivery' && !deliveryAddress) {
            req.flash('error', 'Delivery address is required for delivery orders.');
            return res.redirect('/admin/deliveries');
        }

        if (orderStatusService.isTerminalStatus(currentStatus)) {
            req.flash('error', 'Completed/cancelled/returned orders are locked from further edits.');
            return res.redirect('/admin/deliveries');
        }

        if (!orderStatusService.canTransition(currentStatus, status, effectiveMethod)) {
            req.flash('error', 'Order status updates must follow the next stage in sequence.');
            return res.redirect('/admin/deliveries');
        }

        if (['ready_for_pickup', 'shipped', 'delivered'].includes(status) && !estDeliveryDate) {
            req.flash('error', 'Estimated delivery/pickup date is required for this status.');
            return res.redirect('/admin/deliveries');
        }

        if (status === 'shipped') {
            if (effectiveMethod !== 'delivery') {
                req.flash('error', 'Pickup orders cannot be marked as shipped.');
                return res.redirect('/admin/deliveries');
            }
            if (!shippingProvider || !trackingNumber) {
                req.flash('error', 'Shipping provider and tracking number are required to mark as shipped.');
                return res.redirect('/admin/deliveries');
            }
        }

        if (status === 'delivered') {
            if (effectiveMethod !== 'delivery') {
                req.flash('error', 'Pickup orders cannot be marked as delivered.');
                return res.redirect('/admin/deliveries');
            }
            if (!shippingProvider || !trackingNumber) {
                req.flash('error', 'Shipping provider and tracking number are required to mark as delivered.');
                return res.redirect('/admin/deliveries');
            }
        }

        if (status === 'ready_for_pickup' && effectiveMethod !== 'pickup') {
            req.flash('error', 'Delivery orders cannot be marked as ready for pickup.');
            return res.redirect('/admin/deliveries');
        }

        User.findById(order.user_id, (userErr, userRows) => {
            if (userErr) {
                console.error('Error fetching user for admin update:', userErr);
                req.flash('error', 'Unable to update order.');
                return res.redirect('/admin/deliveries');
            }

            const account = userRows && userRows[0] ? userRows[0] : null;
            const deliveryFee = computeDeliveryFee(account, effectiveMethod);
            const shippingAddress = effectiveMethod === 'delivery' ? deliveryAddress : null;
            const completedAt = status === 'completed' && !order.completed_at ? new Date() : null;

            Order.updateDelivery(orderId, {
                shipping_address: shippingAddress,
                shipping_amount: deliveryFee,
                delivery_method: effectiveMethod,
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
                    admin_notes: adminNotes,
                    completed_at: completedAt
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
        const orderNotes = req.body.orderNotes ? String(req.body.orderNotes) : '';
        const loyaltyPointsToRedeem = req.body.loyaltyPointsToRedeem;
        // Delivery slot input removed; keep the payload minimal.
        const snapshot = await buildCheckoutSnapshot(req, deliveryMethod, deliveryAddress, orderNotes, loyaltyPointsToRedeem);

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
        if (req.session && req.session.pendingPayment) {
            delete req.session.pendingPayment;
        }
        return res.status(400).json({
            success: false,
            message: 'PayPal session expired. Please try again.',
            redirect: '/orders/failed?reason=paypal_expired'
        });
    }

    try {
        const capture = await paypalService.captureOrder(orderId);
        const captureStatus = capture.status || (capture.purchase_units && capture.purchase_units[0] && capture.purchase_units[0].payments && capture.purchase_units[0].payments.captures && capture.purchase_units[0].payments.captures[0] && capture.purchase_units[0].payments.captures[0].status);
        if (captureStatus !== 'COMPLETED') {
            if (req.session && req.session.pendingPayment) {
                delete req.session.pendingPayment;
            }
            return res.status(400).json({
                success: false,
                message: 'PayPal payment was not completed.',
                redirect: '/orders/failed?reason=paypal_failed'
            });
        }

        const payments = capture.purchase_units
            && capture.purchase_units[0]
            && capture.purchase_units[0].payments
            ? capture.purchase_units[0].payments
            : null;

        const captureId = payments
            && payments.captures
            && payments.captures[0]
            && payments.captures[0].id
            ? payments.captures[0].id
            : (payments && payments.authorizations && payments.authorizations[0] && payments.authorizations[0].id
                ? payments.authorizations[0].id
                : null);

        if (!captureId) {
            if (req.session && req.session.pendingPayment) {
                delete req.session.pendingPayment;
            }
            return res.status(400).json({
                success: false,
                message: 'PayPal capture ID missing.',
                redirect: '/orders/failed?reason=paypal_error'
            });
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
            if (req.session && req.session.pendingPayment) {
                delete req.session.pendingPayment;
            }
            return res.status(400).json({
                success: false,
                message: 'Captured amount does not match order total.',
                redirect: '/orders/failed?reason=paypal_error'
            });
        }

        const finalized = await finalizePaidOrder(req, pending.snapshot, 'paypal', { paypalCaptureId: captureId });
        delete req.session.pendingPayment;

        const loyaltyMessage = buildLoyaltyFlashMessage(finalized.loyaltyAwardedPoints, finalized.loyaltyRedeemedPoints);
        if (loyaltyMessage) {
            req.flash('success', loyaltyMessage);
        }

        return res.json({ success: true, redirect: `/orders/success?orderId=${finalized.orderId}` });
    } catch (error) {
        console.error('Error capturing PayPal order:', error);
        if (req.session && req.session.pendingPayment) {
            delete req.session.pendingPayment;
        }
        return res.status(500).json({
            success: false,
            message: 'Unable to capture PayPal payment.',
            redirect: '/orders/failed?reason=paypal_error'
        });
    }
};

const createStripeSession = async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'customer') {
        return res.status(403).json({ success: false, message: 'Only shoppers can complete payment.' });
    }

    try {
        const deliveryMethod = req.body.deliveryMethod === 'delivery' ? 'delivery' : 'pickup';
        const deliveryAddress = req.body.deliveryAddress ? String(req.body.deliveryAddress).trim() : '';
        const orderNotes = req.body.orderNotes ? String(req.body.orderNotes) : '';
        const loyaltyPointsToRedeem = req.body.loyaltyPointsToRedeem;
        const snapshot = await buildCheckoutSnapshot(req, deliveryMethod, deliveryAddress, orderNotes, loyaltyPointsToRedeem);

        if (snapshot.error) {
            return res.status(400).json({ success: false, message: snapshot.error, issues: snapshot.issues || [] });
        }

        const baseUrl = resolveBaseUrl(req);
        const session = await stripeService.createCheckoutSession({
            amount: snapshot.total,
            currency: 'USD',
            description: 'Shirt Shop Order',
            successUrl: `${baseUrl}/payments/stripe/success`,
            cancelUrl: `${baseUrl}/payments/stripe/cancel`,
            metadata: { userId: req.session.user.id }
        });

        req.session.pendingPayment = {
            method: 'stripe',
            stripeSessionId: session.id,
            snapshot,
            createdAt: Date.now()
        };

        return res.json({ success: true, url: session.url });
    } catch (error) {
        console.error('Error creating Stripe session:', error);
        return res.status(500).json({ success: false, message: 'Unable to start Stripe checkout.' });
    }
};

const stripeSuccess = async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'customer') {
        req.flash('error', 'Only shoppers can complete payment.');
        return res.redirect('/checkout');
    }

    const sessionId = String(req.query.session_id || '').trim();
    const pending = req.session.pendingPayment;

    if (!sessionId || !pending || pending.method !== 'stripe' || pending.stripeSessionId !== sessionId) {
        if (req.session && req.session.pendingPayment) {
            delete req.session.pendingPayment;
        }
        return res.redirect('/orders/failed?reason=stripe_expired');
    }

    try {
        const session = await stripeService.retrieveCheckoutSession(sessionId);
        const paymentStatus = String(session.payment_status || '').toLowerCase();
        const isPaid = paymentStatus === 'paid' || session.status === 'complete';

        if (!isPaid) {
            if (req.session && req.session.pendingPayment) {
                delete req.session.pendingPayment;
            }
            return res.redirect('/orders/failed?reason=stripe_failed');
        }

        const finalized = await finalizePaidOrder(req, pending.snapshot, 'stripe', {
            stripePaymentIntentId: session.payment_intent || null
        });
        delete req.session.pendingPayment;
        const loyaltyMessage = buildLoyaltyFlashMessage(finalized.loyaltyAwardedPoints, finalized.loyaltyRedeemedPoints);
        if (loyaltyMessage) {
            req.flash('success', loyaltyMessage);
        }
        return res.redirect(`/orders/success?orderId=${finalized.orderId}`);
    } catch (error) {
        console.error('Error verifying Stripe payment:', error);
        if (req.session && req.session.pendingPayment) {
            delete req.session.pendingPayment;
        }
        return res.redirect('/orders/failed?reason=stripe_failed');
    }
};

const stripeCancel = (req, res) => {
    if (req.session && req.session.pendingPayment) {
        delete req.session.pendingPayment;
    }
    return res.redirect('/orders/failed?reason=stripe_cancel');
};

const orderSuccess = (req, res) => {
    if (!req.session.user || req.session.user.role !== 'customer') {
        req.flash('error', 'Only shoppers can view this page.');
        return res.redirect('/login');
    }

    const sessionUser = req.session.user;
    const orderId = Number.parseInt(req.query.orderId || (req.session.lastOrderSuccess && req.session.lastOrderSuccess.orderId), 10);
    if (!Number.isFinite(orderId)) {
        req.flash('error', 'Order not found.');
        return res.redirect('/shopping');
    }

    Order.findById(orderId, (orderErr, orderRows) => {
        if (orderErr) {
            console.error('Error fetching order for success page:', orderErr);
            req.flash('error', 'Unable to load order confirmation.');
            return res.redirect('/shopping');
        }

        if (!orderRows || !orderRows.length) {
            req.flash('error', 'Order not found.');
            return res.redirect('/shopping');
        }

        const order = orderRows[0];
        if (order.user_id !== sessionUser.id) {
            req.flash('error', 'You are not authorised to view this order.');
            return res.redirect('/shopping');
        }

        Order.findItemsByOrderIds([orderId], (itemsErr, itemRows) => {
            if (itemsErr) {
                console.error('Error fetching order items for success page:', itemsErr);
                req.flash('error', 'Unable to load order confirmation.');
                return res.redirect('/shopping');
            }

            const items = (itemRows || []).map(normaliseOrderItem);
            const impactSummary = sustainabilityService.estimateImpact(items);
            const deliveryFee = Number(order.shipping_amount || order.delivery_fee || 0);
            const discountAmount = Number(order.discount_amount || 0);
            const totals = {
                subtotal: Number(order.subtotal || 0),
                discount: discountAmount,
                delivery: deliveryFee,
                total: Number(order.total_amount || order.total || 0)
            };

            loyaltyService.getOrderPointsSummary({
                orderIds: [orderId],
                userId: sessionUser.id
            })
                .then((summary) => {
                    const orderSummary = summary && summary[orderId] ? summary[orderId] : {};
                    const earnedPoints = Number(orderSummary.earnedPoints || 0);
                    const redeemedPoints = Number(orderSummary.redeemedPoints || 0);

                    res.render('orderSuccess', {
                        user: sessionUser,
                        order,
                        items,
                        totals,
                        impactSummary,
                        earnedPoints,
                        redeemedPoints,
                        messages: req.flash('success'),
                        errors: req.flash('error')
                    });
                })
                .catch((loyaltyErr) => {
                    console.error('Error loading EcoPoints summary for success page:', loyaltyErr);
                    res.render('orderSuccess', {
                        user: sessionUser,
                        order,
                        items,
                        totals,
                        impactSummary,
                        earnedPoints: 0,
                        redeemedPoints: 0,
                        messages: req.flash('success'),
                        errors: req.flash('error')
                    });
                });
        });
    });
};

const orderFailed = (req, res) => {
    if (!req.session.user || req.session.user.role !== 'customer') {
        return res.redirect('/login');
    }

    if (req.session && req.session.pendingPayment) {
        delete req.session.pendingPayment;
    }

    const reasonKey = String(req.query.reason || '').trim().toLowerCase();
    const reasonMap = {
        paypal_cancel: 'PayPal payment was cancelled.',
        paypal_failed: 'PayPal payment was not completed.',
        paypal_error: 'PayPal payment could not be confirmed.',
        paypal_expired: 'PayPal session expired. Please try again.',
        stripe_cancel: 'Stripe payment was cancelled.',
        stripe_failed: 'Stripe payment was not completed.',
        stripe_expired: 'Stripe session expired. Please try again.'
    };
    const message = reasonMap[reasonKey] || 'Payment was unsuccessful. Please try again.';

    res.render('orderFailed', {
        user: req.session.user,
        message,
        errors: req.flash('error'),
        messages: req.flash('success')
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
                const refundedAmount = Number(order.refunded_amount || 0);
                const statusKey = String(order.status || '').toLowerCase();
                const isRefunded = String(order.payment_status || '').toLowerCase() === 'refunded'
                    || statusKey === 'cancelled'
                    || statusKey === 'returned';
                const refundDate = order.refunded_at || null;
                const netPaid = Math.max(0, Number(order.total_amount || order.total || 0) - refundedAmount);
                const renderInvoice = (loyaltySummary = {}) => {
                    const orderLoyalty = loyaltySummary[orderId] || {};
                    const redeemedPoints = Number(orderLoyalty.redeemedPoints || order.loyalty_points_redeemed || 0);
                    const earnedPoints = Number(orderLoyalty.earnedPoints || 0);
                    const loyaltyDiscountAmount = Number(order.loyalty_discount_amount || (redeemedPoints / 20) || 0);
                    const backLink = isAdmin ? '/admin/deliveries' : `/order/${orderId}`;

                    res.render('invoice', {
                        user: sessionUser,
                        order,
                        customer,
                        items,
                        backLink,
                        loyalty: {
                            redeemedPoints,
                            earnedPoints,
                            loyaltyDiscountAmount
                        },
                        refund: {
                            refundedAmount,
                            refundDate,
                            isRefunded,
                            isPartial: refundedAmount > 0 && !isRefunded
                        },
                        totals: {
                            subtotal: subtotal < 0 ? 0 : Number(subtotal.toFixed(2)),
                            deliveryFee: deliveryFee > 0 ? Number(deliveryFee.toFixed(2)) : 0,
                            total: Number(order.total_amount || order.total || 0).toFixed(2),
                            refundedAmount: Number(refundedAmount.toFixed(2)),
                            netPaid: Number(netPaid.toFixed(2))
                        }
                    });
                };

                loyaltyService.getOrderPointsSummary({
                    orderIds: [orderId],
                    userId: null
                })
                    .then(renderInvoice)
                    .catch((loyaltyErr) => {
                        console.error('Error loading EcoPoints summary for invoice:', loyaltyErr);
                        renderInvoice({});
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
    createStripeSession,
    stripeSuccess,
    stripeCancel,
    orderSuccess,
    orderFailed,
    invoice
};
