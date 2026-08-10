import { buildDemoAttendanceResetStatements } from "@/lib/server/demo-reset";
import {
  isPublicDemoMode,
  type DemoModeEnvironment,
} from "@/lib/server/demo-mode";
import { HttpError } from "@/lib/server/http";

const DEMO_USERS = [
  {
    id: "user-admin",
    employeeCode: "ADM001",
    email: "admin@example.test",
    displayName: "管理担当",
    role: "admin",
    passwordHash:
      "pbkdf2-sha256$600000$3P12lf-ze-v5lKrJbgL6nA$ML8CtrlHWImc_w328R-3y74lusqfQgrN2aGVHtrv3is",
  },
  {
    id: "user-maru",
    employeeCode: "EMP001",
    email: "maru.employee@example.test",
    displayName: "〇〇さん",
    role: "employee",
    passwordHash:
      "pbkdf2-sha256$600000$BoViD3vrL6sWQjsPDhWl0g$VAEKEKI_2d1rjwvDjXxHnxFb5OdL5-2BItQpyo55nwQ",
  },
  {
    id: "user-batsu",
    employeeCode: "EMP002",
    email: "batsu.employee@example.test",
    displayName: "✕✕さん",
    role: "employee",
    passwordHash:
      "pbkdf2-sha256$600000$GF47yMCx8Ezn47P7rmG5LQ$5jq-aeqXA0KH3x574AvWyRRK25wuSz7IkTklLvNXtak",
  },
  {
    id: "user-sankaku",
    employeeCode: "EMP003",
    email: "sankaku.employee@example.test",
    displayName: "△△さん",
    role: "employee",
    passwordHash:
      "pbkdf2-sha256$600000$zn89T1QqeQ4s7A-bMv_Y3Q$TABEQkUpOenH6hkapg64AuHpjbjoSSpdB5V-yNTiGUc",
  },
  {
    id: "user-shikaku",
    employeeCode: "EMP004",
    email: "shikaku.employee@example.test",
    displayName: "□□さん",
    role: "employee",
    passwordHash:
      "pbkdf2-sha256$600000$fzxmTk9kTrVu8jN9YAe-sQ$9aDpduLa19f7seyzD77DzScklj5mmQZDvZCUYj8RzLs",
  },
  {
    id: "user-hishi",
    employeeCode: "EMP005",
    email: "hishi.employee@example.test",
    displayName: "◇◇さん",
    role: "employee",
    passwordHash:
      "pbkdf2-sha256$600000$_S7FvmdfMthGrKsl_93tHw$pi0Mhj05NvyEU4RrDL9z5Sb3nzxDFvxeaFogr5jj7io",
  },
] as const;

const DEMO_SITES = [
  { id: "site-a", name: "A作業場" },
  { id: "site-b", name: "B現場" },
] as const;

export async function ensurePublicDemoBootstrap(input: {
  database: D1Database;
  environment: DemoModeEnvironment;
  now?: Date;
}): Promise<boolean> {
  if (!isPublicDemoMode(input.environment)) return false;

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
  if (users > 0) return false;
  if (Number(existing?.application_rows ?? 0) > 0) {
    throw new HttpError(
      503,
      "DEMO_BOOTSTRAP_UNSAFE",
      "デモデータの初期状態を確認できませんでした。",
    );
  }

  const now = input.now ?? new Date();
  const createdAt = now.toISOString();
  const directoryStatements: D1PreparedStatement[] = DEMO_USERS.map((user) =>
    input.database
      .prepare(
        `INSERT OR IGNORE INTO users
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
          `INSERT OR IGNORE INTO work_sites
             (id, name, active, created_at, updated_at)
           VALUES (?, ?, 1, ?, ?)`,
        )
        .bind(site.id, site.name, createdAt, createdAt),
    ),
  );

  await input.database.batch([
    ...directoryStatements,
    ...buildDemoAttendanceResetStatements({
      database: input.database,
      actorUserId: "user-admin",
      now,
      source: "empty_d1_bootstrap",
    }),
  ]);
  return true;
}
