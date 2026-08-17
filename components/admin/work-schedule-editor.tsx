"use client";

import type { FormEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "../../lib/client/api";
import {
  deleteAdminWorkSchedule,
  saveAdminWorkSchedule,
} from "../../lib/client/admin-api";
import {
  formatWorkDate,
  jstTimeToUtc,
  toTimeInput,
} from "../../lib/client/date";
import { createIdempotencyKeyTracker } from "../../lib/client/id";
import type {
  AdminAttendanceRow,
  WorkSiteSummary,
} from "../../lib/contracts/types";
import { ActionButton, InlineNotice } from "../shared/ui";

export type WorkScheduleSavedAction = "created" | "updated" | "deleted";

export function WorkScheduleEditor({
  onClose,
  onConflict,
  onSaved,
  row,
  sites,
  workDate,
}: {
  onClose: () => void;
  onConflict: (message: string) => void;
  onSaved: (action: WorkScheduleSavedAction) => void;
  row: AdminAttendanceRow;
  sites: WorkSiteSummary[];
  workDate: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const schedule = row.schedule;
  const [siteId, setSiteId] = useState(schedule?.site.id ?? "");
  const [startTime, setStartTime] = useState(
    schedule ? toTimeInput(schedule.scheduledStartAt) : "09:00",
  );
  const [endTime, setEndTime] = useState(
    schedule ? toTimeInput(schedule.scheduledEndAt) : "18:00",
  );
  const [breakMinutes, setBreakMinutes] = useState(
    schedule?.scheduledBreakMinutes?.toString() ?? "60",
  );
  const [note, setNote] = useState(schedule?.note ?? "");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [saveKeyTracker] = useState(createIdempotencyKeyTracker);
  const [deleteKeyTracker] = useState(createIdempotencyKeyTracker);
  const busy = saving || deleting;

  useEffect(() => {
    if (dialogRef.current && !dialogRef.current.open) {
      dialogRef.current.showModal();
    }
  }, []);

  const handleConflict = (caught: ApiError) => {
    onConflict(
      caught.code === "SCHEDULE_LOCKED"
        ? caught.message
        : "ほかの更新が反映されています。最新の勤務予定を読み込みました。",
    );
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    const scheduledStartAt = jstTimeToUtc(workDate, startTime);
    const scheduledEndAt = jstTimeToUtc(workDate, endTime);
    const parsedBreak = breakMinutes === "" ? null : Number(breakMinutes);

    if (!siteId) nextErrors.siteId = "勤務場所を選択してください。";
    if (!startTime || !scheduledStartAt) nextErrors.scheduledStartAt = "開始予定を入力してください。";
    if (!endTime || !scheduledEndAt) nextErrors.scheduledEndAt = "終了予定を入力してください。";
    if (
      scheduledStartAt &&
      scheduledEndAt &&
      Date.parse(scheduledEndAt) <= Date.parse(scheduledStartAt)
    ) {
      nextErrors.scheduledEndAt = "終了予定は開始予定より後にしてください。";
    }
    if (parsedBreak !== null && (!Number.isInteger(parsedBreak) || parsedBreak < 0)) {
      nextErrors.scheduledBreakMinutes = "予定休憩は0以上の整数（分）で入力してください。";
    }
    if (
      parsedBreak !== null &&
      scheduledStartAt &&
      scheduledEndAt &&
      parsedBreak > Math.floor((Date.parse(scheduledEndAt) - Date.parse(scheduledStartAt)) / 60_000)
    ) {
      nextErrors.scheduledBreakMinutes = "予定休憩は開始から終了までの時間以下にしてください。";
    }

    if (Object.keys(nextErrors).length > 0 || !scheduledStartAt || !scheduledEndAt) {
      setFieldErrors(nextErrors);
      setError("入力内容を確認してください。");
      return;
    }

    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      const payload = {
        scheduleId: schedule?.id ?? null,
        version: schedule?.version ?? null,
        siteId,
        scheduledStartAt,
        scheduledEndAt,
        scheduledBreakMinutes: parsedBreak,
        note: note.trim() || null,
      };
      await saveAdminWorkSchedule(row.user.id, workDate, {
        ...payload,
        clientRequestId: saveKeyTracker.keyForPayload(payload),
      });
      onSaved(schedule ? "updated" : "created");
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        handleConflict(caught);
        return;
      }
      if (caught instanceof ApiError) {
        setFieldErrors(normalizeFieldErrors(caught.fieldErrors));
      }
      setError(caught instanceof Error ? caught.message : "勤務予定を保存できませんでした。");
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!schedule) return;
    setDeleting(true);
    setError(null);
    try {
      const payload = {
        scheduleId: schedule.id,
        version: schedule.version,
      };
      await deleteAdminWorkSchedule(row.user.id, workDate, {
        ...payload,
        clientRequestId: deleteKeyTracker.keyForPayload(payload),
      });
      onSaved("deleted");
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        handleConflict(caught);
        return;
      }
      setError(caught instanceof Error ? caught.message : "勤務予定を削除できませんでした。");
      setDeleting(false);
      setConfirmingDelete(false);
    }
  };

  return (
    <dialog
      aria-labelledby="work-schedule-editor-title"
      className="admin-modal admin-modal--wide"
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
      onClose={onClose}
      ref={dialogRef}
    >
      <div className="admin-modal__heading">
        <div>
          <p className="admin-eyebrow">勤務予定</p>
          <h2 id="work-schedule-editor-title">{row.user.displayName}・{formatWorkDate(workDate)}</h2>
        </div>
        <button
          aria-label="閉じる"
          className="admin-modal__close"
          disabled={busy}
          onClick={() => dialogRef.current?.close()}
          type="button"
        >
          ×
        </button>
      </div>

      {error ? <InlineNotice role="alert" title="保存できません" tone="danger">{error}</InlineNotice> : null}
      {confirmingDelete ? (
        <InlineNotice
          actions={
            <>
              <ActionButton disabled={deleting} onClick={() => setConfirmingDelete(false)} type="button" variant="secondary">削除をやめる</ActionButton>
              <ActionButton loading={deleting} onClick={() => void handleDelete()} type="button" variant="danger">勤務予定を削除する</ActionButton>
            </>
          }
          role="alert"
          title="この勤務予定を削除しますか"
          tone="warning"
        >
          {row.user.displayName}の{formatWorkDate(workDate)}の予定を削除します。この操作は監査ログに記録されます。
        </InlineNotice>
      ) : null}

      <form className="admin-form-stack" onSubmit={(event) => void handleSubmit(event)}>
        <EditorField error={fieldErrors.siteId} label="勤務場所">
          <select autoFocus onChange={(event) => setSiteId(event.target.value)} value={siteId}>
            <option value="">選択してください</option>
            {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
          </select>
        </EditorField>
        <div className="admin-form-grid">
          <EditorField error={fieldErrors.scheduledStartAt} label="開始予定">
            <input onChange={(event) => setStartTime(event.target.value)} type="time" value={startTime} />
          </EditorField>
          <EditorField error={fieldErrors.scheduledEndAt} label="終了予定">
            <input onChange={(event) => setEndTime(event.target.value)} type="time" value={endTime} />
          </EditorField>
          <EditorField error={fieldErrors.scheduledBreakMinutes} label="予定休憩（分）">
            <input inputMode="numeric" min="0" onChange={(event) => setBreakMinutes(event.target.value)} step="1" type="number" value={breakMinutes} />
          </EditorField>
        </div>
        <label className="admin-field admin-field--stacked">
          <span>備考 <small>任意</small></span>
          <textarea maxLength={500} onChange={(event) => setNote(event.target.value)} rows={3} value={note} />
        </label>
        <p className="admin-form-help">保存・更新・削除は、変更者と変更前後の内容とともに監査ログへ記録されます。</p>
        <div className="admin-modal__actions admin-modal__actions--schedule">
          {schedule ? (
            <ActionButton disabled={busy || confirmingDelete} onClick={() => setConfirmingDelete(true)} type="button" variant="danger">削除する</ActionButton>
          ) : null}
          <ActionButton disabled={busy} onClick={() => dialogRef.current?.close()} type="button" variant="secondary">閉じる</ActionButton>
          <ActionButton disabled={confirmingDelete} loading={saving} type="submit">{schedule ? "変更を保存する" : "勤務予定を登録する"}</ActionButton>
        </div>
      </form>
    </dialog>
  );
}

function normalizeFieldErrors(
  errors: Record<string, string | string[]>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(errors).map(([field, message]) => [
      field,
      Array.isArray(message) ? message[0] ?? "入力内容を確認してください。" : message,
    ]),
  );
}

function EditorField({
  children,
  error,
  label,
}: {
  children: ReactNode;
  error?: string;
  label: string;
}) {
  return (
    <label className="admin-field admin-field--stacked">
      <span>{label}</span>
      {children}
      {error ? <span className="admin-field-error">{error}</span> : null}
    </label>
  );
}
