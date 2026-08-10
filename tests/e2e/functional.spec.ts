import { execFileSync } from "node:child_process";
import { test, expect } from "@playwright/test";
import {
  adminAccount,
  employeeAccounts,
  loginAsAdmin,
  loginAsEmployee,
  waitForClientReady,
} from "./helpers";

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  execFileSync(
    process.execPath,
    ["--import", "tsx", "scripts/local-db.ts", "reset"],
    { cwd: process.cwd(), stdio: "inherit" },
  );
});

test("従業員は実認証後、公開デモで実GPSを取得せず打刻し、本人画面を確認できる", async ({ page }) => {
  await page.addInitScript(() => {
    const testWindow = globalThis as typeof globalThis & {
      __kintainGeolocationRequested?: boolean;
    };
    testWindow.__kintainGeolocationRequested = false;
    const denied = {
      getCurrentPosition: (
        _success: PositionCallback,
        error: PositionErrorCallback,
      ) => {
        testWindow.__kintainGeolocationRequested = true;
        error({
          code: 1,
          message: "Permission denied by E2E",
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
        });
      },
    };
    Object.defineProperty(globalThis.navigator, "geolocation", {
      configurable: true,
      value: denied,
    });
  });

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "ログイン" })).toBeVisible();
  await waitForClientReady(page);
  const sankakuDemoAccount = page.locator(".demo-account").filter({ hasText: "△△さん" });
  await expect(sankakuDemoAccount).toBeVisible();
  await sankakuDemoAccount.click();
  await expect(page.getByLabel("メールアドレス")).toHaveValue(
    employeeAccounts.sankaku.email,
  );
  await expect(page.getByLabel("パスワード")).toHaveValue(
    employeeAccounts.sankaku.password,
  );
  const loginResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/auth/login") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "ログインする" }).click();
  const loginResponse = await loginResponsePromise;
  expect(loginResponse.ok()).toBe(true);
  expect(loginResponse.request().postDataJSON()).toEqual({
    email: employeeAccounts.sankaku.email,
    password: employeeAccounts.sankaku.password,
  });
  await page.waitForURL(/\/app(?:\?.*)?$/u);
  await expect(page.getByRole("button", { name: "出勤する" })).toBeVisible();

  const punchResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/me/punch") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "出勤する" }).click();
  const punchResponse = await punchResponsePromise;
  expect(punchResponse.status()).toBe(200);
  expect(punchResponse.request().postDataJSON()).toMatchObject({
    type: "clock_in",
    location: {
      state: "unavailable",
      latitude: null,
      longitude: null,
    },
  });
  expect(await page.evaluate(() => {
    const testWindow = globalThis as typeof globalThis & {
      __kintainGeolocationRequested?: boolean;
    };
    return testWindow.__kintainGeolocationRequested;
  })).toBe(false);
  await expect(page.getByText("勤務中", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "退勤する" })).toBeVisible();
  await expect(page.getByText(/位置情報なしで記録しました/u)).toBeVisible();

  await page.getByRole("link", { name: "実績", exact: true }).click();
  await expect(page.getByRole("heading", { name: "個人実績" })).toBeVisible();
  await expect(page.locator(".attendance-card").first()).toBeVisible();

  await page.getByRole("link", { name: "申請", exact: true }).click();
  await expect(page.getByRole("heading", { name: "申請", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "新しく申請する" })).toBeVisible();
});

test("ManifestとService Workerが有効で、API応答はキャッシュされない", async ({ page }) => {
  await loginAsEmployee(page, employeeAccounts.maru);

  const manifest = await page.request.get("/manifest.webmanifest");
  await expect(manifest).toBeOK();
  await expect(manifest.json()).resolves.toMatchObject({
    start_url: "/app",
    display: "standalone",
    theme_color: "#0B6B63",
  });

  const worker = await page.request.get("/sw.js");
  await expect(worker).toBeOK();
  expect(await worker.text()).toContain('url.pathname.startsWith("/api/")');

  const serviceWorkerUrl = await page.evaluate(async () => {
    const registration = await globalThis.navigator.serviceWorker.ready;
    return registration.active?.scriptURL ?? "";
  });
  expect(serviceWorkerUrl).toMatch(/\/sw\.js$/u);

  const apiResult = await page.evaluate(async () => {
    const response = await globalThis.fetch("/api/me/today", {
      cache: "no-store",
      credentials: "same-origin",
    });
    const cached = await globalThis.caches.match("/api/me/today");
    return {
      cacheControl: response.headers.get("cache-control"),
      cached: Boolean(cached),
      status: response.status,
    };
  });
  expect(apiResult).toEqual({
    cacheControl: "no-store",
    cached: false,
    status: 200,
  });

  await expect.poll(async () => page.evaluate(async () => {
    const cache = await globalThis.caches.open("kintain-static-v3");
    return Boolean(await cache.match("/app-shell.html"));
  })).toBe(true);
  await expect.poll(async () => page.evaluate(
    () => globalThis.navigator.serviceWorker.controller?.state,
  )).toBe("activated");

  await page.context().setOffline(true);
  try {
    await expect(page.locator(".connection-banner")).toContainText("オフラインです");
    const cachedShell = await page.evaluate(async () => {
      const response = await globalThis.caches.match("/app-shell.html");
      return response?.text() ?? "";
    });
    expect(cachedShell).toContain("現在オフラインです");
    expect(cachedShell).toContain("打刻や保存は行われていない");
  } finally {
    await page.context().setOffline(false);
  }
});

test("従業員は本人の実績について項目別の修正履歴を確認できる", async ({ page }) => {
  await loginAsEmployee(page, employeeAccounts.maru);
  await page.getByRole("link", { name: "実績", exact: true }).click();
  const auditedDay = page.locator(".attendance-card").filter({
    has: page.getByRole("button", { name: "修正履歴あり", exact: true }),
  });
  await expect(auditedDay).toBeVisible();

  const auditResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/me/attendance/attendance-maru-yesterday/audit") &&
      response.request().method() === "GET",
  );
  await auditedDay.getByRole("button", { name: "修正履歴あり" }).click();
  const auditResponse = await auditResponsePromise;
  expect(auditResponse.status()).toBe(200);
  expect(auditResponse.headers()["cache-control"]).toContain("no-store");

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("打刻時刻を見直したため", { exact: true })).toBeVisible();
  await expect(dialog.getByText("〇〇さん", { exact: true })).toBeVisible();
  const clockInDifference = dialog.getByRole("row").filter({ hasText: "出勤時刻" });
  await expect(clockInDifference).toContainText("09:12");
  await expect(clockInDifference).toContainText("09:05");
  await dialog.getByRole("button", { name: "修正履歴を閉じる" }).click();
  await expect(dialog).toBeHidden();
});

test("従業員の実績修正が競合した場合、編集を閉じて最新の月次実績を再読込する", async ({ page }) => {
  await loginAsEmployee(page, employeeAccounts.maru);
  await page.getByRole("link", { name: "実績", exact: true }).click();
  const editableDay = page.locator(".attendance-card").filter({
    has: page.getByRole("button", { name: "この日の実績を修正する" }),
  }).first();
  await expect(editableDay).toBeVisible();

  let patchCount = 0;
  await page.route("**/api/me/attendance/*", async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.continue();
      return;
    }
    patchCount += 1;
    await route.fulfill({
      body: JSON.stringify({
        error: {
          code: "ATTENDANCE_VERSION_CONFLICT",
          message: "他の更新が反映されています。",
        },
      }),
      contentType: "application/json",
      status: 409,
    });
  });

  await editableDay.getByRole("button", { name: "この日の実績を修正する" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const reloadResponsePromise = page.waitForResponse(
    (response) => response.url().includes("/api/me/attendance?month=")
      && response.request().method() === "GET",
  );
  await dialog.getByRole("button", { name: "修正を保存する" }).click();
  const reloadResponse = await reloadResponsePromise;

  expect(patchCount).toBe(1);
  expect(reloadResponse.status()).toBe(200);
  await expect(dialog).toBeHidden();
  await expect(page.getByText("ほかの更新を検出したため、最新の実績を読み込みました。")).toBeVisible();
  await page.unroute("**/api/me/attendance/*");
});

test("月切替の読込に失敗した場合、新しい月の見出し下に前月の実績を残さない", async ({ page }) => {
  await loginAsEmployee(page, employeeAccounts.maru);
  await page.getByRole("link", { name: "実績", exact: true }).click();
  await expect(page.locator(".attendance-card").first()).toBeVisible();
  const displayedMonth = await page.getByLabel("表示月").inputValue();

  await page.route(/\/api\/me\/attendance\?month=/u, async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        error: {
          code: "TEMPORARILY_UNAVAILABLE",
          message: "月次実績を読み込めませんでした。",
        },
      }),
      contentType: "application/json",
      status: 503,
    });
  }, { times: 1 });
  await page.getByRole("button", { name: "前月を表示" }).click();

  await expect(page.getByRole("alert")).toContainText("月次実績を読み込めませんでした。");
  await expect(page.getByLabel("表示月")).not.toHaveValue(displayedMonth);
  await expect(page.locator(".attendance-card")).toHaveCount(0);
});

test("従業員のセッションが切れた場合、開いていた本人実績をnextに保持してログインへ戻る", async ({ context, page }) => {
  await loginAsEmployee(page, employeeAccounts.maru);
  await page.getByRole("link", { name: "実績", exact: true }).click();
  await expect(page.locator(".attendance-card").first()).toBeVisible();

  await context.clearCookies();
  const unauthorizedAttendance = page.waitForResponse(
    (response) =>
      response.url().includes("/api/me/attendance?") &&
      response.status() === 401,
  );
  await page.getByRole("button", { name: "前月を表示" }).click();
  await unauthorizedAttendance;
  await page.waitForURL(/\/login\?next=/u);
  expect(new URL(page.url()).searchParams.get("next")).toBe("/me/history");
});

test("従業員が管理画面を直接開くとログイン画面へ戻される", async ({ context, page }) => {
  await loginAsEmployee(page, employeeAccounts.maru);
  const redirected = page.waitForURL(/\/login\?next=/u, {
    timeout: 12_000,
    waitUntil: "commit",
  });
  await page.goto("/admin/today");
  await redirected;
  expect(new URL(page.url()).searchParams.get("next")).toBe("/admin/today");
  await context.clearCookies();
});

test("管理者の申請審査が競合した場合、モーダルを閉じて最新の申請一覧を再取得する", async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole("link", { name: "申請", exact: true }).click();
  await expect(page.getByRole("heading", { name: "申請一覧" })).toBeVisible();
  const pendingRequest = page.getByRole("row").filter({ hasText: "□□さん" });
  await expect(pendingRequest).toContainText("申請中");

  const latestRequestsResponse = await page.request.get("/api/admin/requests");
  expect(latestRequestsResponse.status()).toBe(200);
  const latestRequestsBody = await latestRequestsResponse.text();

  let reviewAttempts = 0;
  await page.route("**/api/admin/requests/request-shikaku-pending/approve", async (route) => {
    reviewAttempts += 1;
    await route.fulfill({
      body: JSON.stringify({
        error: {
          code: "VERSION_CONFLICT",
          message: "他の審査結果が反映されています。",
        },
      }),
      contentType: "application/json",
      status: 409,
    });
  }, { times: 1 });
  await page.route("**/api/admin/requests", async (route) => {
    await route.fulfill({
      body: latestRequestsBody,
      contentType: "application/json",
      status: 200,
    });
  }, { times: 1 });

  await pendingRequest.getByRole("button", { name: "承認", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const conflictResponsePromise = page.waitForResponse(
    (response) => response.url().endsWith("/api/admin/requests/request-shikaku-pending/approve")
      && response.request().method() === "POST",
  );
  const reloadResponsePromise = page.waitForResponse(
    (response) => response.url().endsWith("/api/admin/requests")
      && response.request().method() === "GET",
  );
  await dialog.getByRole("button", { name: "申請を承認する" }).click();

  expect((await conflictResponsePromise).status()).toBe(409);
  expect((await reloadResponsePromise).status()).toBe(200);
  expect(reviewAttempts).toBe(1);
  await expect(dialog).toBeHidden();
  await expect(pendingRequest).toContainText("申請中");
  await expect(pendingRequest.getByRole("button", { name: "却下", exact: true })).toBeVisible();
});

test("管理者が現場を素早く切り替えても、遅い旧応答で最新の現場結果を上書きしない", async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole("link", { name: "現場別", exact: true }).click();
  await expect(page.getByRole("heading", { name: "現場別の勤怠" })).toBeVisible();
  const siteSelect = page.locator("select").filter({
    has: page.locator('option[value="site-b"]'),
  });
  await expect(siteSelect.locator('option[value="site-a"]')).toHaveText("A作業場");
  await expect(siteSelect.locator('option[value="site-b"]')).toHaveText("B現場");

  let releaseSiteA: (() => void) | undefined;
  const siteARelease = new Promise<void>((resolve) => {
    releaseSiteA = resolve;
  });
  let markSiteAStarted: (() => void) | undefined;
  const siteAStarted = new Promise<void>((resolve) => {
    markSiteAStarted = resolve;
  });
  await page.route(/\/api\/admin\/sites\?/u, async (route) => {
    const requestedSite = new URL(route.request().url()).searchParams.get("siteId");
    if (requestedSite === "site-a") {
      markSiteAStarted?.();
      await siteARelease;
    }
    await route.continue();
  });

  try {
    await siteSelect.selectOption("site-a");
    await siteAStarted;
    const siteBResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/admin/sites"
        && url.searchParams.get("siteId") === "site-b";
    });
    await siteSelect.selectOption("site-b");
    const siteBResponse = await siteBResponsePromise;
    expect(siteBResponse.status()).toBe(200);
    await expect(page.getByText(/B現場・/u)).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "△△さん" })).toBeVisible();

    const siteAResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/admin/sites"
        && url.searchParams.get("siteId") === "site-a";
    });
    releaseSiteA?.();
    expect((await siteAResponsePromise).status()).toBe(200);

    await expect(page.getByText(/B現場・/u)).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "△△さん" })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "○○さん" })).toHaveCount(0);
  } finally {
    releaseSiteA?.();
    await page.unroute(/\/api\/admin\/sites\?/u);
  }
});

test("管理者は実認証後、当日・現場・申請・個人実績・監査ログへ移動できる", async ({ page }) => {
  await loginAsAdmin(page);
  await expect(page.getByRole("heading", { name: "当日の勤怠" })).toBeVisible();

  await page.getByRole("link", { name: "現場別", exact: true }).click();
  await expect(page.getByRole("heading", { name: "現場別の勤怠" })).toBeVisible();

  await page.getByRole("link", { name: "申請", exact: true }).click();
  await expect(page.getByRole("heading", { name: "申請一覧" })).toBeVisible();
  const pendingRequest = page.getByRole("row").filter({ hasText: "□□さん" });
  await expect(pendingRequest).toContainText("申請中");
  await pendingRequest.getByRole("button", { name: "却下", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const rejectResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/admin/requests/request-shikaku-pending/reject") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "申請を却下する" }).click();
  const rejectResponse = await rejectResponsePromise;
  expect(rejectResponse.status()).toBe(200);
  expect(rejectResponse.request().postDataJSON()).toMatchObject({
    reviewComment: null,
  });
  await expect(page.getByText(/有休申請を却下しました。$/u)).toBeVisible();

  await page.getByRole("link", { name: "個人実績", exact: true }).click();
  await expect(page.getByRole("heading", { name: "従業員を選ぶ" })).toBeVisible();
  await page.getByRole("link").filter({ hasText: "〇〇さん" }).click();
  await expect(page.getByRole("heading", { name: "〇〇さん" })).toBeVisible();

  const filteredAuditResponsePromise = page.waitForResponse(
    (response) => {
      if (!response.url().includes("/api/admin/audit?")) return false;
      const query = new URL(response.url()).searchParams;
      return query.get("entityType") === "attendance_record"
        && query.get("entityId") === "attendance-maru-yesterday";
    },
  );
  await page.getByRole("link", { name: "履歴あり", exact: true }).click();
  const filteredAuditResponse = await filteredAuditResponsePromise;
  expect(filteredAuditResponse.status()).toBe(200);
  expect(new URL(page.url()).searchParams.get("entityId")).toBe("attendance-maru-yesterday");
  await expect(page.getByRole("heading", { name: "監査ログ" })).toBeVisible();
  await expect(page.getByText("〇〇さんの実績に絞り込み中")).toBeVisible();
  await expect(page.locator(".admin-audit-entry")).toHaveCount(1);

  await page.getByRole("link", { name: "解除", exact: true }).click();
  const auditTarget = page.getByLabel("対象");
  await expect(auditTarget).toBeEnabled();
  const requestAuditResponsePromise = page.waitForResponse((response) => {
    if (!response.url().includes("/api/admin/audit?")) return false;
    const query = new URL(response.url()).searchParams;
    return query.get("entityType") === "attendance_request"
      && query.get("entityId") === null;
  });
  await auditTarget.selectOption("attendance_request");
  expect((await requestAuditResponsePromise).status()).toBe(200);
  await expect(page.locator(".admin-audit-entry").first()).toContainText("申請・");

  const session = await page.request.get("/api/auth/session");
  await expect(session).toBeOK();
  expect(await session.json()).toMatchObject({
    data: { user: { email: adminAccount.email, role: "admin" } },
  });
  expect(session.headers()["cache-control"]).toContain("no-store");

  const adminMenu = page.getByLabel("管理者メニューを開く");
  await adminMenu.focus();
  await adminMenu.press("Enter");
  const resetButton = page.getByRole("button", {
    name: "デモデータを初期状態へ戻す",
  });
  await expect(resetButton).toBeVisible();
  page.once("dialog", (dialog) => {
    expect(dialog.message()).toContain("デモ用の勤怠・申請・監査ログ");
    void dialog.accept();
  });
  const resetResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/admin/reset") &&
      response.request().method() === "POST",
  );
  await resetButton.click();
  const resetResponse = await resetResponsePromise;
  expect(resetResponse.status()).toBe(200);
  await page.waitForURL(/\/admin\/today(?:\?.*)?$/u);
  await expect(page.getByText("デモデータを初期状態へ戻しました。")).toBeVisible();
});
