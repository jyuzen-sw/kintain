import type { AttendanceCategory } from "./attendance";
import type { UtcDateTime } from "./datetime";

export const ATTENDANCE_REQUEST_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "withdrawn",
] as const;

export const ATTENDANCE_REQUEST_CATEGORIES = [
  "paid_leave",
  "absence",
  "sick_leave",
  "other",
] as const;

export type AttendanceRequestStatus =
  (typeof ATTENDANCE_REQUEST_STATUSES)[number];
export type AttendanceRequestCategory =
  (typeof ATTENDANCE_REQUEST_CATEGORIES)[number];
export type RequestDecision = "approve" | "reject" | "withdraw";

export type AttendanceRequestErrorCode =
  | "INVALID_REQUEST_CATEGORY"
  | "INVALID_REQUEST_TRANSITION"
  | "APPROVAL_PUNCH_CONFLICT"
  | "DUPLICATE_ACTIVE_REQUEST";

export class AttendanceRequestValidationError extends Error {
  readonly name = "AttendanceRequestValidationError";

  constructor(
    readonly code: AttendanceRequestErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface RequestApprovalContext {
  status: AttendanceRequestStatus;
  clockInAt?: UtcDateTime | null;
  clockOutAt?: UtcDateTime | null;
}

export interface ExistingRequestStatus {
  status: AttendanceRequestStatus;
}

export interface RequestCreationIdentity {
  userId: string;
  workDate: string;
  requestedCategory: AttendanceRequestCategory;
  reason: string;
}

export interface RequestTransitionIdentity {
  requestId: string;
  status: Exclude<AttendanceRequestStatus, "pending">;
}

export interface RequestReviewIdentity extends RequestTransitionIdentity {
  reviewerUserId: string;
  reviewComment: string | null;
  expectedVersion: number;
}

const REQUEST_STATUS_LABELS: Readonly<
  Record<AttendanceRequestStatus, string>
> = {
  pending: "申請中",
  approved: "承認済み",
  rejected: "却下",
  withdrawn: "取消済み",
};

const DECISION_TO_STATUS: Readonly<
  Record<RequestDecision, AttendanceRequestStatus>
> = {
  approve: "approved",
  reject: "rejected",
  withdraw: "withdrawn",
};

export function getAttendanceRequestStatusLabel(
  status: AttendanceRequestStatus,
): string {
  return REQUEST_STATUS_LABELS[status];
}

export function isActiveRequestStatus(
  status: AttendanceRequestStatus,
): boolean {
  return status === "pending" || status === "approved";
}

export function isSameRequestCreation(
  existing: RequestCreationIdentity,
  attempted: RequestCreationIdentity,
): boolean {
  return (
    existing.userId === attempted.userId &&
    existing.workDate === attempted.workDate &&
    existing.requestedCategory === attempted.requestedCategory &&
    existing.reason === attempted.reason
  );
}

export function isSameRequestTransition(
  existing: { id: string; status: AttendanceRequestStatus },
  attempted: RequestTransitionIdentity,
): boolean {
  return (
    existing.id === attempted.requestId &&
    existing.status === attempted.status
  );
}

export function isSameRequestReview(
  existing: {
    id: string;
    status: AttendanceRequestStatus;
    reviewerUserId: string | null;
    reviewComment: string | null;
    version: number;
  },
  attempted: RequestReviewIdentity,
): boolean {
  return (
    isSameRequestTransition(existing, attempted) &&
    existing.reviewerUserId === attempted.reviewerUserId &&
    existing.reviewComment === attempted.reviewComment &&
    existing.version === attempted.expectedVersion + 1
  );
}

export function assertRequestCategory(
  category: AttendanceCategory,
): asserts category is AttendanceRequestCategory {
  if (
    !ATTENDANCE_REQUEST_CATEGORIES.includes(
      category as AttendanceRequestCategory,
    )
  ) {
    throw new AttendanceRequestValidationError(
      "INVALID_REQUEST_CATEGORY",
      "通常勤務への変更は申請できません。",
    );
  }
}

export function assertRequestTransition(
  currentStatus: AttendanceRequestStatus,
  nextStatus: AttendanceRequestStatus,
): void {
  const canTransition =
    currentStatus === "pending" &&
    (nextStatus === "approved" ||
      nextStatus === "rejected" ||
      nextStatus === "withdrawn");

  if (!canTransition) {
    throw new AttendanceRequestValidationError(
      "INVALID_REQUEST_TRANSITION",
      `${getAttendanceRequestStatusLabel(currentStatus)}の申請は${getAttendanceRequestStatusLabel(nextStatus)}へ変更できません。`,
    );
  }
}

export function transitionRequestStatus(
  currentStatus: AttendanceRequestStatus,
  decision: RequestDecision,
): AttendanceRequestStatus {
  const nextStatus = DECISION_TO_STATUS[decision];
  assertRequestTransition(currentStatus, nextStatus);
  return nextStatus;
}

export function assertRequestCanBeApproved(
  context: RequestApprovalContext,
): void {
  assertRequestTransition(context.status, "approved");

  if (context.clockInAt != null || context.clockOutAt != null) {
    throw new AttendanceRequestValidationError(
      "APPROVAL_PUNCH_CONFLICT",
      "対象日に打刻実績があるため承認できません。先に個人実績で競合を解消してください。",
    );
  }
}

export function assertNoActiveRequest(
  existingRequests: Iterable<ExistingRequestStatus>,
): void {
  for (const request of existingRequests) {
    if (isActiveRequestStatus(request.status)) {
      throw new AttendanceRequestValidationError(
        "DUPLICATE_ACTIVE_REQUEST",
        "同じ勤務日には申請中または承認済みの申請を複数登録できません。",
      );
    }
  }
}
