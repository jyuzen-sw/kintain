import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getAdminAuditLogs,
  getAdminToday,
  resetAdminDemoData,
  reviewAdminRequest,
  updateAdminAttendance,
} from "../../lib/client/admin-api";

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("管理者API契約", () => {
  it("対象日を指定して当日一覧のdata envelopeを読み取る", async () => {
    const payload = {
      workDate: "2026-08-10",
      rows: [],
      employees: [],
      sites: [],
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(payload));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getAdminToday("2026-08-10")).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/today?date=2026-08-10",
      expect.objectContaining({ cache: "no-store", credentials: "same-origin" }),
    );
  });

  it("承認と却下を別エンドポイントへ送りdecisionを本文へ含めない", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "request-1" }));
    vi.stubGlobal("fetch", fetchMock);

    await reviewAdminRequest("request-1", {
      decision: "approve",
      reviewComment: null,
      version: 1,
      clientRequestId: "123e4567-e89b-42d3-a456-426614174000",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/requests/request-1/approve");
    expect(JSON.parse(String(init.body))).toEqual({
      reviewComment: null,
      version: 1,
      clientRequestId: "123e4567-e89b-42d3-a456-426614174000",
    });
  });

  it("勤怠修正へ監査理由と冪等性キーを送る", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "record-1" }));
    vi.stubGlobal("fetch", fetchMock);

    await updateAdminAttendance("record-1", {
      clockInAt: "2026-08-09T23:00:00.000Z",
      clockOutAt: "2026-08-10T08:00:00.000Z",
      actualBreakMinutes: 60,
      attendanceCategory: "work",
      note: null,
      reason: "本人から訂正連絡を受けたため",
      version: 1,
      clientRequestId: "123e4567-e89b-42d3-a456-426614174000",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/attendance/record-1");
    expect(JSON.parse(String(init.body))).toMatchObject({
      reason: "本人から訂正連絡を受けたため",
      clientRequestId: "123e4567-e89b-42d3-a456-426614174000",
    });
  });

  it("デモリセットを管理者用変更APIへ送る", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ reset: true }));
    vi.stubGlobal("fetch", fetchMock);

    await resetAdminDemoData();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/reset",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("監査ログの対象種別とrecord IDをserver-side filterとして送る", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ logs: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await getAdminAuditLogs({
      limit: 25,
      entityType: "attendance_record",
      entityId: "record/1",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/audit?limit=25&entityType=attendance_record&entityId=record%2F1",
      expect.objectContaining({ cache: "no-store", credentials: "same-origin" }),
    );
  });
});
