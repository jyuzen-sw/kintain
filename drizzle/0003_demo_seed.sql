INSERT INTO users (
  id, employee_code, normalized_email, display_name, role, password_hash, active, created_at, updated_at
) VALUES
  ('user-admin', 'ADM001', 'admin@example.test', '管理担当', 'admin', 'pbkdf2-sha256$600000$3P12lf-ze-v5lKrJbgL6nA$ML8CtrlHWImc_w328R-3y74lusqfQgrN2aGVHtrv3is', 1, '2026-08-10T03:38:33.222Z', '2026-08-10T03:38:33.222Z'),
  ('user-maru', 'EMP001', 'maru.employee@example.test', '〇〇さん', 'employee', 'pbkdf2-sha256$600000$BoViD3vrL6sWQjsPDhWl0g$VAEKEKI_2d1rjwvDjXxHnxFb5OdL5-2BItQpyo55nwQ', 1, '2026-08-10T03:38:33.222Z', '2026-08-10T03:38:33.222Z'),
  ('user-batsu', 'EMP002', 'batsu.employee@example.test', '✕✕さん', 'employee', 'pbkdf2-sha256$600000$GF47yMCx8Ezn47P7rmG5LQ$5jq-aeqXA0KH3x574AvWyRRK25wuSz7IkTklLvNXtak', 1, '2026-08-10T03:38:33.222Z', '2026-08-10T03:38:33.222Z'),
  ('user-sankaku', 'EMP003', 'sankaku.employee@example.test', '△△さん', 'employee', 'pbkdf2-sha256$600000$zn89T1QqeQ4s7A-bMv_Y3Q$TABEQkUpOenH6hkapg64AuHpjbjoSSpdB5V-yNTiGUc', 1, '2026-08-10T03:38:33.222Z', '2026-08-10T03:38:33.222Z'),
  ('user-shikaku', 'EMP004', 'shikaku.employee@example.test', '□□さん', 'employee', 'pbkdf2-sha256$600000$fzxmTk9kTrVu8jN9YAe-sQ$9aDpduLa19f7seyzD77DzScklj5mmQZDvZCUYj8RzLs', 1, '2026-08-10T03:38:33.222Z', '2026-08-10T03:38:33.222Z'),
  ('user-hishi', 'EMP005', 'hishi.employee@example.test', '◇◇さん', 'employee', 'pbkdf2-sha256$600000$_S7FvmdfMthGrKsl_93tHw$pi0Mhj05NvyEU4RrDL9z5Sb3nzxDFvxeaFogr5jj7io', 1, '2026-08-10T03:38:33.222Z', '2026-08-10T03:38:33.222Z');

INSERT INTO work_sites (id, name, active, created_at, updated_at) VALUES
  ('site-a', 'A作業場', 1, '2026-08-10T03:38:33.222Z', '2026-08-10T03:38:33.222Z'),
  ('site-b', 'B現場', 1, '2026-08-10T03:38:33.222Z', '2026-08-10T03:38:33.222Z');

INSERT INTO work_schedules (
  id, user_id, site_id, work_date, scheduled_start_at, scheduled_end_at,
  scheduled_break_minutes, note, created_at, updated_at
) VALUES
  ('schedule-maru-today', 'user-maru', 'site-a', '2026-08-10', '2026-08-10T00:00:00.000Z', '2026-08-10T09:00:00.000Z', 60, NULL, '2026-08-10T03:38:33.222Z', '2026-08-10T03:38:33.222Z'),
  ('schedule-batsu-today', 'user-batsu', 'site-a', '2026-08-10', '2026-08-10T00:00:00.000Z', '2026-08-10T09:00:00.000Z', 60, NULL, '2026-08-10T03:38:33.222Z', '2026-08-10T03:38:33.222Z'),
  ('schedule-sankaku-today', 'user-sankaku', 'site-b', '2026-08-10', '2026-08-10T00:30:00.000Z', '2026-08-10T09:30:00.000Z', 60, NULL, '2026-08-10T03:38:33.222Z', '2026-08-10T03:38:33.222Z'),
  ('schedule-shikaku-today', 'user-shikaku', 'site-b', '2026-08-10', '2026-08-10T00:30:00.000Z', '2026-08-10T09:30:00.000Z', 60, NULL, '2026-08-10T03:38:33.222Z', '2026-08-10T03:38:33.222Z'),
  ('schedule-hishi-today', 'user-hishi', 'site-a', '2026-08-10', '2026-08-10T00:00:00.000Z', '2026-08-10T09:00:00.000Z', 60, NULL, '2026-08-10T03:38:33.222Z', '2026-08-10T03:38:33.222Z'),
  ('schedule-maru-yesterday', 'user-maru', 'site-a', '2026-08-09', '2026-08-09T00:00:00.000Z', '2026-08-09T09:00:00.000Z', 60, NULL, '2026-08-10T03:38:33.222Z', '2026-08-10T03:38:33.222Z');

INSERT INTO attendance_records (
  id, user_id, work_date, schedule_id, clock_in_at, clock_out_at,
  actual_break_minutes, attendance_category, note, version, last_mutation_id,
  created_at, updated_at
) VALUES
  ('attendance-maru-today', 'user-maru', '2026-08-10', 'schedule-maru-today', '2026-08-09T23:58:00.000Z', NULL, NULL, 'work', NULL, 1, 'seed-maru-clock-in', '2026-08-10T03:38:33.222Z', '2026-08-10T03:38:33.222Z'),
  ('attendance-batsu-today', 'user-batsu', '2026-08-10', 'schedule-batsu-today', '2026-08-09T23:55:00.000Z', '2026-08-10T03:38:33.222Z', 60, 'work', '予定どおり勤務', 1, 'seed-batsu-clock-out', '2026-08-10T03:38:33.222Z', '2026-08-10T03:38:33.222Z'),
  ('attendance-sankaku-today', 'user-sankaku', '2026-08-10', 'schedule-sankaku-today', NULL, NULL, NULL, 'work', NULL, 1, NULL, '2026-08-10T03:38:33.222Z', '2026-08-10T03:38:33.222Z'),
  ('attendance-shikaku-today', 'user-shikaku', '2026-08-10', 'schedule-shikaku-today', NULL, NULL, NULL, 'work', NULL, 1, NULL, '2026-08-10T03:38:33.222Z', '2026-08-10T03:38:33.222Z'),
  ('attendance-hishi-today', 'user-hishi', '2026-08-10', 'schedule-hishi-today', NULL, NULL, NULL, 'sick_leave', '病欠承認済み', 2, 'seed-hishi-approval', '2026-08-10T03:38:33.222Z', '2026-08-10T03:38:33.222Z'),
  ('attendance-maru-yesterday', 'user-maru', '2026-08-09', 'schedule-maru-yesterday', '2026-08-09T00:05:00.000Z', '2026-08-09T09:00:00.000Z', 60, 'work', '本人修正済み', 2, 'seed-maru-correction', '2026-08-10T03:38:33.222Z', '2026-08-10T03:38:33.222Z');

INSERT INTO punch_events (
  id, attendance_record_id, event_type, occurred_at, client_request_id,
  latitude, longitude, accuracy_meters, captured_at, location_state,
  actor_user_id, created_at
) VALUES
  ('punch-maru-today-in', 'attendance-maru-today', 'clock_in', '2026-08-09T23:58:00.000Z', 'seed-maru-clock-in', 12.345678, 123.456789, 18, '2026-08-09T23:58:00.000Z', 'granted', 'user-maru', '2026-08-10T03:38:33.222Z'),
  ('punch-batsu-today-in', 'attendance-batsu-today', 'clock_in', '2026-08-09T23:55:00.000Z', 'seed-batsu-clock-in', NULL, NULL, NULL, NULL, 'denied', 'user-batsu', '2026-08-10T03:38:33.222Z'),
  ('punch-batsu-today-out', 'attendance-batsu-today', 'clock_out', '2026-08-10T03:38:33.222Z', 'seed-batsu-clock-out', NULL, NULL, NULL, NULL, 'timeout', 'user-batsu', '2026-08-10T03:38:33.222Z'),
  ('punch-maru-yesterday-in', 'attendance-maru-yesterday', 'clock_in', '2026-08-09T00:12:00.000Z', 'seed-maru-yesterday-in', NULL, NULL, NULL, NULL, 'unavailable', 'user-maru', '2026-08-10T03:38:33.222Z'),
  ('punch-maru-yesterday-out', 'attendance-maru-yesterday', 'clock_out', '2026-08-09T09:00:00.000Z', 'seed-maru-yesterday-out', -12.345678, -123.456789, 24, '2026-08-09T09:00:00.000Z', 'granted', 'user-maru', '2026-08-10T03:38:33.222Z');

INSERT INTO attendance_requests (
  id, creation_request_id, user_id, work_date, requested_category, reason,
  status, reviewer_user_id, review_comment, requested_at, reviewed_at, version,
  decision_request_id, created_at, updated_at
) VALUES
  ('request-shikaku-pending', '00000000-0000-4000-8000-000000000101', 'user-shikaku', '2026-08-10', 'paid_leave', '私用のため', 'pending', NULL, NULL, '2026-08-09T22:30:00.000Z', NULL, 1, NULL, '2026-08-10T03:38:33.222Z', '2026-08-10T03:38:33.222Z'),
  ('request-hishi-approved', '00000000-0000-4000-8000-000000000102', 'user-hishi', '2026-08-10', 'sick_leave', '体調不良のため', 'approved', 'user-admin', '承認しました', '2026-08-09T22:10:00.000Z', '2026-08-09T22:20:00.000Z', 2, '00000000-0000-4000-8000-000000000201', '2026-08-10T03:38:33.222Z', '2026-08-10T03:38:33.222Z'),
  ('request-sankaku-rejected', '00000000-0000-4000-8000-000000000103', 'user-sankaku', '2026-08-09', 'other', '終日不在のため', 'rejected', 'user-admin', '勤務予定を確認してください', '2026-08-08T21:50:00.000Z', '2026-08-08T22:00:00.000Z', 2, '00000000-0000-4000-8000-000000000202', '2026-08-10T03:38:33.222Z', '2026-08-10T03:38:33.222Z');

INSERT INTO audit_logs (
  id, entity_type, entity_id, action, before_json, after_json, reason,
  mutation_id, actor_user_id, created_at
) VALUES
  ('audit-maru-correction', 'attendance_record', 'attendance-maru-yesterday', 'update', '{"clockInAt":"2026-08-09T00:12:00.000Z","clockOutAt":"2026-08-09T09:00:00.000Z","actualBreakMinutes":60}', '{"clockInAt":"2026-08-09T00:05:00.000Z","clockOutAt":"2026-08-09T09:00:00.000Z","actualBreakMinutes":60}', '打刻時刻を見直したため', 'seed-maru-correction', 'user-maru', '2026-08-10T03:38:33.222Z'),
  ('audit-hishi-approval', 'attendance_request', 'request-hishi-approved', 'approve', '{"status":"pending"}', '{"status":"approved","attendanceCategory":"sick_leave"}', '承認しました', NULL, 'user-admin', '2026-08-10T03:38:33.222Z'),
  ('audit-sankaku-rejection', 'attendance_request', 'request-sankaku-rejected', 'reject', '{"status":"pending"}', '{"status":"rejected"}', '勤務予定を確認してください', NULL, 'user-admin', '2026-08-10T03:38:33.222Z');
