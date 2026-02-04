-- Adds shirt-specific attributes used by add/update product forms.
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS product_details (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    description TEXT NULL,
    fit_type VARCHAR(100) NULL,
    material VARCHAR(100) NULL,
    color VARCHAR(100) NULL,
    size_range VARCHAR(100) NULL,
    care VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_product_details_product_id (product_id),
    CONSTRAINT fk_product_details_product
        FOREIGN KEY (product_id) REFERENCES products(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
);
