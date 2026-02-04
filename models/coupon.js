const db = require('../db');

const findByCode = (code, callback) => {
    const sql = `
        SELECT c.*, b.name AS brand_name
        FROM coupons c
        LEFT JOIN brands b ON b.id = c.brand_id
        WHERE LOWER(c.code) = LOWER(?)
        LIMIT 1
    `;
    db.query(sql, [code], (err, rows) => {
        if (err) return callback(err);
        return callback(null, rows && rows[0]);
    });
};

const findById = (id, callback) => {
    const sql = `
        SELECT c.*, b.name AS brand_name
        FROM coupons c
        LEFT JOIN brands b ON b.id = c.brand_id
        WHERE c.id = ?
        LIMIT 1
    `;
    db.query(sql, [id], (err, rows) => {
        if (err) return callback(err);
        return callback(null, rows && rows[0]);
    });
};

const listAll = (callback) => {
    const sql = `
        SELECT c.*, b.name AS brand_name
        FROM coupons c
        LEFT JOIN brands b ON b.id = c.brand_id
        ORDER BY c.created_at DESC, c.id DESC
    `;
    db.query(sql, callback);
};

const create = (data, callback) => {
    const {
        code,
        discount_type,
        discount_value,
        min_order_amount,
        max_discount_amount,
        start_date,
        end_date,
        usage_limit,
        per_user_limit,
        brand_id,
        is_active
    } = data;

    const sql = `
        INSERT INTO coupons (
            code,
            discount_type,
            discount_value,
            min_order_amount,
            max_discount_amount,
            start_date,
            end_date,
            usage_limit,
            per_user_limit,
            brand_id,
            is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(sql, [
        code,
        discount_type,
        discount_value,
        min_order_amount,
        max_discount_amount,
        start_date,
        end_date,
        usage_limit,
        per_user_limit,
        brand_id,
        is_active
    ], callback);
};

const update = (id, data, callback) => {
    const {
        code,
        discount_type,
        discount_value,
        min_order_amount,
        max_discount_amount,
        start_date,
        end_date,
        usage_limit,
        per_user_limit,
        brand_id,
        is_active
    } = data;

    const sql = `
        UPDATE coupons
        SET code = ?,
            discount_type = ?,
            discount_value = ?,
            min_order_amount = ?,
            max_discount_amount = ?,
            start_date = ?,
            end_date = ?,
            usage_limit = ?,
            per_user_limit = ?,
            brand_id = ?,
            is_active = ?
        WHERE id = ?
    `;

    db.query(sql, [
        code,
        discount_type,
        discount_value,
        min_order_amount,
        max_discount_amount,
        start_date,
        end_date,
        usage_limit,
        per_user_limit,
        brand_id,
        is_active,
        id
    ], callback);
};

const remove = (id, callback) => {
    const sql = 'UPDATE coupons SET is_active = 0 WHERE id = ?';
    db.query(sql, [id], callback);
};

const getStats = (callback) => {
    const sql = `
        SELECT
            SUM(CASE WHEN is_active = 1 AND start_date <= NOW() AND end_date >= NOW() THEN 1 ELSE 0 END) AS activeCount,
            SUM(CASE WHEN is_active = 1 AND start_date > NOW() THEN 1 ELSE 0 END) AS scheduledCount,
            SUM(CASE WHEN end_date < NOW() THEN 1 ELSE 0 END) AS expiredCount
        FROM coupons
    `;
    db.query(sql, (err, rows) => {
        if (err) return callback(err);
        const stats = rows && rows[0] ? rows[0] : {};
        return callback(null, {
            active: Number(stats.activeCount || 0),
            scheduled: Number(stats.scheduledCount || 0),
            expired: Number(stats.expiredCount || 0)
        });
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
    listAll,
    create,
    update,
    remove,
    getStats,
    getUserUsageCount,
    incrementUsage,
    recordUsage
};
