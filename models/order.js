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
        discount_amount = 0.00,
        promo_code = null
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

        const orderSql = `
            INSERT INTO orders (order_number, user_id, status, subtotal, tax_amount, shipping_amount, discount_amount, total_amount, payment_method, payment_status, shipping_address, billing_address, promo_code)
            VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
        `;

        connection.query(orderSql, [generateOrderNumber(), userId, subtotal, tax_amount, shipping_amount_safe, discount_amount_safe, total_amount, payment_method, shipping_address, billing_address, promo_code], (oErr, oRes) => {
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
            o.total,
            o.created_at,
            o.delivery_method,
            o.delivery_address,
            o.delivery_fee,
            u.username,
            u.email,
            u.phone AS phone,
            u.address AS account_address,
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
    const { shipping_address = null, shipping_amount = 0 } = deliveryData || {};

    // recalc total_amount using subtotal + tax + shipping - discount
    connection.query('SELECT subtotal, tax_amount, discount_amount FROM orders WHERE id = ? LIMIT 1', [orderId], (err, rows) => {
        if (err) return callback(err);
        if (!rows || rows.length === 0) return callback(new Error('Order not found'));

        const subtotal = Number(rows[0].subtotal || 0);
        const tax = Number(rows[0].tax_amount || 0);
        const discount = Number(rows[0].discount_amount || 0);
        const ship = Number.isFinite(shipping_amount) ? Number(shipping_amount) : 0;
        const total = Number((subtotal + tax + ship - discount).toFixed(2));

        const sql = `
            UPDATE orders SET shipping_address = ?, shipping_amount = ?, total_amount = ? WHERE id = ?
        `;
        connection.query(sql, [shipping_address, ship, total, orderId], callback);
    });
};

module.exports = {
    create,
    findByUser,
    findById,
    findAllWithUsers,
    findItemsByOrderIds,
    getBestSellers,
    updateDelivery
};
