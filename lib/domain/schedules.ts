import type {
  AttendanceRecordSummary,
  AttendanceRequestSummary,
  ScheduleMutationState,
} from "../contracts/types";
import {
  parseUtcDateTime,
  parseWorkDate,
  toJstWorkDate,
  type UtcDateTime,
  type WorkDate,
} from "./datetime";

export type WorkScheduleErrorCode =
  | "SCHEDULE_WORK_DATE_MISMATCH"
  | "SCHEDULE_END_MUST_BE_AFTER_START"
  | "SCHEDULE_CROSS_DAY_NOT_SUPPORTED"
  | "INVALID_SCHEDULE_BREAK_MINUTES"
  | "SCHEDULE_BREAK_EXCEEDS_DURATION";

export class WorkScheduleValidationError extends Error {
  readonly name = "WorkScheduleValidationError";

  constructor(
    readonly code: WorkScheduleErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface WorkScheduleValues {
  workDate: WorkDate;
  scheduledStartAt: UtcDateTime;
  scheduledEndAt: UtcDateTime;
  scheduledBreakMinutes: number | null;
}

export function validateWorkSchedule(values: WorkScheduleValues): void {
  parseWorkDate(values.workDate);
  const start = parseUtcDateTime(values.scheduledStartAt);
  const end = parseUtcDateTime(values.scheduledEndAt);
  const startWorkDate = toJstWorkDate(start);
  const endWorkDate = toJstWorkDate(end);

  if (startWorkDate !== endWorkDate) {
    throw new WorkScheduleValidationError(
      "SCHEDULE_CROSS_DAY_NOT_SUPPORTED",
      "日をまたぐ勤務予定には対応していません。",
    );
  }
  if (startWorkDate !== values.workDate) {
    throw new WorkScheduleValidationError(
      "SCHEDULE_WORK_DATE_MISMATCH",
      "開始・終了予定は対象の勤務日と同じ日本時間の日付で指定してください。",
    );
  }
  if (end.getTime() <= start.getTime()) {
    throw new WorkScheduleValidationError(
      "SCHEDULE_END_MUST_BE_AFTER_START",
      "終了予定は開始予定より後にしてください。",
    );
  }

  if (values.scheduledBreakMinutes === null) return;
  if (!Number.isInteger(values.scheduledBreakMinutes) || values.scheduledBreakMinutes < 0) {
    throw new WorkScheduleValidationError(
      "INVALID_SCHEDULE_BREAK_MINUTES",
      "予定休憩は0以上の整数（分）で指定してください。",
    );
  }
  const durationMinutes = Math.floor((end.getTime() - start.getTime()) / 60_000);
  if (values.scheduledBreakMinutes > durationMinutes) {
    throw new WorkScheduleValidationError(
      "SCHEDULE_BREAK_EXCEEDS_DURATION",
      "予定休憩は開始から終了までの時間以下にしてください。",
    );
  }
}

export function getScheduleMutationState(input: {
  record: AttendanceRecordSummary | null;
  request: AttendanceRequestSummary | null;
}): ScheduleMutationState {
  if (input.request?.status === "pending" || input.request?.status === "approved") {
    return {
      allowed: false,
      reason: "申請中または承認済みの申請があるため、勤務予定を変更できません。",
    };
  }

  const record = input.record;
  const hasAttendance = Boolean(
    record &&
      (record.clockInAt !== null ||
        record.clockOutAt !== null ||
        record.actualBreakMinutes !== null ||
        record.attendanceCategory !== "work" ||
        record.note !== null ||
        record.hasAuditHistory),
  );
  if (hasAttendance) {
    return {
      allowed: false,
      reason: "打刻または入力済みの勤怠実績があるため、勤務予定を変更できません。",
    };
  }

  return { allowed: true, reason: null };
}
