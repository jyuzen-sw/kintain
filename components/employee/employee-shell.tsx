"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import type { SessionUser } from "../../lib/contracts/types";
import { ApiError, getSession, logout } from "../../lib/client/api";
import { AppIcon, type IconName } from "../shared/icons";
import { ActionButton, InlineNotice, LoadingPanel } from "../shared/ui";

const navigation: { href: string; label: string; icon: IconName }[] = [
  { href: "/app", label: "今日", icon: "clock" },
  { href: "/me/history", label: "実績", icon: "history" },
  { href: "/me/requests", label: "申請", icon: "requests" },
];

export function EmployeeShell({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSession = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const currentUser = await getSession();
      if (currentUser.role === "admin") {
        router.replace("/admin/today");
        return;
      }
      setUser(currentUser);
    } catch (sessionError) {
      if (sessionError instanceof ApiError && sessionError.status === 401) {
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
        return;
      }
      setError(
        sessionError instanceof Error
          ? sessionError.message
          : "ログイン状態を確認できませんでした。",
      );
    } finally {
      setLoading(false);
    }
  }, [pathname, router]);

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

  if (loading) {
    return (
      <main className="employee-centered" id="main-content">
        <LoadingPanel label="ログイン状態を確認しています" />
      </main>
    );
  }

  if (!user) {
    return (
      <main className="employee-centered" id="main-content">
        <InlineNotice
          actions={
            <ActionButton onClick={() => void loadSession()} variant="secondary">
              再試行する
            </ActionButton>
          }
          role="alert"
          title="画面を開けませんでした"
          tone="danger"
        >
          {error}
        </InlineNotice>
      </main>
    );
  }

  return (
    <div className="employee-app">
      <header className="employee-header">
        <div>
          <Link className="wordmark" href="/app" aria-label="勤怠 ホーム">
            勤怠
          </Link>
          <p className="employee-header__title">{title}</p>
        </div>
        <details className="account-menu">
          <summary aria-label="アカウントメニューを開く">
            <span className="account-menu__avatar" aria-hidden="true">
              <AppIcon name="user" size={18} />
            </span>
            <span className="account-menu__name">{user.displayName}</span>
            <AppIcon name="chevron-down" size={16} />
          </summary>
          <div className="account-menu__panel">
            <p className="account-menu__signed-in">ログイン中</p>
            <p className="account-menu__identity">{user.displayName}</p>
            {user.email ? <p className="account-menu__email">{user.email}</p> : null}
            <button
              className="account-menu__logout"
              disabled={loggingOut}
              onClick={() => void handleLogout()}
              type="button"
            >
              <AppIcon name="logout" size={18} />
              {loggingOut ? "ログアウト中" : "ログアウト"}
            </button>
          </div>
        </details>
      </header>

      {error ? (
        <div className="employee-global-error">
          <InlineNotice role="alert" title="操作を完了できませんでした" tone="danger">
            {error}
          </InlineNotice>
        </div>
      ) : null}

      <main className="employee-content" id="main-content">
        {children}
      </main>

      <nav className="bottom-nav" aria-label="従業員メニュー">
        <div className="bottom-nav__inner">
          {navigation.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={`bottom-nav__item${active ? " is-active" : ""}`}
                href={item.href}
                key={item.href}
              >
                <AppIcon name={item.icon} size={24} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
