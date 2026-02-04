const connection = require('../db');

const normalizeValue = (value) => {
    if (value === null || typeof value === 'undefined') {
        return null;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed ? trimmed : null;
    }
    return value;
};

const ProductDetails = {
    create: (productId, details, callback) => {
        const {
            description = null,
            fitType = null,
            material = null,
            color = null,
            sizeRange = null,
            care = null
        } = details || {};

        const sql = `
            INSERT INTO product_details (product_id, description, fit_type, material, color, size_range, care)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                description = VALUES(description),
                fit_type = VALUES(fit_type),
                material = VALUES(material),
                color = VALUES(color),
                size_range = VALUES(size_range),
                care = VALUES(care)
        `;

        const values = [
            productId,
            normalizeValue(description),
            normalizeValue(fitType),
            normalizeValue(material),
            normalizeValue(color),
            normalizeValue(sizeRange),
            normalizeValue(care)
        ];

        connection.query(sql, values, callback);
    },

    findByProductId: (productId, callback) => {
        const sql = `
            SELECT product_id, description, fit_type AS fitType, material, color, size_range AS sizeRange, care
            FROM product_details
            WHERE product_id = ?
            LIMIT 1
        `;
        connection.query(sql, [productId], callback);
    }
};

module.exports = ProductDetails;
