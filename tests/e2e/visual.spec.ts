import { test, expect } from "@playwright/test";
import {
  captureVisual,
  employeeAccounts,
  loginAsAdmin,
  loginAsEmployee,
} from "./helpers";

test("主要画面は指定ビューポートで横スクロールせず表示できる", async ({ context, page }, testInfo) => {
  test.slow();

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "ログイン" })).toBeVisible();
  await expect(page.locator(".demo-account").first()).toBeVisible();
  await captureVisual(page, testInfo, "employee-login");

  await loginAsEmployee(page, employeeAccounts.maru);
  await expect(page.getByRole("button", { name: "退勤する" })).toBeVisible();
  await captureVisual(page, testInfo, "employee-today");

  await page.goto("/me/history");
  await expect(page.getByRole("heading", { name: "個人実績" })).toBeVisible();
  await expect(page.locator(".attendance-card").first()).toBeVisible();
  await captureVisual(page, testInfo, "employee-history");

  await page.goto("/me/requests");
  await expect(page.getByRole("heading", { name: "申請", exact: true })).toBeVisible();
  await expect(page.getByText("表示する申請がありません", { exact: true })).toBeVisible();
  await captureVisual(page, testInfo, "employee-requests");

  await context.clearCookies();
  await loginAsAdmin(page);
  await expect(page.getByRole("heading", { name: "当日の勤怠" })).toBeVisible();
  const todayResults = page.locator('[aria-labelledby="today-results-title"]');
  await expect(todayResults).toHaveAttribute("aria-busy", "false");
  await expect(todayResults.locator(".admin-results-panel")).toContainText("〇〇さん");
  await captureVisual(page, testInfo, "admin-today");

  await page.goto("/admin/sites");
  await expect(page.getByRole("heading", { name: "現場別の勤怠" })).toBeVisible();
  const siteResults = page.locator('[aria-labelledby="site-results-title"]');
  await expect(siteResults).toHaveAttribute("aria-busy", "false");
  await expect(siteResults.locator(".admin-results-panel")).toContainText("〇〇さん");
  await captureVisual(page, testInfo, "admin-sites");

  await page.goto("/admin/requests");
  await expect(page.getByRole("heading", { name: "申請一覧" })).toBeVisible();
  await page.getByLabel("状態").selectOption("all");
  const requestResults = page.locator(".admin-results-panel");
  await expect(requestResults).toContainText("◇◇さん");
  await expect(requestResults).toContainText("△△さん");
  await captureVisual(page, testInfo, "admin-requests");

  await page.goto("/admin/users");
  await expect(page.getByRole("heading", { name: "従業員を選ぶ" })).toBeVisible();
  const employeeGrid = page.locator(".admin-employee-grid");
  await expect(employeeGrid).toContainText("〇〇さん");
  await expect(employeeGrid).toContainText("△△さん");
  await captureVisual(page, testInfo, "admin-users");

  await page.goto("/admin/users/user-maru");
  await expect(page.getByRole("heading", { name: "〇〇さん" })).toBeVisible();
  const userAttendanceSection = page.locator("section[aria-busy]").filter({
    has: page.locator(".admin-result-summary"),
  });
  await expect(userAttendanceSection).toHaveAttribute("aria-busy", "false");
  await expect(userAttendanceSection.locator(".admin-result-summary")).toContainText("〇〇さん");
  await captureVisual(page, testInfo, "admin-user-attendance");

  await page.goto("/admin/audit");
  await expect(page.getByRole("heading", { name: "監査ログ" })).toBeVisible();
  const auditList = page.locator(".admin-audit-list");
  await expect(auditList).toContainText("〇〇さん");
  await expect(auditList.locator(".admin-audit-entry").first()).toBeVisible();
  await captureVisual(page, testInfo, "admin-audit");
});
