/**
 * Research's market explorer on real figures (Hamilton redesign, Nov 2026): Capital City Bank and
 * the Florida institutions in ccb-fixture.data.json (copied read-only from production). Checks the
 * populated explorer marks the bank throughout and that long notes start folded.
 * HAMILTON_SCREENS_DIR=<dir> saves research-ccb-1440.png and -390.png.
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

test.describe("research explorer on Capital City Bank's figures", () => {
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
    test(`a populated explorer at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width > 500 ? 900 : 844 });
      await signIn(page, FIXTURE_USERS.pro.email, "/pro/intelligence");
      await page.goto("/pro/intelligence");
      await expect(page.getByRole("heading", { name: /^Overdraft.* across Florida$/, level: 1 })).toBeVisible();
      const heads = page.getByRole("region", { name: "Headline figures" });
      await expect(heads.getByText(CCB_NAME, { exact: true })).toBeVisible();
      await expect(page.getByRole("img", { name: /^Overdraft.* prices, \d+ institutions/ })).toBeVisible();
      await expect(page.getByRole("table", { name: /at every institution in Florida/ }).locator("tr.hd-subject")).toContainText(CCB_NAME);
      for (const more of await page.locator("details.hd-more").all()) await expect(more).not.toHaveAttribute("open", /.*/);
      await expect(page.getByText(/Frost Bank|Space Coast/)).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await shoot(page, `research-ccb-${width}`);
    });
  }
});
