import { describe, expect, it } from "vitest";

import {
  LOCAL_SESSION_COOKIE,
  PRODUCTION_SESSION_COOKIE,
  readSessionToken,
} from "../../lib/server/cookies";

describe("セッションCookieの境界", () => {
  it("HTTPSでは__Host Cookieだけを受け付ける", () => {
    const localOnly = new Request("https://attendance.example.test/api/auth/session", {
      headers: { cookie: `${LOCAL_SESSION_COOKIE}=local-token` },
    });
    const production = new Request("https://attendance.example.test/api/auth/session", {
      headers: {
        cookie: `${LOCAL_SESSION_COOKIE}=local-token; ${PRODUCTION_SESSION_COOKIE}=production-token`,
      },
    });

    expect(readSessionToken(localOnly)).toBeNull();
    expect(readSessionToken(production)).toBe("production-token");
  });

  it("HTTPのローカル開発では開発用Cookieだけを受け付ける", () => {
    const request = new Request("http://127.0.0.1:4173/api/auth/session", {
      headers: {
        cookie: `${PRODUCTION_SESSION_COOKIE}=production-token; ${LOCAL_SESSION_COOKIE}=local-token`,
      },
    });

    expect(readSessionToken(request)).toBe("local-token");
  });
});
