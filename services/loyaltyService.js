const db = require('../db');

const ORDER_COMPLETED_REASON = 'Order completed';
const REDEMPTION_REASON = 'Redemption';
const ADMIN_ADJUSTMENT_REASON = 'Admin adjustment';
const REFUND_CLAWBACK_REASON_PREFIX = 'Refund clawback';
const EARN_RATE_POINTS_PER_DOLLAR = 1;
const REDEMPTION_POINTS_PER_DOLLAR = 100;

const isRedemptionEnabled = () => String(process.env.LOYALTY_REDEMPTION_ENABLED || 'false').trim().toLowerCase() === 'true';

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

const calculateEarnPoints = (amountPaid) => {
    const safeAmount = toMoney(amountPaid);
    return Math.max(0, Math.floor(safeAmount * EARN_RATE_POINTS_PER_DOLLAR));
};

const getBalance = async (userId) => {
    const safeUserId = Number.parseInt(userId, 10);
    if (!Number.isFinite(safeUserId) || safeUserId <= 0) {
        return 0;
    }

    const rows = await query('SELECT COALESCE(loyalty_points_balance, 0) AS loyalty_points_balance FROM users WHERE id = ? LIMIT 1', [safeUserId]);
    if (!rows || !rows.length) {
        return 0;
    }
    const balance = Number(rows[0].loyalty_points_balance || 0);
    return Number.isFinite(balance) ? Math.max(0, Math.floor(balance)) : 0;
};

const calculateRedemption = ({ requestedPoints, availablePoints, maxDiscountableAmount }) => {
    // Redemption validation is purely server-side: points balance + checkout-amount cap.
    const safeRequested = toWholePoints(requestedPoints);
    const safeAvailable = Math.max(0, Math.floor(Number(availablePoints) || 0));
    const safeMaxDiscountable = Math.max(0, toMoney(maxDiscountableAmount));
    const maxPointsByAmount = Math.floor(safeMaxDiscountable * REDEMPTION_POINTS_PER_DOLLAR);
    const maxRedeemablePoints = Math.max(0, Math.min(safeAvailable, maxPointsByAmount));

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
            ? 'You do not have loyalty points to redeem.'
            : 'Your order total is too low for loyalty redemption.';
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

    if (safeRequested > safeAvailable) {
        return {
            valid: false,
            message: `You only have ${safeAvailable} loyalty points available.`,
            requestedPoints: safeRequested,
            availablePoints: safeAvailable,
            maxRedeemablePoints,
            pointsToRedeem: 0,
            discountAmount: 0
        };
    }

    if (safeRequested > maxPointsByAmount) {
        return {
            valid: false,
            message: `You can redeem up to ${maxPointsByAmount} points for this checkout.`,
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
    if (!Number.isFinite(safeUserId) || safeUserId <= 0 || !Number.isFinite(safeOrderId) || safeOrderId <= 0 || !reason) {
        return false;
    }

    const rows = await query(
        'SELECT id FROM loyalty_points_transactions WHERE user_id = ? AND order_id = ? AND reason = ? LIMIT 1',
        [safeUserId, safeOrderId, String(reason)]
    );
    return Boolean(rows && rows.length);
};

const applyPointsTransaction = async ({ userId, orderId = null, pointsChange, reason }) => {
    const safeUserId = Number.parseInt(userId, 10);
    const safeOrderId = Number.parseInt(orderId, 10);
    const safePointsChange = Number.parseInt(pointsChange, 10);
    const safeReason = String(reason || '').trim().slice(0, 120);

    if (!Number.isFinite(safeUserId) || safeUserId <= 0) {
        throw new Error('Invalid user for loyalty transaction.');
    }
    if (!Number.isFinite(safePointsChange) || safePointsChange === 0) {
        throw new Error('Loyalty points change must not be zero.');
    }
    if (!safeReason) {
        throw new Error('Loyalty transaction reason is required.');
    }

    await beginTransaction();
    try {
        // Lock the user row so balance updates remain consistent.
        const userRows = await query(
            'SELECT id, COALESCE(loyalty_points_balance, 0) AS loyalty_points_balance FROM users WHERE id = ? FOR UPDATE',
            [safeUserId]
        );
        if (!userRows || !userRows.length) {
            throw new Error('User not found for loyalty transaction.');
        }

        const currentBalance = Math.max(0, Math.floor(Number(userRows[0].loyalty_points_balance || 0)));
        const nextBalance = currentBalance + safePointsChange;
        if (nextBalance < 0) {
            throw new Error('Insufficient loyalty points.');
        }

        await query(
            `INSERT INTO loyalty_points_transactions (user_id, order_id, points_change, reason)
             VALUES (?, ?, ?, ?)`,
            [safeUserId, Number.isFinite(safeOrderId) && safeOrderId > 0 ? safeOrderId : null, safePointsChange, safeReason]
        );
        await query(
            'UPDATE users SET loyalty_points_balance = ? WHERE id = ?',
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

    if (await hasOrderReasonTransaction(userId, orderId, ORDER_COMPLETED_REASON)) {
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
        reason: ORDER_COMPLETED_REASON
    });

    return {
        awardedPoints: pointsToAward,
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

    if (await hasOrderReasonTransaction(userId, orderId, REDEMPTION_REASON)) {
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
            SUM(CASE WHEN points_change > 0 THEN points_change ELSE 0 END) AS earnedPoints,
            SUM(CASE WHEN points_change < 0 THEN ABS(points_change) ELSE 0 END) AS redeemedPoints
        FROM loyalty_points_transactions
        WHERE order_id IN (?)
    `;
    const params = [safeOrderIds];

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

const getOrderEarnedPoints = async (userId, orderId) => {
    const safeUserId = Number.parseInt(userId, 10);
    const safeOrderId = Number.parseInt(orderId, 10);
    if (!Number.isFinite(safeUserId) || safeUserId <= 0 || !Number.isFinite(safeOrderId) || safeOrderId <= 0) {
        return 0;
    }

    const rows = await query(
        `SELECT COALESCE(SUM(points_change), 0) AS earnedPoints
         FROM loyalty_points_transactions
         WHERE user_id = ? AND order_id = ? AND points_change > 0 AND reason = ?`,
        [safeUserId, safeOrderId, ORDER_COMPLETED_REASON]
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
         FROM loyalty_points_transactions
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
    const targetClawback = Math.min(earnedPoints, calculateEarnPoints(cappedRefunded));
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

const adjustPointsByAdmin = async ({ userId, pointsChange, adminUserId = null, note = '' }) => {
    const safeUserId = Number.parseInt(userId, 10);
    const safePointsChange = Number.parseInt(pointsChange, 10);
    const safeAdminUserId = Number.parseInt(adminUserId, 10);
    const safeNote = String(note || '').trim();

    if (!Number.isFinite(safeUserId) || safeUserId <= 0) {
        throw new Error('Invalid user for loyalty adjustment.');
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
    ORDER_COMPLETED_REASON,
    REDEMPTION_REASON,
    ADMIN_ADJUSTMENT_REASON,
    REFUND_CLAWBACK_REASON_PREFIX,
    isRedemptionEnabled,
    calculateEarnPoints,
    calculateRedemption,
    getBalance,
    awardPointsForPaidOrder,
    redeemPointsForOrder,
    getOrderPointsSummary,
    clawbackPointsForRefund,
    adjustPointsByAdmin
};
