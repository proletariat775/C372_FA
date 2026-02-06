//I declare that this code was written by me. 
// I will not copy or allow others to copy my code. 
// I understand that copying code is considered as plagiarism.

// Student Name: Zoey Liaw En Yi
// Student ID:24049473
// Class: C372_002_E63C
// Date created: 06/02/2026
const connection = require('../db');

const OrderItem = {
    findByOrderIds: (orderIds, callback) => {
        if (!Array.isArray(orderIds) || orderIds.length === 0) {
            return callback(null, []);
        }

        const sql = `
            SELECT
                oi.id,
                oi.order_id,
                oi.product_variant_id,
                oi.product_name AS productName,
                oi.variant_description,
                oi.size,
                oi.color,
                oi.quantity,
                oi.unit_price AS price,
                oi.total_price,
                pv.product_id,
                (SELECT pi.image_url FROM product_images pi WHERE pi.product_id = pv.product_id ORDER BY pi.is_primary DESC LIMIT 1) AS image
            FROM order_items oi
            LEFT JOIN product_variants pv ON pv.id = oi.product_variant_id
            WHERE oi.order_id IN (?)
            ORDER BY oi.order_id DESC, productName ASC
        `;
        connection.query(sql, [orderIds], callback);
    }
};

module.exports = OrderItem;
