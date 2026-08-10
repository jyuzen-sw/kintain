import {
  parseUtcDateTime,
  parseWorkDate,
  toJstWorkDate,
  type UtcDateTime,
  type WorkDate,
} from "./datetime";

export const DEFAULT_BREAK_MINUTES = 60;

export const ATTENDANCE_CATEGORIES = [
  "work",
  "paid_leave",
  "absence",
  "sick_leave",
  "other",
] as const;

export type AttendanceCategory = (typeof ATTENDANCE_CATEGORIES)[number];
export type AttendanceWorkStatus =
  | "no_schedule"
  | "before_work"
  | "working"
  | "completed"
  | "invalid"
  | "non_working";

export type AttendanceErrorCode =
  | "NO_WORK_SCHEDULE"
  | "NON_WORKING_DAY"
  | "CLOCK_IN_ALREADY_EXISTS"
  | "CLOCK_OUT_ALREADY_EXISTS"
  | "CLOCK_IN_REQUIRED"
  | "CLOCK_OUT_MUST_BE_AFTER_CLOCK_IN"
  | "INVALID_BREAK_MINUTES"
  | "BREAK_REQUIRES_COMPLETED_WORK"
  | "BREAK_EXCEEDS_ELAPSED_TIME"
  | "CROSS_DAY_WORK_NOT_SUPPORTED"
  | "WORK_DATE_MISMATCH"
  | "NON_WORKING_RECORD_HAS_TIME";

export class AttendanceValidationError extends Error {
  readonly name = "AttendanceValidationError";

  constructor(
    readonly code: AttendanceErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface AttendanceTimeValues {
  workDate?: WorkDate;
  clockInAt?: UtcDateTime | null;
  clockOutAt?: UtcDateTime | null;
  actualBreakMinutes?: number | null;
  attendanceCategory?: AttendanceCategory;
}

export interface AttendanceStatusInput extends AttendanceTimeValues {
  hasSchedule: boolean;
}

export interface ClockInOverdueInput {
  status: AttendanceWorkStatus;
  scheduledStartAt: UtcDateTime | null | undefined;
  serverNow: UtcDateTime;
}

export interface ClockInValidationInput {
  workDate: WorkDate;
  occurredAt: UtcDateTime;
  hasSchedule: boolean;
  attendanceCategory?: AttendanceCategory;
  clockInAt?: UtcDateTime | null;
  clockOutAt?: UtcDateTime | null;
}

export interface ClockOutValidationInput {
  workDate: WorkDate;
  occurredAt: UtcDateTime;
  attendanceCategory?: AttendanceCategory;
  clockInAt?: UtcDateTime | null;
  clockOutAt?: UtcDateTime | null;
}

export interface PrepareClockOutInput extends ClockOutValidationInput {
  actualBreakMinutes?: number | null;
  scheduledBreakMinutes?: number | null;
}

export interface PreparedClockOut {
  clockOutAt: UtcDateTime;
  actualBreakMinutes: number;
}

const STATUS_LABELS: Readonly<Record<AttendanceWorkStatus, string>> = {
  no_schedule: "勤務予定なし",
  before_work: "未出勤",
  working: "勤務中",
  completed: "退勤済み",
  invalid: "打刻不備",
  non_working: "非勤務",
};

const CATEGORY_LABELS: Readonly<Record<AttendanceCategory, string>> = {
  work: "通常勤務",
  paid_leave: "有休",
  absence: "欠勤",
  sick_leave: "病欠",
  other: "その他",
};

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function assertBreakMinutes(
  value: number,
  fieldName: "休憩実績" | "予定休憩",
): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new AttendanceValidationError(
      "INVALID_BREAK_MINUTES",
      `${fieldName}は0以上の整数（分）で指定してください。`,
    );
  }
}

function assertMatchesWorkDate(
  workDate: WorkDate,
  value: UtcDateTime,
  fieldName: "出勤時刻" | "退勤時刻" | "打刻時刻",
): void {
  parseWorkDate(workDate);
  if (toJstWorkDate(value) !== workDate) {
    throw new AttendanceValidationError(
      "WORK_DATE_MISMATCH",
      `${fieldName}は対象の勤務日と同じ日本時間の日付で指定してください。`,
    );
  }
}

export function isNonWorkingCategory(
  category: AttendanceCategory,
): boolean {
  return category !== "work";
}

export function getAttendanceCategoryLabel(
  category: AttendanceCategory,
): string {
  return CATEGORY_LABELS[category];
}

export function getAttendanceStatusLabel(
  status: AttendanceWorkStatus,
  category: AttendanceCategory = "work",
): string {
  return status === "non_working"
    ? getAttendanceCategoryLabel(category)
    : STATUS_LABELS[status];
}

export function isClockInOverdue(input: ClockInOverdueInput): boolean {
  if (input.status !== "before_work" || !input.scheduledStartAt) return false;
  return (
    parseUtcDateTime(input.scheduledStartAt).getTime() <
    parseUtcDateTime(input.serverNow).getTime()
  );
}

export function resolveBreakMinutesForClockOut(
  actualBreakMinutes: number | null | undefined,
  scheduledBreakMinutes: number | null | undefined,
): number {
  if (isPresent(actualBreakMinutes)) {
    assertBreakMinutes(actualBreakMinutes, "休憩実績");
    return actualBreakMinutes;
  }

  if (isPresent(scheduledBreakMinutes)) {
    assertBreakMinutes(scheduledBreakMinutes, "予定休憩");
    return scheduledBreakMinutes;
  }

  return DEFAULT_BREAK_MINUTES;
}

export function validateAttendanceTimes(values: AttendanceTimeValues): void {
  const category = values.attendanceCategory ?? "work";
  const clockInAt = values.clockInAt;
  const clockOutAt = values.clockOutAt;
  const actualBreakMinutes = values.actualBreakMinutes;
  const hasClockIn = isPresent(clockInAt);
  const hasClockOut = isPresent(clockOutAt);
  const hasBreak = isPresent(actualBreakMinutes);

  if (isNonWorkingCategory(category)) {
    if (hasClockIn || hasClockOut || hasBreak) {
      throw new AttendanceValidationError(
        "NON_WORKING_RECORD_HAS_TIME",
        "承認済みの非勤務日には出勤・退勤時刻や休憩実績を設定できません。",
      );
    }
    return;
  }

  if (hasClockOut && !hasClockIn) {
    throw new AttendanceValidationError(
      "CLOCK_IN_REQUIRED",
      "退勤時刻を登録するには出勤時刻が必要です。",
    );
  }

  if (hasClockIn) {
    parseUtcDateTime(clockInAt);
    if (values.workDate) {
      assertMatchesWorkDate(values.workDate, clockInAt, "出勤時刻");
    }
  }

  if (hasClockOut) {
    parseUtcDateTime(clockOutAt);
    if (values.workDate) {
      assertMatchesWorkDate(values.workDate, clockOutAt, "退勤時刻");
    }
  }

  if (hasBreak) {
    assertBreakMinutes(actualBreakMinutes, "休憩実績");
    if (!hasClockIn || !hasClockOut) {
      throw new AttendanceValidationError(
        "BREAK_REQUIRES_COMPLETED_WORK",
        "休憩実績を登録するには出勤時刻と退勤時刻が必要です。",
      );
    }
  }

  if (!hasClockIn || !hasClockOut) {
    return;
  }

  const clockInTime = parseUtcDateTime(clockInAt).getTime();
  const clockOutTime = parseUtcDateTime(clockOutAt).getTime();

  if (clockOutTime <= clockInTime) {
    throw new AttendanceValidationError(
      "CLOCK_OUT_MUST_BE_AFTER_CLOCK_IN",
      "退勤時刻は出勤時刻より後にしてください。",
    );
  }

  if (toJstWorkDate(clockInAt) !== toJstWorkDate(clockOutAt)) {
    throw new AttendanceValidationError(
      "CROSS_DAY_WORK_NOT_SUPPORTED",
      "日をまたぐ勤務には対応していません。出勤と退勤は同じ勤務日にしてください。",
    );
  }

  if (hasBreak) {
    const elapsedMinutes = Math.floor((clockOutTime - clockInTime) / 60_000);
    if (actualBreakMinutes > elapsedMinutes) {
      throw new AttendanceValidationError(
        "BREAK_EXCEEDS_ELAPSED_TIME",
        "休憩実績は出勤から退勤までの経過時間以下にしてください。",
      );
    }
  }
}

export function determineAttendanceStatus(
  values: AttendanceStatusInput,
): AttendanceWorkStatus {
  try {
    validateAttendanceTimes(values);
  } catch {
    return "invalid";
  }

  const category = values.attendanceCategory ?? "work";
  if (isNonWorkingCategory(category)) {
    return "non_working";
  }
  if (isPresent(values.clockInAt) && isPresent(values.clockOutAt)) {
    return "completed";
  }
  if (isPresent(values.clockInAt)) {
    return "working";
  }
  return values.hasSchedule ? "before_work" : "no_schedule";
}

export function assertCanClockIn(input: ClockInValidationInput): void {
  parseWorkDate(input.workDate);
  parseUtcDateTime(input.occurredAt);

  if (!input.hasSchedule) {
    throw new AttendanceValidationError(
      "NO_WORK_SCHEDULE",
      "勤務予定のない日は出勤できません。",
    );
  }
  if (isNonWorkingCategory(input.attendanceCategory ?? "work")) {
    throw new AttendanceValidationError(
      "NON_WORKING_DAY",
      "承認済みの非勤務日には出勤できません。",
    );
  }
  if (isPresent(input.clockInAt)) {
    throw new AttendanceValidationError(
      "CLOCK_IN_ALREADY_EXISTS",
      "出勤時刻はすでに登録されています。",
    );
  }
  if (isPresent(input.clockOutAt)) {
    throw new AttendanceValidationError(
      "CLOCK_OUT_ALREADY_EXISTS",
      "退勤時刻が登録済みのため出勤できません。",
    );
  }

  assertMatchesWorkDate(input.workDate, input.occurredAt, "打刻時刻");
}

export function assertCanClockOut(input: ClockOutValidationInput): void {
  parseWorkDate(input.workDate);
  parseUtcDateTime(input.occurredAt);

  if (isNonWorkingCategory(input.attendanceCategory ?? "work")) {
    throw new AttendanceValidationError(
      "NON_WORKING_DAY",
      "承認済みの非勤務日には退勤できません。",
    );
  }
  if (!isPresent(input.clockInAt)) {
    throw new AttendanceValidationError(
      "CLOCK_IN_REQUIRED",
      "出勤時刻が登録されていないため退勤できません。",
    );
  }
  if (isPresent(input.clockOutAt)) {
    throw new AttendanceValidationError(
      "CLOCK_OUT_ALREADY_EXISTS",
      "退勤時刻はすでに登録されています。",
    );
  }

  assertMatchesWorkDate(input.workDate, input.clockInAt, "出勤時刻");
  assertMatchesWorkDate(input.workDate, input.occurredAt, "打刻時刻");
  validateAttendanceTimes({
    workDate: input.workDate,
    clockInAt: input.clockInAt,
    clockOutAt: input.occurredAt,
  });
}

export function prepareClockOut(
  input: PrepareClockOutInput,
): PreparedClockOut {
  assertCanClockOut(input);
  let actualBreakMinutes = resolveBreakMinutesForClockOut(
    input.actualBreakMinutes,
    input.scheduledBreakMinutes,
  );

  if (!isPresent(input.actualBreakMinutes) && isPresent(input.clockInAt)) {
    const elapsedMinutes = Math.floor(
      (parseUtcDateTime(input.occurredAt).getTime() -
        parseUtcDateTime(input.clockInAt).getTime()) /
        60_000,
    );
    // 予定値をそのまま採ると短時間勤務だけ退勤不能になるため、自動設定時に限り経過時間を上限にする。
    actualBreakMinutes = Math.min(actualBreakMinutes, elapsedMinutes);
  }

  validateAttendanceTimes({
    workDate: input.workDate,
    clockInAt: input.clockInAt,
    clockOutAt: input.occurredAt,
    actualBreakMinutes,
  });

  return {
    clockOutAt: input.occurredAt,
    actualBreakMinutes,
  };
}

export function calculateWorkedMinutes(
  clockInAt: UtcDateTime,
  clockOutAt: UtcDateTime,
  actualBreakMinutes: number,
): number {
  validateAttendanceTimes({
    clockInAt,
    clockOutAt,
    actualBreakMinutes,
  });

  const elapsedMinutes = Math.floor(
    (parseUtcDateTime(clockOutAt).getTime() -
      parseUtcDateTime(clockInAt).getTime()) /
      60_000,
  );

  return elapsedMinutes - actualBreakMinutes;
}
