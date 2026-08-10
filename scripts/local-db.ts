import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const databaseBinding = "DB";
const passwordIterations = 100_000;
const localEmployeePassword =
  process.env.LOCAL_DEMO_EMPLOYEE_PASSWORD ?? "DemoPass!2026";
const localAdminPassword = process.env.LOCAL_DEMO_ADMIN_PASSWORD ?? "AdminDemo!2026";

type Command = "seed" | "reset" | "render";
type SqlValue = string | number | null;
type D1QueryResult<Row> = {
  results?: Row[];
  success: boolean;
};

function readCommand(value: string | undefined): Command {
  if (value === "seed" || value === "reset" || value === "render") return value;
  throw new Error("Usage: scripts/local-db.ts <seed|reset|render>");
}

function wranglerEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  delete environment.WRANGLER_LOG;
  return {
    ...environment,
    WRANGLER_SEND_METRICS: "false",
    WRANGLER_WRITE_LOGS: "false",
  };
}

function runWrangler(args: string[]): void {
  const executable = resolve("node_modules/wrangler/bin/wrangler.js");
  const result = spawnSync(process.execPath, [executable, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: wranglerEnvironment(),
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`wrangler exited with status ${result.status ?? "unknown"}`);
  }
}

function queryLocalDatabase<Row>(sql: string): Row[] {
  const executable = resolve("node_modules/wrangler/bin/wrangler.js");
  const result = spawnSync(
    process.execPath,
    [
      executable,
      "d1",
      "execute",
      databaseBinding,
      "--local",
      "--command",
      sql,
      "--json",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: wranglerEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `wrangler query exited with status ${result.status ?? "unknown"}: ${result.stderr.trim()}`,
    );
  }

  const response = JSON.parse(result.stdout) as D1QueryResult<Row>[];
  if (!Array.isArray(response) || response.some((item) => item.success !== true)) {
    throw new Error("Local D1 query did not complete successfully");
  }
  return response.flatMap((item) => item.results ?? []);
}

function localApplicationSchemaExists(): boolean {
  const [row] = queryLocalDatabase<{ table_count: number }>(`
    SELECT COUNT(*) AS table_count
    FROM sqlite_master
    WHERE type = 'table' AND name = 'users'
  `);
  return Number(row?.table_count ?? 0) > 0;
}

function localApplicationRowCount(): number {
  const [row] = queryLocalDatabase<{ row_count: number }>(`
    SELECT
      (SELECT COUNT(*) FROM users) +
      (SELECT COUNT(*) FROM work_sites) +
      (SELECT COUNT(*) FROM work_schedules) +
      (SELECT COUNT(*) FROM attendance_records) +
      (SELECT COUNT(*) FROM punch_events) +
      (SELECT COUNT(*) FROM attendance_requests) +
      (SELECT COUNT(*) FROM audit_logs) +
      (SELECT COUNT(*) FROM sessions) +
      (SELECT COUNT(*) FROM login_rate_limits)
      AS row_count
  `);
  return Number(row?.row_count ?? 0);
}

function executeSql(sql: string): void {
  const directory = mkdtempSync(resolve(tmpdir(), "kintain-local-db-"));
  const file = resolve(directory, "commands.sql");
  try {
    writeFileSync(file, `${sql.trim()}\n`, "utf8");
    runWrangler(["d1", "execute", databaseBinding, "--local", "--file", file]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function toBase64Url(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  return Buffer.from(bytes).toString("base64url");
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const hash = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations: passwordIterations,
    },
    key,
    256,
  );
  return `pbkdf2-sha256$${passwordIterations}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

function sqlValue(value: SqlValue): string {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlValues(rows: SqlValue[][], expectedColumnCount: number): string {
  const invalidRow = rows.findIndex((row) => row.length !== expectedColumnCount);
  if (invalidRow !== -1) {
    throw new Error(
      `Seed row ${invalidRow + 1} has ${rows[invalidRow].length} values; expected ${expectedColumnCount}`,
    );
  }
  return rows.map((row) => `(${row.map(sqlValue).join(", ")})`).join(",\n  ");
}

const workDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function jstWorkDate(offsetDays = 0, baseDate = new Date()): string {
  const today = workDateFormatter.format(baseDate);
  const base = new Date(`${today}T00:00:00+09:00`);
  base.setUTCDate(base.getUTCDate() + offsetDays);
  return workDateFormatter.format(base);
}

function jstTime(workDate: string, time: string): string {
  return new Date(`${workDate}T${time}:00+09:00`).toISOString();
}

function resetSql(): string {
  return `
DELETE FROM login_rate_limits;
DELETE FROM sessions;
DELETE FROM audit_logs;
DELETE FROM punch_events;
DELETE FROM attendance_requests;
DELETE FROM attendance_records;
DELETE FROM work_schedules;
DELETE FROM work_sites;
DELETE FROM users;
`;
}

async function seedSql(): Promise<string> {
  const seedNow = new Date();
  const now = seedNow.toISOString();
  const today = jstWorkDate(0, seedNow);
  const yesterday = jstWorkDate(-1, seedNow);
  const todayStart = new Date(`${today}T00:00:00+09:00`);
  const maruTodayClockIn = new Date(
    Math.max(
      todayStart.getTime(),
      Math.min(seedNow.getTime(), new Date(`${today}T08:58:00+09:00`).getTime()),
    ),
  ).toISOString();
  const batsuTodayClockOutDate = new Date(
    Math.min(seedNow.getTime(), new Date(`${today}T18:05:00+09:00`).getTime()),
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
  const employeePasswordHashes = await Promise.all(
    Array.from({ length: 5 }, () => hashPassword(localEmployeePassword)),
  );
  const adminPasswordHash = await hashPassword(localAdminPassword);

  const users = [
    [
      "user-admin",
      "ADM001",
      "admin@example.test",
      "管理担当",
      "admin",
      adminPasswordHash,
      1,
      now,
      now,
    ],
    [
      "user-maru",
      "EMP001",
      "maru.employee@example.test",
      "〇〇さん",
      "employee",
      employeePasswordHashes[0],
      1,
      now,
      now,
    ],
    [
      "user-batsu",
      "EMP002",
      "batsu.employee@example.test",
      "✕✕さん",
      "employee",
      employeePasswordHashes[1],
      1,
      now,
      now,
    ],
    [
      "user-sankaku",
      "EMP003",
      "sankaku.employee@example.test",
      "△△さん",
      "employee",
      employeePasswordHashes[2],
      1,
      now,
      now,
    ],
    [
      "user-shikaku",
      "EMP004",
      "shikaku.employee@example.test",
      "□□さん",
      "employee",
      employeePasswordHashes[3],
      1,
      now,
      now,
    ],
    [
      "user-hishi",
      "EMP005",
      "hishi.employee@example.test",
      "◇◇さん",
      "employee",
      employeePasswordHashes[4],
      1,
      now,
      now,
    ],
  ] satisfies SqlValue[][];

  const schedules = [
    ["schedule-maru-today", "user-maru", "site-a", today, jstTime(today, "09:00"), jstTime(today, "18:00"), 60, null, now, now],
    ["schedule-batsu-today", "user-batsu", "site-a", today, jstTime(today, "09:00"), jstTime(today, "18:00"), 60, null, now, now],
    ["schedule-sankaku-today", "user-sankaku", "site-b", today, jstTime(today, "09:30"), jstTime(today, "18:30"), 60, null, now, now],
    ["schedule-shikaku-today", "user-shikaku", "site-b", today, jstTime(today, "09:30"), jstTime(today, "18:30"), 60, null, now, now],
    ["schedule-hishi-today", "user-hishi", "site-a", today, jstTime(today, "09:00"), jstTime(today, "18:00"), 60, null, now, now],
    ["schedule-maru-yesterday", "user-maru", "site-a", yesterday, jstTime(yesterday, "09:00"), jstTime(yesterday, "18:00"), 60, null, now, now],
  ] satisfies SqlValue[][];

  const attendanceRecords = [
    ["attendance-maru-today", "user-maru", today, "schedule-maru-today", maruTodayClockIn, null, null, "work", null, 1, "seed-maru-clock-in", now, now],
    ["attendance-batsu-today", "user-batsu", today, "schedule-batsu-today", batsuTodayClockIn, batsuTodayClockOut, batsuTodayBreakMinutes, "work", hasBatsuCompletedToday ? "予定どおり勤務" : null, 1, hasBatsuCompletedToday ? "seed-batsu-clock-out" : null, now, now],
    ["attendance-sankaku-today", "user-sankaku", today, "schedule-sankaku-today", null, null, null, "work", null, 1, null, now, now],
    ["attendance-shikaku-today", "user-shikaku", today, "schedule-shikaku-today", null, null, null, "work", null, 1, null, now, now],
    ["attendance-hishi-today", "user-hishi", today, "schedule-hishi-today", null, null, null, "sick_leave", "病欠承認済み", 2, "seed-hishi-approval", now, now],
    ["attendance-maru-yesterday", "user-maru", yesterday, "schedule-maru-yesterday", jstTime(yesterday, "09:05"), jstTime(yesterday, "18:00"), 60, "work", "本人修正済み", 2, "seed-maru-correction", now, now],
  ] satisfies SqlValue[][];

  const punchEvents = [
    ["punch-maru-today-in", "attendance-maru-today", "clock_in", maruTodayClockIn, "seed-maru-clock-in", 12.345678, 123.456789, 18, maruTodayClockIn, "granted", "user-maru", now],
    ...(hasBatsuCompletedToday && batsuTodayClockIn && batsuTodayClockOut
      ? [
          ["punch-batsu-today-in", "attendance-batsu-today", "clock_in", batsuTodayClockIn, "seed-batsu-clock-in", null, null, null, null, "denied", "user-batsu", now],
          ["punch-batsu-today-out", "attendance-batsu-today", "clock_out", batsuTodayClockOut, "seed-batsu-clock-out", null, null, null, null, "timeout", "user-batsu", now],
        ]
      : []),
    ["punch-maru-yesterday-in", "attendance-maru-yesterday", "clock_in", jstTime(yesterday, "09:12"), "seed-maru-yesterday-in", null, null, null, null, "unavailable", "user-maru", now],
    ["punch-maru-yesterday-out", "attendance-maru-yesterday", "clock_out", jstTime(yesterday, "18:00"), "seed-maru-yesterday-out", -12.345678, -123.456789, 24, jstTime(yesterday, "18:00"), "granted", "user-maru", now],
  ] satisfies SqlValue[][];

  const requests = [
    ["request-shikaku-pending", "00000000-0000-4000-8000-000000000101", "user-shikaku", today, "paid_leave", "私用のため", "pending", null, null, jstTime(today, "07:30"), null, 1, null, now, now],
    ["request-hishi-approved", "00000000-0000-4000-8000-000000000102", "user-hishi", today, "sick_leave", "体調不良のため", "approved", "user-admin", "承認しました", jstTime(today, "07:10"), jstTime(today, "07:20"), 2, "00000000-0000-4000-8000-000000000201", now, now],
    ["request-sankaku-rejected", "00000000-0000-4000-8000-000000000103", "user-sankaku", yesterday, "other", "終日不在のため", "rejected", "user-admin", "勤務予定を確認してください", jstTime(yesterday, "06:50"), jstTime(yesterday, "07:00"), 2, "00000000-0000-4000-8000-000000000202", now, now],
  ] satisfies SqlValue[][];

  const maruBefore = JSON.stringify({
    clockInAt: jstTime(yesterday, "09:12"),
    clockOutAt: jstTime(yesterday, "18:00"),
    actualBreakMinutes: 60,
  });
  const maruAfter = JSON.stringify({
    clockInAt: jstTime(yesterday, "09:05"),
    clockOutAt: jstTime(yesterday, "18:00"),
    actualBreakMinutes: 60,
  });
  const auditLogs = [
    ["audit-maru-correction", "attendance_record", "attendance-maru-yesterday", "update", maruBefore, maruAfter, "打刻時刻を見直したため", "seed-maru-correction", "user-maru", now],
    ["audit-hishi-approval", "attendance_request", "request-hishi-approved", "approve", JSON.stringify({ status: "pending" }), JSON.stringify({ status: "approved", attendanceCategory: "sick_leave" }), "承認しました", null, "user-admin", now],
    ["audit-sankaku-rejection", "attendance_request", "request-sankaku-rejected", "reject", JSON.stringify({ status: "pending" }), JSON.stringify({ status: "rejected" }), "勤務予定を確認してください", null, "user-admin", now],
  ] satisfies SqlValue[][];

  return `
INSERT INTO users (
  id, employee_code, normalized_email, display_name, role, password_hash, active, created_at, updated_at
) VALUES
  ${sqlValues(users, 9)};

INSERT INTO work_sites (id, name, active, created_at, updated_at) VALUES
  ${sqlValues([
    ["site-a", "A作業場", 1, now, now],
    ["site-b", "B現場", 1, now, now],
  ], 5)};

INSERT INTO work_schedules (
  id, user_id, site_id, work_date, scheduled_start_at, scheduled_end_at,
  scheduled_break_minutes, note, created_at, updated_at
) VALUES
  ${sqlValues(schedules, 10)};

INSERT INTO attendance_records (
  id, user_id, work_date, schedule_id, clock_in_at, clock_out_at,
  actual_break_minutes, attendance_category, note, version, last_mutation_id,
  created_at, updated_at
) VALUES
  ${sqlValues(attendanceRecords, 13)};

INSERT INTO punch_events (
  id, attendance_record_id, event_type, occurred_at, client_request_id,
  latitude, longitude, accuracy_meters, captured_at, location_state,
  actor_user_id, created_at
) VALUES
  ${sqlValues(punchEvents, 12)};

INSERT INTO attendance_requests (
  id, creation_request_id, user_id, work_date, requested_category, reason,
  status, reviewer_user_id, review_comment, requested_at, reviewed_at, version,
  decision_request_id, created_at, updated_at
) VALUES
  ${sqlValues(requests, 15)};

INSERT INTO audit_logs (
  id, entity_type, entity_id, action, before_json, after_json, reason,
  mutation_id, actor_user_id, created_at
) VALUES
  ${sqlValues(auditLogs, 10)};
`;
}

async function main(): Promise<void> {
  const command = readCommand(process.argv[2]);
  if (command === "render") {
    process.stdout.write(`${await seedSql()}\n`);
    return;
  }

  const schemaExists = localApplicationSchemaExists();
  if (command === "seed" && schemaExists && localApplicationRowCount() > 0) {
    throw new Error(
      "Local D1 already contains application data. Use `npm run db:reset:local` instead.",
    );
  }

  if (command === "reset" && schemaExists) executeSql(resetSql());
  runWrangler(["d1", "migrations", "apply", databaseBinding, "--local"]);
  executeSql(resetSql());
  executeSql(await seedSql());
}

await main();
