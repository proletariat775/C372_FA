const db = require('../db');

const findByCode = (code, callback) => {
    const sql = 'SELECT * FROM coupons WHERE LOWER(code) = LOWER(?) LIMIT 1';
    db.query(sql, [code], (err, rows) => {
        if (err) return callback(err);
        return callback(null, rows && rows[0]);
    });
};

const findById = (id, callback) => {
    const sql = 'SELECT * FROM coupons WHERE id = ? LIMIT 1';
    db.query(sql, [id], (err, rows) => {
        if (err) return callback(err);
        return callback(null, rows && rows[0]);
    });
};

const getUserUsageCount = (couponId, userId, callback) => {
    const sql = 'SELECT COUNT(*) AS usageCount FROM coupon_usage WHERE coupon_id = ? AND user_id = ?';
    db.query(sql, [couponId, userId], (err, rows) => {
        if (err) return callback(err);
        const count = rows && rows[0] ? Number(rows[0].usageCount || 0) : 0;
        return callback(null, count);
    });
};

const incrementUsage = (couponId, callback) => {
    const sql = 'UPDATE coupons SET usage_count = usage_count + 1 WHERE id = ?';
    db.query(sql, [couponId], callback);
};

const recordUsage = (couponId, userId, orderId, discountAmount, callback) => {
    const sql = `
        INSERT INTO coupon_usage (coupon_id, user_id, order_id, discount_amount)
        VALUES (?, ?, ?, ?)
    `;
    db.query(sql, [couponId, userId, orderId, discountAmount], callback);
};

module.exports = {
    findByCode,
    findById,
    getUserUsageCount,
    incrementUsage,
    recordUsage
};
