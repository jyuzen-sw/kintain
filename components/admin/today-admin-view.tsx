"use client";

import { useCallback, useEffect, useState } from "react";
import { currentJstWorkDate, formatWorkDate } from "../../lib/client/date";
import { useLatestRequestGate } from "../../lib/client/latest-request";
import {
  getAdminToday,
  type AdminTodayData,
} from "../../lib/client/admin-api";
import type { AdminAttendanceRow } from "../../lib/contracts/types";
import { ActionButton, EmptyState, InlineNotice, LoadingPanel } from "../shared/ui";
import {
  AdminFilterBar,
  AdminPageHeader,
  AttendanceResults,
  ResultSummary,
} from "./admin-shared";
import {
  WorkScheduleEditor,
  type WorkScheduleSavedAction,
} from "./work-schedule-editor";

interface SuccessNotice {
  title: string;
  message: string;
}

export function TodayAdminView() {
  const [workDate, setWorkDate] = useState(currentJstWorkDate);
  const [data, setData] = useState<AdminTodayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessNotice | null>(null);
  const [editingRow, setEditingRow] = useState<AdminAttendanceRow | null>(null);
  const beginRequest = useLatestRequestGate();

  const load = useCallback(async (date: string) => {
    const isLatest = beginRequest();
    setLoading(true);
    setError(null);
    setData((current) => current?.workDate === date ? current : null);
    try {
      const result = await getAdminToday(date);
      if (isLatest()) setData(result);
    } catch (loadError) {
      if (!isLatest()) return;
      setError(
        loadError instanceof Error
          ? loadError.message
          : "当日の勤怠一覧を読み込めませんでした。",
      );
    } finally {
      if (isLatest()) setLoading(false);
    }
  }, [beginRequest]);

  useEffect(() => {
    void load(workDate);
  }, [load, workDate]);

  useEffect(() => {
    if (window.sessionStorage.getItem("kintain_demo_reset_succeeded") !== "true") return;
    window.sessionStorage.removeItem("kintain_demo_reset_succeeded");
    setSuccess({
      title: "初期状態へ戻しました",
      message: "デモデータを初期状態へ戻しました。",
    });
  }, []);

  const handleScheduleSaved = (
    action: WorkScheduleSavedAction,
    row: AdminAttendanceRow,
    date: string,
  ) => {
    const actionLabel = action === "created" ? "登録" : action === "updated" ? "更新" : "削除";
    setEditingRow(null);
    setOperationError(null);
    setSuccess({
      title: `勤務予定を${actionLabel}しました`,
      message: `${row.user.displayName}の${formatWorkDate(date)}の勤務予定を${actionLabel}し、監査ログへ記録しました。`,
    });
    void load(date);
  };

  return (
    <div className="admin-page">
      <AdminPageHeader
        description="予定と実績を並べて、未打刻や勤務中の状況を確認します。"
        eyebrow="日次確認"
        title="当日の勤怠"
      >
        <ActionButton
          icon="refresh"
          loading={loading && data !== null}
          onClick={() => {
            setOperationError(null);
            void load(workDate);
          }}
          variant="secondary"
        >
          更新する
        </ActionButton>
      </AdminPageHeader>

      <AdminFilterBar>
        <label className="admin-field">
          <span>対象日</span>
          <input
            onChange={(event) => {
              setEditingRow(null);
              setOperationError(null);
              setSuccess(null);
              setWorkDate(event.target.value);
            }}
            type="date"
            value={workDate}
          />
        </label>
      </AdminFilterBar>

      {error ? (
        <InlineNotice
          actions={
            <ActionButton onClick={() => void load(workDate)} variant="secondary">
              再試行する
            </ActionButton>
          }
          role="alert"
          title="勤怠一覧を表示できません"
          tone="danger"
        >
          {error}
        </InlineNotice>
      ) : null}
      {operationError ? (
        <InlineNotice role="alert" title="勤務予定を変更できません" tone="danger">
          {operationError}
        </InlineNotice>
      ) : null}
      {success ? <InlineNotice title={success.title} tone="success">{success.message}</InlineNotice> : null}

      {loading && !data ? (
        <LoadingPanel label="当日の勤怠を読み込んでいます" />
      ) : data ? (
        <section aria-busy={loading} aria-labelledby="today-results-title">
          <ResultSummary>
            <span id="today-results-title">{formatWorkDate(data.workDate)}</span>・{data.rows.length}名
          </ResultSummary>
          {data.rows.length === 0 ? (
            <EmptyState
              message="対象日に表示できる従業員または勤務予定がありません。"
              title="勤怠データがありません"
            />
          ) : (
            <AttendanceResults onEditSchedule={setEditingRow} rows={data.rows} />
          )}
        </section>
      ) : null}

      {editingRow && data ? (
        <WorkScheduleEditor
          onClose={() => setEditingRow(null)}
          onConflict={(message) => {
            setEditingRow(null);
            setSuccess(null);
            setOperationError(message);
            void load(data.workDate);
          }}
          onSaved={(action) => handleScheduleSaved(action, editingRow, data.workDate)}
          row={editingRow}
          sites={data.sites}
          workDate={data.workDate}
        />
      ) : null}
    </div>
  );
}
