import type {
  AttendanceCategory,
  AttendanceRecordAuditEntry,
  AttendanceRecordSummary,
  AttendanceRequestSummary,
  MonthAttendanceDay,
  SessionUser,
  TodayAttendanceResponse,
} from "@/lib/contracts/types";
import {
  assertCanClockIn,
  determineAttendanceStatus,
  prepareClockOut,
  validateAttendanceTimes,
  AttendanceValidationError,
} from "@/lib/domain/attendance";
import {
  getJapaneseWeekday,
  parseWorkDate,
  toJstWorkDate,
} from "@/lib/domain/datetime";
import {
  assertRequestCanBeApproved,
  assertRequestCategory,
  assertRequestTransition,
  AttendanceRequestValidationError,
  isSameRequestCreation,
  isSameRequestReview,
  isSameRequestTransition,
} from "@/lib/domain/requests";
import {
  D1AttendanceRepository,
  type PunchLocationInput,
  type RecordMutationReceipt,
} from "@/lib/repositories/d1-attendance-repository";
import { HttpError } from "@/lib/server/http";

const MONTH_PATTERN = /^(\d{4})-(\d{2})$/u;

function domainError(error: unknown): never {
  if (error instanceof AttendanceValidationError) {
    const conflictCodes = new Set([
      "CLOCK_IN_ALREADY_EXISTS",
      "CLOCK_OUT_ALREADY_EXISTS",
      "NON_WORKING_DAY",
    ]);
    throw new HttpError(
      conflictCodes.has(error.code) ? 409 : 422,
      error.code,
      error.message,
    );
  }
  if (error instanceof AttendanceRequestValidationError) {
    throw new HttpError(409, error.code, error.message);
  }
  throw error;
}

function monthBounds(month: string): { start: string; next: string; days: string[] } {
  const matched = MONTH_PATTERN.exec(month);
  if (!matched) {
    throw new HttpError(400, "INVALID_MONTH", "対象月をYYYY-MM形式で指定してください。");
  }
  const year = Number(matched[1]);
  const monthNumber = Number(matched[2]);
  if (monthNumber < 1 || monthNumber > 12) {
    throw new HttpError(400, "INVALID_MONTH", "対象月を正しく指定してください。");
  }

  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const days = Array.from({ length: lastDay }, (_, index) => {
    return `${year.toString().padStart(4, "0")}-${monthNumber
      .toString()
      .padStart(2, "0")}-${(index + 1).toString().padStart(2, "0")}`;
  });
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  const nextYear = monthNumber === 12 ? year + 1 : year;
  return {
    start: days[0],
    next: `${nextYear.toString().padStart(4, "0")}-${nextMonth
      .toString()
      .padStart(2, "0")}-01`,
    days,
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/iu.test(error.message);
}

function idempotencyKeyReused(): HttpError {
  return new HttpError(
    409,
    "IDEMPOTENCY_KEY_REUSED",
    "再送用の識別子が別の操作で使われています。画面を再読み込みしてください。",
  );
}

function isSameRecordMutation(
  receipt: RecordMutationReceipt,
  attempted: {
    actorUserId: string;
    recordId: string;
    expectedVersion: number;
    clockInAt: string | null;
    clockOutAt: string | null;
    actualBreakMinutes: number | null;
    attendanceCategory: AttendanceCategory;
    note: string | null;
    reason: string | null;
  },
): boolean {
  return (
    receipt.actorUserId === attempted.actorUserId &&
    receipt.recordId === attempted.recordId &&
    receipt.expectedVersion === attempted.expectedVersion &&
    receipt.clockInAt === attempted.clockInAt &&
    receipt.clockOutAt === attempted.clockOutAt &&
    receipt.actualBreakMinutes === attempted.actualBreakMinutes &&
    receipt.attendanceCategory === attempted.attendanceCategory &&
    receipt.note === attempted.note &&
    receipt.reason === attempted.reason
  );
}

function isSamePunchOperation(
  existing: {
    actor_user_id: string;
    work_date: string;
    event_type: "clock_in" | "clock_out";
    location_state: PunchLocationInput["state"];
    latitude: number | null;
    longitude: number | null;
    accuracy_meters: number | null;
    captured_at: string | null;
  },
  attempted: {
    userId: string;
    workDate: string;
    type: "clock_in" | "clock_out";
    location: PunchLocationInput;
  },
): boolean {
  return (
    existing.actor_user_id === attempted.userId &&
    existing.work_date === attempted.workDate &&
    existing.event_type === attempted.type &&
    existing.location_state === attempted.location.state &&
    existing.latitude === attempted.location.latitude &&
    existing.longitude === attempted.location.longitude &&
    existing.accuracy_meters === attempted.location.accuracyMeters &&
    existing.captured_at === attempted.location.capturedAt
  );
}

export class AttendanceService {
  private readonly repository: D1AttendanceRepository;

  constructor(
    database: D1Database,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.repository = new D1AttendanceRepository(database);
  }

  async getToday(userId: string): Promise<TodayAttendanceResponse> {
    const serverNow = this.now().toISOString();
    const workDate = toJstWorkDate(serverNow);
    const [schedule, record, request] = await Promise.all([
      this.repository.findSchedule(userId, workDate),
      this.repository.findRecord(userId, workDate),
      this.repository.findRequestForWorkDate(userId, workDate),
    ]);
    return {
      serverNow,
      workDate,
      state: determineAttendanceStatus({
        hasSchedule: schedule !== null,
        workDate,
        clockInAt: record?.clockInAt,
        clockOutAt: record?.clockOutAt,
        actualBreakMinutes: record?.actualBreakMinutes,
        attendanceCategory: record?.attendanceCategory ?? "work",
      }),
      schedule,
      record,
      request,
    };
  }

  async punch(input: {
    user: SessionUser;
    type: "clock_in" | "clock_out";
    clientRequestId: string;
    location: PunchLocationInput;
  }): Promise<TodayAttendanceResponse> {
    const occurredAt = this.now().toISOString();
    const workDate = toJstWorkDate(occurredAt);
    const existing = await this.repository.findPunchByClientRequestId(input.clientRequestId);
    if (existing) {
      if (
        !isSamePunchOperation(existing, {
          userId: input.user.id,
          workDate,
          type: input.type,
          location: input.location,
        })
      ) {
        throw new HttpError(
          409,
          "IDEMPOTENCY_KEY_REUSED",
          "再送用の識別子が別の操作で使われています。画面を再読み込みしてください。",
        );
      }
      return this.getToday(input.user.id);
    }

    const [schedule, record] = await Promise.all([
      this.repository.findSchedule(input.user.id, workDate),
      this.repository.findRecord(input.user.id, workDate),
    ]);

    try {
      if (input.type === "clock_in") {
        assertCanClockIn({
          workDate,
          occurredAt,
          hasSchedule: schedule !== null,
          attendanceCategory: record?.attendanceCategory ?? "work",
          clockInAt: record?.clockInAt,
          clockOutAt: record?.clockOutAt,
        });
        if (!schedule) {
          throw new HttpError(409, "NO_WORK_SCHEDULE", "勤務予定がありません。");
        }
        const succeeded = await this.repository.clockIn({
          recordId: record?.id ?? crypto.randomUUID(),
          scheduleId: schedule.id,
          userId: input.user.id,
          workDate,
          occurredAt,
          eventId: crypto.randomUUID(),
          clientRequestId: input.clientRequestId,
          location: input.location,
        });
        if (!succeeded) {
          throw new HttpError(
            409,
            "ATTENDANCE_STATE_CHANGED",
            "勤務状態が更新されています。最新状態を読み込み直しました。",
          );
        }
      } else {
        const prepared = prepareClockOut({
          workDate,
          occurredAt,
          attendanceCategory: record?.attendanceCategory ?? "work",
          clockInAt: record?.clockInAt,
          clockOutAt: record?.clockOutAt,
          actualBreakMinutes: record?.actualBreakMinutes,
          scheduledBreakMinutes: schedule?.scheduledBreakMinutes,
        });
        const succeeded = await this.repository.clockOut({
          userId: input.user.id,
          workDate,
          occurredAt,
          breakMinutes: prepared.actualBreakMinutes,
          eventId: crypto.randomUUID(),
          clientRequestId: input.clientRequestId,
          location: input.location,
        });
        if (!succeeded) {
          throw new HttpError(
            409,
            "ATTENDANCE_STATE_CHANGED",
            "勤務状態が更新されています。最新状態を読み込み直しました。",
          );
        }
      }
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const repeated = await this.repository.findPunchByClientRequestId(
          input.clientRequestId,
        );
        if (repeated) {
          if (
            isSamePunchOperation(repeated, {
              userId: input.user.id,
              workDate,
              type: input.type,
              location: input.location,
            })
          ) {
            return this.getToday(input.user.id);
          }
          throw idempotencyKeyReused();
        }
        throw new HttpError(
          409,
          "ATTENDANCE_STATE_CHANGED",
          "打刻はすでに登録されています。最新状態を確認してください。",
        );
      }
      domainError(error);
    }

    return this.getToday(input.user.id);
  }

  async getMonth(userId: string, month: string): Promise<MonthAttendanceDay[]> {
    const bounds = monthBounds(month);
    const result = await this.repository.listMonth({
      userId,
      monthStart: bounds.start,
      nextMonthStart: bounds.next,
    });
    return bounds.days.map((workDate) => ({
      workDate,
      weekday: getJapaneseWeekday(workDate),
      schedule: result.schedules.find((item) => item.workDate === workDate) ?? null,
      record: result.records.find((item) => item.workDate === workDate) ?? null,
      request: result.requests.find((item) => item.workDate === workDate) ?? null,
    }));
  }

  async getRecordAuditHistory(input: {
    actor: SessionUser;
    recordId: string;
  }): Promise<AttendanceRecordAuditEntry[]> {
    if (input.actor.role !== "employee") {
      throw new HttpError(403, "FORBIDDEN", "従業員本人だけが修正履歴を確認できます。");
    }
    const record = await this.repository.findRecordById(input.recordId);
    if (!record) {
      throw new HttpError(404, "ATTENDANCE_NOT_FOUND", "勤怠実績が見つかりません。");
    }
    if (record.userId !== input.actor.id) {
      throw new HttpError(403, "FORBIDDEN", "他の従業員の修正履歴は確認できません。");
    }
    return this.repository.listRecordUpdateAuditLogs(input.recordId);
  }

  async updateRecord(input: {
    actor: SessionUser;
    recordId: string;
    expectedVersion: number;
    clockInAt: string | null;
    clockOutAt: string | null;
    actualBreakMinutes: number | null;
    attendanceCategory?: AttendanceCategory;
    note: string | null;
    reason: string | null;
    mutationId: string;
  }): Promise<AttendanceRecordSummary> {
    const before = await this.repository.findRecordById(input.recordId);
    if (!before) {
      throw new HttpError(404, "ATTENDANCE_NOT_FOUND", "勤怠実績が見つかりません。");
    }
    if (input.actor.role !== "admin" && before.userId !== input.actor.id) {
      throw new HttpError(403, "FORBIDDEN", "他の従業員の実績は変更できません。");
    }

    const category = input.attendanceCategory ?? before.attendanceCategory;
    if (input.actor.role !== "admin" && category !== before.attendanceCategory) {
      throw new HttpError(
        403,
        "CATEGORY_CHANGE_REQUIRES_REQUEST",
        "勤怠区分の変更は申請画面から行ってください。",
      );
    }
    try {
      validateAttendanceTimes({
        workDate: before.workDate,
        clockInAt: input.clockInAt,
        clockOutAt: input.clockOutAt,
        actualBreakMinutes: input.actualBreakMinutes,
        attendanceCategory: category,
      });
    } catch (error) {
      domainError(error);
    }

    const mutationIdentity = {
      actorUserId: input.actor.id,
      recordId: input.recordId,
      expectedVersion: input.expectedVersion,
      clockInAt: input.clockInAt,
      clockOutAt: input.clockOutAt,
      actualBreakMinutes: input.actualBreakMinutes,
      attendanceCategory: category,
      note: input.note,
      reason: input.reason,
    };
    const repeated = await this.repository.findRecordMutationById(
      input.mutationId,
    );
    if (repeated) {
      if (isSameRecordMutation(repeated, mutationIdentity)) return before;
      throw idempotencyKeyReused();
    }
    if (await this.repository.isRecordMutationIdInUse(input.mutationId)) {
      throw idempotencyKeyReused();
    }

    let succeeded = false;
    try {
      succeeded = await this.repository.updateRecord({
        recordId: input.recordId,
        expectedVersion: input.expectedVersion,
        clockInAt: input.clockInAt,
        clockOutAt: input.clockOutAt,
        actualBreakMinutes: input.actualBreakMinutes,
        attendanceCategory: category,
        note: input.note,
        actorUserId: input.actor.id,
        reason: input.reason,
        before,
        now: this.now().toISOString(),
        mutationId: input.mutationId,
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
    }
    if (!succeeded) {
      const concurrentlyCompleted =
        await this.repository.findRecordMutationById(input.mutationId);
      if (concurrentlyCompleted) {
        if (isSameRecordMutation(concurrentlyCompleted, mutationIdentity)) {
          const latest = await this.repository.findRecordById(input.recordId);
          if (!latest) {
            throw new HttpError(
              404,
              "ATTENDANCE_NOT_FOUND",
              "勤怠実績が見つかりません。",
            );
          }
          return latest;
        }
        throw idempotencyKeyReused();
      }
      if (await this.repository.isRecordMutationIdInUse(input.mutationId)) {
        throw idempotencyKeyReused();
      }
      throw new HttpError(
        409,
        "VERSION_CONFLICT",
        "別の操作で実績が更新されました。最新内容を確認して再度保存してください。",
      );
    }
    const updated = await this.repository.findRecordById(input.recordId);
    if (!updated) throw new HttpError(404, "ATTENDANCE_NOT_FOUND", "勤怠実績が見つかりません。");
    return updated;
  }

  async listRequests(userId?: string): Promise<AttendanceRequestSummary[]> {
    return this.repository.listRequests(userId);
  }

  async createRequest(input: {
    userId: string;
    workDate: string;
    requestedCategory: Exclude<AttendanceCategory, "work">;
    reason: string;
    clientRequestId: string;
  }): Promise<AttendanceRequestSummary> {
    parseWorkDate(input.workDate);
    try {
      assertRequestCategory(input.requestedCategory);
      const repeated = await this.repository.findRequestByCreationRequestId(
        input.clientRequestId,
      );
      if (repeated) {
        if (isSameRequestCreation(repeated, input)) return repeated;
        throw idempotencyKeyReused();
      }
      if (
        await this.repository.findRequestByDecisionRequestId(
          input.clientRequestId,
        )
      ) {
        throw idempotencyKeyReused();
      }

      const id = crypto.randomUUID();
      await this.repository.createRequest({
        id,
        clientRequestId: input.clientRequestId,
        userId: input.userId,
        workDate: input.workDate,
        requestedCategory: input.requestedCategory,
        reason: input.reason,
        now: this.now().toISOString(),
      });
      const created = await this.repository.findRequestById(id);
      if (!created) throw new Error("Created request was not found");
      return created;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const repeated = await this.repository.findRequestByCreationRequestId(
          input.clientRequestId,
        );
        if (repeated) {
          if (isSameRequestCreation(repeated, input)) return repeated;
          throw idempotencyKeyReused();
        }
        throw new HttpError(
          409,
          "DUPLICATE_ACTIVE_REQUEST",
          "同じ勤務日には申請中または承認済みの申請があります。",
        );
      }
      domainError(error);
    }
  }

  async withdrawRequest(input: {
    actor: SessionUser;
    requestId: string;
    expectedVersion: number;
    clientRequestId: string;
  }): Promise<AttendanceRequestSummary> {
    const request = await this.repository.findRequestById(input.requestId);
    if (!request) throw new HttpError(404, "REQUEST_NOT_FOUND", "申請が見つかりません。");
    if (request.userId !== input.actor.id) {
      throw new HttpError(403, "FORBIDDEN", "他の従業員の申請は取消できません。");
    }
    if (
      await this.repository.findRequestByCreationRequestId(
        input.clientRequestId,
      )
    ) {
      throw idempotencyKeyReused();
    }
    const repeated = await this.repository.findRequestByDecisionRequestId(
      input.clientRequestId,
    );
    if (repeated) {
      if (
        isSameRequestTransition(repeated, {
          requestId: input.requestId,
          status: "withdrawn",
        })
      ) {
        return repeated;
      }
      throw idempotencyKeyReused();
    }
    if (request.version !== input.expectedVersion) {
      throw new HttpError(409, "VERSION_CONFLICT", "申請状態が更新されています。");
    }
    try {
      assertRequestTransition(request.status, "withdrawn");
    } catch (error) {
      domainError(error);
    }
    const succeeded = await this.repository.transitionRequest({
      request,
      nextStatus: "withdrawn",
      actorUserId: input.actor.id,
      reviewComment: null,
      clientRequestId: input.clientRequestId,
      now: this.now().toISOString(),
    });
    if (!succeeded) {
      const concurrentlyCompleted =
        await this.repository.findRequestByDecisionRequestId(
          input.clientRequestId,
        );
      if (concurrentlyCompleted) {
        if (
          isSameRequestTransition(concurrentlyCompleted, {
            requestId: input.requestId,
            status: "withdrawn",
          })
        ) {
          return concurrentlyCompleted;
        }
        throw idempotencyKeyReused();
      }
      throw new HttpError(
        409,
        "REQUEST_STATE_CHANGED",
        "申請状態が更新されています。",
      );
    }
    const updated = await this.repository.findRequestById(input.requestId);
    if (!updated) throw new HttpError(404, "REQUEST_NOT_FOUND", "申請が見つかりません。");
    return updated;
  }

  async reviewRequest(input: {
    actor: SessionUser;
    requestId: string;
    expectedVersion: number;
    decision: "approve" | "reject";
    reviewComment: string | null;
    clientRequestId: string;
  }): Promise<AttendanceRequestSummary> {
    if (input.actor.role !== "admin") {
      throw new HttpError(403, "FORBIDDEN", "管理者だけが申請を処理できます。");
    }
    const targetStatus = input.decision === "approve" ? "approved" : "rejected";
    if (
      await this.repository.findRequestByCreationRequestId(
        input.clientRequestId,
      )
    ) {
      throw idempotencyKeyReused();
    }
    const repeated = await this.repository.findRequestByDecisionRequestId(
      input.clientRequestId,
    );
    if (repeated) {
      if (
        isSameRequestReview(repeated, {
          requestId: input.requestId,
          status: targetStatus,
          reviewerUserId: input.actor.id,
          reviewComment: input.reviewComment,
          expectedVersion: input.expectedVersion,
        })
      ) {
        return repeated;
      }
      throw idempotencyKeyReused();
    }
    const request = await this.repository.findRequestById(input.requestId);
    if (!request) throw new HttpError(404, "REQUEST_NOT_FOUND", "申請が見つかりません。");
    if (request.version !== input.expectedVersion) {
      throw new HttpError(409, "VERSION_CONFLICT", "申請状態が更新されています。");
    }
    const record = await this.repository.findRecord(request.userId, request.workDate);
    try {
      if (input.decision === "approve") {
        assertRequestCanBeApproved({
          status: request.status,
          clockInAt: record?.clockInAt,
          clockOutAt: record?.clockOutAt,
        });
      } else {
        assertRequestTransition(request.status, "rejected");
      }
    } catch (error) {
      domainError(error);
    }

    const succeeded = await this.repository.transitionRequest({
      request,
      nextStatus: targetStatus,
      actorUserId: input.actor.id,
      reviewComment: input.reviewComment,
      clientRequestId: input.clientRequestId,
      now: this.now().toISOString(),
    });
    if (!succeeded) {
      const concurrentlyCompleted =
        await this.repository.findRequestByDecisionRequestId(
          input.clientRequestId,
        );
      if (concurrentlyCompleted) {
        if (
          isSameRequestReview(concurrentlyCompleted, {
            requestId: input.requestId,
            status: targetStatus,
            reviewerUserId: input.actor.id,
            reviewComment: input.reviewComment,
            expectedVersion: input.expectedVersion,
          })
        ) {
          return concurrentlyCompleted;
        }
        throw idempotencyKeyReused();
      }
      const latestRecord = await this.repository.findRecord(request.userId, request.workDate);
      if (input.decision === "approve" && (latestRecord?.clockInAt || latestRecord?.clockOutAt)) {
        throw new HttpError(
          409,
          "APPROVAL_PUNCH_CONFLICT",
          "対象日に打刻実績があるため承認できません。個人実績で競合を解消してください。",
          { userId: request.userId },
        );
      }
      throw new HttpError(409, "REQUEST_STATE_CHANGED", "申請状態が更新されています。");
    }
    const updated = await this.repository.findRequestById(input.requestId);
    if (!updated) throw new HttpError(404, "REQUEST_NOT_FOUND", "申請が見つかりません。");
    return updated;
  }

  get repositoryForAdmin(): D1AttendanceRepository {
    return this.repository;
  }
}
