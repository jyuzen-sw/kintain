import { describe, expect, it } from "vitest";

import type {
  AttendanceRecordSummary,
  AttendanceRequestSummary,
} from "../../lib/contracts/types";
import {
  getScheduleMutationState,
  validateWorkSchedule,
  WorkScheduleValidationError,
} from "../../lib/domain/schedules";

const emptyRecord: AttendanceRecordSummary = {
  id: "record-1",
  userId: "employee-1",
  workDate: "2026-08-17",
  scheduleId: "schedule-1",
  clockInAt: null,
  clockOutAt: null,
  actualBreakMinutes: null,
  attendanceCategory: "work",
  note: null,
  version: 1,
  hasAuditHistory: false,
};

const request: AttendanceRequestSummary = {
  id: "request-1",
  userId: "employee-1",
  workDate: "2026-08-17",
  requestedCategory: "paid_leave",
  reason: "私用のため",
  status: "pending",
  reviewerUserId: null,
  reviewComment: null,
  requestedAt: "2026-08-16T00:00:00.000Z",
  reviewedAt: null,
  version: 1,
};

describe("勤務予定の入力条件", () => {
  it("対象日の開始・終了と勤務時間内の休憩を受け付ける", () => {
    expect(() => validateWorkSchedule({
      workDate: "2026-08-17",
      scheduledStartAt: "2026-08-17T00:00:00.000Z",
      scheduledEndAt: "2026-08-17T09:00:00.000Z",
      scheduledBreakMinutes: 60,
    })).not.toThrow();
  });

  it.each([
    {
      label: "日をまたぐ予定",
      values: {
        workDate: "2026-08-17",
        scheduledStartAt: "2026-08-17T14:00:00.000Z",
        scheduledEndAt: "2026-08-18T01:00:00.000Z",
        scheduledBreakMinutes: 60,
      },
      code: "SCHEDULE_CROSS_DAY_NOT_SUPPORTED",
    },
    {
      label: "対象日と異なる予定",
      values: {
        workDate: "2026-08-17",
        scheduledStartAt: "2026-08-18T00:00:00.000Z",
        scheduledEndAt: "2026-08-18T09:00:00.000Z",
        scheduledBreakMinutes: 60,
      },
      code: "SCHEDULE_WORK_DATE_MISMATCH",
    },
    {
      label: "終了が開始以前の予定",
      values: {
        workDate: "2026-08-17",
        scheduledStartAt: "2026-08-17T09:00:00.000Z",
        scheduledEndAt: "2026-08-17T00:00:00.000Z",
        scheduledBreakMinutes: 60,
      },
      code: "SCHEDULE_END_MUST_BE_AFTER_START",
    },
    {
      label: "負の休憩時間",
      values: {
        workDate: "2026-08-17",
        scheduledStartAt: "2026-08-17T00:00:00.000Z",
        scheduledEndAt: "2026-08-17T09:00:00.000Z",
        scheduledBreakMinutes: -1,
      },
      code: "INVALID_SCHEDULE_BREAK_MINUTES",
    },
    {
      label: "勤務時間を超える休憩",
      values: {
        workDate: "2026-08-17",
        scheduledStartAt: "2026-08-17T00:00:00.000Z",
        scheduledEndAt: "2026-08-17T01:00:00.000Z",
        scheduledBreakMinutes: 61,
      },
      code: "SCHEDULE_BREAK_EXCEEDS_DURATION",
    },
  ])("$labelを拒否する", ({ code, values }) => {
    try {
      validateWorkSchedule(values);
      throw new Error("勤務予定が拒否されませんでした。");
    } catch (caught) {
      expect(caught).toBeInstanceOf(WorkScheduleValidationError);
      expect(caught).toMatchObject({ code });
    }
  });
});

describe("勤務予定を変更できる条件", () => {
  it("打刻前に作られた空の勤怠レコードだけなら変更できる", () => {
    expect(getScheduleMutationState({ record: emptyRecord, request: null })).toEqual({
      allowed: true,
      reason: null,
    });
  });

  it.each([
    ["出勤打刻", { clockInAt: "2026-08-17T00:00:00.000Z" }],
    ["退勤打刻", { clockOutAt: "2026-08-17T09:00:00.000Z" }],
    ["休憩実績", { actualBreakMinutes: 60 }],
    ["非勤務区分", { attendanceCategory: "absence" as const }],
    ["備考", { note: "入力済み" }],
    ["修正履歴", { hasAuditHistory: true }],
  ])("%sがある勤怠レコードでは変更できない", (_label, change) => {
    expect(getScheduleMutationState({
      record: { ...emptyRecord, ...change },
      request: null,
    })).toMatchObject({ allowed: false });
  });

  it.each(["pending", "approved"] as const)(
    "%sの申請があると変更できない",
    (status) => {
      expect(getScheduleMutationState({
        record: null,
        request: { ...request, status },
      })).toMatchObject({ allowed: false });
    },
  );

  it.each(["rejected", "withdrawn"] as const)(
    "%sの申請なら変更できる",
    (status) => {
      expect(getScheduleMutationState({
        record: null,
        request: { ...request, status },
      })).toEqual({ allowed: true, reason: null });
    },
  );
});
