import type { SessionUser, UserRole } from "@/lib/contracts/types";
import { normalizeEmail } from "@/lib/domain/auth";
import { D1AuthRepository, type AuthenticatedSession } from "@/lib/repositories/d1-auth-repository";
import { readSessionToken } from "@/lib/server/cookies";
import {
  createOpaqueToken,
  fingerprintIdentifier,
  PASSWORD_HASH_ITERATIONS,
  sha256Base64Url,
  verifyPassword,
} from "@/lib/server/crypto";
import {
  isPublicDemoMode,
  PUBLIC_DEMO_PASSWORD_HASH_ITERATIONS,
  type DemoModeEnvironment,
} from "@/lib/server/demo-mode";
import { HttpError } from "@/lib/server/http";

const SESSION_LIFETIME_MILLISECONDS = 12 * 60 * 60 * 1_000;
const RATE_WINDOW_MILLISECONDS = 15 * 60 * 1_000;
const RATE_BLOCK_MILLISECONDS = 15 * 60 * 1_000;
const RATE_MAX_FAILURES = 5;
const DUMMY_PASSWORD_SALT = "-r04Siq0QbnbszE7lhEASA";
const DUMMY_PASSWORD_DIGEST = "zT3HUQEF9oZHLDcIpIOp59Rr5bCW-2tzWwbzQPeOFoA";

// Workerのglobal scopeでは乱数生成とPBKDF2を開始できないため固定値を使う。
// iteration数だけは稼働環境の実アカウントに合わせ、メールアドレスの存在を
// PBKDF2の応答時間から区別できないようにする。
export function dummyPasswordHashForEnvironment(
  environment: DemoModeEnvironment,
): string {
  const iterations = isPublicDemoMode(environment)
    ? PUBLIC_DEMO_PASSWORD_HASH_ITERATIONS
    : PASSWORD_HASH_ITERATIONS;
  return `pbkdf2-sha256$${iterations}$${DUMMY_PASSWORD_SALT}$${DUMMY_PASSWORD_DIGEST}`;
}

export interface LoginResult {
  user: SessionUser;
  sessionToken: string;
  csrfToken: string;
  expiresAt: string;
}

function clientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "local"
  );
}

function retryAfterSeconds(blockedUntil: string | null, now: Date): number {
  if (!blockedUntil) return 0;
  return Math.max(0, Math.ceil((Date.parse(blockedUntil) - now.getTime()) / 1_000));
}

export async function loginWithPassword(input: {
  database: D1Database;
  environment: DemoModeEnvironment;
  request: Request;
  email: string;
  password: string;
  now?: Date;
}): Promise<LoginResult> {
  const now = input.now ?? new Date();
  const normalizedEmail = normalizeEmail(input.email);
  const repository = new D1AuthRepository(input.database);
  const accountFingerprint = await fingerprintIdentifier(normalizedEmail);
  const ipFingerprint = await fingerprintIdentifier(clientIp(input.request));
  const [accountLimit, ipLimit] = await Promise.all([
    repository.getRateLimit("account", accountFingerprint),
    repository.getRateLimit("ip", ipFingerprint),
  ]);
  const retryAfter = Math.max(
    retryAfterSeconds(accountLimit?.blocked_until ?? null, now),
    retryAfterSeconds(ipLimit?.blocked_until ?? null, now),
  );
  if (retryAfter > 0) {
    throw new HttpError(
      429,
      "LOGIN_RATE_LIMITED",
      `ログイン試行が続いたため一時停止しています。${retryAfter}秒後に再試行してください。`,
      { retryAfterSeconds: retryAfter },
    );
  }

  const user = await repository.findActiveUserByEmail(normalizedEmail);
  const passwordMatches = user
    ? await verifyPassword(input.password, user.passwordHash)
    : await verifyPassword(
        input.password,
        dummyPasswordHashForEnvironment(input.environment),
      );

  if (!user || !passwordMatches) {
    const windowThreshold = new Date(now.getTime() - RATE_WINDOW_MILLISECONDS).toISOString();
    const blockedUntil = new Date(now.getTime() + RATE_BLOCK_MILLISECONDS).toISOString();
    await Promise.all([
      repository.recordFailedLogin({
        scopeType: "account",
        scopeKeyHash: accountFingerprint,
        now: now.toISOString(),
        windowThreshold,
        blockedUntil,
        maxFailures: RATE_MAX_FAILURES,
      }),
      repository.recordFailedLogin({
        scopeType: "ip",
        scopeKeyHash: ipFingerprint,
        now: now.toISOString(),
        windowThreshold,
        blockedUntil,
        maxFailures: RATE_MAX_FAILURES,
      }),
    ]);
    throw new HttpError(
      401,
      "INVALID_CREDENTIALS",
      "メールアドレスまたはパスワードを確認してください。",
    );
  }

  const sessionToken = createOpaqueToken();
  const csrfToken = createOpaqueToken();
  const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MILLISECONDS).toISOString();
  await repository.createSession({
    id: crypto.randomUUID(),
    userId: user.id,
    tokenHash: await sha256Base64Url(sessionToken),
    csrfTokenHash: await sha256Base64Url(csrfToken),
    expiresAt,
    now: now.toISOString(),
  });
  await repository.clearAccountRateLimit(accountFingerprint);

  return {
    user: {
      id: user.id,
      employeeCode: user.employeeCode,
      displayName: user.displayName,
      email: user.email,
      role: user.role,
    },
    sessionToken,
    csrfToken,
    expiresAt,
  };
}

export async function getAuthenticatedSession(
  database: D1Database,
  request: Request,
  now = new Date(),
): Promise<AuthenticatedSession | null> {
  const token = readSessionToken(request);
  if (!token) return null;
  return new D1AuthRepository(database).findSession(
    await sha256Base64Url(token),
    now.toISOString(),
  );
}

export async function requireSession(
  database: D1Database,
  request: Request,
  allowedRoles: readonly UserRole[] = ["employee", "admin"],
): Promise<AuthenticatedSession> {
  const session = await getAuthenticatedSession(database, request);
  if (!session) {
    throw new HttpError(401, "AUTHENTICATION_REQUIRED", "ログインしてください。");
  }
  if (!allowedRoles.includes(session.user.role)) {
    throw new HttpError(403, "FORBIDDEN", "この画面を利用する権限がありません。");
  }
  return session;
}

export async function assertCsrf(
  session: AuthenticatedSession,
  request: Request,
): Promise<void> {
  const csrfToken = request.headers.get("x-csrf-token");
  if (!csrfToken || (await sha256Base64Url(csrfToken)) !== session.csrfTokenHash) {
    throw new HttpError(403, "INVALID_CSRF_TOKEN", "操作の有効期限が切れました。再読み込みしてください。");
  }
}
