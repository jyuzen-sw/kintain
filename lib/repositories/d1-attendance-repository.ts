import type {
  AdminAttendanceRow,
  AttendanceCategory,
  AttendanceRecordSummary,
  AttendanceRecordAuditEntry,
  AttendanceRequestStatus,
  AttendanceRequestSummary,
  AuditLogSummary,
  EmployeeDirectoryItem,
  LocationState,
  PunchEventType,
  PunchLocationSummary,
  WorkScheduleSummary,
  WorkSiteSummary,
} from "@/lib/contracts/types";
import {
  determineAttendanceStatus,
  isClockInOverdue,
} from "@/lib/domain/attendance";
import { getScheduleMutationState } from "@/lib/domain/schedules";

interface ScheduleRow {
  id: string;
  work_date: string;
  scheduled_start_at: string;
  scheduled_end_at: string;
  scheduled_break_minutes: number | null;
  note: string | null;
  version: number;
  site_id: string;
  site_name: string;
}

interface ScheduleMutationRow {
  entity_id: string;
  action: "create" | "update" | "delete";
  actor_user_id: string;
  user_id: string;
  work_date: string;
  expected_version: number | null;
  site_id: string;
  site_name: string;
  scheduled_start_at: string;
  scheduled_end_at: string;
  scheduled_break_minutes: number | null;
  note: string | null;
  result_version: number;
}

interface RecordRow {
  id: string;
  user_id: string;
  work_date: string;
  schedule_id: string | null;
  clock_in_at: string | null;
  clock_out_at: string | null;
  actual_break_minutes: number | null;
  attendance_category: AttendanceCategory;
  note: string | null;
  version: number;
  has_audit_history: number;
  last_mutation_id?: string | null;
}

interface LocationRow {
  event_type: PunchEventType;
  location_state: LocationState;
  latitude: number | null;
  longitude: number | null;
  accuracy_meters: number | null;
  captured_at: string | null;
}

interface RequestRow {
  id: string;
  user_id: string;
  user_display_name?: string;
  work_date: string;
  requested_category: Exclude<AttendanceCategory, "work">;
  reason: string;
  status: AttendanceRequestStatus;
  reviewer_user_id: string | null;
  reviewer_display_name?: string | null;
  review_comment: string | null;
  requested_at: string;
  reviewed_at: string | null;
  version: number;
  decision_request_id?: string | null;
}

interface PunchRow {
  id: string;
  attendance_record_id: string;
  work_date: string;
  event_type: PunchEventType;
  client_request_id: string;
  actor_user_id: string;
  location_state: LocationState;
  latitude: number | null;
  longitude: number | null;
  accuracy_meters: number | null;
  captured_at: string | null;
}

interface DirectoryRow {
  id: string;
  employee_code: string | null;
  display_name: string;
  normalized_email: string;
}

interface AuditRow {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  before_json: string | null;
  after_json: string;
  reason: string | null;
  actor_user_id: string;
  actor_display_name: string;
  subject_user_id: string | null;
  subject_display_name: string | null;
  created_at: string;
}

interface RecordAuditRow {
  id: string;
  entity_id: string;
  before_json: string | null;
  after_json: string;
  reason: string | null;
  actor_display_name: string;
  created_at: string;
}

interface RecordMutationRow {
  entity_id: string;
  actor_user_id: string;
  reason: string | null;
  expected_version: number;
  clock_in_at: string | null;
  clock_out_at: string | null;
  actual_break_minutes: number | null;
  attendance_category: AttendanceCategory;
  note: string | null;
}

export interface RecordMutationReceipt {
  recordId: string;
  actorUserId: string;
  reason: string | null;
  expectedVersion: number;
  clockInAt: string | null;
  clockOutAt: string | null;
  actualBreakMinutes: number | null;
  attendanceCategory: AttendanceCategory;
  note: string | null;
}

export interface ScheduleMutationReceipt {
  scheduleId: string;
  action: "create" | "update" | "delete";
  actorUserId: string;
  userId: string;
  workDate: string;
  expectedVersion: number | null;
  siteId: string;
  siteName: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
  scheduledBreakMinutes: number | null;
  note: string | null;
  resultVersion: number;
}

export interface AuditLogFilters {
  limit?: number;
  entityType?: "attendance_record" | "attendance_request" | "work_schedule";
  entityId?: string;
}

function mapSchedule(row: ScheduleRow): WorkScheduleSummary {
  return {
    id: row.id,
    workDate: row.work_date,
    scheduledStartAt: row.scheduled_start_at,
    scheduledEndAt: row.scheduled_end_at,
    scheduledBreakMinutes: row.scheduled_break_minutes,
    note: row.note,
    version: row.version,
    site: { id: row.site_id, name: row.site_name },
  };
}

function mapLocation(row: LocationRow): PunchLocationSummary {
  return {
    state: row.location_state,
    latitude: row.latitude,
    longitude: row.longitude,
    accuracyMeters: row.accuracy_meters,
    capturedAt: row.captured_at,
  };
}

function mapRecord(
  row: RecordRow,
  locationRows: readonly LocationRow[] = [],
): AttendanceRecordSummary {
  const clockIn = locationRows.find((location) => location.event_type === "clock_in");
  const clockOut = locationRows.find((location) => location.event_type === "clock_out");
  return {
    id: row.id,
    userId: row.user_id,
    workDate: row.work_date,
    scheduleId: row.schedule_id,
    clockInAt: row.clock_in_at,
    clockOutAt: row.clock_out_at,
    actualBreakMinutes: row.actual_break_minutes,
    attendanceCategory: row.attendance_category,
    note: row.note,
    version: row.version,
    hasAuditHistory: row.has_audit_history === 1,
    locations: {
      clockIn: clockIn ? mapLocation(clockIn) : null,
      clockOut: clockOut ? mapLocation(clockOut) : null,
    },
  };
}

function mapRequest(row: RequestRow): AttendanceRequestSummary {
  return {
    id: row.id,
    userId: row.user_id,
    userDisplayName: row.user_display_name,
    workDate: row.work_date,
    requestedCategory: row.requested_category,
    reason: row.reason,
    status: row.status,
    reviewerUserId: row.reviewer_user_id,
    reviewerDisplayName: row.reviewer_display_name,
    reviewComment: row.review_comment,
    requestedAt: row.requested_at,
    reviewedAt: row.reviewed_at,
    version: row.version,
  };
}

function safeJson(value: string | null): unknown {
  if (value === null) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function mapAudit(row: AuditRow): AuditLogSummary {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    action: row.action,
    before: safeJson(row.before_json),
    after: safeJson(row.after_json),
    reason: row.reason,
    actorUserId: row.actor_user_id,
    actorDisplayName: row.actor_display_name,
    subjectUserId: row.subject_user_id,
    subjectDisplayName: row.subject_display_name,
    createdAt: row.created_at,
  };
}

const RECORD_SELECT = `
  SELECT ar.id, ar.user_id, ar.work_date, ar.schedule_id, ar.clock_in_at,
         ar.clock_out_at, ar.actual_break_minutes, ar.attendance_category,
         ar.note, ar.version, ar.last_mutation_id,
         EXISTS(
           SELECT 1 FROM audit_logs al
            WHERE al.entity_type = 'attendance_record'
              AND al.entity_id = ar.id
              AND al.action = 'update'
         ) AS has_audit_history
    FROM attendance_records ar`;

const REQUEST_SELECT = `
  SELECT r.id, r.user_id, u.display_name AS user_display_name, r.work_date,
         r.requested_category, r.reason, r.status, r.reviewer_user_id,
         reviewer.display_name AS reviewer_display_name, r.review_comment,
         r.requested_at, r.reviewed_at, r.version, r.decision_request_id
    FROM attendance_requests r
    JOIN users u ON u.id = r.user_id
    LEFT JOIN users reviewer ON reviewer.id = r.reviewer_user_id`;

const SCHEDULE_MUTATION_UNLOCKED = `
  AND NOT EXISTS (
    SELECT 1
      FROM attendance_records ar
     WHERE ar.user_id = ? AND ar.work_date = ?
       AND (
         ar.clock_in_at IS NOT NULL
         OR ar.clock_out_at IS NOT NULL
         OR ar.actual_break_minutes IS NOT NULL
         OR ar.attendance_category <> 'work'
         OR ar.note IS NOT NULL
         OR ar.version > 1
         OR EXISTS (
           SELECT 1 FROM punch_events pe WHERE pe.attendance_record_id = ar.id
         )
         OR EXISTS (
           SELECT 1 FROM audit_logs al
            WHERE al.entity_type = 'attendance_record'
              AND al.entity_id = ar.id
              AND al.action = 'update'
         )
       )
  )
  AND NOT EXISTS (
    SELECT 1
      FROM attendance_requests request
     WHERE request.user_id = ? AND request.work_date = ?
       AND request.status IN ('pending', 'approved')
  )`;

interface ScheduleAuditSnapshot {
  id: string;
  userId: string;
  workDate: string;
  siteId: string;
  siteName: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
  scheduledBreakMinutes: number | null;
  note: string | null;
  version: number;
}

function scheduleAuditSnapshot(
  schedule: WorkScheduleSummary,
  userId: string,
): ScheduleAuditSnapshot {
  return {
    id: schedule.id,
    userId,
    workDate: schedule.workDate,
    siteId: schedule.site.id,
    siteName: schedule.site.name,
    scheduledStartAt: schedule.scheduledStartAt,
    scheduledEndAt: schedule.scheduledEndAt,
    scheduledBreakMinutes: schedule.scheduledBreakMinutes,
    note: schedule.note,
    version: schedule.version,
  };
}

export interface PunchLocationInput {
  state: LocationState;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  capturedAt: string | null;
}

export class D1AttendanceRepository {
  constructor(private readonly database: D1Database) {}

  async findSchedule(userId: string, workDate: string): Promise<WorkScheduleSummary | null> {
    const row = await this.database
      .prepare(
        `SELECT ws.id, ws.work_date, ws.scheduled_start_at, ws.scheduled_end_at,
                ws.scheduled_break_minutes, ws.note, ws.version, site.id AS site_id,
                site.name AS site_name
           FROM work_schedules ws
           JOIN work_sites site ON site.id = ws.site_id
          WHERE ws.user_id = ? AND ws.work_date = ?`,
      )
      .bind(userId, workDate)
      .first<ScheduleRow>();
    return row ? mapSchedule(row) : null;
  }

  async findRecord(userId: string, workDate: string): Promise<AttendanceRecordSummary | null> {
    const row = await this.database
      .prepare(`${RECORD_SELECT} WHERE ar.user_id = ? AND ar.work_date = ?`)
      .bind(userId, workDate)
      .first<RecordRow>();
    if (!row) return null;

    const locations = await this.database
      .prepare(
        `SELECT event_type, location_state, latitude, longitude, accuracy_meters, captured_at
           FROM punch_events WHERE attendance_record_id = ? ORDER BY created_at`,
      )
      .bind(row.id)
      .all<LocationRow>();
    return mapRecord(row, locations.results);
  }

  async findRecordById(recordId: string): Promise<AttendanceRecordSummary | null> {
    const row = await this.database
      .prepare(`${RECORD_SELECT} WHERE ar.id = ?`)
      .bind(recordId)
      .first<RecordRow>();
    if (!row) return null;
    const locations = await this.database
      .prepare(
        `SELECT event_type, location_state, latitude, longitude, accuracy_meters, captured_at
           FROM punch_events WHERE attendance_record_id = ? ORDER BY created_at`,
      )
      .bind(row.id)
      .all<LocationRow>();
    return mapRecord(row, locations.results);
  }

  async findRequestForWorkDate(
    userId: string,
    workDate: string,
  ): Promise<AttendanceRequestSummary | null> {
    const row = await this.database
      .prepare(
        `${REQUEST_SELECT}
          WHERE r.user_id = ? AND r.work_date = ?
          ORDER BY CASE WHEN r.status IN ('pending', 'approved') THEN 0 ELSE 1 END,
                   r.requested_at DESC
          LIMIT 1`,
      )
      .bind(userId, workDate)
      .first<RequestRow>();
    return row ? mapRequest(row) : null;
  }

  async findPunchByClientRequestId(clientRequestId: string): Promise<PunchRow | null> {
    return this.database
      .prepare(
        `SELECT pe.id, pe.attendance_record_id, ar.work_date, pe.event_type,
                pe.client_request_id, pe.actor_user_id, pe.location_state,
                pe.latitude, pe.longitude, pe.accuracy_meters, pe.captured_at
           FROM punch_events pe
           JOIN attendance_records ar ON ar.id = pe.attendance_record_id
          WHERE pe.client_request_id = ?`,
      )
      .bind(clientRequestId)
      .first<PunchRow>();
  }

  async clockIn(input: {
    recordId: string;
    scheduleId: string;
    userId: string;
    workDate: string;
    occurredAt: string;
    eventId: string;
    clientRequestId: string;
    location: PunchLocationInput;
  }): Promise<boolean> {
    const insertRecord = this.database
      .prepare(
        `INSERT INTO attendance_records
           (id, user_id, work_date, schedule_id, clock_in_at, clock_out_at,
            actual_break_minutes, attendance_category, note, version,
            last_mutation_id, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, NULL, NULL, 'work', NULL, 1, ?, ?, ?
          WHERE NOT EXISTS (
            SELECT 1 FROM attendance_requests r
             WHERE r.user_id = ? AND r.work_date = ? AND r.status = 'approved'
          )
         ON CONFLICT(user_id, work_date) DO NOTHING`,
      )
      .bind(
        input.recordId,
        input.userId,
        input.workDate,
        input.scheduleId,
        input.occurredAt,
        input.clientRequestId,
        input.occurredAt,
        input.occurredAt,
        input.userId,
        input.workDate,
      );
    const updateRecord = this.database
      .prepare(
        `UPDATE attendance_records
            SET clock_in_at = ?, schedule_id = COALESCE(schedule_id, ?),
                version = version + 1, last_mutation_id = ?, updated_at = ?
          WHERE user_id = ? AND work_date = ? AND clock_in_at IS NULL
            AND clock_out_at IS NULL AND attendance_category = 'work'
            AND (last_mutation_id IS NULL OR last_mutation_id <> ?)
            AND NOT EXISTS (
              SELECT 1 FROM attendance_requests r
               WHERE r.user_id = ? AND r.work_date = ? AND r.status = 'approved'
            )`,
      )
      .bind(
        input.occurredAt,
        input.scheduleId,
        input.clientRequestId,
        input.occurredAt,
        input.userId,
        input.workDate,
        input.clientRequestId,
        input.userId,
        input.workDate,
      );
    const insertEvent = this.database
      .prepare(
        `INSERT INTO punch_events
           (id, attendance_record_id, event_type, occurred_at, client_request_id,
            latitude, longitude, accuracy_meters, captured_at, location_state,
            actor_user_id, created_at)
         SELECT ?, ar.id, 'clock_in', ?, ?, ?, ?, ?, ?, ?, ?, ?
           FROM attendance_records ar
          WHERE ar.user_id = ? AND ar.work_date = ? AND ar.last_mutation_id = ?`,
      )
      .bind(
        input.eventId,
        input.occurredAt,
        input.clientRequestId,
        input.location.latitude,
        input.location.longitude,
        input.location.accuracyMeters,
        input.location.capturedAt,
        input.location.state,
        input.userId,
        input.occurredAt,
        input.userId,
        input.workDate,
        input.clientRequestId,
      );
    const results = await this.database.batch([insertRecord, updateRecord, insertEvent]);
    const mutationCount =
      (results[0]?.meta.changes ?? 0) + (results[1]?.meta.changes ?? 0);
    return mutationCount === 1 && (results[2]?.meta.changes ?? 0) === 1;
  }

  async clockOut(input: {
    userId: string;
    workDate: string;
    occurredAt: string;
    breakMinutes: number;
    eventId: string;
    clientRequestId: string;
    location: PunchLocationInput;
  }): Promise<boolean> {
    const updateRecord = this.database
      .prepare(
        `UPDATE attendance_records
            SET clock_out_at = ?, actual_break_minutes = COALESCE(actual_break_minutes, ?),
                version = version + 1, last_mutation_id = ?, updated_at = ?
          WHERE user_id = ? AND work_date = ? AND clock_in_at IS NOT NULL
            AND clock_out_at IS NULL AND attendance_category = 'work'
            AND NOT EXISTS (
              SELECT 1 FROM attendance_requests r
               WHERE r.user_id = ? AND r.work_date = ? AND r.status = 'approved'
            )`,
      )
      .bind(
        input.occurredAt,
        input.breakMinutes,
        input.clientRequestId,
        input.occurredAt,
        input.userId,
        input.workDate,
        input.userId,
        input.workDate,
      );
    const insertEvent = this.database
      .prepare(
        `INSERT INTO punch_events
           (id, attendance_record_id, event_type, occurred_at, client_request_id,
            latitude, longitude, accuracy_meters, captured_at, location_state,
            actor_user_id, created_at)
         SELECT ?, ar.id, 'clock_out', ?, ?, ?, ?, ?, ?, ?, ?, ?
           FROM attendance_records ar
          WHERE ar.user_id = ? AND ar.work_date = ? AND ar.last_mutation_id = ?`,
      )
      .bind(
        input.eventId,
        input.occurredAt,
        input.clientRequestId,
        input.location.latitude,
        input.location.longitude,
        input.location.accuracyMeters,
        input.location.capturedAt,
        input.location.state,
        input.userId,
        input.occurredAt,
        input.userId,
        input.workDate,
        input.clientRequestId,
      );
    const results = await this.database.batch([updateRecord, insertEvent]);
    return (results[0]?.meta.changes ?? 0) === 1 && (results[1]?.meta.changes ?? 0) === 1;
  }

  async listMonth(input: {
    userId: string;
    monthStart: string;
    nextMonthStart: string;
  }): Promise<{
    schedules: WorkScheduleSummary[];
    records: AttendanceRecordSummary[];
    requests: AttendanceRequestSummary[];
  }> {
    const [scheduleRows, recordRows, requestRows] = await Promise.all([
      this.database
        .prepare(
          `SELECT ws.id, ws.work_date, ws.scheduled_start_at, ws.scheduled_end_at,
                  ws.scheduled_break_minutes, ws.note, ws.version, site.id AS site_id,
                  site.name AS site_name
             FROM work_schedules ws JOIN work_sites site ON site.id = ws.site_id
            WHERE ws.user_id = ? AND ws.work_date >= ? AND ws.work_date < ?
            ORDER BY ws.work_date`,
        )
        .bind(input.userId, input.monthStart, input.nextMonthStart)
        .all<ScheduleRow>(),
      this.database
        .prepare(
          `${RECORD_SELECT}
            WHERE ar.user_id = ? AND ar.work_date >= ? AND ar.work_date < ?
            ORDER BY ar.work_date`,
        )
        .bind(input.userId, input.monthStart, input.nextMonthStart)
        .all<RecordRow>(),
      this.database
        .prepare(
          `${REQUEST_SELECT}
            WHERE r.user_id = ? AND r.work_date >= ? AND r.work_date < ?
            ORDER BY r.work_date,
                     CASE WHEN r.status IN ('pending', 'approved') THEN 0 ELSE 1 END,
                     r.requested_at DESC`,
        )
        .bind(input.userId, input.monthStart, input.nextMonthStart)
        .all<RequestRow>(),
    ]);
    return {
      schedules: scheduleRows.results.map(mapSchedule),
      records: recordRows.results.map((row) => mapRecord(row)),
      requests: requestRows.results.map(mapRequest),
    };
  }

  async findScheduleMutationById(
    mutationId: string,
  ): Promise<ScheduleMutationReceipt | null> {
    const row = await this.database
      .prepare(
        `WITH mutation AS (
           SELECT entity_id, action, actor_user_id, before_json,
                  CASE WHEN action = 'delete' THEN before_json ELSE after_json END
                    AS snapshot_json
             FROM audit_logs
            WHERE entity_type = 'work_schedule'
              AND action IN ('create', 'update', 'delete')
              AND mutation_id = ?
            LIMIT 1
         )
         SELECT entity_id, action, actor_user_id,
                json_extract(snapshot_json, '$.userId') AS user_id,
                json_extract(snapshot_json, '$.workDate') AS work_date,
                CAST(json_extract(before_json, '$.version') AS INTEGER)
                  AS expected_version,
                json_extract(snapshot_json, '$.siteId') AS site_id,
                json_extract(snapshot_json, '$.siteName') AS site_name,
                json_extract(snapshot_json, '$.scheduledStartAt')
                  AS scheduled_start_at,
                json_extract(snapshot_json, '$.scheduledEndAt')
                  AS scheduled_end_at,
                json_extract(snapshot_json, '$.scheduledBreakMinutes')
                  AS scheduled_break_minutes,
                json_extract(snapshot_json, '$.note') AS note,
                CAST(json_extract(snapshot_json, '$.version') AS INTEGER)
                  AS result_version
           FROM mutation`,
      )
      .bind(mutationId)
      .first<ScheduleMutationRow>();
    if (!row) return null;
    return {
      scheduleId: row.entity_id,
      action: row.action,
      actorUserId: row.actor_user_id,
      userId: row.user_id,
      workDate: row.work_date,
      expectedVersion: row.expected_version,
      siteId: row.site_id,
      siteName: row.site_name,
      scheduledStartAt: row.scheduled_start_at,
      scheduledEndAt: row.scheduled_end_at,
      scheduledBreakMinutes: row.scheduled_break_minutes,
      note: row.note,
      resultVersion: row.result_version,
    };
  }

  async isMutationIdInUse(mutationId: string): Promise<boolean> {
    const row = await this.database
      .prepare(
        `SELECT (
           EXISTS(SELECT 1 FROM audit_logs WHERE mutation_id = ?)
           OR EXISTS(
             SELECT 1 FROM attendance_records WHERE last_mutation_id = ?
           )
           OR EXISTS(
             SELECT 1 FROM punch_events WHERE client_request_id = ?
           )
           OR EXISTS(
             SELECT 1 FROM attendance_requests
              WHERE creation_request_id = ? OR decision_request_id = ?
           )
         ) AS in_use`,
      )
      .bind(mutationId, mutationId, mutationId, mutationId, mutationId)
      .first<{ in_use: number }>();
    return row?.in_use === 1;
  }

  async createWorkSchedule(input: {
    scheduleId: string;
    userId: string;
    workDate: string;
    site: WorkSiteSummary;
    scheduledStartAt: string;
    scheduledEndAt: string;
    scheduledBreakMinutes: number | null;
    note: string | null;
    actorUserId: string;
    mutationId: string;
    now: string;
  }): Promise<boolean> {
    const created: WorkScheduleSummary = {
      id: input.scheduleId,
      workDate: input.workDate,
      scheduledStartAt: input.scheduledStartAt,
      scheduledEndAt: input.scheduledEndAt,
      scheduledBreakMinutes: input.scheduledBreakMinutes,
      site: input.site,
      note: input.note,
      version: 1,
    };
    const auditId = crypto.randomUUID();
    const insert = this.database
      .prepare(
        `INSERT INTO work_schedules
           (id, user_id, site_id, work_date, scheduled_start_at,
            scheduled_end_at, scheduled_break_minutes, note, version,
            created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?
          WHERE EXISTS (
            SELECT 1 FROM users
             WHERE id = ? AND role = 'employee' AND active = 1
          )
            AND EXISTS (
              SELECT 1 FROM work_sites WHERE id = ? AND active = 1
            )
            AND NOT EXISTS (
              SELECT 1 FROM work_schedules
               WHERE user_id = ? AND work_date = ?
            )
            ${SCHEDULE_MUTATION_UNLOCKED}
            AND NOT EXISTS (
              SELECT 1 FROM audit_logs WHERE mutation_id = ?
            )`,
      )
      .bind(
        input.scheduleId,
        input.userId,
        input.site.id,
        input.workDate,
        input.scheduledStartAt,
        input.scheduledEndAt,
        input.scheduledBreakMinutes,
        input.note,
        input.now,
        input.now,
        input.userId,
        input.site.id,
        input.userId,
        input.workDate,
        input.userId,
        input.workDate,
        input.userId,
        input.workDate,
        input.mutationId,
      );
    const audit = this.database
      .prepare(
        `INSERT INTO audit_logs
           (id, entity_type, entity_id, action, before_json, after_json,
            reason, mutation_id, actor_user_id, created_at)
         SELECT ?, 'work_schedule', ws.id, 'create', NULL, ?, NULL, ?, ?, ?
           FROM work_schedules ws
          WHERE ws.id = ? AND ws.user_id = ? AND ws.work_date = ?
            AND NOT EXISTS (
              SELECT 1 FROM audit_logs WHERE mutation_id = ?
            )`,
      )
      .bind(
        auditId,
        JSON.stringify(scheduleAuditSnapshot(created, input.userId)),
        input.mutationId,
        input.actorUserId,
        input.now,
        input.scheduleId,
        input.userId,
        input.workDate,
        input.mutationId,
      );
    const results = await this.database.batch([insert, audit]);
    return (results[0]?.meta.changes ?? 0) === 1 && (results[1]?.meta.changes ?? 0) === 1;
  }

  async updateWorkSchedule(input: {
    before: WorkScheduleSummary;
    userId: string;
    site: WorkSiteSummary;
    scheduledStartAt: string;
    scheduledEndAt: string;
    scheduledBreakMinutes: number | null;
    note: string | null;
    actorUserId: string;
    mutationId: string;
    now: string;
  }): Promise<boolean> {
    const updated: WorkScheduleSummary = {
      ...input.before,
      site: input.site,
      scheduledStartAt: input.scheduledStartAt,
      scheduledEndAt: input.scheduledEndAt,
      scheduledBreakMinutes: input.scheduledBreakMinutes,
      note: input.note,
      version: input.before.version + 1,
    };
    const auditId = crypto.randomUUID();
    const audit = this.database
      .prepare(
        `INSERT INTO audit_logs
           (id, entity_type, entity_id, action, before_json, after_json,
            reason, mutation_id, actor_user_id, created_at)
         SELECT ?, 'work_schedule', ws.id, 'update', ?, ?, NULL, ?, ?, ?
           FROM work_schedules ws
          WHERE ws.id = ? AND ws.user_id = ? AND ws.work_date = ?
            AND ws.version = ?
            AND EXISTS (
              SELECT 1 FROM users
               WHERE id = ? AND role = 'employee' AND active = 1
            )
            AND EXISTS (
              SELECT 1 FROM work_sites WHERE id = ? AND active = 1
            )
            ${SCHEDULE_MUTATION_UNLOCKED}
            AND NOT EXISTS (
              SELECT 1 FROM audit_logs WHERE mutation_id = ?
            )`,
      )
      .bind(
        auditId,
        JSON.stringify(scheduleAuditSnapshot(input.before, input.userId)),
        JSON.stringify(scheduleAuditSnapshot(updated, input.userId)),
        input.mutationId,
        input.actorUserId,
        input.now,
        input.before.id,
        input.userId,
        input.before.workDate,
        input.before.version,
        input.userId,
        input.site.id,
        input.userId,
        input.before.workDate,
        input.userId,
        input.before.workDate,
        input.mutationId,
      );
    const update = this.database
      .prepare(
        `UPDATE work_schedules
            SET site_id = ?, scheduled_start_at = ?, scheduled_end_at = ?,
                scheduled_break_minutes = ?, note = ?, version = version + 1,
                updated_at = ?
          WHERE id = ? AND user_id = ? AND work_date = ? AND version = ?
            AND EXISTS (
              SELECT 1 FROM audit_logs
               WHERE id = ? AND mutation_id = ?
            )`,
      )
      .bind(
        input.site.id,
        input.scheduledStartAt,
        input.scheduledEndAt,
        input.scheduledBreakMinutes,
        input.note,
        input.now,
        input.before.id,
        input.userId,
        input.before.workDate,
        input.before.version,
        auditId,
        input.mutationId,
      );
    const results = await this.database.batch([audit, update]);
    return (results[0]?.meta.changes ?? 0) === 1 && (results[1]?.meta.changes ?? 0) === 1;
  }

  async deleteWorkSchedule(input: {
    before: WorkScheduleSummary;
    userId: string;
    actorUserId: string;
    mutationId: string;
    now: string;
  }): Promise<boolean> {
    const auditId = crypto.randomUUID();
    const after = {
      id: input.before.id,
      userId: input.userId,
      workDate: input.before.workDate,
      version: input.before.version,
      deleted: true,
    };
    const audit = this.database
      .prepare(
        `INSERT INTO audit_logs
           (id, entity_type, entity_id, action, before_json, after_json,
            reason, mutation_id, actor_user_id, created_at)
         SELECT ?, 'work_schedule', ws.id, 'delete', ?, ?, NULL, ?, ?, ?
           FROM work_schedules ws
          WHERE ws.id = ? AND ws.user_id = ? AND ws.work_date = ?
            AND ws.version = ?
            AND EXISTS (
              SELECT 1 FROM users
               WHERE id = ? AND role = 'employee' AND active = 1
            )
            ${SCHEDULE_MUTATION_UNLOCKED}
            AND NOT EXISTS (
              SELECT 1 FROM audit_logs WHERE mutation_id = ?
            )`,
      )
      .bind(
        auditId,
        JSON.stringify(scheduleAuditSnapshot(input.before, input.userId)),
        JSON.stringify(after),
        input.mutationId,
        input.actorUserId,
        input.now,
        input.before.id,
        input.userId,
        input.before.workDate,
        input.before.version,
        input.userId,
        input.userId,
        input.before.workDate,
        input.userId,
        input.before.workDate,
        input.mutationId,
      );
    const remove = this.database
      .prepare(
        `DELETE FROM work_schedules
          WHERE id = ? AND user_id = ? AND work_date = ? AND version = ?
            AND EXISTS (
              SELECT 1 FROM audit_logs
               WHERE id = ? AND mutation_id = ?
            )`,
      )
      .bind(
        input.before.id,
        input.userId,
        input.before.workDate,
        input.before.version,
        auditId,
        input.mutationId,
      );
    const results = await this.database.batch([audit, remove]);
    return (results[0]?.meta.changes ?? 0) === 1 && (results[1]?.meta.changes ?? 0) === 1;
  }

  async findRecordMutationById(
    mutationId: string,
  ): Promise<RecordMutationReceipt | null> {
    const row = await this.database
      .prepare(
        `SELECT entity_id, actor_user_id, reason,
                CAST(json_extract(after_json, '$.version') AS INTEGER) - 1
                  AS expected_version,
                json_extract(after_json, '$.clockInAt') AS clock_in_at,
                json_extract(after_json, '$.clockOutAt') AS clock_out_at,
                json_extract(after_json, '$.actualBreakMinutes')
                  AS actual_break_minutes,
                json_extract(after_json, '$.attendanceCategory')
                  AS attendance_category,
                json_extract(after_json, '$.note') AS note
           FROM audit_logs
          WHERE entity_type = 'attendance_record' AND action = 'update'
            AND mutation_id = ?
          LIMIT 1`,
      )
      .bind(mutationId)
      .first<RecordMutationRow>();
    if (!row) return null;
    return {
      recordId: row.entity_id,
      actorUserId: row.actor_user_id,
      reason: row.reason,
      expectedVersion: row.expected_version,
      clockInAt: row.clock_in_at,
      clockOutAt: row.clock_out_at,
      actualBreakMinutes: row.actual_break_minutes,
      attendanceCategory: row.attendance_category,
      note: row.note,
    };
  }

  async isRecordMutationIdInUse(mutationId: string): Promise<boolean> {
    const row = await this.database
      .prepare(
        `SELECT (
           EXISTS(SELECT 1 FROM audit_logs WHERE mutation_id = ?)
           OR EXISTS(
             SELECT 1 FROM attendance_records WHERE last_mutation_id = ?
           )
         ) AS in_use`,
      )
      .bind(mutationId, mutationId)
      .first<{ in_use: number }>();
    return row?.in_use === 1;
  }

  async updateRecord(input: {
    recordId: string;
    expectedVersion: number;
    clockInAt: string | null;
    clockOutAt: string | null;
    actualBreakMinutes: number | null;
    attendanceCategory: AttendanceCategory;
    note: string | null;
    actorUserId: string;
    reason: string | null;
    before: AttendanceRecordSummary;
    now: string;
    mutationId: string;
  }): Promise<boolean> {
    const before = {
      id: input.before.id,
      userId: input.before.userId,
      workDate: input.before.workDate,
      clockInAt: input.before.clockInAt,
      clockOutAt: input.before.clockOutAt,
      actualBreakMinutes: input.before.actualBreakMinutes,
      attendanceCategory: input.before.attendanceCategory,
      note: input.before.note,
      version: input.before.version,
    };
    const after = {
      ...before,
      clockInAt: input.clockInAt,
      clockOutAt: input.clockOutAt,
      actualBreakMinutes: input.actualBreakMinutes,
      attendanceCategory: input.attendanceCategory,
      note: input.note,
      version: input.expectedVersion + 1,
      mutationId: input.mutationId,
    };
    const auditId = crypto.randomUUID();
    const audit = this.database
      .prepare(
        `INSERT INTO audit_logs
           (id, entity_type, entity_id, action, before_json, after_json,
            reason, mutation_id, actor_user_id, created_at)
         SELECT ?, 'attendance_record', id, 'update', ?, ?, ?, ?, ?, ?
           FROM attendance_records
          WHERE id = ? AND version = ?
            AND NOT EXISTS (
              SELECT 1 FROM audit_logs WHERE mutation_id = ?
            )
            AND NOT EXISTS (
              SELECT 1 FROM attendance_records WHERE last_mutation_id = ?
            )`,
      )
      .bind(
        auditId,
        JSON.stringify(before),
        JSON.stringify(after),
        input.reason,
        input.mutationId,
        input.actorUserId,
        input.now,
        input.recordId,
        input.expectedVersion,
        input.mutationId,
        input.mutationId,
      );
    const update = this.database
      .prepare(
        `UPDATE attendance_records
            SET clock_in_at = ?, clock_out_at = ?, actual_break_minutes = ?,
                attendance_category = ?, note = ?, version = version + 1,
                last_mutation_id = ?, updated_at = ?
          WHERE id = ? AND version = ?
            AND EXISTS (
              SELECT 1 FROM audit_logs
               WHERE id = ? AND mutation_id = ?
            )`,
      )
      .bind(
        input.clockInAt,
        input.clockOutAt,
        input.actualBreakMinutes,
        input.attendanceCategory,
        input.note,
        input.mutationId,
        input.now,
        input.recordId,
        input.expectedVersion,
        auditId,
        input.mutationId,
      );
    const results = await this.database.batch([audit, update]);
    return (results[0]?.meta.changes ?? 0) === 1 && (results[1]?.meta.changes ?? 0) === 1;
  }

  async listRequests(userId?: string): Promise<AttendanceRequestSummary[]> {
    const filter = userId ? "WHERE r.user_id = ?" : "";
    const statement = this.database.prepare(
      `${REQUEST_SELECT} ${filter}
       ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END,
                r.work_date DESC, r.requested_at DESC`,
    );
    const rows = userId
      ? await statement.bind(userId).all<RequestRow>()
      : await statement.all<RequestRow>();
    return rows.results.map(mapRequest);
  }

  async findRequestById(requestId: string): Promise<AttendanceRequestSummary | null> {
    const row = await this.database
      .prepare(`${REQUEST_SELECT} WHERE r.id = ?`)
      .bind(requestId)
      .first<RequestRow>();
    return row ? mapRequest(row) : null;
  }

  async findRequestByCreationRequestId(
    creationRequestId: string,
  ): Promise<AttendanceRequestSummary | null> {
    const row = await this.database
      .prepare(`${REQUEST_SELECT} WHERE r.creation_request_id = ?`)
      .bind(creationRequestId)
      .first<RequestRow>();
    return row ? mapRequest(row) : null;
  }

  async findRequestByDecisionRequestId(
    decisionRequestId: string,
  ): Promise<AttendanceRequestSummary | null> {
    const row = await this.database
      .prepare(`${REQUEST_SELECT} WHERE r.decision_request_id = ?`)
      .bind(decisionRequestId)
      .first<RequestRow>();
    return row ? mapRequest(row) : null;
  }

  async createRequest(input: {
    id: string;
    clientRequestId: string;
    userId: string;
    workDate: string;
    requestedCategory: Exclude<AttendanceCategory, "work">;
    reason: string;
    now: string;
  }): Promise<void> {
    const request = this.database
      .prepare(
        `INSERT INTO attendance_requests
           (id, creation_request_id, user_id, work_date, requested_category, reason, status,
            reviewer_user_id, review_comment, requested_at, reviewed_at,
            version, decision_request_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, NULL, 1, NULL, ?, ?)`,
      )
      .bind(
        input.id,
        input.clientRequestId,
        input.userId,
        input.workDate,
        input.requestedCategory,
        input.reason,
        input.now,
        input.now,
        input.now,
      );
    const audit = this.database
      .prepare(
        `INSERT INTO audit_logs
           (id, entity_type, entity_id, action, before_json, after_json,
            reason, actor_user_id, created_at)
         VALUES (?, 'attendance_request', ?, 'create', NULL, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        input.id,
        JSON.stringify({
          id: input.id,
          userId: input.userId,
          workDate: input.workDate,
          requestedCategory: input.requestedCategory,
          status: "pending",
        }),
        input.reason,
        input.userId,
        input.now,
      );
    await this.database.batch([request, audit]);
  }

  async transitionRequest(input: {
    request: AttendanceRequestSummary;
    nextStatus: Exclude<AttendanceRequestStatus, "pending">;
    actorUserId: string;
    reviewComment: string | null;
    clientRequestId: string;
    now: string;
  }): Promise<boolean> {
    const isReview = input.nextStatus === "approved" || input.nextStatus === "rejected";
    const update = this.database
      .prepare(
        `UPDATE attendance_requests
            SET status = ?, reviewer_user_id = ?, review_comment = ?,
                reviewed_at = ?, version = version + 1, decision_request_id = ?,
                updated_at = ?
          WHERE id = ? AND status = 'pending' AND version = ?
            AND (decision_request_id IS NULL OR decision_request_id = ?)
            AND (? != 'approved' OR NOT EXISTS (
              SELECT 1 FROM attendance_records ar
               WHERE ar.user_id = attendance_requests.user_id
                 AND ar.work_date = attendance_requests.work_date
                 AND (ar.clock_in_at IS NOT NULL OR ar.clock_out_at IS NOT NULL)
            ))`,
      )
      .bind(
        input.nextStatus,
        isReview ? input.actorUserId : null,
        isReview ? input.reviewComment : null,
        isReview ? input.now : null,
        input.clientRequestId,
        input.now,
        input.request.id,
        input.request.version,
        input.clientRequestId,
        input.nextStatus,
      );

    const statements: D1PreparedStatement[] = [update];
    if (input.nextStatus === "approved") {
      statements.push(
        this.database
          .prepare(
            `INSERT INTO attendance_records
               (id, user_id, work_date, schedule_id, clock_in_at, clock_out_at,
                actual_break_minutes, attendance_category, note, version,
                last_mutation_id, created_at, updated_at)
             SELECT ?, r.user_id, r.work_date, ws.id, NULL, NULL, NULL,
                    r.requested_category, NULL, 1, ?, ?, ?
               FROM attendance_requests r
               LEFT JOIN work_schedules ws
                 ON ws.user_id = r.user_id AND ws.work_date = r.work_date
              WHERE r.id = ? AND r.status = 'approved' AND r.decision_request_id = ?
             ON CONFLICT(user_id, work_date) DO UPDATE SET
               clock_in_at = NULL, clock_out_at = NULL, actual_break_minutes = NULL,
               attendance_category = excluded.attendance_category,
               version = attendance_records.version + 1,
               last_mutation_id = excluded.last_mutation_id,
               updated_at = excluded.updated_at
             WHERE attendance_records.clock_in_at IS NULL
               AND attendance_records.clock_out_at IS NULL
               AND attendance_records.last_mutation_id IS NOT excluded.last_mutation_id`,
          )
          .bind(
            crypto.randomUUID(),
            input.clientRequestId,
            input.now,
            input.now,
            input.request.id,
            input.clientRequestId,
          ),
      );
    }
    const after = {
      ...input.request,
      status: input.nextStatus,
      decisionRequestId: input.clientRequestId,
    };
    statements.push(
      this.database
        .prepare(
          `INSERT INTO audit_logs
             (id, entity_type, entity_id, action, before_json, after_json,
              reason, actor_user_id, created_at)
           SELECT ?, 'attendance_request', r.id, ?, ?, ?, ?, ?, ?
             FROM attendance_requests r
            WHERE r.id = ? AND r.decision_request_id = ? AND r.status = ?
              AND NOT EXISTS (
                SELECT 1 FROM audit_logs existing
                 WHERE existing.entity_type = 'attendance_request'
                   AND existing.entity_id = r.id AND existing.action = ?
                   AND existing.after_json = ?
              )`,
        )
        .bind(
          crypto.randomUUID(),
          input.nextStatus === "approved"
            ? "approve"
            : input.nextStatus === "rejected"
              ? "reject"
              : "withdraw",
          JSON.stringify(input.request),
          JSON.stringify(after),
          input.reviewComment,
          input.actorUserId,
          input.now,
          input.request.id,
          input.clientRequestId,
          input.nextStatus,
          input.nextStatus === "approved"
            ? "approve"
            : input.nextStatus === "rejected"
              ? "reject"
              : "withdraw",
          JSON.stringify(after),
        ),
    );
    const results = await this.database.batch(statements);
    const updateSucceeded = (results[0]?.meta.changes ?? 0) === 1;
    const auditSucceeded = (results.at(-1)?.meta.changes ?? 0) === 1;
    return updateSucceeded && auditSucceeded;
  }

  async listEmployees(): Promise<EmployeeDirectoryItem[]> {
    const rows = await this.database
      .prepare(
        `SELECT id, employee_code, display_name, normalized_email
           FROM users WHERE role = 'employee' AND active = 1
          ORDER BY employee_code, display_name`,
      )
      .all<DirectoryRow>();
    return rows.results.map((row) => ({
      id: row.id,
      employeeCode: row.employee_code,
      displayName: row.display_name,
      email: row.normalized_email,
    }));
  }

  async findActiveEmployee(userId: string): Promise<EmployeeDirectoryItem | null> {
    const row = await this.database
      .prepare(
        `SELECT id, employee_code, display_name, normalized_email
           FROM users
          WHERE id = ? AND role = 'employee' AND active = 1`,
      )
      .bind(userId)
      .first<DirectoryRow>();
    return row
      ? {
          id: row.id,
          employeeCode: row.employee_code,
          displayName: row.display_name,
          email: row.normalized_email,
        }
      : null;
  }

  async listSites(): Promise<Array<{ id: string; name: string }>> {
    const rows = await this.database
      .prepare("SELECT id, name FROM work_sites WHERE active = 1 ORDER BY name")
      .all<{ id: string; name: string }>();
    return rows.results;
  }

  async findActiveSite(siteId: string): Promise<WorkSiteSummary | null> {
    return this.database
      .prepare("SELECT id, name FROM work_sites WHERE id = ? AND active = 1")
      .bind(siteId)
      .first<WorkSiteSummary>();
  }

  async listDailyAttendance(
    workDate: string,
    siteId?: string,
    serverNow = new Date().toISOString(),
  ): Promise<AdminAttendanceRow[]> {
    const employees = await this.listEmployees();
    const rows = await Promise.all(
      employees.map(async (user) => {
        const [schedule, record, request] = await Promise.all([
          this.findSchedule(user.id, workDate),
          this.findRecord(user.id, workDate),
          this.findRequestForWorkDate(user.id, workDate),
        ]);
        const state = determineAttendanceStatus({
          hasSchedule: schedule !== null,
          workDate,
          clockInAt: record?.clockInAt,
          clockOutAt: record?.clockOutAt,
          actualBreakMinutes: record?.actualBreakMinutes,
          attendanceCategory: record?.attendanceCategory ?? "work",
        });
        const overdue = isClockInOverdue({
          status: state,
          scheduledStartAt: schedule?.scheduledStartAt,
          serverNow,
        });
        return {
          user,
          schedule,
          record,
          request,
          state,
          overdue,
          scheduleMutation: getScheduleMutationState({ record, request }),
        } satisfies AdminAttendanceRow;
      }),
    );
    return rows
      .filter((row) => !siteId || row.schedule?.site.id === siteId)
      .sort((left, right) => {
        const byStart = (left.schedule?.scheduledStartAt ?? "").localeCompare(
          right.schedule?.scheduledStartAt ?? "",
        );
        return byStart || left.user.displayName.localeCompare(right.user.displayName, "ja");
      });
  }

  async listRecordUpdateAuditLogs(
    recordId: string,
  ): Promise<AttendanceRecordAuditEntry[]> {
    const rows = await this.database
      .prepare(
        `SELECT al.id, al.entity_id, al.before_json, al.after_json, al.reason,
                actor.display_name AS actor_display_name, al.created_at
           FROM audit_logs al
           JOIN users actor ON actor.id = al.actor_user_id
          WHERE al.entity_type = 'attendance_record'
            AND al.entity_id = ?
            AND al.action = 'update'
          ORDER BY al.created_at DESC, al.id DESC`,
      )
      .bind(recordId)
      .all<RecordAuditRow>();
    return rows.results.map((row) => ({
      id: row.id,
      recordId: row.entity_id,
      before: safeJson(row.before_json),
      after: safeJson(row.after_json),
      reason: row.reason,
      actorDisplayName: row.actor_display_name,
      createdAt: row.created_at,
    }));
  }

  async listAuditLogs(
    filters: AuditLogFilters = {},
  ): Promise<AuditLogSummary[]> {
    const conditions: string[] = [];
    const bindings: Array<string | number> = [];
    if (filters.entityType) {
      conditions.push("al.entity_type = ?");
      bindings.push(filters.entityType);
    }
    if (filters.entityId) {
      conditions.push("al.entity_id = ?");
      bindings.push(filters.entityId);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
    const rows = await this.database
      .prepare(
        `SELECT al.id, al.entity_type, al.entity_id, al.action, al.before_json,
                al.after_json, al.reason, al.actor_user_id,
                actor.display_name AS actor_display_name,
                COALESCE(
                  ar.user_id,
                  req.user_id,
                  json_extract(al.after_json, '$.userId'),
                  json_extract(al.before_json, '$.userId')
                ) AS subject_user_id,
                subject.display_name AS subject_display_name, al.created_at
           FROM audit_logs al
           JOIN users actor ON actor.id = al.actor_user_id
           LEFT JOIN attendance_records ar
             ON al.entity_type = 'attendance_record' AND ar.id = al.entity_id
           LEFT JOIN attendance_requests req
             ON al.entity_type = 'attendance_request' AND req.id = al.entity_id
           LEFT JOIN users subject ON subject.id = COALESCE(
             ar.user_id,
             req.user_id,
             json_extract(al.after_json, '$.userId'),
             json_extract(al.before_json, '$.userId')
           )
          ${where}
          ORDER BY al.created_at DESC LIMIT ?`,
      )
      .bind(...bindings, limit)
      .all<AuditRow>();
    return rows.results.map(mapAudit);
  }
}
