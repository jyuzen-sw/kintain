import { defineConfig, devices } from "@playwright/test";

const port = process.env.E2E_PORT ?? "4173";
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 12_000 },
  outputDir: "test-results",
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  use: {
    baseURL,
    locale: "ja-JP",
    serviceWorkers: "allow",
    timezoneId: "Asia/Tokyo",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "functional",
      testMatch: /functional\.spec\.ts/u,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "mobile-390x844",
      dependencies: ["functional"],
      testMatch: /visual\.spec\.ts/u,
      use: {
        ...devices["iPhone 13"],
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: "mobile-430x932",
      dependencies: ["functional"],
      testMatch: /visual\.spec\.ts/u,
      use: { ...devices["Pixel 7"], viewport: { width: 430, height: 932 } },
    },
    {
      name: "tablet-768x1024",
      dependencies: ["functional"],
      testMatch: /visual\.spec\.ts/u,
      use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 } },
    },
    {
      name: "desktop-1440x900",
      dependencies: ["functional"],
      testMatch: /visual\.spec\.ts/u,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: "node --import tsx scripts/e2e-server.ts",
    env: { E2E_PORT: port },
    url: baseURL,
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
