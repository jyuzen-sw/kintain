"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { FormEvent } from "react";
import type {
  AttendanceCategory,
  AttendanceRecordAuditEntry,
  AttendanceRecordSummary,
  AttendanceRequestStatus,
  MonthAttendanceDay,
} from "../../lib/contracts/types";
import {
  ApiError,
  getAttendanceAudit,
  getMonthAttendance,
  updateAttendance,
} from "../../lib/client/api";
import {
  currentJstMonth,
  formatJstDateTime,
  formatJstTime,
  formatMinutes,
  formatMonthLabel,
  formatWorkDate,
  formatWorkDateShort,
  jstTimeToUtc,
  shiftMonth,
  toTimeInput,
} from "../../lib/client/date";
import { createIdempotencyKeyTracker } from "../../lib/client/id";
import { buildAuditDifferences } from "../admin/audit-utils";
import { AppIcon } from "../shared/icons";
import {
  ActionButton,
  EmptyState,
  InlineNotice,
  LoadingPanel,
  StatusChip,
  type StatusTone,
} from "../shared/ui";

const categoryLabels: Record<AttendanceCategory, string> = {
  work: "通常勤務",
  paid_leave: "有休",
  absence: "欠勤",
  sick_leave: "病欠",
  other: "その他",
};

const requestLabels: Record<AttendanceRequestStatus, string> = {
  pending: "申請中",
  approved: "承認済み",
  rejected: "却下",
  withdrawn: "取消済み",
};

function resolveDayStatus(day: MonthAttendanceDay): {
  label: string;
  tone: StatusTone;
} {
  if (day.record?.attendanceCategory && day.record.attendanceCategory !== "work") {
    return {
      label: categoryLabels[day.record.attendanceCategory],
      tone: "info",
    };
  }
  if (day.record?.clockInAt && day.record.clockOutAt) {
    return { label: "完了", tone: "success" };
  }
  if (day.record?.clockInAt) return { label: "勤務中", tone: "primary" };
  if (day.record?.clockOutAt) return { label: "打刻不備", tone: "danger" };
  if (day.request?.status === "pending") return { label: "申請中", tone: "warning" };
  if (day.schedule) return { label: "未入力", tone: "neutral" };
  return { label: "予定なし", tone: "neutral" };
}

function AttendanceEditor({
  day,
  onClose,
  onConflict,
  onSaved,
}: {
  day: MonthAttendanceDay;
  onClose: () => void;
  onConflict: () => void;
  onSaved: (record: AttendanceRecordSummary) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const clockInId = useId();
  const clockOutId = useId();
  const breakId = useId();
  const noteId = useId();
  const reasonId = useId();
  const record = day.record;
  const [clockIn, setClockIn] = useState(toTimeInput(record?.clockInAt ?? null));
  const [clockOut, setClockOut] = useState(toTimeInput(record?.clockOutAt ?? null));
  const [breakMinutes, setBreakMinutes] = useState(
    record?.actualBreakMinutes?.toString() ?? "",
  );
  const [note, setNote] = useState(record?.note ?? "");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [keyTracker] = useState(createIdempotencyKeyTracker);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  if (!record) return null;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validationErrors: Record<string, string> = {};
    const clockInAt = jstTimeToUtc(day.workDate, clockIn);
    const clockOutAt = jstTimeToUtc(day.workDate, clockOut);
    const parsedBreak = breakMinutes === "" ? null : Number(breakMinutes);

    if (clockOut && !clockIn) {
      validationErrors.clockIn = "退勤時刻を入力する場合は出勤時刻も入力してください。";
    }
    if (clockIn && !clockInAt) validationErrors.clockIn = "出勤時刻を確認してください。";
    if (clockOut && !clockOutAt) validationErrors.clockOut = "退勤時刻を確認してください。";
    if (clockInAt && clockOutAt && Date.parse(clockOutAt) <= Date.parse(clockInAt)) {
      validationErrors.clockOut = "退勤時刻は出勤時刻より後にしてください。";
    }
    if (
      parsedBreak !== null &&
      (!Number.isInteger(parsedBreak) || parsedBreak < 0)
    ) {
      validationErrors.breakMinutes = "休憩は0以上の整数（分）で入力してください。";
    }
    if (parsedBreak !== null && (!clockInAt || !clockOutAt)) {
      validationErrors.breakMinutes = "休憩を入力する場合は出勤・退勤時刻も入力してください。";
    }
    if (parsedBreak !== null && clockInAt && clockOutAt) {
      const elapsed = Math.floor((Date.parse(clockOutAt) - Date.parse(clockInAt)) / 60_000);
      if (parsedBreak > elapsed) {
        validationErrors.breakMinutes = "休憩は出勤から退勤までの時間以下にしてください。";
      }
    }

    if (Object.keys(validationErrors).length > 0) {
      setFieldErrors(validationErrors);
      setError("入力内容を確認してください。");
      return;
    }

    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      const payload = {
        clockInAt,
        clockOutAt,
        actualBreakMinutes: parsedBreak,
        note: note.trim() || null,
        reason: reason.trim() || null,
        version: record.version,
      };
      const updated = await updateAttendance(record.id, {
        ...payload,
        clientRequestId: keyTracker.keyForPayload(payload),
      });
      onSaved(updated);
      dialogRef.current?.close();
    } catch (saveError) {
      if (saveError instanceof ApiError && saveError.status === 409) {
        onConflict();
        return;
      } else {
        setError(
          saveError instanceof Error
            ? saveError.message
            : "実績を保存できませんでした。",
        );
      }
      setSaving(false);
    }
  };

  return (
    <dialog
      aria-labelledby={titleId}
      className="sheet-dialog"
      onClose={onClose}
      ref={dialogRef}
    >
      <div className="sheet-dialog__handle" aria-hidden="true" />
      <div className="sheet-dialog__header">
        <div>
          <p className="eyebrow">勤怠実績の見直し</p>
          <h2 id={titleId}>{formatWorkDate(day.workDate)}</h2>
        </div>
        <button
          aria-label="実績の編集を閉じる"
          className="icon-button"
          onClick={() => dialogRef.current?.close()}
          type="button"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>

      {error ? (
        <InlineNotice role="alert" title="保存できませんでした" tone="danger">
          {error}
        </InlineNotice>
      ) : null}

      <form className="form-stack" onSubmit={(event) => void handleSubmit(event)}>
        <div className="time-fields">
          <div className="field">
            <label htmlFor={clockInId}>出勤時刻</label>
            <input
              aria-describedby={fieldErrors.clockIn ? `${clockInId}-error` : undefined}
              aria-invalid={Boolean(fieldErrors.clockIn)}
              id={clockInId}
              onChange={(event) => setClockIn(event.target.value)}
              type="time"
              value={clockIn}
            />
            {fieldErrors.clockIn ? <p className="field-error" id={`${clockInId}-error`}>{fieldErrors.clockIn}</p> : null}
          </div>
          <div className="field">
            <label htmlFor={clockOutId}>退勤時刻</label>
            <input
              aria-describedby={fieldErrors.clockOut ? `${clockOutId}-error` : undefined}
              aria-invalid={Boolean(fieldErrors.clockOut)}
              id={clockOutId}
              onChange={(event) => setClockOut(event.target.value)}
              type="time"
              value={clockOut}
            />
            {fieldErrors.clockOut ? <p className="field-error" id={`${clockOutId}-error`}>{fieldErrors.clockOut}</p> : null}
          </div>
        </div>
        <div className="field">
          <label htmlFor={breakId}>休憩実績（分）</label>
          <input
            aria-describedby={fieldErrors.breakMinutes ? `${breakId}-error` : `${breakId}-help`}
            aria-invalid={Boolean(fieldErrors.breakMinutes)}
            id={breakId}
            inputMode="numeric"
            min="0"
            onChange={(event) => setBreakMinutes(event.target.value)}
            step="1"
            type="number"
            value={breakMinutes}
          />
          {fieldErrors.breakMinutes ? (
            <p className="field-error" id={`${breakId}-error`}>{fieldErrors.breakMinutes}</p>
          ) : (
            <p className="field-help" id={`${breakId}-help`}>0分以上で入力してください。</p>
          )}
        </div>
        <div className="field">
          <label htmlFor={noteId}>備考 <span>任意</span></label>
          <textarea id={noteId} maxLength={500} onChange={(event) => setNote(event.target.value)} rows={3} value={note} />
        </div>
        <div className="field">
          <label htmlFor={reasonId}>修正理由 <span>任意</span></label>
          <textarea id={reasonId} maxLength={500} onChange={(event) => setReason(event.target.value)} rows={2} value={reason} />
          <p className="field-help">入力した理由は変更履歴に保存されます。</p>
        </div>
        <div className="sheet-dialog__actions">
          <ActionButton onClick={() => dialogRef.current?.close()} type="button" variant="secondary">
            閉じる
          </ActionButton>
          <ActionButton loading={saving} type="submit">
            {saving ? "保存しています" : "修正を保存する"}
          </ActionButton>
        </div>
      </form>
    </dialog>
  );
}

function AttendanceAuditDialog({
  onClose,
  record,
}: {
  onClose: () => void;
  record: AttendanceRecordSummary;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [logs, setLogs] = useState<AttendanceRecordAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setLogs(await getAttendanceAudit(record.id));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "修正履歴を読み込めませんでした。",
      );
    } finally {
      setLoading(false);
    }
  }, [record.id]);

  useEffect(() => {
    if (dialogRef.current && !dialogRef.current.open) {
      dialogRef.current.showModal();
    }
    void load();
  }, [load]);

  return (
    <dialog
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      className="sheet-dialog audit-history-dialog"
      onClose={onClose}
      ref={dialogRef}
    >
      <div className="sheet-dialog__handle" aria-hidden="true" />
      <div className="sheet-dialog__header">
        <div>
          <p className="eyebrow">変更内容の確認</p>
          <h2 id={titleId}>{formatWorkDate(record.workDate)}の修正履歴</h2>
        </div>
        <button
          aria-label="修正履歴を閉じる"
          className="icon-button"
          onClick={() => dialogRef.current?.close()}
          type="button"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <p className="audit-history-dialog__intro" id={descriptionId}>
        保存された変更日時・変更者・理由と、項目ごとの変更前後を表示します。
      </p>

      {error ? (
        <InlineNotice
          actions={<ActionButton onClick={() => void load()} variant="secondary">再試行する</ActionButton>}
          role="alert"
          title="修正履歴を表示できません"
          tone="danger"
        >
          {error}
        </InlineNotice>
      ) : null}

      {loading ? (
        <LoadingPanel label="修正履歴を読み込んでいます" />
      ) : error ? null : logs.length === 0 ? (
        <EmptyState
          message="この実績には表示できる修正履歴がありません。"
          title="修正履歴がありません"
        />
      ) : (
        <section className="audit-history-list" aria-label="実績の修正履歴">
          {logs.map((log, index) => {
            const differences = buildAuditDifferences(log);
            return (
              <article className="audit-history-entry" key={log.id}>
                <h3>修正 {logs.length - index}</h3>
                <dl className="audit-history-entry__meta">
                  <div><dt>変更日時</dt><dd><time dateTime={log.createdAt}>{formatJstDateTime(log.createdAt)}</time></dd></div>
                  <div><dt>変更者</dt><dd>{log.actorDisplayName}</dd></div>
                  <div><dt>理由</dt><dd>{log.reason || "理由なし"}</dd></div>
                </dl>
                {differences.length > 0 ? (
                  <table className="audit-history-diff">
                    <caption className="sr-only">修正 {logs.length - index}の項目別変更内容</caption>
                    <thead><tr><th>項目</th><th>変更前</th><th>変更後</th></tr></thead>
                    <tbody>
                      {differences.map((difference) => (
                        <tr key={difference.field}>
                          <th scope="row">{difference.field}</th>
                          <td>{difference.before}</td>
                          <td>{difference.after}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="audit-history-entry__empty">表示対象の項目に変更はありません。</p>
                )}
              </article>
            );
          })}
        </section>
      )}

      <div className="sheet-dialog__actions audit-history-dialog__actions">
        <ActionButton onClick={() => dialogRef.current?.close()} type="button" variant="secondary">
          閉じる
        </ActionButton>
      </div>
    </dialog>
  );
}

export function HistoryView() {
  const searchParams = useSearchParams();
  const initialDate = searchParams.get("date");
  const [month, setMonth] = useState(
    initialDate?.match(/^\d{4}-\d{2}-\d{2}$/u)
      ? initialDate.slice(0, 7)
      : currentJstMonth(),
  );
  const [monthResult, setMonthResult] = useState<{
    days: MonthAttendanceDay[];
    month: string;
  } | null>(null);
  const [editingDay, setEditingDay] = useState<MonthAttendanceDay | null>(null);
  const [auditRecord, setAuditRecord] = useState<AttendanceRecordSummary | null>(null);
  const [loadingMonth, setLoadingMonth] = useState<string | null>(month);
  const [loadError, setLoadError] = useState<{
    message: string;
    month: string;
  } | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const initialDateHandled = useRef(false);
  const loadSequence = useRef(0);

  const loadMonth = useCallback(async (): Promise<boolean> => {
    const requestedMonth = month;
    const sequence = loadSequence.current + 1;
    loadSequence.current = sequence;
    setLoadingMonth(requestedMonth);
    setLoadError(null);
    try {
      const result = await getMonthAttendance(requestedMonth);
      if (loadSequence.current !== sequence) return false;
      setMonthResult({ days: result, month: requestedMonth });
      return true;
    } catch (loadError) {
      if (loadSequence.current !== sequence) return false;
      setMonthResult(null);
      setLoadError({
        message: loadError instanceof Error
          ? loadError.message
          : "月次実績を読み込めませんでした。",
        month: requestedMonth,
      });
      return false;
    } finally {
      if (loadSequence.current === sequence) setLoadingMonth(null);
    }
  }, [month]);

  const days = monthResult?.month === month ? monthResult.days : [];
  const error = loadError?.month === month ? loadError.message : null;
  const loading = loadingMonth === month
    || (monthResult?.month !== month && loadError?.month !== month);

  useEffect(() => {
    void loadMonth();
  }, [loadMonth]);

  useEffect(() => {
    if (!initialDate || initialDateHandled.current || loading) return;
    initialDateHandled.current = true;
    const target = days.find((day) => day.workDate === initialDate && day.record);
    if (target) setEditingDay(target);
  }, [days, initialDate, loading]);

  const handleSaved = (record: AttendanceRecordSummary) => {
    setMonthResult((current) => current?.month === month
      ? {
          ...current,
          days: current.days.map((day) =>
            day.workDate === record.workDate ? { ...day, record } : day,
          ),
        }
      : current);
    setSuccess(`${formatWorkDate(record.workDate)}の実績を更新しました。`);
  };

  const handleConflict = () => {
    setEditingDay(null);
    setSuccess(null);
    setRefreshNotice("ほかの更新を検出したため、最新の実績を読み込んでいます。");
    void loadMonth().then((loaded) => {
      setRefreshNotice(loaded
        ? "ほかの更新を検出したため、最新の実績を読み込みました。"
        : null);
    });
  };

  return (
    <div className="history-page">
      <header className="page-heading">
        <p className="eyebrow">毎日の記録</p>
        <h1>個人実績</h1>
        <p>出勤・退勤・休憩を確認し、必要な日だけ修正できます。</p>
      </header>

      <div className="month-picker" aria-label="表示する月">
        <button
          aria-label="前月を表示"
          className="icon-button"
          onClick={() => setMonth((current) => shiftMonth(current, -1))}
          type="button"
        >
          <AppIcon name="arrow-left" />
        </button>
        <label>
          <span className="sr-only">表示月</span>
          <input
            aria-label="表示月"
            max="9999-12"
            onChange={(event) => event.target.value && setMonth(event.target.value)}
            type="month"
            value={month}
          />
          <strong aria-hidden="true">{formatMonthLabel(month)}</strong>
        </label>
        <button
          aria-label="次月を表示"
          className="icon-button"
          onClick={() => setMonth((current) => shiftMonth(current, 1))}
          type="button"
        >
          <AppIcon name="arrow-right" />
        </button>
      </div>

      {error ? (
        <InlineNotice
          actions={<button className="text-button" onClick={() => void loadMonth()} type="button">再試行する</button>}
          role="alert"
          title="実績を表示できません"
          tone="danger"
        >
          {error}
        </InlineNotice>
      ) : null}
      {success ? (
        <InlineNotice title="実績を更新しました" tone="success">{success}</InlineNotice>
      ) : null}
      {refreshNotice ? (
        <InlineNotice title="最新の実績を反映" tone="info">{refreshNotice}</InlineNotice>
      ) : null}

      {loading ? (
        <LoadingPanel label={`${formatMonthLabel(month)}の実績を読み込んでいます`} />
      ) : days.length === 0 ? (
        <EmptyState
          action={<Link href="/me/requests">休暇・欠勤を申請する</Link>}
          message={`${formatMonthLabel(month)}には表示できる予定や実績がありません。`}
          title="この月の実績はありません"
        />
      ) : (
        <div className="attendance-list" aria-label={`${formatMonthLabel(month)}の勤怠実績`}>
          {days.map((day) => {
            const status = resolveDayStatus(day);
            const category = day.record?.attendanceCategory ?? "work";
            const editable = Boolean(day.record && category === "work");
            return (
              <article className="attendance-card" key={day.workDate}>
                <div className="attendance-card__heading">
                  <div>
                    <time dateTime={day.workDate}>{formatWorkDateShort(day.workDate)}</time>
                    {day.schedule ? <span>{day.schedule.site.name}</span> : null}
                  </div>
                  <StatusChip tone={status.tone}>{status.label}</StatusChip>
                </div>
                <dl className="attendance-card__times">
                  <div><dt>出勤</dt><dd>{formatJstTime(day.record?.clockInAt ?? null)}</dd></div>
                  <div><dt>退勤</dt><dd>{formatJstTime(day.record?.clockOutAt ?? null)}</dd></div>
                  <div><dt>休憩</dt><dd>{formatMinutes(day.record?.actualBreakMinutes ?? null)}</dd></div>
                </dl>
                {day.record?.note ? <p className="attendance-card__note">{day.record.note}</p> : null}
                <div className="attendance-card__meta">
                  {day.request ? (
                    <span>{categoryLabels[day.request.requestedCategory]}・{requestLabels[day.request.status]}</span>
                  ) : <span>申請なし</span>}
                  {day.record?.hasAuditHistory ? (
                    <button className="history-mark" onClick={() => setAuditRecord(day.record)} type="button">
                      <AppIcon name="history" size={16} />
                      修正履歴あり
                    </button>
                  ) : null}
                </div>
                {editable ? (
                  <button className="attendance-card__edit" onClick={() => setEditingDay(day)} type="button">
                    <AppIcon name="edit" size={18} />
                    この日の実績を修正する
                  </button>
                ) : category !== "work" ? (
                  <Link className="attendance-card__edit" href="/me/requests">
                    <AppIcon name="requests" size={18} />
                    申請内容を確認する
                  </Link>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      {editingDay ? (
        <AttendanceEditor
          day={editingDay}
          onClose={() => setEditingDay(null)}
          onConflict={handleConflict}
          onSaved={handleSaved}
        />
      ) : null}
      {auditRecord ? (
        <AttendanceAuditDialog
          onClose={() => setAuditRecord(null)}
          record={auditRecord}
        />
      ) : null}
    </div>
  );
}
