/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET as getAdminToday } from "@/app/api/admin/today/route";
import { GET as getAdminAudit } from "@/app/api/admin/audit/route";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as getAttendanceAudit } from "@/app/api/me/attendance/[recordId]/audit/route";
import { POST as punchRoute } from "@/app/api/me/punch/route";
import { POST as withdrawRequest } from "@/app/api/me/requests/[requestId]/withdraw/route";
import { POST as createRequest } from "@/app/api/me/requests/route";
import type { SessionUser } from "@/lib/contracts/types";
import { AttendanceService } from "@/lib/server/attendance-service";
import { hashPassword, sha256Base64Url } from "@/lib/server/crypto";
import { resetDemoAttendanceData } from "@/lib/server/demo-reset";
import { HttpError } from "@/lib/server/http";

interface IntegrationEnv extends Env {
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
}

const testEnv = env as IntegrationEnv;
const fixedNow = new Date("2026-08-10T00:00:00.000Z");
const employee: SessionUser = {
  id: "user-employee",
  employeeCode: "EMP001",
  displayName: "テスト従業員",
  email: "employee@example.test",
  role: "employee",
};
const admin: SessionUser = {
  id: "user-admin",
  employeeCode: "ADM001",
  displayName: "テスト管理者",
  email: "admin@example.test",
  role: "admin",
};
const otherEmployee: SessionUser = {
  id: "user-other",
  employeeCode: "EMP002",
  displayName: "別の従業員",
  email: "other@example.test",
  role: "employee",
};

async function seedDirectory(): Promise<void> {
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO users
         (id, employee_code, normalized_email, display_name, role, password_hash, active)
       VALUES (?, ?, ?, ?, 'employee', 'unused', 1)`,
    ).bind(employee.id, employee.employeeCode, employee.email, employee.displayName),
    testEnv.DB.prepare(
      `INSERT INTO users
         (id, employee_code, normalized_email, display_name, role, password_hash, active)
       VALUES (?, ?, ?, ?, 'admin', 'unused', 1)`,
    ).bind(admin.id, admin.employeeCode, admin.email, admin.displayName),
    testEnv.DB.prepare(
      "INSERT INTO work_sites (id, name, active) VALUES ('site-a', 'A作業場', 1)",
    ),
  ]);
}

async function seedSchedule(): Promise<void> {
  await testEnv.DB.prepare(
    `INSERT INTO work_schedules
       (id, user_id, site_id, work_date, scheduled_start_at, scheduled_end_at,
        scheduled_break_minutes)
     VALUES ('schedule-today', ?, 'site-a', '2026-08-10',
             '2026-08-10T00:00:00.000Z', '2026-08-10T09:00:00.000Z', NULL)`,
  )
    .bind(employee.id)
    .run();
}

async function seedSession(
  user: SessionUser,
  token: string,
  csrfToken = "test-csrf-token",
): Promise<void> {
  const now = fixedNow.toISOString();
  await testEnv.DB.prepare(
    `INSERT INTO sessions
       (id, user_id, token_hash, csrf_token_hash, expires_at, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, '2026-08-11T00:00:00.000Z', ?, ?)`,
  )
    .bind(
      `session-${user.id}`,
      user.id,
      await sha256Base64Url(token),
      await sha256Base64Url(csrfToken),
      now,
      now,
    )
    .run();
}

describe("D1を使う勤怠フロー", () => {
  beforeEach(async () => {
    await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
    await testEnv.DB.batch([
      testEnv.DB.prepare("DELETE FROM login_rate_limits"),
      testEnv.DB.prepare("DELETE FROM sessions"),
      testEnv.DB.prepare("DELETE FROM audit_logs"),
      testEnv.DB.prepare("DELETE FROM punch_events"),
      testEnv.DB.prepare("DELETE FROM attendance_requests"),
      testEnv.DB.prepare("DELETE FROM attendance_records"),
      testEnv.DB.prepare("DELETE FROM work_schedules"),
      testEnv.DB.prepare("DELETE FROM work_sites"),
      testEnv.DB.prepare("DELETE FROM users"),
    ]);
    await seedDirectory();
  });

  it("初回打刻を保存し、退勤時は予定休憩未設定を60分として同じ要求を重複登録しない", async () => {
    await seedSchedule();
    let serverNow = fixedNow;
    const service = new AttendanceService(testEnv.DB, () => serverNow);

    const started = await service.punch({
      user: employee,
      type: "clock_in",
      clientRequestId: "af2f16c2-50e6-4b99-ae29-c401276044bb",
      location: {
        state: "denied",
        latitude: null,
        longitude: null,
        accuracyMeters: null,
        capturedAt: null,
      },
    });
    expect(started.state).toBe("working");
    expect(started.record?.version).toBe(1);

    serverNow = new Date("2026-08-10T09:05:00.000Z");
    const completed = await service.punch({
      user: employee,
      type: "clock_out",
      clientRequestId: "f259f987-bb52-4557-8af4-5f72863eccef",
      location: {
        state: "timeout",
        latitude: null,
        longitude: null,
        accuracyMeters: null,
        capturedAt: null,
      },
    });
    expect(completed.state).toBe("completed");
    expect(completed.record?.actualBreakMinutes).toBe(60);

    await service.punch({
      user: employee,
      type: "clock_out",
      clientRequestId: "f259f987-bb52-4557-8af4-5f72863eccef",
      location: {
        state: "timeout",
        latitude: null,
        longitude: null,
        accuracyMeters: null,
        capturedAt: null,
      },
    });
    const count = await testEnv.DB.prepare(
      "SELECT count(*) AS count FROM punch_events",
    ).first<{ count: number }>();
    expect(count?.count).toBe(2);
  });

  it("打刻の再送キーを別勤務日や異なる位置payloadへ流用すると拒否する", async () => {
    await seedSchedule();
    await testEnv.DB.prepare(
      `INSERT INTO work_schedules
         (id, user_id, site_id, work_date, scheduled_start_at,
          scheduled_end_at, scheduled_break_minutes)
       VALUES ('schedule-next-day', ?, 'site-a', '2026-08-11',
               '2026-08-11T00:00:00.000Z', '2026-08-11T09:00:00.000Z', 60)`,
    )
      .bind(employee.id)
      .run();
    let serverNow = fixedNow;
    const service = new AttendanceService(testEnv.DB, () => serverNow);
    const clientRequestId = "672a18df-475a-4502-a37f-b9127b116522";
    const location = {
      state: "denied" as const,
      latitude: null,
      longitude: null,
      accuracyMeters: null,
      capturedAt: null,
    };
    await service.punch({
      user: employee,
      type: "clock_in",
      clientRequestId,
      location,
    });

    await expect(
      service.punch({
        user: employee,
        type: "clock_in",
        clientRequestId,
        location: { ...location, state: "unavailable" },
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "IDEMPOTENCY_KEY_REUSED",
    });

    serverNow = new Date("2026-08-11T00:00:00.000Z");
    await expect(
      service.punch({
        user: employee,
        type: "clock_in",
        clientRequestId,
        location,
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "IDEMPOTENCY_KEY_REUSED",
    });
    const nextDayEvents = await testEnv.DB.prepare(
      `SELECT count(*) AS count
         FROM punch_events pe
         JOIN attendance_records ar ON ar.id = pe.attendance_record_id
        WHERE ar.work_date = '2026-08-11'`,
    ).first<{ count: number }>();
    expect(nextDayEvents?.count).toBe(0);
  });

  it("公開デモでは直接送信された位置座標も保存しない", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
    await seedSchedule();
    await seedSession(employee, "employee-token", "employee-csrf");
    try {
      const response = await punchRoute(
        new Request("http://local.test/api/me/punch", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: "kintain_session=employee-token",
            origin: "http://local.test",
            "sec-fetch-site": "same-origin",
            "x-csrf-token": "employee-csrf",
          },
          body: JSON.stringify({
            type: "clock_in",
            clientRequestId: "8fbeb685-6194-45dc-a5ad-ecfbc27f6f55",
            location: {
              state: "granted",
              latitude: 12.345678,
              longitude: 123.456789,
              accuracyMeters: 10,
              capturedAt: "2026-08-10T00:00:00.000Z",
            },
          }),
        }),
      );
      expect(response.status).toBe(200);

      const stored = await testEnv.DB.prepare(
        `SELECT location_state, latitude, longitude, accuracy_meters, captured_at
           FROM punch_events
          WHERE client_request_id = '8fbeb685-6194-45dc-a5ad-ecfbc27f6f55'`,
      ).first<{
        location_state: string;
        latitude: number | null;
        longitude: number | null;
        accuracy_meters: number | null;
        captured_at: string | null;
      }>();
      expect(stored).toEqual({
        location_state: "unavailable",
        latitude: null,
        longitude: null,
        accuracy_meters: null,
        captured_at: null,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("打刻済みの日の休暇申請は承認せず、勤怠実績を上書きしない", async () => {
    await seedSchedule();
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT INTO attendance_records
           (id, user_id, work_date, schedule_id, clock_in_at, attendance_category, version)
         VALUES ('record-today', ?, '2026-08-10', 'schedule-today',
                 '2026-08-10T00:01:00.000Z', 'work', 1)`,
      ).bind(employee.id),
      testEnv.DB.prepare(
        `INSERT INTO attendance_requests
           (id, creation_request_id, user_id, work_date, requested_category,
            reason, status, requested_at, version)
         VALUES ('request-today', '1a6f9763-d5f5-46e5-87d3-ed4adfc67676', ?,
                 '2026-08-10', 'paid_leave', '私用', 'pending',
                 '2026-08-09T22:00:00.000Z', 1)`,
      ).bind(employee.id),
    ]);

    const service = new AttendanceService(testEnv.DB, () => fixedNow);
    await expect(
      service.reviewRequest({
        actor: admin,
        requestId: "request-today",
        expectedVersion: 1,
        decision: "approve",
        reviewComment: null,
        clientRequestId: "28e758c3-4bed-467e-9b21-33d1ee33b925",
      }),
    ).rejects.toMatchObject({ status: 409 });
    const record = await testEnv.DB.prepare(
      "SELECT attendance_category FROM attendance_records WHERE id = 'record-today'",
    ).first<{ attendance_category: string }>();
    expect(record?.attendance_category).toBe("work");
  });

  it("管理者修正を監査記録に残し、古いversionの再更新を拒否する", async () => {
    await seedSchedule();
    await testEnv.DB.prepare(
      `INSERT INTO attendance_records
         (id, user_id, work_date, schedule_id, clock_in_at, clock_out_at,
          actual_break_minutes, attendance_category, version)
       VALUES ('record-today', ?, '2026-08-10', 'schedule-today',
               '2026-08-10T00:00:00.000Z', '2026-08-10T09:00:00.000Z',
               60, 'work', 1)`,
    )
      .bind(employee.id)
      .run();
    await testEnv.DB.prepare(
      `INSERT INTO punch_events
         (id, attendance_record_id, event_type, occurred_at, client_request_id,
          latitude, longitude, accuracy_meters, captured_at, location_state,
          actor_user_id)
       VALUES ('original-punch', 'record-today', 'clock_in',
               '2026-08-10T00:00:00.000Z', 'original-punch-request',
               12.345678, 123.456789, 12,
               '2026-08-10T00:00:00.000Z', 'granted', ?)`,
    )
      .bind(employee.id)
      .run();
    const service = new AttendanceService(testEnv.DB, () => fixedNow);
    const updated = await service.updateRecord({
      actor: admin,
      recordId: "record-today",
      expectedVersion: 1,
      clockInAt: "2026-08-10T00:05:00.000Z",
      clockOutAt: "2026-08-10T09:00:00.000Z",
      actualBreakMinutes: 60,
      attendanceCategory: "work",
      note: "管理者確認済み",
      reason: "打刻申告を確認したため",
      mutationId: "a914d18c-e54a-47bf-84bd-309f8d554b31",
    });
    expect(updated.version).toBe(2);
    const audit = await testEnv.DB.prepare(
      `SELECT reason, before_json, after_json FROM audit_logs
        WHERE entity_id = 'record-today'`,
    ).first<{ reason: string; before_json: string; after_json: string }>();
    expect(audit?.reason).toBe("打刻申告を確認したため");
    const beforeAudit = JSON.parse(audit?.before_json ?? "{}") as Record<
      string,
      unknown
    >;
    const afterAudit = JSON.parse(audit?.after_json ?? "{}") as Record<
      string,
      unknown
    >;
    expect(beforeAudit).not.toHaveProperty("locations");
    expect(beforeAudit).not.toHaveProperty("hasAuditHistory");
    expect(afterAudit).not.toHaveProperty("locations");
    expect(afterAudit).not.toHaveProperty("hasAuditHistory");
    expect(`${audit?.before_json}${audit?.after_json}`).not.toContain(
      "12.345678",
    );
    const originalPunch = await testEnv.DB.prepare(
      "SELECT occurred_at FROM punch_events WHERE id = 'original-punch'",
    ).first<{ occurred_at: string }>();
    expect(originalPunch?.occurred_at).toBe("2026-08-10T00:00:00.000Z");

    await expect(
      service.updateRecord({
        actor: admin,
        recordId: "record-today",
        expectedVersion: 1,
        clockInAt: "2026-08-10T00:10:00.000Z",
        clockOutAt: "2026-08-10T09:00:00.000Z",
        actualBreakMinutes: 60,
        attendanceCategory: "work",
        note: null,
        reason: "再修正",
        mutationId: "162611e7-0d8f-4e29-8b8f-8d247f6a5ce6",
      }),
    ).rejects.toBeInstanceOf(HttpError);
  });

  it("勤怠修正の同じ要求を並行再送しても一度だけ更新し、キー流用と古いversionの監査記録を拒否する", async () => {
    await seedSchedule();
    await testEnv.DB.prepare(
      `INSERT INTO attendance_records
         (id, user_id, work_date, schedule_id, clock_in_at, clock_out_at,
          actual_break_minutes, attendance_category, version)
       VALUES ('record-idempotent', ?, '2026-08-10', 'schedule-today',
               '2026-08-10T00:00:00.000Z', '2026-08-10T09:00:00.000Z',
               60, 'work', 1)`,
    )
      .bind(employee.id)
      .run();
    const service = new AttendanceService(testEnv.DB, () => fixedNow);
    const mutationId = "342a3856-df23-4e58-b830-584aa630bc99";
    const update = () =>
      service.updateRecord({
        actor: admin,
        recordId: "record-idempotent",
        expectedVersion: 1,
        clockInAt: "2026-08-10T00:05:00.000Z",
        clockOutAt: "2026-08-10T09:00:00.000Z",
        actualBreakMinutes: 60,
        attendanceCategory: "work",
        note: "確認済み",
        reason: "申告内容を確認したため",
        mutationId,
      });

    const concurrent = await Promise.allSettled([update(), update()]);
    const fulfilled = concurrent.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    expect(fulfilled).toHaveLength(2);
    expect(fulfilled.map((record) => record.version)).toEqual([2, 2]);

    await expect(
      service.updateRecord({
        actor: admin,
        recordId: "record-idempotent",
        expectedVersion: 1,
        clockInAt: "2026-08-10T00:10:00.000Z",
        clockOutAt: "2026-08-10T09:00:00.000Z",
        actualBreakMinutes: 60,
        attendanceCategory: "work",
        note: "別内容",
        reason: "別の更新へ流用",
        mutationId,
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "IDEMPOTENCY_KEY_REUSED",
    });

    const staleMutationId = "35db260c-e04b-4b81-94f7-4d8079c92256";
    await expect(
      service.updateRecord({
        actor: admin,
        recordId: "record-idempotent",
        expectedVersion: 1,
        clockInAt: "2026-08-10T00:15:00.000Z",
        clockOutAt: "2026-08-10T09:00:00.000Z",
        actualBreakMinutes: 60,
        attendanceCategory: "work",
        note: "古い版からの更新",
        reason: "競合確認",
        mutationId: staleMutationId,
      }),
    ).rejects.toMatchObject({ status: 409, code: "VERSION_CONFLICT" });

    const persisted = await testEnv.DB.prepare(
      `SELECT version, clock_in_at FROM attendance_records
        WHERE id = 'record-idempotent'`,
    ).first<{ version: number; clock_in_at: string }>();
    expect(persisted).toEqual({
      version: 2,
      clock_in_at: "2026-08-10T00:05:00.000Z",
    });
    const audits = await testEnv.DB.prepare(
      `SELECT mutation_id FROM audit_logs
        WHERE entity_id = 'record-idempotent' ORDER BY created_at`,
    ).all<{ mutation_id: string }>();
    expect(audits.results).toEqual([{ mutation_id: mutationId }]);
  });

  it("管理者APIは未認証と従業員を拒否し、管理者だけに当日一覧を返す", async () => {
    await seedSchedule();
    await Promise.all([
      seedSession(employee, "employee-token"),
      seedSession(admin, "admin-token"),
    ]);

    const unauthenticated = await getAdminToday(
      new Request("http://local.test/api/admin/today?date=2026-08-10"),
    );
    expect(unauthenticated.status).toBe(401);

    const forbidden = await getAdminToday(
      new Request("http://local.test/api/admin/today?date=2026-08-10", {
        headers: { cookie: "kintain_session=employee-token" },
      }),
    );
    expect(forbidden.status).toBe(403);

    const allowed = await getAdminToday(
      new Request("http://local.test/api/admin/today?date=2026-08-10", {
        headers: { cookie: "kintain_session=admin-token" },
      }),
    );
    expect(allowed.status).toBe(200);
    const body = (await allowed.json()) as {
      data: {
        serverNow: string;
        rows: Array<{ user: { id: string }; overdue: boolean }>;
      };
    };
    expect(body.data.rows.map((row) => row.user.id)).toContain(employee.id);
    expect(body.data.serverNow).toMatch(/Z$/u);
    expect(typeof body.data.rows[0]?.overdue).toBe("boolean");

    const repository = new AttendanceService(testEnv.DB).repositoryForAdmin;
    const atScheduledStart = await repository.listDailyAttendance(
      "2026-08-10",
      undefined,
      "2026-08-10T00:00:00.000Z",
    );
    const afterScheduledStart = await repository.listDailyAttendance(
      "2026-08-10",
      undefined,
      "2026-08-10T00:00:00.001Z",
    );
    expect(
      atScheduledStart.find((row) => row.user.id === employee.id)?.overdue,
    ).toBe(false);
    expect(
      afterScheduledStart.find((row) => row.user.id === employee.id)?.overdue,
    ).toBe(true);
  });

  it("本人の実績修正履歴だけを返し、管理者のrecord絞り込みをLIMITより先に適用する", async () => {
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT INTO users
           (id, employee_code, normalized_email, display_name, role, password_hash, active)
         VALUES (?, ?, ?, ?, 'employee', 'unused', 1)`,
      ).bind(
        otherEmployee.id,
        otherEmployee.employeeCode,
        otherEmployee.email,
        otherEmployee.displayName,
      ),
      testEnv.DB.prepare(
        `INSERT INTO attendance_records
           (id, user_id, work_date, attendance_category, version)
         VALUES ('record-owned', ?, '2026-08-09', 'work', 2)`,
      ).bind(employee.id),
      testEnv.DB.prepare(
        `INSERT INTO attendance_records
           (id, user_id, work_date, attendance_category, version)
         VALUES ('record-other', ?, '2026-08-09', 'work', 2)`,
      ).bind(otherEmployee.id),
      testEnv.DB.prepare(
        `INSERT INTO audit_logs
           (id, entity_type, entity_id, action, before_json, after_json,
            reason, actor_user_id, created_at)
         VALUES ('audit-owned-create', 'attendance_record', 'record-owned', 'create',
                 NULL, '{}', '作成', ?, '2026-08-10T00:00:00.000Z')`,
      ).bind(admin.id),
      testEnv.DB.prepare(
        `INSERT INTO audit_logs
           (id, entity_type, entity_id, action, before_json, after_json,
            reason, actor_user_id, created_at)
         VALUES ('audit-owned-update', 'attendance_record', 'record-owned', 'update',
                 ?, ?, '本人から訂正連絡を受けたため', ?, '2026-08-10T01:00:00.000Z')`,
      ).bind(
        JSON.stringify({ clockInAt: "2026-08-08T23:00:00.000Z" }),
        JSON.stringify({ clockInAt: "2026-08-08T23:05:00.000Z" }),
        admin.id,
      ),
      testEnv.DB.prepare(
        `INSERT INTO audit_logs
           (id, entity_type, entity_id, action, before_json, after_json,
            reason, actor_user_id, created_at)
         VALUES ('audit-other-update', 'attendance_record', 'record-other', 'update',
                 '{}', '{}', '別の更新', ?, '2026-08-10T03:00:00.000Z')`,
      ).bind(admin.id),
    ]);
    await Promise.all([
      seedSession(employee, "employee-token"),
      seedSession(otherEmployee, "other-token"),
      seedSession(admin, "admin-token"),
    ]);

    const contextFor = (recordId: string) => ({
      params: Promise.resolve({ recordId }),
    });
    const unauthenticated = await getAttendanceAudit(
      new Request("http://local.test/api/me/attendance/record-owned/audit"),
      contextFor("record-owned"),
    );
    expect(unauthenticated.status).toBe(401);

    const forbidden = await getAttendanceAudit(
      new Request("http://local.test/api/me/attendance/record-owned/audit", {
        headers: { cookie: "kintain_session=other-token" },
      }),
      contextFor("record-owned"),
    );
    expect(forbidden.status).toBe(403);

    const wrongRole = await getAttendanceAudit(
      new Request("http://local.test/api/me/attendance/record-owned/audit", {
        headers: { cookie: "kintain_session=admin-token" },
      }),
      contextFor("record-owned"),
    );
    expect(wrongRole.status).toBe(403);

    const missing = await getAttendanceAudit(
      new Request("http://local.test/api/me/attendance/missing/audit", {
        headers: { cookie: "kintain_session=employee-token" },
      }),
      contextFor("missing"),
    );
    expect(missing.status).toBe(404);

    const ownHistory = await getAttendanceAudit(
      new Request("http://local.test/api/me/attendance/record-owned/audit", {
        headers: { cookie: "kintain_session=employee-token" },
      }),
      contextFor("record-owned"),
    );
    expect(ownHistory.status).toBe(200);
    expect(ownHistory.headers.get("cache-control")).toBe("no-store");
    const ownBody = (await ownHistory.json()) as {
      data: { logs: Array<{ id: string; actorDisplayName: string }> };
    };
    expect(ownBody.data.logs).toEqual([
      expect.objectContaining({
        id: "audit-owned-update",
        actorDisplayName: admin.displayName,
      }),
    ]);

    const filteredAdminHistory = await getAdminAudit(
      new Request(
        "http://local.test/api/admin/audit?limit=1&entityType=attendance_record&entityId=record-owned",
        { headers: { cookie: "kintain_session=admin-token" } },
      ),
    );
    expect(filteredAdminHistory.status).toBe(200);
    const adminBody = (await filteredAdminHistory.json()) as {
      data: { logs: Array<{ entityId: string }> };
    };
    expect(adminBody.data.logs).toEqual([
      expect.objectContaining({ entityId: "record-owned" }),
    ]);
  });

  it("メールアドレスとパスワードを検証し、失敗時に利用者の存在を漏らさず安全なCookieを発行する", async () => {
    await testEnv.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?")
      .bind(await hashPassword("CorrectDemoPass!2026"), employee.id)
      .run();
    const loginRequest = (email: string, password: string) =>
      new Request("http://local.test/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://local.test",
          "sec-fetch-site": "same-origin",
        },
        body: JSON.stringify({ email, password }),
      });

    const unknownUser = await login(
      loginRequest("unknown@example.test", "WrongDemoPass!2026"),
    );
    expect(unknownUser.status).toBe(401);
    const failure = (await unknownUser.json()) as {
      error: { code: string; message: string };
    };
    expect(failure.error).toEqual({
      code: "INVALID_CREDENTIALS",
      message: "メールアドレスまたはパスワードを確認してください。",
    });

    const success = await login(
      loginRequest(" Employee@Example.Test ", "CorrectDemoPass!2026"),
    );
    expect(success.status).toBe(200);
    const responseBody = (await success.json()) as {
      data: { user: SessionUser };
    };
    expect(responseBody.data.user).toMatchObject({
      id: employee.id,
      role: "employee",
    });
    const cookies = success.headers.get("set-cookie") ?? "";
    expect(cookies).toContain("kintain_session=");
    expect(cookies).toContain("HttpOnly");
    expect(cookies).toContain("SameSite=Lax");
    expect(cookies).toContain("kintain_csrf=");
    const sessions = await testEnv.DB.prepare(
      "SELECT count(*) AS count FROM sessions WHERE user_id = ?",
    )
      .bind(employee.id)
      .first<{ count: number }>();
    expect(sessions?.count).toBe(1);
  });

  it("変更APIはCSRFなしを拒否し、本人の申請作成と取消を監査ログへ残す", async () => {
    await seedSession(employee, "employee-token", "employee-csrf");
    const creationRequestId = "29bd46db-220d-45ee-bf70-4c032230840e";
    const requestFor = (
      csrf: boolean,
      overrides: Record<string, unknown> = {},
    ) =>
      new Request("http://local.test/api/me/requests", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "kintain_session=employee-token",
          origin: "http://local.test",
          "sec-fetch-site": "same-origin",
          ...(csrf ? { "x-csrf-token": "employee-csrf" } : {}),
        },
        body: JSON.stringify({
          workDate: "2026-08-11",
          requestedCategory: "paid_leave",
          reason: "私用のため",
          clientRequestId: creationRequestId,
          ...overrides,
        }),
      });

    const csrfRejected = await createRequest(requestFor(false));
    expect(csrfRejected.status).toBe(403);

    const createdResponse = await createRequest(requestFor(true));
    expect(createdResponse.status).toBe(201);
    const createdBody = (await createdResponse.json()) as {
      data: { id: string; status: string; version: number };
    };
    expect(createdBody.data.status).toBe("pending");

    const repeatedCreate = await createRequest(requestFor(true));
    expect(repeatedCreate.status).toBe(201);
    const repeatedCreateBody = (await repeatedCreate.json()) as {
      data: { id: string };
    };
    expect(repeatedCreateBody.data.id).toBe(createdBody.data.id);

    const reusedCreationKey = await createRequest(
      requestFor(true, { reason: "別の申請に流用" }),
    );
    expect(reusedCreationKey.status).toBe(409);
    await expect(reusedCreationKey.json()).resolves.toMatchObject({
      error: { code: "IDEMPOTENCY_KEY_REUSED" },
    });

    const withdrawalRequestId = "003d7410-6f0f-45b5-bc65-2ca44ed16eb2";
    const withdrawalFor = (clientRequestId: string) =>
      new Request(
        `http://local.test/api/me/requests/${createdBody.data.id}/withdraw`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: "kintain_session=employee-token",
            origin: "http://local.test",
            "sec-fetch-site": "same-origin",
            "x-csrf-token": "employee-csrf",
          },
          body: JSON.stringify({
            version: createdBody.data.version,
            clientRequestId,
          }),
        },
      );
    const withdrawnResponse = await withdrawRequest(
      withdrawalFor(withdrawalRequestId),
      { params: Promise.resolve({ requestId: createdBody.data.id }) },
    );
    expect(withdrawnResponse.status).toBe(200);

    const repeatedWithdrawal = await withdrawRequest(
      withdrawalFor(withdrawalRequestId),
      { params: Promise.resolve({ requestId: createdBody.data.id }) },
    );
    expect(repeatedWithdrawal.status).toBe(200);
    await expect(repeatedWithdrawal.json()).resolves.toMatchObject({
      data: { id: createdBody.data.id, status: "withdrawn" },
    });

    const creationKeyUsedForWithdrawal = await withdrawRequest(
      withdrawalFor(creationRequestId),
      { params: Promise.resolve({ requestId: createdBody.data.id }) },
    );
    expect(creationKeyUsedForWithdrawal.status).toBe(409);
    await expect(creationKeyUsedForWithdrawal.json()).resolves.toMatchObject({
      error: { code: "IDEMPOTENCY_KEY_REUSED" },
    });

    const auditActions = await testEnv.DB.prepare(
      "SELECT action FROM audit_logs WHERE entity_id = ? ORDER BY created_at",
    )
      .bind(createdBody.data.id)
      .all<{ action: string }>();
    expect(auditActions.results.map((row) => row.action)).toEqual([
      "create",
      "withdraw",
    ]);
  });

  it("管理者の承認は勤怠区分へ反映して同じ判断の再送を冪等に扱い、却下は実績を作らない", async () => {
    const service = new AttendanceService(testEnv.DB, () => fixedNow);
    const approveRequest = await service.createRequest({
      userId: employee.id,
      workDate: "2026-08-11",
      requestedCategory: "sick_leave",
      reason: "体調不良のため",
      clientRequestId: "50d748e9-abd1-4a17-b9cc-c1a27070eb14",
    });
    const decisionId = "b1013e37-d94d-4d20-98a4-90f0b47cf651";
    const concurrentReviews = await Promise.allSettled([
      service.reviewRequest({
        actor: admin,
        requestId: approveRequest.id,
        expectedVersion: approveRequest.version,
        decision: "approve",
        reviewComment: "承認します",
        clientRequestId: decisionId,
      }),
      service.reviewRequest({
        actor: admin,
        requestId: approveRequest.id,
        expectedVersion: approveRequest.version,
        decision: "approve",
        reviewComment: "承認します",
        clientRequestId: decisionId,
      }),
    ]);
    const approvedResults = concurrentReviews.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    expect(approvedResults).toHaveLength(2);
    expect(approvedResults.map((result) => result.status)).toEqual([
      "approved",
      "approved",
    ]);
    await expect(
      service.reviewRequest({
        actor: admin,
        requestId: approveRequest.id,
        expectedVersion: approveRequest.version,
        decision: "approve",
        reviewComment: "異なるコメント",
        clientRequestId: decisionId,
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "IDEMPOTENCY_KEY_REUSED",
    });
    await expect(
      service.reviewRequest({
        actor: { ...admin, id: employee.id },
        requestId: approveRequest.id,
        expectedVersion: approveRequest.version,
        decision: "approve",
        reviewComment: "承認します",
        clientRequestId: decisionId,
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "IDEMPOTENCY_KEY_REUSED",
    });
    await expect(
      service.reviewRequest({
        actor: admin,
        requestId: approveRequest.id,
        expectedVersion: approveRequest.version + 1,
        decision: "approve",
        reviewComment: "承認します",
        clientRequestId: decisionId,
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "IDEMPOTENCY_KEY_REUSED",
    });
    const approvedRecord = await testEnv.DB.prepare(
      "SELECT attendance_category FROM attendance_records WHERE user_id = ? AND work_date = '2026-08-11'",
    )
      .bind(employee.id)
      .first<{ attendance_category: string }>();
    expect(approvedRecord?.attendance_category).toBe("sick_leave");

    const rejectRequest = await service.createRequest({
      userId: employee.id,
      workDate: "2026-08-12",
      requestedCategory: "other",
      reason: "終日不在のため",
      clientRequestId: "e141532c-2e24-48a5-906e-da26dd18c873",
    });
    await expect(
      service.reviewRequest({
        actor: admin,
        requestId: rejectRequest.id,
        expectedVersion: rejectRequest.version,
        decision: "reject",
        reviewComment: null,
        clientRequestId: decisionId,
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "IDEMPOTENCY_KEY_REUSED",
    });
    const rejected = await service.reviewRequest({
      actor: admin,
      requestId: rejectRequest.id,
      expectedVersion: rejectRequest.version,
      decision: "reject",
      reviewComment: "勤務予定を確認してください",
      clientRequestId: "46aee3bc-d71b-420c-a95e-3fa7248f25d2",
    });
    expect(rejected.status).toBe("rejected");
    const rejectedRecord = await testEnv.DB.prepare(
      "SELECT id FROM attendance_records WHERE user_id = ? AND work_date = '2026-08-12'",
    )
      .bind(employee.id)
      .first<{ id: string }>();
    expect(rejectedRecord).toBeNull();
    const auditCounts = await testEnv.DB.prepare(
      `SELECT action, count(*) AS count FROM audit_logs
        WHERE entity_id IN (?, ?) AND action IN ('approve', 'reject')
        GROUP BY action ORDER BY action`,
    )
      .bind(approveRequest.id, rejectRequest.id)
      .all<{ action: string; count: number }>();
    expect(auditCounts.results).toEqual([
      { action: "approve", count: 1 },
      { action: "reject", count: 1 },
    ]);

    const racedRequest = await service.createRequest({
      userId: employee.id,
      workDate: "2026-08-13",
      requestedCategory: "absence",
      reason: "競合確認",
      clientRequestId: "10e05a5f-d139-4823-9283-2df8e4ba6255",
    });
    const racedDecisionId = "6af2ac94-43c0-40d5-9a4e-a57472640b59";
    const mixedDecisions = await Promise.allSettled([
      service.reviewRequest({
        actor: admin,
        requestId: racedRequest.id,
        expectedVersion: racedRequest.version,
        decision: "approve",
        reviewComment: "承認側",
        clientRequestId: racedDecisionId,
      }),
      service.reviewRequest({
        actor: admin,
        requestId: racedRequest.id,
        expectedVersion: racedRequest.version,
        decision: "reject",
        reviewComment: "却下側",
        clientRequestId: racedDecisionId,
      }),
    ]);
    expect(
      mixedDecisions.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      mixedDecisions.filter(
        (result) =>
          result.status === "rejected" &&
          result.reason instanceof HttpError &&
          result.reason.code === "IDEMPOTENCY_KEY_REUSED",
      ),
    ).toHaveLength(1);
    const racedState = await service.repositoryForAdmin.findRequestById(
      racedRequest.id,
    );
    const racedAudits = await testEnv.DB.prepare(
      `SELECT action FROM audit_logs
        WHERE entity_id = ? AND action IN ('approve', 'reject')`,
    )
      .bind(racedRequest.id)
      .all<{ action: string }>();
    expect(racedAudits.results).toEqual([
      { action: racedState?.status === "approved" ? "approve" : "reject" },
    ]);
  });

  it("当日の申請は有効状態を優先し、有効状態がなければ最新の却下・取消も表示する", async () => {
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT INTO attendance_requests
           (id, creation_request_id, user_id, work_date, requested_category,
            reason, status, requested_at, version)
         VALUES ('terminal-old', '3fb9fd2e-1301-4ce9-8109-ae9b8696ca40', ?,
                 '2026-08-10', 'other', '旧申請', 'withdrawn',
                 '2026-08-09T20:00:00.000Z', 2)`,
      ).bind(employee.id),
      testEnv.DB.prepare(
        `INSERT INTO attendance_requests
           (id, creation_request_id, user_id, work_date, requested_category,
            reason, status, requested_at, version)
         VALUES ('terminal-latest', '87a462c3-679a-4780-af4d-90c663befc52', ?,
                 '2026-08-10', 'other', '最新申請', 'rejected',
                 '2026-08-09T21:00:00.000Z', 2)`,
      ).bind(employee.id),
    ]);
    const service = new AttendanceService(testEnv.DB, () => fixedNow);
    expect((await service.getToday(employee.id)).request?.id).toBe(
      "terminal-latest",
    );
    expect(
      (await service.getMonth(employee.id, "2026-08")).find(
        (day) => day.workDate === "2026-08-10",
      )?.request?.id,
    ).toBe("terminal-latest");

    await testEnv.DB.prepare(
      `INSERT INTO attendance_requests
         (id, creation_request_id, user_id, work_date, requested_category,
          reason, status, requested_at, version)
       VALUES ('active-older', '640567cc-ae28-46e6-8ff0-0fce58912b7a', ?,
               '2026-08-10', 'paid_leave', '有効申請', 'pending',
               '2026-08-09T19:00:00.000Z', 1)`,
    )
      .bind(employee.id)
      .run();
    expect((await service.getToday(employee.id)).request?.id).toBe(
      "active-older",
    );
    expect(
      (await service.getMonth(employee.id, "2026-08")).find(
        (day) => day.workDate === "2026-08-10",
      )?.request?.id,
    ).toBe("active-older");
  });

  it("管理者用デモリセットは架空データを当日相対の同じ初期状態へ何度でも戻す", async () => {
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        "INSERT INTO work_sites (id, name, active) VALUES ('site-b', 'B現場', 1)",
      ),
      ...[
        ["user-maru", "EMP011", "maru.employee@example.test", "〇〇さん"],
        ["user-batsu", "EMP012", "batsu.employee@example.test", "✕✕さん"],
        ["user-sankaku", "EMP013", "sankaku.employee@example.test", "△△さん"],
        ["user-shikaku", "EMP014", "shikaku.employee@example.test", "□□さん"],
        ["user-hishi", "EMP015", "hishi.employee@example.test", "◇◇さん"],
      ].map(([id, code, email, name]) =>
        testEnv.DB.prepare(
          `INSERT INTO users
             (id, employee_code, normalized_email, display_name, role, password_hash, active)
           VALUES (?, ?, ?, ?, 'employee', 'unused', 1)`,
        ).bind(id, code, email, name),
      ),
    ]);

    for (let run = 0; run < 2; run += 1) {
      await resetDemoAttendanceData({
        database: testEnv.DB,
        actorUserId: admin.id,
        now: fixedNow,
      });
      const counts = await testEnv.DB.prepare(
        `SELECT
           (SELECT count(*) FROM work_schedules) AS schedules,
           (SELECT count(*) FROM attendance_records) AS records,
           (SELECT count(*) FROM punch_events) AS punches,
           (SELECT count(*) FROM attendance_requests) AS requests,
           (SELECT count(*) FROM audit_logs) AS audits`,
      ).first<{
        schedules: number;
        records: number;
        punches: number;
        requests: number;
        audits: number;
      }>();
      expect(counts).toEqual({
        schedules: 6,
        records: 6,
        punches: 5,
        requests: 3,
        audits: 4,
      });
    }

    const midnight = new Date("2026-08-09T15:00:00.000Z");
    await resetDemoAttendanceData({
      database: testEnv.DB,
      actorUserId: admin.id,
      now: midnight,
    });
    const invalidTimes = await testEnv.DB.prepare(
      `SELECT count(*) AS count
         FROM attendance_records
        WHERE clock_in_at > ? OR clock_out_at > ?
           OR (clock_in_at IS NOT NULL AND clock_out_at IS NOT NULL
               AND actual_break_minutes * 60 >
                   unixepoch(clock_out_at) - unixepoch(clock_in_at))`,
    )
      .bind(midnight.toISOString(), midnight.toISOString())
      .first<{ count: number }>();
    expect(invalidTimes?.count).toBe(0);
    const futurePunches = await testEnv.DB.prepare(
      "SELECT count(*) AS count FROM punch_events WHERE occurred_at > ?",
    )
      .bind(midnight.toISOString())
      .first<{ count: number }>();
    expect(futurePunches?.count).toBe(0);
    const completedScenario = await testEnv.DB.prepare(
      `SELECT count(*) AS count FROM attendance_records
        WHERE clock_in_at IS NOT NULL AND clock_out_at IS NOT NULL`,
    ).first<{ count: number }>();
    expect(completedScenario?.count).toBeGreaterThan(0);
  });
});
