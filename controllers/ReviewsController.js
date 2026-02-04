const OrderReview = require('../models/orderReview');

const createReview = (req, res) => {
    const user = req.session.user;
    if (!user || user.role !== 'customer') {
        req.flash('error', 'Only shoppers can submit reviews.');
        return res.redirect('/orders/history');
    }

    const orderItemId = parseInt(req.body.orderItemId, 10);
    const rating = parseInt(req.body.rating, 10);
    const comment = req.body.comment ? String(req.body.comment).trim().slice(0, 1000) : '';

    if (!Number.isFinite(orderItemId)) {
        req.flash('error', 'Invalid order item selected.');
        return res.redirect('/orders/history');
    }

    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
        req.flash('error', 'Please select a rating between 1 and 5.');
        return res.redirect('/orders/history');
    }

    OrderReview.findOrderItemContext(user.id, orderItemId, (contextErr, contextRows) => {
        if (contextErr) {
            console.error('Error validating review submission:', contextErr);
            req.flash('error', 'Unable to submit review right now.');
            return res.redirect('/orders/history');
        }

        if (!contextRows || !contextRows.length) {
            req.flash('error', 'You can only review items you purchased.');
            return res.redirect('/orders/history');
        }

        const context = contextRows[0];
        const status = context.status ? String(context.status).toLowerCase() : 'pending';
        if (status !== 'completed') {
            req.flash('error', 'Reviews are available after the order is completed.');
            return res.redirect('/orders/history');
        }

        if (!context.product_id) {
            req.flash('error', 'This item is no longer available for review.');
            return res.redirect('/orders/history');
        }

        OrderReview.findByUserAndOrderItem(user.id, orderItemId, (lookupErr, reviewRows) => {
            if (lookupErr) {
                console.error('Error checking existing review:', lookupErr);
                req.flash('error', 'Unable to submit review right now.');
                return res.redirect('/orders/history');
            }

            if (reviewRows && reviewRows.length) {
                req.flash('error', 'You already reviewed this item.');
                return res.redirect('/orders/history');
            }

            OrderReview.create({
                productId: context.product_id,
                userId: user.id,
                orderItemId,
                rating,
                comment
            }, (createErr) => {
                if (createErr) {
                    if (createErr.code === 'ER_DUP_ENTRY') {
                        req.flash('error', 'You already reviewed this item.');
                    } else {
                        console.error('Error creating review:', createErr);
                        req.flash('error', 'Unable to submit review right now.');
                    }
                    return res.redirect('/orders/history');
                }

                req.flash('success', 'Thanks for sharing your review.');
                return res.redirect('/orders/history');
            });
        });
    });
};

module.exports = {
    createReview
};
