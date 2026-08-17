"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { getAdminAuditLogs } from "../../lib/client/admin-api";
import { formatJstDateTime } from "../../lib/client/date";
import { useLatestRequestGate } from "../../lib/client/latest-request";
import type { AuditLogSummary } from "../../lib/contracts/types";
import { ActionButton, EmptyState, InlineNotice, LoadingPanel } from "../shared/ui";
import { AdminFilterBar, AdminPageHeader, ResultSummary } from "./admin-shared";
import { buildAuditDifferences } from "./audit-utils";

type AuditEntityFilter =
  | "all"
  | "attendance_record"
  | "attendance_request"
  | "work_schedule";

const actionLabels: Readonly<Record<string, string>> = {
  create: "作成",
  update: "修正",
  approve: "承認",
  reject: "却下",
  withdraw: "取消",
  delete: "削除",
};

const entityLabels: Readonly<Record<string, string>> = {
  attendance_record: "勤怠実績",
  attendance_request: "申請",
  work_schedule: "勤務予定",
};

export function AuditAdminView() {
  const searchParams = useSearchParams();
  const rawEntityType = searchParams.get("entityType");
  const queryEntityType = rawEntityType === "attendance_record"
    || rawEntityType === "attendance_request"
    || rawEntityType === "work_schedule"
    ? rawEntityType
    : undefined;
  const entityId = searchParams.get("entityId")?.trim() ?? "";
  const [logs, setLogs] = useState<AuditLogSummary[]>([]);
  const [entityType, setEntityType] = useState<AuditEntityFilter>(
    queryEntityType ?? "all",
  );
  const [limit, setLimit] = useState(100);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const beginRequest = useLatestRequestGate();

  const load = useCallback(async () => {
    const isLatest = beginRequest();
    setLoading(true);
    setError(null);
    setLogs([]);
    try {
      const result = await getAdminAuditLogs({
        limit,
        entityType: entityId
          ? queryEntityType
          : entityType === "all"
            ? undefined
            : entityType,
        entityId: entityId || undefined,
      });
      if (isLatest()) setLogs(result);
    } catch (loadError) {
      if (!isLatest()) return;
      setError(
        loadError instanceof Error
          ? loadError.message
          : "監査ログを読み込めませんでした。",
      );
    } finally {
      if (isLatest()) setLoading(false);
    }
  }, [beginRequest, entityId, entityType, limit, queryEntityType]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setEntityType(queryEntityType ?? "all");
  }, [entityId, queryEntityType]);

  const subjectName = logs[0]?.subjectDisplayName;

  return (
    <div className="admin-page">
      <AdminPageHeader
        description="勤務予定、実績修正、申請処理について、変更者と変更前後を確認します。"
        eyebrow="追跡と説明責任"
        title="監査ログ"
      >
        <ActionButton icon="refresh" loading={loading} onClick={() => void load()} variant="secondary">更新する</ActionButton>
      </AdminPageHeader>

      <AdminFilterBar>
        <label className="admin-field admin-field--wide">
          <span>対象</span>
          <select disabled={Boolean(entityId)} onChange={(event) => setEntityType(event.target.value as AuditEntityFilter)} value={entityType}>
            <option value="all">すべての変更</option>
            <option value="attendance_record">実績修正</option>
            <option value="attendance_request">申請処理</option>
            <option value="work_schedule">勤務予定</option>
          </select>
        </label>
        <label className="admin-field">
          <span>取得件数</span>
          <select onChange={(event) => setLimit(Number(event.target.value))} value={limit}>
            <option value={50}>50件</option>
            <option value={100}>100件</option>
            <option value={200}>200件</option>
          </select>
        </label>
        {entityId ? (
          <div className="admin-active-filter">
            <span>{subjectName ? `${subjectName}の変更` : "対象の変更"}に絞り込み中</span>
            <Link href="/admin/audit">解除</Link>
          </div>
        ) : null}
      </AdminFilterBar>

      {error ? (
        <InlineNotice actions={<ActionButton onClick={() => void load()} variant="secondary">再試行する</ActionButton>} role="alert" title="監査ログを表示できません" tone="danger">
          {error}
        </InlineNotice>
      ) : null}

      {loading && logs.length === 0 ? (
        <LoadingPanel label="監査ログを読み込んでいます" />
      ) : (
        <section aria-busy={loading}>
          <ResultSummary>{logs.length}件を表示</ResultSummary>
          {logs.length === 0 ? (
            <EmptyState message="選択中の条件に一致する変更履歴はありません。" title="監査ログがありません" />
          ) : (
            <div className="admin-audit-list">
              {logs.map((log) => <AuditEntry key={log.id} log={log} />)}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function AuditEntry({ log }: { log: AuditLogSummary }) {
  const differences = buildAuditDifferences(log);
  return (
    <article className="admin-audit-entry">
      <header className="admin-audit-entry__heading">
        <div>
          <p>{entityLabels[log.entityType] ?? log.entityType}・{actionLabels[log.action] ?? log.action}</p>
          <h2>{log.subjectDisplayName ?? "対象者不明"}</h2>
        </div>
        <time dateTime={log.createdAt}>{formatJstDateTime(log.createdAt)}</time>
      </header>
      <dl className="admin-audit-meta">
        <div><dt>変更者</dt><dd>{log.actorDisplayName}</dd></div>
        <div><dt>理由</dt><dd>{log.reason || "—"}</dd></div>
      </dl>
      {differences.length > 0 ? (
        <div className="admin-audit-diff">
          <div className="admin-audit-diff__head"><span>項目</span><span>変更前</span><span>変更後</span></div>
          {differences.map((difference) => (
            <div className="admin-audit-diff__row" key={difference.field}>
              <strong>{difference.field}</strong><span>{difference.before}</span><span>{difference.after}</span>
            </div>
          ))}
        </div>
      ) : <p className="admin-audit-entry__no-diff">状態変更を記録しました。</p>}
    </article>
  );
}
