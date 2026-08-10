import { toJstWorkDate } from "@/lib/domain/datetime";

export const PACKAGED_SEED_RECONCILE_MARKER = "demo-seed-reconcile-v1";
export const RUNTIME_PASSWORD_RECONCILE_MARKER = "demo-runtime-passwords-v1";

function jstTime(workDate: string, time: string): string {
  return new Date(`${workDate}T${time}:00+09:00`).toISOString();
}

function offsetWorkDate(now: Date, offsetDays: number): string {
  const shifted = new Date(now.getTime() + offsetDays * 86_400_000);
  return toJstWorkDate(shifted);
}

export interface DemoAttendanceResetInput {
  database: D1Database;
  actorUserId: string;
  now?: Date;
  source?: "admin_reset" | "empty_d1_bootstrap" | "packaged_seed_reconcile";
}

export function buildDemoAttendanceResetStatements(
  input: DemoAttendanceResetInput,
): D1PreparedStatement[] {
  const now = input.now ?? new Date();
  const createdAt = now.toISOString();
  const today = offsetWorkDate(now, 0);
  const yesterday = offsetWorkDate(now, -1);
  const todayStart = new Date(`${today}T00:00:00+09:00`);
  const maruTodayClockIn = new Date(
    Math.max(
      todayStart.getTime(),
      Math.min(now.getTime(), new Date(`${today}T08:58:00+09:00`).getTime()),
    ),
  ).toISOString();
  const batsuTodayClockOutDate = new Date(
    Math.min(now.getTime(), new Date(`${today}T18:05:00+09:00`).getTime()),
  );
  const hasBatsuCompletedToday = batsuTodayClockOutDate > todayStart;
  const batsuTodayClockIn = hasBatsuCompletedToday
    ? new Date(
        Math.max(
          todayStart.getTime(),
          Math.min(
            new Date(`${today}T08:55:00+09:00`).getTime(),
            batsuTodayClockOutDate.getTime() - 1,
          ),
        ),
      ).toISOString()
    : null;
  const batsuTodayClockOut = hasBatsuCompletedToday
    ? batsuTodayClockOutDate.toISOString()
    : null;
  const batsuTodayBreakMinutes =
    batsuTodayClockIn && batsuTodayClockOut
      ? Math.min(
          60,
          Math.floor(
            (Date.parse(batsuTodayClockOut) - Date.parse(batsuTodayClockIn)) /
              60_000,
          ),
        )
      : null;
  const statement = (sql: string, ...values: unknown[]): D1PreparedStatement =>
    input.database.prepare(sql).bind(...values);

  const statements: D1PreparedStatement[] = [
    statement("DELETE FROM audit_logs"),
    statement("DELETE FROM punch_events"),
    statement("DELETE FROM attendance_requests"),
    statement("DELETE FROM attendance_records"),
    statement("DELETE FROM work_schedules"),
    statement(
      `DELETE FROM login_rate_limits
        WHERE NOT (
          scope_type = 'account' AND scope_key_hash IN (?, ?)
        )`,
      PACKAGED_SEED_RECONCILE_MARKER,
      RUNTIME_PASSWORD_RECONCILE_MARKER,
    ),
  ];

  const schedules = [
    ["schedule-maru-today", "user-maru", "site-a", today, "09:00", "18:00"],
    ["schedule-batsu-today", "user-batsu", "site-a", today, "09:00", "18:00"],
    ["schedule-sankaku-today", "user-sankaku", "site-b", today, "09:30", "18:30"],
    ["schedule-shikaku-today", "user-shikaku", "site-b", today, "09:30", "18:30"],
    ["schedule-hishi-today", "user-hishi", "site-a", today, "09:00", "18:00"],
    ["schedule-maru-yesterday", "user-maru", "site-a", yesterday, "09:00", "18:00"],
  ] as const;
  for (const [id, userId, siteId, workDate, start, end] of schedules) {
    statements.push(
      statement(
        `INSERT INTO work_schedules
           (id, user_id, site_id, work_date, scheduled_start_at, scheduled_end_at,
            scheduled_break_minutes, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 60, NULL, ?, ?)`,
        id,
        userId,
        siteId,
        workDate,
        jstTime(workDate, start),
        jstTime(workDate, end),
        createdAt,
        createdAt,
      ),
    );
  }

  const records = [
    ["attendance-maru-today", "user-maru", today, "schedule-maru-today", maruTodayClockIn, null, null, "work", null, 1, "seed-maru-clock-in"],
    ["attendance-batsu-today", "user-batsu", today, "schedule-batsu-today", batsuTodayClockIn, batsuTodayClockOut, batsuTodayBreakMinutes, "work", hasBatsuCompletedToday ? "予定どおり勤務" : null, 1, hasBatsuCompletedToday ? "seed-batsu-clock-out" : null],
    ["attendance-sankaku-today", "user-sankaku", today, "schedule-sankaku-today", null, null, null, "work", null, 1, null],
    ["attendance-shikaku-today", "user-shikaku", today, "schedule-shikaku-today", null, null, null, "work", null, 1, null],
    ["attendance-hishi-today", "user-hishi", today, "schedule-hishi-today", null, null, null, "sick_leave", "病欠承認済み", 2, "seed-hishi-approval"],
    ["attendance-maru-yesterday", "user-maru", yesterday, "schedule-maru-yesterday", jstTime(yesterday, "09:05"), jstTime(yesterday, "18:00"), 60, "work", "本人修正済み", 2, "seed-maru-correction"],
  ] as const;
  for (const record of records) {
    statements.push(
      statement(
        `INSERT INTO attendance_records
           (id, user_id, work_date, schedule_id, clock_in_at, clock_out_at,
            actual_break_minutes, attendance_category, note, version,
            last_mutation_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ...record,
        createdAt,
        createdAt,
      ),
    );
  }

  const punches = [
    ["punch-maru-today-in", "attendance-maru-today", "clock_in", maruTodayClockIn, "seed-maru-clock-in", 12.345678, 123.456789, 18, maruTodayClockIn, "granted", "user-maru"],
    ...(hasBatsuCompletedToday && batsuTodayClockIn && batsuTodayClockOut
      ? [
          ["punch-batsu-today-in", "attendance-batsu-today", "clock_in", batsuTodayClockIn, "seed-batsu-clock-in", null, null, null, null, "denied", "user-batsu"],
          ["punch-batsu-today-out", "attendance-batsu-today", "clock_out", batsuTodayClockOut, "seed-batsu-clock-out", null, null, null, null, "timeout", "user-batsu"],
        ]
      : []),
    ["punch-maru-yesterday-in", "attendance-maru-yesterday", "clock_in", jstTime(yesterday, "09:12"), "seed-maru-yesterday-in", null, null, null, null, "unavailable", "user-maru"],
    ["punch-maru-yesterday-out", "attendance-maru-yesterday", "clock_out", jstTime(yesterday, "18:00"), "seed-maru-yesterday-out", -12.345678, -123.456789, 24, jstTime(yesterday, "18:00"), "granted", "user-maru"],
  ] as const;
  for (const punch of punches) {
    statements.push(
      statement(
        `INSERT INTO punch_events
           (id, attendance_record_id, event_type, occurred_at, client_request_id,
            latitude, longitude, accuracy_meters, captured_at, location_state,
            actor_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ...punch,
        createdAt,
      ),
    );
  }

  const requests = [
    ["request-shikaku-pending", "00000000-0000-4000-8000-000000000101", "user-shikaku", today, "paid_leave", "私用のため", "pending", null, null, jstTime(today, "07:30"), null, 1, null],
    ["request-hishi-approved", "00000000-0000-4000-8000-000000000102", "user-hishi", today, "sick_leave", "体調不良のため", "approved", "user-admin", "承認しました", jstTime(today, "07:10"), jstTime(today, "07:20"), 2, "00000000-0000-4000-8000-000000000201"],
    ["request-sankaku-rejected", "00000000-0000-4000-8000-000000000103", "user-sankaku", yesterday, "other", "終日不在のため", "rejected", "user-admin", "勤務予定を確認してください", jstTime(yesterday, "06:50"), jstTime(yesterday, "07:00"), 2, "00000000-0000-4000-8000-000000000202"],
  ] as const;
  for (const attendanceRequest of requests) {
    statements.push(
      statement(
        `INSERT INTO attendance_requests
           (id, creation_request_id, user_id, work_date, requested_category,
            reason, status, reviewer_user_id, review_comment, requested_at,
            reviewed_at, version, decision_request_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ...attendanceRequest,
        createdAt,
        createdAt,
      ),
    );
  }

  statements.push(
    statement(
      `INSERT INTO audit_logs
         (id, entity_type, entity_id, action, before_json, after_json, reason,
          mutation_id, actor_user_id, created_at)
       VALUES ('audit-maru-correction', 'attendance_record',
               'attendance-maru-yesterday', 'update', ?, ?, ?,
               'seed-maru-correction', 'user-maru', ?)`,
      JSON.stringify({
        clockInAt: jstTime(yesterday, "09:12"),
        clockOutAt: jstTime(yesterday, "18:00"),
        actualBreakMinutes: 60,
      }),
      JSON.stringify({
        clockInAt: jstTime(yesterday, "09:05"),
        clockOutAt: jstTime(yesterday, "18:00"),
        actualBreakMinutes: 60,
      }),
      "打刻時刻を見直したため",
      createdAt,
    ),
    statement(
      `INSERT INTO audit_logs
         (id, entity_type, entity_id, action, before_json, after_json, reason,
          actor_user_id, created_at)
       VALUES ('audit-hishi-approval', 'attendance_request',
               'request-hishi-approved', 'approve', ?, ?, ?, 'user-admin', ?)`,
      JSON.stringify({ status: "pending" }),
      JSON.stringify({ status: "approved", attendanceCategory: "sick_leave" }),
      "承認しました",
      createdAt,
    ),
    statement(
      `INSERT INTO audit_logs
         (id, entity_type, entity_id, action, before_json, after_json, reason,
          actor_user_id, created_at)
       VALUES ('audit-sankaku-rejection', 'attendance_request',
               'request-sankaku-rejected', 'reject', ?, ?, ?, 'user-admin', ?)`,
      JSON.stringify({ status: "pending" }),
      JSON.stringify({ status: "rejected" }),
      "勤務予定を確認してください",
      createdAt,
    ),
  );

  statements.push(
    statement(
      `INSERT INTO audit_logs
         (id, entity_type, entity_id, action, before_json, after_json, reason,
          actor_user_id, created_at)
       VALUES (?, 'demo_dataset', 'primary', 'reset', NULL, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      JSON.stringify({
        workDate: today,
        state: "seeded",
        source: input.source ?? "admin_reset",
      }),
      input.source === "empty_d1_bootstrap"
        ? "空の公開デモD1を初回ログインで初期化したため"
        : input.source === "packaged_seed_reconcile"
          ? "Sites同梱seedを実行日の公開デモ状態へ整合したため"
          : "デモデータを初期状態へ戻したため",
      input.actorUserId,
      createdAt,
    ),
  );

  return statements;
}

export async function resetDemoAttendanceData(
  input: DemoAttendanceResetInput,
): Promise<void> {
  await input.database.batch(buildDemoAttendanceResetStatements(input));
}
