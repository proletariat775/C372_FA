-- Add product_type for sizing and fit assistant
ALTER TABLE products
  ADD COLUMN product_type ENUM('shirt','pants') NOT NULL DEFAULT 'shirt' AFTER gender;

-- Optional: classify pants by category name (adjust as needed)
-- UPDATE products p
-- JOIN categories c ON c.id = p.category_id
-- SET p.product_type = 'pants'
-- WHERE LOWER(c.name) LIKE '%pant%';
