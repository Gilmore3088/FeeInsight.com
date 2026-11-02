/**
 * The Command center on real figures (Hamilton redesign, Nov 2026): Capital City Bank with its
 * live published fees, twelve FDIC quarters, its local market and Florida's medians, copied from
 * production into ccb-fixture.data.json. Checks the populated dashboard and that the long source
 * notes start folded. HAMILTON_SCREENS_DIR=<dir> saves command-center-ccb-1440.png and -390.png.
 */
import path from "node:path";
import { expect, test, type Page } from "playwright/test";
import { CCB_NAME, lendFixtureAccount, returnFixtureAccount, seedCcbFixture, teardownCcbFixture } from "./ccb-fixture";
import { FIXTURE_USERS, connectFixtureDb } from "./fixtures";
import { signIn } from "./helpers";

async function shoot(page: Page, name: string): Promise<void> {
  const dir = process.env.HAMILTON_SCREENS_DIR;
  if (!dir) return;
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

test.describe("command center on Capital City Bank's figures", () => {
  test.beforeAll(async () => {
    const db = connectFixtureDb();
    try {
      await seedCcbFixture(db);
      await lendFixtureAccount(db);
    } finally {
      await db.end();
    }
  });

  test.afterAll(async () => {
    if (process.env.HAMILTON_E2E_KEEP === "1") return;
    const db = connectFixtureDb();
    try {
      await returnFixtureAccount(db);
      await teardownCcbFixture(db);
    } finally {
      await db.end();
    }
  });

  for (const width of [1440, 390]) {
    test(`a populated dashboard at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width > 500 ? 900 : 844 });
      await signIn(page, FIXTURE_USERS.pro.email, "/pro/hamilton");
      // The account is linked to Capital City Bank for this file (lendFixtureAccount): no instId needed.
      await page.goto("/pro/hamilton");
      await expect(page.getByRole("heading", { name: CCB_NAME, level: 1 })).toBeVisible();
      await expect(page.getByText("Command center · latest filing Q2 2026")).toBeVisible();

      const kpis = page.getByRole("region", { name: "Key figures. Choose one to chart it." });
      await expect(kpis.getByRole("button")).toHaveCount(4);
      await expect(kpis.getByRole("button", { name: /Service charges, last 4 quarters/ })).toContainText("$22.9M");
      await expect(kpis.getByRole("button", { name: /Return on assets/ })).toContainText("1.53%");
      await expect(page.getByRole("heading", { name: "Service charges on deposits by quarter", level: 2 })).toBeVisible();
      await expect(page.getByText("Source: FDIC call reports, Q3 2023 to Q2 2026.")).toBeVisible();

      // Coverage and the chart caveats start folded: one short line each, the rest behind a summary.
      const coverage = page.getByRole("region", { name: "Coverage and freshness" });
      await expect(coverage.getByText(/^Coverage: \d+ published fees on file/)).toBeVisible();
      await expect(coverage.locator("details")).not.toHaveAttribute("open", /.*/);
      for (const summary of await page.locator("details.hd-more").all()) await expect(summary).not.toHaveAttribute("open", /.*/);

      await expect(page.getByRole("heading", { name: "Your fees against institutions in Florida", level: 2 })).toBeVisible();
      const scorecard = page.getByRole("table", { name: `${CCB_NAME} beside its largest local competitors` });
      await expect(scorecard.getByText("Seacoast National Bank")).toBeVisible();
      await expect(page.getByText(/Frost Bank|Space Coast/)).toHaveCount(0);

      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await shoot(page, `command-center-ccb-${width}`);

      await coverage.locator("summary").click();
      await expect(coverage.getByText(/Last verified against its schedule on/)).toBeVisible();
    });
  }
});
