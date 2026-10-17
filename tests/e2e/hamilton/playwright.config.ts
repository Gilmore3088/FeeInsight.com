/**
 * Hamilton browser journeys (H07-T03, T04, #982): a person runs these locally with
 * `npm run test:hamilton-journeys` (steps in
 * docs/project/findings/2026-10-17-hamilton-release-runbook.md). Not wired into CI (T05).
 *
 * The suite seeds tests/e2e/hamilton/fixtures.ts into the local database named by
 * E2E_DATABASE_URL, starts a production build (`next start`) on HAMILTON_E2E_PORT (3197) through serve.mjs with every
 * provider key blanked, and drives the pre-installed Chromium. It never downloads a browser.
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "playwright/test";

const port = Number(process.env.HAMILTON_E2E_PORT ?? 3197);
const root = path.resolve(__dirname, "../../..");

/** The newest pre-installed Chromium under PLAYWRIGHT_BROWSERS_PATH, when Playwright's own revision is absent. */
function preinstalledChromium(): string | undefined {
  if (process.env.HAMILTON_E2E_CHROMIUM) return process.env.HAMILTON_E2E_CHROMIUM;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers";
  if (!existsSync(base)) return undefined;
  const found = readdirSync(base)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))
    .map((name) => ["chrome-linux64", "chrome-linux"].map((dir) => path.join(base, name, dir, "chrome")).find(existsSync))
    .find(Boolean);
  return found;
}

export default defineConfig({
  testDir: __dirname,
  // *.pw.ts so Vitest never collects these files.
  testMatch: /.*\.pw\.ts$/,
  outputDir: path.join(root, "test-results/hamilton-journeys"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: [["list"], ["html", { outputFolder: path.join(root, "test-results/hamilton-journeys-report"), open: "never" }]],
  globalSetup: path.join(__dirname, "global-setup.ts"),
  globalTeardown: path.join(__dirname, "global-teardown.ts"),
  use: {
    baseURL: `http://localhost:${port}`,
    acceptDownloads: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: { executablePath: preinstalledChromium() },
  },
  webServer: {
    command: "node tests/e2e/hamilton/serve.mjs",
    cwd: root,
    url: `http://localhost:${port}/login`,
    reuseExistingServer: true,
    timeout: 240_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
