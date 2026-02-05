const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const multer = require('multer');
const app = express();

const userController = require('./controllers/UserController');
const cartController = require('./controllers/CartController');
const productController = require('./controllers/ProductController');
const orderController = require('./controllers/OrderController');
const reviewController = require('./controllers/ReviewController');
const reviewsController = require('./controllers/ReviewsController');
const adminController = require('./controllers/AdminController');
const couponController = require('./controllers/CouponController');
// TEAM START - Fit assistant controller
const fitAssistantController = require('./controllers/FitAssistantController');
// TEAM END - Fit assistant controller

const postPurchaseController = require('./controllers/PostPurchaseController');
const refundController = require('./controllers/RefundController');
const adminRefundController = require('./controllers/AdminRefundController');

const {
    checkAuthenticated,
    checkAdmin,
    checkRoles
} = require('./middleware');

// Set up multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/images');
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});

const upload = multer({ storage: storage });
const productImageUpload = upload.fields([
    { name: 'imageFront', maxCount: 1 },
    { name: 'imageBack', maxCount: 1 },
    { name: 'image', maxCount: 1 }
]);

// Set up view engine
app.set('view engine', 'ejs');
// Enable static files
app.use(express.static('public'));
// Enable form processing
app.use(express.urlencoded({
    extended: false
}));
app.use(express.json());

// Session Middleware
app.use(session({
    secret: 'secret',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

app.use(flash());
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    res.locals.showCouponPopup = Boolean(req.session.showCouponPopup);

    if (req.session.showCouponPopup) {
        delete req.session.showCouponPopup;
    }

    next();
});

// Routes
app.get('/', (req, res) => {
    res.render('index', { user: req.session.user });
});

app.get('/inventory', checkAuthenticated, checkAdmin, productController.showInventory);
app.get('/admin/dashboard', checkAuthenticated, checkAdmin, adminController.dashboard);
app.get('/admin/loyalty', checkAuthenticated, checkAdmin, adminController.loyaltyDirectory);
app.post('/admin/loyalty/:id/adjust', checkAuthenticated, checkAdmin, adminController.adjustUserLoyalty);
app.get('/admin/coupons', checkAuthenticated, checkAdmin, couponController.list);
app.post('/admin/coupons', checkAuthenticated, checkAdmin, couponController.create);
app.get('/admin/coupons/:id/edit', checkAuthenticated, checkAdmin, couponController.editForm);
app.post('/admin/coupons/:id', checkAuthenticated, checkAdmin, couponController.update);
app.post('/admin/coupons/:id/delete', checkAuthenticated, checkAdmin, couponController.remove);

app.get('/register', userController.showRegister);
app.post('/register', userController.register);

app.get('/login', userController.showLogin);
app.post('/login', userController.login);

app.get('/user', checkAuthenticated, userController.showUserDashboard);
app.post('/user/update', checkAuthenticated, userController.updateUserProfile);

app.get('/admin/users', checkAuthenticated, checkAdmin, userController.listUsers);
app.get('/admin/users/:id/edit', checkAuthenticated, checkAdmin, userController.editUserForm);
app.post('/admin/users/:id', checkAuthenticated, checkAdmin, userController.updateUserRole);
app.post('/admin/users/:id/delete', checkAuthenticated, checkAdmin, userController.deleteUser);

app.get('/shopping', checkAuthenticated, checkRoles('customer'), productController.showShopping);
app.post('/bundle/add', checkAuthenticated, checkRoles('customer'), productController.addBundleToCart);

// TEAM START - Fit assistant routes
app.get('/fit-assistant', fitAssistantController.show);
app.post('/fit-assistant', fitAssistantController.calculate);
// TEAM END - Fit assistant routes

app.post('/add-to-cart/:id', checkAuthenticated, checkRoles('customer'), cartController.addToCart);
app.get('/cart', checkAuthenticated, checkRoles('customer'), cartController.viewCart);
app.post('/cart/update/:id', checkAuthenticated, checkRoles('customer'), cartController.updateCartItem);
app.post('/cart/remove/:id', checkAuthenticated, checkRoles('customer'), cartController.removeCartItem);
app.post('/cart/apply-coupon', checkAuthenticated, checkRoles('customer'), cartController.applyCoupon);
app.post('/cart/remove-coupon', checkAuthenticated, checkRoles('customer'), cartController.removeCoupon);
app.get('/coupons', checkAuthenticated, checkRoles('customer'), couponController.availablePage);
app.get('/user/coupons', checkAuthenticated, checkRoles('customer'), couponController.availablePage);
app.get('/api/coupons/available', checkAuthenticated, checkRoles('customer'), couponController.availableJson);
app.get('/checkout', checkAuthenticated, checkRoles('customer'), orderController.showCheckout);
app.post('/checkout', checkAuthenticated, checkRoles('customer'), orderController.checkout);
app.post('/payments/paypal/create', checkAuthenticated, checkRoles('customer'), orderController.createPayPalOrder);
app.post('/payments/paypal/capture', checkAuthenticated, checkRoles('customer'), orderController.capturePayPalOrder);
app.post('/payments/stripe/create', checkAuthenticated, checkRoles('customer'), orderController.createStripeSession);
app.get('/payments/stripe/success', checkAuthenticated, checkRoles('customer'), orderController.stripeSuccess);
app.get('/payments/stripe/cancel', checkAuthenticated, checkRoles('customer'), orderController.stripeCancel);
app.get('/orders/history', checkAuthenticated, checkRoles('customer', 'admin'), orderController.history);
app.post('/orders/:id/delivery', checkAuthenticated, orderController.updateDeliveryDetails);
app.get('/orders/:id/invoice', checkAuthenticated, orderController.invoice);

app.get('/orders', checkAuthenticated, checkRoles('customer', 'admin'), orderController.history);
app.get('/order/:id', checkAuthenticated, checkRoles('customer', 'admin'), postPurchaseController.details);
app.get('/order/:id/track', checkAuthenticated, checkRoles('customer', 'admin'), postPurchaseController.track);
app.get('/order/:id/review', checkAuthenticated, checkRoles('customer', 'admin'), postPurchaseController.reviewForm);
app.post('/review/:id/submit', checkAuthenticated, checkRoles('customer', 'admin'), postPurchaseController.submitReview);
app.get('/order/:id/return', checkAuthenticated, checkRoles('customer', 'admin'), postPurchaseController.returnForm);
app.post('/return/:id/process', checkAuthenticated, checkRoles('customer', 'admin'), postPurchaseController.processReturn);
app.get('/wishlist', checkAuthenticated, checkRoles('customer', 'admin'), postPurchaseController.wishlist);
app.post('/wishlist/:id/add', checkAuthenticated, checkRoles('customer', 'admin'), postPurchaseController.addWishlist);
app.post('/wishlist/:id/remove', checkAuthenticated, checkRoles('customer', 'admin'), postPurchaseController.removeWishlist);
app.get('/refunds', checkAuthenticated, checkRoles('customer'), refundController.list);
app.get('/refunds/request/:orderId', checkAuthenticated, checkRoles('customer'), refundController.showRequestForm);
app.post('/refunds/request/:orderId', checkAuthenticated, checkRoles('customer'), refundController.submitRequest);
app.get('/refunds/:id', checkAuthenticated, checkRoles('customer'), refundController.details);


app.get('/logout', userController.logout);

app.get('/product/:id', checkAuthenticated, productController.showProductDetails);
app.post('/product/:id/reviews', checkAuthenticated, checkRoles('customer'), reviewController.upsert);
app.post('/product/:id/reviews/:reviewId/delete', checkAuthenticated, checkRoles('customer'), reviewController.remove);
app.post('/reviews', checkAuthenticated, checkRoles('customer'), reviewsController.createReview);

app.get('/addProduct', checkAuthenticated, checkAdmin, productController.showAddProductForm);
app.post('/addProduct', checkAuthenticated, checkAdmin, productImageUpload, productController.addProduct);

app.get('/updateProduct/:id', checkAuthenticated, checkAdmin, productController.showUpdateProductForm);
app.post('/updateProduct/:id', checkAuthenticated, checkAdmin, productImageUpload, productController.updateProduct);

app.get('/deleteProduct/:id', checkAuthenticated, checkAdmin, productController.deleteProduct);
app.get('/admin/deliveries', checkAuthenticated, checkAdmin, orderController.listAllDeliveries);
app.post('/admin/orders/:id/update', checkAuthenticated, checkAdmin, orderController.updateAdminOrder);
app.get('/admin/refunds', checkAuthenticated, checkAdmin, adminRefundController.list);
app.get('/admin/refunds/:id', checkAuthenticated, checkAdmin, adminRefundController.details);
app.post('/admin/refunds/:id/approve', checkAuthenticated, checkAdmin, adminRefundController.approve);
app.post('/admin/refunds/:id/reject', checkAuthenticated, checkAdmin, adminRefundController.reject);


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
