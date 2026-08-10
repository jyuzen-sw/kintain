export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    const fieldErrors =
      typeof error.details === "object" &&
      error.details !== null &&
      "fieldErrors" in error.details
        ? (error.details as { fieldErrors: unknown }).fieldErrors
        : undefined;
    return jsonResponse(
      {
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
          fieldErrors,
        },
      },
      { status: error.status },
    );
  }

  console.error("Unhandled API error", error);
  return jsonResponse(
    { error: { code: "INTERNAL_ERROR", message: "処理を完了できませんでした。" } },
    { status: 500 },
  );
}

export async function readJsonBody<T>(request: Request, maxBytes = 32_768): Promise<T> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > maxBytes) {
    throw new HttpError(413, "PAYLOAD_TOO_LARGE", "入力内容が大きすぎます。");
  }

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > maxBytes) {
    throw new HttpError(413, "PAYLOAD_TOO_LARGE", "入力内容が大きすぎます。");
  }

  try {
    return JSON.parse(body) as T;
  } catch {
    throw new HttpError(400, "INVALID_JSON", "入力内容を確認してください。");
  }
}

export function assertTrustedMutation(request: Request): void {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");

  if (origin !== requestUrl.origin || (fetchSite && fetchSite !== "same-origin")) {
    throw new HttpError(403, "UNTRUSTED_ORIGIN", "この操作は許可されていません。");
  }
}

export function noStoreHeaders(): HeadersInit {
  return {
    "cache-control": "no-store, private",
    pragma: "no-cache",
    "x-content-type-options": "nosniff",
    "referrer-policy": "same-origin",
  };
}
