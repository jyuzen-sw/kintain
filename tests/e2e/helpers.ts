import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";

export const employeeAccounts = {
  maru: {
    email: "maru.employee@example.test",
    password: "DemoPass!2026",
  },
  sankaku: {
    email: "sankaku.employee@example.test",
    password: "DemoPass!2026",
  },
} as const;

export const adminAccount = {
  email: "admin@example.test",
  password: "AdminDemo!2026",
} as const;

export function shiftWorkDate(workDate: string, offsetDays: number): string {
  const [year, month, day] = workDate.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + offsetDays));
  return shifted.toISOString().slice(0, 10);
}

export async function waitForClientReady(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          !("serviceWorker" in globalThis.navigator) ||
          globalThis.navigator.serviceWorker.controller !== null,
      ),
    )
    .toBe(true);
  await expect(page.getByRole("heading", { name: "ログイン" })).toBeVisible();
}

export async function loginAsEmployee(
  page: Page,
  account: (typeof employeeAccounts)[keyof typeof employeeAccounts],
) {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "ログイン" })).toBeVisible();
  await waitForClientReady(page);
  await page.getByLabel("メールアドレス").fill(account.email);
  await page.getByLabel("パスワード").fill(account.password);
  const loginResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/auth/login") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "ログインする" }).click();
  expect((await loginResponse).ok()).toBe(true);
  await page.waitForURL(/\/app(?:\?.*)?$/u);
}

export async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "ログイン" })).toBeVisible();
  await waitForClientReady(page);
  await page.getByLabel("メールアドレス").fill(adminAccount.email);
  await page.getByLabel("パスワード").fill(adminAccount.password);
  const loginResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/auth/login") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "ログインする" }).click();
  expect((await loginResponse).ok()).toBe(true);
  await page.waitForURL(/\/admin\/today(?:\?.*)?$/u);
}

export async function expectNoPageHorizontalScroll(page: Page) {
  await page.evaluate(async () => {
    await globalThis.document.fonts?.ready;
  });
  try {
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            globalThis.document.documentElement.scrollWidth -
            globalThis.document.documentElement.clientWidth,
        ),
      )
      .toBeLessThanOrEqual(1);
  } catch (error) {
    const diagnostics = await page.evaluate(() => {
      const root = globalThis.document.documentElement;
      const viewportWidth = root.clientWidth;
      const candidates = [globalThis.document.body, ...globalThis.document.body.querySelectorAll("*")];
      const offenders = candidates.flatMap((element) => {
        const rectangle = element.getBoundingClientRect();
        if (rectangle.right <= viewportWidth + 1 && rectangle.left >= -1) return [];
        const classes = [...element.classList].slice(0, 3).join(".");
        return [{
          element: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${classes ? `.${classes}` : ""}`,
          left: Math.round(rectangle.left),
          right: Math.round(rectangle.right),
          width: Math.round(rectangle.width),
        }];
      });
      return {
        clientWidth: viewportWidth,
        innerWidth: globalThis.innerWidth,
        offenders: offenders.slice(0, 20),
        scrollWidth: root.scrollWidth,
      };
    });
    throw new Error(`横スクロールを検出しました: ${JSON.stringify(diagnostics)}`, {
      cause: error,
    });
  }
}

export async function captureVisual(
  page: Page,
  testInfo: TestInfo,
  name: string,
) {
  const outputDirectory = resolve(process.cwd(), "artifacts/visual-qa");
  mkdirSync(outputDirectory, { recursive: true });
  await expectNoPageHorizontalScroll(page);
  await page.screenshot({
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    path: resolve(outputDirectory, `${testInfo.project.name}-${name}.png`),
  });
}
