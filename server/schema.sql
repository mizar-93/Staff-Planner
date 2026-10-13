CREATE TABLE IF NOT EXISTS planner_users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  name text NOT NULL,
  oid uuid UNIQUE,
  role text NOT NULL CHECK (role IN ('production_manager','shift_leader','worker')),
  shift_id text CHECK (shift_id IN ('shift-1','shift-2','shift-3')),
  group_id text,
  person_id text,
  active boolean NOT NULL DEFAULT true,
  CHECK (role = 'production_manager' OR shift_id IS NOT NULL),
  CHECK (role <> 'worker' OR (group_id IS NOT NULL AND person_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS one_leader_per_shift ON planner_users(shift_id) WHERE role='shift_leader' AND active;
CREATE TABLE IF NOT EXISTS planner_data (
  shift_id text NOT NULL CHECK (shift_id IN ('shift-1','shift-2','shift-3')),
  key text NOT NULL,
  value jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  PRIMARY KEY (shift_id,key)
);
CREATE TABLE IF NOT EXISTS planner_sessions (
  token_hash text PRIMARY KEY,
  user_id uuid REFERENCES planner_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
-- Additive migration: safe to run this schema again on an existing deployment.
CREATE TABLE IF NOT EXISTS planner_delegations (
  user_id uuid PRIMARY KEY REFERENCES planner_users(id) ON DELETE CASCADE,
  leader_id uuid NOT NULL UNIQUE REFERENCES planner_users(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  CHECK (user_id <> leader_id)
);
CREATE TABLE IF NOT EXISTS planner_private_todos (
  user_id uuid PRIMARY KEY REFERENCES planner_users(id) ON DELETE CASCADE,
  value jsonb NOT NULL DEFAULT '[]',
  version integer NOT NULL DEFAULT 1
);
