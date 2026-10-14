import { defineConfig, devices } from "@playwright/test";
import { TEST_ORIGIN } from "./tests/e2e/local-stack.mjs";

export default defineConfig({
  testDir: "./tests/e2e", testMatch: "**/*.spec.ts", fullyParallel: false, workers: 1,
  timeout: 120_000, expect: { timeout: 15_000 }, retries: 0,
  outputDir: "tmp/e2e/results", reporter: [["list"], ["json", { outputFile: "tmp/e2e/results.json" }]],
  use: { baseURL: TEST_ORIGIN, trace: "off", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node --import ./tests/e2e/provider-fixture.mjs node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3100",
    url: `${TEST_ORIGIN}/api/health`, reuseExistingServer: false, timeout: 60_000,
  },
});
