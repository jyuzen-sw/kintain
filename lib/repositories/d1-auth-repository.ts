import type { SessionUser, UserRole } from "@/lib/contracts/types";

interface UserRow {
  id: string;
  employee_code: string | null;
  normalized_email: string;
  display_name: string;
  role: UserRole;
  password_hash: string;
  active: number;
}

interface SessionRow extends UserRow {
  session_id: string;
  csrf_token_hash: string;
  expires_at: string;
}

interface RateLimitRow {
  failure_count: number;
  blocked_until: string | null;
}

export interface AuthenticatedSession {
  id: string;
  csrfTokenHash: string;
  expiresAt: string;
  user: SessionUser;
}

export interface AuthUser extends SessionUser {
  passwordHash: string;
  active: boolean;
}

function mapUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    employeeCode: row.employee_code,
    displayName: row.display_name,
    email: row.normalized_email,
    role: row.role,
    passwordHash: row.password_hash,
    active: row.active === 1,
  };
}

export class D1AuthRepository {
  constructor(private readonly database: D1Database) {}

  async findActiveUserByEmail(normalizedEmail: string): Promise<AuthUser | null> {
    const row = await this.database
      .prepare(
        `SELECT id, employee_code, normalized_email, display_name, role,
                password_hash, active
           FROM users
          WHERE normalized_email = ? AND active = 1`,
      )
      .bind(normalizedEmail)
      .first<UserRow>();
    return row ? mapUser(row) : null;
  }

  async findSession(tokenHash: string, now: string): Promise<AuthenticatedSession | null> {
    const row = await this.database
      .prepare(
        `SELECT s.id AS session_id, s.csrf_token_hash, s.expires_at,
                u.id, u.employee_code, u.normalized_email, u.display_name,
                u.role, u.password_hash, u.active
           FROM sessions s
           JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`,
      )
      .bind(tokenHash, now)
      .first<SessionRow>();

    if (!row) return null;
    const user = mapUser(row);
    return {
      id: row.session_id,
      csrfTokenHash: row.csrf_token_hash,
      expiresAt: row.expires_at,
      user: {
        id: user.id,
        employeeCode: user.employeeCode,
        displayName: user.displayName,
        email: user.email,
        role: user.role,
      },
    };
  }

  async createSession(input: {
    id: string;
    userId: string;
    tokenHash: string;
    csrfTokenHash: string;
    expiresAt: string;
    now: string;
  }): Promise<void> {
    await this.database
      .prepare(
        `INSERT INTO sessions
           (id, user_id, token_hash, csrf_token_hash, expires_at, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.id,
        input.userId,
        input.tokenHash,
        input.csrfTokenHash,
        input.expiresAt,
        input.now,
        input.now,
      )
      .run();
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.database.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
  }

  async deleteExpiredSessions(now: string): Promise<void> {
    await this.database.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now).run();
  }

  async getRateLimit(
    scopeType: "account" | "ip",
    scopeKeyHash: string,
  ): Promise<RateLimitRow | null> {
    return this.database
      .prepare(
        `SELECT failure_count, blocked_until
           FROM login_rate_limits
          WHERE scope_type = ? AND scope_key_hash = ?`,
      )
      .bind(scopeType, scopeKeyHash)
      .first<RateLimitRow>();
  }

  async recordFailedLogin(input: {
    scopeType: "account" | "ip";
    scopeKeyHash: string;
    now: string;
    windowThreshold: string;
    blockedUntil: string;
    maxFailures: number;
  }): Promise<void> {
    await this.database
      .prepare(
        `INSERT INTO login_rate_limits
           (scope_type, scope_key_hash, window_started_at, failure_count, blocked_until, updated_at)
         VALUES (?, ?, ?, 1, NULL, ?)
         ON CONFLICT(scope_type, scope_key_hash) DO UPDATE SET
           failure_count = CASE
             WHEN login_rate_limits.window_started_at <= ? THEN 1
             ELSE login_rate_limits.failure_count + 1
           END,
           window_started_at = CASE
             WHEN login_rate_limits.window_started_at <= ? THEN excluded.window_started_at
             ELSE login_rate_limits.window_started_at
           END,
           blocked_until = CASE
             WHEN (CASE
               WHEN login_rate_limits.window_started_at <= ? THEN 1
               ELSE login_rate_limits.failure_count + 1
             END) >= ? THEN ?
             ELSE login_rate_limits.blocked_until
           END,
           updated_at = excluded.updated_at`,
      )
      .bind(
        input.scopeType,
        input.scopeKeyHash,
        input.now,
        input.now,
        input.windowThreshold,
        input.windowThreshold,
        input.windowThreshold,
        input.maxFailures,
        input.blockedUntil,
      )
      .run();
  }

  async clearAccountRateLimit(scopeKeyHash: string): Promise<void> {
    await this.database
      .prepare(
        "DELETE FROM login_rate_limits WHERE scope_type = 'account' AND scope_key_hash = ?",
      )
      .bind(scopeKeyHash)
      .run();
  }
}
