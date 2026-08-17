import { describe, expect, it } from "vitest";

import { dummyPasswordHashForEnvironment } from "../../lib/server/auth";
import {
  hashPassword,
  PASSWORD_HASH_ITERATIONS,
  verifyPassword,
} from "../../lib/server/crypto";
import { PUBLIC_DEMO_PASSWORD_HASH_ITERATIONS } from "../../lib/server/demo-mode";

function iterationsOf(encodedHash: string): number {
  return Number(encodedHash.split("$")[1]);
}

describe("ログイン失敗時のダミーPBKDF2", () => {
  it("通常環境では新規・legacyアカウントと同じ600,000回を使う", async () => {
    const accountHash = await hashPassword("NormalAccountPassword!2026");
    const dummyHash = dummyPasswordHashForEnvironment({});

    expect(iterationsOf(accountHash)).toBe(PASSWORD_HASH_ITERATIONS);
    expect(iterationsOf(dummyHash)).toBe(iterationsOf(accountHash));
    expect(await verifyPassword("WrongPassword!2026", dummyHash)).toBe(false);
  });

  it("公開デモ環境では実アカウントと同じ100,000回を使う", async () => {
    const dummyHash = dummyPasswordHashForEnvironment({
      DEMO_MODE: "true",
      ALLOW_PUBLIC_DEMO: "true",
      SHOW_DEMO_CREDENTIALS: "true",
    });

    expect(iterationsOf(dummyHash)).toBe(PUBLIC_DEMO_PASSWORD_HASH_ITERATIONS);
    expect(await verifyPassword("WrongPassword!2026", dummyHash)).toBe(false);
  });

  it.each([
    ["DEMO_MODE"],
    ["ALLOW_PUBLIC_DEMO"],
    ["SHOW_DEMO_CREDENTIALS"],
  ] as const)("%sが無効なら通常環境のコストへ戻す", (disabledGate) => {
    const environment = {
      DEMO_MODE: "true",
      ALLOW_PUBLIC_DEMO: "true",
      SHOW_DEMO_CREDENTIALS: "true",
      [disabledGate]: "false",
    };

    expect(iterationsOf(dummyPasswordHashForEnvironment(environment))).toBe(
      PASSWORD_HASH_ITERATIONS,
    );
  });
});
