/**
 * Research market explorer journey (Hamilton dashboard redesign, Nov 2026, Research.dc.html): a Pro
 * subscriber with an institution on file opens Research on its own state, reads the headline
 * figures with its own price placed, hovers the price histogram, reads a state from the map, sorts
 * and pages the institution table, and switches to the Fed district and national views. The older
 * `research` / `lens` / `size` links still open the same view.
 *
 * Seeds only what it needs on the shared fixtures (teardown removes them by institution and user):
 * the home's display name (the base fixture name echoes a real credit union's), each institution's
 * assets and the workspace selection. HAMILTON_SCREENS_DIR=<dir> also saves desktop and phone
 * screenshots.
 */
import path from "node:path";
import { expect, test, type Page } from "playwright/test";
import { ALL_INSTITUTIONS, FIXTURE_USERS, HOME, connectFixtureDb, type FixtureDb } from "./fixtures";
import { signIn } from "./helpers";

/** Screenshots never show the shared fixture home's name, which echoes a real credit union's. */
const HOME_NAME = "Lakeshore Test Credit Union";

async function seed(db: FixtureDb): Promise<void> {
  await db`UPDATE institution_sources SET institution_name = ${HOME_NAME} WHERE id = ${HOME.id}`;
  await db`UPDATE users SET institution_name = ${HOME_NAME} WHERE id = ${FIXTURE_USERS.pro.id}`;
  for (const inst of ALL_INSTITUTIONS) {
    await db`UPDATE institution_sources SET asset_size = ${inst.assetsThousands} WHERE id = ${inst.id}`;
  }
  await db`INSERT INTO hamilton_workspace_contexts (user_id, selected_institution_id, selected_source)
           VALUES (${FIXTURE_USERS.pro.id}, ${HOME.id}, 'manual')
           ON CONFLICT (user_id) DO UPDATE SET selected_institution_id = EXCLUDED.selected_institution_id`;
}

async function shoot(page: Page, name: string): Promise<void> {
  const dir = process.env.HAMILTON_SCREENS_DIR;
  if (!dir) return;
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

test.describe("research market explorer", () => {
  test.beforeAll(async () => {
    const db = connectFixtureDb();
    try {
      await seed(db);
    } finally {
      await db.end();
    }
  });

  for (const width of [1440, 390]) {
    test(`opens on the institution's state with its price placed at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width > 500 ? 900 : 844 });
      await signIn(page, FIXTURE_USERS.pro.email, "/pro/intelligence");
      await page.goto("/pro/intelligence");
      await expect(page.getByRole("heading", { name: "Overdraft across Florida", level: 1 })).toBeVisible();
      await expect(page.getByRole("button", { name: "Florida", exact: true })).toHaveAttribute("aria-pressed", "true");
      const heads = page.getByRole("region", { name: "Headline figures" });
      for (const label of ["Median", "Middle half", "Institutions counted", HOME_NAME]) await expect(heads.getByText(label, { exact: true })).toBeVisible();
      await expect(page.getByText(`${HOME_NAME} charges $27`)).toBeVisible();
      await expect(page.getByRole("img", { name: /^Overdraft prices, \d+ institutions/ })).toBeVisible();
      await expect(page.getByRole("group", { name: /States by median overdraft price/ })).toBeVisible();
      await expect(page.getByText("Space Coast")).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await shoot(page, `research-${width}`);

      // The histogram reads the band under the pointer; the map reads the chosen state.
      const bars = page.locator(".hd-hist-hits button");
      await bars.nth(12).hover();
      await expect(bars.nth(12)).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("button", { name: /^Georgia:/ }).click();
      await expect(page.locator(".hd-map-read").getByText("Georgia")).toBeVisible();

      // The table sorts by a column and pages; the subject's row is shaded.
      const table = page.getByRole("table", { name: /Overdraft at every institution in Florida/ });
      await expect(table.locator("tr.hd-subject")).toContainText(HOME_NAME);
      await table.getByRole("button", { name: /^Assets/ }).click();
      await expect(table.getByRole("columnheader", { name: /^Assets/ })).toHaveAttribute("aria-sort", "descending");
    });
  }

  test("district and national views, and older links still open", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, FIXTURE_USERS.pro.email, "/pro/intelligence");
    await page.goto(`/pro/intelligence?instId=${HOME.id}`);
    await page.getByRole("button", { name: "Fed district 6" }).click();
    await expect(page.getByRole("heading", { name: "Overdraft across Fed district 6", level: 1 })).toBeVisible();
    await expect(page).toHaveURL(/district=6/);
    await page.getByRole("button", { name: "National" }).click();
    await expect(page.getByRole("heading", { name: "Overdraft across the US", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "By state", level: 2 })).toBeVisible();
    await shoot(page, "research-national-1440");

    // A link from before the explorer: state scope, NSF first, banks only, a size, the fees lens.
    const research = JSON.stringify({ version: 1, task: "compare", scope: { kind: "state", stateCode: "FL" }, charter: "credit_union", categories: ["nsf", "overdraft"] });
    await page.goto(`/pro/intelligence?${new URLSearchParams({ research, lens: "fees", size: "1b-10b", instId: String(HOME.id) })}`);
    await expect(page.getByRole("heading", { name: "NSF / Returned Item across Florida", level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Credit unions" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "$1B to $10B" })).toHaveAttribute("aria-pressed", "true");
    // The other lenses are unchanged.
    await page.getByRole("link", { name: "Complaints" }).click();
    await expect(page).toHaveURL(/lens=complaints/);
  });
});
