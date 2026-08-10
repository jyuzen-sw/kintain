import {
  buildDemoAttendanceResetStatements,
  PACKAGED_SEED_RECONCILE_MARKER,
  RUNTIME_PASSWORD_RECONCILE_MARKER,
} from "@/lib/server/demo-reset";
import {
  isPublicDemoMode,
  type DemoModeEnvironment,
} from "@/lib/server/demo-mode";
import { verifyPassword } from "@/lib/server/crypto";
import { HttpError } from "@/lib/server/http";

const DEMO_USERS = [
  {
    id: "user-admin",
    employeeCode: "ADM001",
    email: "admin@example.test",
    displayName: "管理担当",
    role: "admin",
    password: "AdminDemo!2026",
    passwordHash:
      "pbkdf2-sha256$100000$NXEMG72q6G0bOfMjylH-qA$7uC4zO03savykiC38xWH0UtrQi5UnJJCEqKkj2FHBN4",
    legacyPasswordHash:
      "pbkdf2-sha256$600000$3P12lf-ze-v5lKrJbgL6nA$ML8CtrlHWImc_w328R-3y74lusqfQgrN2aGVHtrv3is",
  },
  {
    id: "user-maru",
    employeeCode: "EMP001",
    email: "maru.employee@example.test",
    displayName: "〇〇さん",
    role: "employee",
    password: "DemoPass!2026",
    passwordHash:
      "pbkdf2-sha256$100000$zRQwvBVXHj-2JlI_j-ZQ-g$FxfL3jmd0SJ3lvegF3lIxwsW9jTYUR0JXzfmK51oUy8",
    legacyPasswordHash:
      "pbkdf2-sha256$600000$BoViD3vrL6sWQjsPDhWl0g$VAEKEKI_2d1rjwvDjXxHnxFb5OdL5-2BItQpyo55nwQ",
  },
  {
    id: "user-batsu",
    employeeCode: "EMP002",
    email: "batsu.employee@example.test",
    displayName: "✕✕さん",
    role: "employee",
    password: "DemoPass!2026",
    passwordHash:
      "pbkdf2-sha256$100000$md66uxOZ7y7eUIGAAkhvmA$avdaEtCCm4yZBi2RmZ7LPhUX50wiQ-bM9vyNw1eNtuY",
    legacyPasswordHash:
      "pbkdf2-sha256$600000$GF47yMCx8Ezn47P7rmG5LQ$5jq-aeqXA0KH3x574AvWyRRK25wuSz7IkTklLvNXtak",
  },
  {
    id: "user-sankaku",
    employeeCode: "EMP003",
    email: "sankaku.employee@example.test",
    displayName: "△△さん",
    role: "employee",
    password: "DemoPass!2026",
    passwordHash:
      "pbkdf2-sha256$100000$wMZ_FLjaB4aG49XviQeesg$CJHVTwJihnemq2DV4shKn7fKV2IBqYsVADMTEXKioPw",
    legacyPasswordHash:
      "pbkdf2-sha256$600000$zn89T1QqeQ4s7A-bMv_Y3Q$TABEQkUpOenH6hkapg64AuHpjbjoSSpdB5V-yNTiGUc",
  },
  {
    id: "user-shikaku",
    employeeCode: "EMP004",
    email: "shikaku.employee@example.test",
    displayName: "□□さん",
    role: "employee",
    password: "DemoPass!2026",
    passwordHash:
      "pbkdf2-sha256$100000$KETut7GnsFMJqpzLnafeag$qlzeT4YZ5UfrB-i1TTXQcI7m0JUA_UpCQegJpNiVm-U",
    legacyPasswordHash:
      "pbkdf2-sha256$600000$fzxmTk9kTrVu8jN9YAe-sQ$9aDpduLa19f7seyzD77DzScklj5mmQZDvZCUYj8RzLs",
  },
  {
    id: "user-hishi",
    employeeCode: "EMP005",
    email: "hishi.employee@example.test",
    displayName: "◇◇さん",
    role: "employee",
    password: "DemoPass!2026",
    passwordHash:
      "pbkdf2-sha256$100000$cMMaZIL2WNHS1_GkZ-Eg3A$GfJK63_Ucwbxddtnf-Xee35wA9ShUoP2Bi0OxFX6vEs",
    legacyPasswordHash:
      "pbkdf2-sha256$600000$_S7FvmdfMthGrKsl_93tHw$pi0Mhj05NvyEU4RrDL9z5Sb3nzxDFvxeaFogr5jj7io",
  },
] as const;

const DEMO_SITES = [
  { id: "site-a", name: "A作業場" },
  { id: "site-b", name: "B現場" },
] as const;

const PACKAGED_SEED_CREATED_AT = "2026-08-10T03:38:33.222Z";

function markerStatement(
  database: D1Database,
  marker: string,
  updatedAt: string,
): D1PreparedStatement {
  return database
    .prepare(
      `INSERT INTO login_rate_limits
         (scope_type, scope_key_hash, window_started_at, failure_count,
          blocked_until, updated_at)
       VALUES ('account', ?, ?, 0, NULL, ?)`,
    )
    .bind(marker, updatedAt, updatedAt);
}

async function markerExists(database: D1Database, marker: string): Promise<boolean> {
  const result = await database
    .prepare(
      `SELECT COUNT(*) AS count
         FROM login_rate_limits
        WHERE scope_type = 'account' AND scope_key_hash = ?`,
    )
    .bind(marker)
    .first<{ count: number }>();
  return Number(result?.count ?? 0) === 1;
}

async function assertDemoPasswordHashUsable(): Promise<void> {
  const selfCheckUser = DEMO_USERS[0];
  if (!(await verifyPassword(selfCheckUser.password, selfCheckUser.passwordHash))) {
    throw new HttpError(
      503,
      "DEMO_PASSWORD_BOOTSTRAP_FAILED",
      "デモ認証情報を初期化できませんでした。",
    );
  }
}

async function publicDemoBootstrapCompleted(
  database: D1Database,
): Promise<boolean> {
  const state = await database
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM users) AS users,
         (SELECT COUNT(*) FROM users
           WHERE id IN ('user-admin', 'user-maru', 'user-batsu',
                        'user-sankaku', 'user-shikaku', 'user-hishi'))
           AS known_users,
         (SELECT COUNT(*) FROM work_sites) AS sites,
         (SELECT COUNT(*) FROM work_sites WHERE id IN ('site-a', 'site-b'))
           AS known_sites,
         (SELECT COUNT(*) FROM work_schedules) AS schedules,
         (SELECT COUNT(*) FROM attendance_records) AS records,
         (SELECT COUNT(*) FROM attendance_requests) AS requests,
         (SELECT COUNT(*) FROM audit_logs) AS audits`,
    )
    .first<{
      users: number;
      known_users: number;
      sites: number;
      known_sites: number;
      schedules: number;
      records: number;
      requests: number;
      audits: number;
    }>();
  return (
    Number(state?.users ?? 0) === DEMO_USERS.length &&
    Number(state?.known_users ?? 0) === DEMO_USERS.length &&
    Number(state?.sites ?? 0) === DEMO_SITES.length &&
    Number(state?.known_sites ?? 0) === DEMO_SITES.length &&
    Number(state?.schedules ?? 0) === 6 &&
    Number(state?.records ?? 0) === 6 &&
    Number(state?.requests ?? 0) === 3 &&
    Number(state?.audits ?? 0) === 4
  );
}

async function packagedDemoSeedDetected(database: D1Database): Promise<boolean> {
  const state = await database
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM users) AS users,
         (SELECT COUNT(*) FROM users
           WHERE id IN ('user-admin', 'user-maru', 'user-batsu',
                        'user-sankaku', 'user-shikaku', 'user-hishi'))
           AS known_users,
         (SELECT COUNT(*) FROM users
           WHERE created_at = ? AND updated_at = ?) AS seed_users,
         (SELECT COUNT(*) FROM work_sites) AS sites,
         (SELECT COUNT(*) FROM work_sites WHERE id IN ('site-a', 'site-b'))
           AS known_sites,
         (SELECT COUNT(*) FROM work_sites
           WHERE created_at = ? AND updated_at = ?) AS seed_sites,
         (SELECT COUNT(*) FROM work_schedules) AS schedules,
         (SELECT COUNT(*) FROM work_schedules
           WHERE id IN ('schedule-maru-today', 'schedule-batsu-today',
                        'schedule-sankaku-today', 'schedule-shikaku-today',
                        'schedule-hishi-today', 'schedule-maru-yesterday'))
           AS known_schedules,
         (SELECT COUNT(*) FROM work_schedules
           WHERE created_at = ? AND updated_at = ?) AS seed_schedules,
         (SELECT COUNT(*) FROM attendance_records) AS records,
         (SELECT COUNT(*) FROM attendance_records
           WHERE id IN ('attendance-maru-today', 'attendance-batsu-today',
                        'attendance-sankaku-today', 'attendance-shikaku-today',
                        'attendance-hishi-today', 'attendance-maru-yesterday'))
           AS known_records,
         (SELECT COUNT(*) FROM attendance_records
           WHERE created_at = ? AND updated_at = ?) AS seed_records,
         (SELECT COUNT(*) FROM punch_events) AS punches,
         (SELECT COUNT(*) FROM punch_events
           WHERE id IN ('punch-maru-today-in', 'punch-batsu-today-in',
                        'punch-batsu-today-out', 'punch-maru-yesterday-in',
                        'punch-maru-yesterday-out')) AS known_punches,
         (SELECT COUNT(*) FROM punch_events WHERE created_at = ?)
           AS seed_punches,
         (SELECT COUNT(*) FROM attendance_requests) AS requests,
         (SELECT COUNT(*) FROM attendance_requests
           WHERE id IN ('request-shikaku-pending', 'request-hishi-approved',
                        'request-sankaku-rejected')) AS known_requests,
         (SELECT COUNT(*) FROM attendance_requests
           WHERE created_at = ? AND updated_at = ?) AS seed_requests,
         (SELECT COUNT(*) FROM audit_logs) AS audits,
         (SELECT COUNT(*) FROM audit_logs
           WHERE id IN ('audit-maru-correction', 'audit-hishi-approval',
                        'audit-sankaku-rejection')) AS known_audits,
         (SELECT COUNT(*) FROM audit_logs WHERE created_at = ?) AS seed_audits,
         (SELECT COUNT(*) FROM sessions) AS sessions`,
    )
    .bind(
      PACKAGED_SEED_CREATED_AT,
      PACKAGED_SEED_CREATED_AT,
      PACKAGED_SEED_CREATED_AT,
      PACKAGED_SEED_CREATED_AT,
      PACKAGED_SEED_CREATED_AT,
      PACKAGED_SEED_CREATED_AT,
      PACKAGED_SEED_CREATED_AT,
      PACKAGED_SEED_CREATED_AT,
      PACKAGED_SEED_CREATED_AT,
      PACKAGED_SEED_CREATED_AT,
      PACKAGED_SEED_CREATED_AT,
      PACKAGED_SEED_CREATED_AT,
    )
    .first<Record<string, number>>();
  const count = (name: string): number => Number(state?.[name] ?? 0);
  return (
    count("users") === 6 &&
    count("known_users") === 6 &&
    count("seed_users") === 6 &&
    count("sites") === 2 &&
    count("known_sites") === 2 &&
    count("seed_sites") === 2 &&
    count("schedules") === 6 &&
    count("known_schedules") === 6 &&
    count("seed_schedules") === 6 &&
    count("records") === 6 &&
    count("known_records") === 6 &&
    count("seed_records") === 6 &&
    count("punches") === 5 &&
    count("known_punches") === 5 &&
    count("seed_punches") === 5 &&
    count("requests") === 3 &&
    count("known_requests") === 3 &&
    count("seed_requests") === 3 &&
    count("audits") === 3 &&
    count("known_audits") === 3 &&
    count("seed_audits") === 3 &&
    count("sessions") === 0
  );
}

async function packagedSeedReconcileCompleted(
  database: D1Database,
): Promise<boolean> {
  return (
    (await markerExists(database, PACKAGED_SEED_RECONCILE_MARKER)) &&
    (await publicDemoBootstrapCompleted(database))
  );
}

async function runtimePasswordReconcileEligible(
  database: D1Database,
): Promise<boolean> {
  if (!(await publicDemoBootstrapCompleted(database))) return false;
  const state = await database
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM sessions) AS sessions,
         (SELECT COUNT(*) FROM audit_logs
           WHERE entity_type = 'demo_dataset'
             AND json_extract(after_json, '$.source') IN
                 ('empty_d1_bootstrap', 'packaged_seed_reconcile'))
           AS known_initializations`,
    )
    .first<{ sessions: number; known_initializations: number }>();
  if (
    Number(state?.sessions ?? 0) === 0 &&
    Number(state?.known_initializations ?? 0) === 1
  ) {
    const expectedRows = DEMO_USERS.map(() => "(?, ?, ?, ?, ?, ?)").join(", ");
    const bindings = DEMO_USERS.flatMap((user) => [
      user.id,
      user.employeeCode,
      user.email,
      user.displayName,
      user.role,
      user.legacyPasswordHash,
    ]);
    const directory = await database
      .prepare(
        `WITH expected(
           id, employee_code, normalized_email, display_name, role,
           password_hash
         ) AS (VALUES ${expectedRows})
         SELECT COUNT(*) AS count
           FROM users u
           JOIN expected e
             ON u.id = e.id
            AND u.employee_code = e.employee_code
            AND u.normalized_email = e.normalized_email
            AND u.display_name = e.display_name
            AND u.role = e.role
            AND u.password_hash = e.password_hash
          WHERE u.active = 1`,
      )
      .bind(...bindings)
      .first<{ count: number }>();
    return Number(directory?.count ?? 0) === DEMO_USERS.length;
  }
  return false;
}

async function reconcileRuntimePasswords(
  database: D1Database,
  now: Date,
): Promise<boolean> {
  if (await markerExists(database, RUNTIME_PASSWORD_RECONCILE_MARKER)) {
    return false;
  }
  if (!(await runtimePasswordReconcileEligible(database))) return false;

  const updatedAt = now.toISOString();
  await assertDemoPasswordHashUsable();
  try {
    await database.batch([
      markerStatement(database, RUNTIME_PASSWORD_RECONCILE_MARKER, updatedAt),
      ...DEMO_USERS.map((user) =>
        database
          .prepare(
            `UPDATE users
                SET employee_code = ?, normalized_email = ?, display_name = ?,
                    role = ?, password_hash = ?, active = 1, updated_at = ?
              WHERE id = ?`,
          )
          .bind(
            user.employeeCode,
            user.email,
            user.displayName,
            user.role,
            user.passwordHash,
            updatedAt,
            user.id,
          ),
      ),
    ]);
  } catch (error) {
    if (await markerExists(database, RUNTIME_PASSWORD_RECONCILE_MARKER)) {
      return false;
    }
    throw error;
  }
  return true;
}

async function reconcilePackagedDemoSeed(
  database: D1Database,
  now: Date,
): Promise<boolean> {
  if (!(await packagedDemoSeedDetected(database))) return false;

  const updatedAt = now.toISOString();
  await assertDemoPasswordHashUsable();
  const directoryUpdates: D1PreparedStatement[] = DEMO_USERS.map((user) =>
    database
      .prepare(
        `UPDATE users
            SET employee_code = ?, normalized_email = ?, display_name = ?,
                role = ?, password_hash = ?, active = 1, updated_at = ?
          WHERE id = ?`,
      )
      .bind(
        user.employeeCode,
        user.email,
        user.displayName,
        user.role,
        user.passwordHash,
        updatedAt,
        user.id,
      ),
  );
  directoryUpdates.push(
    ...DEMO_SITES.map((site) =>
      database
        .prepare(
          `UPDATE work_sites
              SET name = ?, active = 1, updated_at = ?
            WHERE id = ?`,
        )
        .bind(site.name, updatedAt, site.id),
    ),
  );

  try {
    await database.batch([
      markerStatement(database, PACKAGED_SEED_RECONCILE_MARKER, updatedAt),
      ...directoryUpdates,
      ...buildDemoAttendanceResetStatements({
        database,
        actorUserId: "user-admin",
        now,
        source: "packaged_seed_reconcile",
      }),
      markerStatement(database, RUNTIME_PASSWORD_RECONCILE_MARKER, updatedAt),
    ]);
  } catch (error) {
    if (await packagedSeedReconcileCompleted(database)) return false;
    throw error;
  }
  return true;
}

export async function ensurePublicDemoBootstrap(input: {
  database: D1Database;
  environment: DemoModeEnvironment;
  now?: Date;
}): Promise<boolean> {
  if (!isPublicDemoMode(input.environment)) return false;

  const now = input.now ?? new Date();

  const existing = await input.database
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM users) AS users,
         (SELECT COUNT(*) FROM users) +
         (SELECT COUNT(*) FROM work_sites) +
         (SELECT COUNT(*) FROM work_schedules) +
         (SELECT COUNT(*) FROM attendance_records) +
         (SELECT COUNT(*) FROM punch_events) +
         (SELECT COUNT(*) FROM attendance_requests) +
         (SELECT COUNT(*) FROM audit_logs) +
         (SELECT COUNT(*) FROM sessions) AS application_rows`,
    )
    .first<{ users: number; application_rows: number }>();
  const users = Number(existing?.users ?? 0);
  if (users > 0) {
    if (await markerExists(input.database, RUNTIME_PASSWORD_RECONCILE_MARKER)) {
      return false;
    }
    if (await reconcilePackagedDemoSeed(input.database, now)) return true;
    return reconcileRuntimePasswords(input.database, now);
  }
  if (Number(existing?.application_rows ?? 0) > 0) {
    throw new HttpError(
      503,
      "DEMO_BOOTSTRAP_UNSAFE",
      "デモデータの初期状態を確認できませんでした。",
    );
  }

  const createdAt = now.toISOString();
  await assertDemoPasswordHashUsable();
  const directoryStatements: D1PreparedStatement[] = DEMO_USERS.map((user) =>
    input.database
      .prepare(
        `INSERT INTO users
           (id, employee_code, normalized_email, display_name, role,
            password_hash, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .bind(
        user.id,
        user.employeeCode,
        user.email,
        user.displayName,
        user.role,
        user.passwordHash,
        createdAt,
        createdAt,
      ),
  );
  directoryStatements.push(
    ...DEMO_SITES.map((site) =>
      input.database
        .prepare(
          `INSERT INTO work_sites
             (id, name, active, created_at, updated_at)
           VALUES (?, ?, 1, ?, ?)`,
        )
        .bind(site.id, site.name, createdAt, createdAt),
    ),
  );

  try {
    await input.database.batch([
      ...directoryStatements,
      ...buildDemoAttendanceResetStatements({
        database: input.database,
        actorUserId: "user-admin",
        now,
        source: "empty_d1_bootstrap",
      }),
      markerStatement(
        input.database,
        RUNTIME_PASSWORD_RECONCILE_MARKER,
        createdAt,
      ),
    ]);
  } catch (error) {
    if (await publicDemoBootstrapCompleted(input.database)) return false;
    throw error;
  }
  return true;
}
