import { describe, expect, it } from "vitest";

import { isPublicDemoMode } from "../../lib/server/demo-mode";

describe("公開デモの安全gate", () => {
  it("3つのgateがすべて有効な場合だけ公開デモとして扱う", () => {
    expect(
      isPublicDemoMode({
        DEMO_MODE: "true",
        ALLOW_PUBLIC_DEMO: "true",
        SHOW_DEMO_CREDENTIALS: "true",
      }),
    ).toBe(true);
  });

  it.each([
    ["DEMO_MODE"],
    ["ALLOW_PUBLIC_DEMO"],
    ["SHOW_DEMO_CREDENTIALS"],
  ] as const)("%sが無効なら通常モードとして扱う", (disabledGate) => {
    const environment = {
      DEMO_MODE: "true",
      ALLOW_PUBLIC_DEMO: "true",
      SHOW_DEMO_CREDENTIALS: "true",
      [disabledGate]: "false",
    };
    expect(isPublicDemoMode(environment)).toBe(false);
  });
});
