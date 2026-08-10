"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useState } from "react";
import type { FormEvent } from "react";
import {
  ApiError,
  getDemoConfig,
  getSession,
  login,
  logout,
  type DemoAccount,
} from "../../lib/client/api";
import { safeNextPath } from "../../lib/client/navigation";
import { AppIcon } from "../shared/icons";
import { ActionButton, InlineNotice } from "../shared/ui";

function destinationFor(role: "employee" | "admin", nextPath: string): string {
  if (role === "admin") {
    return nextPath.startsWith("/admin") ? nextPath : "/admin/today";
  }
  return nextPath.startsWith("/admin") ? "/app" : nextPath;
}

export function LoginForm() {
  const emailId = useId();
  const passwordId = useId();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | string[]>>({});
  const [demoAccounts, setDemoAccounts] = useState<DemoAccount[]>([]);

  useEffect(() => {
    void getSession()
      .then((user) => {
        const nextPath = safeNextPath(searchParams.get("next"));
        if (user.role === "employee" && nextPath.startsWith("/admin")) {
          return logout().then(() => {
            setError("管理画面を開くには、管理者アカウントでログインしてください。");
          });
        }
        router.replace(destinationFor(user.role, nextPath));
      })
      .catch(() => undefined);
    void getDemoConfig()
      .then((config) => {
        if (config.enabled) {
          const adminLogin = safeNextPath(searchParams.get("next")).startsWith(
            "/admin",
          );
          setDemoAccounts(
            config.accounts.filter((account) =>
              adminLogin ? account.role === "admin" : account.role === "employee",
            ),
          );
        }
      })
      .catch(() => undefined);
  }, [router, searchParams]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    try {
      const user = await login(email, password);
      router.replace(
        destinationFor(user.role, safeNextPath(searchParams.get("next"))),
      );
      router.refresh();
    } catch (loginError) {
      if (loginError instanceof ApiError) {
        setError(loginError.message);
        setFieldErrors(loginError.fieldErrors);
      } else {
        setError("ログインできませんでした。入力内容を確認してください。");
      }
      setSubmitting(false);
    }
  };

  const fillDemoAccount = (account: DemoAccount) => {
    setEmail(account.email);
    setPassword(account.password);
    setError(null);
    document.getElementById(emailId)?.focus();
  };

  const emailError = fieldErrors.email;
  const passwordError = fieldErrors.password;

  return (
    <main className="login-page" id="main-content">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-brand" aria-hidden="true">
          <span className="login-brand__mark">
            <AppIcon name="clock" size={28} />
          </span>
          <span>勤怠</span>
        </div>
        <div className="login-heading">
          <p className="eyebrow">おつかれさまです</p>
          <h1 id="login-title">ログイン</h1>
          <p>メールアドレスとパスワードを入力してください。</p>
        </div>

        {error ? (
          <InlineNotice role="alert" title="ログインできませんでした" tone="danger">
            {error}
          </InlineNotice>
        ) : null}

        <form className="form-stack" onSubmit={(event) => void handleSubmit(event)} noValidate>
          <div className="field">
            <label htmlFor={emailId}>メールアドレス</label>
            <input
              aria-describedby={emailError ? `${emailId}-error` : undefined}
              aria-invalid={Boolean(emailError)}
              autoComplete="username"
              id={emailId}
              inputMode="email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
            {emailError ? (
              <p className="field-error" id={`${emailId}-error`}>
                {Array.isArray(emailError) ? emailError[0] : emailError}
              </p>
            ) : null}
          </div>
          <div className="field">
            <label htmlFor={passwordId}>パスワード</label>
            <input
              aria-describedby={passwordError ? `${passwordId}-error` : undefined}
              aria-invalid={Boolean(passwordError)}
              autoComplete="current-password"
              id={passwordId}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
            {passwordError ? (
              <p className="field-error" id={`${passwordId}-error`}>
                {Array.isArray(passwordError) ? passwordError[0] : passwordError}
              </p>
            ) : null}
          </div>
          <ActionButton
            className="login-submit"
            disabled={!email.trim() || !password}
            loading={submitting}
            size="cta"
            type="submit"
          >
            {submitting ? "確認しています" : "ログインする"}
          </ActionButton>
        </form>

        {demoAccounts.length > 0 ? (
          <aside className="demo-accounts" aria-labelledby="demo-accounts-title">
            <div className="demo-accounts__heading">
              <p id="demo-accounts-title">デモ用アカウント</p>
              <span>架空データ</span>
            </div>
            <p className="demo-accounts__help">
              アカウントを選ぶと入力欄を補助します。ログイン操作は必要です。
            </p>
            <div className="demo-accounts__list">
              {demoAccounts.map((account) => (
                <button
                  className="demo-account"
                  key={account.email}
                  onClick={() => fillDemoAccount(account)}
                  type="button"
                >
                  <span>
                    <strong>{account.displayName}</strong>
                    <small>{account.email}</small>
                  </span>
                  <span className="demo-account__action">入力する</span>
                </button>
              ))}
            </div>
          </aside>
        ) : null}
      </section>
      <p className="login-footnote">位置情報は打刻時に任意で記録できます。</p>
    </main>
  );
}
