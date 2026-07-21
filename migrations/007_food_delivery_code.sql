-- BHUZ 247 - Código de entrega para pedidos de comida
-- Ejecutar manualmente una sola vez en PostgreSQL/Supabase antes de desplegar el backend.

BEGIN;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_code VARCHAR(6);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_code_used BOOLEAN NOT NULL DEFAULT FALSE;

-- Genera código solo para pedidos antiguos activos que todavía no tengan uno.
UPDATE orders
SET delivery_code = LPAD((FLOOR(RANDOM() * 900000) + 100000)::INT::TEXT, 6, '0')
WHERE delivery_code IS NULL
  AND COALESCE(status, 'pendiente') NOT IN ('entregado', 'cancelado');

COMMIT;
