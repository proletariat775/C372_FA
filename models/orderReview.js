const connection = require('../db');

const OrderReview = {
    create: (reviewData, callback) => {
        const { productId, userId, orderItemId, rating, comment } = reviewData;
        const sql = `
            INSERT INTO reviews (product_id, user_id, order_item_id, rating, comment, is_approved)
            VALUES (?, ?, ?, ?, ?, 1)
        `;
        connection.query(sql, [productId, userId, orderItemId, rating, comment], callback);
    },

    update: (id, reviewData, callback) => {
        const { rating, comment } = reviewData;
        const sql = `
            UPDATE reviews
            SET rating = ?, comment = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `;
        connection.query(sql, [rating, comment, id], callback);
    },

    findByUserAndOrderItem: (userId, orderItemId, callback) => {
        const sql = `
            SELECT *
            FROM reviews
            WHERE user_id = ? AND order_item_id = ?
            LIMIT 1
        `;
        connection.query(sql, [userId, orderItemId], callback);
    },

    findByUserAndOrderItems: (userId, orderItemIds, callback) => {
        if (!Array.isArray(orderItemIds) || orderItemIds.length === 0) {
            return callback(null, []);
        }

        const sql = `
            SELECT *
            FROM reviews
            WHERE user_id = ? AND order_item_id IN (?)
        `;
        connection.query(sql, [userId, orderItemIds], callback);
    }
};

module.exports = OrderReview;
