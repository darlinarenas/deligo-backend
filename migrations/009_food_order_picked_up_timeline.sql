-- BHUZ · Hora real de retiro de pedidos de comida
-- Ejecutar manualmente una sola vez en Supabase SQL Editor.
-- No elimina ni modifica datos existentes.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS picked_up_at TIMESTAMPTZ;

COMMENT ON COLUMN orders.picked_up_at IS
  'Hora en que el restaurante confirmó que el repartidor retiró el pedido';
