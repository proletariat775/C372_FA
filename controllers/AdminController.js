//I declare that this code was written by me. 
// I will not copy or allow others to copy my code. 
// I understand that copying code is considered as plagiarism.
 
// Student Name: Zhang KaiXiang 
// Student ID:24041976
// Class:C372-002
// Date created:06/02/2026

const Product = require('../models/product');
const Order = require('../models/order');
const Coupon = require('../models/coupon');
const User = require('../models/user');
const loyaltyService = require('../services/loyaltyService');
const orderStatusService = require('../services/orderStatusService');

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
                        console.error('Error loading completed orders:', deliveredErr);
                    }

                        Order.getRecentOrders(5, (recentErr, recentOrders) => {
                            if (recentErr) {
                                console.error('Error loading recent orders:', recentErr);
                            }

                            Coupon.getStats((couponErr, couponStats) => {
                                if (couponErr) {
                                    console.error('Error loading coupon stats:', couponErr);
                                }

                                const normalizedRecent = (recentOrders || []).map((order) => ({
                                    ...order,
                                    status: orderStatusService.mapLegacyStatus(order.status || 'processing')
                                }));
                                const stats = productStats || {};

                                res.render('adminDashboard', {
                                    user: req.session.user,
                                    metrics: {
                                        totalProducts: toNumber(stats.totalProducts),
                                        totalUnits: toNumber(stats.totalUnits),
                                        openOrders: toNumber(openCount),
                                        completedLast7Days: toNumber(deliveredCount)
                                    },
                                    couponStats: couponStats || { active: 0, scheduled: 0, expired: 0 },
                                    recentOrders: normalizedRecent,
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
        User.findAll(async (err, users) => {
            if (err) {
                console.error('Error loading EcoPoints directory:', err);
                req.flash('error', 'Unable to load EcoPoints directory.');
                return res.redirect('/admin/dashboard');
            }

            const customers = (users || [])
                .filter((account) => account.role === 'customer')
                .map((account) => ({
                    ...account,
                    loyalty_points: Math.max(0, Math.floor(Number(account.loyalty_points || 0)))
                }));

            const totalPoints = customers.reduce((sum, account) => sum + Number(account.loyalty_points || 0), 0);

            let totalIssuedPoints = 0;
            try {
                totalIssuedPoints = await loyaltyService.getTotalIssuedPoints();
            } catch (error) {
                console.error('Error loading total EcoPoints issued:', error);
            }

            return res.render('adminLoyalty', {
                user: req.session.user,
                customers,
                totalPoints,
                totalIssuedPoints,
                messages: req.flash('success'),
                errors: req.flash('error')
            });
        });
    },
    adjustUserLoyalty: (req, res) => {
        const targetUserId = Number.parseInt(req.params.id, 10);
        const pointsChange = Number.parseInt(req.body.pointsChange, 10);
        const note = String(req.body.note || '').trim();
        const adminUserId = req.session.user && req.session.user.id ? Number.parseInt(req.session.user.id, 10) : null;

        if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
            req.flash('error', 'Invalid customer selected for EcoPoints adjustment.');
            return res.redirect('/admin/loyalty');
        }

        if (!Number.isFinite(pointsChange) || pointsChange === 0) {
            req.flash('error', 'Please enter a positive or negative EcoPoints adjustment.');
            return res.redirect('/admin/loyalty');
        }

        User.findById(targetUserId, async (err, users) => {
            if (err) {
                console.error('Error loading user for EcoPoints adjustment:', err);
                req.flash('error', 'Unable to load customer details for EcoPoints adjustment.');
                return res.redirect('/admin/loyalty');
            }

            const customer = users && users[0] ? users[0] : null;
            if (!customer || customer.role !== 'customer') {
                req.flash('error', 'EcoPoints adjustments are only available for customers.');
                return res.redirect('/admin/loyalty');
            }

            try {
                const adjustment = await loyaltyService.adjustPointsByAdmin({
                    userId: targetUserId,
                    pointsChange,
                    adminUserId,
                    note
                });

                const deltaLabel = pointsChange > 0 ? `+${pointsChange}` : `${pointsChange}`;
                req.flash(
                    'success',
                    `EcoPoints updated for ${customer.username}: ${deltaLabel} pts. New balance: ${adjustment.balance} pts.`
                );
                return res.redirect('/admin/loyalty');
            } catch (error) {
                console.error('Error adjusting EcoPoints:', error);
                req.flash('error', error.message || 'Unable to adjust EcoPoints for this customer.');
                return res.redirect('/admin/loyalty');
            }
        });
    }
};

module.exports = AdminController;

