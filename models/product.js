const connection = require('../db');

// Adapter over the FA.sql schema so existing controllers/views keep using familiar fields.
const Product = {
    getAll: (callback) => {
        const sql = `
            SELECT p.*,
                (SELECT pi.image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.is_primary DESC, pi.id LIMIT 1) AS image,
                (SELECT IFNULL(SUM(pv.quantity), 0) FROM product_variants pv WHERE pv.product_id = p.id) AS quantity,
                (SELECT c.name FROM categories c WHERE c.id = p.category_id) AS category_name
            FROM products p
            WHERE p.is_active = 1
            ORDER BY p.name ASC
        `;
        connection.query(sql, callback);
    },

    getByCategory: (category, callback) => {
        const sql = `
            SELECT p.*,
                (SELECT pi.image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.is_primary DESC, pi.id LIMIT 1) AS image,
                (SELECT IFNULL(SUM(pv.quantity), 0) FROM product_variants pv WHERE pv.product_id = p.id) AS quantity,
                (SELECT c.name FROM categories c WHERE c.id = p.category_id) AS category_name
            FROM products p
            INNER JOIN categories cat ON cat.id = p.category_id
            WHERE p.is_active = 1 AND cat.name = ?
            ORDER BY p.name ASC
        `;
        connection.query(sql, [category], callback);
    },

    getCategories: (callback) => {
        const sql = 'SELECT name FROM categories WHERE is_active = 1 ORDER BY name ASC';
        connection.query(sql, callback);
    },

    getById: (productId, callback) => {
        const sql = `
            SELECT p.*,
                (SELECT pi.image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.is_primary DESC, pi.id LIMIT 1) AS image,
                (SELECT IFNULL(SUM(pv.quantity), 0) FROM product_variants pv WHERE pv.product_id = p.id) AS quantity,
                (SELECT c.name FROM categories c WHERE c.id = p.category_id) AS category_name
            FROM products p
            WHERE p.id = ? AND p.is_active = 1
            LIMIT 1
        `;
        connection.query(sql, [productId], callback);
    },

    // Create product and a default variant + primary image if provided
    create: (productData, callback) => {
        const {
            name,
            total_quantity = 0,
            price = 0.0,
            discount_percent = 0,
            description = null,
            category = null,
            image = null
        } = productData;

        // ensure category exists (create if missing)
        const findCategory = (cb) => {
            if (!category) return cb(null, null);
            connection.query('SELECT id FROM categories WHERE name = ? LIMIT 1', [category], (err, rows) => {
                if (err) return cb(err);
                if (rows && rows.length) return cb(null, rows[0].id);
                // create category
                connection.query('INSERT INTO categories (name, slug) VALUES (?, ?)', [category, category.toLowerCase().replace(/\s+/g, '-')], (cErr, res) => {
                    if (cErr) return cb(cErr);
                    return cb(null, res.insertId);
                });
            });
        };

        findCategory((catErr, categoryId) => {
            if (catErr) return callback(catErr);

            const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Date.now();
            const sku = 'SKU-' + Math.random().toString(36).slice(2, 9).toUpperCase();
            const insertSql = `
                INSERT INTO products (name, slug, description, sku, brand_id, category_id, gender, price, compare_price, cost_price, discount_percent, is_featured, is_active, total_quantity)
                VALUES (?, ?, ?, ?, NULL, ?, 'unisex', ?, NULL, NULL, ?, 0, 1, ?)
            `;

            connection.query(insertSql, [name, slug, description, sku, categoryId, price, discount_percent, total_quantity], (err, result) => {
                if (err) return callback(err);
                const productId = result.insertId;

                const tasks = [];

                if (image) {
                    tasks.push((cb) => {
                        connection.query('INSERT INTO product_images (product_id, image_url, alt_text, is_primary) VALUES (?, ?, ?, 1)', [productId, image, name], cb);
                    });
                }

                // create a default variant so cart logic can reference a product_variant
                tasks.push((cb) => {
                    const variantSku = sku + '-V1';
                    connection.query('INSERT INTO product_variants (product_id, size, color, quantity, sku, image_url) VALUES (?, ?, ?, ?, ?, ?)', [productId, 'OneSize', 'Default', total_quantity, variantSku, image], cb);
                });

                // run tasks sequentially
                const runNext = () => {
                    const t = tasks.shift();
                    if (!t) return callback(null, { insertId: productId });
                    t((tErr) => {
                        if (tErr) return callback(tErr);
                        runNext();
                    });
                };

                runNext();
            });
        });
    },

    update: (productId, productData, callback) => {
        const {
            name,
            total_quantity = 0,
            price = 0.0,
            discount_percent = 0,
            description = null,
            category = null,
            image = null
        } = productData;

        const findCategory = (cb) => {
            if (!category) return cb(null, null);
            connection.query('SELECT id FROM categories WHERE name = ? LIMIT 1', [category], (err, rows) => {
                if (err) return cb(err);
                if (rows && rows.length) return cb(null, rows[0].id);
                connection.query('INSERT INTO categories (name, slug) VALUES (?, ?)', [category, category.toLowerCase().replace(/\s+/g, '-')], (cErr, res) => {
                    if (cErr) return cb(cErr);
                    return cb(null, res.insertId);
                });
            });
        };

        findCategory((catErr, categoryId) => {
            if (catErr) return callback(catErr);

            const updateSql = `
                UPDATE products SET name = ?, description = ?, price = ?, discount_percent = ?, category_id = ?, total_quantity = ? WHERE id = ?
            `;

            connection.query(updateSql, [name, description, price, discount_percent, categoryId, total_quantity, productId], (err) => {
                if (err) return callback(err);

                const tasks = [];
                if (image) {
                    // update or insert primary image
                    tasks.push((cb) => {
                        connection.query('SELECT id FROM product_images WHERE product_id = ? ORDER BY is_primary DESC LIMIT 1', [productId], (iErr, rows) => {
                            if (iErr) return cb(iErr);
                            if (rows && rows.length) {
                                connection.query('UPDATE product_images SET image_url = ?, alt_text = ? WHERE id = ?', [image, name, rows[0].id], cb);
                            } else {
                                connection.query('INSERT INTO product_images (product_id, image_url, alt_text, is_primary) VALUES (?, ?, ?, 1)', [productId, image, name], cb);
                            }
                        });
                    });
                }

                // update first variant quantity if exists
                tasks.push((cb) => {
                    connection.query('UPDATE product_variants SET quantity = ? WHERE product_id = ? LIMIT 1', [total_quantity, productId], cb);
                });

                const runNext = () => {
                    const t = tasks.shift();
                    if (!t) return callback(null, { affectedRows: 1 });
                    t((tErr) => {
                        if (tErr) return callback(tErr);
                        runNext();
                    });
                };

                runNext();
            });
        });
    },

    delete: (productId, callback) => {
        const sql = 'UPDATE products SET is_active = 0 WHERE id = ?';
        connection.query(sql, [productId], callback);
    }
};

module.exports = Product;
