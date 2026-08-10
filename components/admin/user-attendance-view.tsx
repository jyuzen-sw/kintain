"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import type { FormEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../../lib/client/api";
import {
  getAdminUserMonth,
  updateAdminAttendance,
  type AdminUserMonth,
} from "../../lib/client/admin-api";
import {
  currentJstMonth,
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
import { useLatestRequestGate } from "../../lib/client/latest-request";
import type {
  AttendanceCategory,
  AttendanceRecordSummary,
  MonthAttendanceDay,
} from "../../lib/contracts/types";
import { AppIcon } from "../shared/icons";
import { ActionButton, EmptyState, InlineNotice, LoadingPanel, StatusChip, type StatusTone } from "../shared/ui";
import {
  AdminPageHeader,
  ResultSummary,
  categoryLabels,
  requestStatusLabels,
  requestStatusTones,
} from "./admin-shared";

function dayStatus(day: MonthAttendanceDay): { label: string; tone: StatusTone } {
  const category = day.record?.attendanceCategory;
  if (category && category !== "work") return { label: categoryLabels[category], tone: "info" };
  if (day.record?.clockOutAt && !day.record.clockInAt) return { label: "打刻不備", tone: "danger" };
  if (day.record?.clockInAt && day.record.clockOutAt) return { label: "完了", tone: "success" };
  if (day.record?.clockInAt) return { label: "勤務中", tone: "primary" };
  if (day.request?.status === "pending") return { label: "申請中", tone: "warning" };
  if (day.schedule) return { label: "未入力", tone: "neutral" };
  return { label: "予定なし", tone: "neutral" };
}

export function UserAttendanceView({ initialMonth }: { initialMonth?: string }) {
  const params = useParams<{ userId: string | string[] }>();
  const userId = Array.isArray(params.userId) ? params.userId[0] ?? "" : params.userId;
  const [month, setMonth] = useState(
    initialMonth?.match(/^\d{4}-(0[1-9]|1[0-2])$/u)
      ? initialMonth
      : currentJstMonth(),
  );
  const [data, setData] = useState<AdminUserMonth | null>(null);
  const [editingDay, setEditingDay] = useState<MonthAttendanceDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const beginRequest = useLatestRequestGate();

  const load = useCallback(async () => {
    if (!userId) return;
    const isLatest = beginRequest();
    setLoading(true);
    setError(null);
    setData((current) =>
      current?.employee.id === userId && current.month === month
        ? current
        : null,
    );
    try {
      const result = await getAdminUserMonth(userId, month);
      if (isLatest()) setData(result);
    } catch (loadError) {
      if (!isLatest()) return;
      setError(
        loadError instanceof Error
          ? loadError.message
          : "個人実績を読み込めませんでした。",
      );
    } finally {
      if (isLatest()) setLoading(false);
    }
  }, [beginRequest, month, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSaved = (record: AttendanceRecordSummary) => {
    setData((current) => current ? {
      ...current,
      days: current.days.map((day) => day.workDate === record.workDate ? { ...day, record } : day),
    } : current);
    setSuccess(`${formatWorkDate(record.workDate)}の実績を更新し、監査ログへ記録しました。`);
    setEditingDay(null);
    void load();
  };

  return (
    <div className="admin-page">
      <AdminPageHeader
        description="出勤・退勤・休憩・区分を修正すると、理由と変更内容が監査ログに残ります。"
        eyebrow="個人実績"
        title={data?.employee.displayName ?? "個人月次実績"}
      >
        <Link className="button button--secondary button--standard" href="/admin/users">従業員を変更</Link>
      </AdminPageHeader>

      <div className="admin-month-picker" aria-label="表示する月">
        <button aria-label="前月を表示" onClick={() => setMonth((current) => shiftMonth(current, -1))} type="button"><AppIcon name="arrow-left" /></button>
        <label>
          <span className="sr-only">表示月</span>
          <input onChange={(event) => event.target.value && setMonth(event.target.value)} type="month" value={month} />
          <strong aria-hidden="true">{formatMonthLabel(month)}</strong>
        </label>
        <button aria-label="次月を表示" onClick={() => setMonth((current) => shiftMonth(current, 1))} type="button"><AppIcon name="arrow-right" /></button>
      </div>

      {success ? <InlineNotice title="実績を更新しました" tone="success">{success}</InlineNotice> : null}
      {error ? (
        <InlineNotice actions={<ActionButton onClick={() => void load()} variant="secondary">再試行する</ActionButton>} role="alert" title="個人実績を表示できません" tone="danger">
          {error}
        </InlineNotice>
      ) : null}

      {loading && !data ? (
        <LoadingPanel label={`${formatMonthLabel(month)}の個人実績を読み込んでいます`} />
      ) : data ? (
        <section aria-busy={loading}>
          <ResultSummary>{data.employee.displayName}・{formatMonthLabel(data.month)}・{data.days.length}日</ResultSummary>
          {data.days.length === 0 ? (
            <EmptyState message="この月には表示できる勤務予定や実績がありません。" title="個人実績がありません" />
          ) : (
            <UserMonthResults days={data.days} onEdit={setEditingDay} />
          )}
        </section>
      ) : null}

      {editingDay?.record ? (
        <AdminAttendanceEditor
          day={editingDay}
          onClose={() => setEditingDay(null)}
          onConflict={() => {
            setEditingDay(null);
            void load();
          }}
          onSaved={handleSaved}
        />
      ) : null}
    </div>
  );
}

function UserMonthResults({
  days,
  onEdit,
}: {
  days: MonthAttendanceDay[];
  onEdit: (day: MonthAttendanceDay) => void;
}) {
  return (
    <div className="admin-results-panel">
      <div className="admin-table-wrap">
        <table className="admin-table admin-month-table">
          <thead><tr><th>日付</th><th>場所</th><th>出勤</th><th>退勤</th><th>休憩</th><th>区分・申請</th><th>履歴</th><th><span className="sr-only">操作</span></th></tr></thead>
          <tbody>
            {days.map((day) => {
              const status = dayStatus(day);
              return (
                <tr key={day.workDate}>
                  <td><time dateTime={day.workDate}>{formatWorkDateShort(day.workDate)}</time></td>
                  <td>{day.schedule?.site.name ?? "—"}</td>
                  <td>{formatJstTime(day.record?.clockInAt ?? null)}</td>
                  <td>{formatJstTime(day.record?.clockOutAt ?? null)}</td>
                  <td>{formatMinutes(day.record?.actualBreakMinutes ?? null)}</td>
                  <td>
                    <div className="admin-status-stack">
                      <StatusChip tone={status.tone}>{status.label}</StatusChip>
                      {day.request ? <StatusChip tone={requestStatusTones[day.request.status]}>{requestStatusLabels[day.request.status]}</StatusChip> : null}
                    </div>
                  </td>
                  <td>{day.record?.hasAuditHistory ? <Link className="admin-row-link" href={`/admin/audit?entityType=attendance_record&entityId=${encodeURIComponent(day.record.id)}`}>履歴あり</Link> : "—"}</td>
                  <td>{day.record ? <button className="admin-action-link" onClick={() => onEdit(day)} type="button">修正</button> : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="admin-card-list">
        {days.map((day) => {
          const status = dayStatus(day);
          return (
            <article className="admin-result-card" key={day.workDate}>
              <div className="admin-result-card__heading">
                <div><h2><time dateTime={day.workDate}>{formatWorkDateShort(day.workDate)}</time></h2><p>{day.schedule?.site.name ?? "勤務予定なし"}</p></div>
                <StatusChip tone={status.tone}>{status.label}</StatusChip>
              </div>
              <dl className="admin-result-card__facts">
                <div><dt>出勤</dt><dd>{formatJstTime(day.record?.clockInAt ?? null)}</dd></div>
                <div><dt>退勤</dt><dd>{formatJstTime(day.record?.clockOutAt ?? null)}</dd></div>
                <div><dt>休憩</dt><dd>{formatMinutes(day.record?.actualBreakMinutes ?? null)}</dd></div>
                <div><dt>区分</dt><dd>{categoryLabels[day.record?.attendanceCategory ?? "work"]}</dd></div>
              </dl>
              <div className="admin-result-card__meta">
                {day.request ? <span>{categoryLabels[day.request.requestedCategory]}・{requestStatusLabels[day.request.status]}</span> : <span>申請なし</span>}
                {day.record?.hasAuditHistory ? <Link href={`/admin/audit?entityType=attendance_record&entityId=${encodeURIComponent(day.record.id)}`}>修正履歴あり</Link> : null}
              </div>
              {day.record ? <ActionButton icon="edit" onClick={() => onEdit(day)} variant="secondary">この日を修正する</ActionButton> : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function AdminAttendanceEditor({
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
  const record = day.record;
  const [category, setCategory] = useState<AttendanceCategory>(record?.attendanceCategory ?? "work");
  const [clockIn, setClockIn] = useState(toTimeInput(record?.clockInAt ?? null));
  const [clockOut, setClockOut] = useState(toTimeInput(record?.clockOutAt ?? null));
  const [breakMinutes, setBreakMinutes] = useState(record?.actualBreakMinutes?.toString() ?? "");
  const [note, setNote] = useState(record?.note ?? "");
  const [reason, setReason] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [keyTracker] = useState(createIdempotencyKeyTracker);

  useEffect(() => {
    if (dialogRef.current && !dialogRef.current.open) {
      dialogRef.current.showModal();
    }
  }, []);

  if (!record) return null;

  const handleCategoryChange = (nextCategory: AttendanceCategory) => {
    setCategory(nextCategory);
    if (nextCategory !== "work") {
      setClockIn("");
      setClockOut("");
      setBreakMinutes("");
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    const clockInAt = category === "work" ? jstTimeToUtc(day.workDate, clockIn) : null;
    const clockOutAt = category === "work" ? jstTimeToUtc(day.workDate, clockOut) : null;
    const parsedBreak = category !== "work" || breakMinutes === "" ? null : Number(breakMinutes);

    if (category === "work" && clockOut && !clockIn) nextErrors.clockIn = "退勤時刻を入力する場合は出勤時刻も入力してください。";
    if (category === "work" && clockIn && !clockInAt) nextErrors.clockIn = "出勤時刻を確認してください。";
    if (category === "work" && clockOut && !clockOutAt) nextErrors.clockOut = "退勤時刻を確認してください。";
    if (clockInAt && clockOutAt && Date.parse(clockOutAt) <= Date.parse(clockInAt)) nextErrors.clockOut = "退勤時刻は出勤時刻より後にしてください。";
    if (parsedBreak !== null && (!Number.isInteger(parsedBreak) || parsedBreak < 0)) nextErrors.breakMinutes = "休憩は0以上の整数（分）で入力してください。";
    if (parsedBreak !== null && (!clockInAt || !clockOutAt)) nextErrors.breakMinutes = "休憩を入力する場合は出勤・退勤時刻も入力してください。";
    if (parsedBreak !== null && clockInAt && clockOutAt) {
      const elapsed = Math.floor((Date.parse(clockOutAt) - Date.parse(clockInAt)) / 60_000);
      if (parsedBreak > elapsed) nextErrors.breakMinutes = "休憩は出勤から退勤までの時間以下にしてください。";
    }
    if (!reason.trim()) nextErrors.reason = "監査ログに残す修正理由を入力してください。";

    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      setError("入力内容を確認してください。");
      return;
    }

    setSaving(true);
    setError(null);
    setConflict(false);
    setFieldErrors({});
    try {
      const payload = {
        clockInAt,
        clockOutAt,
        actualBreakMinutes: parsedBreak,
        attendanceCategory: category,
        note: note.trim() || null,
        reason: reason.trim(),
        version: record.version,
      };
      const updated = await updateAdminAttendance(record.id, {
        ...payload,
        clientRequestId: keyTracker.keyForPayload(payload),
      });
      onSaved(updated);
    } catch (saveError) {
      const hasConflict = saveError instanceof ApiError && saveError.status === 409;
      setConflict(hasConflict);
      setError(
        hasConflict
          ? "ほかの更新が反映されています。最新の実績を読み直してください。"
          : saveError instanceof Error
            ? saveError.message
            : "実績を保存できませんでした。",
      );
      setSaving(false);
    }
  };

  return (
      <dialog
        aria-labelledby="attendance-editor-title"
        className="admin-modal admin-modal--wide"
        onCancel={(event) => {
          if (saving) event.preventDefault();
        }}
        onClose={onClose}
        ref={dialogRef}
      >
        <div className="admin-modal__heading">
          <div><p className="admin-eyebrow">監査理由付き修正</p><h2 id="attendance-editor-title">{formatWorkDate(day.workDate)}</h2></div>
          <button aria-label="閉じる" className="admin-modal__close" disabled={saving} onClick={() => dialogRef.current?.close()} type="button">×</button>
        </div>
        {error ? <InlineNotice actions={conflict ? <ActionButton onClick={onConflict} variant="secondary">最新の実績を読み込む</ActionButton> : undefined} role="alert" title="保存できません" tone="danger">{error}</InlineNotice> : null}
        <form className="admin-form-stack" onSubmit={(event) => void handleSubmit(event)}>
          <label className="admin-field admin-field--stacked">
            <span>勤怠区分</span>
            <select onChange={(event) => handleCategoryChange(event.target.value as AttendanceCategory)} value={category}>
              {(Object.keys(categoryLabels) as AttendanceCategory[]).map((value) => <option key={value} value={value}>{categoryLabels[value]}</option>)}
            </select>
          </label>
          {category === "work" ? (
            <div className="admin-form-grid">
              <EditorField error={fieldErrors.clockIn} label="出勤時刻"><input onChange={(event) => setClockIn(event.target.value)} type="time" value={clockIn} /></EditorField>
              <EditorField error={fieldErrors.clockOut} label="退勤時刻"><input onChange={(event) => setClockOut(event.target.value)} type="time" value={clockOut} /></EditorField>
              <EditorField error={fieldErrors.breakMinutes} label="休憩実績（分）"><input inputMode="numeric" min="0" onChange={(event) => setBreakMinutes(event.target.value)} step="1" type="number" value={breakMinutes} /></EditorField>
            </div>
          ) : <InlineNotice title={`${categoryLabels[category]}として保存します`} tone="info">非勤務区分では出勤・退勤・休憩実績を持ちません。</InlineNotice>}
          <label className="admin-field admin-field--stacked"><span>備考 <small>任意</small></span><textarea maxLength={500} onChange={(event) => setNote(event.target.value)} rows={3} value={note} /></label>
          <EditorField error={fieldErrors.reason} label="修正理由（必須）"><textarea maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="例: 本人から打刻時刻の訂正連絡を受けたため" rows={3} value={reason} /><small>変更前後の値、変更者、日時とともに監査ログへ保存されます。</small></EditorField>
          <div className="admin-modal__actions"><ActionButton disabled={saving} onClick={() => dialogRef.current?.close()} type="button" variant="secondary">閉じる</ActionButton><ActionButton loading={saving} type="submit">修正を保存する</ActionButton></div>
        </form>
      </dialog>
  );
}

function EditorField({ children, error, label }: { children: React.ReactNode; error?: string; label: string }) {
  return <label className="admin-field admin-field--stacked"><span>{label}</span>{children}{error ? <span className="admin-field-error">{error}</span> : null}</label>;
}
