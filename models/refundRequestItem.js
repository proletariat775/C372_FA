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
        item.unitPrice
    ]));

    const sql = `
        INSERT INTO refund_request_items
            (request_id, order_item_id, product_id, product_variant_id, quantity, unit_price)
        VALUES ?
    `;
    db.query(sql, [values], callback);
};

const getByRequestId = (requestId, callback) => {
    const sql = `
        SELECT
            rri.id,
            rri.request_id AS requestId,
            rri.order_item_id AS orderItemId,
            rri.product_id AS productId,
            rri.product_variant_id AS variantId,
            rri.quantity,
            rri.unit_price AS unitPrice,
            p.name AS productName
        FROM refund_request_items rri
        LEFT JOIN products p ON p.id = rri.product_id
        WHERE rri.request_id = ?
        ORDER BY rri.id ASC
    `;
    db.query(sql, [requestId], callback);
};

module.exports = {
    createMany,
    getByRequestId
};
