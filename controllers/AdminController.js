const Product = require('../models/product');
const Order = require('../models/order');
const Coupon = require('../models/coupon');

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
    }
};

module.exports = AdminController;
