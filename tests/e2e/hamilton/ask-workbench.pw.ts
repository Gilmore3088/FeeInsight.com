/**
 * Ask Hamilton as a research workbench (#1895): opened from a fee's page, Ask shows the fee it
 * carries before the first question, answers "How do we compare with peers?" for that fee without
 * asking which fee, shows the context it used on the answer, and lays the answer out in the
 * standard blocks. No provider is called (serve.mjs blanks every key). HAMILTON_SCREENS_DIR=<dir>
 * saves desktop and phone screenshots.
 */
import path from "node:path";
import { expect, test, type Page } from "playwright/test";
import { FIXTURE_USERS, HOME, connectFixtureDb } from "./fixtures";
import { ask, signIn } from "./helpers";

async function shoot(page: Page, name: string): Promise<void> {
  const dir = process.env.HAMILTON_SCREENS_DIR;
  if (!dir) return;
  // The start screen fades in; shoot it settled.
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

test.describe("Ask research workbench (#1895)", () => {
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
    test(`a fee page's question at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width > 500 ? 900 : 844 });
      const start = `/pro/analyze?instId=${HOME.id}&fee=overdraft`;
      await signIn(page, FIXTURE_USERS.pro.email, start);
      await page.goto(start);
      await expect(page.getByText("Fee: Overdraft (OD), from the page you came from")).toBeVisible();
      await shoot(page, `start-${width}`);

      await ask(page, "How do we compare with peers?");
      const context = page.getByRole("region", { name: "Context this answer used" });
      await expect(context).toBeVisible();
      await expect(context).toContainText("Overdraft (OD)");
      await expect(context).toContainText("from the page you came from");
      await expect(page.getByText("Which fee do you want to look at?")).toHaveCount(0);
      for (const block of ["Summary", "Key figures", "Charts", "Evidence", "Limitations", "Next steps"]) {
        await expect(page.getByText(block, { exact: true }).first()).toBeVisible();
      }
      await expect(page.getByRole("link", { name: "Review assumptions" })).toHaveAttribute("href", "#answer-limitations");
      await expect(page.getByRole("link", { name: "Compare peers" })).toHaveAttribute("href", new RegExp(`^/pro/research\\?fee=overdraft&instId=${HOME.id}`));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await shoot(page, `answer-${width}`);
    });
  }
});
