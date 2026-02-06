-- Admin reply support for reviews

ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS admin_reply TEXT NULL AFTER comment,
  ADD COLUMN IF NOT EXISTS admin_reply_at DATETIME NULL AFTER admin_reply;
