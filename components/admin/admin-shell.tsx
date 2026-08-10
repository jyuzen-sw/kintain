"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { ApiError, getDemoConfig, getSession, logout } from "../../lib/client/api";
import { resetAdminDemoData } from "../../lib/client/admin-api";
import type { SessionUser } from "../../lib/contracts/types";
import { AppIcon } from "../shared/icons";
import { ActionButton, InlineNotice, LoadingPanel } from "../shared/ui";

const navigation = [
  { href: "/admin/today", label: "当日" },
  { href: "/admin/sites", label: "現場別" },
  { href: "/admin/requests", label: "申請" },
  { href: "/admin/users", label: "個人実績" },
  { href: "/admin/audit", label: "監査ログ" },
] as const;

function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const [resettingDemo, setResettingDemo] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redirectToLogin = useCallback(() => {
    router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [pathname, router]);

  const loadSession = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const currentUser = await getSession();
      if (currentUser.role !== "admin") {
        redirectToLogin();
        return;
      }
      setUser(currentUser);
      void getDemoConfig()
        .then((config) => setDemoMode(config.enabled))
        .catch(() => setDemoMode(false));
    } catch (sessionError) {
      if (
        sessionError instanceof ApiError &&
        (sessionError.status === 401 || sessionError.status === 403)
      ) {
        redirectToLogin();
        return;
      }
      setError(
        sessionError instanceof Error
          ? sessionError.message
          : "管理者のログイン状態を確認できませんでした。",
      );
    } finally {
      setLoading(false);
    }
  }, [redirectToLogin]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const handleLogout = async () => {
    setLoggingOut(true);
    setError(null);
    try {
      await logout();
      router.replace("/login");
      router.refresh();
    } catch (logoutError) {
      setError(
        logoutError instanceof Error
          ? logoutError.message
          : "ログアウトできませんでした。",
      );
      setLoggingOut(false);
    }
  };

  const handleDemoReset = async () => {
    const confirmed = window.confirm(
      "デモ用の勤怠・申請・監査ログを初期状態へ戻します。続行しますか？",
    );
    if (!confirmed) return;

    setResettingDemo(true);
    setError(null);
    try {
      await resetAdminDemoData();
      window.sessionStorage.setItem("kintain_demo_reset_succeeded", "true");
      window.location.assign("/admin/today");
    } catch (resetError) {
      setError(
        resetError instanceof Error
          ? resetError.message
          : "デモデータを初期状態へ戻せませんでした。",
      );
      setResettingDemo(false);
    }
  };

  if (loading) {
    return (
      <main className="admin-auth-state" id="main-content">
        <LoadingPanel label="管理者権限を確認しています" />
      </main>
    );
  }

  if (!user) {
    return (
      <main className="admin-auth-state" id="main-content">
        <InlineNotice
          actions={
            <ActionButton onClick={() => void loadSession()} variant="secondary">
              再試行する
            </ActionButton>
          }
          role="alert"
          title="管理画面を開けませんでした"
          tone="danger"
        >
          {error}
        </InlineNotice>
      </main>
    );
  }

  return (
    <div className="admin-app">
      <header className="admin-header">
        <div className="admin-header__top">
          <Link className="admin-wordmark" href="/admin/today">
            <span>勤怠</span>
            <small>管理</small>
          </Link>
          <details className="admin-account-menu">
            <summary aria-label="管理者メニューを開く">
              <span className="admin-account-menu__avatar" aria-hidden="true">
                <AppIcon name="user" size={18} />
              </span>
              <span>{user.displayName}</span>
              <AppIcon name="chevron-down" size={16} />
            </summary>
            <div className="admin-account-menu__panel">
              <p>管理者としてログイン中</p>
              <strong>{user.displayName}</strong>
              {demoMode ? (
                <button
                  className="admin-account-menu__reset"
                  disabled={resettingDemo}
                  onClick={() => void handleDemoReset()}
                  type="button"
                >
                  <AppIcon name="refresh" size={18} />
                  {resettingDemo ? "初期化しています" : "デモデータを初期状態へ戻す"}
                </button>
              ) : null}
              <button disabled={loggingOut} onClick={() => void handleLogout()} type="button">
                <AppIcon name="logout" size={18} />
                {loggingOut ? "ログアウト中" : "ログアウト"}
              </button>
            </div>
          </details>
        </div>
        <nav aria-label="管理者メニュー" className="admin-nav">
          <div className="admin-nav__inner">
            {navigation.map((item) => {
              const active = isActivePath(pathname, item.href);
              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  className={active ? "is-active" : undefined}
                  href={item.href}
                  key={item.href}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>
      </header>

      {error ? (
        <div className="admin-global-notice">
          <InlineNotice role="alert" title="操作を完了できませんでした" tone="danger">
            {error}
          </InlineNotice>
        </div>
      ) : null}

      <main className="admin-content" id="main-content">
        {children}
      </main>
    </div>
  );
}
