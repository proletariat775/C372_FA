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
// TEAM START - Fit assistant controller
const fitAssistantController = require('./controllers/FitAssistantController');
// TEAM END - Fit assistant controller
// ZOEY START - Post-purchase management controller
const postPurchaseController = require('./controllers/PostPurchaseController');
// ZOEY END - Post-purchase management controller
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

// Set up view engine
app.set('view engine', 'ejs');
// Enable static files
app.use(express.static('public'));
// Enable form processing
app.use(express.urlencoded({
    extended: false
}));

// Session Middleware
app.use(session({
    secret: 'secret',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

app.use(flash());

// Routes
app.get('/', (req, res) => {
    res.render('index', { user: req.session.user });
});

app.get('/inventory', checkAuthenticated, checkAdmin, productController.showInventory);

app.get('/register', userController.showRegister);
app.post('/register', userController.register);

app.get('/login', userController.showLogin);
app.post('/login', userController.login);

app.get('/admin/users', checkAuthenticated, checkAdmin, userController.listUsers);
app.get('/admin/users/:id/edit', checkAuthenticated, checkAdmin, userController.editUserForm);
app.post('/admin/users/:id', checkAuthenticated, checkAdmin, userController.updateUserRole);
app.post('/admin/users/:id/delete', checkAuthenticated, checkAdmin, userController.deleteUser);

app.get('/shopping', checkAuthenticated, checkRoles('customer'), productController.showShopping);

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
app.post('/checkout', checkAuthenticated, checkRoles('customer'), orderController.checkout);
app.get('/orders/history', checkAuthenticated, checkRoles('customer', 'admin'), orderController.history);
app.post('/orders/:id/delivery', checkAuthenticated, orderController.updateDeliveryDetails);
app.get('/orders/:id/invoice', checkAuthenticated, orderController.invoice);
// ZOEY START - Post-purchase management routes
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
// ZOEY END - Post-purchase management routes

app.get('/logout', userController.logout);

app.get('/product/:id', checkAuthenticated, productController.showProductDetails);
app.post('/product/:id/reviews', checkAuthenticated, checkRoles('customer'), reviewController.upsert);
app.post('/product/:id/reviews/:reviewId/delete', checkAuthenticated, checkRoles('customer'), reviewController.remove);

app.get('/addProduct', checkAuthenticated, checkAdmin, productController.showAddProductForm);
app.post('/addProduct', checkAuthenticated, checkAdmin, upload.single('image'), productController.addProduct);

app.get('/updateProduct/:id', checkAuthenticated, checkAdmin, productController.showUpdateProductForm);
app.post('/updateProduct/:id', checkAuthenticated, checkAdmin, upload.single('image'), productController.updateProduct);

app.get('/deleteProduct/:id', checkAuthenticated, checkAdmin, productController.deleteProduct);
app.get('/admin/deliveries', checkAuthenticated, checkAdmin, orderController.listAllDeliveries);


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
