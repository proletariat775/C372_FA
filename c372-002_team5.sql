-- c372-002_team5.sql
-- Full schema for current C372 app (MySQL 8+)
 
CREATE DATABASE IF NOT EXISTS `c372-002_team5`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
 
USE `c372-002_team5`;
 
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
 
DROP TABLE IF EXISTS invoice_items;
DROP TABLE IF EXISTS invoice;
DROP TABLE IF EXISTS refunds;
DROP TABLE IF EXISTS refund_items;
DROP TABLE IF EXISTS refund_requests;
DROP TABLE IF EXISTS coupon_usage;
DROP TABLE IF EXISTS loyalty_transactions;
DROP TABLE IF EXISTS product_details;
DROP TABLE IF EXISTS product_reviews;
DROP TABLE IF EXISTS reviews;
DROP TABLE IF EXISTS wishlist;
DROP TABLE IF EXISTS cart_items;
DROP TABLE IF EXISTS cart;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS coupons;
DROP TABLE IF EXISTS product_images;
DROP TABLE IF EXISTS product_variants;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS sizes;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS brands;
DROP TABLE IF EXISTS users;
 
SET FOREIGN_KEY_CHECKS = 1;
 
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL,
  password VARCHAR(255) NOT NULL,
  first_name VARCHAR(100) NULL,
  last_name VARCHAR(100) NULL,
  address VARCHAR(255) NULL,
  city VARCHAR(100) NULL,
  state VARCHAR(100) NULL,
  zip_code VARCHAR(20) NULL,
  country VARCHAR(100) NULL,
  phone VARCHAR(30) NULL,
  role ENUM('user', 'admin') NOT NULL DEFAULT 'user',
  free_delivery TINYINT(1) NOT NULL DEFAULT 0,
  loyalty_points INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_username (username)
) ENGINE=InnoDB;
 
CREATE TABLE brands (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  slug VARCHAR(140) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_brands_name (name),
  UNIQUE KEY uq_brands_slug (slug)
) ENGINE=InnoDB;
 
CREATE TABLE categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  slug VARCHAR(140) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_categories_name (name),
  UNIQUE KEY uq_categories_slug (slug)
) ENGINE=InnoDB;
 
CREATE TABLE sizes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(20) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sizes_name (name)
) ENGINE=InnoDB;
 
CREATE TABLE products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  slug VARCHAR(220) NOT NULL,
  description TEXT NULL,
  sku VARCHAR(100) NOT NULL,
  brand_id INT NULL,
  category_id INT NULL,
  gender ENUM('men','women','unisex','kids') NOT NULL DEFAULT 'unisex',
  product_type ENUM('shirt','pants') NOT NULL DEFAULT 'shirt',
  price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  compare_price DECIMAL(10,2) NULL,
  cost_price DECIMAL(10,2) NULL,
  discount_percent INT NOT NULL DEFAULT 0,
  discount_expires DATETIME NULL,
  is_featured TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  total_quantity INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_products_slug (slug),
  UNIQUE KEY uq_products_sku (sku),
  KEY idx_products_active (is_active),
  KEY idx_products_category (category_id),
  CONSTRAINT fk_products_brand FOREIGN KEY (brand_id) REFERENCES brands(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES categories(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;
 
  CREATE TABLE product_images (
    -- Store multiple rows per product for front/back images. Use is_primary=1 for front,
    -- and sort_order for ordering additional views.
    id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  image_url VARCHAR(500) NOT NULL,
  alt_text VARCHAR(255) NULL,
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_product_images_product (product_id),
  KEY idx_product_images_primary (product_id, is_primary),
  CONSTRAINT fk_product_images_product FOREIGN KEY (product_id) REFERENCES products(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;
 
CREATE TABLE product_variants (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  size VARCHAR(50) NULL,
  color VARCHAR(50) NULL,
  quantity INT NOT NULL DEFAULT 0,
  sku VARCHAR(120) NOT NULL,
  image_url VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_product_variants_sku (sku),
  KEY idx_product_variants_product (product_id),
  CONSTRAINT fk_product_variants_product FOREIGN KEY (product_id) REFERENCES products(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;
 
CREATE TABLE cart (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cart_user (user_id),
  CONSTRAINT fk_cart_user FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;
 
CREATE TABLE cart_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cart_id INT NOT NULL,
  product_variant_id INT NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cart_item_variant (cart_id, product_variant_id),
  KEY idx_cart_items_variant (product_variant_id),
  CONSTRAINT fk_cart_items_cart FOREIGN KEY (cart_id) REFERENCES cart(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_cart_items_variant FOREIGN KEY (product_variant_id) REFERENCES product_variants(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;
 
CREATE TABLE orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_number VARCHAR(40) NOT NULL,
  user_id INT NOT NULL,
  status ENUM('processing','packing','ready_for_pickup','shipped','delivered','completed','cancelled','returned') NOT NULL DEFAULT 'processing',
  subtotal DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  tax_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  shipping_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  loyalty_points_redeemed INT NOT NULL DEFAULT 0,
  loyalty_discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  total_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  payment_method VARCHAR(50) NOT NULL DEFAULT 'cod',
  payment_status ENUM('pending','paid','failed','refunded') NOT NULL DEFAULT 'pending',
  paypal_capture_id VARCHAR(120) NULL,
  stripe_payment_intent_id VARCHAR(120) NULL,
  refunded_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  refunded_at DATETIME NULL,
  shipping_address VARCHAR(255) NULL,
  billing_address VARCHAR(255) NULL,
  promo_code VARCHAR(50) NULL,
  shipping_provider VARCHAR(120) NULL,
  tracking_number VARCHAR(80) NULL,
  est_delivery_date DATE NULL,
  completed_at DATETIME NULL,
  admin_notes TEXT NULL,
  delivery_slot_date DATE NULL,
  delivery_slot_window VARCHAR(50) NULL,
  order_notes VARCHAR(200) NULL,
  -- Compatibility fields used by older query paths in current controllers
  total DECIMAL(10,2) NULL,
  delivery_method ENUM('pickup','delivery') NULL,
  delivery_address VARCHAR(255) NULL,
  delivery_fee DECIMAL(10,2) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_orders_number (order_number),
  KEY idx_orders_user (user_id),
  KEY idx_orders_status (status),
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;
 
CREATE TABLE order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  product_variant_id INT NULL,
  product_name VARCHAR(255) NOT NULL,
  variant_description VARCHAR(255) NULL,
  size VARCHAR(50) NULL,
  color VARCHAR(50) NULL,
  quantity INT NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  total_price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_order_items_order (order_id),
  KEY idx_order_items_variant (product_variant_id),
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_order_items_variant FOREIGN KEY (product_variant_id) REFERENCES product_variants(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE refund_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  user_id INT NOT NULL,
  payment_method VARCHAR(20) NULL,
  requested_amount DECIMAL(10,2) NOT NULL,
  approved_amount DECIMAL(10,2) NULL,
  reason TEXT NULL,
  status ENUM('pending','approved','rejected','processing','completed','failed') NOT NULL DEFAULT 'pending',
  admin_reason TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_refund_requests_order (order_id),
  KEY idx_refund_requests_user (user_id),
  CONSTRAINT fk_refund_requests_order FOREIGN KEY (order_id) REFERENCES orders(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_refund_requests_user FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE refund_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  refund_request_id INT NOT NULL,
  order_item_id INT NOT NULL,
  product_id INT NULL,
  product_variant_id INT NULL,
  refund_qty INT NOT NULL DEFAULT 0,
  unit_price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  line_refund_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  KEY idx_refund_items_request (refund_request_id),
  KEY idx_refund_items_order_item (order_item_id),
  CONSTRAINT fk_refund_items_request FOREIGN KEY (refund_request_id) REFERENCES refund_requests(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_refund_items_order_item FOREIGN KEY (order_item_id) REFERENCES order_items(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_refund_items_product FOREIGN KEY (product_id) REFERENCES products(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_refund_items_variant FOREIGN KEY (product_variant_id) REFERENCES product_variants(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE refunds (
  id INT AUTO_INCREMENT PRIMARY KEY,
  request_id INT NOT NULL,
  order_id INT NOT NULL,
  paypal_refund_id VARCHAR(120) NULL,
  paypal_capture_id VARCHAR(120) NULL,
  amount DECIMAL(10,2) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'USD',
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_refunds_request (request_id),
  KEY idx_refunds_order (order_id),
  CONSTRAINT fk_refunds_request FOREIGN KEY (request_id) REFERENCES refund_requests(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_refunds_order FOREIGN KEY (order_id) REFERENCES orders(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;
 
CREATE TABLE coupons (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(50) NOT NULL,
  discount_type ENUM('percentage', 'fixed_amount') NOT NULL,
  discount_value DECIMAL(10,2) NOT NULL,
  min_order_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  max_discount_amount DECIMAL(10,2) NULL,
  start_date DATETIME NOT NULL,
  end_date DATETIME NOT NULL,
  usage_limit INT NULL,
  per_user_limit INT NULL,
  brand_id INT NULL,
  owner_user_id INT NULL,
  usage_count INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_coupons_code (code),
  KEY idx_coupons_active_dates (is_active, start_date, end_date),
  KEY idx_coupons_brand (brand_id),
  KEY idx_coupons_owner_user (owner_user_id),
  CONSTRAINT fk_coupons_brand FOREIGN KEY (brand_id) REFERENCES brands(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_coupons_owner_user FOREIGN KEY (owner_user_id) REFERENCES users(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;
 
CREATE TABLE coupon_usage (
  id INT AUTO_INCREMENT PRIMARY KEY,
  coupon_id INT NOT NULL,
  user_id INT NOT NULL,
  order_id INT NOT NULL,
  discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_coupon_usage_once_per_order (coupon_id, user_id, order_id),
  KEY idx_coupon_usage_user_coupon (user_id, coupon_id),
  CONSTRAINT fk_coupon_usage_coupon FOREIGN KEY (coupon_id) REFERENCES coupons(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_coupon_usage_user FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_coupon_usage_order FOREIGN KEY (order_id) REFERENCES orders(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE loyalty_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  order_id INT NULL,
  points_change INT NOT NULL,
  reason VARCHAR(120) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_loyalty_user_order_reason (user_id, order_id, reason),
  KEY idx_loyalty_user_created (user_id, created_at),
  KEY idx_loyalty_order (order_id),
  CONSTRAINT fk_loyalty_user FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_loyalty_order FOREIGN KEY (order_id) REFERENCES orders(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;
 
CREATE TABLE wishlist (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  product_id INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_wishlist_user_product (user_id, product_id),
  KEY idx_wishlist_product (product_id),
  CONSTRAINT fk_wishlist_user FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_wishlist_product FOREIGN KEY (product_id) REFERENCES products(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;
 
CREATE TABLE product_reviews (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  user_id INT NOT NULL,
  rating TINYINT NOT NULL,
  comment TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_product_reviews_user_product (user_id, product_id),
  KEY idx_product_reviews_product (product_id),
  CONSTRAINT chk_product_reviews_rating CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT fk_product_reviews_product FOREIGN KEY (product_id) REFERENCES products(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_product_reviews_user FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;
 
CREATE TABLE reviews (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  user_id INT NOT NULL,
  order_item_id INT NOT NULL,
  rating TINYINT NOT NULL,
  comment TEXT NULL,
  is_approved TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_reviews_user_order_item (user_id, order_item_id),
  KEY idx_reviews_product (product_id),
  CONSTRAINT chk_reviews_rating CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT fk_reviews_product FOREIGN KEY (product_id) REFERENCES products(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_reviews_user FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_reviews_order_item FOREIGN KEY (order_item_id) REFERENCES order_items(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;
 
CREATE TABLE product_details (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  description TEXT NULL,
  fit_type VARCHAR(100) NULL,
  material VARCHAR(100) NULL,
  color VARCHAR(100) NULL,
  size_range VARCHAR(100) NULL,
  care VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_product_details_product_id (product_id),
  CONSTRAINT fk_product_details_product FOREIGN KEY (product_id) REFERENCES products(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;
 
-- Present in your current DB list; kept for compatibility/extension.
CREATE TABLE invoice (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  invoice_number VARCHAR(50) NOT NULL,
  subtotal DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  tax DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  shipping DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  discount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  total DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_invoice_number (invoice_number),
  UNIQUE KEY uq_invoice_order (order_id),
  CONSTRAINT fk_invoice_order FOREIGN KEY (order_id) REFERENCES orders(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;
 
CREATE TABLE invoice_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  invoice_id INT NOT NULL,
  order_item_id INT NULL,
  product_name VARCHAR(255) NOT NULL,
  quantity INT NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  total_price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_invoice_items_invoice (invoice_id),
  CONSTRAINT fk_invoice_items_invoice FOREIGN KEY (invoice_id) REFERENCES invoice(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_invoice_items_order_item FOREIGN KEY (order_item_id) REFERENCES order_items(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;
 
-- Optional starter records
INSERT INTO categories (name, slug, is_active)
VALUES ('General', 'general', 1)
ON DUPLICATE KEY UPDATE is_active = VALUES(is_active);
 
INSERT INTO users (username, email, password, role)
VALUES
  ('admin', 'admin@shirtshop.local', SHA1('admin123'), 'admin'),
  ('user', 'user@shirtshop.local', SHA1('user123'), 'user')
ON DUPLICATE KEY UPDATE role = VALUES(role);
 
SET FOREIGN_KEY_CHECKS = 1;
  
