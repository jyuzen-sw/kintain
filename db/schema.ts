import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const utcNow = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const userRoles = ["employee", "admin"] as const;
export const attendanceCategories = [
  "work",
  "paid_leave",
  "absence",
  "sick_leave",
  "other",
] as const;
export const punchEventTypes = ["clock_in", "clock_out"] as const;
export const locationStates = ["granted", "denied", "unavailable", "timeout"] as const;
export const attendanceRequestStatuses = [
  "pending",
  "approved",
  "rejected",
  "withdrawn",
] as const;

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    employeeCode: text("employee_code"),
    normalizedEmail: text("normalized_email"),
    displayName: text("display_name").notNull(),
    role: text("role", { enum: userRoles }).notNull(),
    passwordHash: text("password_hash"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull().default(utcNow),
    updatedAt: text("updated_at").notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex("users_employee_code_unique").on(table.employeeCode),
    uniqueIndex("users_normalized_email_unique").on(table.normalizedEmail),
    check("users_role_check", sql`${table.role} IN ('employee', 'admin')`),
    check("users_active_check", sql`${table.active} IN (0, 1)`),
  ],
);

export const workSites = sqliteTable(
  "work_sites",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull().default(utcNow),
    updatedAt: text("updated_at").notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex("work_sites_name_unique").on(table.name),
    check("work_sites_active_check", sql`${table.active} IN (0, 1)`),
  ],
);

export const workSchedules = sqliteTable(
  "work_schedules",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    siteId: text("site_id")
      .notNull()
      .references(() => workSites.id, { onDelete: "restrict" }),
    workDate: text("work_date").notNull(),
    scheduledStartAt: text("scheduled_start_at").notNull(),
    scheduledEndAt: text("scheduled_end_at").notNull(),
    scheduledBreakMinutes: integer("scheduled_break_minutes"),
    note: text("note"),
    createdAt: text("created_at").notNull().default(utcNow),
    updatedAt: text("updated_at").notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex("work_schedules_user_work_date_unique").on(table.userId, table.workDate),
    index("work_schedules_site_work_date_idx").on(table.siteId, table.workDate),
    check(
      "work_schedules_time_order_check",
      sql`${table.scheduledEndAt} > ${table.scheduledStartAt}`,
    ),
    check(
      "work_schedules_break_minutes_check",
      sql`${table.scheduledBreakMinutes} IS NULL OR ${table.scheduledBreakMinutes} >= 0`,
    ),
  ],
);

export const attendanceRecords = sqliteTable(
  "attendance_records",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workDate: text("work_date").notNull(),
    scheduleId: text("schedule_id").references(() => workSchedules.id, { onDelete: "set null" }),
    clockInAt: text("clock_in_at"),
    clockOutAt: text("clock_out_at"),
    actualBreakMinutes: integer("actual_break_minutes"),
    attendanceCategory: text("attendance_category", { enum: attendanceCategories })
      .notNull()
      .default("work"),
    note: text("note"),
    version: integer("version").notNull().default(1),
    lastMutationId: text("last_mutation_id"),
    createdAt: text("created_at").notNull().default(utcNow),
    updatedAt: text("updated_at").notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex("attendance_records_user_work_date_unique").on(table.userId, table.workDate),
    uniqueIndex("attendance_records_last_mutation_id_unique")
      .on(table.lastMutationId)
      .where(sql`${table.lastMutationId} IS NOT NULL`),
    index("attendance_records_work_date_idx").on(table.workDate),
    check(
      "attendance_records_category_check",
      sql`${table.attendanceCategory} IN ('work', 'paid_leave', 'absence', 'sick_leave', 'other')`,
    ),
    check("attendance_records_version_check", sql`${table.version} >= 1`),
    check(
      "attendance_records_break_minutes_check",
      sql`${table.actualBreakMinutes} IS NULL OR ${table.actualBreakMinutes} >= 0`,
    ),
    check(
      "attendance_records_time_order_check",
      sql`${table.clockOutAt} IS NULL OR (${table.clockInAt} IS NOT NULL AND ${table.clockOutAt} > ${table.clockInAt})`,
    ),
    check(
      "attendance_records_non_work_times_check",
      sql`${table.attendanceCategory} = 'work' OR (${table.clockInAt} IS NULL AND ${table.clockOutAt} IS NULL)`,
    ),
  ],
);

export const punchEvents = sqliteTable(
  "punch_events",
  {
    id: text("id").primaryKey(),
    attendanceRecordId: text("attendance_record_id")
      .notNull()
      .references(() => attendanceRecords.id, { onDelete: "cascade" }),
    eventType: text("event_type", { enum: punchEventTypes }).notNull(),
    occurredAt: text("occurred_at").notNull(),
    clientRequestId: text("client_request_id").notNull(),
    latitude: real("latitude"),
    longitude: real("longitude"),
    accuracyMeters: real("accuracy_meters"),
    capturedAt: text("captured_at"),
    locationState: text("location_state", { enum: locationStates }).notNull(),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: text("created_at").notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex("punch_events_client_request_id_unique").on(table.clientRequestId),
    uniqueIndex("punch_events_record_event_type_unique").on(
      table.attendanceRecordId,
      table.eventType,
    ),
    index("punch_events_record_occurred_at_idx").on(table.attendanceRecordId, table.occurredAt),
    check("punch_events_event_type_check", sql`${table.eventType} IN ('clock_in', 'clock_out')`),
    check(
      "punch_events_location_state_check",
      sql`${table.locationState} IN ('granted', 'denied', 'unavailable', 'timeout')`,
    ),
    check(
      "punch_events_coordinates_check",
      sql`(${table.locationState} = 'granted' AND ${table.latitude} BETWEEN -90 AND 90 AND ${table.longitude} BETWEEN -180 AND 180 AND ${table.accuracyMeters} >= 0) OR (${table.locationState} <> 'granted' AND ${table.latitude} IS NULL AND ${table.longitude} IS NULL AND ${table.accuracyMeters} IS NULL)`,
    ),
  ],
);

export const attendanceRequests = sqliteTable(
  "attendance_requests",
  {
    id: text("id").primaryKey(),
    creationRequestId: text("creation_request_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workDate: text("work_date").notNull(),
    requestedCategory: text("requested_category", {
      enum: ["paid_leave", "absence", "sick_leave", "other"],
    }).notNull(),
    reason: text("reason").notNull(),
    status: text("status", { enum: attendanceRequestStatuses }).notNull().default("pending"),
    reviewerUserId: text("reviewer_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewComment: text("review_comment"),
    requestedAt: text("requested_at").notNull().default(utcNow),
    reviewedAt: text("reviewed_at"),
    version: integer("version").notNull().default(1),
    decisionRequestId: text("decision_request_id"),
    createdAt: text("created_at").notNull().default(utcNow),
    updatedAt: text("updated_at").notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex("attendance_requests_creation_request_id_unique").on(
      table.creationRequestId,
    ),
    uniqueIndex("attendance_requests_active_user_work_date_unique")
      .on(table.userId, table.workDate)
      .where(sql`${table.status} IN ('pending', 'approved')`),
    uniqueIndex("attendance_requests_decision_request_id_unique")
      .on(table.decisionRequestId)
      .where(sql`${table.decisionRequestId} IS NOT NULL`),
    index("attendance_requests_status_work_date_idx").on(table.status, table.workDate),
    index("attendance_requests_user_requested_at_idx").on(table.userId, table.requestedAt),
    check(
      "attendance_requests_category_check",
      sql`${table.requestedCategory} IN ('paid_leave', 'absence', 'sick_leave', 'other')`,
    ),
    check(
      "attendance_requests_status_check",
      sql`${table.status} IN ('pending', 'approved', 'rejected', 'withdrawn')`,
    ),
    check("attendance_requests_version_check", sql`${table.version} >= 1`),
  ],
);

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    beforeJson: text("before_json"),
    afterJson: text("after_json").notNull(),
    reason: text("reason"),
    mutationId: text("mutation_id"),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: text("created_at").notNull().default(utcNow),
  },
  (table) => [
    index("audit_logs_entity_created_at_idx").on(
      table.entityType,
      table.entityId,
      table.createdAt,
    ),
    index("audit_logs_actor_created_at_idx").on(table.actorUserId, table.createdAt),
    uniqueIndex("audit_logs_mutation_id_unique")
      .on(table.mutationId)
      .where(sql`${table.mutationId} IS NOT NULL`),
    check("audit_logs_before_json_check", sql`${table.beforeJson} IS NULL OR json_valid(${table.beforeJson})`),
    check("audit_logs_after_json_check", sql`json_valid(${table.afterJson})`),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    csrfTokenHash: text("csrf_token_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull().default(utcNow),
    lastSeenAt: text("last_seen_at").notNull().default(utcNow),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
    index("sessions_user_expires_at_idx").on(table.userId, table.expiresAt),
    index("sessions_expires_at_idx").on(table.expiresAt),
  ],
);

export const loginRateLimits = sqliteTable(
  "login_rate_limits",
  {
    scopeType: text("scope_type", { enum: ["account", "ip"] }).notNull(),
    scopeKeyHash: text("scope_key_hash").notNull(),
    windowStartedAt: text("window_started_at").notNull(),
    failureCount: integer("failure_count").notNull().default(0),
    blockedUntil: text("blocked_until"),
    updatedAt: text("updated_at").notNull().default(utcNow),
  },
  (table) => [
    primaryKey({ columns: [table.scopeType, table.scopeKeyHash] }),
    index("login_rate_limits_blocked_until_idx").on(table.blockedUntil),
    check("login_rate_limits_scope_type_check", sql`${table.scopeType} IN ('account', 'ip')`),
    check("login_rate_limits_failure_count_check", sql`${table.failureCount} >= 0`),
  ],
);
