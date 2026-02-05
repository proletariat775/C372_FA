const db = require('../db');

/**
 * Create a user record in the database.
 * @param {Object} userData - User fields to insert.
 * @param {Function} callback - Node-style callback (err, results).
 */
const create = (userData, callback) => {
    const {
        username,
        email,
        password,
        first_name = null,
        last_name = null,
        address = null,
        city = null,
        state = null,
        zip_code = null,
        country = null,
        phone = null,
        role = 'customer'
    } = userData;

    const sql = `INSERT INTO users (username, email, password, first_name, last_name, address, city, state, zip_code, country, phone, role)
                 VALUES (?, ?, SHA1(?), ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const values = [username, email, password, first_name, last_name, address, city, state, zip_code, country, phone, role];
    console.log('User.create SQL:', sql.replace(/\s+/g, ' ').trim());
    console.log('User.create values:', values);

    db.query(sql, values, callback);
};

/**
 * Retrieve a user by email.
 * @param {string} email - The email to search for.
 * @param {Function} callback - Node-style callback (err, results).
 */
const findByEmail = (email, callback) => {
    const sql = `SELECT id, username, email, first_name, last_name, address, city, state, zip_code, country, phone, role, loyalty_points, created_at, updated_at
                 FROM users WHERE email = ?`;
    db.query(sql, [email], callback);
};

/**
 * Retrieve a user by email and plain-text password.
 * @param {string} email - The user's email address.
 * @param {string} password - The user's plain-text password.
 * @param {Function} callback - Node-style callback (err, results).
 */
const findByEmailAndPassword = (email, password, callback) => {
    const sql = `SELECT id, username, email, first_name, last_name, address, city, state, zip_code, country, phone, role, loyalty_points, created_at, updated_at
                 FROM users WHERE email = ? AND password = SHA1(?)`;
    db.query(sql, [email, password], callback);
};

/**
 * Retrieve all users.
 * @param {Function} callback - Node-style callback (err, results).
 */
const findAll = (callback) => {
    const sql = `SELECT id, username, email, first_name, last_name, role, phone, address, city, state, zip_code, country, loyalty_points, created_at, updated_at FROM users`;
    db.query(sql, callback);
};

/**
 * Retrieve a user by id.
 * @param {number} id - User id.
 * @param {Function} callback - Node-style callback (err, results).
 */
const findById = (id, callback) => {
    const sql = `SELECT id, username, email, first_name, last_name, role, phone, address, city, state, zip_code, country, loyalty_points, created_at, updated_at FROM users WHERE id = ?`;
    db.query(sql, [id], callback);
};

/**
 * Permanently delete a user.
 * @param {number} id - User id.
 * @param {Function} callback - Node-style callback (err, results).
 */
const remove = (id, callback) => {
    const sql = 'DELETE FROM users WHERE id = ?';
    db.query(sql, [id], callback);
};

/**
 * Update a user's role.
 * @param {number} id - User id.
 * @param {string} role - New role.
 * @param {Function} callback - Node-style callback (err, results).
 */
const updateRole = (id, role, callback) => {
    const sql = 'UPDATE users SET role = ? WHERE id = ?';
    db.query(sql, [role, id], callback);
};

/**
 * Update a user's profile and permissions.
 * @param {number} id - User id.
 * @param {Object} data - Fields to update.
 * @param {Function} callback - Node-style callback (err, results).
 */
const update = (id, data, callback) => {
    const {
        username,
        email,
        first_name = null,
        last_name = null,
        address = null,
        city = null,
        state = null,
        zip_code = null,
        country = null,
        phone = null,
        role = 'customer'
    } = data;

    const sql = `
        UPDATE users
        SET username = ?, email = ?, first_name = ?, last_name = ?, address = ?, city = ?, state = ?, zip_code = ?, country = ?, phone = ?, role = ?, updated_at = NOW()
        WHERE id = ?
    `;

    db.query(sql, [username, email, first_name, last_name, address, city, state, zip_code, country, phone, role, id], callback);
};

module.exports = {
    create,
    findByEmail,
    findByEmailAndPassword,
    findAll,
    findById,
    remove,
    updateRole,
    update
};
