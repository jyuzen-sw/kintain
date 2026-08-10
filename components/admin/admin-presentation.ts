import type {
  AdminAttendanceRow,
  AttendanceCategory,
  AttendanceRequestStatus,
  AttendanceState,
} from "../../lib/contracts/types";
import type { StatusTone } from "../shared/ui";

export const categoryLabels: Readonly<Record<AttendanceCategory, string>> = {
  work: "通常勤務",
  paid_leave: "有休",
  absence: "欠勤",
  sick_leave: "病欠",
  other: "その他",
};

export const requestStatusLabels: Readonly<
  Record<AttendanceRequestStatus, string>
> = {
  pending: "申請中",
  approved: "承認済み",
  rejected: "却下",
  withdrawn: "取消済み",
};

export const requestStatusTones: Readonly<
  Record<AttendanceRequestStatus, StatusTone>
> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  withdrawn: "neutral",
};

const attendanceStates: Readonly<
  Record<AttendanceState, { label: string; tone: StatusTone }>
> = {
  no_schedule: { label: "勤務予定なし", tone: "neutral" },
  before_work: { label: "未出勤", tone: "neutral" },
  working: { label: "勤務中", tone: "primary" },
  completed: { label: "退勤済み", tone: "success" },
  non_working: { label: "非勤務", tone: "info" },
  invalid: { label: "打刻不備", tone: "danger" },
};

export function attendanceStatusPresentation(
  row: Pick<AdminAttendanceRow, "overdue" | "record" | "state">,
): { label: string; tone: StatusTone } {
  const presentation =
    row.state === "before_work"
      ? row.overdue
        ? { label: "予定時刻超過", tone: "warning" as const }
        : { label: "未出勤", tone: "neutral" as const }
      : attendanceStates[row.state];
  return {
    ...presentation,
    label:
      row.state === "non_working" && row.record
        ? categoryLabels[row.record.attendanceCategory]
        : presentation.label,
  };
}
