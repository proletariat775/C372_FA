//I declare that this code was written by me. 
// I will not copy or allow others to copy my code. 
// I understand that copying code is considered as plagiarism.
 
// Student Name: Yeo Jun Long Dave 
// Student ID:24046757
// Class:C372-002
// Date created:06/02/2026

const db = require('../db');

const create = (orderId, requestId, data, callback) => {
    const payload = data || {};
    const amount = Number(payload.amount) || 0;
    const currency = payload.currency || 'SGD';
    const status = payload.status || 'UNKNOWN';
    const refundId = payload.paypalRefundId || null;
    const captureId = payload.paypalCaptureId || null;
    const createdAt = payload.createdAt || null;

    const sql = `
        INSERT INTO refunds (
            request_id,
            order_id,
            paypal_refund_id,
            paypal_capture_id,
            amount,
            currency,
            status,
            created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    db.query(sql, [requestId, orderId, refundId, captureId, amount, currency, status, createdAt], callback);
};

const getByRequestId = (requestId, callback) => {
    const sql = `
        SELECT
            id,
            request_id AS requestId,
            order_id AS orderId,
            paypal_refund_id AS paypalRefundId,
            paypal_capture_id AS paypalCaptureId,
            amount,
            currency,
            status,
            created_at AS createdAt
        FROM refunds
        WHERE request_id = ?
        ORDER BY created_at DESC, id DESC
    `;
    db.query(sql, [requestId], callback);
};

module.exports = {
    create,
    getByRequestId
};
