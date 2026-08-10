"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AttendanceCategory,
  AttendanceRequestStatus,
  AttendanceState,
  PunchEventType,
} from "../../lib/contracts/types";
import {
  ApiError,
  getToday,
  punch,
  type PunchLocationInput,
  type TodayViewModel,
} from "../../lib/client/api";
import {
  formatJstDate,
  formatJstTime,
  formatMinutes,
  formatWorkDate,
} from "../../lib/client/date";
import { createClientRequestId } from "../../lib/client/id";
import { captureOptionalLocation } from "../../lib/client/location";
import { AppIcon } from "../shared/icons";
import {
  ActionButton,
  InlineNotice,
  LoadingPanel,
  StatusChip,
  type StatusTone,
} from "../shared/ui";

const statePresentation: Record<
  AttendanceState,
  { label: string; message: string; tone: StatusTone }
> = {
  no_schedule: {
    label: "勤務予定なし",
    message: "本日の勤務予定はありません",
    tone: "neutral",
  },
  before_work: {
    label: "出勤前",
    message: "出勤の準備ができています",
    tone: "neutral",
  },
  working: {
    label: "勤務中",
    message: "勤務を記録しています",
    tone: "primary",
  },
  completed: {
    label: "退勤済み",
    message: "本日の勤務は完了しました",
    tone: "success",
  },
  non_working: {
    label: "承認済み",
    message: "本日は非勤務日です",
    tone: "info",
  },
  invalid: {
    label: "打刻不備",
    message: "実績の確認が必要です",
    tone: "danger",
  },
};

const categoryLabels: Record<AttendanceCategory, string> = {
  work: "通常勤務",
  paid_leave: "有休",
  absence: "欠勤",
  sick_leave: "病欠",
  other: "その他",
};

const requestStatusLabels: Record<AttendanceRequestStatus, string> = {
  pending: "申請中",
  approved: "承認済み",
  rejected: "却下",
  withdrawn: "取消済み",
};

interface PendingPunch {
  type: PunchEventType;
  clientRequestId: string;
  location: PunchLocationInput | null;
}

function locationMessage(location: PunchLocationInput): string {
  if (location.state === "granted") return "位置情報も記録しました";
  if (location.state === "denied") return "位置情報なしで記録しました（許可されていません）";
  if (location.state === "timeout") return "位置情報なしで記録しました（取得時間を超えました）";
  return "位置情報なしで記録しました";
}

export function TodayDashboard() {
  const [today, setToday] = useState<TodayViewModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [punching, setPunching] = useState(false);
  const [punchStage, setPunchStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const pendingPunch = useRef<PendingPunch | null>(null);

  const loadToday = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const latest = await getToday();
      setToday(latest);
      const offset = Date.parse(latest.serverNow) - Date.now();
      setNow(new Date(Date.now() + (Number.isFinite(offset) ? offset : 0)));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "本日の勤怠を読み込めませんでした。",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadToday();
  }, [loadToday]);

  useEffect(() => {
    if (!today) return;
    const offset = Date.parse(today.serverNow) - Date.now();
    const safeOffset = Number.isFinite(offset) ? offset : 0;
    const timer = window.setInterval(
      () => setNow(new Date(Date.now() + safeOffset)),
      30_000,
    );
    return () => window.clearInterval(timer);
  }, [today]);

  const eventType = useMemo<PunchEventType | null>(() => {
    if (today?.state === "before_work") return "clock_in";
    if (today?.state === "working") return "clock_out";
    return null;
  }, [today?.state]);

  const handlePunch = async () => {
    if (!eventType || !today) return;
    if (!navigator.onLine) {
      setError("オフラインです。通信接続後に再試行してください。");
      return;
    }

    setPunching(true);
    setError(null);
    setSuccess(null);

    let pending = pendingPunch.current;
    if (!pending || pending.type !== eventType) {
      pending = {
        type: eventType,
        clientRequestId: createClientRequestId(),
        location: null,
      };
      pendingPunch.current = pending;
    }

    try {
      if (!pending.location) {
        if (today.publicDemoMode) {
          pending.location = {
            state: "unavailable",
            latitude: null,
            longitude: null,
            accuracyMeters: null,
            capturedAt: null,
          };
        } else {
          setPunchStage("位置情報を確認しています");
          pending.location = await captureOptionalLocation();
        }
      }
      setPunchStage(eventType === "clock_in" ? "出勤を記録しています" : "退勤を記録しています");
      const latest = await punch({
        type: eventType,
        clientRequestId: pending.clientRequestId,
        location: pending.location,
      });
      setToday(latest);
      setSuccess(
        `${eventType === "clock_in" ? "出勤" : "退勤"}を${formatJstTime(
          eventType === "clock_in"
            ? latest.record?.clockInAt ?? latest.serverNow
            : latest.record?.clockOutAt ?? latest.serverNow,
        )}に記録しました。${locationMessage(pending.location)}`,
      );
      pendingPunch.current = null;
    } catch (punchError) {
      if (punchError instanceof ApiError && punchError.status === 409) {
        const conflictMessage = `${punchError.message} 最新の状態を確認してください。`;
        await loadToday();
        setError(conflictMessage);
      } else {
        setError(
          punchError instanceof Error
            ? punchError.message
            : "打刻結果を確認できませんでした。同じ操作で再試行できます。",
        );
      }
    } finally {
      setPunching(false);
      setPunchStage(null);
    }
  };

  if (loading && !today) {
    return <LoadingPanel label="本日の勤怠を読み込んでいます" />;
  }

  if (!today) {
    return (
      <InlineNotice
        actions={
          <ActionButton onClick={() => void loadToday()} variant="secondary">
            再試行する
          </ActionButton>
        }
        role="alert"
        title="本日の勤怠を表示できません"
        tone="danger"
      >
        {error}
      </InlineNotice>
    );
  }

  const presentation = statePresentation[today.state];
  const category = today.record?.attendanceCategory ?? "work";

  return (
    <div className="today-page">
      <section className="today-clock" aria-labelledby="today-date">
        <p id="today-date">{formatJstDate(now)}</p>
        <time dateTime={now.toISOString()}>{formatJstTime(now)}</time>
      </section>

      {today.request?.status === "pending" ? (
        <InlineNotice
          actions={<Link href="/me/requests">申請を確認する</Link>}
          title={`${categoryLabels[today.request.requestedCategory]}を申請中です`}
          tone="warning"
        >
          承認されるまでは通常どおり打刻できます。
        </InlineNotice>
      ) : null}

      {error ? (
        <InlineNotice
          actions={
            <button className="text-button" onClick={() => void loadToday()} type="button">
              最新状態を確認する
            </button>
          }
          role="alert"
          title="打刻を完了できませんでした"
          tone="danger"
        >
          {error}
        </InlineNotice>
      ) : null}

      {success ? (
        <InlineNotice title="記録しました" tone="success">
          {success}
        </InlineNotice>
      ) : null}

      <section className={`work-status work-status--${presentation.tone}`}>
        <div className="work-status__heading">
          <StatusChip tone={presentation.tone}>
            {today.state === "non_working" ? categoryLabels[category] : presentation.label}
          </StatusChip>
          {today.request && today.request.status !== "pending" ? (
            <span className="work-status__request">
              {requestStatusLabels[today.request.status]}
            </span>
          ) : null}
        </div>
        <h1>{
          today.state === "non_working"
            ? `本日は${categoryLabels[category]}です`
            : presentation.message
        }</h1>
        {today.schedule ? (
          <p className="work-status__site">
            <AppIcon name="location" size={18} />
            {today.schedule.site.name}
          </p>
        ) : null}
      </section>

      <section className="today-facts" aria-labelledby="today-facts-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">予定と実績</p>
            <h2 id="today-facts-title">本日の記録</h2>
          </div>
          <Link href={`/me/history?date=${encodeURIComponent(today.workDate)}`}>
            見直す
          </Link>
        </div>
        <dl className="facts-grid">
          <div>
            <dt>出勤</dt>
            <dd>{formatJstTime(today.record?.clockInAt ?? null)}</dd>
            <span>予定 {formatJstTime(today.schedule?.scheduledStartAt ?? null)}</span>
          </div>
          <div>
            <dt>退勤</dt>
            <dd>{formatJstTime(today.record?.clockOutAt ?? null)}</dd>
            <span>予定 {formatJstTime(today.schedule?.scheduledEndAt ?? null)}</span>
          </div>
          <div>
            <dt>休憩</dt>
            <dd>{formatMinutes(today.record?.actualBreakMinutes ?? null)}</dd>
            <span>予定 {formatMinutes(today.schedule?.scheduledBreakMinutes ?? null)}</span>
          </div>
        </dl>
      </section>

      <section className="punch-zone" aria-label="本日の主要操作">
        {eventType ? (
          <>
            <ActionButton
              className="punch-button"
              disabled={punching}
              loading={punching}
              onClick={() => void handlePunch()}
              size="cta"
            >
              {punching
                ? punchStage ?? "記録しています"
                : eventType === "clock_in"
                  ? "出勤する"
                  : "退勤する"}
            </ActionButton>
            <p className="punch-zone__privacy">
              <AppIcon name="location" size={16} />
              {today.publicDemoMode
                ? "公開デモでは端末の位置情報を取得・保存しません。"
                : "位置情報は任意です。許可しなくても打刻できます。"}
            </p>
          </>
        ) : today.state === "completed" ? (
          <div className="completion-panel" role="status">
            <span aria-hidden="true"><AppIcon name="check" size={24} /></span>
            <div>
              <strong>本日の勤務は完了しました</strong>
              <p>修正が必要な場合は実績から見直せます。</p>
            </div>
          </div>
        ) : today.state === "invalid" ? (
          <Link className="button button--secondary button--cta" href={`/me/history?date=${today.workDate}`}>
            <AppIcon name="edit" />
            <span>実績を確認する</span>
          </Link>
        ) : (
          <div className="no-action-panel">
            <p>{presentation.message}</p>
            <Link href="/me/requests">休暇・欠勤を申請する</Link>
          </div>
        )}
      </section>

      <nav className="today-shortcuts" aria-label="本日の補助メニュー">
        <Link href="/me/history">
          <AppIcon name="history" />
          <span><strong>自分の実績</strong><small>過去日の確認・修正</small></span>
          <AppIcon name="arrow-right" />
        </Link>
        <Link href="/me/requests">
          <AppIcon name="requests" />
          <span><strong>休暇・欠勤申請</strong><small>申請状況の確認</small></span>
          <AppIcon name="arrow-right" />
        </Link>
      </nav>

      <p className="today-work-date">勤務日: {formatWorkDate(today.workDate)}</p>
    </div>
  );
}
