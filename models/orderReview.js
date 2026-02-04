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

    findOrderItemContext: (userId, orderItemId, callback) => {
        const sql = `
            SELECT
                oi.id,
                oi.order_id,
                o.status,
                pv.product_id
            FROM order_items oi
            JOIN orders o ON o.id = oi.order_id
            LEFT JOIN product_variants pv ON pv.id = oi.product_variant_id
            WHERE oi.id = ? AND o.user_id = ?
            LIMIT 1
        `;
        connection.query(sql, [orderItemId, userId], callback);
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
    },

    findByProduct: (productId, callback) => {
        const sql = `
            SELECT r.id, r.product_id, r.user_id, r.rating, r.comment, r.created_at, r.updated_at, u.username
            FROM reviews r
            JOIN users u ON u.id = r.user_id
            WHERE r.product_id = ? AND r.is_approved = 1
            ORDER BY r.created_at DESC
        `;
        connection.query(sql, [productId], callback);
    },

    findByUserAndProduct: (userId, productId, callback) => {
        const sql = `
            SELECT *
            FROM reviews
            WHERE user_id = ? AND product_id = ?
            ORDER BY created_at DESC
            LIMIT 1
        `;
        connection.query(sql, [userId, productId], callback);
    }
};

module.exports = OrderReview;
