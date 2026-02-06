const User = require('../models/user');
const Order = require('../models/order');
const OrderReview = require('../models/orderReview');
const refundRequestModel = require('../models/refundRequest');
const orderStatusService = require('../services/orderStatusService');

const REFUND_WINDOW_DAYS = 14;

const normaliseOrderItem = (item) => {
    if (!item) {
        return item;
    }
    const name = item.productName || 'Deleted product';
    const isDeleted = item.is_deleted === 1 || name === 'Deleted product';
    return {
        ...item,
        productName: name,
        is_deleted: isDeleted ? 1 : 0
    };
};

const buildUserReviewList = (orderItemsByOrder = {}, reviewRows = []) => {
    const itemMap = {};
    Object.values(orderItemsByOrder).forEach((items) => {
        (items || []).forEach((item) => {
            if (item && item.id) {
                itemMap[item.id] = item;
            }
        });
    });

    const getTime = (value) => {
        if (!value) return 0;
        const time = new Date(value).getTime();
        return Number.isNaN(time) ? 0 : time;
    };

    return (reviewRows || []).map((review) => {
        const item = itemMap[review.order_item_id] || {};
        return {
            id: review.id,
            rating: Number(review.rating || 0),
            comment: review.comment || '',
            createdAt: review.created_at,
            updatedAt: review.updated_at,
            orderItemId: review.order_item_id,
            orderId: item.order_id || null,
            productId: item.product_id || review.product_id || null,
            productName: item.productName || 'Product',
            size: item.size || '',
            color: item.color || ''
        };
    }).sort((a, b) => {
        const aTime = getTime(a.createdAt || a.updatedAt);
        const bTime = getTime(b.createdAt || b.updatedAt);
        return bTime - aTime;
    });
};

const showRegister = (req, res) => {
    res.render('register', {
        messages: req.flash('error'),
        formData: req.flash('formData')[0]
    });
};

const register = (req, res) => {
    const {
        username,
        email,
        password,
        first_name,
        last_name,
        address,
        city,
        state,
        zip_code,
        country,
        phone
    } = req.body;
    const role = req.body.role;

    const formData = { username, email, first_name, last_name, address, city, state, zip_code, country, phone, role };
    console.log('Register endpoint body:', req.body);
    const allowedRoles = ['customer', 'admin'];
    const safeRole = allowedRoles.includes(role) ? role : 'customer';
    console.log('Register handler received:', formData);

    User.create({ username, email, password, first_name, last_name, address, city, state, zip_code, country, phone, role: safeRole }, (err, result) => {
        if (err) {
            console.error('Error registering user (db):', err);
            if (err.code === 'ER_DUP_ENTRY') {
                req.flash('error', 'Email already exists.');
            } else {
                req.flash('error', 'Unable to complete registration. Please try again.');
            }
            req.flash('formData', formData);
            return res.redirect('/register');
        }

        console.log('User.create result:', result);
        req.flash('success', 'Registration successful! Please log in.');
        return res.redirect('/login');
    });
};

const showLogin = (req, res) => {
    res.render('login', {
        messages: req.flash('success'),
        errors: req.flash('error')
    });
};

const login = (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        req.flash('error', 'All fields are required.');
        return res.redirect('/login');
    }

    User.findByEmailAndPassword(email, password, (err, results) => {
        if (err) {
            console.error('Error logging in:', err);
            req.flash('error', 'Unable to log in. Please try again.');
            return res.redirect('/login');
        }

        if (results.length === 0) {
            return User.findByEmail(email, (lookupErr, lookupResults) => {
                if (lookupErr) {
                    console.error('Error checking account status:', lookupErr);
                    req.flash('error', 'Invalid email or password.');
                    return res.redirect('/login');
                }

                if (lookupResults && lookupResults[0] && lookupResults[0].activate === 0) {
                    req.flash('error', 'This account is deactivated. Please contact support.');
                    return res.redirect('/login');
                }

                req.flash('error', 'Invalid email or password.');
                return res.redirect('/login');
            });
        }

        const user = results[0];
        // Remove hashed password before storing user in session
        delete user.password;
        req.session.user = user;
        if (user.role === 'customer') {
            req.session.showCouponPopup = true;
        }
        req.flash('success', 'Login successful!');

        if (user.role === 'admin') {
            return res.redirect('/admin/dashboard');
        }
        return res.redirect('/shopping');
    });
};

const logout = (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
};

const showUserDashboard = (req, res) => {
    const userId = req.session.user ? req.session.user.id : null;
    if (!userId) {
        req.flash('error', 'Please log in to access your dashboard.');
        return res.redirect('/login');
    }

    const tabParam = req.query && req.query.tab ? String(req.query.tab).toLowerCase() : 'account';
    const allowedTabs = new Set(['account', 'orders', 'returns', 'reviews']);
    const activeTab = allowedTabs.has(tabParam) ? tabParam : 'account';

    User.findById(userId, (err, results) => {
        if (err) {
            console.error('Error fetching user dashboard:', err);
            req.flash('error', 'Unable to load your dashboard.');
            return res.redirect('/shopping');
        }

        if (!results || results.length === 0) {
            req.flash('error', 'User not found.');
            return res.redirect('/shopping');
        }

        const renderDashboard = (orders, orderItems) => {
            const orderItemIds = new Set();
            Object.values(orderItems || {}).forEach((items) => {
                (items || []).forEach((item) => {
                    if (item && item.id) {
                        orderItemIds.add(item.id);
                    }
                });
            });

            refundRequestModel.getByUser(userId, (refundErr, requests = []) => {
                if (refundErr) {
                    console.error('Error loading refund requests:', refundErr);
                    requests = [];
                }

                const refundLatestByOrder = {};
                (requests || []).forEach((request) => {
                    if (request && request.orderId && !refundLatestByOrder[request.orderId]) {
                        refundLatestByOrder[request.orderId] = request;
                    }
                });
                (orders || []).forEach((order) => {
                    const latest = refundLatestByOrder[order.id];
                    order.refund_status = latest ? latest.status : null;
                    order.refund_request_id = latest ? latest.id : null;
                    order.refund_approved_amount = latest ? latest.approvedAmount : null;
                    order.refund_updated_at = latest ? latest.updatedAt : null;
                });

                OrderReview.findByUserAndOrderItems(userId, Array.from(orderItemIds), (reviewErr, reviewRows = []) => {
                    if (reviewErr) {
                        console.error('Error loading user reviews:', reviewErr);
                        reviewRows = [];
                    }

                    const userReviews = buildUserReviewList(orderItems, reviewRows);

                    return res.render('userDashboard', {
                        user: req.session.user,
                        profile: results[0],
                        orders,
                        orderItems,
                        refundRequests: requests,
                        userReviews,
                        activeTab,
                        refundWindowDays: REFUND_WINDOW_DAYS,
                        errors: req.flash('error'),
                        messages: req.flash('success')
                    });
                });
            });
        };

        Order.findByUser(userId, (orderErr, orderRows) => {
            if (orderErr) {
                console.error('Error fetching user orders:', orderErr);
                req.flash('error', 'Unable to load your orders.');
                return renderDashboard([], {});
            }

            const orders = (orderRows || []).map((order) => {
                const fallbackMethod = order.shipping_address || order.delivery_address ? 'delivery' : 'pickup';
                const deliveryMethod = order.delivery_method
                    ? orderStatusService.resolveDeliveryMethod(order.delivery_method)
                    : orderStatusService.resolveDeliveryMethod(fallbackMethod);
                const deliveryAddress = order.delivery_address || order.shipping_address || null;

                return {
                    ...order,
                    status: orderStatusService.mapLegacyStatus(order.status || 'processing'),
                    delivery_method: deliveryMethod,
                    delivery_address: deliveryAddress,
                    delivery_fee: Number(order.delivery_fee || order.shipping_amount || 0),
                    total: Number(order.total_amount || order.total || 0)
                };
            });
            const orderIds = orders.map(order => order.id);

            if (!orderIds.length) {
                return renderDashboard(orders, {});
            }

            Order.findItemsByOrderIds(orderIds, (itemsErr, itemRows) => {
                if (itemsErr) {
                    console.error('Error fetching order items:', itemsErr);
                    req.flash('error', 'Unable to load order items.');
                    return renderDashboard(orders, {});
                }

                const itemsByOrder = orderIds.reduce((acc, id) => {
                    acc[id] = [];
                    return acc;
                }, {});

                (itemRows || []).forEach((item) => {
                    const safeItem = normaliseOrderItem(item);
                    if (!itemsByOrder[safeItem.order_id]) {
                        itemsByOrder[safeItem.order_id] = [];
                    }
                    itemsByOrder[safeItem.order_id].push(safeItem);
                });

                return renderDashboard(orders, itemsByOrder);
            });
        });
    });
};

const updateUserProfile = (req, res) => {
    const userId = req.session.user ? req.session.user.id : null;
    if (!userId) {
        req.flash('error', 'Please log in to update your profile.');
        return res.redirect('/login');
    }

    const {
        username,
        email,
        first_name,
        last_name,
        address,
        city,
        state,
        zip_code,
        country,
        phone
    } = req.body;

    const errors = [];
    const safeUsername = username ? username.trim() : '';
    const safeEmail = email ? email.trim() : '';
    const safePhone = phone ? phone.trim() : '';

    if (!safeUsername) {
        errors.push('Username is required.');
    }

    if (!safeEmail) {
        errors.push('Email is required.');
    }

    if (!safePhone) {
        errors.push('Phone number is required.');
    }

    if (errors.length) {
        req.flash('error', errors);
        return res.redirect('/user');
    }

    User.update(userId, {
        username: safeUsername,
        email: safeEmail,
        first_name,
        last_name,
        address,
        city,
        state,
        zip_code,
        country,
        phone: safePhone,
        role: req.session.user.role
    }, (err) => {
        if (err) {
            console.error('Error updating profile:', err);
            if (err.code === 'ER_DUP_ENTRY') {
                req.flash('error', 'Email already exists.');
            } else {
                req.flash('error', 'Unable to update profile.');
            }
            return res.redirect('/user');
        }

        req.session.user.username = safeUsername;
        req.session.user.email = safeEmail;
        req.session.user.phone = safePhone;
        req.session.user.address = address || '';
        req.flash('success', 'Profile updated successfully.');
        return res.redirect('/user');
    });
};

const listUsers = (req, res) => {
    User.findAll((err, results) => {
        if (err) {
            console.error('Error fetching users:', err);
            req.flash('error', 'Unable to load users.');
            return res.redirect('/inventory');
        }

        const customers = (results || []).filter((managedUser) => managedUser.role === 'customer');

        res.render('manageUsers', {
            users: customers,
            user: req.session.user,
            messages: req.flash('success'),
            errors: req.flash('error')
        });
    });
};

const editUserForm = (req, res) => {
    const userId = parseInt(req.params.id, 10);

    if (Number.isNaN(userId)) {
        req.flash('error', 'Invalid user selected.');
        return res.redirect('/admin/users');
    }

    User.findById(userId, (err, results) => {
        if (err) {
            console.error('Error fetching user:', err);
            req.flash('error', 'Unable to load user.');
            return res.redirect('/admin/users');
        }

        if (results.length === 0) {
            req.flash('error', 'User not found.');
            return res.redirect('/admin/users');
        }

        if (results[0].role !== 'customer') {
            req.flash('error', 'Admin accounts are not shown in user management.');
            return res.redirect('/admin/users');
        }

        res.render('edituser', {
            managedUser: results[0],
            user: req.session.user,
            errors: req.flash('error'),
            messages: req.flash('success')
        });
    });
};

const updateUserRole = (req, res) => {
    const userId = parseInt(req.params.id, 10);
    if (Number.isNaN(userId)) {
        req.flash('error', 'Invalid user selected.');
        return res.redirect('/admin/users');
    }

    User.findById(userId, (findErr, results) => {
        if (findErr) {
            console.error('Error fetching user:', findErr);
            req.flash('error', 'Unable to update user.');
            return res.redirect('/admin/users');
        }

        if (!results || results.length === 0) {
            req.flash('error', 'User not found.');
            return res.redirect('/admin/users');
        }

        if (results[0].role !== 'customer') {
            req.flash('error', 'Admin accounts are not managed in this view.');
            return res.redirect('/admin/users');
        }

        const allowedRoles = ['customer', 'admin'];
        const safeRole = allowedRoles.includes(req.body.role) ? req.body.role : 'customer';
        const activateValue = req.body.activate === '0' ? 0 : 1;
        const password = req.body.password ? String(req.body.password).trim() : '';
        const safeUsername = req.body.username ? String(req.body.username).trim() : '';
        const safeEmail = req.body.email ? String(req.body.email).trim() : '';
        const safePhone = req.body.phone ? String(req.body.phone).trim() : '';
        const safeFirstName = req.body.first_name ? String(req.body.first_name).trim() : '';
        const safeLastName = req.body.last_name ? String(req.body.last_name).trim() : '';
        const safeAddress = req.body.address ? String(req.body.address).trim() : '';
        const safeCity = req.body.city ? String(req.body.city).trim() : '';
        const safeState = req.body.state ? String(req.body.state).trim() : '';
        const safeZip = req.body.zip_code ? String(req.body.zip_code).trim() : '';
        const safeCountry = req.body.country ? String(req.body.country).trim() : '';

        if (!safeUsername) {
            req.flash('error', 'Username is required.');
            return res.redirect(`/admin/users/${userId}/edit`);
        }

        if (!safeEmail) {
            req.flash('error', 'Email is required.');
            return res.redirect(`/admin/users/${userId}/edit`);
        }

        if (password && password.length < 6) {
            req.flash('error', 'Password must be at least 6 characters.');
            return res.redirect(`/admin/users/${userId}/edit`);
        }

        return User.updateAdmin(userId, {
            username: safeUsername,
            email: safeEmail,
            first_name: safeFirstName || null,
            last_name: safeLastName || null,
            address: safeAddress || null,
            city: safeCity || null,
            state: safeState || null,
            zip_code: safeZip || null,
            country: safeCountry || null,
            phone: safePhone || null,
            role: safeRole,
            activate: activateValue,
            password
        }, (updateErr) => {
            if (updateErr) {
                console.error('Error updating user:', updateErr);
                if (updateErr.code === 'ER_DUP_ENTRY') {
                    req.flash('error', 'Email already exists.');
                } else {
                    req.flash('error', 'Unable to update user.');
                }
                return res.redirect(`/admin/users/${userId}/edit`);
            }

            req.flash('success', 'Customer account updated.');
            return res.redirect(`/admin/users/${userId}/edit`);
        });
    });
};

const deleteUser = (req, res) => {
    const userId = parseInt(req.params.id, 10);

    if (Number.isNaN(userId)) {
        req.flash('error', 'Invalid user selected.');
        return res.redirect('/admin/users');
    }

    req.flash('error', 'Deleting customer accounts is disabled in this admin view.');
    return res.redirect('/admin/users');
};

module.exports = {
    showRegister,
    register,
    showLogin,
    login,
    logout,
    showUserDashboard,
    updateUserProfile,
    listUsers,
    editUserForm,
    updateUserRole,
    deleteUser
};
