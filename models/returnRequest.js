const connection = require('../db');

const RETURN_PREFIX = 'RETURN_REQUEST:';

const parseReturnNotes = (notes) => {
    if (!notes) {
        return null;
    }
    const index = notes.indexOf(RETURN_PREFIX);
    if (index === -1) {
        return null;
    }
    const payload = notes.slice(index + RETURN_PREFIX.length).trim();
    if (!payload) {
        return null;
    }
    try {
        return JSON.parse(payload);
    } catch (error) {
        return null;
    }
};

const buildReturnNotes = (notes, data) => {
    const serialized = `${RETURN_PREFIX}${JSON.stringify(data)}`;
    if (!notes) {
        return serialized;
    }

    const index = notes.indexOf(RETURN_PREFIX);
    if (index === -1) {
        return `${notes}\n${serialized}`.trim();
    }

    return `${notes.slice(0, index)}${serialized}`.trim();
};

const ReturnRequest = {
    getByOrderId: (orderId, callback) => {
        const sql = 'SELECT admin_notes FROM orders WHERE id = ? LIMIT 1';
        connection.query(sql, [orderId], (err, rows) => {
            if (err) return callback(err);
            const notes = rows && rows[0] ? rows[0].admin_notes : null;
            return callback(null, parseReturnNotes(notes));
        });
    },

    upsert: (orderId, data, callback) => {
        const sql = 'SELECT admin_notes FROM orders WHERE id = ? LIMIT 1';
        connection.query(sql, [orderId], (err, rows) => {
            if (err) return callback(err);
            if (!rows || !rows.length) return callback(new Error('Order not found'));

            const updatedNotes = buildReturnNotes(rows[0].admin_notes, data);
            connection.query('UPDATE orders SET admin_notes = ? WHERE id = ?', [updatedNotes, orderId], callback);
        });
    }
};

module.exports = ReturnRequest;
