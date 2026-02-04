const Product = require('../models/product');
const Review = require('../models/review');
const Order = require('../models/order');
const ProductDetails = require('../models/productDetails');

const toCurrency = (value, precision = 2) => {
    const numberValue = Number.parseFloat(value);
    if (!Number.isFinite(numberValue) || numberValue < 0) {
        return 0;
    }
    return Number(numberValue.toFixed(precision));
};

const clampDiscount = (value) => {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return 0;
    }
    if (parsed > 100) {
        return 100;
    }
    // products.discount_percent is an INT in the current schema.
    return Math.round(parsed);
};

const normaliseOfferMessage = (message) => {
    if (!message) {
        return null;
    }
    const trimmed = message.trim();
    if (!trimmed) {
        return null;
    }
    return trimmed.slice(0, 255);
};

const buildProductPayload = (body, image) => {
    const {
        name,
        quantity,
        price,
        discount,
        offer,
        category
    } = body;

    return {
        name: name ? name.trim() : '',
        total_quantity: Math.max(0, Number.parseInt(quantity, 10) || 0),
        price: toCurrency(price),
        discount_percent: clampDiscount(discount),
        description: normaliseOfferMessage(offer),
        image: image || null,
        category: category ? category.trim() || 'General' : 'General'
    };
};

const resolveCategory = (body) => {
    const selected = body && body.category ? String(body.category).trim() : '';
    const custom = body && body.newCategory ? String(body.newCategory).trim() : '';
    const allowed = ['T-shirt', 'Pants'];

    if (allowed.includes(selected)) {
        return selected;
    }

    if (selected === '__new__') {
        return custom || null;
    }

    return null;
};

const enhanceProductRecord = (product) => {
    if (!product) {
        return product;
    }
    const basePrice = toCurrency(product.price);
    const discountPercentage = clampDiscount(product.discount_percent || product.discountPercentage);
    const hasDiscount = discountPercentage > 0;
    const finalPrice = hasDiscount
        ? toCurrency(basePrice * (1 - discountPercentage / 100))
        : basePrice;

    return {
        id: product.id,
        productName: product.name || product.productName,
        price: basePrice,
        discountPercentage,
        offerMessage: normaliseOfferMessage(product.description || product.offerMessage),
        effectivePrice: finalPrice,
        hasDiscount,
        category: product.category_name || product.category || 'General',
        quantity: Number(product.quantity || product.total_quantity || 0),
        image: product.image || null,
        // keep other raw fields available if needed
        raw: product
    };
};

const ProductController = {
    showShopping: (req, res) => {
        const activeCategory = req.query.category ? String(req.query.category).trim() : '';
        const productFetcher = activeCategory
            ? (cb) => Product.getByCategory(activeCategory, cb)
            : (cb) => Product.getAll(cb);

        productFetcher((error, products) => {
            if (error) {
                console.error('Error loading products:', error);
                req.flash('error', 'Unable to load products right now.');
                return res.redirect('/');
            }

            Product.getCategories((catErr, categoryRows) => {
                if (catErr) {
                    console.error('Error loading categories:', catErr);
                }

                const productList = (products || []).map(enhanceProductRecord);
                const categories = (categoryRows || []).map((row) => row.category).filter(Boolean);

                Order.getBestSellers(3, (bestErr, bestSellers) => {
                    if (bestErr) {
                        console.error('Error fetching best sellers:', bestErr);
                    }

                    res.render('shopping', {
                        user: req.session.user,
                        products: productList,
                        categories,
                        activeCategory,
                        bestSellers: (bestSellers && bestSellers.length) ? bestSellers.map(enhanceProductRecord) : [],
                        messages: req.flash('success'),
                        errors: req.flash('error')
                    });
                });
            });
        });
    },

    // Show the inventory page
    showInventory: (req, res) => {
        Product.getAll((error, results) => {
            if (error) throw error;
            const products = (results || []).map(enhanceProductRecord);
            res.render('inventory', {
                products,
                user: req.session.user,
                messages: req.flash('success'),
                errors: req.flash('error')
            });
        });
    },

    // Show the add product page
    showAddProductForm: (req, res) => {
        res.render('addProduct', {
            user: req.session.user,
            messages: req.flash('success'),
            errors: req.flash('error')
        });
    },

    // Handle product creation
    addProduct: (req, res) => {
        const image = req.file ? req.file.filename : null;
        const resolvedCategory = resolveCategory(req.body);

        if (!resolvedCategory) {
            req.flash('error', 'Please choose T-shirt, Pants, or enter a new category name.');
            return res.redirect('/addProduct');
        }

        req.body.category = resolvedCategory;
        const productData = buildProductPayload(req.body, image);
        const detailsData = {
            description: req.body.description,
            fitType: req.body.fitType,
            material: req.body.material,
            color: req.body.color,
            sizeRange: req.body.sizeRange,
            care: req.body.care
        };

        if (!productData.name) {
            req.flash('error', 'Product name is required.');
            return res.redirect('/addProduct');
        }

        Product.create(productData, (error, results) => {
            if (error) {
                console.error("Error adding product:", error);
                res.status(500).send('Error adding product');
            } else {
                const productId = results && results.insertId ? results.insertId : null;
                if (!productId) {
                    req.flash('success', `Product "${productData.name}" added successfully.`);
                    return res.redirect('/inventory');
                }

                // TEAM START - insert shirt-specific details
                ProductDetails.create(productId, detailsData, (detailErr) => {
                    if (detailErr) {
                        console.error('Error saving product details:', detailErr);
                        req.flash('error', 'Product added, but shirt details could not be saved.');
                    }
                    req.flash('success', `Product "${productData.name}" added successfully.`);
                    return res.redirect('/inventory');
                });
                // TEAM END - insert shirt-specific details
            }
        });
    },

    // Show the update product form
    showUpdateProductForm: (req, res) => {
        const productId = req.params.id;
        Product.getById(productId, (error, results) => {
            if (error) throw error;
            if (results.length > 0) {
                res.render('updateProduct', {
                    product: enhanceProductRecord(results[0]),
                    errors: req.flash('error'),
                    messages: req.flash('success')
                });
            } else {
                res.status(404).send('Product not found');
            }
        });
    },

    // Handle product update
    updateProduct: (req, res) => {
        const productId = req.params.id;
        let image = req.body.currentImage;

        if (req.file) {
            image = req.file.filename;
        }

        const productData = buildProductPayload(req.body, image);

        if (!productData.name) {
            req.flash('error', 'Product name is required.');
            return res.redirect(`/updateProduct/${productId}`);
        }

        Product.update(productId, productData, (error, results) => {
            if (error) {
                console.error("Error updating product:", error);
                res.status(500).send('Error updating product');
            } else {
                req.flash('success', `Product "${productData.name}" updated successfully.`);
                res.redirect('/inventory');
            }
        });
    },

    // Handle product deletion
    deleteProduct: (req, res) => {
        const productId = req.params.id;

        Product.delete(productId, (error, results) => {
            if (error) {
                console.error("Error deleting product:", error);
                res.status(500).send('Error deleting product');
            } else {
                req.flash('success', 'Product deleted successfully.');
                res.redirect('/inventory');
            }
        });
    },

    // Show individual product details
    showProductDetails: (req, res) => {
        const productId = req.params.id;

        Product.getById(productId, (error, results) => {
            if (error) throw error;
            if (results.length > 0) {
                const product = enhanceProductRecord(results[0]);
                ProductDetails.findByProductId(productId, (detailError, detailResults) => {
                    if (detailError) {
                        console.error('Error fetching product details:', detailError);
                    }

                    const productDetails = detailResults && detailResults.length ? detailResults[0] : null;

                    Review.findByProduct(productId, (reviewError, reviewResults) => {
                        if (reviewError) {
                            console.error('Error fetching reviews for product:', reviewError);
                        }

                        const reviews = reviewResults || [];
                        const averageRating = reviews.length
                            ? (reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0) / reviews.length)
                            : null;

                        const userReview = req.session.user
                            ? reviews.find(review => review.user_id === req.session.user.id)
                            : null;

                        res.render('product', {
                            product,
                            productDetails,
                            user: req.session.user,
                            reviews,
                            averageRating,
                            userReview,
                            messages: req.flash('success'),
                            errors: req.flash('error')
                        });
                    });
                });
            } else {
                res.status(404).send('Product not found');
            }
        });
    }
};

module.exports = ProductController;
