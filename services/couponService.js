const Coupon = require('../models/coupon');

const normalizeMoney = (value) => {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return 0;
    }
    return Number(parsed.toFixed(2));
};

const calculateSubtotal = (cart) => {
    if (!Array.isArray(cart)) {
        return 0;
    }
    const total = cart.reduce((sum, item) => {
        const price = Number(item.price);
        const qty = Number(item.quantity);
        if (!Number.isFinite(price) || !Number.isFinite(qty)) {
            return sum;
        }
        return sum + (price * qty);
    }, 0);
    return Number(total.toFixed(2));
};

const calculateBrandSubtotal = (cart, brandId, brandName) => {
    if (!Array.isArray(cart) || !brandId) {
        return 0;
    }

    const brandKey = Number(brandId);
    if (!Number.isFinite(brandKey)) {
        return 0;
    }

    const nameKey = brandName ? String(brandName).toLowerCase() : null;

    const total = cart.reduce((sum, item) => {
        const itemBrandId = Number(item.brandId || item.brand_id);
        const itemBrandName = item.brand ? String(item.brand).toLowerCase() : null;
        const matches = Number.isFinite(itemBrandId)
            ? itemBrandId === brandKey
            : (nameKey && itemBrandName === nameKey);

        if (!matches) {
            return sum;
        }

        const price = Number(item.price);
        const qty = Number(item.quantity);
        if (!Number.isFinite(price) || !Number.isFinite(qty)) {
            return sum;
        }
        return sum + (price * qty);
    }, 0);

    return Number(total.toFixed(2));
};

const parseDate = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return null;
    }
    return date;
};

const toIsoDate = (date) => {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        return null;
    }
    return date.toISOString().slice(0, 10);
};

const isWithinActiveWindow = (coupon, now = new Date()) => {
    const start = parseDate(coupon && coupon.start_date);
    const end = parseDate(coupon && coupon.end_date);

    if (!start || !end || Number.isNaN(now.getTime())) {
        return false;
    }

    if (now >= start && now <= end) {
        return true;
    }

    // Fallback to date-only comparison to prevent timezone-offset mismatches
    // between datetime-local admin input and DB/session timezone.
    const nowDay = toIsoDate(now);
    const startDay = toIsoDate(start);
    const endDay = toIsoDate(end);

    if (!nowDay || !startDay || !endDay) {
        return false;
    }

    return nowDay >= startDay && nowDay <= endDay;
};

const calculateDiscount = (coupon, subtotal) => {
    const type = coupon.discount_type;
    const value = Number(coupon.discount_value || 0);
    let discount = 0;

    if (type === 'percentage') {
        const percentage = Math.min(100, Math.max(0, value));
        discount = subtotal * (percentage / 100);
    } else if (type === 'fixed_amount') {
        discount = Math.max(0, value);
    }

    if (coupon.max_discount_amount !== null && coupon.max_discount_amount !== undefined) {
        const cap = Number(coupon.max_discount_amount);
        if (Number.isFinite(cap) && cap >= 0) {
            discount = Math.min(discount, cap);
        }
    }

    discount = Number(discount.toFixed(2));
    if (discount > subtotal) {
        discount = subtotal;
    }

    return Number(discount.toFixed(2));
};

const buildAppliedCoupon = (coupon, discountAmount) => ({
    id: coupon.id,
    code: coupon.code,
    discountType: coupon.discount_type,
    discountValue: Number(coupon.discount_value || 0),
    minOrderAmount: Number(coupon.min_order_amount || 0),
    maxDiscountAmount: coupon.max_discount_amount !== null ? Number(coupon.max_discount_amount) : null,
    discountAmount: Number(discountAmount || 0)
});

const validateCoupon = async (code, userId, subtotal, cartItems) => {
    const trimmed = String(code || '').trim();
    if (!trimmed) {
        return { valid: false, message: 'Please enter a coupon code.' };
    }

    const coupon = await new Promise((resolve, reject) => {
        Coupon.findByCode(trimmed, (err, row) => {
            if (err) return reject(err);
            return resolve(row);
        });
    });

    if (!coupon) {
        return { valid: false, message: 'Coupon code not found.' };
    }

    if (coupon.owner_user_id) {
        const ownerId = Number(coupon.owner_user_id);
        const requesterId = Number(userId || 0);
        if (!Number.isFinite(ownerId) || ownerId <= 0) {
            return { valid: false, message: 'This coupon is not valid for your account.' };
        }
        if (!Number.isFinite(requesterId) || requesterId !== ownerId) {
            return { valid: false, message: 'This coupon is tied to a different account.' };
        }
    }

    if (!coupon.is_active) {
        return { valid: false, message: 'This coupon is not active.' };
    }

    const now = new Date();
    if (!isWithinActiveWindow(coupon, now)) {
        return { valid: false, message: 'This coupon is not valid at the moment.' };
    }

    const eligibleSubtotal = coupon.brand_id
        ? calculateBrandSubtotal(cartItems, coupon.brand_id, coupon.brand_name)
        : subtotal;

    if (coupon.brand_id && eligibleSubtotal <= 0) {
        const brandLabel = coupon.brand_name ? ` on ${coupon.brand_name}` : '';
        return { valid: false, message: `This coupon only applies to items${brandLabel}.` };
    }

    const minAmount = Number(coupon.min_order_amount || 0);
    if (Number.isFinite(minAmount) && eligibleSubtotal < minAmount) {
        const prefix = coupon.brand_id ? 'Eligible items' : 'Minimum spend';
        return { valid: false, message: `${prefix} must total $${minAmount.toFixed(2)} to use this coupon.` };
    }

    if (coupon.usage_limit !== null && coupon.usage_limit !== undefined) {
        const usageLimit = Number(coupon.usage_limit);
        const usageCount = Number(coupon.usage_count || 0);
        if (Number.isFinite(usageLimit) && usageLimit > 0 && usageCount >= usageLimit) {
            return { valid: false, message: 'This coupon has reached its usage limit.' };
        }
    }

    if (userId) {
        const userUsageCount = await new Promise((resolve, reject) => {
            Coupon.getUserUsageCount(coupon.id, userId, (err, count) => {
                if (err) return reject(err);
                return resolve(count);
            });
        });

        const perUserLimit = coupon.per_user_limit;
        if (perUserLimit !== null && perUserLimit !== undefined) {
            const limit = Number(perUserLimit);
            if (Number.isFinite(limit) && limit > 0 && userUsageCount >= limit) {
                return { valid: false, message: 'You have already used this coupon.' };
            }
        }
    }

    const discountAmount = calculateDiscount(coupon, eligibleSubtotal);
    if (discountAmount <= 0) {
        return { valid: false, message: 'This coupon does not provide a discount for your cart.' };
    }

    return { valid: true, coupon, discountAmount };
};

module.exports = {
    normalizeMoney,
    calculateSubtotal,
    calculateDiscount,
    buildAppliedCoupon,
    calculateBrandSubtotal,
    validateCoupon
};
