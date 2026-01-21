const db = require('../db');

/**
 * Get all cart items for a user, joined with product data.
 * @param {number} userId
 * @param {Function} callback
 */
const getItemsWithProducts = (userId, callback) => {
    const sql = `
        SELECT
            c.product_id,
            c.quantity,
            p.productName,
            p.price,
            p.discountPercentage,
            p.offerMessage,
            p.image
        FROM cart c
        INNER JOIN products p ON p.id = c.product_id AND p.is_deleted = 0
        WHERE c.user_id = ?
    `;
    db.query(sql, [userId], callback);
};

const assertActiveProduct = (productId, callback) => {
    const sql = 'SELECT id FROM products WHERE id = ? AND is_deleted = 0';
    db.query(sql, [productId], (err, rows) => {
        if (err) {
            return callback(err);
        }
        if (!rows || rows.length === 0) {
            return callback(new Error('Product is unavailable.'));
        }
        return callback();
    });
};

/**
 * Add or increment an item in the cart.
 * @param {number} userId
 * @param {number} productId
 * @param {number} quantity
 * @param {Function} callback
 */
const addItem = (userId, productId, quantity, callback) => {
    assertActiveProduct(productId, (activeErr) => {
        if (activeErr) {
            return callback(activeErr);
        }

        const updateSql = 'UPDATE cart SET quantity = quantity + ? WHERE user_id = ? AND product_id = ?';
        db.query(updateSql, [quantity, userId, productId], (updateErr, result) => {
            if (updateErr) {
                return callback(updateErr);
            }
            if (result.affectedRows > 0) {
                return callback(null, result);
            }

            const insertSql = 'INSERT INTO cart (user_id, product_id, quantity) VALUES (?, ?, ?)';
            return db.query(insertSql, [userId, productId, quantity], callback);
        });
    });
};

/**
 * Set an item's quantity; removes the item if quantity <= 0.
 * @param {number} userId
 * @param {number} productId
 * @param {number} quantity
 * @param {Function} callback
 */
const setQuantity = (userId, productId, quantity, callback) => {
    if (quantity <= 0) {
        return removeItem(userId, productId, callback);
    }
    assertActiveProduct(productId, (activeErr) => {
        if (activeErr) {
            return removeItem(userId, productId, () => callback(activeErr));
        }
        const sql = 'UPDATE cart SET quantity = ? WHERE user_id = ? AND product_id = ?';
        db.query(sql, [quantity, userId, productId], callback);
    });
};

/**
 * Remove a single item from the cart.
 * @param {number} userId
 * @param {number} productId
 * @param {Function} callback
 */
const removeItem = (userId, productId, callback) => {
    const sql = 'DELETE FROM cart WHERE user_id = ? AND product_id = ?';
    db.query(sql, [userId, productId], callback);
};

/**
 * Clear all cart items for a user.
 * @param {number} userId
 * @param {Function} callback
 */
const clear = (userId, callback) => {
    const sql = 'DELETE FROM cart WHERE user_id = ?';
    db.query(sql, [userId], callback);
};

module.exports = {
    addItem,
    clear,
    getItemsWithProducts,
    removeItem,
    setQuantity
};
