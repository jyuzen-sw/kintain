import { describe, expect, it } from "vitest";

import {
  AttendanceValidationError,
  calculateWorkedMinutes,
  assertCanClockIn,
  assertCanClockOut,
  determineAttendanceStatus,
  getAttendanceStatusLabel,
  isClockInOverdue,
  prepareClockOut,
  resolveBreakMinutesForClockOut,
  validateAttendanceTimes,
} from "../../lib/domain/attendance";

const workDate = "2026-08-10";
const clockInAt = "2026-08-09T22:50:00.000Z";
const clockOutAt = "2026-08-10T07:50:00.000Z";

describe("勤務状態判定", () => {
  it.each([
    [{ hasSchedule: false }, "no_schedule"],
    [{ hasSchedule: true }, "before_work"],
    [{ hasSchedule: true, clockInAt }, "working"],
    [
      {
        hasSchedule: true,
        clockInAt,
        clockOutAt,
        actualBreakMinutes: 60,
      },
      "completed",
    ],
    [
      { hasSchedule: true, attendanceCategory: "paid_leave" as const },
      "non_working",
    ],
    [{ hasSchedule: true, clockOutAt }, "invalid"],
    [
      {
        hasSchedule: true,
        attendanceCategory: "absence" as const,
        clockInAt,
      },
      "invalid",
    ],
  ] as const)("外部から観測できる実績を %s と判定する", (input, expected) => {
    expect(determineAttendanceStatus(input)).toBe(expected);
  });

  it("非勤務区分は具体的な日本語ラベルで表示する", () => {
    expect(getAttendanceStatusLabel("non_working", "sick_leave")).toBe("病欠");
  });

  it("未出勤かつ予定開始を過ぎた場合だけ予定時刻超過と判定する", () => {
    const scheduledStartAt = "2026-08-10T00:00:00.000Z";
    expect(
      isClockInOverdue({
        status: "before_work",
        scheduledStartAt,
        serverNow: "2026-08-09T23:59:59.999Z",
      }),
    ).toBe(false);
    expect(
      isClockInOverdue({
        status: "before_work",
        scheduledStartAt,
        serverNow: scheduledStartAt,
      }),
    ).toBe(false);
    expect(
      isClockInOverdue({
        status: "before_work",
        scheduledStartAt,
        serverNow: "2026-08-10T00:00:00.001Z",
      }),
    ).toBe(true);
    expect(
      isClockInOverdue({
        status: "working",
        scheduledStartAt,
        serverNow: "2026-08-10T01:00:00.000Z",
      }),
    ).toBe(false);
  });
});

describe("出退勤検証", () => {
  it("予定がある未打刻日の出勤を許可する", () => {
    expect(() =>
      assertCanClockIn({
        workDate,
        occurredAt: clockInAt,
        hasSchedule: true,
      }),
    ).not.toThrow();
  });

  it("勤務予定なし・非勤務日・二重出勤を拒否する", () => {
    expect(() =>
      assertCanClockIn({
        workDate,
        occurredAt: clockInAt,
        hasSchedule: false,
      }),
    ).toThrow("勤務予定のない日は出勤できません。");
    expect(() =>
      assertCanClockIn({
        workDate,
        occurredAt: clockInAt,
        hasSchedule: true,
        attendanceCategory: "paid_leave",
      }),
    ).toThrow("承認済みの非勤務日には出勤できません。");
    expect(() =>
      assertCanClockIn({
        workDate,
        occurredAt: clockInAt,
        hasSchedule: true,
        clockInAt,
      }),
    ).toThrow("出勤時刻はすでに登録されています。");
  });

  it("出勤済みかつ未退勤のときだけ退勤を許可する", () => {
    expect(() =>
      assertCanClockOut({ workDate, occurredAt: clockOutAt, clockInAt }),
    ).not.toThrow();
    expect(() =>
      assertCanClockOut({ workDate, occurredAt: clockOutAt }),
    ).toThrow("出勤時刻が登録されていないため退勤できません。");
    expect(() =>
      assertCanClockOut({
        workDate,
        occurredAt: clockOutAt,
        clockInAt,
        clockOutAt,
      }),
    ).toThrow("退勤時刻はすでに登録されています。");
  });

  it("退勤が出勤以前の時刻になる記録を拒否する", () => {
    expect(() =>
      validateAttendanceTimes({
        clockInAt,
        clockOutAt: clockInAt,
        actualBreakMinutes: 0,
      }),
    ).toThrow("退勤時刻は出勤時刻より後にしてください。");
  });

  it("JSTで日をまたぐ勤務を拒否する", () => {
    expect(() =>
      validateAttendanceTimes({
        clockInAt: "2026-08-10T14:30:00.000Z",
        clockOutAt: "2026-08-10T15:30:00.000Z",
        actualBreakMinutes: 0,
      }),
    ).toThrow("日をまたぐ勤務には対応していません。");
  });

  it("対象勤務日と異なる打刻を拒否する", () => {
    expect(() =>
      assertCanClockIn({
        workDate,
        occurredAt: "2026-08-10T15:00:00.000Z",
        hasSchedule: true,
      }),
    ).toThrow("打刻時刻は対象の勤務日と同じ日本時間の日付で指定してください。");
  });
});

describe("休憩と勤務時間", () => {
  it("入力済み休憩、予定休憩、60分の順で退勤時の休憩を決める", () => {
    expect(resolveBreakMinutesForClockOut(0, 45)).toBe(0);
    expect(resolveBreakMinutesForClockOut(null, 45)).toBe(45);
    expect(resolveBreakMinutesForClockOut(undefined, 0)).toBe(0);
    expect(resolveBreakMinutesForClockOut(null, null)).toBe(60);
  });

  it("予定休憩がない退勤へ60分を設定する", () => {
    expect(
      prepareClockOut({ workDate, clockInAt, occurredAt: clockOutAt }),
    ).toEqual({ clockOutAt, actualBreakMinutes: 60 });
  });

  it("予定休憩より短い勤務でも経過時間を上限に自動設定して退勤できる", () => {
    const shortClockOut = "2026-08-09T23:20:00.000Z";
    expect(
      prepareClockOut({
        workDate,
        clockInAt,
        occurredAt: shortClockOut,
        scheduledBreakMinutes: 60,
      }),
    ).toEqual({ clockOutAt: shortClockOut, actualBreakMinutes: 30 });
    expect(
      prepareClockOut({
        workDate,
        clockInAt,
        occurredAt: shortClockOut,
      }),
    ).toEqual({ clockOutAt: shortClockOut, actualBreakMinutes: 30 });
  });

  it("休憩を0以上の整数かつ経過時間以下に制限する", () => {
    expect(() =>
      validateAttendanceTimes({
        clockInAt,
        clockOutAt,
        actualBreakMinutes: -1,
      }),
    ).toThrow("休憩実績は0以上の整数（分）で指定してください。");
    expect(() =>
      validateAttendanceTimes({
        clockInAt,
        clockOutAt,
        actualBreakMinutes: 541,
      }),
    ).toThrow("休憩実績は出勤から退勤までの経過時間以下にしてください。");
  });

  it("退勤－出勤－休憩で勤務分数を求める", () => {
    expect(calculateWorkedMinutes(clockInAt, clockOutAt, 60)).toBe(480);
  });

  it("非勤務区分に時刻を併存させない", () => {
    expect(() =>
      validateAttendanceTimes({
        attendanceCategory: "paid_leave",
        clockInAt,
      }),
    ).toThrowError(AttendanceValidationError);
  });
});
