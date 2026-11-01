/**
 * Hamilton's median minimum (James, 2026-10-25; #1896): My fees and Try a price show a layer's
 * median and middle half only when at least 10 institutions publish the fee, or at least 5 in the
 * bank's local market. Below that they show the count, a plain note and the institutions by name.
 *
 * Uses the shared fixtures (tests/e2e/hamilton/fixtures.ts): the home's Florida layer has fewer
 * than 10 institutions publishing an overdraft fee. HAMILTON_SCREENS_DIR=<dir> also saves desktop
 * and phone screenshots.
 */
import path from "node:path";
import { expect, test, type Page } from "playwright/test";
import { FIXTURE_USERS, HOME, connectFixtureDb } from "./fixtures";
import { signIn } from "./helpers";

async function shoot(page: Page, name: string): Promise<void> {
  const dir = process.env.HAMILTON_SCREENS_DIR;
  if (!dir) return;
  // Let the page's fade-in finish, so a shot is never taken half drawn.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => null))));
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

test.describe("median minimum (#1896)", () => {
  test.beforeAll(async () => {
    if (!process.env.HAMILTON_SCREENS_DIR) return;
    // Screenshots for review never show the shared fixture home's name, which echoes a real
    // credit union's; teardown and the next seed restore it.
    const db = connectFixtureDb();
    try {
      await db`UPDATE institution_sources SET institution_name = 'Lakeshore Test Credit Union' WHERE id = ${HOME.id}`;
      await db`UPDATE users SET institution_name = 'Lakeshore Test Credit Union' WHERE id = ${FIXTURE_USERS.pro.id}`;
    } finally {
      await db.end();
    }
  });

  for (const width of [1440, 390]) {
    test(`My fees, a thin state layer, at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width > 500 ? 900 : 844 });
      const href = `/pro/research?fee=overdraft&layer=state&instId=${HOME.id}`;
      await signIn(page, FIXTURE_USERS.pro.email, href);
      await page.goto(href);
      const panel = page.locator("#layer-panel-state");
      await expect(panel).toBeVisible();
      await expect(panel).toContainText(/Only \d institutions? publish(es)? this fee here, fewer than the 10 needed for a median\./);
      await expect(panel).not.toContainText("Middle (median)");
      await expect(panel).not.toContainText("Middle half");
      await expect(panel).toContainText("Each institution, lowest price first:");
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
      await shoot(page, `my-fees-state-${width}`);
    });

    test(`Try a price, a thin state layer, at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width > 500 ? 900 : 844 });
      const href = `/pro/simulate?fee=overdraft&layer=state&instId=${HOME.id}`;
      await signIn(page, FIXTURE_USERS.pro.email, href);
      await page.goto(href);
      await expect(page.getByText(/fewer than the 10 needed for a median\./).first()).toBeVisible();
      // The thin median is never offered as a price to test: $0 and today's price plus $5 only.
      await expect(page.locator('input[name="prices"]')).toHaveValue("0, 32");
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
      await shoot(page, `try-a-price-state-${width}`);
    });
  }
});
