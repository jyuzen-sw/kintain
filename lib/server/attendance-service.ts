import type {
  AttendanceCategory,
  AttendanceRecordAuditEntry,
  AttendanceRecordSummary,
  AttendanceRequestSummary,
  MonthAttendanceDay,
  SessionUser,
  TodayAttendanceResponse,
  WorkScheduleSummary,
} from "@/lib/contracts/types";
import {
  assertCanClockIn,
  determineAttendanceStatus,
  prepareClockOut,
  validateAttendanceTimes,
  AttendanceValidationError,
} from "@/lib/domain/attendance";
import {
  DateTimeValidationError,
  getJapaneseWeekday,
  parseWorkDate,
  toJstWorkDate,
} from "@/lib/domain/datetime";
import {
  getScheduleMutationState,
  validateWorkSchedule,
  WorkScheduleValidationError,
} from "@/lib/domain/schedules";
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
  type ScheduleMutationReceipt,
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
  if (error instanceof WorkScheduleValidationError) {
    throw new HttpError(422, error.code, error.message);
  }
  if (error instanceof DateTimeValidationError) {
    throw new HttpError(422, error.code, error.message);
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

interface ScheduleMutationAttempt {
  actorUserId: string;
  userId: string;
  workDate: string;
  scheduleId: string | null;
  expectedVersion: number | null;
  siteId: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
  scheduledBreakMinutes: number | null;
  note: string | null;
}

function isSameScheduleSaveMutation(
  receipt: ScheduleMutationReceipt,
  attempted: ScheduleMutationAttempt,
): boolean {
  const expectedAction = attempted.scheduleId === null ? "create" : "update";
  return (
    receipt.action === expectedAction &&
    receipt.actorUserId === attempted.actorUserId &&
    receipt.userId === attempted.userId &&
    receipt.workDate === attempted.workDate &&
    (attempted.scheduleId === null || receipt.scheduleId === attempted.scheduleId) &&
    receipt.expectedVersion === attempted.expectedVersion &&
    receipt.siteId === attempted.siteId &&
    receipt.scheduledStartAt === attempted.scheduledStartAt &&
    receipt.scheduledEndAt === attempted.scheduledEndAt &&
    receipt.scheduledBreakMinutes === attempted.scheduledBreakMinutes &&
    receipt.note === attempted.note
  );
}

function isSameScheduleDeleteMutation(
  receipt: ScheduleMutationReceipt,
  attempted: {
    actorUserId: string;
    userId: string;
    workDate: string;
    scheduleId: string;
    expectedVersion: number;
  },
): boolean {
  return (
    receipt.action === "delete" &&
    receipt.actorUserId === attempted.actorUserId &&
    receipt.userId === attempted.userId &&
    receipt.workDate === attempted.workDate &&
    receipt.scheduleId === attempted.scheduleId &&
    receipt.expectedVersion === attempted.expectedVersion
  );
}

function scheduleFromReceipt(receipt: ScheduleMutationReceipt): WorkScheduleSummary {
  return {
    id: receipt.scheduleId,
    workDate: receipt.workDate,
    scheduledStartAt: receipt.scheduledStartAt,
    scheduledEndAt: receipt.scheduledEndAt,
    scheduledBreakMinutes: receipt.scheduledBreakMinutes,
    site: { id: receipt.siteId, name: receipt.siteName },
    note: receipt.note,
    version: receipt.resultVersion,
  };
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

  async saveWorkSchedule(input: {
    actor: SessionUser;
    userId: string;
    workDate: string;
    scheduleId: string | null;
    expectedVersion: number | null;
    siteId: string;
    scheduledStartAt: string;
    scheduledEndAt: string;
    scheduledBreakMinutes: number | null;
    note: string | null;
    mutationId: string;
  }): Promise<WorkScheduleSummary> {
    if (input.actor.role !== "admin") {
      throw new HttpError(403, "FORBIDDEN", "管理者だけが勤務予定を変更できます。");
    }
    const creating = input.scheduleId === null && input.expectedVersion === null;
    const updating = input.scheduleId !== null && input.expectedVersion !== null;
    if (!creating && !updating) {
      throw new HttpError(
        422,
        "INVALID_SCHEDULE_VERSION",
        "勤務予定の識別子とversionを確認してください。",
      );
    }

    try {
      parseWorkDate(input.workDate);
      validateWorkSchedule({
        workDate: input.workDate,
        scheduledStartAt: input.scheduledStartAt,
        scheduledEndAt: input.scheduledEndAt,
        scheduledBreakMinutes: input.scheduledBreakMinutes,
      });
    } catch (error) {
      domainError(error);
    }

    const attempted: ScheduleMutationAttempt = {
      actorUserId: input.actor.id,
      userId: input.userId,
      workDate: input.workDate,
      scheduleId: input.scheduleId,
      expectedVersion: input.expectedVersion,
      siteId: input.siteId,
      scheduledStartAt: input.scheduledStartAt,
      scheduledEndAt: input.scheduledEndAt,
      scheduledBreakMinutes: input.scheduledBreakMinutes,
      note: input.note,
    };
    const repeated = await this.repository.findScheduleMutationById(input.mutationId);
    if (repeated) {
      if (isSameScheduleSaveMutation(repeated, attempted)) {
        return scheduleFromReceipt(repeated);
      }
      throw idempotencyKeyReused();
    }
    if (await this.repository.isMutationIdInUse(input.mutationId)) {
      throw idempotencyKeyReused();
    }

    const [employee, site, current, record, request] = await Promise.all([
      this.repository.findActiveEmployee(input.userId),
      this.repository.findActiveSite(input.siteId),
      this.repository.findSchedule(input.userId, input.workDate),
      this.repository.findRecord(input.userId, input.workDate),
      this.repository.findRequestForWorkDate(input.userId, input.workDate),
    ]);
    if (!employee) {
      throw new HttpError(404, "EMPLOYEE_NOT_FOUND", "従業員が見つかりません。");
    }
    if (!site) {
      throw new HttpError(422, "WORK_SITE_NOT_AVAILABLE", "選択した現場は利用できません。");
    }
    const mutationState = getScheduleMutationState({ record, request });
    if (!mutationState.allowed) {
      throw new HttpError(409, "SCHEDULE_LOCKED", mutationState.reason ?? "勤務予定を変更できません。");
    }

    if (creating && current) {
      throw new HttpError(
        409,
        "SCHEDULE_VERSION_CONFLICT",
        "勤務予定が既に登録されています。最新内容を確認してください。",
      );
    }
    if (
      updating &&
      (!current ||
        current.id !== input.scheduleId ||
        current.version !== input.expectedVersion)
    ) {
      throw new HttpError(
        409,
        "SCHEDULE_VERSION_CONFLICT",
        "勤務予定が更新されています。最新内容を確認してください。",
      );
    }

    let succeeded = false;
    try {
      succeeded = creating
        ? await this.repository.createWorkSchedule({
            scheduleId: crypto.randomUUID(),
            userId: input.userId,
            workDate: input.workDate,
            site,
            scheduledStartAt: input.scheduledStartAt,
            scheduledEndAt: input.scheduledEndAt,
            scheduledBreakMinutes: input.scheduledBreakMinutes,
            note: input.note,
            actorUserId: input.actor.id,
            mutationId: input.mutationId,
            now: this.now().toISOString(),
          })
        : await this.repository.updateWorkSchedule({
            before: current as WorkScheduleSummary,
            userId: input.userId,
            site,
            scheduledStartAt: input.scheduledStartAt,
            scheduledEndAt: input.scheduledEndAt,
            scheduledBreakMinutes: input.scheduledBreakMinutes,
            note: input.note,
            actorUserId: input.actor.id,
            mutationId: input.mutationId,
            now: this.now().toISOString(),
          });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
    }
    if (!succeeded) {
      const concurrentlyCompleted = await this.repository.findScheduleMutationById(
        input.mutationId,
      );
      if (concurrentlyCompleted) {
        if (isSameScheduleSaveMutation(concurrentlyCompleted, attempted)) {
          return scheduleFromReceipt(concurrentlyCompleted);
        }
        throw idempotencyKeyReused();
      }
      if (await this.repository.isMutationIdInUse(input.mutationId)) {
        throw idempotencyKeyReused();
      }
      const [latestRecord, latestRequest] = await Promise.all([
        this.repository.findRecord(input.userId, input.workDate),
        this.repository.findRequestForWorkDate(input.userId, input.workDate),
      ]);
      const latestState = getScheduleMutationState({
        record: latestRecord,
        request: latestRequest,
      });
      if (!latestState.allowed) {
        throw new HttpError(409, "SCHEDULE_LOCKED", latestState.reason ?? "勤務予定を変更できません。");
      }
      throw new HttpError(
        409,
        "SCHEDULE_VERSION_CONFLICT",
        "勤務予定が更新されています。最新内容を確認してください。",
      );
    }

    const saved = await this.repository.findSchedule(input.userId, input.workDate);
    if (!saved) {
      throw new HttpError(404, "SCHEDULE_NOT_FOUND", "保存した勤務予定が見つかりません。");
    }
    return saved;
  }

  async deleteWorkSchedule(input: {
    actor: SessionUser;
    userId: string;
    workDate: string;
    scheduleId: string;
    expectedVersion: number;
    mutationId: string;
  }): Promise<void> {
    if (input.actor.role !== "admin") {
      throw new HttpError(403, "FORBIDDEN", "管理者だけが勤務予定を削除できます。");
    }
    try {
      parseWorkDate(input.workDate);
    } catch (error) {
      domainError(error);
    }

    const attempted = {
      actorUserId: input.actor.id,
      userId: input.userId,
      workDate: input.workDate,
      scheduleId: input.scheduleId,
      expectedVersion: input.expectedVersion,
    };
    const repeated = await this.repository.findScheduleMutationById(input.mutationId);
    if (repeated) {
      if (isSameScheduleDeleteMutation(repeated, attempted)) return;
      throw idempotencyKeyReused();
    }
    if (await this.repository.isMutationIdInUse(input.mutationId)) {
      throw idempotencyKeyReused();
    }

    const [employee, current, record, request] = await Promise.all([
      this.repository.findActiveEmployee(input.userId),
      this.repository.findSchedule(input.userId, input.workDate),
      this.repository.findRecord(input.userId, input.workDate),
      this.repository.findRequestForWorkDate(input.userId, input.workDate),
    ]);
    if (!employee) {
      throw new HttpError(404, "EMPLOYEE_NOT_FOUND", "従業員が見つかりません。");
    }
    const mutationState = getScheduleMutationState({ record, request });
    if (!mutationState.allowed) {
      throw new HttpError(409, "SCHEDULE_LOCKED", mutationState.reason ?? "勤務予定を削除できません。");
    }
    if (
      !current ||
      current.id !== input.scheduleId ||
      current.version !== input.expectedVersion
    ) {
      throw new HttpError(
        409,
        "SCHEDULE_VERSION_CONFLICT",
        "勤務予定が更新または削除されています。最新内容を確認してください。",
      );
    }

    let succeeded = false;
    try {
      succeeded = await this.repository.deleteWorkSchedule({
        before: current,
        userId: input.userId,
        actorUserId: input.actor.id,
        mutationId: input.mutationId,
        now: this.now().toISOString(),
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
    }
    if (succeeded) return;

    const concurrentlyCompleted = await this.repository.findScheduleMutationById(
      input.mutationId,
    );
    if (concurrentlyCompleted) {
      if (isSameScheduleDeleteMutation(concurrentlyCompleted, attempted)) return;
      throw idempotencyKeyReused();
    }
    if (await this.repository.isMutationIdInUse(input.mutationId)) {
      throw idempotencyKeyReused();
    }
    const [latestRecord, latestRequest] = await Promise.all([
      this.repository.findRecord(input.userId, input.workDate),
      this.repository.findRequestForWorkDate(input.userId, input.workDate),
    ]);
    const latestState = getScheduleMutationState({
      record: latestRecord,
      request: latestRequest,
    });
    if (!latestState.allowed) {
      throw new HttpError(409, "SCHEDULE_LOCKED", latestState.reason ?? "勤務予定を削除できません。");
    }
    throw new HttpError(
      409,
      "SCHEDULE_VERSION_CONFLICT",
      "勤務予定が更新または削除されています。最新内容を確認してください。",
    );
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
