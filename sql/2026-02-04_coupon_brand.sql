-- Add brand-specific coupon support.

ALTER TABLE coupons
  ADD COLUMN brand_id INT NULL AFTER per_user_limit,
  ADD KEY idx_coupons_brand (brand_id),
  ADD CONSTRAINT fk_coupons_brand
    FOREIGN KEY (brand_id) REFERENCES brands(id)
    ON DELETE SET NULL ON UPDATE CASCADE;
