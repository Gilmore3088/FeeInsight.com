/**
 * Ask Hamilton on real figures (Hamilton redesign, Nov 2026): Capital City Bank's live published
 * fees and Florida peers from ccb-fixture.data.json. Asks two fee questions through the engine (no
 * provider: serve.mjs blanks every key), then reopens the answer beside the saved questions.
 * Checks the dashboard layout and that nothing scrolls sideways at 390px.
 * HAMILTON_SCREENS_DIR=<dir> saves ask-ccb-answer-<width>.png and ask-ccb-reopened-<width>.png.
 */
import path from "node:path";
import { expect, test, type Page } from "playwright/test";
import { CCB_ID, lendFixtureAccount, returnFixtureAccount, seedCcbFixture, teardownCcbFixture } from "./ccb-fixture";
import { FIXTURE_USERS, connectFixtureDb } from "./fixtures";
import { ask, signIn } from "./helpers";

async function shoot(page: Page, name: string): Promise<void> {
  const dir = process.env.HAMILTON_SCREENS_DIR;
  if (!dir) return;
  // A full-page shot draws sticky panels where the page is scrolled to; shoot it from the top.
  // No focused control (a "Skip to content" link) shows in the shot.
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

async function noSideScroll(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test.describe("Ask on Capital City Bank's figures", () => {
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
    test(`an answer laid out as the dashboard at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width > 500 ? 900 : 844 });
      const start = `/pro/analyze?instId=${CCB_ID}`;
      await signIn(page, FIXTURE_USERS.pro.email, start);

      // An earlier question, so the list of saved questions has more than the one on screen.
      await page.goto(start);
      await ask(page, "How does our non-network ATM fee compare with peers?");
      await expect(page.getByRole("heading", { name: "Evidence" })).toBeVisible({ timeout: 90_000 });

      await page.goto(start);
      await ask(page, "How does our overdraft fee compare with peers?");
      await expect(page.getByRole("heading", { name: "Evidence" })).toBeVisible({ timeout: 90_000 });
      await expect(page.getByRole("link", { name: "Try a price" }).first()).toBeVisible();
      await expect(page.getByRole("link", { name: "Add to board brief" }).first()).toBeVisible();
      await expect(page.getByRole("button", { name: /^Watch / }).first()).toBeVisible();
      await expect(page.getByText(/Frost Bank|Space Coast/)).toHaveCount(0);
      await noSideScroll(page);
      await shoot(page, `ask-ccb-answer-${width}`);

      // Reopened, the answer sits beside the saved questions, the open one marked.
      await page.waitForURL(/conversation=/, { timeout: 30_000 });
      await page.reload();
      const rail = page.getByRole("navigation", { name: "Your questions" });
      await expect(rail).toBeVisible();
      await expect(rail.getByRole("link")).not.toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Evidence" })).toBeVisible();
      const firstSource = page.getByRole("button", { name: /^Source 1:/ });
      await expect(firstSource).toHaveAttribute("aria-expanded", "true");
      await noSideScroll(page);
      await shoot(page, `ask-ccb-reopened-${width}`);
    });
  }
});
