-- Run in Supabase SQL editor. Safe to re-run (IF NOT EXISTS).

-- Account profile
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS first_name text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS pending_email text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS welcome_email_sent boolean NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS pending_password_reset boolean NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deletion_scheduled_at timestamptz;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deletion_requested_at timestamptz;

-- Custom vault hour goals (dashboard "Edit goals")
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS goal_hours jsonb NOT NULL DEFAULT '{}';

-- Generation metering (Phase 1)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS generations_this_period integer NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS generation_period_start timestamptz;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS cycle_started_at timestamptz;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS cycle_expires_at timestamptz;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS generation_throttle_count integer NOT NULL DEFAULT 0;

-- Heavy-use audit log (Pro soft cap)
CREATE TABLE IF NOT EXISTS generation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  plan_type text,
  generation_type text,
  priority_lane boolean DEFAULT false,
  throttled boolean DEFAULT false,
  meta jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS generation_events_user_created ON generation_events(user_id, created_at DESC);

-- Application tracker (Phase 2)
CREATE TABLE IF NOT EXISTS application_schools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  school_name text NOT NULL,
  school_slug text,
  secondary_status text DEFAULT 'not_started',
  secondary_deadline date,
  interview_status text DEFAULT 'none',
  interview_date date,
  decision_status text DEFAULT 'pending',
  waitlist_status text DEFAULT 'none',
  notes text,
  sort_order integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS application_schools_user ON application_schools(user_id);

-- Letters of recommendation (Phase 2)
CREATE TABLE IF NOT EXISTS lor_writers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  writer_name text NOT NULL,
  relationship text,
  request_date date,
  status text NOT NULL DEFAULT 'asked',
  notes text,
  reminder_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lor_writers_user ON lor_writers(user_id);
