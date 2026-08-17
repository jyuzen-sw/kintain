import {
  formatJstDateTime,
  formatJstTime,
  formatMinutes,
  formatWorkDate,
} from "../../lib/client/date";
import type { AuditLogSummary } from "../../lib/contracts/types";

const categoryLabels: Readonly<Record<string, string>> = {
  work: "通常勤務",
  paid_leave: "有休",
  absence: "欠勤",
  sick_leave: "病欠",
  other: "その他",
};

const requestStatusLabels: Readonly<Record<string, string>> = {
  pending: "申請中",
  approved: "承認済み",
  rejected: "却下",
  withdrawn: "取消済み",
};

const fieldLabels: Readonly<Record<string, string>> = {
  clockInAt: "出勤時刻",
  clockOutAt: "退勤時刻",
  actualBreakMinutes: "休憩実績",
  attendanceCategory: "勤怠区分",
  note: "備考",
  status: "申請状態",
  requestedCategory: "申請区分",
  reason: "申請理由",
  reviewComment: "審査コメント",
  reviewerUserId: "審査担当者",
  reviewedAt: "審査日時",
  workDate: "勤務日",
  siteName: "現場",
  scheduledStartAt: "開始予定",
  scheduledEndAt: "終了予定",
  scheduledBreakMinutes: "予定休憩",
};

export interface AuditDifference {
  field: string;
  before: string;
  after: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function auditValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field === "attendanceCategory" || field === "requestedCategory") {
    return categoryLabels[String(value)] ?? String(value);
  }
  if (field === "status") {
    return requestStatusLabels[String(value)] ?? String(value);
  }
  if (
    (field === "actualBreakMinutes" || field === "scheduledBreakMinutes") &&
    typeof value === "number"
  ) {
    return formatMinutes(value);
  }
  if (field === "workDate" && typeof value === "string") return formatWorkDate(value);
  if (field.endsWith("At") && typeof value === "string") {
    return field === "clockInAt" ||
      field === "clockOutAt" ||
      field === "scheduledStartAt" ||
      field === "scheduledEndAt"
      ? formatJstTime(value)
      : formatJstDateTime(value);
  }
  if (typeof value === "boolean") return value ? "あり" : "なし";
  if (typeof value === "string" || typeof value === "number") return String(value);
  return "変更あり";
}

export function buildAuditDifferences(
  log: Pick<AuditLogSummary, "after" | "before">,
): AuditDifference[] {
  const before = asRecord(log.before);
  const after = asRecord(log.after);
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return keys
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .filter((key) => key in fieldLabels)
    .map((key) => ({
      field: fieldLabels[key] ?? key,
      before: auditValue(key, before[key]),
      after: auditValue(key, after[key]),
    }));
}
