CREATE TABLE attendance_requests_with_idempotency (
  id TEXT PRIMARY KEY NOT NULL,
  creation_request_id TEXT NOT NULL,
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

INSERT INTO attendance_requests_with_idempotency (
  id, creation_request_id, user_id, work_date, requested_category, reason,
  status, reviewer_user_id, review_comment, requested_at, reviewed_at, version,
  decision_request_id, created_at, updated_at
)
SELECT id,
       lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) ||
         '-4' || substr(lower(hex(randomblob(2))), 2) || '-8' ||
         substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
       user_id, work_date, requested_category, reason, status,
       reviewer_user_id, review_comment, requested_at, reviewed_at, version,
       decision_request_id, created_at, updated_at
  FROM attendance_requests;

DROP TABLE attendance_requests;
ALTER TABLE attendance_requests_with_idempotency RENAME TO attendance_requests;

CREATE UNIQUE INDEX attendance_requests_creation_request_id_unique
  ON attendance_requests (creation_request_id);
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

ALTER TABLE audit_logs ADD COLUMN mutation_id TEXT;

CREATE UNIQUE INDEX audit_logs_mutation_id_unique
  ON audit_logs (mutation_id)
  WHERE mutation_id IS NOT NULL;
