"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../../lib/client/api";
import {
  getAdminRequests,
  reviewAdminRequest,
} from "../../lib/client/admin-api";
import { formatJstDateTime, formatWorkDate } from "../../lib/client/date";
import {
  createIdempotencyKeyTracker,
  type IdempotencyKeyTracker,
} from "../../lib/client/id";
import { useLatestRequestGate } from "../../lib/client/latest-request";
import type {
  AttendanceRequestStatus,
  AttendanceRequestSummary,
} from "../../lib/contracts/types";
import { ActionButton, EmptyState, InlineNotice, LoadingPanel, StatusChip } from "../shared/ui";
import {
  AdminFilterBar,
  AdminPageHeader,
  ResultSummary,
  categoryLabels,
  requestStatusLabels,
  requestStatusTones,
} from "./admin-shared";

type ReviewDecision = "approve" | "reject";

interface ReviewTarget {
  request: AttendanceRequestSummary;
  decision: ReviewDecision;
  keyTracker: IdempotencyKeyTracker;
}

const statusOptions: Array<{ value: AttendanceRequestStatus | "all"; label: string }> = [
  { value: "pending", label: "申請中" },
  { value: "approved", label: "承認済み" },
  { value: "rejected", label: "却下" },
  { value: "withdrawn", label: "取消済み" },
  { value: "all", label: "すべて" },
];

export function RequestsAdminView() {
  const reviewDialogRef = useRef<HTMLDialogElement>(null);
  const beginRequest = useLatestRequestGate();
  const [requests, setRequests] = useState<AttendanceRequestSummary[]>([]);
  const [status, setStatus] = useState<AttendanceRequestStatus | "all">("pending");
  const [month, setMonth] = useState("");
  const [userId, setUserId] = useState("");
  const [reviewTarget, setReviewTarget] = useState<ReviewTarget | null>(null);
  const [reviewComment, setReviewComment] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflictUserId, setConflictUserId] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async (): Promise<boolean> => {
    const isLatest = beginRequest();
    setLoading(true);
    setError(null);
    try {
      const nextRequests = await getAdminRequests();
      if (!isLatest()) return false;
      setRequests(nextRequests);
      return true;
    } catch (loadError) {
      if (!isLatest()) return false;
      setError(
        loadError instanceof Error
          ? loadError.message
          : "申請一覧を読み込めませんでした。",
      );
      return false;
    } finally {
      if (isLatest()) setLoading(false);
    }
  }, [beginRequest]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (reviewTarget && !reviewDialogRef.current?.open) {
      reviewDialogRef.current?.showModal();
    }
  }, [reviewTarget]);

  const employees = useMemo(() => {
    const byId = new Map<string, string>();
    for (const request of requests) {
      byId.set(request.userId, request.userDisplayName ?? "名前未設定");
    }
    return [...byId].sort((left, right) => left[1].localeCompare(right[1], "ja"));
  }, [requests]);

  const filteredRequests = useMemo(
    () =>
      requests.filter((request) => {
        if (status !== "all" && request.status !== status) return false;
        if (month && !request.workDate.startsWith(`${month}-`)) return false;
        if (userId && request.userId !== userId) return false;
        return true;
      }),
    [month, requests, status, userId],
  );

  const openReview = (request: AttendanceRequestSummary, decision: ReviewDecision) => {
    setReviewComment("");
    setError(null);
    setConflictUserId(null);
    setSuccess(null);
    setReviewTarget({
      request,
      decision,
      keyTracker: createIdempotencyKeyTracker(),
    });
  };

  const submitReview = async () => {
    if (!reviewTarget) return;
    setSubmitting(true);
    setError(null);
    setConflictUserId(null);
    try {
      const payload = {
        decision: reviewTarget.decision,
        reviewComment: reviewComment.trim() || null,
        version: reviewTarget.request.version,
      };
      const updated = await reviewAdminRequest(reviewTarget.request.id, {
        ...payload,
        clientRequestId: reviewTarget.keyTracker.keyForPayload(payload),
      });
      setRequests((current) =>
        current.map((request) => request.id === updated.id ? updated : request),
      );
      setSuccess(
        `${reviewTarget.request.userDisplayName ?? "従業員"}さんの${categoryLabels[reviewTarget.request.requestedCategory]}申請を${reviewTarget.decision === "approve" ? "承認" : "却下"}しました。`,
      );
      setReviewTarget(null);
      void load();
    } catch (reviewError) {
      if (
        reviewError instanceof ApiError &&
        reviewError.code === "APPROVAL_PUNCH_CONFLICT"
      ) {
        setError(reviewError.message);
        setConflictUserId(reviewTarget.request.userId);
      } else if (
        reviewError instanceof ApiError &&
        reviewError.status === 409 &&
        (reviewError.code === "VERSION_CONFLICT" ||
          reviewError.code === "REQUEST_STATE_CHANGED")
      ) {
        setReviewTarget(null);
        if (await load()) {
          setSuccess(
            "申請の状態が更新されていたため、最新の一覧を読み込みました。",
          );
        }
      } else {
        setError(
          reviewError instanceof Error
            ? reviewError.message
            : "申請を処理できませんでした。",
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="admin-page">
      <AdminPageHeader
        description="休暇・欠勤申請を確認し、単段階で承認または却下します。"
        eyebrow="申請処理"
        title="申請一覧"
      >
        <ActionButton icon="refresh" loading={loading} onClick={() => void load()} variant="secondary">
          更新する
        </ActionButton>
      </AdminPageHeader>

      <AdminFilterBar>
        <label className="admin-field">
          <span>状態</span>
          <select value={status} onChange={(event) => setStatus(event.target.value as AttendanceRequestStatus | "all")}>
            {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="admin-field">
          <span>対象月</span>
          <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
        </label>
        <label className="admin-field admin-field--wide">
          <span>従業員</span>
          <select value={userId} onChange={(event) => setUserId(event.target.value)}>
            <option value="">すべての従業員</option>
            {employees.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
      </AdminFilterBar>

      {success ? <InlineNotice title="申請を処理しました" tone="success">{success}</InlineNotice> : null}
      {error ? (
        <InlineNotice
          actions={conflictUserId ? (
            <Link href={`/admin/users/${encodeURIComponent(conflictUserId)}?month=${reviewTarget?.request.workDate.slice(0, 7) ?? ""}`}>個人実績で競合を確認する</Link>
          ) : (
            <ActionButton onClick={() => void load()} variant="secondary">再試行する</ActionButton>
          )}
          role="alert"
          title={conflictUserId ? "打刻実績と競合しています" : "申請を処理できません"}
          tone="danger"
        >
          {error}
        </InlineNotice>
      ) : null}

      {loading && requests.length === 0 ? (
        <LoadingPanel label="申請を読み込んでいます" />
      ) : (
        <section aria-busy={loading} aria-labelledby="request-results-title">
          <ResultSummary><span id="request-results-title">表示中</span>・{filteredRequests.length}件</ResultSummary>
          {filteredRequests.length === 0 ? (
            <EmptyState
              message="選択中の条件に一致する申請はありません。"
              title="申請がありません"
            />
          ) : (
            <RequestResults requests={filteredRequests} onReview={openReview} />
          )}
        </section>
      )}

      {reviewTarget ? (
          <dialog
            aria-labelledby="review-dialog-title"
            className="admin-modal"
            onCancel={(event) => {
              if (submitting) event.preventDefault();
            }}
            onClose={() => setReviewTarget(null)}
            ref={reviewDialogRef}
          >
            <div className="admin-modal__heading">
              <div>
                <p className="admin-eyebrow">{reviewTarget.decision === "approve" ? "承認" : "却下"}</p>
                <h2 id="review-dialog-title">
                  {reviewTarget.request.userDisplayName ?? "従業員"}さんの申請
                </h2>
              </div>
              <button aria-label="閉じる" className="admin-modal__close" disabled={submitting} onClick={() => reviewDialogRef.current?.close()} type="button">×</button>
            </div>
            <dl className="admin-review-summary">
              <div><dt>対象日</dt><dd>{formatWorkDate(reviewTarget.request.workDate)}</dd></div>
              <div><dt>区分</dt><dd>{categoryLabels[reviewTarget.request.requestedCategory]}</dd></div>
              <div><dt>申請理由</dt><dd>{reviewTarget.request.reason || "—"}</dd></div>
            </dl>
            {error ? (
              <InlineNotice
                actions={conflictUserId ? <Link href={`/admin/users/${encodeURIComponent(conflictUserId)}?month=${reviewTarget.request.workDate.slice(0, 7)}`}>個人実績で競合を確認する</Link> : undefined}
                role="alert"
                title={conflictUserId ? "打刻実績と競合しています" : "申請を処理できません"}
                tone="danger"
              >
                {error}
              </InlineNotice>
            ) : null}
            <label className="admin-field admin-field--stacked">
              <span>審査コメント <small>任意</small></span>
              <textarea
                autoFocus
                onChange={(event) => setReviewComment(event.target.value)}
                placeholder="申請者への補足を入力できます"
                rows={4}
                value={reviewComment}
              />
            </label>
            <div className="admin-modal__actions">
              <ActionButton disabled={submitting} onClick={() => reviewDialogRef.current?.close()} variant="secondary">戻る</ActionButton>
              <ActionButton
                loading={submitting}
                onClick={() => void submitReview()}
                variant={reviewTarget.decision === "approve" ? "primary" : "danger"}
              >
                {reviewTarget.decision === "approve" ? "申請を承認する" : "申請を却下する"}
              </ActionButton>
            </div>
          </dialog>
      ) : null}
    </div>
  );
}

function RequestResults({
  onReview,
  requests,
}: {
  onReview: (request: AttendanceRequestSummary, decision: ReviewDecision) => void;
  requests: AttendanceRequestSummary[];
}) {
  return (
    <div className="admin-results-panel">
      <div className="admin-table-wrap">
        <table className="admin-table admin-request-table">
          <thead><tr><th>申請者</th><th>対象日</th><th>区分・理由</th><th>申請日時</th><th>状態</th><th>操作</th></tr></thead>
          <tbody>
            {requests.map((request) => (
              <tr key={request.id}>
                <td><strong>{request.userDisplayName ?? "名前未設定"}</strong></td>
                <td>{formatWorkDate(request.workDate)}</td>
                <td><strong>{categoryLabels[request.requestedCategory]}</strong><small>{request.reason || "理由なし"}</small></td>
                <td>{formatJstDateTime(request.requestedAt)}</td>
                <td><StatusChip tone={requestStatusTones[request.status]}>{requestStatusLabels[request.status]}</StatusChip></td>
                <td>
                  {request.status === "pending" ? (
                    <div className="admin-inline-actions">
                      <button className="admin-action-link" onClick={() => onReview(request, "approve")} type="button">承認</button>
                      <button className="admin-action-link admin-action-link--danger" onClick={() => onReview(request, "reject")} type="button">却下</button>
                    </div>
                  ) : <span>処理済み</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="admin-card-list">
        {requests.map((request) => (
          <article className="admin-result-card" key={request.id}>
            <div className="admin-result-card__heading">
              <div><h2>{request.userDisplayName ?? "名前未設定"}</h2><p>{formatWorkDate(request.workDate)}</p></div>
              <StatusChip tone={requestStatusTones[request.status]}>{requestStatusLabels[request.status]}</StatusChip>
            </div>
            <dl className="admin-result-card__facts">
              <div><dt>区分</dt><dd>{categoryLabels[request.requestedCategory]}</dd></div>
              <div><dt>理由</dt><dd>{request.reason || "—"}</dd></div>
              <div><dt>申請日時</dt><dd>{formatJstDateTime(request.requestedAt)}</dd></div>
            </dl>
            {request.status === "pending" ? (
              <div className="admin-result-card__actions">
                <ActionButton onClick={() => onReview(request, "approve")}>承認する</ActionButton>
                <ActionButton onClick={() => onReview(request, "reject")} variant="danger">却下する</ActionButton>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}
