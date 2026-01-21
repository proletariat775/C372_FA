const Cart = require('../models/cart');
const db = require('../db');

const findCartItem = (cart, productId) =>
    cart.find(item => item.productId === productId);

const ensureShopperRole = (req, res) => {
    const shopperRoles = ['user'];
    if (!req.session.user || !shopperRoles.includes(req.session.user.role)) {
        req.flash('error', 'Access denied.');
        res.redirect('/inventory');
        return false;
    }
    return true;
};

const calculatePricing = (product) => {
    const basePrice = Number.parseFloat(product.price) || 0;
    const discountPercentage = Math.min(
        100,
        Math.max(0, Number.parseFloat(product.discountPercentage) || 0)
    );
    const hasDiscount = discountPercentage > 0;
    const discountedPrice = hasDiscount
        ? Number((basePrice * (1 - discountPercentage / 100)).toFixed(2))
        : Number(basePrice.toFixed(2));

    return {
        basePrice: Number(basePrice.toFixed(2)),
        discountPercentage,
        finalPrice: discountedPrice,
        hasDiscount
    };
};

const syncCartFromDb = (req, callback) => {
    if (!req.session.user) {
        req.session.cart = [];
        return callback(null, []);
    }

    Cart.getItemsWithProducts(req.session.user.id, (err, rows) => {
        if (err) {
            return callback(err);
        }

        const cart = (rows || []).map((item) => {
            const pricing = calculatePricing(item);
            const offerMessage = item.offerMessage ? String(item.offerMessage).trim() : null;
            return {
                productId: item.product_id,
                productName: item.productName,
                price: pricing.finalPrice,
                originalPrice: pricing.basePrice,
                discountPercentage: pricing.discountPercentage,
                offerMessage,
                hasDiscount: pricing.hasDiscount,
                quantity: item.quantity,
                image: item.image
            };
        });

        req.session.cart = cart;
        return callback(null, cart);
    });
};

const addToCart = (req, res) => {
    if (!ensureShopperRole(req, res)) {
        return;
    }

    const productId = parseInt(req.params.id, 10);
    const quantity = parseInt(req.body.quantity, 10) || 1;

    if (Number.isNaN(productId)) {
        req.flash('error', 'Invalid product selected.');
        return res.redirect('/shopping');
    }

    db.query('SELECT * FROM products WHERE id = ? AND is_active = 1', [productId], (error, results) => {
        if (error) {
            console.error('Error fetching product:', error);
            req.flash('error', 'Unable to add product to cart at this time.');
            return res.redirect('/shopping');
        }

        if (results.length === 0) {
            req.flash('error', 'Product not found or is no longer available.');
            return res.redirect('/shopping');
        }

        Cart.addItem(req.session.user.id, productId, quantity, (addErr) => {
            if (addErr) {
                console.error('Error persisting cart item:', addErr);
                req.flash('error', addErr.message || 'Unable to add product to cart at this time.');
                return res.redirect('/shopping');
            }

            syncCartFromDb(req, (syncErr) => {
                if (syncErr) {
                    console.error('Error syncing cart after add:', syncErr);
                    req.flash('error', 'Unable to refresh your cart.');
                    return res.redirect('/shopping');
                }

                req.flash('success', 'Item added to cart.');
                return res.redirect('/cart');
            });
        });
    });
};

const viewCart = (req, res) => {
    if (!ensureShopperRole(req, res)) {
        return;
    }

    syncCartFromDb(req, (err) => {
        if (err) {
            console.error('Error loading cart:', err);
            req.flash('error', 'Unable to load your cart right now.');
            return res.redirect('/shopping');
        }

        res.render('cart', {
            cart: req.session.cart || [],
            user: req.session.user,
            messages: req.flash('success'),
            errors: req.flash('error')
        });
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

    const validatedQuantity = Number.isFinite(quantity) ? quantity : 0;

    Cart.setQuantity(req.session.user.id, productId, validatedQuantity, (err, result) => {
        if (err) {
            console.error('Error updating cart item:', err);
            req.flash('error', err.message || 'Unable to update cart item.');
            return res.redirect('/cart');
        }

        if (validatedQuantity <= 0 || (result && result.affectedRows === 0)) {
            req.flash('success', 'Item removed from cart.');
        } else {
            req.flash('success', 'Cart updated successfully.');
        }

        return syncCartFromDb(req, (syncErr) => {
            if (syncErr) {
                console.error('Error syncing cart after update:', syncErr);
                req.flash('error', syncErr.message || 'Unable to refresh your cart.');
                return res.redirect('/cart');
            }
            return res.redirect('/cart');
        });
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

    Cart.removeItem(req.session.user.id, productId, (err, result) => {
        if (err) {
            console.error('Error removing cart item:', err);
            req.flash('error', 'Unable to remove item from cart.');
            return res.redirect('/cart');
        }

        if (result && result.affectedRows === 0) {
            req.flash('error', 'Item not found in cart.');
            return res.redirect('/cart');
        }

        return syncCartFromDb(req, (syncErr) => {
            if (syncErr) {
                console.error('Error syncing cart after removal:', syncErr);
                req.flash('error', 'Unable to refresh your cart.');
                return res.redirect('/cart');
            }

            req.flash('success', 'Item removed from cart.');
            return res.redirect('/cart');
        });
    });
};

module.exports = {
    addToCart,
    viewCart,
    updateCartItem,
    removeCartItem
};
