-- BHUZ Envíos: esquema oficial y reproducible
BEGIN;

CREATE TABLE IF NOT EXISTS bhuz_services (
  id TEXT PRIMARY KEY,
  service_type TEXT NOT NULL DEFAULT 'PACKAGE',
  customer_email TEXT, customer_name TEXT, customer_phone TEXT,
  receiver_name TEXT NOT NULL, receiver_phone TEXT,
  pickup_address TEXT NOT NULL, pickup_reference TEXT,
  pickup_latitude NUMERIC(10,7), pickup_longitude NUMERIC(10,7),
  delivery_address TEXT NOT NULL, delivery_reference TEXT,
  delivery_latitude NUMERIC(10,7), delivery_longitude NUMERIC(10,7),
  package_description TEXT NOT NULL, package_size TEXT NOT NULL, package_photo_url TEXT,
  distance_km NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (distance_km >= 0),
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  payment_status TEXT NOT NULL DEFAULT 'PENDING', payment_method TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING_PAYMENT' CHECK (status IN (
    'PENDING_PAYMENT','PAID','WAITING_RECEIVER_LOCATION','SEARCHING_DRIVER',
    'DRIVER_ASSIGNED','GOING_TO_PICKUP','PACKAGE_PICKED','GOING_TO_DELIVERY','DELIVERED','CANCELLED'
  )),
  delivery_code VARCHAR(6) NOT NULL, delivery_code_used BOOLEAN NOT NULL DEFAULT FALSE,
  driver_id TEXT, driver_name TEXT, driver_phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bhuz_service_tokens (
  id TEXT PRIMARY KEY, service_id TEXT NOT NULL REFERENCES bhuz_services(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE, token_type TEXT NOT NULL DEFAULT 'RECEIVER_LOCATION',
  receiver_latitude NUMERIC(10,7), receiver_longitude NUMERIC(10,7),
  receiver_confirmed BOOLEAN NOT NULL DEFAULT FALSE, expires_at TIMESTAMPTZ, confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bhuz_service_status_history (
  id TEXT PRIMARY KEY, service_id TEXT NOT NULL REFERENCES bhuz_services(id) ON DELETE CASCADE,
  previous_status TEXT, new_status TEXT NOT NULL, changed_by TEXT, notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bhuz_services_status ON bhuz_services(status);
CREATE INDEX IF NOT EXISTS idx_bhuz_services_driver_status ON bhuz_services(driver_id,status);
CREATE INDEX IF NOT EXISTS idx_bhuz_services_customer ON bhuz_services(customer_email,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bhuz_tokens_service ON bhuz_service_tokens(service_id);
CREATE INDEX IF NOT EXISTS idx_bhuz_history_service ON bhuz_service_status_history(service_id,created_at);
COMMIT;
