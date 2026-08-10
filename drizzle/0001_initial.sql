PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  employee_code TEXT,
  normalized_email TEXT,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('employee', 'admin')),
  password_hash TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX users_employee_code_unique ON users (employee_code);
CREATE UNIQUE INDEX users_normalized_email_unique ON users (normalized_email);

CREATE TABLE work_sites (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX work_sites_name_unique ON work_sites (name);

CREATE TABLE work_schedules (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_id TEXT NOT NULL REFERENCES work_sites(id) ON DELETE RESTRICT,
  work_date TEXT NOT NULL,
  scheduled_start_at TEXT NOT NULL,
  scheduled_end_at TEXT NOT NULL,
  scheduled_break_minutes INTEGER CHECK (
    scheduled_break_minutes IS NULL OR scheduled_break_minutes >= 0
  ),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (scheduled_end_at > scheduled_start_at)
);

CREATE UNIQUE INDEX work_schedules_user_work_date_unique
  ON work_schedules (user_id, work_date);
CREATE INDEX work_schedules_site_work_date_idx
  ON work_schedules (site_id, work_date);

CREATE TABLE attendance_records (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_date TEXT NOT NULL,
  schedule_id TEXT REFERENCES work_schedules(id) ON DELETE SET NULL,
  clock_in_at TEXT,
  clock_out_at TEXT,
  actual_break_minutes INTEGER CHECK (
    actual_break_minutes IS NULL OR actual_break_minutes >= 0
  ),
  attendance_category TEXT NOT NULL DEFAULT 'work' CHECK (
    attendance_category IN ('work', 'paid_leave', 'absence', 'sick_leave', 'other')
  ),
  note TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  last_mutation_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (clock_out_at IS NULL OR (clock_in_at IS NOT NULL AND clock_out_at > clock_in_at)),
  CHECK (attendance_category = 'work' OR (clock_in_at IS NULL AND clock_out_at IS NULL))
);

CREATE UNIQUE INDEX attendance_records_user_work_date_unique
  ON attendance_records (user_id, work_date);
CREATE UNIQUE INDEX attendance_records_last_mutation_id_unique
  ON attendance_records (last_mutation_id)
  WHERE last_mutation_id IS NOT NULL;
CREATE INDEX attendance_records_work_date_idx ON attendance_records (work_date);

CREATE TABLE punch_events (
  id TEXT PRIMARY KEY NOT NULL,
  attendance_record_id TEXT NOT NULL REFERENCES attendance_records(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('clock_in', 'clock_out')),
  occurred_at TEXT NOT NULL,
  client_request_id TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  accuracy_meters REAL,
  captured_at TEXT,
  location_state TEXT NOT NULL CHECK (
    location_state IN ('granted', 'denied', 'unavailable', 'timeout')
  ),
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (
    (
      location_state = 'granted'
      AND latitude BETWEEN -90 AND 90
      AND longitude BETWEEN -180 AND 180
      AND accuracy_meters >= 0
    ) OR (
      location_state <> 'granted'
      AND latitude IS NULL
      AND longitude IS NULL
      AND accuracy_meters IS NULL
    )
  )
);

CREATE UNIQUE INDEX punch_events_client_request_id_unique
  ON punch_events (client_request_id);
CREATE UNIQUE INDEX punch_events_record_event_type_unique
  ON punch_events (attendance_record_id, event_type);
CREATE INDEX punch_events_record_occurred_at_idx
  ON punch_events (attendance_record_id, occurred_at);

CREATE TABLE attendance_requests (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_date TEXT NOT NULL,
  requested_category TEXT NOT NULL CHECK (
    requested_category IN ('paid_leave', 'absence', 'sick_leave', 'other')
  ),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'approved', 'rejected', 'withdrawn')
  ),
  reviewer_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  review_comment TEXT,
  requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  reviewed_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  decision_request_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX attendance_requests_active_user_work_date_unique
  ON attendance_requests (user_id, work_date)
  WHERE status IN ('pending', 'approved');
CREATE UNIQUE INDEX attendance_requests_decision_request_id_unique
  ON attendance_requests (decision_request_id)
  WHERE decision_request_id IS NOT NULL;
CREATE INDEX attendance_requests_status_work_date_idx
  ON attendance_requests (status, work_date);
CREATE INDEX attendance_requests_user_requested_at_idx
  ON attendance_requests (user_id, requested_at);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json TEXT NOT NULL CHECK (json_valid(after_json)),
  reason TEXT,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX audit_logs_entity_created_at_idx
  ON audit_logs (entity_type, entity_id, created_at);
CREATE INDEX audit_logs_actor_created_at_idx
  ON audit_logs (actor_user_id, created_at);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  csrf_token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX sessions_token_hash_unique ON sessions (token_hash);
CREATE INDEX sessions_user_expires_at_idx ON sessions (user_id, expires_at);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE login_rate_limits (
  scope_type TEXT NOT NULL CHECK (scope_type IN ('account', 'ip')),
  scope_key_hash TEXT NOT NULL,
  window_started_at TEXT NOT NULL,
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  blocked_until TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (scope_type, scope_key_hash)
);

CREATE INDEX login_rate_limits_blocked_until_idx
  ON login_rate_limits (blocked_until);
