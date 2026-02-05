const Product = require('../models/product');
const Order = require('../models/order');
const Coupon = require('../models/coupon');
const User = require('../models/user');
const loyaltyService = require('../services/loyaltyService');

const toNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

const AdminController = {
    dashboard: (req, res) => {
        Product.getInventorySummary((productErr, productStats) => {
            if (productErr) {
                console.error('Error loading product stats:', productErr);
            }

            Order.countOpenOrders((openErr, openCount) => {
                if (openErr) {
                    console.error('Error loading open orders:', openErr);
                }

                Order.countDeliveredSince(7, (deliveredErr, deliveredCount) => {
                    if (deliveredErr) {
                        console.error('Error loading delivered orders:', deliveredErr);
                    }

                    Order.getRecentOrders(5, (recentErr, recentOrders) => {
                        if (recentErr) {
                            console.error('Error loading recent orders:', recentErr);
                        }

                        Coupon.getStats((couponErr, couponStats) => {
                            if (couponErr) {
                                console.error('Error loading coupon stats:', couponErr);
                            }

                            const stats = productStats || {};

                            res.render('adminDashboard', {
                                user: req.session.user,
                                metrics: {
                                    totalProducts: toNumber(stats.totalProducts),
                                    totalUnits: toNumber(stats.totalUnits),
                                    openOrders: toNumber(openCount),
                                    deliveredLast7Days: toNumber(deliveredCount)
                                },
                                couponStats: couponStats || { active: 0, scheduled: 0, expired: 0 },
                                recentOrders: recentOrders || [],
                                messages: req.flash('success'),
                                errors: req.flash('error')
                            });
                        });
                    });
                });
            });
        });
    },
    loyaltyDirectory: (req, res) => {
        User.findAll((err, users) => {
            if (err) {
                console.error('Error loading loyalty directory:', err);
                req.flash('error', 'Unable to load loyalty directory.');
                return res.redirect('/admin/dashboard');
            }

            const customers = (users || [])
                .filter((account) => account.role === 'customer')
                .map((account) => ({
                    ...account,
                    loyalty_points_balance: Math.max(0, Math.floor(Number(account.loyalty_points_balance || 0)))
                }));

            const totalPoints = customers.reduce((sum, account) => sum + Number(account.loyalty_points_balance || 0), 0);

            return res.render('adminLoyalty', {
                user: req.session.user,
                customers,
                totalPoints,
                messages: req.flash('success'),
                errors: req.flash('error')
            });
        });
    },
    adjustUserLoyalty: (req, res) => {
        const userId = Number.parseInt(req.params.id, 10);
        const pointsChange = Number.parseInt(req.body.pointsChange, 10);
        const note = req.body.note ? String(req.body.note).trim() : '';

        if (!Number.isFinite(userId) || userId <= 0) {
            req.flash('error', 'Invalid user selected.');
            return res.redirect('/admin/loyalty');
        }

        if (!Number.isFinite(pointsChange) || pointsChange === 0) {
            req.flash('error', 'Please enter a non-zero points adjustment.');
            return res.redirect('/admin/loyalty');
        }

        User.findById(userId, async (findErr, rows) => {
            if (findErr) {
                console.error('Error validating loyalty adjustment target:', findErr);
                req.flash('error', 'Unable to adjust loyalty points right now.');
                return res.redirect('/admin/loyalty');
            }

            const target = rows && rows[0] ? rows[0] : null;
            if (!target) {
                req.flash('error', 'User not found.');
                return res.redirect('/admin/loyalty');
            }

            if (target.role !== 'customer') {
                req.flash('error', 'Only customer accounts can be adjusted.');
                return res.redirect('/admin/loyalty');
            }

            try {
                const result = await loyaltyService.adjustPointsByAdmin({
                    userId,
                    pointsChange,
                    adminUserId: req.session.user ? req.session.user.id : null,
                    note
                });
                const direction = pointsChange > 0 ? 'added to' : 'deducted from';
                req.flash('success', `${Math.abs(pointsChange)} points ${direction} ${target.username}. New balance: ${result.balance}.`);
                return res.redirect('/admin/loyalty');
            } catch (error) {
                console.error('Error adjusting loyalty points:', error);
                if (error && /Insufficient loyalty points/i.test(String(error.message || ''))) {
                    req.flash('error', 'Adjustment failed: customer does not have enough points for this deduction.');
                } else {
                    req.flash('error', 'Unable to adjust loyalty points right now.');
                }
                return res.redirect('/admin/loyalty');
            }
        });
    }
};

module.exports = AdminController;
