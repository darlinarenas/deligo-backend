ALTER TABLE bhuz_drivers ADD COLUMN IF NOT EXISTS session_active BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE bhuz_drivers ADD COLUMN IF NOT EXISTS inactivity_prompt_at TIMESTAMPTZ;
ALTER TABLE bhuz_drivers ADD COLUMN IF NOT EXISTS inactivity_deadline_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_bhuz_drivers_presence ON bhuz_drivers(session_active,is_available,last_seen_at);
