const db = require('../db');

const create = (orderId, userId, amount, paymentMethod, reason, callback) => {
    const safeAmount = Number(amount);
    const safeReason = reason ? String(reason).trim().slice(0, 500) : null;
    const safePayment = paymentMethod ? String(paymentMethod).trim().slice(0, 20) : null;

    if (!Number.isFinite(safeAmount) || safeAmount <= 0) {
        return callback(new Error('Invalid refund amount.'));
    }

    const sql = `
        INSERT INTO refund_requests (order_id, user_id, payment_method, requested_amount, reason, status)
        VALUES (?, ?, ?, ?, ?, 'pending')
    `;
    db.query(sql, [orderId, userId, safePayment, safeAmount, safeReason], callback);
};

const getByUser = (userId, callback) => {
    const sql = `
        SELECT
            rr.id,
            rr.order_id AS orderId,
            rr.payment_method AS paymentMethod,
            rr.requested_amount AS requestedAmount,
            rr.approved_amount AS approvedAmount,
            rr.reason,
            rr.status,
            rr.admin_reason AS adminNote,
            rr.created_at AS createdAt,
            rr.updated_at AS updatedAt,
            o.total_amount AS total
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
            rr.payment_method AS paymentMethod,
            rr.requested_amount AS requestedAmount,
            rr.approved_amount AS approvedAmount,
            rr.reason,
            rr.status,
            rr.admin_reason AS adminNote,
            rr.created_at AS createdAt,
            rr.updated_at AS updatedAt,
            o.total_amount AS total,
            o.paypal_capture_id AS paypalCaptureId,
            o.stripe_payment_intent_id AS stripePaymentIntentId,
            o.loyalty_points_redeemed AS loyaltyPointsRedeemed,
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
            rr.payment_method AS paymentMethod,
            rr.requested_amount AS requestedAmount,
            rr.approved_amount AS approvedAmount,
            rr.reason,
            rr.status,
            rr.admin_reason AS adminNote,
            rr.created_at AS createdAt,
            rr.updated_at AS updatedAt,
            o.total_amount AS total,
            o.paypal_capture_id AS paypalCaptureId,
            o.stripe_payment_intent_id AS stripePaymentIntentId,
            o.loyalty_points_redeemed AS loyaltyPointsRedeemed,
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
            rr.payment_method AS paymentMethod,
            rr.requested_amount AS requestedAmount,
            rr.approved_amount AS approvedAmount,
            rr.reason,
            rr.status,
            rr.admin_reason AS adminNote,
            rr.created_at AS createdAt,
            rr.updated_at AS updatedAt,
            o.total_amount AS total
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

const getOpenByOrder = (orderId, userId, callback) => {
    const sql = `
        SELECT id, status
        FROM refund_requests
        WHERE order_id = ? AND user_id = ? AND status IN ('pending','approved','processing')
        LIMIT 1
    `;
    db.query(sql, [orderId, userId], (err, rows) => {
        if (err) {
            return callback(err);
        }
        return callback(null, rows && rows.length ? rows[0] : null);
    });
};

const updateRequest = (requestId, status, adminReason, approvedAmount, callback) => {
    const safeStatus = status ? String(status).trim().slice(0, 20) : 'pending';
    const safeReason = adminReason ? String(adminReason).trim().slice(0, 500) : null;
    const safeApproved = typeof approvedAmount !== 'undefined' && approvedAmount !== null
        ? Number(approvedAmount)
        : null;
    const sql = `
        UPDATE refund_requests
        SET status = ?,
            admin_reason = ?,
            approved_amount = ?
        WHERE id = ?
    `;
    db.query(sql, [safeStatus, safeReason, safeApproved, requestId], callback);
};

const getLatestByOrderIds = (orderIds, userId, callback) => {
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
        return callback(null, []);
    }

    const safeIds = orderIds
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id));

    if (!safeIds.length) {
        return callback(null, []);
    }

    const hasUserFilter = Number.isFinite(Number(userId));
    const params = [safeIds];
    const userClause = hasUserFilter ? 'AND user_id = ?' : '';
    if (hasUserFilter) {
        params.push(Number(userId));
    }

    const sql = `
        SELECT
            rr.order_id AS orderId,
            rr.status,
            rr.id,
            rr.approved_amount AS approvedAmount,
            rr.created_at AS createdAt,
            rr.updated_at AS updatedAt
        FROM refund_requests rr
        INNER JOIN (
            SELECT order_id, MAX(id) AS max_id
            FROM refund_requests
            WHERE order_id IN (?)
            ${userClause}
            GROUP BY order_id
        ) latest
            ON latest.order_id = rr.order_id
           AND latest.max_id = rr.id
    `;

    db.query(sql, params, callback);
};

module.exports = {
    create,
    getByUser,
    getAll,
    getById,
    getByIdForUser,
    getOpenByOrder,
    updateRequest,
    getLatestByOrderIds
};
