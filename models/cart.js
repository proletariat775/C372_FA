//I declare that this code was written by me. 
// I will not copy or allow others to copy my code. 
// I understand that copying code is considered as plagiarism.
 
// Student Name: wendy liew wen ying 
// Student ID: 24038281
// Class: C372-002
// Date created: 06/02/2026
const db = require('../db');

// Mapped to FA.sql: cart, cart_items, product_variants, products, product_images

const ensureCart = (userId, cb) => {
    db.query('SELECT id FROM cart WHERE user_id = ? LIMIT 1', [userId], (err, rows) => {
        if (err) return cb(err);
        if (rows && rows.length) return cb(null, rows[0].id);
        db.query('INSERT INTO cart (user_id) VALUES (?)', [userId], (iErr, res) => {
            if (iErr) return cb(iErr);
            return cb(null, res.insertId);
        });
    });
};

/**
 * Get all cart items for a user, joined with product data.
 */
const getItemsWithProducts = (userId, callback) => {
    const sql = `
        SELECT p.id AS product_id,
               pv.id AS product_variant_id,
               pv.size AS variant_size,
               pv.color AS variant_color,
               ci.quantity,
               p.name AS productName,
               p.price,
               p.discount_percent AS discountPercentage,
               p.description AS offerMessage,
               (SELECT pi.image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.is_primary DESC LIMIT 1) AS image
        FROM cart_items ci
        INNER JOIN cart c ON c.id = ci.cart_id
        INNER JOIN product_variants pv ON pv.id = ci.product_variant_id
        INNER JOIN products p ON p.id = pv.product_id
        WHERE c.user_id = ?
    `;
    db.query(sql, [userId], callback);
};

const findAvailableVariantForProduct = (productId, cb) => {
    const sql = 'SELECT id, quantity FROM product_variants WHERE product_id = ? ORDER BY id LIMIT 1';
    db.query(sql, [productId], (err, rows) => {
        if (err) return cb(err);
        if (!rows || rows.length === 0) return cb(new Error('No variants available for this product'));
        return cb(null, rows[0]);
    });
};

const addItem = (userId, productId, quantity, callback) => {
    ensureCart(userId, (err, cartId) => {
        if (err) return callback(err);

        findAvailableVariantForProduct(productId, (vErr, variant) => {
            if (vErr) return callback(vErr);

            const updateSql = 'UPDATE cart_items SET quantity = quantity + ? WHERE cart_id = ? AND product_variant_id = ?';
            db.query(updateSql, [quantity, cartId, variant.id], (updateErr, result) => {
                if (updateErr) return callback(updateErr);
                if (result.affectedRows > 0) return callback(null, result);

                const insertSql = 'INSERT INTO cart_items (cart_id, product_variant_id, quantity) VALUES (?, ?, ?)';
                db.query(insertSql, [cartId, variant.id, quantity], callback);
            });
        });
    });
};

const setQuantity = (userId, productId, quantity, callback) => {
    ensureCart(userId, (err, cartId) => {
        if (err) return callback(err);
        findAvailableVariantForProduct(productId, (vErr, variant) => {
            if (vErr) return callback(vErr);
            if (quantity <= 0) {
                return db.query('DELETE FROM cart_items WHERE cart_id = ? AND product_variant_id = ?', [cartId, variant.id], callback);
            }
            const sql = 'UPDATE cart_items SET quantity = ? WHERE cart_id = ? AND product_variant_id = ?';
            db.query(sql, [quantity, cartId, variant.id], (uErr, res) => {
                if (uErr) return callback(uErr);
                return callback(null, res);
            });
        });
    });
};

const removeItem = (userId, productId, callback) => {
    ensureCart(userId, (err, cartId) => {
        if (err) return callback(err);
        findAvailableVariantForProduct(productId, (vErr, variant) => {
            if (vErr) return callback(vErr);
            db.query('DELETE FROM cart_items WHERE cart_id = ? AND product_variant_id = ?', [cartId, variant.id], callback);
        });
    });
};

const clear = (userId, callback) => {
    ensureCart(userId, (err, cartId) => {
        if (err) return callback(err);
        db.query('DELETE FROM cart_items WHERE cart_id = ?', [cartId], callback);
    });
};

module.exports = {
    addItem,
    clear,
    getItemsWithProducts,
    removeItem,
    setQuantity
};
