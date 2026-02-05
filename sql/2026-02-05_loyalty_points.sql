-- Add EcoPoints support (balance cache, redemption fields, ledger table).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS loyalty_points INT NOT NULL DEFAULT 0 AFTER free_delivery;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS loyalty_points_redeemed INT NOT NULL DEFAULT 0 AFTER discount_amount,
  ADD COLUMN IF NOT EXISTS loyalty_discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER loyalty_points_redeemed;

-- EcoPoints voucher support (user-scoped coupons).
ALTER TABLE coupons
  ADD COLUMN IF NOT EXISTS owner_user_id INT NULL AFTER brand_id;

CREATE TABLE IF NOT EXISTS loyalty_transactions (
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
