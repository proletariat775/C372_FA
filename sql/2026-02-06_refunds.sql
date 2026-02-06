-- Refund requests + partial refunds + tracking

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS paypal_capture_id VARCHAR(120) NULL AFTER payment_status,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id VARCHAR(120) NULL AFTER paypal_capture_id,
  ADD COLUMN IF NOT EXISTS refunded_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER stripe_payment_intent_id;

CREATE TABLE IF NOT EXISTS refund_requests (
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

CREATE TABLE IF NOT EXISTS refund_items (
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

CREATE TABLE IF NOT EXISTS refunds (
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
