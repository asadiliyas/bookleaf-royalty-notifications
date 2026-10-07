import { defineConfig } from "@playwright/test";

try {
  process.loadEnvFile(".env");
} catch {
  // no .env: rely on the environment
}

// End-to-end tests against the live Bubble app (BUBBLE_APP_URL in .env).
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1, // Bubble's free plan is slow; keep tests sequential
  reporter: [["list"]],
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
});
