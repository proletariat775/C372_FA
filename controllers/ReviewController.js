//I declare that this code was written by me. 
// I will not copy or allow others to copy my code. 
// I understand that copying code is considered as plagiarism.

// Student Name: Zoey Liaw En Yi
// Student ID:24049473
// Class: C372_002_E63C
// Date created: 06/02/2026
const Review = require('../models/review');
const Order = require('../models/order');
const loyaltyService = require('../services/loyaltyService');

/**
 * Create or update a review for a product by the logged-in user.
 */
const upsert = (req, res) => {
    const productId = parseInt(req.params.id, 10);
    const user = req.session.user;

    if (!user || user.role !== 'customer') {
        req.flash('error', 'Only shoppers can leave reviews.');
        return res.redirect(`/product/${productId}`);
    }

    const rating = Number(req.body.rating);
    const comment = (req.body.comment || '').trim();

    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
        req.flash('error', 'Rating must be between 1 and 5 stars.');
        return res.redirect(`/product/${productId}`);
    }

    Order.hasDeliveredProduct(user.id, productId, (orderErr, canReview) => {
        if (orderErr) {
            console.error('Error checking review eligibility:', orderErr);
            req.flash('error', 'Unable to verify review eligibility right now.');
            return res.redirect(`/product/${productId}`);
        }

        if (!canReview) {
            req.flash('error', 'You can only review items from completed orders.');
            return res.redirect(`/product/${productId}`);
        }

        Review.findByUserAndProduct(user.id, productId, (lookupError, existingRows) => {
            if (lookupError) {
                console.error('Error looking up review:', lookupError);
                req.flash('error', 'Unable to submit review at this time.');
                return res.redirect(`/product/${productId}`);
            }

            if (existingRows && existingRows.length) {
                const reviewId = existingRows[0].id;
                Review.update(reviewId, { rating, comment }, (updateError) => {
                    if (updateError) {
                        console.error('Error updating review:', updateError);
                        req.flash('error', 'Unable to update review.');
                    } else {
                        req.flash('success', 'Your review has been updated.');
                    }
                    return res.redirect(`/product/${productId}`);
                });
            } else {
                Review.create({ productId, userId: user.id, rating, comment }, (createError) => {
                    if (createError) {
                        console.error('Error creating review:', createError);
                        req.flash('error', 'Unable to submit review.');
                    } else {
                        loyaltyService.awardPointsForReview({
                            userId: user.id,
                            orderId: null,
                            orderItemId: null,
                            productId
                        }).then((award) => {
                            if (req.session.user && Number.isFinite(award.balance)) {
                                req.session.user.loyalty_points = award.balance;
                            }
                        }).catch((awardErr) => {
                            console.error('Error awarding EcoPoints for review:', awardErr);
                        });
                        req.flash('success', 'Thanks for sharing your thoughts!');
                    }
                    return res.redirect(`/product/${productId}`);
                });
            }
        });
    });
};

/**
 * Remove a review authored by the logged-in user.
 */
const remove = (req, res) => {
    const productId = parseInt(req.params.id, 10);
    const reviewId = parseInt(req.params.reviewId, 10);
    const user = req.session.user;

    if (!user || user.role !== 'customer') {
        req.flash('error', 'Only shoppers can manage reviews.');
        return res.redirect(`/product/${productId}`);
    }

    if (!Number.isFinite(reviewId)) {
        req.flash('error', 'Invalid review specified.');
        return res.redirect(`/product/${productId}`);
    }

    Review.findByUserAndProduct(user.id, productId, (lookupError, existingRows) => {
        if (lookupError) {
            console.error('Error looking up review before delete:', lookupError);
            req.flash('error', 'Unable to remove review right now.');
            return res.redirect(`/product/${productId}`);
        }

        if (!existingRows || !existingRows.length || existingRows[0].id !== reviewId) {
            req.flash('error', 'Review not found or not owned by you.');
            return res.redirect(`/product/${productId}`);
        }

        Review.remove(reviewId, (deleteError) => {
            if (deleteError) {
                console.error('Error deleting review:', deleteError);
                req.flash('error', 'Unable to delete review.');
            } else {
                req.flash('success', 'Your review has been deleted.');
            }
            return res.redirect(`/product/${productId}`);
        });
    });
};

module.exports = {
    upsert,
    remove
};

