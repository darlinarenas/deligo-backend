BEGIN;
CREATE TABLE IF NOT EXISTS bhuz_delivery_positions(
 id BIGSERIAL PRIMARY KEY,driver_id TEXT NOT NULL,delivery_job_id TEXT,
 latitude NUMERIC(10,7) NOT NULL,longitude NUMERIC(10,7) NOT NULL,
 accuracy NUMERIC(10,2),heading NUMERIC(10,2),speed NUMERIC(10,2),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS idx_bhuz_positions_job_date ON bhuz_delivery_positions(delivery_job_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bhuz_positions_driver_date ON bhuz_delivery_positions(driver_id,created_at DESC);
CREATE TABLE IF NOT EXISTS bhuz_push_subscriptions(
 id BIGSERIAL PRIMARY KEY,endpoint TEXT UNIQUE NOT NULL,p256dh TEXT NOT NULL,auth TEXT NOT NULL,
 user_email TEXT,service_id TEXT,order_id TEXT,device_name TEXT,active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS idx_bhuz_push_user ON bhuz_push_subscriptions(user_email,active);
CREATE INDEX IF NOT EXISTS idx_bhuz_push_service ON bhuz_push_subscriptions(service_id,active);
CREATE INDEX IF NOT EXISTS idx_bhuz_push_order ON bhuz_push_subscriptions(order_id,active);
COMMIT;
