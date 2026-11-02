/**
 * Try a price on real figures (Hamilton redesign, Nov 2026): Capital City Bank's live overdraft
 * price among Florida's published fees (ccb-fixture.data.json). Drags the price, types a yearly
 * count, and checks the readouts, the folded notes and the 390px layout.
 * HAMILTON_SCREENS_DIR=<dir> saves try-price-ccb-1440.png and -390.png, and the same compared
 * nationally as try-price-ccb-national-1440.png and -390.png.
 */
import path from "node:path";
import { expect, test, type Page } from "playwright/test";
import { CCB_NAME, lendFixtureAccount, returnFixtureAccount, seedCcbFixture, teardownCcbFixture } from "./ccb-fixture";
import { FIXTURE_USERS, connectFixtureDb } from "./fixtures";
import { signIn } from "./helpers";

async function shoot(page: Page, name: string): Promise<void> {
  const dir = process.env.HAMILTON_SCREENS_DIR;
  if (!dir) return;
  // A dev server's error-overlay badge is not part of the page, nor is a focused skip link.
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

test.describe("Try a price on Capital City Bank's figures", () => {
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
    test(`drag a price and size it at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width > 500 ? 900 : 844 });
      await signIn(page, FIXTURE_USERS.pro.email, "/pro/simulate?fee=overdraft");
      // The account is linked to Capital City Bank for this file (lendFixtureAccount): no instId needed.
      await page.goto("/pro/simulate?fee=overdraft");
      await expect(page.getByRole("heading", { name: "Test a new price", level: 1 })).toBeVisible();
      await expect(page.getByText(`${CCB_NAME} charges`)).toBeVisible();
      await expect(page.getByText("No change")).toBeVisible();

      // The controls work once the page has hydrated.
      await page.waitForLoadState("networkidle");
      await page.getByLabel("Drag to set the price").fill("30");
      await expect(page.getByLabel("Proposed price in dollars")).toHaveValue("30");
      await expect(page.getByRole("img", { name: /Proposed \$30:/ })).toBeVisible();

      const income = page.locator("#tp-income-out");
      await expect(income).toContainText("Type your yearly count");
      await page.getByLabel("Items charged a year").fill("14500");
      await expect(income).toContainText("14,500 items");

      for (const details of await page.locator("details.hd-more").all()) await expect(details).not.toHaveAttribute("open", /.*/);
      await expect(page.getByText(/Frost Bank|Space Coast/)).toHaveCount(0);
      await expect(page.getByText(/forecast/i)).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await shoot(page, `try-price-ccb-${width}`);

      // National has the widest counts ("▲ 1520 charge more ..."): they wrap on a phone, never scroll.
      await page.getByRole("group", { name: "Compare with" }).getByRole("button", { name: "National" }).click();
      await expect(page.getByRole("heading", { name: /across institutions nationally/ })).toBeVisible();
      await expect(page.getByRole("list", { name: /charging more/ }).getByText(/^National \(\d+\)$/)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await shoot(page, `try-price-ccb-national-${width}`);
    });
  }
});
