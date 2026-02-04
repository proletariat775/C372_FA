const connection = require('../db');

const generateOrderNumber = () => 'ORD-' + Date.now().toString(36).toUpperCase();

/**
 * Create order using FA.sql schema: orders and order_items (with product_variant_id and variant fields).
 */
const create = (userId, cartItems, options, callback) => {
    if (typeof options === 'function') {
        callback = options;
        options = {};
    }

    const {
        shipping_address = null,
        billing_address = null,
        shipping_amount = 0.00,
        payment_method = 'cod',
        payment_status = 'pending',
        status = 'pending',
        discount_amount = 0.00,
        promo_code = null,
        delivery_method = null,
        delivery_address = null,
        delivery_fee = null
    } = options || {};

    if (!Array.isArray(cartItems) || cartItems.length === 0) {
        return callback(new Error('Cart is empty'));
    }

    connection.beginTransaction((tErr) => {
        if (tErr) return callback(tErr);

        const subtotalRaw = cartItems.reduce((sum, it) => {
            const u = Number(it.unit_price || it.price || 0);
            const q = Number(it.quantity || 0);
            return sum + (u * q);
        }, 0);

        const subtotal = Number(subtotalRaw.toFixed(2));
        const tax_amount = 0.00;
        const shipping_amount_safe = Number.isFinite(shipping_amount) ? Number(shipping_amount) : 0.00;
        const discount_amount_safe = Number.isFinite(discount_amount) ? Number(discount_amount) : 0.00;
        const total_amount = Number((subtotal + tax_amount + shipping_amount_safe - discount_amount_safe).toFixed(2));

        const delivery_fee_safe = Number.isFinite(delivery_fee) ? Number(delivery_fee) : shipping_amount_safe;
        const orderSql = `
            INSERT INTO orders (order_number, user_id, status, subtotal, tax_amount, shipping_amount, discount_amount, total_amount, payment_method, payment_status, shipping_address, billing_address, promo_code, delivery_method, delivery_address, delivery_fee)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        connection.query(orderSql, [generateOrderNumber(), userId, status, subtotal, tax_amount, shipping_amount_safe, discount_amount_safe, total_amount, payment_method, payment_status, shipping_address, billing_address, promo_code, delivery_method, delivery_address, delivery_fee_safe], (oErr, oRes) => {
            if (oErr) return connection.rollback(() => callback(oErr));
            const orderId = oRes.insertId;

            // process items sequentially to use FOR UPDATE on variants
            const processNext = () => {
                const item = cartItems.shift();
                if (!item) {
                    return connection.commit((cErr) => {
                        if (cErr) return connection.rollback(() => callback(cErr));
                        return callback(null, { orderId, total_amount, shipping_amount: shipping_amount_safe });
                    });
                }

                const qty = Number(item.quantity || 0);
                if (!Number.isFinite(qty) || qty <= 0) return connection.rollback(() => callback(new Error('Invalid quantity')));

                const variantId = item.product_variant_id || null;

                const workWithVariant = (vid) => {
                    connection.query('SELECT id, product_id, quantity, size, color, sku FROM product_variants WHERE id = ? FOR UPDATE', [vid], (vErr, vRows) => {
                        if (vErr) return connection.rollback(() => callback(vErr));
                        if (!vRows || vRows.length === 0) return connection.rollback(() => callback(new Error('Variant not found')));

                        const available = Number(vRows[0].quantity || 0);
                        if (available < qty) return connection.rollback(() => callback(new Error('Insufficient stock')));

                        const unit_price = Number(item.unit_price || item.price || 0);
                        const total_price = Number((unit_price * qty).toFixed(2));

                        const insertItem = `
                            INSERT INTO order_items (order_id, product_variant_id, product_name, variant_description, size, color, quantity, unit_price, discount_amount, total_price)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `;

                        const variantDesc = vRows[0].sku || '';
                        const size = vRows[0].size || '';
                        const color = vRows[0].color || '';

                        connection.query(insertItem, [orderId, vid, item.product_name || item.productName || '', variantDesc, size, color, qty, unit_price, 0.00, total_price], (insErr) => {
                            if (insErr) return connection.rollback(() => callback(insErr));

                            connection.query('UPDATE product_variants SET quantity = quantity - ? WHERE id = ?', [qty, vid], (uErr) => {
                                if (uErr) return connection.rollback(() => callback(uErr));
                                // decrement product total_quantity
                                connection.query('UPDATE products SET total_quantity = total_quantity - ? WHERE id = ?', [qty, vRows[0].product_id], (pErr) => {
                                    if (pErr) return connection.rollback(() => callback(pErr));
                                    processNext();
                                });
                            });
                        });
                    });
                };

                if (variantId) {
                    workWithVariant(variantId);
                } else {
                    connection.query('SELECT id FROM product_variants WHERE product_id = ? ORDER BY id LIMIT 1 FOR UPDATE', [item.product_id || item.productId], (pvErr, pvRows) => {
                        if (pvErr) return connection.rollback(() => callback(pvErr));
                        if (!pvRows || pvRows.length === 0) return connection.rollback(() => callback(new Error('No variant available')));
                        workWithVariant(pvRows[0].id);
                    });
                }
            };

            processNext();
        });
    });
};

/**
 * Retrieve orders placed by a specific user.
 * @param {number} userId
 * @param {Function} callback
 */
const findByUser = (userId, callback) => {
    const sql = `
        SELECT id, order_number, status, subtotal, tax_amount, shipping_amount, discount_amount, total_amount, payment_method, payment_status, shipping_address, created_at
        FROM orders
        WHERE user_id = ?
            ORDER BY created_at DESC, id DESC
                `;
    connection.query(sql, [userId], callback);
};

const findById = (orderId, callback) => {
    const sql = `
        SELECT *
            FROM orders
        WHERE id = ?
            LIMIT 1
                `;
    connection.query(sql, [orderId], callback);
};

const findAllWithUsers = (callback) => {
    const sql = `
        SELECT
        o.id,
            o.user_id,
            o.order_number,
            o.status,
            o.subtotal,
            o.tax_amount,
            o.shipping_amount,
            o.discount_amount,
            o.total_amount,
            o.payment_method,
            o.shipping_address,
            o.delivery_method,
            o.delivery_address,
            o.delivery_fee,
            o.shipping_provider,
            o.tracking_number,
            o.est_delivery_date,
            o.admin_notes,
            o.total,
            o.created_at,
            u.username,
            u.email,
            u.phone AS phone,
            u.address AS account_address,
            u.first_name,
            u.last_name,
                u.free_delivery
        FROM orders o
        JOIN users u ON u.id = o.user_id
        ORDER BY o.created_at DESC, o.id DESC
            `;
    connection.query(sql, callback);
};

/**
 * Retrieve order items for a list of order ids.
 * @param {number[]} orderIds
 * @param {Function} callback
 */
const findItemsByOrderIds = (orderIds, callback) => {
    if (!Array.isArray(orderIds) || orderIds.length === 0) return callback(null, []);

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
        WHERE oi.order_id IN(?)
        ORDER BY oi.order_id DESC, productName ASC
        `;
    connection.query(sql, [orderIds], callback);
};

/**
 * Retrieve global best-selling products ordered by total quantity sold.
 * @param {number} limit Number of products to fetch
 * @param {Function} callback
 */
const getBestSellers = (limit, callback) => {
    const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 5;
    const sql = `
    SELECT
    p.id,
        p.name AS productName,
            p.price,
            (SELECT pi.image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.is_primary DESC LIMIT 1) AS image,
                p.discount_percent AS discountPercentage,
                    p.description AS offerMessage,
                        SUM(oi.quantity) AS totalSold
        FROM order_items oi
        JOIN product_variants pv ON pv.id = oi.product_variant_id
        JOIN products p ON p.id = pv.product_id
        WHERE p.is_active = 1
        GROUP BY p.id, p.name, p.price, p.discount_percent, p.description
        ORDER BY totalSold DESC
    LIMIT ?
        `;
    connection.query(sql, [safeLimit], callback);
};

const updateDelivery = (orderId, deliveryData, callback) => {
    const {
        shipping_address = null,
        shipping_amount = 0,
        delivery_method = null,
        delivery_address = null,
        delivery_fee = null
    } = deliveryData || {};

    // recalc total_amount using subtotal + tax + shipping - discount
    connection.query('SELECT subtotal, tax_amount, discount_amount FROM orders WHERE id = ? LIMIT 1', [orderId], (err, rows) => {
        if (err) return callback(err);
        if (!rows || rows.length === 0) return callback(new Error('Order not found'));

        const subtotal = Number(rows[0].subtotal || 0);
        const tax = Number(rows[0].tax_amount || 0);
        const discount = Number(rows[0].discount_amount || 0);
        const ship = Number.isFinite(shipping_amount) ? Number(shipping_amount) : 0;
        const total = Number((subtotal + tax + ship - discount).toFixed(2));

        const fee = Number.isFinite(delivery_fee) ? Number(delivery_fee) : ship;
        const sql = `
            UPDATE orders
            SET shipping_address = ?,
                shipping_amount = ?,
                delivery_method = ?,
                delivery_address = ?,
                delivery_fee = ?,
                total_amount = ?
            WHERE id = ?
        `;
        connection.query(sql, [shipping_address, ship, delivery_method, delivery_address, fee, total, orderId], callback);
    });
};

module.exports = {
    create,
    findByUser,
    findById,
    findAllWithUsers,
    findItemsByOrderIds,
    getBestSellers,
    updateDelivery,
    updateAdminOrder: (orderId, updateData, callback) => {
        const {
            status = 'pending',
            shipping_provider = null,
            tracking_number = null,
            est_delivery_date = null,
            admin_notes = null
        } = updateData || {};

        const sql = `
            UPDATE orders
            SET status = ?,
                shipping_provider = ?,
                tracking_number = ?,
                est_delivery_date = ?,
                admin_notes = ?
            WHERE id = ?
        `;
        connection.query(sql, [status, shipping_provider, tracking_number, est_delivery_date, admin_notes, orderId], callback);
    },
    countOpenOrders: (callback) => {
        const sql = `
            SELECT COUNT(*) AS count
            FROM orders
            WHERE status NOT IN ('delivered', 'completed', 'cancelled', 'returned')
        `;
        connection.query(sql, (err, rows) => {
            if (err) return callback(err);
            const count = rows && rows[0] ? Number(rows[0].count || 0) : 0;
            return callback(null, count);
        });
    },
    countDeliveredSince: (days, callback) => {
        const safeDays = Number.isFinite(days) && days > 0 ? Math.floor(days) : 7;
        const sql = `
            SELECT COUNT(*) AS count
            FROM orders
            WHERE status IN ('delivered', 'completed')
              AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        `;
        connection.query(sql, [safeDays], (err, rows) => {
            if (err) return callback(err);
            const count = rows && rows[0] ? Number(rows[0].count || 0) : 0;
            return callback(null, count);
        });
    },
    getRecentOrders: (limit, callback) => {
        const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 5;
        const sql = `
            SELECT
                o.id,
                o.order_number,
                o.status,
                o.total_amount,
                o.created_at,
                o.shipping_address,
                u.username,
                u.email
            FROM orders o
            JOIN users u ON u.id = o.user_id
            ORDER BY o.created_at DESC, o.id DESC
            LIMIT ?
        `;
        connection.query(sql, [safeLimit], callback);
    },
    hasDeliveredProduct: (userId, productId, callback) => {
        const safeUserId = Number(userId);
        const safeProductId = Number(productId);
        if (!Number.isFinite(safeUserId) || !Number.isFinite(safeProductId)) {
            return callback(null, false);
        }
        const sql = `
            SELECT COUNT(*) AS count
            FROM orders o
            JOIN order_items oi ON oi.order_id = o.id
            LEFT JOIN product_variants pv ON pv.id = oi.product_variant_id
            WHERE o.user_id = ? AND o.status = 'completed' AND pv.product_id = ?
        `;
        connection.query(sql, [safeUserId, safeProductId], (err, rows) => {
            if (err) return callback(err);
            const count = rows && rows[0] ? Number(rows[0].count || 0) : 0;
            return callback(null, count > 0);
        });
    }
};
