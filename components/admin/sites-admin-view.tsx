"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getAdminSiteAttendance,
  type AdminSiteAttendanceData,
} from "../../lib/client/admin-api";
import { currentJstWorkDate, formatWorkDate } from "../../lib/client/date";
import { useLatestRequestGate } from "../../lib/client/latest-request";
import { ActionButton, EmptyState, InlineNotice, LoadingPanel } from "../shared/ui";
import {
  AdminFilterBar,
  AdminPageHeader,
  AttendanceResults,
  ResultSummary,
} from "./admin-shared";

export function SitesAdminView() {
  const [workDate, setWorkDate] = useState(currentJstWorkDate);
  const [siteId, setSiteId] = useState("");
  const [data, setData] = useState<AdminSiteAttendanceData | null>(null);
  const [sites, setSites] = useState<AdminSiteAttendanceData["sites"]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const beginRequest = useLatestRequestGate();

  const load = useCallback(async (date: string, selectedSiteId: string) => {
    const isLatest = beginRequest();
    setLoading(true);
    setError(null);
    setData((current) =>
      current?.workDate === date && (current.siteId ?? "") === selectedSiteId
        ? current
        : null,
    );
    try {
      const result = await getAdminSiteAttendance(date, selectedSiteId || undefined);
      if (isLatest()) {
        setData(result);
        setSites(result.sites);
      }
    } catch (loadError) {
      if (!isLatest()) return;
      setError(
        loadError instanceof Error
          ? loadError.message
          : "現場別の勤怠を読み込めませんでした。",
      );
    } finally {
      if (isLatest()) setLoading(false);
    }
  }, [beginRequest]);

  useEffect(() => {
    void load(workDate, siteId);
  }, [load, siteId, workDate]);

  const selectedSiteName = useMemo(
    () => sites.find((site) => site.id === siteId)?.name ?? "すべての現場",
    [siteId, sites],
  );

  return (
    <div className="admin-page">
      <AdminPageHeader
        description="日付と現場を指定し、同じ現場で働く従業員の状況を比較します。"
        eyebrow="配置確認"
        title="現場別の勤怠"
      >
        <ActionButton
          icon="refresh"
          loading={loading && data !== null}
          onClick={() => void load(workDate, siteId)}
          variant="secondary"
        >
          更新する
        </ActionButton>
      </AdminPageHeader>

      <AdminFilterBar>
        <label className="admin-field">
          <span>対象日</span>
          <input
            onChange={(event) => setWorkDate(event.target.value)}
            type="date"
            value={workDate}
          />
        </label>
        <label className="admin-field admin-field--wide">
          <span>現場</span>
          <select onChange={(event) => setSiteId(event.target.value)} value={siteId}>
            <option value="">すべての現場</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>{site.name}</option>
            ))}
          </select>
        </label>
      </AdminFilterBar>

      {error ? (
        <InlineNotice
          actions={
            <ActionButton onClick={() => void load(workDate, siteId)} variant="secondary">
              再試行する
            </ActionButton>
          }
          role="alert"
          title="現場別一覧を表示できません"
          tone="danger"
        >
          {error}
        </InlineNotice>
      ) : null}

      {loading && !data ? (
        <LoadingPanel label="現場別の勤怠を読み込んでいます" />
      ) : data ? (
        <section aria-busy={loading} aria-labelledby="site-results-title">
          <ResultSummary>
            <span id="site-results-title">{selectedSiteName}</span>・{formatWorkDate(data.workDate)}・{data.rows.length}名
          </ResultSummary>
          {data.rows.length === 0 ? (
            <EmptyState
              message="指定した日付と現場に該当する勤務予定はありません。"
              title="該当する従業員がいません"
            />
          ) : (
            <AttendanceResults rows={data.rows} showSite={!siteId} />
          )}
        </section>
      ) : null}
    </div>
  );
}
