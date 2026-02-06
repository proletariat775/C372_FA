//I declare that this code was written by me. 
// I will not copy or allow others to copy my code. 
// I understand that copying code is considered as plagiarism.

// Student Name: Zoey Liaw En Yi
// Student ID:24049473
// Class: C372_002_E63C
// Date created: 06/02/2026


const Product = require('../models/product');
const Wishlist = require('../models/wishlist');

const normalisePrice = (value) => {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return 0;
    }
    return Number(parsed.toFixed(2));
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
    wishlist,
    addWishlist,
    removeWishlist
};
