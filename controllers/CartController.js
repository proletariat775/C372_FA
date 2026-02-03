const Product = require('../models/product');

const findCartItem = (cart, productId) =>
    cart.find(item => item.productId === productId);

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
    const shopperRoles = ['user'];
    if (!req.session.user || !shopperRoles.includes(req.session.user.role)) {
        req.flash('error', 'Access denied.');
        res.redirect('/inventory');
        return false;
    }
    return true;
};

const toCurrency = (value) => {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return 0;
    }
    return Number(parsed.toFixed(2));
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
    const basePrice = toCurrency(product.price);
    const discountPercentage = clampDiscount(product.discountPercentage);
    const hasDiscount = discountPercentage > 0;
    const finalPrice = hasDiscount
        ? toCurrency(basePrice * (1 - discountPercentage / 100))
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

const addToCart = (req, res) => {
    if (!ensureShopperRole(req, res)) {
        return;
    }

    const productId = parseInt(req.params.id, 10);
    const quantityToAdd = parseInt(req.body.quantity, 10);

    if (Number.isNaN(productId)) {
        req.flash('error', 'Invalid product selected.');
        return res.redirect('/shopping');
    }

    db.query('SELECT * FROM products WHERE id = ? AND is_deleted = 0', [productId], (error, results) => {
        if (error) {
            console.error('Error fetching product:', error);
            req.flash('error', 'Unable to add product to cart at this time.');
            return res.redirect('/shopping');
        }

        if (!results || results.length === 0) {
            req.flash('error', 'Product not found or is no longer available.');
            return res.redirect('/shopping');
        }

        const product = results[0];
        const stock = Number.parseInt(product.quantity, 10) || 0;

        if (stock <= 0) {
            req.flash('error', `Sorry, "${product.productName}" is out of stock.`);
            return res.redirect('/shopping');
        }

        const cart = ensureSessionCart(req);
        const existingItem = findCartItem(cart, productId);
        const currentQtyInCart = existingItem ? existingItem.quantity : 0;
        let desiredTotalQty = currentQtyInCart + quantityToAdd;

        if (desiredTotalQty > stock) {
            desiredTotalQty = stock;
            req.flash(
                'error',
                `Only ${stock} units of "${product.productName}" are available. Cart quantity has been adjusted.`
            );
        }

        if (desiredTotalQty <= 0) {
            req.flash('error', `Unable to add "${product.productName}" – no stock available.`);
            return res.redirect('/shopping');
        }

        if (existingItem) {
            existingItem.quantity = desiredTotalQty;
        } else {
            cart.push(buildCartItem(product, desiredTotalQty));
        }

        req.flash('success', 'Item added to cart.');
        return res.redirect('/cart');
    });
};

const viewCart = (req, res) => {
    if (!ensureShopperRole(req, res)) {
        return;
    }

    const cart = ensureSessionCart(req);

    res.render('cart', {
        cart: Array.isArray(cart) ? cart : [],
        user: req.session.user,
        messages: getFlash(req, 'success'),
        errors: getFlash(req, 'error')
    });
};

const updateCartItem = (req, res) => {
    if (!ensureShopperRole(req, res)) {
        return;
    }

    const productId = parseInt(req.params.id, 10);
    const quantity = parseInt(req.body.quantity, 10);

    if (Number.isNaN(productId)) {
        req.flash('error', 'Invalid product.');
        return res.redirect('/cart');
    }

    const cart = ensureSessionCart(req);
    const item = findCartItem(cart, productId);
    if (!item) {
        req.flash('error', 'Item not found in cart.');
        return res.redirect('/cart');
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
        req.session.cart = cart.filter(cartItem => cartItem.productId !== productId);
        req.flash('success', 'Item removed from cart.');
        return res.redirect('/cart');
    }

    Product.getById(productId, (err, results) => {
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
        const stock = Number.parseInt(product.quantity, 10) || 0;

        if (quantity > stock) {
            req.flash(
                'error',
                `Cannot set quantity above stock. Only ${stock} units of "${product.productName}" are available.`
            );
            return res.redirect('/cart');
        }

        item.quantity = quantity;
        req.flash('success', 'Cart updated successfully.');
        return res.redirect('/cart');
    });
};

const removeCartItem = (req, res) => {
    if (!ensureShopperRole(req, res)) {
        return;
    }

    const productId = parseInt(req.params.id, 10);

    if (Number.isNaN(productId)) {
        req.flash('error', 'Invalid product.');
        return res.redirect('/cart');
    }

    const cart = ensureSessionCart(req);
    const existingLength = cart.length;
    req.session.cart = cart.filter(cartItem => cartItem.productId !== productId);

    if (existingLength === req.session.cart.length) {
        req.flash('error', 'Item not found in cart.');
        return res.redirect('/cart');
    }

    req.flash('success', 'Item removed from cart.');
    return res.redirect('/cart');
};

module.exports = {
    addToCart,
    viewCart,
    updateCartItem,
    removeCartItem
};
