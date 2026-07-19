BEGIN;
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_code VARCHAR(6),
  ADD COLUMN IF NOT EXISTS delivery_code_hash TEXT,
  ADD COLUMN IF NOT EXISTS delivery_code_plain TEXT,
  ADD COLUMN IF NOT EXISTS delivery_code_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_code_attempts INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivered_by_driver_id TEXT;

UPDATE orders
   SET delivery_code = COALESCE(NULLIF(delivery_code, ''), NULLIF(delivery_code_plain, ''))
 WHERE delivery_code IS NULL OR delivery_code = '';
COMMIT;
