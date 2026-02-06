-- Order status normalization and tracking timestamps

-- Map legacy statuses to the new streamlined flow.
UPDATE orders SET status = 'processing' WHERE status IN ('pending');
UPDATE orders SET status = 'packing' WHERE status IN ('packed');
UPDATE orders SET status = 'completed' WHERE status IN ('delivered');
UPDATE orders SET status = 'refunded' WHERE status IN ('returned');
UPDATE orders SET status = 'refunded' WHERE status IN ('cancelled');

-- Add completion/refund timestamps (nullable).
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS completed_at DATETIME NULL AFTER est_delivery_date,
  ADD COLUMN IF NOT EXISTS refunded_at DATETIME NULL AFTER refunded_amount;

-- Backfill timestamps for existing records.
UPDATE orders
SET completed_at = COALESCE(completed_at, updated_at, created_at)
WHERE status = 'completed' AND completed_at IS NULL;

UPDATE orders
SET refunded_at = COALESCE(refunded_at, updated_at, created_at)
WHERE status = 'refunded' AND refunded_at IS NULL;

-- Restrict status enum to the new flow only.
ALTER TABLE orders
  MODIFY status ENUM('processing','packing','ready_for_pickup','shipped','completed','refunded') NOT NULL DEFAULT 'processing';
