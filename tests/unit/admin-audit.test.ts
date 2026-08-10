import { describe, expect, it } from "vitest";

import { buildAuditDifferences } from "../../components/admin/audit-utils";
import type { AuditLogSummary } from "../../lib/contracts/types";

function auditLog(
  before: unknown,
  after: unknown,
): AuditLogSummary {
  return {
    id: "audit-1",
    entityType: "attendance_record",
    entityId: "record-1",
    action: "update",
    before,
    after,
    reason: "本人から訂正連絡を受けたため",
    actorUserId: "admin-1",
    actorDisplayName: "管理担当",
    subjectUserId: "employee-1",
    subjectDisplayName: "〇〇さん",
    createdAt: "2026-08-10T01:00:00.000Z",
  };
}

describe("監査差分", () => {
  it("利用者向けの項目名と日本時間で変更前後を示す", () => {
    expect(
      buildAuditDifferences(
        auditLog(
          { clockInAt: "2026-08-09T23:00:00.000Z", actualBreakMinutes: 60 },
          { clockInAt: "2026-08-09T23:15:00.000Z", actualBreakMinutes: 45 },
        ),
      ),
    ).toEqual([
      { field: "出勤時刻", before: "08:00", after: "08:15" },
      { field: "休憩実績", before: "1時間", after: "45分" },
    ]);
  });

  it("内部識別子や生JSONを通常の差分へ露出しない", () => {
    expect(
      buildAuditDifferences(
        auditLog(
          { version: 1, mutationId: "internal-1", attendanceCategory: "work" },
          { version: 2, mutationId: "internal-2", attendanceCategory: "sick_leave" },
        ),
      ),
    ).toEqual([
      { field: "勤怠区分", before: "通常勤務", after: "病欠" },
    ]);
  });
});
