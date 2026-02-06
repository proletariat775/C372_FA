const db = require('../db');

const createMany = (requestId, items, callback) => {
    if (!Array.isArray(items) || !items.length) {
        return callback(null);
    }

    const values = items.map((item) => ([
        requestId,
        item.orderItemId,
        item.productId,
        item.variantId,
        item.quantity,
        item.unitPrice,
        item.lineRefundAmount
    ]));

    const sql = `
        INSERT INTO refund_items
            (refund_request_id, order_item_id, product_id, product_variant_id, refund_qty, unit_price, line_refund_amount)
        VALUES ?
    `;
    db.query(sql, [values], callback);
};

const getByRequestId = (requestId, callback) => {
    const sql = `
        SELECT
            ri.id,
            ri.refund_request_id AS requestId,
            ri.order_item_id AS orderItemId,
            ri.product_id AS productId,
            ri.product_variant_id AS variantId,
            ri.refund_qty AS quantity,
            ri.unit_price AS unitPrice,
            ri.line_refund_amount AS lineRefundAmount,
            p.name AS productName
        FROM refund_items ri
        LEFT JOIN products p ON p.id = ri.product_id
        WHERE ri.refund_request_id = ?
        ORDER BY ri.id ASC
    `;
    db.query(sql, [requestId], callback);
};

const getRefundedQuantitiesByOrder = (orderId, callback) => {
    const sql = `
        SELECT
            ri.order_item_id AS orderItemId,
            SUM(ri.refund_qty) AS refundedQty
        FROM refund_items ri
        INNER JOIN refund_requests rr ON rr.id = ri.refund_request_id
        WHERE rr.order_id = ?
          AND rr.status IN ('approved', 'processing', 'completed')
        GROUP BY ri.order_item_id
    `;
    db.query(sql, [orderId], callback);
};

module.exports = {
    createMany,
    getByRequestId,
    getRefundedQuantitiesByOrder
};
