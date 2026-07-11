BEGIN;

CREATE TABLE IF NOT EXISTS bhuz_drivers (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT,
  phone TEXT,
  identity_document TEXT,
  birth_date DATE,
  address TEXT,
  country_code TEXT NOT NULL DEFAULT 'VE',
  city TEXT NOT NULL DEFAULT 'Punto Fijo',
  zone TEXT,
  vehicle_type TEXT DEFAULT 'Moto',
  vehicle_brand TEXT,
  vehicle_model TEXT,
  vehicle_plate TEXT,
  vehicle_color TEXT,
  emergency_contact TEXT,
  photo_url TEXT,
  vehicle_photo_url TEXT,
  license_url TEXT,
  vehicle_document_url TEXT,
  administrative_status TEXT NOT NULL DEFAULT 'APPROVED' CHECK (administrative_status IN ('PENDING','APPROVED','SUSPENDED','BLOCKED','REJECTED')),
  operational_status TEXT NOT NULL DEFAULT 'OFFLINE' CHECK (operational_status IN ('OFFLINE','AVAILABLE','ASSIGNED','ON_DELIVERY','BREAK')),
  is_available BOOLEAN NOT NULL DEFAULT FALSE,
  rating NUMERIC(3,2) NOT NULL DEFAULT 5,
  completed_deliveries INTEGER NOT NULL DEFAULT 0,
  acceptance_rate NUMERIC(5,2) NOT NULL DEFAULT 100,
  commission_percent NUMERIC(5,2) NOT NULL DEFAULT 10,
  base_currency TEXT NOT NULL DEFAULT 'USD',
  last_latitude NUMERIC(10,7),
  last_longitude NUMERIC(10,7),
  last_location_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bhuz_delivery_jobs (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL CHECK (source_type IN ('PACKAGE','FOOD_ORDER','OTHER')),
  source_id TEXT NOT NULL,
  driver_id TEXT REFERENCES bhuz_drivers(id),
  assignment_mode TEXT NOT NULL DEFAULT 'OPEN' CHECK (assignment_mode IN ('OPEN','AUTO','MANUAL')),
  status TEXT NOT NULL DEFAULT 'PENDING_ASSIGNMENT' CHECK (status IN ('PENDING_ASSIGNMENT','OFFERED','ASSIGNED','GOING_TO_PICKUP','ARRIVED_AT_PICKUP','PICKED_UP','GOING_TO_DELIVERY','ARRIVED_AT_DELIVERY','DELIVERED','CANCELLED','INCIDENT')),
  priority INTEGER NOT NULL DEFAULT 0,
  pickup_name TEXT,
  pickup_address TEXT,
  pickup_reference TEXT,
  pickup_latitude NUMERIC(10,7),
  pickup_longitude NUMERIC(10,7),
  delivery_name TEXT,
  delivery_address TEXT,
  delivery_reference TEXT,
  delivery_latitude NUMERIC(10,7),
  delivery_longitude NUMERIC(10,7),
  distance_km NUMERIC(10,2) NOT NULL DEFAULT 0,
  service_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  driver_earning NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  payment_method TEXT,
  payment_received_by TEXT CHECK (payment_received_by IN ('BHUZ','DRIVER','RESTAURANT','NONE')),
  estimated_pickup_at TIMESTAMPTZ,
  assigned_at TIMESTAMPTZ,
  picked_up_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source_type, source_id)
);

CREATE TABLE IF NOT EXISTS bhuz_driver_ledger (
  id TEXT PRIMARY KEY,
  driver_id TEXT NOT NULL REFERENCES bhuz_drivers(id) ON DELETE CASCADE,
  delivery_job_id TEXT REFERENCES bhuz_delivery_jobs(id),
  movement_type TEXT NOT NULL CHECK (movement_type IN ('EARNING','CASH_COLLECTED','DIGITAL_PAYMENT','TIP','BONUS','PENALTY','ADJUSTMENT','SETTLEMENT_PAYMENT','REFUND')),
  direction TEXT NOT NULL CHECK (direction IN ('CREDIT_DRIVER','DEBIT_DRIVER')),
  amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  exchange_rate NUMERIC(18,8) NOT NULL DEFAULT 1,
  base_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  base_currency TEXT NOT NULL DEFAULT 'USD',
  description TEXT,
  settlement_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bhuz_driver_settlements (
  id TEXT PRIMARY KEY,
  driver_id TEXT NOT NULL REFERENCES bhuz_drivers(id) ON DELETE CASCADE,
  period_from TIMESTAMPTZ NOT NULL,
  period_to TIMESTAMPTZ NOT NULL,
  cutoff_mode TEXT NOT NULL DEFAULT 'CUSTOM' CHECK (cutoff_mode IN ('DAILY','WEEKLY','MONTHLY','CUSTOM','INSTANT')),
  country_code TEXT NOT NULL DEFAULT 'VE',
  currency TEXT NOT NULL DEFAULT 'USD',
  exchange_rate NUMERIC(18,8) NOT NULL DEFAULT 1,
  total_jobs INTEGER NOT NULL DEFAULT 0,
  service_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  driver_earnings NUMERIC(14,2) NOT NULL DEFAULT 0,
  cash_collected NUMERIC(14,2) NOT NULL DEFAULT 0,
  digital_collected NUMERIC(14,2) NOT NULL DEFAULT 0,
  tips NUMERIC(14,2) NOT NULL DEFAULT 0,
  bonuses NUMERIC(14,2) NOT NULL DEFAULT 0,
  penalties NUMERIC(14,2) NOT NULL DEFAULT 0,
  driver_owes_bhuz NUMERIC(14,2) NOT NULL DEFAULT 0,
  bhuz_owes_driver NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('DRAFT','PENDING','PARTIALLY_PAID','PAID','CLOSED','DISPUTED','CANCELLED')),
  notes TEXT,
  proof_url TEXT,
  created_by TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bhuz_driver_incidents (
  id TEXT PRIMARY KEY,
  driver_id TEXT NOT NULL REFERENCES bhuz_drivers(id) ON DELETE CASCADE,
  delivery_job_id TEXT REFERENCES bhuz_delivery_jobs(id),
  incident_type TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','REVIEWING','RESOLVED','REJECTED')),
  evidence_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

ALTER TABLE bhuz_services ADD COLUMN IF NOT EXISTS driver_earning NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE bhuz_services ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS driver_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_status TEXT DEFAULT 'NOT_REQUIRED';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS driver_earning NUMERIC(14,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS assignment_mode TEXT DEFAULT 'OPEN';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_job_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ready_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_bhuz_drivers_availability ON bhuz_drivers(administrative_status,is_available,operational_status);
CREATE INDEX IF NOT EXISTS idx_bhuz_jobs_driver_status ON bhuz_delivery_jobs(driver_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bhuz_jobs_open ON bhuz_delivery_jobs(status,priority DESC,created_at);
CREATE INDEX IF NOT EXISTS idx_bhuz_ledger_driver_date ON bhuz_driver_ledger(driver_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bhuz_settlements_driver_date ON bhuz_driver_settlements(driver_id,period_to DESC);
COMMIT;
