const User = require('../models/user');
const Order = require('../models/order');

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
            req.flash('error', 'Invalid email or password.');
            return res.redirect('/login');
        }

        const user = results[0];
        // Remove hashed password before storing user in session
        delete user.password;
        req.session.user = user;
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

        Order.findByUser(userId, (orderErr, orderRows) => {
            if (orderErr) {
                console.error('Error fetching user orders:', orderErr);
                req.flash('error', 'Unable to load your orders.');
                return res.render('userDashboard', {
                    user: req.session.user,
                    profile: results[0],
                    orders: [],
                    orderItems: {},
                    errors: req.flash('error'),
                    messages: req.flash('success')
                });
            }

            const orders = (orderRows || []).map((order) => ({
                ...order,
                delivery_method: order.shipping_address ? 'delivery' : 'pickup',
                delivery_address: order.shipping_address,
                delivery_fee: Number(order.shipping_amount || 0),
                total: Number(order.total_amount || order.total || 0)
            }));
            const orderIds = orders.map(order => order.id);

            if (!orderIds.length) {
                return res.render('userDashboard', {
                    user: req.session.user,
                    profile: results[0],
                    orders,
                    orderItems: {},
                    errors: req.flash('error'),
                    messages: req.flash('success')
                });
            }

            Order.findItemsByOrderIds(orderIds, (itemsErr, itemRows) => {
                if (itemsErr) {
                    console.error('Error fetching order items:', itemsErr);
                    req.flash('error', 'Unable to load order items.');
                    return res.render('userDashboard', {
                        user: req.session.user,
                        profile: results[0],
                        orders,
                        orderItems: {},
                        errors: req.flash('error'),
                        messages: req.flash('success')
                    });
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

                return res.render('userDashboard', {
                    user: req.session.user,
                    profile: results[0],
                    orders,
                    orderItems: itemsByOrder,
                    errors: req.flash('error'),
                    messages: req.flash('success')
                });
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

        res.render('manageUsers', {
            users: results,
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

    req.flash('error', 'Editing customer accounts is disabled in this admin view.');
    return res.redirect('/admin/users');
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
