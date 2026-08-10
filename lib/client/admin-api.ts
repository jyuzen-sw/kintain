import type {
  AdminAttendanceRow,
  AttendanceCategory,
  AttendanceRecordSummary,
  AttendanceRequestSummary,
  AuditLogSummary,
  EmployeeDirectoryItem,
  MonthAttendanceDay,
  WorkSiteSummary,
} from "../contracts/types";
import { ApiError, redirectExpiredSession } from "./api";

interface ErrorPayload {
  error?: {
    code?: string;
    message?: string;
    fieldErrors?: Record<string, string | string[]>;
  };
  requestId?: string;
}

interface DataEnvelope<T> {
  data: T;
}

type AdminRequestInit = Omit<RequestInit, "body"> & {
  body?: unknown;
  csrf?: boolean;
};

export interface AdminAuditFilters {
  limit?: number;
  entityType?: "attendance_record" | "attendance_request";
  entityId?: string;
}

export interface AdminUserMonth {
  employee: EmployeeDirectoryItem;
  month: string;
  days: MonthAttendanceDay[];
}

export interface AdminTodayData {
  serverNow: string;
  workDate: string;
  rows: AdminAttendanceRow[];
  employees: EmployeeDirectoryItem[];
  sites: WorkSiteSummary[];
}

export interface AdminSiteAttendanceData {
  serverNow: string;
  workDate: string;
  siteId: string | null;
  sites: WorkSiteSummary[];
  rows: AdminAttendanceRow[];
}

export interface AdminAttendanceUpdateInput {
  clockInAt: string | null;
  clockOutAt: string | null;
  actualBreakMinutes: number | null;
  attendanceCategory: AttendanceCategory;
  note: string | null;
  reason: string;
  version: number;
  clientRequestId: string;
}

export interface AdminRequestReviewInput {
  decision: "approve" | "reject";
  reviewComment: string | null;
  version: number;
  clientRequestId: string;
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  for (const item of document.cookie.split(";")) {
    const [cookieName, ...valueParts] = item.trim().split("=");
    if (cookieName === name) {
      return decodeURIComponent(valueParts.join("="));
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function requestAdminData<T>(
  input: string,
  init: AdminRequestInit = {},
): Promise<T> {
  const { csrf = false, ...fetchInit } = init;
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body !== undefined) headers.set("content-type", "application/json");
  if (csrf) {
    const token = readCookie("kintain_csrf");
    if (token) headers.set("x-csrf-token", token);
  }

  let response: Response;
  try {
    response = await fetch(input, {
      ...fetchInit,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
      credentials: "same-origin",
      headers,
    });
  } catch {
    throw new ApiError(
      "通信できませんでした。接続を確認して再試行してください。",
      { status: 0, code: "NETWORK_ERROR" },
    );
  }

  if (response.status === 204) return undefined as T;

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    redirectExpiredSession(response.status);
    const errorPayload = isRecord(payload) ? (payload as ErrorPayload) : {};
    throw new ApiError(
      errorPayload.error?.message ??
        "処理を完了できませんでした。しばらくしてから再試行してください。",
      {
        status: response.status,
        code: errorPayload.error?.code,
        fieldErrors: errorPayload.error?.fieldErrors,
        requestId: errorPayload.requestId,
      },
    );
  }

  if (isRecord(payload) && "data" in payload) {
    return (payload as unknown as DataEnvelope<T>).data;
  }
  return payload as T;
}

function collectionFrom<T>(value: unknown, keys: readonly string[]): T[] {
  if (Array.isArray(value)) return value as T[];
  if (isRecord(value)) {
    for (const key of keys) {
      if (Array.isArray(value[key])) return value[key] as T[];
    }
  }
  return [];
}

export async function getAdminToday(workDate: string): Promise<AdminTodayData> {
  const query = new URLSearchParams({ date: workDate });
  return requestAdminData<AdminTodayData>(
    `/api/admin/today?${query.toString()}`,
  );
}

export function getAdminSiteAttendance(
  workDate: string,
  siteId?: string,
): Promise<AdminSiteAttendanceData> {
  const query = new URLSearchParams({ date: workDate });
  if (siteId) query.set("siteId", siteId);
  return requestAdminData<AdminSiteAttendanceData>(
    `/api/admin/sites?${query.toString()}`,
  );
}

export async function getAdminRequests(): Promise<AttendanceRequestSummary[]> {
  const value = await requestAdminData<unknown>("/api/admin/requests");
  return collectionFrom<AttendanceRequestSummary>(value, ["requests"]);
}

export function reviewAdminRequest(
  requestId: string,
  input: AdminRequestReviewInput,
): Promise<AttendanceRequestSummary> {
  const { decision, ...body } = input;
  return requestAdminData<AttendanceRequestSummary>(
    `/api/admin/requests/${encodeURIComponent(requestId)}/${decision === "approve" ? "approve" : "reject"}`,
    { method: "POST", body, csrf: true },
  );
}

export async function getAdminEmployees(): Promise<EmployeeDirectoryItem[]> {
  const value = await requestAdminData<unknown>("/api/admin/users");
  return collectionFrom<EmployeeDirectoryItem>(value, ["users", "employees"]);
}

export async function getAdminUserMonth(
  userId: string,
  month: string,
): Promise<AdminUserMonth> {
  const query = new URLSearchParams({ month });
  return requestAdminData<AdminUserMonth>(
    `/api/admin/users/${encodeURIComponent(userId)}/attendance?${query.toString()}`,
  );
}

export function updateAdminAttendance(
  recordId: string,
  input: AdminAttendanceUpdateInput,
): Promise<AttendanceRecordSummary> {
  return requestAdminData<AttendanceRecordSummary>(
    `/api/admin/attendance/${encodeURIComponent(recordId)}`,
    { method: "PATCH", body: input, csrf: true },
  );
}

export async function getAdminAuditLogs(
  filters: AdminAuditFilters = {},
): Promise<AuditLogSummary[]> {
  const query = new URLSearchParams();
  query.set("limit", String(filters.limit ?? 100));
  if (filters.entityType) query.set("entityType", filters.entityType);
  if (filters.entityId) query.set("entityId", filters.entityId);
  const value = await requestAdminData<unknown>(
    `/api/admin/audit?${query.toString()}`,
  );
  return collectionFrom<AuditLogSummary>(value, ["logs", "auditLogs"]);
}

export async function resetAdminDemoData(): Promise<void> {
  await requestAdminData<unknown>("/api/admin/reset", {
    method: "POST",
    csrf: true,
  });
}
