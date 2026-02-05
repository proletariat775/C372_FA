const db = require('../db');

const create = (orderId, userId, amount, reason, callback) => {
    const safeAmount = Number(amount);
    const safeReason = reason ? String(reason).trim().slice(0, 500) : null;

    if (!Number.isFinite(safeAmount) || safeAmount <= 0) {
        return callback(new Error('Invalid refund amount.'));
    }

    const sql = `
        INSERT INTO refund_requests (order_id, user_id, requested_amount, reason, status)
        VALUES (?, ?, ?, ?, 'PENDING')
    `;
    db.query(sql, [orderId, userId, safeAmount, safeReason], callback);
};

const getByUser = (userId, callback) => {
    const sql = `
        SELECT
            rr.id,
            rr.order_id AS orderId,
            rr.requested_amount AS requestedAmount,
            rr.reason,
            rr.status,
            rr.admin_note AS adminNote,
            rr.created_at AS createdAt,
            rr.updated_at AS updatedAt,
            o.total_amount AS total,
            o.payment_method AS paymentMethod
        FROM refund_requests rr
        INNER JOIN orders o ON o.id = rr.order_id
        WHERE rr.user_id = ?
        ORDER BY rr.created_at DESC, rr.id DESC
    `;
    db.query(sql, [userId], callback);
};

const getAll = (callback) => {
    const sql = `
        SELECT
            rr.id,
            rr.order_id AS orderId,
            rr.user_id AS userId,
            rr.requested_amount AS requestedAmount,
            rr.reason,
            rr.status,
            rr.admin_note AS adminNote,
            rr.created_at AS createdAt,
            rr.updated_at AS updatedAt,
            o.total_amount AS total,
            o.payment_method AS paymentMethod,
            o.paypal_capture_id AS paypalCaptureId,
            o.refunded_amount AS refundedAmount,
            u.username,
            u.email
        FROM refund_requests rr
        INNER JOIN orders o ON o.id = rr.order_id
        INNER JOIN users u ON u.id = rr.user_id
        ORDER BY rr.created_at DESC, rr.id DESC
    `;
    db.query(sql, callback);
};

const getById = (requestId, callback) => {
    const sql = `
        SELECT
            rr.id,
            rr.order_id AS orderId,
            rr.user_id AS userId,
            rr.requested_amount AS requestedAmount,
            rr.reason,
            rr.status,
            rr.admin_note AS adminNote,
            rr.created_at AS createdAt,
            rr.updated_at AS updatedAt,
            o.total_amount AS total,
            o.payment_method AS paymentMethod,
            o.paypal_capture_id AS paypalCaptureId,
            o.refunded_amount AS refundedAmount,
            u.username,
            u.email
        FROM refund_requests rr
        INNER JOIN orders o ON o.id = rr.order_id
        INNER JOIN users u ON u.id = rr.user_id
        WHERE rr.id = ?
        LIMIT 1
    `;
    db.query(sql, [requestId], (err, rows) => {
        if (err) {
            return callback(err);
        }
        return callback(null, rows && rows.length ? rows[0] : null);
    });
};

const getByIdForUser = (requestId, userId, callback) => {
    const sql = `
        SELECT
            rr.id,
            rr.order_id AS orderId,
            rr.user_id AS userId,
            rr.requested_amount AS requestedAmount,
            rr.reason,
            rr.status,
            rr.admin_note AS adminNote,
            rr.created_at AS createdAt,
            rr.updated_at AS updatedAt,
            o.total_amount AS total,
            o.payment_method AS paymentMethod
        FROM refund_requests rr
        INNER JOIN orders o ON o.id = rr.order_id
        WHERE rr.id = ? AND rr.user_id = ?
        LIMIT 1
    `;
    db.query(sql, [requestId, userId], (err, rows) => {
        if (err) {
            return callback(err);
        }
        return callback(null, rows && rows.length ? rows[0] : null);
    });
};

const getPendingByOrder = (orderId, userId, callback) => {
    const sql = `
        SELECT id, status
        FROM refund_requests
        WHERE order_id = ? AND user_id = ? AND status = 'PENDING'
        LIMIT 1
    `;
    db.query(sql, [orderId, userId], (err, rows) => {
        if (err) {
            return callback(err);
        }
        return callback(null, rows && rows.length ? rows[0] : null);
    });
};

const updateStatus = (requestId, status, adminNote, callback) => {
    const safeStatus = status ? String(status).trim().slice(0, 20) : 'PENDING';
    const safeNote = adminNote ? String(adminNote).trim().slice(0, 500) : null;
    const sql = `
        UPDATE refund_requests
        SET status = ?, admin_note = ?
        WHERE id = ?
    `;
    db.query(sql, [safeStatus, safeNote, requestId], callback);
};

module.exports = {
    create,
    getByUser,
    getAll,
    getById,
    getByIdForUser,
    getPendingByOrder,
    updateStatus
};
