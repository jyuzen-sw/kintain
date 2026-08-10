import { describe, expect, it } from "vitest";

import { attendanceStatusPresentation } from "../../components/admin/admin-presentation";

describe("管理者の日次未出勤表示", () => {
  it("予定開始前は通常の未出勤として表示する", () => {
    expect(
      attendanceStatusPresentation({
        overdue: false,
        record: null,
        state: "before_work",
      }),
    ).toEqual({ label: "未出勤", tone: "neutral" });
  });

  it("予定開始を過ぎた未出勤だけを注意表示する", () => {
    expect(
      attendanceStatusPresentation({
        overdue: true,
        record: null,
        state: "before_work",
      }),
    ).toEqual({ label: "予定時刻超過", tone: "warning" });
  });
});
