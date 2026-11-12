import { defineConfig, devices } from "@playwright/test";

const phone = { width: 390, height: 844 };
const ipad = { width: 820, height: 1180 };

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5173",
    url: "http://127.0.0.1:5173/aquarium-shop/",
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    { name: "phone", use: { ...devices["Desktop Chrome"], viewport: phone, hasTouch: true } },
    { name: "ipad", use: { ...devices["Desktop Chrome"], viewport: ipad, hasTouch: true } },
  ],
});
