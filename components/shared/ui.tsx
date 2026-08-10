import type { ButtonHTMLAttributes, ReactNode } from "react";
import { AppIcon, type IconName } from "./icons";

export function Spinner() {
  return <span aria-hidden="true" className="spinner" />;
}

interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "standard" | "cta";
  loading?: boolean;
  icon?: IconName;
}

export function ActionButton({
  children,
  className = "",
  disabled,
  icon,
  loading = false,
  size = "standard",
  variant = "primary",
  ...props
}: ActionButtonProps) {
  return (
    <button
      className={`button button--${variant} button--${size} ${className}`.trim()}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Spinner /> : icon ? <AppIcon name={icon} /> : null}
      <span>{children}</span>
    </button>
  );
}
interface InlineNoticeProps {
  children?: ReactNode;
  title: string;
  tone?: "info" | "success" | "warning" | "danger";
  role?: "alert" | "status";
  actions?: ReactNode;
}

export function InlineNotice({
  actions,
  children,
  role = "status",
  title,
  tone = "info",
}: InlineNoticeProps) {
  return (
    <div className={`notice notice--${tone}`} role={role}>
      <AppIcon name={tone === "success" ? "check" : "alert"} />
      <div className="notice__body">
        <p className="notice__title">{title}</p>
        {children ? <div className="notice__text">{children}</div> : null}
        {actions ? <div className="notice__actions">{actions}</div> : null}
      </div>
    </div>
  );
}

export type StatusTone =
  | "primary"
  | "success"
  | "warning"
  | "danger"
  | "neutral"
  | "info";

export function StatusChip({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: StatusTone;
}) {
  return <span className={`status-chip status-chip--${tone}`}>{children}</span>;
}

export function LoadingPanel({ label = "読み込んでいます" }: { label?: string }) {
  return (
    <div className="state-panel state-panel--loading" role="status">
      <Spinner />
      <p>{label}</p>
    </div>
  );
}

export function EmptyState({
  action,
  message,
  title,
}: {
  action?: ReactNode;
  message: string;
  title: string;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state__icon" aria-hidden="true">
        <AppIcon name="calendar" size={24} />
      </span>
      <h2>{title}</h2>
      <p>{message}</p>
      {action ? <div className="empty-state__action">{action}</div> : null}
    </div>
  );
}
