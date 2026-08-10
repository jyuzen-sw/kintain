export const USER_ROLES = ["employee", "admin"] as const;

export type UserRole = (typeof USER_ROLES)[number];

export interface AuthenticatedActor {
  userId: string;
  role: UserRole;
}

export type AuthDomainErrorCode =
  | "INVALID_EMAIL"
  | "OWNER_OR_ADMIN_REQUIRED"
  | "ADMIN_REQUIRED";

export class AuthDomainError extends Error {
  readonly name = "AuthDomainError";

  constructor(
    readonly code: AuthDomainErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeAndValidateEmail(email: string): string {
  const normalizedEmail = normalizeEmail(email);
  if (
    normalizedEmail.length === 0 ||
    normalizedEmail.length > 254 ||
    !EMAIL_PATTERN.test(normalizedEmail)
  ) {
    throw new AuthDomainError(
      "INVALID_EMAIL",
      "メールアドレスを正しい形式で入力してください。",
    );
  }

  return normalizedEmail;
}

export function isOwnerOrAdmin(
  actor: AuthenticatedActor,
  ownerUserId: string,
): boolean {
  return actor.role === "admin" || actor.userId === ownerUserId;
}

export function assertOwnerOrAdmin(
  actor: AuthenticatedActor,
  ownerUserId: string,
): void {
  if (!isOwnerOrAdmin(actor, ownerUserId)) {
    throw new AuthDomainError(
      "OWNER_OR_ADMIN_REQUIRED",
      "本人または管理者だけがこの操作を行えます。",
    );
  }
}

export function assertAdmin(actor: AuthenticatedActor): void {
  if (actor.role !== "admin") {
    throw new AuthDomainError(
      "ADMIN_REQUIRED",
      "この操作には管理者権限が必要です。",
    );
  }
}
