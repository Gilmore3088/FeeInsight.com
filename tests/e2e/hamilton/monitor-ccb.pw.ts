/**
 * Alerts and watches on real figures (Hamilton redesign, Nov 2026): Capital City Bank's account,
 * watching three of its Florida peers, from the read-only production copy in ccb-fixture.data.json.
 * The copy holds no fee-change records, so the feed shows what the page says with none on file.
 * HAMILTON_SCREENS_DIR=<dir> saves monitor-ccb-1440.png and -390.png.
 */
import path from "node:path";
import { expect, test, type Page } from "playwright/test";
import { CCB_NAME, lendFixtureAccount, returnFixtureAccount, seedCcbFixture, teardownCcbFixture } from "./ccb-fixture";
import { FIXTURE_USERS, connectFixtureDb } from "./fixtures";
import { signIn } from "./helpers";

const WATCHED = [
  { id: 330, name: "First Federal Bank" },
  { id: 458, name: "U. S. Century Bank" },
  { id: 540, name: "Crews Bank & Trust" },
];

async function shoot(page: Page, name: string): Promise<void> {
  const dir = process.env.HAMILTON_SCREENS_DIR;
  if (!dir) return;
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

test.describe("alerts and watches on Capital City Bank's figures", () => {
  test.beforeAll(async () => {
    const db = connectFixtureDb();
    try {
      await seedCcbFixture(db);
      await lendFixtureAccount(db);
      await db`DELETE FROM hamilton_watchlists WHERE user_id = ${FIXTURE_USERS.pro.id}`;
      await db`INSERT INTO hamilton_watchlists (user_id, institution_ids, fee_categories, regions, peer_set_ids, selected_source, selected_source_label)
               VALUES (${FIXTURE_USERS.pro.id}, ${db.json(WATCHED.map((w) => String(w.id)))}, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'watchlist', 'Watchlist')`;
    } finally {
      await db.end();
    }
  });

  test.afterAll(async () => {
    if (process.env.HAMILTON_E2E_KEEP === "1") return;
    const db = connectFixtureDb();
    try {
      await db`DELETE FROM hamilton_watchlists WHERE user_id = ${FIXTURE_USERS.pro.id}`;
      await returnFixtureAccount(db);
      await teardownCcbFixture(db);
    } finally {
      await db.end();
    }
  });

  for (const width of [1440, 390]) {
    test(`alerts and watches at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width > 500 ? 900 : 844 });
      await signIn(page, FIXTURE_USERS.pro.email, "/pro/monitor");
      await page.goto("/pro/monitor");
      await expect(page.getByRole("heading", { name: "Alerts and watches", level: 1 })).toBeVisible();
      await expect(page.getByText(`What changed · ${CCB_NAME}`)).toBeVisible();
      await expect(page.getByText("Florida changes, 180 days")).toBeVisible();
      const watches = page.getByRole("table", { name: "Institutions you watch" });
      for (const w of WATCHED) {
        await expect(watches).toContainText(w.name);
        await expect(page.getByRole("switch", { name: `Watch ${w.name}` })).toHaveAttribute("aria-checked", "true");
      }
      await expect(page.getByRole("group", { name: "2. Pick one" }).getByRole("button", { name: CCB_NAME })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Fee changes, nationwide", level: 2 })).toBeVisible();
      for (const summary of await page.locator("details.hd-more").all()) await expect(summary).not.toHaveAttribute("open", /.*/);
      await expect(page.getByText(/Frost Bank|Space Coast/)).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await shoot(page, `monitor-ccb-${width}`);
    });
  }
});
