//I declare that this code was written by me. 
// I will not copy or allow others to copy my code. 
// I understand that copying code is considered as plagiarism.
 
// Student Name: wendy liew wen ying 
// Student ID: 24038281
// Class: C372-002
// Date created: 06/02/2026
const db = require('../db');

const PURCHASE_REASON = 'purchase';
const REVIEW_REASON = 'review';
const REDEMPTION_REASON = 'redemption';
const ADMIN_ADJUSTMENT_REASON = 'admin adjustment';
const REFUND_CLAWBACK_REASON_PREFIX = 'refund';
const VOUCHER_REDEMPTION_REASON_PREFIX = 'redemption:voucher';
const REFUND_REDEMPTION_RETURN_REASON = 'redemption:return';
const LEGACY_PURCHASE_REASON = 'Order completed';
const LEGACY_REDEMPTION_REASON = 'Redemption';
const EARN_RATE_POINTS_PER_DOLLAR = 1;
const ORDER_BONUS_POINTS = 50;
const REVIEW_BONUS_POINTS = 10;
const REDEMPTION_POINTS_PER_DOLLAR = 20; // 100 points = $5.00 off
const REDEMPTION_STEP_POINTS = 100;

const isRedemptionEnabled = () => String(process.env.LOYALTY_REDEMPTION_ENABLED || 'true').trim().toLowerCase() === 'true';

const toMoney = (value) => {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return 0;
    }
    return Number(parsed.toFixed(2));
};

const toWholePoints = (value) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return 0;
    }
    return parsed;
};

const query = (sql, params = []) => new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => {
        if (err) {
            return reject(err);
        }
        return resolve(rows);
    });
});

const beginTransaction = () => new Promise((resolve, reject) => {
    db.beginTransaction((err) => {
        if (err) {
            return reject(err);
        }
        return resolve();
    });
});

const commitTransaction = () => new Promise((resolve, reject) => {
    db.commit((err) => {
        if (err) {
            return reject(err);
        }
        return resolve();
    });
});

const rollbackTransaction = () => new Promise((resolve) => {
    db.rollback(() => resolve());
});

const calculateSpendPoints = (amountPaid) => {
    const safeAmount = toMoney(amountPaid);
    if (safeAmount <= 0) {
        return 0;
    }
    return Math.max(0, Math.floor(safeAmount * EARN_RATE_POINTS_PER_DOLLAR));
};

const calculateEarnPoints = (amountPaid) => {
    const safeAmount = toMoney(amountPaid);
    if (safeAmount <= 0) {
        return 0;
    }
    const basePoints = calculateSpendPoints(safeAmount);
    return basePoints + ORDER_BONUS_POINTS;
};

const getBalance = async (userId) => {
    const safeUserId = Number.parseInt(userId, 10);
    if (!Number.isFinite(safeUserId) || safeUserId <= 0) {
        return 0;
    }

    const rows = await query('SELECT COALESCE(loyalty_points, 0) AS loyalty_points FROM users WHERE id = ? LIMIT 1', [safeUserId]);
    if (!rows || !rows.length) {
        return 0;
    }
    const balance = Number(rows[0].loyalty_points || 0);
    return Number.isFinite(balance) ? Math.max(0, Math.floor(balance)) : 0;
};

const calculateRedemption = ({ requestedPoints, availablePoints, maxDiscountableAmount }) => {
    // Redemption validation is purely server-side: points balance + checkout-amount cap.
    const safeRequested = toWholePoints(requestedPoints);
    const safeAvailable = Math.max(0, Math.floor(Number(availablePoints) || 0));
    const safeMaxDiscountable = Math.max(0, toMoney(maxDiscountableAmount));
    const maxPointsByAmount = Math.floor(safeMaxDiscountable * REDEMPTION_POINTS_PER_DOLLAR);
    const maxRedeemablePoints = Math.max(
        0,
        Math.floor(Math.min(safeAvailable, maxPointsByAmount) / REDEMPTION_STEP_POINTS) * REDEMPTION_STEP_POINTS
    );

    if (safeRequested <= 0) {
        return {
            valid: true,
            message: null,
            requestedPoints: 0,
            availablePoints: safeAvailable,
            maxRedeemablePoints,
            pointsToRedeem: 0,
            discountAmount: 0
        };
    }

    if (maxRedeemablePoints <= 0) {
        const message = safeAvailable <= 0
            ? 'You do not have EcoPoints to redeem.'
            : 'Your order total is too low for EcoPoints redemption.';
        return {
            valid: false,
            message,
            requestedPoints: safeRequested,
            availablePoints: safeAvailable,
            maxRedeemablePoints,
            pointsToRedeem: 0,
            discountAmount: 0
        };
    }

    if (safeRequested % REDEMPTION_STEP_POINTS !== 0) {
        return {
            valid: false,
            message: `EcoPoints can be redeemed in ${REDEMPTION_STEP_POINTS}-point increments.`,
            requestedPoints: safeRequested,
            availablePoints: safeAvailable,
            maxRedeemablePoints,
            pointsToRedeem: 0,
            discountAmount: 0
        };
    }

    if (safeRequested > safeAvailable) {
        return {
            valid: false,
            message: `You only have ${safeAvailable} EcoPoints available.`,
            requestedPoints: safeRequested,
            availablePoints: safeAvailable,
            maxRedeemablePoints,
            pointsToRedeem: 0,
            discountAmount: 0
        };
    }

    if (safeRequested > maxRedeemablePoints) {
        return {
            valid: false,
            message: `You can redeem up to ${maxRedeemablePoints} EcoPoints for this checkout.`,
            requestedPoints: safeRequested,
            availablePoints: safeAvailable,
            maxRedeemablePoints,
            pointsToRedeem: 0,
            discountAmount: 0
        };
    }

    const discountAmount = Number((safeRequested / REDEMPTION_POINTS_PER_DOLLAR).toFixed(2));
    return {
        valid: true,
        message: null,
        requestedPoints: safeRequested,
        availablePoints: safeAvailable,
        maxRedeemablePoints,
        pointsToRedeem: safeRequested,
        discountAmount
    };
};

const hasOrderReasonTransaction = async (userId, orderId, reason) => {
    const safeUserId = Number.parseInt(userId, 10);
    const safeOrderId = Number.parseInt(orderId, 10);
    const reasons = Array.isArray(reason) ? reason.filter(Boolean) : [reason].filter(Boolean);
    if (!Number.isFinite(safeUserId) || safeUserId <= 0 || !Number.isFinite(safeOrderId) || safeOrderId <= 0 || !reasons.length) {
        return false;
    }

    const rows = await query(
        'SELECT id FROM loyalty_transactions WHERE user_id = ? AND order_id = ? AND reason IN (?) LIMIT 1',
        [safeUserId, safeOrderId, reasons.map(value => String(value))]
    );
    return Boolean(rows && rows.length);
};

const hasStandaloneReasonTransaction = async (userId, reason) => {
    const safeUserId = Number.parseInt(userId, 10);
    const safeReason = String(reason || '').trim();
    if (!Number.isFinite(safeUserId) || safeUserId <= 0 || !safeReason) {
        return false;
    }

    const rows = await query(
        'SELECT id FROM loyalty_transactions WHERE user_id = ? AND order_id IS NULL AND reason = ? LIMIT 1',
        [safeUserId, safeReason]
    );
    return Boolean(rows && rows.length);
};

const applyPointsTransaction = async ({ userId, orderId = null, pointsChange, reason }) => {
    const safeUserId = Number.parseInt(userId, 10);
    const safeOrderId = Number.parseInt(orderId, 10);
    const safePointsChange = Number.parseInt(pointsChange, 10);
    const safeReason = String(reason || '').trim().slice(0, 120);

    if (!Number.isFinite(safeUserId) || safeUserId <= 0) {
        throw new Error('Invalid user for EcoPoints transaction.');
    }
    if (!Number.isFinite(safePointsChange) || safePointsChange === 0) {
        throw new Error('EcoPoints change must not be zero.');
    }
    if (!safeReason) {
        throw new Error('EcoPoints transaction reason is required.');
    }

    await beginTransaction();
    try {
        // Lock the user row so balance updates remain consistent.
        const userRows = await query(
            'SELECT id, COALESCE(loyalty_points, 0) AS loyalty_points FROM users WHERE id = ? FOR UPDATE',
            [safeUserId]
        );
        if (!userRows || !userRows.length) {
            throw new Error('User not found for EcoPoints transaction.');
        }

        const currentBalance = Math.max(0, Math.floor(Number(userRows[0].loyalty_points || 0)));
        const nextBalance = currentBalance + safePointsChange;
        if (nextBalance < 0) {
            throw new Error('Insufficient EcoPoints.');
        }

        await query(
            `INSERT INTO loyalty_transactions (user_id, order_id, points_change, reason)
             VALUES (?, ?, ?, ?)`,
            [safeUserId, Number.isFinite(safeOrderId) && safeOrderId > 0 ? safeOrderId : null, safePointsChange, safeReason]
        );
        await query(
            'UPDATE users SET loyalty_points = ? WHERE id = ?',
            [nextBalance, safeUserId]
        );

        await commitTransaction();
        return {
            pointsChange: safePointsChange,
            balance: nextBalance
        };
    } catch (error) {
        await rollbackTransaction();
        throw error;
    }
};

const awardPointsForPaidOrder = async ({ userId, orderId, amountPaid, paymentStatus, orderStatus }) => {
    const paymentKey = String(paymentStatus || '').trim().toLowerCase();
    const orderKey = String(orderStatus || '').trim().toLowerCase();

    if (!['paid', 'completed'].includes(paymentKey)) {
        return {
            awardedPoints: 0,
            balance: await getBalance(userId),
            skipped: true
        };
    }

    if (['cancelled', 'returned', 'refunded'].includes(orderKey)) {
        return {
            awardedPoints: 0,
            balance: await getBalance(userId),
            skipped: true
        };
    }

    const pointsToAward = calculateEarnPoints(amountPaid);
    if (pointsToAward <= 0) {
        return {
            awardedPoints: 0,
            balance: await getBalance(userId),
            skipped: true
        };
    }

    if (await hasOrderReasonTransaction(userId, orderId, [PURCHASE_REASON, LEGACY_PURCHASE_REASON])) {
        return {
            awardedPoints: 0,
            balance: await getBalance(userId),
            alreadyAwarded: true
        };
    }

    const result = await applyPointsTransaction({
        userId,
        orderId,
        pointsChange: pointsToAward,
        reason: PURCHASE_REASON
    });

    return {
        awardedPoints: pointsToAward,
        balance: result.balance
    };
};

const buildReviewReason = ({ orderItemId = null, productId = null }) => {
    const safeItemId = Number.parseInt(orderItemId, 10);
    if (Number.isFinite(safeItemId) && safeItemId > 0) {
        return `${REVIEW_REASON}:order-item:${safeItemId}`.slice(0, 120);
    }

    const safeProductId = Number.parseInt(productId, 10);
    if (Number.isFinite(safeProductId) && safeProductId > 0) {
        return `${REVIEW_REASON}:product:${safeProductId}`.slice(0, 120);
    }

    return REVIEW_REASON;
};

const awardPointsForReview = async ({ userId, orderId = null, orderItemId = null, productId = null }) => {
    const safeUserId = Number.parseInt(userId, 10);
    if (!Number.isFinite(safeUserId) || safeUserId <= 0) {
        return {
            awardedPoints: 0,
            balance: await getBalance(userId),
            skipped: true
        };
    }

    const safeOrderId = Number.parseInt(orderId, 10);
    const reviewReason = buildReviewReason({ orderItemId, productId });

    if (Number.isFinite(safeOrderId) && safeOrderId > 0) {
        if (await hasOrderReasonTransaction(safeUserId, safeOrderId, reviewReason)) {
            return {
                awardedPoints: 0,
                balance: await getBalance(safeUserId),
                alreadyAwarded: true
            };
        }
    } else if (await hasStandaloneReasonTransaction(safeUserId, reviewReason)) {
        return {
            awardedPoints: 0,
            balance: await getBalance(safeUserId),
            alreadyAwarded: true
        };
    }

    const result = await applyPointsTransaction({
        userId: safeUserId,
        orderId: Number.isFinite(safeOrderId) && safeOrderId > 0 ? safeOrderId : null,
        pointsChange: REVIEW_BONUS_POINTS,
        reason: reviewReason
    });

    return {
        awardedPoints: REVIEW_BONUS_POINTS,
        balance: result.balance
    };
};

const redeemPointsForOrder = async ({ userId, orderId, pointsToRedeem }) => {
    const safePoints = toWholePoints(pointsToRedeem);
    if (safePoints <= 0) {
        return {
            redeemedPoints: 0,
            balance: await getBalance(userId),
            skipped: true
        };
    }

    if (await hasOrderReasonTransaction(userId, orderId, [REDEMPTION_REASON, LEGACY_REDEMPTION_REASON])) {
        return {
            redeemedPoints: 0,
            balance: await getBalance(userId),
            alreadyRedeemed: true
        };
    }

    const result = await applyPointsTransaction({
        userId,
        orderId,
        pointsChange: -safePoints,
        reason: REDEMPTION_REASON
    });

    return {
        redeemedPoints: safePoints,
        balance: result.balance
    };
};

const getOrderPointsSummary = async ({ orderIds = [], userId = null }) => {
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
        return {};
    }

    const safeOrderIds = Array.from(new Set(orderIds
        .map(id => Number.parseInt(id, 10))
        .filter(id => Number.isFinite(id) && id > 0)));

    if (!safeOrderIds.length) {
        return {};
    }

    const safeUserId = Number.parseInt(userId, 10);
    const hasUserFilter = Number.isFinite(safeUserId) && safeUserId > 0;

    let sql = `
        SELECT
            order_id AS orderId,
            SUM(CASE WHEN points_change > 0 AND reason IN (?, ?) THEN points_change ELSE 0 END) AS earnedPoints,
            SUM(CASE WHEN points_change < 0 AND reason IN (?, ?) THEN ABS(points_change) ELSE 0 END) AS redeemedPoints
        FROM loyalty_transactions
        WHERE order_id IN (?)
    `;
    const params = [PURCHASE_REASON, LEGACY_PURCHASE_REASON, REDEMPTION_REASON, LEGACY_REDEMPTION_REASON, safeOrderIds];

    if (hasUserFilter) {
        sql += ' AND user_id = ?';
        params.push(safeUserId);
    }

    sql += ' GROUP BY order_id';

    const rows = await query(sql, params);
    const summary = {};
    safeOrderIds.forEach((orderId) => {
        summary[orderId] = {
            earnedPoints: 0,
            redeemedPoints: 0,
            netPoints: 0
        };
    });

    (rows || []).forEach((row) => {
        const orderId = Number.parseInt(row.orderId, 10);
        if (!Number.isFinite(orderId)) {
            return;
        }
        const earnedPoints = Math.max(0, Math.floor(Number(row.earnedPoints || 0)));
        const redeemedPoints = Math.max(0, Math.floor(Number(row.redeemedPoints || 0)));
        summary[orderId] = {
            earnedPoints,
            redeemedPoints,
            netPoints: earnedPoints - redeemedPoints
        };
    });

    return summary;
};

const redeemPointsForVoucher = async ({ userId, pointsToRedeem, voucherCode }) => {
    const safePoints = toWholePoints(pointsToRedeem);
    if (safePoints <= 0) {
        return {
            redeemedPoints: 0,
            balance: await getBalance(userId),
            skipped: true
        };
    }

    const safeCode = String(voucherCode || '').trim();
    const reason = `${VOUCHER_REDEMPTION_REASON_PREFIX}${safeCode ? `:${safeCode}` : ''}`.slice(0, 120);

    const result = await applyPointsTransaction({
        userId,
        orderId: null,
        pointsChange: -safePoints,
        reason
    });

    return {
        redeemedPoints: safePoints,
        balance: result.balance
    };
};

const getTotalIssuedPoints = async () => {
    const rows = await query(
        'SELECT COALESCE(SUM(points_change), 0) AS totalIssued FROM loyalty_transactions WHERE points_change > 0'
    );
    const totalIssued = Number(rows && rows[0] ? rows[0].totalIssued : 0);
    return Number.isFinite(totalIssued) ? Math.max(0, Math.floor(totalIssued)) : 0;
};

const getOrderEarnedPoints = async (userId, orderId) => {
    const safeUserId = Number.parseInt(userId, 10);
    const safeOrderId = Number.parseInt(orderId, 10);
    if (!Number.isFinite(safeUserId) || safeUserId <= 0 || !Number.isFinite(safeOrderId) || safeOrderId <= 0) {
        return 0;
    }

    const rows = await query(
        `SELECT COALESCE(SUM(points_change), 0) AS earnedPoints
         FROM loyalty_transactions
         WHERE user_id = ? AND order_id = ? AND points_change > 0 AND reason IN (?, ?)`,
        [safeUserId, safeOrderId, PURCHASE_REASON, LEGACY_PURCHASE_REASON]
    );
    const earned = Number(rows && rows[0] ? rows[0].earnedPoints : 0);
    return Number.isFinite(earned) ? Math.max(0, Math.floor(earned)) : 0;
};

const getOrderRefundClawbackPoints = async (userId, orderId) => {
    const safeUserId = Number.parseInt(userId, 10);
    const safeOrderId = Number.parseInt(orderId, 10);
    if (!Number.isFinite(safeUserId) || safeUserId <= 0 || !Number.isFinite(safeOrderId) || safeOrderId <= 0) {
        return 0;
    }

    const rows = await query(
        `SELECT COALESCE(SUM(ABS(points_change)), 0) AS clawedBack
         FROM loyalty_transactions
         WHERE user_id = ? AND order_id = ? AND points_change < 0 AND reason LIKE ?`,
        [safeUserId, safeOrderId, `${REFUND_CLAWBACK_REASON_PREFIX}%`]
    );
    const clawedBack = Number(rows && rows[0] ? rows[0].clawedBack : 0);
    return Number.isFinite(clawedBack) ? Math.max(0, Math.floor(clawedBack)) : 0;
};

const clawbackPointsForRefund = async ({
    userId,
    orderId,
    cumulativeRefundedAmount,
    orderTotalAmount,
    refundReference = ''
}) => {
    const safeUserId = Number.parseInt(userId, 10);
    const safeOrderId = Number.parseInt(orderId, 10);
    if (!Number.isFinite(safeUserId) || safeUserId <= 0 || !Number.isFinite(safeOrderId) || safeOrderId <= 0) {
        return { clawedBackPoints: 0, skipped: true };
    }

    const earnedPoints = await getOrderEarnedPoints(safeUserId, safeOrderId);
    if (earnedPoints <= 0) {
        return { clawedBackPoints: 0, skipped: true };
    }

    const safeTotal = toMoney(orderTotalAmount);
    const safeRefunded = toMoney(cumulativeRefundedAmount);
    const cappedRefunded = safeTotal > 0 ? Math.min(safeRefunded, safeTotal) : safeRefunded;
    const baseClawback = calculateSpendPoints(cappedRefunded);
    const bonusClawback = cappedRefunded >= safeTotal ? ORDER_BONUS_POINTS : 0;
    const targetClawback = Math.min(earnedPoints, baseClawback + bonusClawback);
    if (targetClawback <= 0) {
        return { clawedBackPoints: 0, skipped: true };
    }

    const alreadyClawedBack = await getOrderRefundClawbackPoints(safeUserId, safeOrderId);
    let pointsToClawback = Math.max(0, targetClawback - alreadyClawedBack);
    if (pointsToClawback <= 0) {
        return {
            clawedBackPoints: 0,
            skipped: true,
            alreadyClawedBack,
            targetClawback
        };
    }

    const currentBalance = await getBalance(safeUserId);
    if (currentBalance <= 0) {
        return {
            clawedBackPoints: 0,
            skipped: true,
            insufficientBalance: true
        };
    }

    // Keep reversal non-blocking for refunds; deduct what can safely be removed now.
    pointsToClawback = Math.min(pointsToClawback, currentBalance);
    if (pointsToClawback <= 0) {
        return {
            clawedBackPoints: 0,
            skipped: true,
            insufficientBalance: true
        };
    }

    const ref = String(refundReference || '').trim();
    const reason = `${REFUND_CLAWBACK_REASON_PREFIX}${ref ? ` (${ref})` : ''}`.slice(0, 120);
    if (await hasOrderReasonTransaction(safeUserId, safeOrderId, reason)) {
        return {
            clawedBackPoints: 0,
            skipped: true,
            alreadyProcessed: true
        };
    }

    const result = await applyPointsTransaction({
        userId: safeUserId,
        orderId: safeOrderId,
        pointsChange: -pointsToClawback,
        reason
    });

    return {
        clawedBackPoints: pointsToClawback,
        balance: result.balance,
        targetClawback,
        alreadyClawedBack
    };
};

const returnRedeemedPointsForOrder = async ({ userId, orderId, pointsToReturn, reference = '' }) => {
    const safeUserId = Number.parseInt(userId, 10);
    const safeOrderId = Number.parseInt(orderId, 10);
    const safePoints = toWholePoints(pointsToReturn);
    if (!Number.isFinite(safeUserId) || safeUserId <= 0 || !Number.isFinite(safeOrderId) || safeOrderId <= 0) {
        return { returnedPoints: 0, skipped: true };
    }
    if (safePoints <= 0) {
        return { returnedPoints: 0, skipped: true };
    }

    const reason = `${REFUND_REDEMPTION_RETURN_REASON}${reference ? ` (${reference})` : ''}`.slice(0, 120);
    if (await hasOrderReasonTransaction(safeUserId, safeOrderId, reason)) {
        return { returnedPoints: 0, skipped: true, alreadyProcessed: true };
    }

    const result = await applyPointsTransaction({
        userId: safeUserId,
        orderId: safeOrderId,
        pointsChange: safePoints,
        reason
    });

    return {
        returnedPoints: safePoints,
        balance: result.balance
    };
};

const adjustPointsByAdmin = async ({ userId, pointsChange, adminUserId = null, note = '' }) => {
    const safeUserId = Number.parseInt(userId, 10);
    const safePointsChange = Number.parseInt(pointsChange, 10);
    const safeAdminUserId = Number.parseInt(adminUserId, 10);
    const safeNote = String(note || '').trim();

    if (!Number.isFinite(safeUserId) || safeUserId <= 0) {
        throw new Error('Invalid user for EcoPoints adjustment.');
    }
    if (!Number.isFinite(safePointsChange) || safePointsChange === 0) {
        throw new Error('Points adjustment must not be zero.');
    }

    // Keep admin adjustments traceable in the loyalty ledger.
    const reasonParts = [ADMIN_ADJUSTMENT_REASON];
    if (Number.isFinite(safeAdminUserId) && safeAdminUserId > 0) {
        reasonParts.push(`by admin #${safeAdminUserId}`);
    }
    if (safeNote) {
        reasonParts.push(`note: ${safeNote}`);
    }
    const reason = reasonParts.join(' - ').slice(0, 120);

    const result = await applyPointsTransaction({
        userId: safeUserId,
        orderId: null,
        pointsChange: safePointsChange,
        reason
    });

    return {
        userId: safeUserId,
        pointsChange: safePointsChange,
        balance: result.balance,
        reason
    };
};

module.exports = {
    PURCHASE_REASON,
    REVIEW_REASON,
    REDEMPTION_REASON,
    ADMIN_ADJUSTMENT_REASON,
    REFUND_CLAWBACK_REASON_PREFIX,
    VOUCHER_REDEMPTION_REASON_PREFIX,
    REFUND_REDEMPTION_RETURN_REASON,
    isRedemptionEnabled,
    calculateEarnPoints,
    calculateRedemption,
    getBalance,
    awardPointsForPaidOrder,
    awardPointsForReview,
    redeemPointsForOrder,
    redeemPointsForVoucher,
    getOrderPointsSummary,
    getTotalIssuedPoints,
    clawbackPointsForRefund,
    returnRedeemedPointsForOrder,
    adjustPointsByAdmin
};
