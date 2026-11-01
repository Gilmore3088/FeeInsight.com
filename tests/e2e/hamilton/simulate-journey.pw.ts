/**
 * Try a price journey (#1896): a Pro subscriber tests overdraft prices for the fixture home credit
 * union. Without the bank's own yearly volume the page places each price among peers' published
 * fees and shows no fee income figure; with the bank's figures it shows the yearly change and lists
 * every assumption beside it. Never a forecast. HAMILTON_SCREENS_DIR=<dir> also saves desktop and
 * phone screenshots.
 */
import path from "node:path";
import { expect, test, type Page } from "playwright/test";
import { FIXTURE_USERS, HOME, connectFixtureDb } from "./fixtures";
import { signIn } from "./helpers";

async function shoot(page: Page, name: string): Promise<void> {
  const dir = process.env.HAMILTON_SCREENS_DIR;
  if (!dir) return;
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

test.describe("Try a price (#1896)", () => {
  test.beforeAll(async () => {
    if (!process.env.HAMILTON_SCREENS_DIR) return;
    // Screenshots for review never show the shared fixture home's name; teardown and the next seed restore it.
    const db = connectFixtureDb();
    try {
      await db`UPDATE institution_sources SET institution_name = 'Lakeshore Test Credit Union' WHERE id = ${HOME.id}`;
      await db`UPDATE users SET institution_name = 'Lakeshore Test Credit Union' WHERE id = ${FIXTURE_USERS.pro.id}`;
    } finally {
      await db.end();
    }
  });

  for (const width of [1440, 390]) {
    test(`position only, then the bank's figures, at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width > 500 ? 900 : 844 });
      const base = `/pro/simulate?fee=overdraft&instId=${HOME.id}&prices=20,35`;
      await signIn(page, FIXTURE_USERS.pro.email, base);
      await page.goto(base);
      await expect(page.getByRole("heading", { level: 1 })).toContainText("price");
      await expect(page.getByText("No fee income is shown.", { exact: false })).toBeVisible();
      await expect(page.getByText(/per 1,000/)).toHaveCount(0);
      await expect(page.getByText(/forecast/i)).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await shoot(page, `position-only-${width}`);

      await page.goto(`${base}&paid=14500&waiver=10`);
      const assumptions = page.locator("#fee-income-assumptions");
      await expect(assumptions).toContainText("What the fee income figure assumes");
      await expect(assumptions).toContainText("Items charged a year: 14,500");
      await expect(assumptions).toContainText("not a prediction of fee income");
      await expect(page.getByText(/forecast/i)).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await shoot(page, `with-figures-${width}`);
    });
  }
});
