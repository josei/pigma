import { defineConfig, devices } from '@playwright/test';

/**
 * Browser QA is reproducible from the repo: `npm run test:browser` starts the
 * Vite dev server itself and drives Chromium against it.
 */
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // A retry is what makes `trace: 'on-first-retry'` produce a trace at all, so
  // the local run must have one too: with retries=0 a genuine first-attempt
  // failure wrote NO trace locally, which defeats the point of keeping traces.
  // Raising the local retries rather than switching the local trace mode to
  // `retain-on-failure` is deliberate - that mode records for EVERY test, which
  // is exactly the parallel-teardown race this configuration just removed.
  retries: 1,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: 'http://127.0.0.1:5173',
    // `retain-on-failure` RECORDS for every test and keeps the file only on
    // failure. Under `fullyParallel` that means many workers writing trace
    // recordings into the shared artifacts directory at once, and the teardown
    // races: `browserContext.close: ENOENT ... .playwright-artifacts-N/traces/...`.
    // The test itself passed; the close failed, so Playwright retried it and
    // reported a "flaky" test - 20/8/15 of them across three parallel runs.
    // Recording only when a retry actually happens removes the contention while
    // keeping a trace for the case that needs one.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5173 --strictPort',
    url: 'http://127.0.0.1:5173',
    // This repo is a local/agent harness: a dev server on 5173 is normally ours,
    // so reuse it. Set PW_FRESH_SERVER=1 to force a private one (real CI).
    reuseExistingServer: process.env.PW_FRESH_SERVER !== '1',
    timeout: 120_000,
  },
});
