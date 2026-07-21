-- BHUZ · Línea de tiempo de pedidos de comida
-- Ejecutar manualmente una sola vez en Supabase SQL Editor.
-- No elimina ni modifica datos existentes.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS preparing_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS en_route_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

COMMENT ON COLUMN orders.accepted_at IS 'Hora en que el restaurante aceptó el pedido';
COMMENT ON COLUMN orders.preparing_at IS 'Hora en que el restaurante inició la preparación';
COMMENT ON COLUMN orders.en_route_at IS 'Hora en que el repartidor salió hacia el cliente';
COMMENT ON COLUMN orders.delivered_at IS 'Hora en que la entrega fue validada y finalizada';
