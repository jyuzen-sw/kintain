export const PRODUCTION_SESSION_COOKIE = "__Host-kintain_session";
export const LOCAL_SESSION_COOKIE = "kintain_session";
export const CSRF_COOKIE = "kintain_csrf";

export function parseCookies(header: string | null): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name) cookies.set(name, value);
  }
  return cookies;
}

export function readSessionToken(request: Request): string | null {
  const cookies = parseCookies(request.headers.get("cookie"));
  return cookies.get(sessionCookieName(request.url)) ?? null;
}

export function sessionCookieName(requestUrl: string): string {
  return new URL(requestUrl).protocol === "https:"
    ? PRODUCTION_SESSION_COOKIE
    : LOCAL_SESSION_COOKIE;
}

export function serializeSessionCookie(
  requestUrl: string,
  token: string,
  maxAgeSeconds: number,
): string {
  const secure = new URL(requestUrl).protocol === "https:";
  const attributes = [
    `${secure ? PRODUCTION_SESSION_COOKIE : LOCAL_SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

export function serializeCsrfCookie(
  requestUrl: string,
  token: string,
  maxAgeSeconds: number,
): string {
  const secure = new URL(requestUrl).protocol === "https:";
  const attributes = [
    `${CSRF_COOKIE}=${token}`,
    "Path=/",
    "SameSite=Strict",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

export function expiredSessionCookies(): string[] {
  return [
    `${PRODUCTION_SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    `${LOCAL_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    `${CSRF_COOKIE}=; Path=/; SameSite=Strict; Max-Age=0`,
  ];
}
