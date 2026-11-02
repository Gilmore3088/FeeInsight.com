/**
 * Reports journey (Hamilton dashboard redesign, Nov 2026): a Pro subscriber opens Reports for the
 * fixture home, picks a report type, ticks and reorders the builder's sections, sees the page
 * preview redraw, and exports the PDF through the existing route. Desktop and phone widths, with no
 * sideways scroll on the phone. HAMILTON_SCREENS_DIR=<dir> also saves desktop and phone screenshots.
 */
import path from "node:path";
import { expect, test, type Page } from "playwright/test";
import { FIXTURE_USERS, HOME, connectFixtureDb } from "./fixtures";
import { signIn } from "./helpers";

/** Screenshots never show the shared fixture home's name, which echoes a real credit union's. */
const HOME_NAME = "Lakeshore Test Credit Union";

async function shoot(page: Page, name: string): Promise<void> {
  const dir = process.env.HAMILTON_SCREENS_DIR;
  if (!dir) return;
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

test.describe("reports builder", () => {
  test.beforeAll(async () => {
    const db = connectFixtureDb();
    try {
      await db`UPDATE institution_sources SET institution_name = ${HOME_NAME} WHERE id = ${HOME.id}`;
      await db`UPDATE users SET institution_name = ${HOME_NAME} WHERE id = ${FIXTURE_USERS.pro.id}`;
    } finally {
      await db.end();
    }
  });

  for (const width of [1440, 390]) {
    test(`builds, reorders and exports a report at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width > 500 ? 900 : 844 });
      await signIn(page, FIXTURE_USERS.pro.email, "/pro/reports");
      await page.goto(`/pro/reports?instId=${HOME.id}`);
      await expect(page.getByRole("heading", { name: "Briefs for your board and pricing committee", level: 1 })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Your saved reports", level: 2 })).toBeVisible();

      const board = page.getByRole("button", { name: /^Board summary/ });
      await expect(board).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("heading", { name: "Build: Board summary", level: 2 })).toBeVisible();
      await expect(page.getByText("4 of 7 on")).toBeVisible();

      // Tick a section and move it to the top: the preview renumbers.
      await page.getByRole("checkbox", { name: /What to resolve first/ }).check();
      await expect(page.getByText("5 of 7 on")).toBeVisible();
      for (let i = 0; i < 4; i += 1) await page.getByRole("button", { name: "Move What to resolve first up" }).click();
      await expect(page.getByRole("button", { name: "Move What to resolve first up" })).toBeDisabled();
      await expect(page.getByText("1. What to resolve first", { exact: true })).toBeVisible();

      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.getByRole("button", { name: "Committee", exact: true }).click();
      await page.locator("#report-builder").scrollIntoViewIfNeeded();
      await shoot(page, `reports-${width}`);

      const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export PDF" }).click()]);
      expect(download.suggestedFilename()).toMatch(/^board-summary-\d{4}-\d{2}-\d{2}\.pdf$/);
      await expect(page.getByRole("status")).toContainText("PDF ready");

      // The committee preset is one press away.
      await page.getByRole("button", { name: /^Committee fee review/ }).click();
      await expect(page.getByRole("heading", { name: "Build: Committee fee review", level: 2 })).toBeVisible();
    });
  }
});
