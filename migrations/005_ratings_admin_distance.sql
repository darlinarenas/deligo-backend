BEGIN;

CREATE TABLE IF NOT EXISTS bhuz_ratings (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  user_email TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN ('PACKAGE','FOOD_ORDER')),
  source_id TEXT NOT NULL,
  driver_id TEXT REFERENCES bhuz_drivers(id) ON DELETE SET NULL,
  restaurant_id TEXT,
  driver_rating INTEGER CHECK (driver_rating BETWEEN 1 AND 5),
  restaurant_rating INTEGER CHECK (restaurant_rating BETWEEN 1 AND 5),
  driver_comment TEXT,
  restaurant_comment TEXT,
  general_comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_email, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_bhuz_ratings_driver ON bhuz_ratings(driver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bhuz_ratings_restaurant ON bhuz_ratings(restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bhuz_ratings_source ON bhuz_ratings(source_type, source_id);

ALTER TABLE bhuz_delivery_jobs ADD COLUMN IF NOT EXISTS actual_distance_km NUMERIC(10,2) NOT NULL DEFAULT 0;

COMMIT;
