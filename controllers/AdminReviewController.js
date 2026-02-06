const OrderReview = require('../models/orderReview');

const renderView = (res, name, data = {}) => res.render(name, { ...data, user: res.locals.user || res.req.session.user });

module.exports = {
    list(req, res) {
        OrderReview.adminList((err, reviews = []) => {
            if (err) {
                console.error('Error loading admin reviews:', err);
                req.flash('error', 'Unable to load reviews right now.');
                return res.redirect('/admin/dashboard');
            }

            return renderView(res, 'adminReviews', {
                reviews,
                messages: req.flash('success'),
                errors: req.flash('error')
            });
        });
    },

    reply(req, res) {
        const reviewId = parseInt(req.params.id, 10);
        if (!Number.isFinite(reviewId)) {
            req.flash('error', 'Invalid review selected.');
            return res.redirect('/admin/reviews');
        }

        const reply = req.body.reply ? String(req.body.reply).trim() : '';
        if (!reply) {
            req.flash('error', 'Reply cannot be empty.');
            return res.redirect('/admin/reviews');
        }

        OrderReview.adminReply(reviewId, reply, (err) => {
            if (err) {
                console.error('Error saving admin reply:', err);
                req.flash('error', 'Unable to save reply.');
                return res.redirect('/admin/reviews');
            }

            req.flash('success', 'Reply saved.');
            return res.redirect('/admin/reviews');
        });
    }
};
