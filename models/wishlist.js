//I declare that this code was written by me. 
// I will not copy or allow others to copy my code. 
// I understand that copying code is considered as plagiarism.

// Student Name: Zoey Liaw En Yi
// Student ID:24049473
// Class: 
// Date created:


const connection = require('../db');

const Wishlist = {
    getByUser: (userId, callback) => {
        const sql = `
            SELECT
                w.product_id,
                w.created_at AS saved_at,
                p.name AS productName,
                p.price,
                p.discount_percent AS discountPercentage,
                p.description AS offerMessage,
                (SELECT pi.image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.is_primary DESC, pi.id LIMIT 1) AS image
            FROM wishlist w
            JOIN products p ON p.id = w.product_id
            WHERE w.user_id = ? AND p.is_active = 1
            ORDER BY w.created_at DESC
        `;
        connection.query(sql, [userId], callback);
    },

    add: (userId, productId, callback) => {
        const sql = 'INSERT IGNORE INTO wishlist (user_id, product_id) VALUES (?, ?)';
        connection.query(sql, [userId, productId], callback);
    },

    remove: (userId, productId, callback) => {
        const sql = 'DELETE FROM wishlist WHERE user_id = ? AND product_id = ?';
        connection.query(sql, [userId, productId], callback);
    },

    exists: (userId, productId, callback) => {
        const sql = 'SELECT id FROM wishlist WHERE user_id = ? AND product_id = ? LIMIT 1';
        connection.query(sql, [userId, productId], callback);
    }
};

module.exports = Wishlist;
