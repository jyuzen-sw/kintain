import Link from "next/link";
import type { ReactNode } from "react";
import type {
  AdminAttendanceRow,
  PunchLocationSummary,
} from "../../lib/contracts/types";
import {
  formatJstTime,
  formatMinutes,
  formatWorkDate,
} from "../../lib/client/date";
import { StatusChip } from "../shared/ui";
import {
  attendanceStatusPresentation,
} from "./admin-presentation";

export {
  categoryLabels,
  requestStatusLabels,
  requestStatusTones,
} from "./admin-presentation";

export function AdminPageHeader({
  children,
  description,
  eyebrow,
  title,
}: {
  children?: ReactNode;
  description: string;
  eyebrow?: string;
  title: string;
}) {
  return (
    <header className="admin-page-header">
      <div>
        {eyebrow ? <p className="admin-eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children ? <div className="admin-page-header__actions">{children}</div> : null}
    </header>
  );
}

export function AdminFilterBar({ children }: { children: ReactNode }) {
  return <section className="admin-filter-bar">{children}</section>;
}

export function ResultSummary({ children }: { children: ReactNode }) {
  return (
    <p aria-live="polite" className="admin-result-summary">
      {children}
    </p>
  );
}

export function AttendanceStatus({ row }: { row: AdminAttendanceRow }) {
  const presentation = attendanceStatusPresentation(row);
  return (
    <div className="admin-status-stack">
      <StatusChip tone={presentation.tone}>{presentation.label}</StatusChip>
      {row.request?.status === "pending" ? (
        <StatusChip tone="warning">申請中</StatusChip>
      ) : null}
    </div>
  );
}

function TimePair({ actual, planned }: { actual: string | null; planned: string | null }) {
  return (
    <span className="admin-time-pair">
      <span>{formatJstTime(actual)}</span>
      <small>予定 {formatJstTime(planned)}</small>
    </span>
  );
}

const locationStateLabels: Readonly<Record<PunchLocationSummary["state"], string>> = {
  granted: "取得済み",
  denied: "許可されず",
  unavailable: "取得不可",
  timeout: "タイムアウト",
};

function PunchLocation({
  label,
  location,
}: {
  label: "出勤" | "退勤";
  location: PunchLocationSummary | null | undefined;
}) {
  if (!location) return <div><dt>{label}</dt><dd>記録なし</dd></div>;
  if (location.state !== "granted") {
    return <div><dt>{label}</dt><dd>{locationStateLabels[location.state]}</dd></div>;
  }
  const hasCoordinates =
    typeof location.latitude === "number" && typeof location.longitude === "number";
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <strong>{locationStateLabels.granted}</strong>
        <span>{hasCoordinates ? `${location.latitude?.toFixed(6)}, ${location.longitude?.toFixed(6)}` : "座標なし"}</span>
        <small>精度 {typeof location.accuracyMeters === "number" ? `${Math.round(location.accuracyMeters)}m` : "—"}</small>
      </dd>
    </div>
  );
}

function AttendanceLocations({ row }: { row: AdminAttendanceRow }) {
  const clockIn = row.record?.locations?.clockIn;
  const clockOut = row.record?.locations?.clockOut;
  const hasLocation = clockIn?.state === "granted" || clockOut?.state === "granted";
  return (
    <details className="admin-location-details">
      <summary>
        <StatusChip tone={hasLocation ? "info" : "neutral"}>
          位置情報{hasLocation ? "あり" : "なし"}
        </StatusChip>
      </summary>
      <dl>
        <PunchLocation label="出勤" location={clockIn} />
        <PunchLocation label="退勤" location={clockOut} />
      </dl>
    </details>
  );
}

export function AttendanceResults({
  rows,
  showSite = true,
}: {
  rows: AdminAttendanceRow[];
  showSite?: boolean;
}) {
  return (
    <div className="admin-results-panel admin-attendance-results">
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>名前</th>
              {showSite ? <th>場所</th> : null}
              <th>出勤</th>
              <th>退勤</th>
              <th>休憩</th>
              <th>位置情報</th>
              <th>状態</th>
              <th><span className="sr-only">詳細</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr className={row.state === "invalid" ? "is-danger" : undefined} key={row.user.id}>
                <td>
                  <strong>{row.user.displayName}</strong>
                  {row.user.employeeCode ? <small>{row.user.employeeCode}</small> : null}
                </td>
                {showSite ? <td>{row.schedule?.site.name ?? "—"}</td> : null}
                <td>
                  <TimePair
                    actual={row.record?.clockInAt ?? null}
                    planned={row.schedule?.scheduledStartAt ?? null}
                  />
                </td>
                <td>
                  <TimePair
                    actual={row.record?.clockOutAt ?? null}
                    planned={row.schedule?.scheduledEndAt ?? null}
                  />
                </td>
                <td>
                  <span className="admin-time-pair">
                    <span>{formatMinutes(row.record?.actualBreakMinutes ?? null)}</span>
                    <small>予定 {formatMinutes(row.schedule?.scheduledBreakMinutes ?? null)}</small>
                  </span>
                </td>
                <td><AttendanceLocations row={row} /></td>
                <td><AttendanceStatus row={row} /></td>
                <td>
                  <Link className="admin-row-link" href={`/admin/users/${encodeURIComponent(row.user.id)}`}>
                    個人実績
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="admin-card-list">
        {rows.map((row) => {
          const rowWorkDate = row.schedule?.workDate ?? row.record?.workDate;
          return <article className={`admin-result-card${row.state === "invalid" ? " is-danger" : ""}`} key={row.user.id}>
            <div className="admin-result-card__heading">
              <div>
                <h2>{row.user.displayName}</h2>
                <p>{showSite ? row.schedule?.site.name ?? "勤務場所なし" : rowWorkDate ? formatWorkDate(rowWorkDate) : "対象日"}</p>
              </div>
              <AttendanceStatus row={row} />
            </div>
            <dl className="admin-result-card__facts">
              <div><dt>出勤</dt><dd>{formatJstTime(row.record?.clockInAt ?? null)} <small>予定 {formatJstTime(row.schedule?.scheduledStartAt ?? null)}</small></dd></div>
              <div><dt>退勤</dt><dd>{formatJstTime(row.record?.clockOutAt ?? null)} <small>予定 {formatJstTime(row.schedule?.scheduledEndAt ?? null)}</small></dd></div>
              <div><dt>休憩</dt><dd>{formatMinutes(row.record?.actualBreakMinutes ?? null)} <small>予定 {formatMinutes(row.schedule?.scheduledBreakMinutes ?? null)}</small></dd></div>
            </dl>
            <AttendanceLocations row={row} />
            <Link className="admin-row-link" href={`/admin/users/${encodeURIComponent(row.user.id)}`}>
              個人実績を見る
            </Link>
          </article>;
        })}
      </div>
    </div>
  );
}
