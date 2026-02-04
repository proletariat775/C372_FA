const Coupon = require('../models/coupon');
const Product = require('../models/product');

const normalizeCode = (value) => String(value || '').trim();

const normalizeDateTimeInput = (value) => {
    if (value === null || value === undefined) {
        return null;
    }
    const trimmed = String(value).trim();
    if (!trimmed) {
        return null;
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        return `${trimmed} 00:00:00`;
    }

    const normalized = trimmed.replace('T', ' ');
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(normalized)) {
        return `${normalized}:00`;
    }
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(normalized)) {
        return normalized;
    }

    return null;
};

const parseMoney = (value) => {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) {
        return null;
    }
    return Number(parsed.toFixed(2));
};

const parseBoolean = (value) => {
    if (value === true || value === 1 || value === '1') {
        return 1;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim().toLowerCase();
        if (trimmed === 'on' || trimmed === 'true' || trimmed === 'yes') {
            return 1;
        }
    }
    return 0;
};

const buildCouponPayload = (body) => {
    const errors = [];
    const safeBody = body || {};

    const rawCode = normalizeCode(safeBody.code);
    const code = rawCode.toUpperCase();

    if (!code) {
        errors.push('Coupon code is required.');
    }
    if (code && code.length > 50) {
        errors.push('Coupon code must be 50 characters or fewer.');
    }

    const discountType = String(safeBody.discount_type || '').trim();
    if (!['percentage', 'fixed_amount'].includes(discountType)) {
        errors.push('Select a valid discount type.');
    }

    const rawDiscountValue = String(safeBody.discount_value || '').trim();
    const discountValue = rawDiscountValue ? parseMoney(rawDiscountValue) : null;
    if (!rawDiscountValue) {
        errors.push('Discount value is required.');
    } else if (discountValue === null) {
        errors.push('Discount value must be a number.');
    } else if (discountValue <= 0) {
        errors.push('Discount value must be greater than 0.');
    } else if (discountType === 'percentage' && discountValue > 100) {
        errors.push('Percentage discount cannot exceed 100%.');
    }

    const rawMinOrder = String(safeBody.min_order_amount || '').trim();
    let minOrderAmount = 0;
    if (rawMinOrder) {
        const parsed = parseMoney(rawMinOrder);
        if (parsed === null || parsed < 0) {
            errors.push('Minimum order amount must be 0 or greater.');
        } else {
            minOrderAmount = parsed;
        }
    }

    const rawMaxDiscount = String(safeBody.max_discount_amount || '').trim();
    let maxDiscountAmount = null;
    if (rawMaxDiscount) {
        const parsed = parseMoney(rawMaxDiscount);
        if (parsed === null || parsed < 0) {
            errors.push('Maximum discount amount must be 0 or greater.');
        } else {
            maxDiscountAmount = parsed;
        }
    }

    const rawUsageLimit = String(safeBody.usage_limit || '').trim();
    let usageLimit = null;
    if (rawUsageLimit) {
        const parsed = Number.parseInt(rawUsageLimit, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            errors.push('Usage limit must be a positive whole number.');
        } else {
            usageLimit = parsed;
        }
    }

    const rawPerUserLimit = String(safeBody.per_user_limit || '').trim();
    let perUserLimit = null;
    if (rawPerUserLimit) {
        const parsed = Number.parseInt(rawPerUserLimit, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            errors.push('Per-user usage limit must be a positive whole number.');
        } else {
            perUserLimit = parsed;
        }
    }

    const rawBrandId = String(safeBody.brand_id || '').trim();
    let brandId = null;
    if (rawBrandId) {
        const parsed = Number.parseInt(rawBrandId, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            errors.push('Please select a valid brand.');
        } else {
            brandId = parsed;
        }
    }

    const startDateInput = safeBody.start_date;
    const endDateInput = safeBody.end_date;
    const startDate = normalizeDateTimeInput(startDateInput);
    const endDate = normalizeDateTimeInput(endDateInput);

    if (!startDate) {
        errors.push('Start date is required.');
    }
    if (!endDate) {
        errors.push('End date is required.');
    }

    if (startDate && endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
            errors.push('Start and end dates must be valid.');
        } else if (end <= start) {
            errors.push('End date must be after the start date.');
        }
    }

    const isActive = parseBoolean(safeBody.is_active);

    const payload = {
        code,
        discount_type: discountType,
        discount_value: discountValue !== null ? discountValue : 0,
        min_order_amount: minOrderAmount,
        max_discount_amount: maxDiscountAmount,
        start_date: startDate,
        end_date: endDate,
        usage_limit: usageLimit,
        per_user_limit: perUserLimit,
        brand_id: brandId,
        is_active: isActive
    };

    const formData = {
        code: rawCode,
        discount_type: discountType,
        discount_value: rawDiscountValue,
        min_order_amount: rawMinOrder,
        max_discount_amount: rawMaxDiscount,
        start_date: startDateInput || '',
        end_date: endDateInput || '',
        usage_limit: rawUsageLimit,
        per_user_limit: rawPerUserLimit,
        brand_id: rawBrandId,
        is_active: safeBody.is_active ? '1' : '0'
    };

    return { errors, payload, formData };
};

const CouponController = {
    list: (req, res) => {
        Product.getBrandsWithIds((brandErr, brandRows) => {
            if (brandErr) {
                console.error('Error loading brands:', brandErr);
            }

            Coupon.listAll((err, rows) => {
                if (err) {
                    console.error('Error loading coupons:', err);
                    req.flash('error', 'Unable to load coupons.');
                    return res.redirect('/admin/dashboard');
                }

                const formData = req.flash('formData')[0] || {};

                res.render('adminCoupons', {
                    user: req.session.user,
                    coupons: rows || [],
                    brands: brandRows || [],
                    formData,
                    messages: req.flash('success'),
                    errors: req.flash('error')
                });
            });
        });
    },

    create: (req, res) => {
        const { errors, payload, formData } = buildCouponPayload(req.body);

        if (errors.length) {
            errors.forEach((message) => req.flash('error', message));
            req.flash('formData', formData);
            return res.redirect('/admin/coupons');
        }

        Coupon.create(payload, (err) => {
            if (err) {
                console.error('Error creating coupon:', err);
                if (err.code === 'ER_DUP_ENTRY') {
                    req.flash('error', 'A coupon with that code already exists.');
                } else {
                    req.flash('error', 'Unable to create coupon right now.');
                }
                req.flash('formData', formData);
                return res.redirect('/admin/coupons');
            }

            req.flash('success', `Coupon "${payload.code}" created successfully.`);
            return res.redirect('/admin/coupons');
        });
    },

    editForm: (req, res) => {
        const couponId = Number.parseInt(req.params.id, 10);
        if (!Number.isFinite(couponId)) {
            req.flash('error', 'Invalid coupon selected.');
            return res.redirect('/admin/coupons');
        }

        Product.getBrandsWithIds((brandErr, brandRows) => {
            if (brandErr) {
                console.error('Error loading brands:', brandErr);
            }

            Coupon.findById(couponId, (err, coupon) => {
                if (err) {
                    console.error('Error fetching coupon:', err);
                    req.flash('error', 'Unable to load coupon.');
                    return res.redirect('/admin/coupons');
                }

                if (!coupon) {
                    req.flash('error', 'Coupon not found.');
                    return res.redirect('/admin/coupons');
                }

                const formData = req.flash('formData')[0] || {};

                return res.render('editCoupon', {
                    user: req.session.user,
                    coupon,
                    brands: brandRows || [],
                    formData,
                    messages: req.flash('success'),
                    errors: req.flash('error')
                });
            });
        });
    },

    update: (req, res) => {
        const couponId = Number.parseInt(req.params.id, 10);
        if (!Number.isFinite(couponId)) {
            req.flash('error', 'Invalid coupon selected.');
            return res.redirect('/admin/coupons');
        }

        const { errors, payload, formData } = buildCouponPayload(req.body);
        if (errors.length) {
            errors.forEach((message) => req.flash('error', message));
            req.flash('formData', formData);
            return res.redirect(`/admin/coupons/${couponId}/edit`);
        }

        Coupon.update(couponId, payload, (err) => {
            if (err) {
                console.error('Error updating coupon:', err);
                if (err.code === 'ER_DUP_ENTRY') {
                    req.flash('error', 'A coupon with that code already exists.');
                } else {
                    req.flash('error', 'Unable to update coupon right now.');
                }
                req.flash('formData', formData);
                return res.redirect(`/admin/coupons/${couponId}/edit`);
            }

            req.flash('success', `Coupon "${payload.code}" updated successfully.`);
            return res.redirect('/admin/coupons');
        });
    },

    remove: (req, res) => {
        const couponId = Number.parseInt(req.params.id, 10);
        if (!Number.isFinite(couponId)) {
            req.flash('error', 'Invalid coupon selected.');
            return res.redirect('/admin/coupons');
        }

        Coupon.remove(couponId, (err) => {
            if (err) {
                console.error('Error deleting coupon:', err);
                req.flash('error', 'Unable to delete coupon right now.');
                return res.redirect('/admin/coupons');
            }

            req.flash('success', 'Coupon deleted successfully.');
            return res.redirect('/admin/coupons');
        });
    }
};

module.exports = CouponController;
