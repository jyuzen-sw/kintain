export type UserRole = "employee" | "admin";

export type AttendanceCategory =
  | "work"
  | "paid_leave"
  | "absence"
  | "sick_leave"
  | "other";

export type AttendanceRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "withdrawn";

export type LocationState = "granted" | "denied" | "unavailable" | "timeout";

export type PunchEventType = "clock_in" | "clock_out";

export type AttendanceState =
  | "no_schedule"
  | "before_work"
  | "working"
  | "completed"
  | "non_working"
  | "invalid";

export interface SessionUser {
  id: string;
  employeeCode: string | null;
  displayName: string;
  email: string;
  role: UserRole;
}

export interface WorkSiteSummary {
  id: string;
  name: string;
}

export interface WorkScheduleSummary {
  id: string;
  workDate: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
  scheduledBreakMinutes: number | null;
  site: WorkSiteSummary;
  note: string | null;
}

export interface PunchLocationSummary {
  state: LocationState;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  capturedAt: string | null;
}

export interface AttendanceRecordSummary {
  id: string;
  userId: string;
  workDate: string;
  scheduleId: string | null;
  clockInAt: string | null;
  clockOutAt: string | null;
  actualBreakMinutes: number | null;
  attendanceCategory: AttendanceCategory;
  note: string | null;
  version: number;
  hasAuditHistory: boolean;
  locations?: {
    clockIn: PunchLocationSummary | null;
    clockOut: PunchLocationSummary | null;
  };
}

export interface AttendanceRequestSummary {
  id: string;
  userId: string;
  userDisplayName?: string;
  workDate: string;
  requestedCategory: Exclude<AttendanceCategory, "work">;
  reason: string;
  status: AttendanceRequestStatus;
  reviewerUserId: string | null;
  reviewerDisplayName?: string | null;
  reviewComment: string | null;
  requestedAt: string;
  reviewedAt: string | null;
  version: number;
}

export interface AuditLogSummary {
  id: string;
  entityType: "attendance_record" | "attendance_request" | string;
  entityId: string;
  action: string;
  before: unknown;
  after: unknown;
  reason: string | null;
  actorUserId: string;
  actorDisplayName: string;
  subjectUserId: string | null;
  subjectDisplayName: string | null;
  createdAt: string;
}

export interface AttendanceRecordAuditEntry {
  id: string;
  recordId: string;
  before: unknown;
  after: unknown;
  reason: string | null;
  actorDisplayName: string;
  createdAt: string;
}

export interface TodayAttendanceResponse {
  serverNow: string;
  workDate: string;
  state: AttendanceState;
  schedule: WorkScheduleSummary | null;
  record: AttendanceRecordSummary | null;
  request: AttendanceRequestSummary | null;
}

export interface MonthAttendanceDay {
  workDate: string;
  weekday: string;
  schedule: WorkScheduleSummary | null;
  record: AttendanceRecordSummary | null;
  request: AttendanceRequestSummary | null;
}

export interface EmployeeDirectoryItem {
  id: string;
  employeeCode: string | null;
  displayName: string;
  email: string;
}

export interface AdminAttendanceRow {
  user: EmployeeDirectoryItem;
  schedule: WorkScheduleSummary | null;
  record: AttendanceRecordSummary | null;
  request: AttendanceRequestSummary | null;
  state: AttendanceState;
  overdue: boolean;
}
