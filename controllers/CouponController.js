const crypto = require('crypto');
const Coupon = require('../models/coupon');
const Product = require('../models/product');
const loyaltyService = require('../services/loyaltyService');

const ECOPOINTS_VOUCHER_COST = 100;
const ECOPOINTS_VOUCHER_VALUE = 5;
const ECOPOINTS_VOUCHER_DAYS = 30;

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

const toNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const toMysqlDateTime = (date) => {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        return null;
    }
    return date.toISOString().slice(0, 19).replace('T', ' ');
};

const generateEcoVoucherCode = (userId) => {
    const safeUserId = Number.parseInt(userId, 10);
    const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
    return `ECO5-${Number.isFinite(safeUserId) ? safeUserId : 'USER'}-${suffix}`;
};

const buildEcoVoucherPayload = (code, userId) => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (ECOPOINTS_VOUCHER_DAYS * 24 * 60 * 60 * 1000));

    return {
        code,
        discount_type: 'fixed_amount',
        discount_value: ECOPOINTS_VOUCHER_VALUE,
        min_order_amount: 0,
        max_discount_amount: ECOPOINTS_VOUCHER_VALUE,
        start_date: toMysqlDateTime(now),
        end_date: toMysqlDateTime(expiresAt),
        usage_limit: 1,
        per_user_limit: 1,
        brand_id: null,
        owner_user_id: userId,
        is_active: 1
    };
};

const createCoupon = (payload) => new Promise((resolve, reject) => {
    Coupon.create(payload, (err, result) => {
        if (err) {
            return reject(err);
        }
        return resolve(result);
    });
});

const deactivateCoupon = (couponId) => new Promise((resolve) => {
    if (!Number.isFinite(Number(couponId))) {
        return resolve();
    }
    Coupon.remove(couponId, () => resolve());
});

const mapAvailableCoupon = (coupon) => {
    const endDate = coupon && coupon.end_date ? new Date(coupon.end_date) : null;
    const nowMs = Date.now();
    const expirySeconds = endDate && !Number.isNaN(endDate.getTime())
        ? Math.max(0, Math.floor((endDate.getTime() - nowMs) / 1000))
        : null;

    return {
        id: coupon.id,
        code: coupon.code,
        discountType: coupon.discount_type,
        discountValue: toNumber(coupon.discount_value),
        minOrderAmount: toNumber(coupon.min_order_amount),
        maxDiscountAmount: coupon.max_discount_amount !== null && coupon.max_discount_amount !== undefined
            ? toNumber(coupon.max_discount_amount)
            : null,
        brandName: coupon.brand_name || null,
        usageLimit: coupon.usage_limit !== null && coupon.usage_limit !== undefined
            ? toNumber(coupon.usage_limit)
            : null,
        usageCount: toNumber(coupon.usage_count),
        perUserLimit: coupon.per_user_limit !== null && coupon.per_user_limit !== undefined
            ? toNumber(coupon.per_user_limit)
            : null,
        userUsageCount: toNumber(coupon.user_usage_count),
        globalRemaining: coupon.global_remaining !== null && coupon.global_remaining !== undefined
            ? toNumber(coupon.global_remaining)
            : null,
        userRemaining: coupon.user_remaining !== null && coupon.user_remaining !== undefined
            ? toNumber(coupon.user_remaining)
            : null,
        startDate: coupon.start_date,
        endDate: coupon.end_date,
        expirySeconds
    };
};

const loadAvailableCoupons = (userId, callback) => {
    Coupon.listAvailableForUser(userId, (err, rows) => {
        if (err) {
            return callback(err);
        }

        const coupons = (rows || []).map(mapAvailableCoupon);
        return callback(null, coupons);
    });
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
    },

    availablePage: (req, res) => {
        const userId = req.session.user && req.session.user.id;
        loadAvailableCoupons(userId, async (err, coupons) => {
            let loyaltyBalance = 0;
            try {
                loyaltyBalance = await loyaltyService.getBalance(userId);
            } catch (balanceErr) {
                console.error('Error loading EcoPoints balance for coupons page:', balanceErr);
            }

            if (err) {
                console.error('Error loading available coupons:', err);
                req.flash('error', 'Unable to load available coupons right now.');
                return res.render('availableCoupons', {
                    user: req.session.user,
                    coupons: [],
                    loyaltyBalance,
                    ecoVoucherCost: ECOPOINTS_VOUCHER_COST,
                    ecoVoucherValue: ECOPOINTS_VOUCHER_VALUE,
                    ecoVoucherDays: ECOPOINTS_VOUCHER_DAYS,
                    messages: req.flash('success'),
                    errors: req.flash('error')
                });
            }

            return res.render('availableCoupons', {
                user: req.session.user,
                coupons,
                loyaltyBalance,
                ecoVoucherCost: ECOPOINTS_VOUCHER_COST,
                ecoVoucherValue: ECOPOINTS_VOUCHER_VALUE,
                ecoVoucherDays: ECOPOINTS_VOUCHER_DAYS,
                messages: req.flash('success'),
                errors: req.flash('error')
            });
        });
    },

    availableJson: (req, res) => {
        const userId = req.session.user && req.session.user.id;
        loadAvailableCoupons(userId, (err, coupons) => {
            if (err) {
                console.error('Error loading available coupons JSON:', err);
                return res.status(500).json({
                    success: false,
                    message: 'Unable to load available coupons right now.',
                    coupons: []
                });
            }

            return res.json({
                success: true,
                coupons
            });
        });
    },

    redeemEcoPointsVoucher: async (req, res) => {
        const user = req.session.user;
        if (!user || user.role !== 'customer') {
            req.flash('error', 'Only shoppers can redeem EcoPoints vouchers.');
            return res.redirect('/user/coupons');
        }

        let loyaltyBalance = 0;
        try {
            loyaltyBalance = await loyaltyService.getBalance(user.id);
        } catch (balanceErr) {
            console.error('Error loading EcoPoints balance for voucher redemption:', balanceErr);
            req.flash('error', 'Unable to verify your EcoPoints balance right now.');
            return res.redirect('/user/coupons');
        }

        if (loyaltyBalance < ECOPOINTS_VOUCHER_COST) {
            req.flash('error', `You need at least ${ECOPOINTS_VOUCHER_COST} EcoPoints to redeem this voucher.`);
            return res.redirect('/user/coupons');
        }

        let voucherCode = '';
        let voucherId = null;
        let created = false;

        for (let attempt = 0; attempt < 4; attempt += 1) {
            voucherCode = generateEcoVoucherCode(user.id);
            const payload = buildEcoVoucherPayload(voucherCode, user.id);
            try {
                const result = await createCoupon(payload);
                voucherId = result && result.insertId ? result.insertId : null;
                created = true;
                break;
            } catch (createErr) {
                if (createErr && createErr.code === 'ER_DUP_ENTRY') {
                    continue;
                }
                console.error('Error creating EcoPoints voucher:', createErr);
                req.flash('error', 'Unable to create EcoPoints voucher right now.');
                return res.redirect('/user/coupons');
            }
        }

        if (!created) {
            req.flash('error', 'Unable to generate a unique EcoPoints voucher. Please try again.');
            return res.redirect('/user/coupons');
        }

        try {
            const redemption = await loyaltyService.redeemPointsForVoucher({
                userId: user.id,
                pointsToRedeem: ECOPOINTS_VOUCHER_COST,
                voucherCode
            });

            if (req.session.user && Number.isFinite(redemption.balance)) {
                req.session.user.loyalty_points = redemption.balance;
            }

            req.flash('success', `EcoPoints voucher created! Code: ${voucherCode} (worth $${ECOPOINTS_VOUCHER_VALUE.toFixed(2)}).`);
            return res.redirect('/user/coupons');
        } catch (redeemErr) {
            console.error('Error redeeming EcoPoints for voucher:', redeemErr);
            await deactivateCoupon(voucherId);
            req.flash('error', 'Voucher created but EcoPoints redemption failed. Please try again.');
            return res.redirect('/user/coupons');
        }
    }
};

module.exports = CouponController;
