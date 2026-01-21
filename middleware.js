const checkAuthenticated = (req, res, next) => {
    if (req.session.user) {
        return next();
    }
    req.flash('error', 'Please log in to view this resource');
    res.redirect('/login');
};

const checkAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'admin') {
        return next();
    }
    req.flash('error', 'Access denied');
    res.redirect('/shopping');
};

const checkRoles = (...roles) => (req, res, next) => {
    if (req.session.user && roles.includes(req.session.user.role)) {
        return next();
    }
    req.flash('error', 'Access denied');
    if (req.session.user) {
        if (req.session.user.role === 'admin') {
            return res.redirect('/inventory');
        }
        return res.redirect('/');
    }
    res.redirect('/login');
};

module.exports = {
    checkAuthenticated,
    checkAdmin,
    checkRoles
};
