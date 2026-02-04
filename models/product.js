const connection = require('../db');

// Adapter over the FA.sql schema so existing controllers/views keep using familiar fields.
const Product = {
    getAll: (callback) => {
        const sql = `
            SELECT p.*,
                (SELECT pi.image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.is_primary DESC, pi.id LIMIT 1) AS image,
                (SELECT IFNULL(SUM(pv.quantity), 0) FROM product_variants pv WHERE pv.product_id = p.id) AS quantity,
                (SELECT pv.id FROM product_variants pv WHERE pv.product_id = p.id ORDER BY pv.quantity DESC, pv.id ASC LIMIT 1) AS default_variant_id,
                (SELECT pv.size FROM product_variants pv WHERE pv.product_id = p.id ORDER BY pv.quantity DESC, pv.id ASC LIMIT 1) AS default_variant_size,
                (SELECT c.name FROM categories c WHERE c.id = p.category_id) AS category_name,
                (SELECT b.name FROM brands b WHERE b.id = p.brand_id) AS brand_name
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
                (SELECT pv.id FROM product_variants pv WHERE pv.product_id = p.id ORDER BY pv.quantity DESC, pv.id ASC LIMIT 1) AS default_variant_id,
                (SELECT pv.size FROM product_variants pv WHERE pv.product_id = p.id ORDER BY pv.quantity DESC, pv.id ASC LIMIT 1) AS default_variant_size,
                (SELECT c.name FROM categories c WHERE c.id = p.category_id) AS category_name,
                (SELECT b.name FROM brands b WHERE b.id = p.brand_id) AS brand_name
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

    getBrands: (callback) => {
        const sql = 'SELECT name FROM brands WHERE is_active = 1 ORDER BY name ASC';
        connection.query(sql, callback);
    },

    getBrandsWithIds: (callback) => {
        const sql = 'SELECT id, name FROM brands WHERE is_active = 1 ORDER BY name ASC';
        connection.query(sql, callback);
    },

    getFiltered: (filters, callback) => {
        const { category, brand, q, sort } = filters || {};
        let sql = `
            SELECT p.*,
                (SELECT pi.image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.is_primary DESC, pi.id LIMIT 1) AS image,
                (SELECT IFNULL(SUM(pv.quantity), 0) FROM product_variants pv WHERE pv.product_id = p.id) AS quantity,
                (SELECT pv.id FROM product_variants pv WHERE pv.product_id = p.id ORDER BY pv.quantity DESC, pv.id ASC LIMIT 1) AS default_variant_id,
                (SELECT pv.size FROM product_variants pv WHERE pv.product_id = p.id ORDER BY pv.quantity DESC, pv.id ASC LIMIT 1) AS default_variant_size,
                cat.name AS category_name,
                b.name AS brand_name
            FROM products p
            LEFT JOIN categories cat ON cat.id = p.category_id
            LEFT JOIN brands b ON b.id = p.brand_id
            WHERE p.is_active = 1
        `;

        const params = [];

        if (category) {
            sql += ' AND cat.name = ?';
            params.push(category);
        }

        if (brand) {
            sql += ' AND b.name = ?';
            params.push(brand);
        }

        if (q) {
            sql += ' AND (p.name LIKE ? OR p.description LIKE ?)';
            const like = `%${q}%`;
            params.push(like, like);
        }

        switch (sort) {
            case 'newest':
                sql += ' ORDER BY p.created_at DESC';
                break;
            case 'price_asc':
                sql += ' ORDER BY p.price ASC';
                break;
            case 'price_desc':
                sql += ' ORDER BY p.price DESC';
                break;
            default:
                sql += ' ORDER BY p.name ASC';
                break;
        }

        connection.query(sql, params, callback);
    },

    getById: (productId, callback) => {
        const sql = `
            SELECT p.*,
                (SELECT pi.image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.is_primary DESC, pi.id LIMIT 1) AS image,
                (SELECT IFNULL(SUM(pv.quantity), 0) FROM product_variants pv WHERE pv.product_id = p.id) AS quantity,
                (SELECT pv.id FROM product_variants pv WHERE pv.product_id = p.id ORDER BY pv.quantity DESC, pv.id ASC LIMIT 1) AS default_variant_id,
                (SELECT pv.size FROM product_variants pv WHERE pv.product_id = p.id ORDER BY pv.quantity DESC, pv.id ASC LIMIT 1) AS default_variant_size,
                (SELECT c.name FROM categories c WHERE c.id = p.category_id) AS category_name,
                (SELECT b.name FROM brands b WHERE b.id = p.brand_id) AS brand_name
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
            brand = null,
            imageFront = null,
            imageBack = null,
            image = null,
            sizeQuantities = null
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

        const findBrand = (cb) => {
            if (!brand) return cb(null, null);
            connection.query('SELECT id FROM brands WHERE name = ? LIMIT 1', [brand], (err, rows) => {
                if (err) return cb(err);
                if (rows && rows.length) return cb(null, rows[0].id);
                const slug = brand.toLowerCase().replace(/\s+/g, '-');
                connection.query('INSERT INTO brands (name, slug) VALUES (?, ?)', [brand, slug], (bErr, res) => {
                    if (bErr) return cb(bErr);
                    return cb(null, res.insertId);
                });
            });
        };

        findCategory((catErr, categoryId) => {
            if (catErr) return callback(catErr);
            findBrand((brandErr, brandId) => {
                if (brandErr) return callback(brandErr);

                const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Date.now();
                const sku = 'SKU-' + Math.random().toString(36).slice(2, 9).toUpperCase();
                const insertSql = `
                    INSERT INTO products (name, slug, description, sku, brand_id, category_id, gender, price, compare_price, cost_price, discount_percent, is_featured, is_active, total_quantity)
                    VALUES (?, ?, ?, ?, ?, ?, 'unisex', ?, NULL, NULL, ?, 0, 1, ?)
                `;

                connection.query(insertSql, [name, slug, description, sku, brandId, categoryId, price, discount_percent, total_quantity], (err, result) => {
                    if (err) return callback(err);
                    const productId = result.insertId;

                    const tasks = [];
                    const primaryImage = imageFront || image || null;
                    const secondaryImage = imageBack || null;
                    const sizeEntries = sizeQuantities && typeof sizeQuantities === 'object'
                        ? Object.entries(sizeQuantities).filter(([size, qty]) => Number.isFinite(qty))
                        : [];

                    if (primaryImage) {
                        tasks.push((cb) => {
                            connection.query(
                                'INSERT INTO product_images (product_id, image_url, alt_text, is_primary, sort_order) VALUES (?, ?, ?, 1, 0)',
                                [productId, primaryImage, name],
                                cb
                            );
                        });
                    }

                    if (secondaryImage) {
                        tasks.push((cb) => {
                            connection.query(
                                'INSERT INTO product_images (product_id, image_url, alt_text, is_primary, sort_order) VALUES (?, ?, ?, 0, 1)',
                                [productId, secondaryImage, name + ' back'],
                                cb
                            );
                        });
                    }

                    if (sizeEntries.length) {
                        sizeEntries.forEach(([size, qty], index) => {
                            tasks.push((cb) => {
                                const cleanedSize = String(size || '').replace(/[^a-z0-9]/gi, '').toUpperCase() || `V${index + 1}`;
                                const variantSku = `${sku}-${cleanedSize}-${index + 1}`;
                                connection.query(
                                    'INSERT INTO product_variants (product_id, size, color, quantity, sku, image_url) VALUES (?, ?, ?, ?, ?, ?)',
                                    [productId, size, null, qty, variantSku, primaryImage],
                                    cb
                                );
                            });
                        });
                    } else {
                        // create a default variant so cart logic can reference a product_variant
                        tasks.push((cb) => {
                            const variantSku = sku + '-V1';
                            connection.query(
                                'INSERT INTO product_variants (product_id, size, color, quantity, sku, image_url) VALUES (?, ?, ?, ?, ?, ?)',
                                [productId, 'OneSize', 'Default', total_quantity, variantSku, primaryImage],
                                cb
                            );
                        });
                    }

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
            brand = null,
            imageFront = null,
            imageBack = null,
            image = null,
            sizeQuantities = null
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
            const findBrand = (cb) => {
                if (!brand) return cb(null, null);
                connection.query('SELECT id FROM brands WHERE name = ? LIMIT 1', [brand], (err, rows) => {
                    if (err) return cb(err);
                    if (rows && rows.length) return cb(null, rows[0].id);
                    const slug = brand.toLowerCase().replace(/\s+/g, '-');
                    connection.query('INSERT INTO brands (name, slug) VALUES (?, ?)', [brand, slug], (bErr, res) => {
                        if (bErr) return cb(bErr);
                        return cb(null, res.insertId);
                    });
                });
            };

            findBrand((brandErr, brandId) => {
                if (brandErr) return callback(brandErr);

                const updateSql = `
                    UPDATE products SET name = ?, description = ?, price = ?, discount_percent = ?, brand_id = ?, category_id = ?, total_quantity = ? WHERE id = ?
                `;

                connection.query(updateSql, [name, description, price, discount_percent, brandId, categoryId, total_quantity, productId], (err) => {
                    if (err) return callback(err);

                    const tasks = [];
                    const primaryImage = imageFront || image || null;
                    const secondaryImage = imageBack || null;
                    const sizeEntries = sizeQuantities && typeof sizeQuantities === 'object'
                        ? Object.entries(sizeQuantities).filter(([size, qty]) => Number.isFinite(qty))
                        : [];

                    if (primaryImage) {
                        tasks.push((cb) => {
                            connection.query('SELECT id FROM product_images WHERE product_id = ? AND is_primary = 1 ORDER BY id LIMIT 1', [productId], (iErr, rows) => {
                                if (iErr) return cb(iErr);
                                if (rows && rows.length) {
                                    connection.query('UPDATE product_images SET image_url = ?, alt_text = ? WHERE id = ?', [primaryImage, name, rows[0].id], cb);
                                } else {
                                    connection.query('INSERT INTO product_images (product_id, image_url, alt_text, is_primary, sort_order) VALUES (?, ?, ?, 1, 0)', [productId, primaryImage, name], cb);
                                }
                            });
                        });
                    }

                    if (secondaryImage) {
                        tasks.push((cb) => {
                            connection.query('SELECT id FROM product_images WHERE product_id = ? AND is_primary = 0 ORDER BY sort_order ASC, id ASC LIMIT 1', [productId], (iErr, rows) => {
                                if (iErr) return cb(iErr);
                                if (rows && rows.length) {
                                    connection.query('UPDATE product_images SET image_url = ?, alt_text = ? WHERE id = ?', [secondaryImage, name + ' back', rows[0].id], cb);
                                } else {
                                    connection.query('INSERT INTO product_images (product_id, image_url, alt_text, is_primary, sort_order) VALUES (?, ?, ?, 0, 1)', [productId, secondaryImage, name + ' back'], cb);
                                }
                            });
                        });
                    }

                    if (sizeEntries.length) {
                        tasks.push((cb) => {
                            const runNext = (index) => {
                                if (index >= sizeEntries.length) {
                                    return cb();
                                }
                                const [size, qty] = sizeEntries[index];
                                connection.query('SELECT id FROM product_variants WHERE product_id = ? AND size = ? LIMIT 1', [productId, size], (vErr, rows) => {
                                    if (vErr) return cb(vErr);
                                    if (rows && rows.length) {
                                        connection.query('UPDATE product_variants SET quantity = ? WHERE id = ?', [qty, rows[0].id], (uErr) => {
                                            if (uErr) return cb(uErr);
                                            return runNext(index + 1);
                                        });
                                    } else {
                                        const cleanedSize = String(size || '').replace(/[^a-z0-9]/gi, '').toUpperCase() || `V${index + 1}`;
                                        const variantSku = `SKU-${productId}-${cleanedSize}-${Date.now().toString(36).slice(-4)}`;
                                        connection.query(
                                            'INSERT INTO product_variants (product_id, size, color, quantity, sku, image_url) VALUES (?, ?, ?, ?, ?, ?)',
                                            [productId, size, null, qty, variantSku, primaryImage],
                                            (iErr) => {
                                                if (iErr) return cb(iErr);
                                                return runNext(index + 1);
                                            }
                                        );
                                    }
                                });
                            };
                            runNext(0);
                        });
                    } else {
                        // update first variant quantity if exists
                        tasks.push((cb) => {
                            connection.query('UPDATE product_variants SET quantity = ? WHERE product_id = ? LIMIT 1', [total_quantity, productId], cb);
                        });
                    }

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
        });
    },

    delete: (productId, callback) => {
        const sql = 'UPDATE products SET is_active = 0 WHERE id = ?';
        connection.query(sql, [productId], callback);
    },

    getImages: (productId, callback) => {
        const sql = `
            SELECT image_url, is_primary
            FROM product_images
            WHERE product_id = ?
            ORDER BY is_primary DESC, sort_order ASC, id ASC
            LIMIT 2
        `;
        connection.query(sql, [productId], callback);
    },

    getVariants: (productId, callback) => {
        const sql = `
            SELECT id, size, color, quantity
            FROM product_variants
            WHERE product_id = ?
            ORDER BY id ASC
        `;
        connection.query(sql, [productId], callback);
    },

    getDefaultVariant: (productId, callback) => {
        const sql = `
            SELECT id, size, quantity
            FROM product_variants
            WHERE product_id = ?
            ORDER BY quantity DESC, id ASC
            LIMIT 1
        `;
        connection.query(sql, [productId], callback);
    },

    getVariantById: (variantId, callback) => {
        const sql = `
            SELECT
                pv.id AS variant_id,
                pv.product_id,
                pv.size,
                pv.color,
                pv.quantity AS variant_quantity,
                p.name,
                p.price,
                p.discount_percent,
                p.description,
                p.brand_id,
                b.name AS brand_name,
                (SELECT pi.image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.is_primary DESC, pi.id LIMIT 1) AS image
            FROM product_variants pv
            JOIN products p ON p.id = pv.product_id
            LEFT JOIN brands b ON b.id = p.brand_id
            WHERE pv.id = ? AND p.is_active = 1
            LIMIT 1
        `;
        connection.query(sql, [variantId], callback);
    },

    getInventorySummary: (callback) => {
        const sql = `
            SELECT
                COUNT(*) AS totalProducts,
                IFNULL(SUM(total_quantity), 0) AS totalUnits
            FROM products
            WHERE is_active = 1
        `;
        connection.query(sql, (err, rows) => {
            if (err) return callback(err);
            return callback(null, rows && rows[0] ? rows[0] : { totalProducts: 0, totalUnits: 0 });
        });
    }
};

module.exports = Product;
