-- Expand order statuses to include delivered/cancelled/returned.
-- Run after sql/2026-02-06_order_status_flow.sql if already applied.

-- Map legacy refunded status to returned for the new policy.
UPDATE orders SET status = 'returned' WHERE status = 'refunded';

ALTER TABLE orders
  MODIFY status ENUM('processing','packing','ready_for_pickup','shipped','delivered','completed','cancelled','returned') NOT NULL DEFAULT 'processing';
