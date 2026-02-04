-- Add delivery slot and order notes to orders.

ALTER TABLE orders
  ADD COLUMN delivery_slot_date DATE NULL AFTER admin_notes,
  ADD COLUMN delivery_slot_window VARCHAR(50) NULL AFTER delivery_slot_date,
  ADD COLUMN order_notes VARCHAR(200) NULL AFTER delivery_slot_window;
