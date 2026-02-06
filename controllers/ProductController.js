//I declare that this code was written by me. 
// I will not copy or allow others to copy my code. 
// I understand that copying code is considered as plagiarism.
 
// Student Name: Wong De En Amos
// Student ID: 24042274
// Class: C372-002
// Date created: 06/02/2026
const Product = require('../models/product');
const Review = require('../models/review');
const OrderReview = require('../models/orderReview');
const Order = require('../models/order');
const ProductDetails = require('../models/productDetails');
const sizeGuideService = require('../services/sizeGuideService');
const bundleService = require('../services/bundleService');

const normalizeSizeLabel = (raw) => {
    if (!raw) {
        return null;
    }
    const cleaned = String(raw).trim().toUpperCase().replace(/_/g, '-');
    if (cleaned === 'ONE-SIZE' || cleaned === 'ONESIZE') {
        return 'OneSize';
    }
    if (['3XS', '2XS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'].includes(cleaned)) {
        return cleaned;
    }
    return cleaned;
};

const normalizeProductType = (value) => {
    if (String(value || '').toLowerCase() === 'pants') {
        return 'pants';
    }
    return 'shirt';
};

const inferProductType = (product) => {
    if (!product) {
        return 'shirt';
    }
    const rawType = product.product_type || product.productType;
    if (rawType === 'shirt' || rawType === 'pants') {
        return rawType;
    }
    const category = String(product.category_name || product.category || '').toLowerCase();
    if (category.includes('pant')) {
        return 'pants';
    }
    return 'shirt';
};

const parseSizeKey = (key) => {
    if (!key || !key.startsWith('size_')) {
        return null;
    }
    const token = key.replace(/^size_/, '');
    return normalizeSizeLabel(token);
};

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

const parseSizeQuantities = (body) => {
    const sizeQuantities = {};
    let totalQuantity = 0;
    let hasAny = false;

    if (!body) {
        return { sizeQuantities, totalQuantity, hasAny };
    }

    Object.keys(body).forEach((key) => {
        if (!key.startsWith('size_')) {
            return;
        }
        const sizeLabel = parseSizeKey(key);
        if (!sizeLabel) {
            return;
        }
        const raw = body[key];
        if (raw === null || typeof raw === 'undefined' || raw === '') {
            return;
        }
        const qty = Number.parseInt(raw, 10);
        if (!Number.isFinite(qty) || qty < 0) {
            return;
        }
        sizeQuantities[sizeLabel] = qty;
        totalQuantity += qty;
        hasAny = true;
    });

    return {
        sizeQuantities,
        totalQuantity,
        hasAny
    };
};

const buildProductPayload = (body, image, sizeInfo) => {
    const {
        name,
        quantity,
        price,
        discount,
        offer,
        category,
        brand,
        productType
    } = body;

    const fallbackQuantity = Math.max(0, Number.parseInt(quantity, 10) || 0);
    const totalQuantity = sizeInfo && sizeInfo.hasAny ? sizeInfo.totalQuantity : fallbackQuantity;

    return {
        name: name ? name.trim() : '',
        total_quantity: totalQuantity,
        price: toCurrency(price),
        discount_percent: clampDiscount(discount),
        description: normaliseOfferMessage(offer),
        brand: brand ? brand.trim() : null,
        imageFront: image && image.front ? image.front : null,
        imageBack: image && image.back ? image.back : null,
        image: image && image.single ? image.single : null,
        category: category ? category.trim() || 'General' : 'General',
        product_type: normalizeProductType(productType),
        sizeQuantities: sizeInfo && sizeInfo.hasAny ? sizeInfo.sizeQuantities : null
    };
};

const resolveCategory = (body) => {
    const selected = body && body.category ? String(body.category).trim() : '';
    const custom = body && body.newCategory ? String(body.newCategory).trim() : '';
    if (selected && selected !== '__new__') {
        return selected;
    }

    if (selected === '__new__') {
        return custom || null;
    }

    return custom || null;
};

const resolveBrand = (body) => {
    const selected = body && body.brand ? String(body.brand).trim() : '';
    const custom = body && body.newBrand ? String(body.newBrand).trim() : '';
    if (selected && selected !== '__new__') {
        return selected;
    }

    if (selected === '__new__') {
        return custom || null;
    }

    return custom || null;
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
        brand: product.brand_name || product.brand || null,
        productType: inferProductType(product),
        quantity: Number(product.quantity || product.total_quantity || 0),
        image: product.image || null,
        defaultVariantId: product.default_variant_id || product.defaultVariantId || null,
        defaultVariantSize: product.default_variant_size || product.defaultVariantSize || null,
        // keep other raw fields available if needed
        raw: product
    };
};

const ensureSessionCart = (req) => {
    if (!Array.isArray(req.session.cart)) {
        req.session.cart = [];
    }
    return req.session.cart;
};

const buildCartItem = (product, variant, quantity) => {
    const basePrice = toCurrency(product.price);
    const discountPercentage = clampDiscount(product.discount_percent || product.discountPercentage);
    const hasDiscount = discountPercentage > 0;
    const finalPrice = hasDiscount
        ? toCurrency(basePrice * (1 - discountPercentage / 100))
        : basePrice;

    const variantId = variant && (variant.id || variant.variant_id || variant.variantId)
        ? Number(variant.id || variant.variant_id || variant.variantId)
        : (product.defaultVariantId || product.default_variant_id || null);
    const size = variant && variant.size ? variant.size : (product.defaultVariantSize || product.default_variant_size || null);

    const cartItem = {
        productId: product.id,
        variantId,
        product_variant_id: variantId,
        size,
        productName: product.name || product.productName,
        brandId: product.brand_id || product.brandId || null,
        brand: product.brand || product.brand_name || null,
        category: product.category || product.category_name || null,
        price: finalPrice,
        quantity,
        image: product.image || null,
        hasDiscount
    };

    if (hasDiscount) {
        cartItem.originalPrice = basePrice;
        cartItem.discountPercentage = discountPercentage;
        cartItem.offerMessage = normaliseOfferMessage(product.description || product.offerMessage);
    }

    return cartItem;
};

const buildStyleBundles = (products) => {
    const bundles = [];
    const used = new Set();

    const addBundle = (title, items) => {
        const available = items.filter(item => item && !used.has(item.id));
        if (available.length < 2) {
            return;
        }
        const selected = available.slice(0, 3);
        selected.forEach(item => used.add(item.id));
        bundles.push({
            title,
            items: selected,
            discountRate: 0.1
        });
    };

    const byBrand = products.reduce((acc, product) => {
        const key = product.brand || '';
        if (!key) {
            return acc;
        }
        if (!acc[key]) {
            acc[key] = [];
        }
        acc[key].push(product);
        return acc;
    }, {});

    Object.keys(byBrand).forEach((brand) => {
        if (bundles.length >= 3) {
            return;
        }
        addBundle(`${brand} essentials`, byBrand[brand]);
    });

    if (bundles.length < 2) {
        const byCategory = products.reduce((acc, product) => {
            const key = product.category || '';
            if (!key) {
                return acc;
            }
            if (!acc[key]) {
                acc[key] = [];
            }
            acc[key].push(product);
            return acc;
        }, {});

        Object.keys(byCategory).forEach((category) => {
            if (bundles.length >= 3) {
                return;
            }
            addBundle(`${category} mix`, byCategory[category]);
        });
    }

    if (bundles.length === 0 && products.length >= 2) {
        addBundle('Everyday essentials', products);
    }

    return bundles.slice(0, 3);
};

const escapeMetaAttr = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const buildProductMeta = (product) => {
    const siteName = 'Shirt Shop';
    const siteTagline = 'Quality Shirts';
    const metaTitle = product
        ? `${product.productName} | ${siteName}`
        : `${siteName} - ${siteTagline}`;
    const metaDescription = product
        ? (product.offerMessage || product.description || `Buy ${product.productName} at ${siteName}`)
        : `${siteName} - quality shirts for every occasion.`;
    const metaImage = product && product.image
        ? `/images/${product.image}`
        : '/images/shirt-sample-1.svg';
    const structuredData = {
        '@context': 'https://schema.org/',
        '@type': 'Product',
        name: product ? product.productName : 'Shirt Shop Product',
        image: [metaImage],
        description: metaDescription,
        offers: {
            '@type': 'Offer',
            priceCurrency: 'USD',
            price: product ? Number(product.effectivePrice || product.price).toFixed(2) : '0.00',
            availability: product && product.quantity > 0
                ? 'https://schema.org/InStock'
                : 'https://schema.org/OutOfStock'
        }
    };
    const extraHead = [
        `<meta name="description" content="${escapeMetaAttr(metaDescription)}">`,
        `<meta property="og:title" content="${escapeMetaAttr(metaTitle)}">`,
        `<meta property="og:description" content="${escapeMetaAttr(metaDescription)}">`,
        `<meta property="og:image" content="${escapeMetaAttr(metaImage)}">`,
        '<meta property="og:type" content="product">',
        '<meta name="twitter:card" content="summary_large_image">',
        `<meta name="twitter:title" content="${escapeMetaAttr(metaTitle)}">`,
        `<meta name="twitter:description" content="${escapeMetaAttr(metaDescription)}">`,
        `<meta name="twitter:image" content="${escapeMetaAttr(metaImage)}">`,
        `<script type="application/ld+json">${JSON.stringify(structuredData).replace(/</g, '\\u003c')}</script>`
    ].join('\n');

    return { metaTitle, extraHead };
};

const fetchRelatedProducts = (product, callback) => {
    const category = product && product.category ? String(product.category).trim() : '';
    if (!category) {
        return callback(null, []);
    }

    Product.getByCategory(category, (error, rows) => {
        if (error) {
            return callback(error);
        }

        const related = (rows || [])
            .map(enhanceProductRecord)
            .filter((item) => Number(item.id) !== Number(product.id))
            .slice(0, 3);

        return callback(null, related);
    });
};

const fetchProductImages = (productId, callback) => {
    Product.getImages(productId, (err, rows) => {
        if (err) {
            return callback(err);
        }
        return callback(null, rows || []);
    });
};

const fetchProductVariants = (productId, callback) => {
    Product.getVariants(productId, (err, rows) => {
        if (err) {
            return callback(err);
        }
        return callback(null, rows || []);
    });
};

const buildReviewSummary = (reviews) => {
    const summary = {
        total: reviews.length,
        average: null,
        counts: {
            5: 0,
            4: 0,
            3: 0,
            2: 0,
            1: 0
        }
    };

    if (!reviews.length) {
        return summary;
    }

    let totalScore = 0;
    reviews.forEach((review) => {
        const rating = Number(review.rating || 0);
        if (rating >= 1 && rating <= 5) {
            summary.counts[rating] += 1;
            totalScore += rating;
        }
    });

    summary.average = Number((totalScore / reviews.length).toFixed(1));
    return summary;
};

const ProductController = {
    showShopping: (req, res) => {
        const activeCategory = req.query.category ? String(req.query.category).trim() : '';
        const activeBrand = req.query.brand ? String(req.query.brand).trim() : '';
        const searchQuery = req.query.q ? String(req.query.q).trim() : '';
        const activeSort = req.query.sort ? String(req.query.sort).trim() : '';
        const hasFilters = Boolean(activeCategory || activeBrand || searchQuery || activeSort);
        const productFetcher = hasFilters
            ? (cb) => Product.getFiltered({
                category: activeCategory,
                brand: activeBrand,
                q: searchQuery,
                sort: activeSort
            }, cb)
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

                Product.getBrands((brandErr, brandRows) => {
                    if (brandErr) {
                        console.error('Error loading brands:', brandErr);
                    }

                    const productList = (products || []).map(enhanceProductRecord);
                    const visibleProducts = productList.filter((product) => Number(product.quantity || 0) > 0);
                    const categories = (categoryRows || []).map((row) => row.name || row.category).filter(Boolean);
                    const brands = (brandRows || []).map((row) => row.name).filter(Boolean);
                    const bundles = buildStyleBundles(visibleProducts);

                    Order.getBestSellers(3, (bestErr, bestSellers) => {
                        if (bestErr) {
                            console.error('Error fetching best sellers:', bestErr);
                        }

                        res.render('shopping', {
                            user: req.session.user,
                            products: visibleProducts,
                            categories,
                            brands,
                            activeCategory,
                            activeBrand,
                            activeSort,
                            searchQuery,
                            bundles,
                            bestSellers: (bestSellers && bestSellers.length)
                                ? bestSellers.map(enhanceProductRecord).filter((product) => Number(product.quantity || 0) > 0)
                                : [],
                            messages: req.flash('success'),
                            errors: req.flash('error')
                        });
                    });
                });
            });
        });
    },

    // Show the inventory page
    showInventory: (req, res) => {
        const searchQuery = req.query.q ? String(req.query.q).trim().toLowerCase() : '';
        const categoryFilter = req.query.category ? String(req.query.category).trim() : '';
        const lowStockOnly = req.query.lowStock === '1';

        Product.getAll((error, results) => {
            if (error) throw error;
            const products = (results || []).map(enhanceProductRecord);
            const categories = Array.from(new Set(products.map(item => item.category || 'General'))).sort();

            const filtered = products.filter((product) => {
                if (categoryFilter && product.category !== categoryFilter) {
                    return false;
                }
                if (lowStockOnly && Number(product.quantity || 0) >= 10) {
                    return false;
                }
                if (searchQuery) {
                    const haystack = `${product.productName} ${product.brand || ''}`.toLowerCase();
                    if (!haystack.includes(searchQuery)) {
                        return false;
                    }
                }
                return true;
            });

            res.render('inventory', {
                products: filtered,
                categories,
                searchQuery,
                activeCategory: categoryFilter,
                lowStockOnly,
                user: req.session.user,
                messages: req.flash('success'),
                errors: req.flash('error')
            });
        });
    },

    // Show the add product page
    showAddProductForm: (req, res) => {
        Product.getCategories((catErr, categoryRows) => {
            if (catErr) {
                console.error('Error fetching categories:', catErr);
            }
            Product.getBrands((brandErr, brandRows) => {
                if (brandErr) {
                    console.error('Error fetching brands:', brandErr);
                }

                const categories = (categoryRows || [])
                    .map((row) => row.name || row.category)
                    .filter(Boolean);
                const brands = (brandRows || [])
                    .map((row) => row.name)
                    .filter(Boolean);

                res.render('addProduct', {
                    user: req.session.user,
                    categories,
                    brands,
                    messages: req.flash('success'),
                    errors: req.flash('error')
                });
            });
        });
    },

    // Handle product creation
    addProduct: (req, res) => {
        const imageFront = req.files && req.files.imageFront ? req.files.imageFront[0].filename : null;
        const imageBack = req.files && req.files.imageBack ? req.files.imageBack[0].filename : null;
        const image = req.files && req.files.image ? req.files.image[0].filename : null;
        const resolvedCategory = resolveCategory(req.body);
        const resolvedBrand = resolveBrand(req.body);
        const sizeInfo = parseSizeQuantities(req.body);
        const resolvedProductType = normalizeProductType(req.body.productType);
        req.body.productType = resolvedProductType;

        if (!resolvedCategory) {
            req.flash('error', 'Please choose a category or enter a new category name.');
            return res.redirect('/addProduct');
        }

        req.body.category = resolvedCategory;
        req.body.brand = resolvedBrand;
        const productData = buildProductPayload(req.body, { front: imageFront, back: imageBack, single: image }, sizeInfo);
        const detailsData = {
            description: req.body.description,
            fitType: resolvedProductType === 'pants' ? null : req.body.fitType,
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
                fetchProductVariants(productId, (variantErr, variantRows) => {
                    if (variantErr) {
                        console.error('Error fetching product variants:', variantErr);
                    }

                    const sizeQuantities = {};
                    (variantRows || []).forEach((variant) => {
                        if (variant && variant.size) {
                            sizeQuantities[variant.size] = Number(variant.quantity || 0);
                        }
                    });

                    ProductDetails.findByProductId(productId, (detailErr, detailRows) => {
                        if (detailErr) {
                            console.error('Error fetching product details:', detailErr);
                        }

                        fetchProductImages(productId, (imageErr, imageRows) => {
                            if (imageErr) {
                                console.error('Error fetching product images:', imageErr);
                            }

                            Product.getCategories((catErr, categoryRows) => {
                                if (catErr) {
                                    console.error('Error fetching categories:', catErr);
                                }

                                Product.getBrands((brandErr, brandRows) => {
                                    if (brandErr) {
                                        console.error('Error fetching brands:', brandErr);
                                    }

                                    const product = enhanceProductRecord(results[0]);
                                    const categories = (categoryRows || [])
                                        .map((row) => row.name || row.category)
                                        .filter(Boolean);
                                    const brands = (brandRows || [])
                                        .map((row) => row.name)
                                        .filter(Boolean);

                                    if (product.category && !categories.includes(product.category)) {
                                        categories.unshift(product.category);
                                    }
                                    if (product.brand && !brands.includes(product.brand)) {
                                        brands.unshift(product.brand);
                                    }

                                    res.render('updateProduct', {
                                        user: req.session.user,
                                        product,
                                        productDetails: detailRows && detailRows.length ? detailRows[0] : {},
                                        productImages: imageRows || [],
                                        categories,
                                        brands,
                                        sizeQuantities,
                                        errors: req.flash('error'),
                                        messages: req.flash('success')
                                    });
                                });
                            });
                        });
                    });
                });
            } else {
                res.status(404).send('Product not found');
            }
        });
    },

    // Handle product update
    updateProduct: (req, res) => {
        const productId = req.params.id;
        const imageFront = req.files && req.files.imageFront ? req.files.imageFront[0].filename : null;
        const imageBack = req.files && req.files.imageBack ? req.files.imageBack[0].filename : null;
        let image = req.body.currentImage;
        if (req.files && req.files.image) {
            image = req.files.image[0].filename;
        }

        const resolvedCategory = resolveCategory(req.body);
        const resolvedBrand = resolveBrand(req.body);
        if (!resolvedCategory) {
            req.flash('error', 'Please choose a category or enter a new category name.');
            return res.redirect(`/updateProduct/${productId}`);
        }

        req.body.category = resolvedCategory;
        req.body.brand = resolvedBrand;
        req.body.productType = normalizeProductType(req.body.productType);
        const sizeInfo = parseSizeQuantities(req.body);
        console.log('DEBUG:updateProduct parsed sizeInfo ->', JSON.stringify(sizeInfo));
        console.log('DEBUG:updateProduct body size keys ->', Object.keys(req.body).filter(k => String(k).startsWith('size_')));
        const productData = buildProductPayload(req.body, { front: imageFront, back: imageBack, single: image }, sizeInfo);
        const detailsData = {
            description: req.body.description,
            fitType: req.body.productType === 'pants' ? null : req.body.fitType,
            material: req.body.material,
            color: req.body.color,
            sizeRange: req.body.sizeRange,
            care: req.body.care
        };

        if (!productData.name) {
            req.flash('error', 'Product name is required.');
            return res.redirect(`/updateProduct/${productId}`);
        }

        Product.update(productId, productData, (error, results) => {
            if (error) {
                console.error("Error updating product:", error);
                res.status(500).send('Error updating product');
            } else {
                ProductDetails.create(productId, detailsData, (detailErr) => {
                    if (detailErr) {
                        console.error('Error updating product details:', detailErr);
                        req.flash('error', 'Product updated, but shirt details could not be saved.');
                    }
                    req.flash('success', `Product "${productData.name}" updated successfully.`);
                    res.redirect('/inventory');
                });
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
                const isAdmin = req.session.user && req.session.user.role === 'admin';
                if (!isAdmin && Number(product.quantity || 0) <= 0) {
                    req.flash('error', 'This item is out of stock.');
                    return res.redirect('/shopping');
                }
                fetchProductImages(productId, (imageErr, productImages) => {
                    if (imageErr) {
                        console.error('Error fetching product images:', imageErr);
                    }

                    fetchProductVariants(productId, (variantErr, productVariants) => {
                        if (variantErr) {
                            console.error('Error fetching product variants:', variantErr);
                        }
                        const visibleVariants = isAdmin
                            ? (productVariants || [])
                            : (productVariants || []).filter((variant) => Number(variant.quantity || 0) > 0);

                        ProductDetails.findByProductId(productId, (detailError, detailResults) => {
                            if (detailError) {
                                console.error('Error fetching product details:', detailError);
                            }

                            const productDetails = detailResults && detailResults.length ? detailResults[0] : null;
                            const productType = inferProductType({ ...product, product_type: product.productType });
                            const defaultFitType = sizeGuideService.normalizeFitType(productDetails && productDetails.fitType);

                            OrderReview.findByProduct(productId, (orderReviewErr, orderReviewRows) => {
                                if (orderReviewErr) {
                                    console.error('Error fetching order reviews for product:', orderReviewErr);
                                }

                                Review.findByProduct(productId, (reviewError, reviewResults) => {
                                    if (reviewError) {
                                        console.error('Error fetching reviews for product:', reviewError);
                                    }

                                    const reviews = [...(orderReviewRows || []), ...(reviewResults || [])];
                                    const summary = buildReviewSummary(reviews);
                                    const averageRating = summary.average;

                                    const fetchUserOrderReview = (cb) => {
                                        if (!req.session.user || req.session.user.role !== 'customer') {
                                            return cb(null, null);
                                        }
                                        return OrderReview.findByUserAndProduct(req.session.user.id, Number(productId), (err, rows) => {
                                            if (err) return cb(err);
                                            return cb(null, rows && rows.length ? rows[0] : null);
                                        });
                                    };

                                    fetchUserOrderReview((userErr, userReview) => {
                                        if (userErr) {
                                            console.error('Error fetching user review for product:', userErr);
                                        }

                                        const checkReviewEligibility = (cb) => {
                                            if (!req.session.user || req.session.user.role !== 'customer') {
                                                return cb(null, false);
                                            }
                                            return Order.hasDeliveredProduct(req.session.user.id, Number(productId), cb);
                                        };

                                        checkReviewEligibility((eligErr, canReview) => {
                                            if (eligErr) {
                                                console.error('Error checking review eligibility:', eligErr);
                                            }

                                            fetchRelatedProducts(product, (relatedError, relatedProducts) => {
                                                if (relatedError) {
                                                    console.error('Error fetching related products:', relatedError);
                                                }
                                                const visibleRelated = isAdmin
                                                    ? (relatedProducts || [])
                                                    : (relatedProducts || []).filter((item) => Number(item.quantity || 0) > 0);

                                                const { metaTitle, extraHead } = buildProductMeta(product);

                                                res.render('product', {
                                                    product,
                                                    productType,
                                                    defaultFitType,
                                                    productDetails,
                                                    productImages: productImages || [],
                                                    productVariants: visibleVariants,
                                                    user: req.session.user,
                                                    metaTitle,
                                                    extraHead,
                                                    reviews,
                                                    relatedProducts: visibleRelated,
                                                    averageRating,
                                                    reviewSummary: summary,
                                                    userReview,
                                                    canReview: Boolean(canReview),
                                                    shirtSizeChart: sizeGuideService.getShirtSizeChart(),
                                                    pantsSizeChart: sizeGuideService.getPantsSizeChart(),
                                                    fitNotes: sizeGuideService.SHIRT_FIT_NOTES,
                                                    cmToIn: sizeGuideService.cmToIn,
                                                    sizeGuideDisclaimer: sizeGuideService.SIZE_DISCLAIMER,
                                                    messages: req.flash('success'),
                                                    errors: req.flash('error')
                                                });
                                            });
                                        });
                                    });
                                });
                            });
                        });
                    });
                });
            } else {
                res.status(404).send('Product not found');
            }
        });
    },

    addBundleToCart: (req, res) => {
        const rawIds = req.body.productIds;
        const idList = Array.isArray(rawIds) ? rawIds : [rawIds];
        const productIds = idList
            .map(id => Number.parseInt(id, 10))
            .filter(id => Number.isFinite(id));

        if (!productIds.length) {
            req.flash('error', 'Unable to add this bundle. Please try again.');
            return res.redirect('/shopping');
        }

        bundleService.registerBundleDefinition(req.session, {
            productIds,
            discountRate: 0.1
        });

        const cart = ensureSessionCart(req);
        const addedIds = [];
        const issues = [];

        const processNext = (index) => {
            if (index >= productIds.length) {
                if (issues.length) {
                    issues.forEach(issue => req.flash('error', issue));
                }

                if (addedIds.length >= 2) {
                    req.session.bundle = {
                        productIds: addedIds,
                        discountRate: 0.1
                    };
                }

                if (addedIds.length) {
                    req.flash('success', 'Bundle items added to your cart.');
                    return res.redirect('/cart');
                }

                req.flash('error', 'No bundle items could be added.');
                return res.redirect('/shopping');
            }

            const productId = productIds[index];
            Product.getById(productId, (error, results) => {
                if (error) {
                    issues.push('Unable to load one of the bundle items.');
                    return processNext(index + 1);
                }

                if (!results || results.length === 0) {
                    issues.push('A bundle item is no longer available.');
                    return processNext(index + 1);
                }

                const product = results[0];
                Product.getDefaultVariant(productId, (variantErr, variantRows) => {
                    if (variantErr) {
                        issues.push('Unable to load size availability for a bundle item.');
                        return processNext(index + 1);
                    }

                    const variant = variantRows && variantRows[0];
                    if (!variant) {
                        issues.push(`No size options available for "${product.name || product.productName}".`);
                        return processNext(index + 1);
                    }

                    const stock = Number.parseInt(variant.quantity, 10) || 0;
                    if (stock <= 0) {
                        issues.push(`"${product.name || product.productName}" is out of stock.`);
                        return processNext(index + 1);
                    }

                    const existing = cart.find(item => Number(item.variantId) === Number(variant.id));
                    const desiredQty = existing ? existing.quantity + 1 : 1;

                    if (desiredQty > stock) {
                        issues.push(`Only ${stock} units available for "${product.name || product.productName}".`);
                        return processNext(index + 1);
                    }

                    const updatedItem = buildCartItem(product, variant, desiredQty);
                    if (existing) {
                        Object.assign(existing, updatedItem);
                    } else {
                        cart.push(updatedItem);
                    }

                    addedIds.push(productId);
                    return processNext(index + 1);
                });
            });
        };

        return processNext(0);
    }
};

module.exports = ProductController;
