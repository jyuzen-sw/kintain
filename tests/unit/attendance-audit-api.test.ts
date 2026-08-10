import { afterEach, describe, expect, it, vi } from "vitest";

import { getAttendanceAudit, updateAttendance } from "../../lib/client/api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("本人用修正履歴API契約", () => {
  it("record IDをURLへ安全に埋め込み、data envelopeの履歴を返す", async () => {
    const logs = [{
      id: "audit-1",
      recordId: "record/1",
      before: { clockInAt: "2026-08-09T00:12:00.000Z" },
      after: { clockInAt: "2026-08-09T00:05:00.000Z" },
      reason: "打刻時刻を見直したため",
      actorDisplayName: "〇〇さん",
      createdAt: "2026-08-10T01:00:00.000Z",
    }];
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { logs } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getAttendanceAudit("record/1")).resolves.toEqual(logs);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/me/attendance/record%2F1/audit",
      expect.objectContaining({ cache: "no-store", credentials: "same-origin" }),
    );
  });

  it("勤怠修正に画面操作単位のclientRequestIdを含める", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "record-1" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await updateAttendance("record-1", {
      clockInAt: "2026-08-09T00:05:00.000Z",
      clockOutAt: "2026-08-09T09:00:00.000Z",
      actualBreakMinutes: 60,
      note: null,
      reason: "打刻時刻を見直したため",
      version: 1,
      clientRequestId: "123e4567-e89b-42d3-a456-426614174000",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/me/attendance/record-1");
    expect(JSON.parse(String(init.body))).toMatchObject({
      clientRequestId: "123e4567-e89b-42d3-a456-426614174000",
    });
  });
});
