import { describe, expect, it } from "vitest";

import { safeNextPath } from "../../lib/client/navigation";

describe("ログイン後の遷移先", () => {
  it.each([
    ["/app", "/app"],
    ["/me/history?month=2026-08", "/me/history?month=2026-08"],
    ["/admin/users/user-maru", "/admin/users/user-maru"],
  ])("アプリ内の許可済み画面 %s だけを維持する", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    "//evil.example",
    "/\\evil.example",
    "https://evil.example/",
    "/unknown",
    "/admin%2f..%2flogin",
    "/app\u0000",
  ])("外部または未許可の遷移先 %s を既定画面へ戻す", (input) => {
    expect(safeNextPath(input)).toBe("/app");
  });
});
