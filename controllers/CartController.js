const Product = require('../models/product');
const couponService = require('../services/couponService');
const bundleService = require('../services/bundleService');

const getFlash = (req, type) => {
    if (typeof req.flash !== 'function') {
        return [];
    }
    return req.flash(type);
};

const ensureSessionCart = (req) => {
    if (!Array.isArray(req.session.cart)) {
        req.session.cart = [];
    }
    return req.session.cart;
};

const ensureShopperRole = (req, res) => {
    const shopperRoles = ['customer'];
    if (!req.session.user || !shopperRoles.includes(req.session.user.role)) {
        req.flash('error', 'Access denied.');
        res.redirect('/login');
        return false;
    }
    return true;
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

const toCurrency = (value) => {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return 0;
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
    const basePrice = toCurrency(product.price);
    const discountPercentage = clampDiscount(product.discountPercentage || product.discount_percent);
    const hasDiscount = discountPercentage > 0;
    const finalPrice = hasDiscount
        ? toCurrency(basePrice * (1 - discountPercentage / 100))
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

const findCartItem = (cart, variantId, productId) => {
    if (!Array.isArray(cart)) {
        return null;
    }
    if (Number.isFinite(variantId)) {
        const match = cart.find(item => Number(item.variantId) === Number(variantId));
        if (match) {
            return match;
        }
    }
    if (Number.isFinite(productId)) {
        return cart.find(item => Number(item.productId) === Number(productId));
    }
    return null;
};

const clearAppliedCoupon = (req) => {
    if (!req || !req.session) {
        return;
    }
    if (req.session.appliedCoupon) {
        delete req.session.appliedCoupon;
    }
    if (req.session.cart && req.session.cart.appliedCoupon) {
        delete req.session.cart.appliedCoupon;
    }
};

const setAppliedCoupon = (req, coupon) => {
    if (!req || !req.session) {
        return;
    }
    req.session.appliedCoupon = coupon;
    if (req.session.cart && typeof req.session.cart === 'object') {
        req.session.cart.appliedCoupon = coupon;
    }
};

const getAppliedCoupon = (req) => {
    if (!req || !req.session) {
        return null;
    }
    if (req.session.appliedCoupon) {
        return req.session.appliedCoupon;
    }
    if (req.session.cart && req.session.cart.appliedCoupon) {
        req.session.appliedCoupon = req.session.cart.appliedCoupon;
        return req.session.cart.appliedCoupon;
    }
    return null;
};

const addToCart = (req, res) => {
    if (!ensureShopperRole(req, res)) {
        return;
    }

    const productId = parseInt(req.params.id, 10);
    const quantityToAdd = parseInt(req.body.quantity, 10);
    const requestedVariantId = parseInt(req.body.variantId, 10);

    if (Number.isNaN(productId)) {
        req.flash('error', 'Invalid product selected.');
        return res.redirect('/shopping');
    }

    if (!Number.isFinite(quantityToAdd) || quantityToAdd <= 0) {
        req.flash('error', 'Please select a valid quantity.');
        return res.redirect('/shopping');
    }

    const handleVariant = (variant) => {
        if (!variant) {
            req.flash('error', 'Selected size is no longer available.');
            return res.redirect('/shopping');
        }

        if (Number(variant.product_id) !== Number(productId)) {
            req.flash('error', 'Invalid size selection for this product.');
            return res.redirect('/shopping');
        }

        const stock = Number.parseInt(variant.variant_quantity || variant.quantity, 10) || 0;
        if (stock <= 0) {
            req.flash('error', `Sorry, "${variant.name}" is out of stock in that size.`);
            return res.redirect('/shopping');
        }

        const product = {
            id: variant.product_id,
            name: variant.name,
            price: variant.price,
            discount_percent: variant.discount_percent,
            description: variant.description,
            brand_id: variant.brand_id,
            brand: variant.brand_name,
            category: variant.category_name,
            image: variant.image
        };

        const cart = ensureSessionCart(req);
        const existingItem = findCartItem(cart, Number(variant.variant_id), productId);
        const currentQtyInCart = existingItem ? existingItem.quantity : 0;
        let desiredTotalQty = currentQtyInCart + quantityToAdd;

        if (desiredTotalQty > stock) {
            desiredTotalQty = stock;
            req.flash('error', `Only ${stock} units of "${variant.name}" are available in that size. Cart quantity adjusted.`);
        }

        if (desiredTotalQty <= 0) {
            req.flash('error', `Unable to add "${variant.name}" - no stock available.`);
            return res.redirect('/shopping');
        }

        if (existingItem) {
            existingItem.quantity = desiredTotalQty;
        } else {
            cart.push(buildCartItem(product, variant, desiredTotalQty));
        }

        req.flash('success', 'Item added to cart.');
        return res.redirect('/cart');
    };

    const loadVariantById = (variantId) => {
        Product.getVariantById(variantId, (variantErr, variantRows) => {
            if (variantErr) {
                console.error('Error fetching variant:', variantErr);
                req.flash('error', 'Unable to add product to cart at this time.');
                return res.redirect('/shopping');
            }

            const variant = variantRows && variantRows[0] ? variantRows[0] : null;
            return handleVariant(variant);
        });
    };

    if (Number.isFinite(requestedVariantId)) {
        return loadVariantById(requestedVariantId);
    }

    Product.getDefaultVariant(productId, (defaultErr, defaultRows) => {
        if (defaultErr) {
            console.error('Error fetching default variant:', defaultErr);
            req.flash('error', 'Unable to add product to cart at this time.');
            return res.redirect('/shopping');
        }

        const defaultVariant = defaultRows && defaultRows[0] ? defaultRows[0] : null;
        if (!defaultVariant) {
            req.flash('error', 'No sizes available for this product.');
            return res.redirect('/shopping');
        }

        return loadVariantById(defaultVariant.id);
    });
};

const viewCart = async (req, res) => {
    if (!ensureShopperRole(req, res)) {
        return;
    }

    const cart = ensureSessionCart(req);
    if (!cart.length) {
        clearAppliedCoupon(req);
        if (req.session.bundleDefinitions) {
            delete req.session.bundleDefinitions;
        }
        if (req.session.bundle) {
            delete req.session.bundle;
        }
    }

    // Stock warning UI removed; render cart items without stock enrichment.

    let appliedCoupon = getAppliedCoupon(req);
    const subtotal = couponService.calculateSubtotal(cart);
    let discountAmount = 0;

    if (appliedCoupon && subtotal > 0) {
        try {
            const validation = await couponService.validateCoupon(
                appliedCoupon.code,
                req.session.user && req.session.user.id,
                subtotal,
                cart
            );

            if (!validation.valid) {
                clearAppliedCoupon(req);
                appliedCoupon = null;
                req.flash('error', validation.message || 'Coupon is no longer valid.');
            } else {
                discountAmount = validation.discountAmount;
                appliedCoupon = couponService.buildAppliedCoupon(validation.coupon, discountAmount);
                setAppliedCoupon(req, appliedCoupon);
            }
        } catch (error) {
            console.error('Error validating coupon for cart:', error);
            clearAppliedCoupon(req);
            appliedCoupon = null;
            req.flash('error', 'Unable to validate your coupon right now.');
        }
    }

    const bundleSource = req.session.bundleDefinitions || req.session.bundle || [];
    const bundleResult = bundleService.calculateBundleDiscount(cart, bundleSource);
    const bundleDiscount = bundleResult.discountAmount;

    const finalTotal = Number(Math.max(0, subtotal - discountAmount - bundleDiscount).toFixed(2));

    res.render('cart', {
        cart,
        user: req.session.user,
        messages: getFlash(req, 'success'),
        errors: getFlash(req, 'error'),
        subtotal,
        discountAmount,
        bundleDiscount,
        bundleInfo: bundleResult,
        finalTotal,
        appliedCoupon
    });
};

const updateCartItem = (req, res) => {
    if (!ensureShopperRole(req, res)) {
        return;
    }

    const itemId = parseInt(req.params.id, 10);
    const quantity = parseInt(req.body.quantity, 10);

    if (Number.isNaN(itemId)) {
        req.flash('error', 'Invalid item.');
        return res.redirect('/cart');
    }

    const cart = ensureSessionCart(req);
    const item = findCartItem(cart, itemId, itemId);
    if (!item) {
        req.flash('error', 'Item not found in cart.');
        return res.redirect('/cart');
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
        req.session.cart = cart.filter(cartItem => Number(cartItem.variantId || cartItem.productId) !== Number(itemId));
        req.flash('success', 'Item removed from cart.');
        return res.redirect('/cart');
    }

    if (Number.isFinite(item.variantId)) {
        Product.getVariantById(item.variantId, (err, rows) => {
            if (err) {
                console.error('Error fetching variant:', err);
                req.flash('error', 'Unable to update cart item at this time.');
                return res.redirect('/cart');
            }

            const variant = rows && rows[0] ? rows[0] : null;
            if (!variant) {
                req.flash('error', 'Selected size no longer exists.');
                return res.redirect('/cart');
            }

            // Stock enforcement removed to allow quantity updates without max limits.

            item.quantity = quantity;
            req.flash('success', 'Cart updated successfully.');
            return res.redirect('/cart');
        });
        return;
    }

    Product.getById(item.productId, (err, results) => {
        if (err) {
            console.error('Error fetching product:', err);
            req.flash('error', 'Unable to update cart item at this time.');
            return res.redirect('/cart');
        }

        if (!results || results.length === 0) {
            req.flash('error', 'Product no longer exists.');
            return res.redirect('/cart');
        }

        const product = results[0];
        // Stock enforcement removed to allow quantity updates without max limits.

        item.quantity = quantity;
        req.flash('success', 'Cart updated successfully.');
        return res.redirect('/cart');
    });
};

const removeCartItem = (req, res) => {
    if (!ensureShopperRole(req, res)) {
        return;
    }

    const itemId = parseInt(req.params.id, 10);

    if (Number.isNaN(itemId)) {
        req.flash('error', 'Invalid item.');
        return res.redirect('/cart');
    }

    const cart = ensureSessionCart(req);
    const nextCart = cart.filter(cartItem => Number(cartItem.variantId || cartItem.productId) !== Number(itemId));
    if (nextCart.length === cart.length) {
        req.flash('error', 'Item not found in cart.');
        return res.redirect('/cart');
    }

    req.session.cart = nextCart;
    req.flash('success', 'Item removed from cart.');
    return res.redirect('/cart');
};

const applyCoupon = async (req, res) => {
    if (!ensureShopperRole(req, res)) {
        return;
    }

    const code = req.body.coupon || req.body.code || '';
    const cart = ensureSessionCart(req);
    const subtotal = couponService.calculateSubtotal(cart);

    if (!cart.length) {
        req.flash('error', 'Add items to your cart before applying a coupon.');
        return res.redirect('/cart');
    }

    try {
        const validation = await couponService.validateCoupon(
            code,
            req.session.user && req.session.user.id,
            subtotal,
            cart
        );
        if (!validation.valid) {
            req.flash('error', validation.message || 'Invalid coupon code.');
            return res.redirect('/cart');
        }

        const applied = couponService.buildAppliedCoupon(validation.coupon, validation.discountAmount);
        setAppliedCoupon(req, applied);
        req.flash('success', `Coupon "${applied.code}" applied.`);
        return res.redirect('/cart');
    } catch (error) {
        console.error('Error applying coupon:', error);
        req.flash('error', 'Unable to apply coupon right now.');
        return res.redirect('/cart');
    }
};

const removeCoupon = (req, res) => {
    if (!ensureShopperRole(req, res)) {
        return;
    }

    const cart = ensureSessionCart(req);
    clearAppliedCoupon(req);
    req.flash('success', 'Coupon removed.');
    return res.redirect('/cart');
};

module.exports = {
    addToCart,
    viewCart,
    updateCartItem,
    removeCartItem,
    applyCoupon,
    removeCoupon
};
