-- Add per-user usage limit support for coupons.

ALTER TABLE coupons
  ADD COLUMN per_user_limit INT NULL AFTER usage_limit;

-- Preserve previous behavior: default to one redemption per user.
UPDATE coupons
SET per_user_limit = 1
WHERE per_user_limit IS NULL;
