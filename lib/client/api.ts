import type {
  AttendanceRecordSummary,
  AttendanceRecordAuditEntry,
  AttendanceRequestSummary,
  AttendanceState,
  LocationState,
  MonthAttendanceDay,
  PunchEventType,
  SessionUser,
  TodayAttendanceResponse,
  WorkScheduleSummary,
} from "../contracts/types";

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

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors: Record<string, string | string[]>;
  readonly requestId: string | null;
  readonly retryAfterSeconds: number | null;

  constructor(
    message: string,
    options: {
      status: number;
      code?: string;
      fieldErrors?: Record<string, string | string[]>;
      requestId?: string;
      retryAfterSeconds?: number | null;
    },
  ) {
    super(message);
    this.name = "ApiError";
    this.status = options.status;
    this.code = options.code ?? "REQUEST_FAILED";
    this.fieldErrors = options.fieldErrors ?? {};
    this.requestId = options.requestId ?? null;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

export function redirectExpiredSession(status: number): void {
  if (
    status !== 401 ||
    typeof window === "undefined" ||
    window.location.pathname === "/login"
  ) {
    return;
  }

  const next = `${window.location.pathname}${window.location.search}`;
  const loginUrl = new URL("/login", window.location.origin);
  loginUrl.searchParams.set("next", next);
  window.location.assign(`${loginUrl.pathname}${loginUrl.search}`);
}

export interface PunchLocationInput {
  state: LocationState;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  capturedAt: string | null;
}

export interface TodayViewModel extends TodayAttendanceResponse {
  user: SessionUser | null;
  publicDemoMode: boolean;
}

export interface DemoAccount {
  displayName: string;
  email: string;
  password: string;
  role: "employee" | "admin";
}

export interface DemoConfig {
  enabled: boolean;
  accounts: DemoAccount[];
}

type JsonRequestInit = Omit<RequestInit, "body"> & {
  body?: unknown;
  csrf?: boolean;
};

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

async function requestData<T>(
  input: string,
  init: JsonRequestInit = {},
): Promise<T> {
  const { body, csrf = false, ...fetchInit } = init;
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (body !== undefined) {
    headers.set("content-type", "application/json");
  }
  if (csrf) {
    const token = readCookie("kintain_csrf");
    if (token) headers.set("x-csrf-token", token);
  }

  let response: Response;
  try {
    response = await fetch(input, {
      ...fetchInit,
      body: body === undefined ? undefined : JSON.stringify(body),
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

  if (response.status === 204) {
    return undefined as T;
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    redirectExpiredSession(response.status);
    const errorPayload = isRecord(payload) ? (payload as ErrorPayload) : {};
    const retryAfter = Number(response.headers.get("retry-after"));
    throw new ApiError(
      errorPayload.error?.message ??
        "処理を完了できませんでした。しばらくしてから再試行してください。",
      {
        status: response.status,
        code: errorPayload.error?.code,
        fieldErrors: errorPayload.error?.fieldErrors,
        requestId: errorPayload.requestId,
        retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : null,
      },
    );
  }

  if (isRecord(payload) && "data" in payload) {
    return (payload as unknown as DataEnvelope<T>).data;
  }
  return payload as T;
}

function normalizeUser(value: unknown): SessionUser {
  const user = value as Partial<SessionUser>;
  return {
    id: user.id ?? "",
    employeeCode: user.employeeCode ?? null,
    displayName: user.displayName ?? "",
    email: user.email ?? "",
    role: user.role ?? "employee",
  };
}

function normalizeState(value: unknown): AttendanceState {
  if (value === "not_started") return "before_work";
  if (
    value === "no_schedule" ||
    value === "before_work" ||
    value === "working" ||
    value === "completed" ||
    value === "non_working" ||
    value === "invalid"
  ) {
    return value;
  }
  return "invalid";
}

function normalizeToday(value: unknown): TodayViewModel {
  const today = value as Partial<TodayAttendanceResponse> & {
    user?: unknown;
    attendance?: AttendanceRecordSummary | null;
    activeRequest?: AttendanceRequestSummary | null;
    publicDemoMode?: unknown;
    status?: unknown;
  };
  const schedule = (today.schedule ?? null) as WorkScheduleSummary | null;
  const record = today.record ?? today.attendance ?? null;
  const request = today.request ?? today.activeRequest ?? null;
  const fallbackWorkDate =
    schedule?.workDate ?? record?.workDate ?? new Date().toISOString().slice(0, 10);

  return {
    serverNow: today.serverNow ?? new Date().toISOString(),
    workDate: today.workDate ?? fallbackWorkDate,
    state: normalizeState(today.state ?? today.status),
    schedule,
    record,
    request,
    user: today.user ? normalizeUser(today.user) : null,
    publicDemoMode: today.publicDemoMode === true,
  };
}

export function getSession(): Promise<SessionUser> {
  return requestData<unknown>("/api/auth/session").then((value) => {
    const raw = isRecord(value) && "user" in value ? value.user : value;
    return normalizeUser(raw);
  });
}

export function login(email: string, password: string): Promise<SessionUser> {
  return requestData<unknown>("/api/auth/login", {
    method: "POST",
    body: { email, password },
  }).then((value) => {
    const raw = isRecord(value) && "user" in value ? value.user : value;
    return normalizeUser(raw);
  });
}

export function logout(): Promise<void> {
  return requestData<void>("/api/auth/logout", { method: "POST", csrf: true });
}

export async function getDemoConfig(): Promise<DemoConfig> {
  const config = await requestData<Partial<DemoConfig>>("/api/demo/config");
  return {
    enabled: config.enabled === true,
    accounts: Array.isArray(config.accounts) ? config.accounts : [],
  };
}

export function getToday(): Promise<TodayViewModel> {
  return requestData<unknown>("/api/me/today").then(normalizeToday);
}

export function punch(input: {
  type: PunchEventType;
  clientRequestId: string;
  location: PunchLocationInput;
}): Promise<TodayViewModel> {
  return requestData<unknown>("/api/me/punch", {
    method: "POST",
    body: input,
    csrf: true,
  }).then(normalizeToday);
}

export async function getMonthAttendance(
  month: string,
): Promise<MonthAttendanceDay[]> {
  const value = await requestData<unknown>(
    `/api/me/attendance?month=${encodeURIComponent(month)}`,
  );
  if (Array.isArray(value)) return value as MonthAttendanceDay[];
  if (isRecord(value) && Array.isArray(value.days)) {
    return value.days as MonthAttendanceDay[];
  }
  if (isRecord(value) && Array.isArray(value.attendance)) {
    return value.attendance as MonthAttendanceDay[];
  }
  return [];
}

export async function getAttendanceAudit(
  recordId: string,
): Promise<AttendanceRecordAuditEntry[]> {
  const value = await requestData<unknown>(
    `/api/me/attendance/${encodeURIComponent(recordId)}/audit`,
  );
  if (Array.isArray(value)) return value as AttendanceRecordAuditEntry[];
  if (isRecord(value) && Array.isArray(value.logs)) {
    return value.logs as AttendanceRecordAuditEntry[];
  }
  return [];
}

export function updateAttendance(
  recordId: string,
  input: {
    clockInAt: string | null;
    clockOutAt: string | null;
    actualBreakMinutes: number | null;
    note: string | null;
    reason: string | null;
    version: number;
    clientRequestId: string;
  },
): Promise<AttendanceRecordSummary> {
  return requestData<AttendanceRecordSummary>(
    `/api/me/attendance/${encodeURIComponent(recordId)}`,
    { method: "PATCH", body: input, csrf: true },
  );
}

export async function getRequests(): Promise<AttendanceRequestSummary[]> {
  const value = await requestData<unknown>("/api/me/requests");
  if (Array.isArray(value)) return value as AttendanceRequestSummary[];
  if (isRecord(value) && Array.isArray(value.requests)) {
    return value.requests as AttendanceRequestSummary[];
  }
  return [];
}

export function createRequest(input: {
  workDate: string;
  requestedCategory: AttendanceRequestSummary["requestedCategory"];
  reason: string;
  clientRequestId: string;
}): Promise<AttendanceRequestSummary> {
  return requestData<AttendanceRequestSummary>("/api/me/requests", {
    method: "POST",
    body: input,
    csrf: true,
  });
}

export function withdrawRequest(
  requestId: string,
  version: number,
  clientRequestId: string,
): Promise<AttendanceRequestSummary> {
  return requestData<AttendanceRequestSummary>(
    `/api/me/requests/${encodeURIComponent(requestId)}/withdraw`,
    { method: "POST", body: { version, clientRequestId }, csrf: true },
  );
}
