import { defineConfig } from "@playwright/test";

const port = Number(process.env.ADROBOT_E2E_APP_PORT || 18782);
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 12_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    ...(process.env.ADROBOT_E2E_BROWSER_CHANNEL
      ? { channel: process.env.ADROBOT_E2E_BROWSER_CHANNEL }
      : {}),
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run build && node e2e/start.mjs",
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 90_000,
  },
});
