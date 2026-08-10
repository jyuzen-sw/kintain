import { describe, expect, it } from "vitest";

import {
  AuthDomainError,
  assertAdmin,
  assertOwnerOrAdmin,
  isOwnerOrAdmin,
  normalizeAndValidateEmail,
  normalizeEmail,
  type AuthenticatedActor,
} from "../../lib/domain/auth";

const employee: AuthenticatedActor = {
  userId: "employee-1",
  role: "employee",
};
const otherEmployee: AuthenticatedActor = {
  userId: "employee-2",
  role: "employee",
};
const admin: AuthenticatedActor = { userId: "admin-1", role: "admin" };

describe("メールアドレス", () => {
  it("前後空白を除去して小文字化する", () => {
    expect(normalizeEmail("  DEMO.User@Example.COM \n")).toBe(
      "demo.user@example.com",
    );
  });

  it("正規化後のメール形式を検証する", () => {
    expect(normalizeAndValidateEmail(" DEMO@EXAMPLE.COM ")).toBe(
      "demo@example.com",
    );
    expect(() => normalizeAndValidateEmail("not-an-email")).toThrow(
      "メールアドレスを正しい形式で入力してください。",
    );
  });
});

describe("所有者または管理者の認可", () => {
  it("本人と管理者だけを許可する", () => {
    expect(isOwnerOrAdmin(employee, "employee-1")).toBe(true);
    expect(isOwnerOrAdmin(admin, "employee-1")).toBe(true);
    expect(isOwnerOrAdmin(otherEmployee, "employee-1")).toBe(false);
    expect(() => assertOwnerOrAdmin(employee, "employee-1")).not.toThrow();
    expect(() => assertOwnerOrAdmin(admin, "employee-1")).not.toThrow();
  });

  it("他の従業員による操作を日本語エラーで拒否する", () => {
    expect(() => assertOwnerOrAdmin(otherEmployee, "employee-1")).toThrowError(
      new AuthDomainError(
        "OWNER_OR_ADMIN_REQUIRED",
        "本人または管理者だけがこの操作を行えます。",
      ),
    );
  });

  it("管理者限定操作を従業員へ許可しない", () => {
    expect(() => assertAdmin(admin)).not.toThrow();
    expect(() => assertAdmin(employee)).toThrow(
      "この操作には管理者権限が必要です。",
    );
  });
});
