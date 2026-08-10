"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { FormEvent } from "react";
import type {
  AttendanceRequestStatus,
  AttendanceRequestSummary,
} from "../../lib/contracts/types";
import {
  ApiError,
  createRequest,
  getRequests,
  withdrawRequest,
} from "../../lib/client/api";
import {
  currentJstWorkDate,
  formatJstDateTime,
  formatWorkDate,
} from "../../lib/client/date";
import {
  createClientRequestId,
  createIdempotencyKeyTracker,
} from "../../lib/client/id";
import { AppIcon } from "../shared/icons";
import {
  ActionButton,
  EmptyState,
  InlineNotice,
  LoadingPanel,
  StatusChip,
  type StatusTone,
} from "../shared/ui";

type RequestCategory = AttendanceRequestSummary["requestedCategory"];

const categories: { value: RequestCategory; label: string; help: string }[] = [
  { value: "paid_leave", label: "有休", help: "年次有給休暇を取得する日" },
  { value: "absence", label: "欠勤", help: "勤務予定日に欠勤する日" },
  { value: "sick_leave", label: "病欠", help: "体調不良により休む日" },
  { value: "other", label: "その他", help: "上記以外の非勤務申請" },
];

const categoryLabels: Record<RequestCategory, string> = {
  paid_leave: "有休",
  absence: "欠勤",
  sick_leave: "病欠",
  other: "その他",
};

const statusPresentation: Record<
  AttendanceRequestStatus,
  { label: string; tone: StatusTone }
> = {
  pending: { label: "申請中", tone: "warning" },
  approved: { label: "承認済み", tone: "success" },
  rejected: { label: "却下", tone: "danger" },
  withdrawn: { label: "取消済み", tone: "neutral" },
};

function RequestFormDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (request: AttendanceRequestSummary) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const dateId = useId();
  const reasonId = useId();
  const [workDate, setWorkDate] = useState(currentJstWorkDate());
  const [category, setCategory] = useState<RequestCategory>("paid_leave");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | string[]>>({});
  const [keyTracker] = useState(createIdempotencyKeyTracker);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!workDate) {
      setError("対象日を選んでください。");
      return;
    }
    if (!reason.trim()) {
      setFieldErrors({ reason: "理由・備考を入力してください。" });
      setError("入力内容を確認してください。");
      return;
    }

    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    try {
      const payload = {
        workDate,
        requestedCategory: category,
        reason: reason.trim(),
      };
      const created = await createRequest({
        ...payload,
        clientRequestId: keyTracker.keyForPayload(payload),
      });
      onCreated(created);
      dialogRef.current?.close();
    } catch (createError) {
      if (createError instanceof ApiError) {
        setError(createError.message);
        setFieldErrors(createError.fieldErrors);
      } else {
        setError("申請を保存できませんでした。");
      }
      setSubmitting(false);
    }
  };

  const dateError = fieldErrors.workDate;
  const reasonError = fieldErrors.reason;

  return (
    <dialog
      aria-labelledby={titleId}
      className="sheet-dialog request-dialog"
      onClose={onClose}
      ref={dialogRef}
    >
      <div className="sheet-dialog__handle" aria-hidden="true" />
      <div className="sheet-dialog__header">
        <div>
          <p className="eyebrow">新しい申請</p>
          <h2 id={titleId}>休暇・欠勤を申請する</h2>
        </div>
        <button
          aria-label="申請フォームを閉じる"
          className="icon-button"
          onClick={() => dialogRef.current?.close()}
          type="button"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>

      <InlineNotice title="承認までは通常どおり打刻できます" tone="info">
        管理者が承認すると対象日の勤怠区分へ反映されます。
      </InlineNotice>

      {error ? (
        <InlineNotice role="alert" title="申請を保存できません" tone="danger">
          {error}
        </InlineNotice>
      ) : null}

      <form className="form-stack" onSubmit={(event) => void handleSubmit(event)}>
        <div className="field">
          <label htmlFor={dateId}>対象日 <span>必須</span></label>
          <input
            aria-describedby={dateError ? `${dateId}-error` : undefined}
            aria-invalid={Boolean(dateError)}
            id={dateId}
            onChange={(event) => setWorkDate(event.target.value)}
            required
            type="date"
            value={workDate}
          />
          {dateError ? (
            <p className="field-error" id={`${dateId}-error`}>
              {Array.isArray(dateError) ? dateError[0] : dateError}
            </p>
          ) : null}
        </div>

        <fieldset className="category-fieldset">
          <legend>申請区分 <span>必須</span></legend>
          <div className="category-options">
            {categories.map((item) => (
              <label className="category-option" key={item.value}>
                <input
                  checked={category === item.value}
                  name="requestedCategory"
                  onChange={() => setCategory(item.value)}
                  type="radio"
                  value={item.value}
                />
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.help}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="field">
          <label htmlFor={reasonId}>理由・備考 <span>必須</span></label>
          <textarea
            aria-describedby={reasonError ? `${reasonId}-error` : `${reasonId}-help`}
            aria-invalid={Boolean(reasonError)}
            id={reasonId}
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
            placeholder="例: 通院のため"
            required
            rows={4}
            value={reason}
          />
          {reasonError ? (
            <p className="field-error" id={`${reasonId}-error`}>
              {Array.isArray(reasonError) ? reasonError[0] : reasonError}
            </p>
          ) : (
            <p className="field-help" id={`${reasonId}-help`}>管理者が確認する内容です。</p>
          )}
        </div>

        <div className="sheet-dialog__actions">
          <ActionButton onClick={() => dialogRef.current?.close()} type="button" variant="secondary">
            閉じる
          </ActionButton>
          <ActionButton loading={submitting} type="submit">
            {submitting ? "申請しています" : "この内容で申請する"}
          </ActionButton>
        </div>
      </form>
    </dialog>
  );
}

function WithdrawDialog({
  request,
  onClose,
  onConflict,
  onWithdrawn,
}: {
  request: AttendanceRequestSummary;
  onClose: () => void;
  onConflict: () => Promise<void>;
  onWithdrawn: (request: AttendanceRequestSummary) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientRequestId] = useState(createClientRequestId);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const handleWithdraw = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const updated = await withdrawRequest(
        request.id,
        request.version,
        clientRequestId,
      );
      onWithdrawn(updated);
      dialogRef.current?.close();
    } catch (withdrawError) {
      if (withdrawError instanceof ApiError && withdrawError.status === 409) {
        await onConflict();
        return;
      }
      setError(
        withdrawError instanceof Error
          ? withdrawError.message
          : "申請を取り消せませんでした。",
      );
      setSubmitting(false);
    }
  };

  return (
    <dialog
      aria-labelledby={titleId}
      className="confirm-dialog"
      onClose={onClose}
      ref={dialogRef}
    >
      <div className="confirm-dialog__icon" aria-hidden="true">
        <AppIcon name="alert" />
      </div>
      <h2 id={titleId}>この申請を取り消しますか</h2>
      <p>
        {formatWorkDate(request.workDate)}の
        {categoryLabels[request.requestedCategory]}申請を取り消します。
      </p>
      {error ? (
        <InlineNotice role="alert" title="取り消せませんでした" tone="danger">
          {error}
        </InlineNotice>
      ) : null}
      <div className="confirm-dialog__actions">
        <ActionButton onClick={() => dialogRef.current?.close()} type="button" variant="secondary">
          戻る
        </ActionButton>
        <ActionButton loading={submitting} onClick={() => void handleWithdraw()} type="button" variant="danger">
          {submitting ? "取り消しています" : "申請を取り消す"}
        </ActionButton>
      </div>
    </dialog>
  );
}

export function RequestsView() {
  const [requests, setRequests] = useState<AttendanceRequestSummary[]>([]);
  const [filter, setFilter] = useState<AttendanceRequestStatus | "all">("all");
  const [showForm, setShowForm] = useState(false);
  const [withdrawing, setWithdrawing] = useState<AttendanceRequestSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadRequests = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getRequests();
      setRequests(result);
      return true;
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "申請を読み込めませんでした。",
      );
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  const handleCreated = (request: AttendanceRequestSummary) => {
    setRequests((current) => [request, ...current]);
    setSuccess(`${formatWorkDate(request.workDate)}の${categoryLabels[request.requestedCategory]}を申請しました。`);
  };

  const handleWithdrawn = (request: AttendanceRequestSummary) => {
    setRequests((current) =>
      current.map((item) => (item.id === request.id ? request : item)),
    );
    setSuccess(`${formatWorkDate(request.workDate)}の申請を取り消しました。`);
  };

  const handleWithdrawConflict = async () => {
    setWithdrawing(null);
    if (await loadRequests()) {
      setSuccess("申請の状態が更新されていたため、最新の内容を読み込みました。");
    }
  };

  const visibleRequests = requests.filter(
    (request) => filter === "all" || request.status === filter,
  );

  return (
    <div className="requests-page">
      <header className="page-heading page-heading--with-action">
        <div>
          <p className="eyebrow">休暇・欠勤</p>
          <h1>申請</h1>
          <p>申請状況の確認と、申請中データの取消ができます。</p>
        </div>
        <ActionButton icon="requests" onClick={() => setShowForm(true)}>
          新しく申請する
        </ActionButton>
      </header>

      {error ? (
        <InlineNotice
          actions={<button className="text-button" onClick={() => void loadRequests()} type="button">再試行する</button>}
          role="alert"
          title="申請を表示できません"
          tone="danger"
        >
          {error}
        </InlineNotice>
      ) : null}
      {success ? (
        <InlineNotice title="処理が完了しました" tone="success">{success}</InlineNotice>
      ) : null}

      <div className="request-toolbar">
        <label htmlFor="request-status-filter">表示する状態</label>
        <select
          id="request-status-filter"
          onChange={(event) => setFilter(event.target.value as AttendanceRequestStatus | "all")}
          value={filter}
        >
          <option value="all">すべて</option>
          <option value="pending">申請中</option>
          <option value="approved">承認済み</option>
          <option value="rejected">却下</option>
          <option value="withdrawn">取消済み</option>
        </select>
      </div>

      {loading ? (
        <LoadingPanel label="申請状況を読み込んでいます" />
      ) : visibleRequests.length === 0 ? (
        <EmptyState
          action={<ActionButton onClick={() => setShowForm(true)} variant="secondary">新しく申請する</ActionButton>}
          message={filter === "all" ? "まだ申請はありません。必要な日があれば新しく申請できます。" : "選択した状態の申請はありません。"}
          title="表示する申請がありません"
        />
      ) : (
        <div className="request-list" aria-label="自分の申請一覧">
          {visibleRequests.map((request) => {
            const status = statusPresentation[request.status];
            return (
              <article className="request-card" key={request.id}>
                <div className="request-card__heading">
                  <div>
                    <time dateTime={request.workDate}>{formatWorkDate(request.workDate)}</time>
                    <h2>{categoryLabels[request.requestedCategory]}</h2>
                  </div>
                  <StatusChip tone={status.tone}>{status.label}</StatusChip>
                </div>
                <dl className="request-card__details">
                  <div><dt>理由・備考</dt><dd>{request.reason}</dd></div>
                  <div><dt>申請日時</dt><dd>{formatJstDateTime(request.requestedAt)}</dd></div>
                  {request.reviewedAt ? <div><dt>処理日時</dt><dd>{formatJstDateTime(request.reviewedAt)}</dd></div> : null}
                  {request.reviewComment ? <div><dt>管理者コメント</dt><dd>{request.reviewComment}</dd></div> : null}
                </dl>
                {request.status === "pending" ? (
                  <button className="request-card__withdraw" onClick={() => setWithdrawing(request)} type="button">
                    申請を取り消す
                  </button>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      {showForm ? (
        <RequestFormDialog onClose={() => setShowForm(false)} onCreated={handleCreated} />
      ) : null}
      {withdrawing ? (
        <WithdrawDialog
          onClose={() => setWithdrawing(null)}
          onConflict={handleWithdrawConflict}
          onWithdrawn={handleWithdrawn}
          request={withdrawing}
        />
      ) : null}
    </div>
  );
}
