/**
 * Monthly briefing journey (#1897): a Pro subscriber opens /pro/reports/monthly for the home
 * institution, builds this month's briefing on request, sees the six sections with each figure's
 * source and period, rewrites one section's words, saves, and downloads the PDF.
 *
 * Seeds synthetic filings for the home credit union and its twelve fixture peers, and synthetic
 * economic series, in the fixture id range or under series ids this local database alone holds;
 * afterAll removes them. HAMILTON_SCREENS_DIR=<dir> also saves desktop and phone screenshots and
 * the downloaded PDF.
 */
import path from "node:path";
import { expect, test, type Page } from "playwright/test";
import { FIXTURE_USERS, HOME, PEERS, connectFixtureDb, type FixtureDb } from "./fixtures";
import { signIn } from "./helpers";

/** The fixture home's shared name echoes a real credit union's; this journey shows a fictional one. */
const SHOWN_NAME = "Lakeshore Test Credit Union";
const RECORD_BASE = 9_707_000;
const ENDS = ["03-31", "06-30", "09-30", "12-31"];
/** Eight quarter ends, Q3 2024 to Q2 2026. */
const DATES = Array.from({ length: 8 }, (_, i) => `${2024 + Math.floor((i + 2) / 4)}-${ENDS[(i + 2) % 4]}`);
const SERIES = ["FEDFUNDS", "UNRATE", "FLUR"];
const MONTHS = Array.from({ length: 13 }, (_, i) => {
  const d = new Date(Date.UTC(2025, 8 + i, 1));
  return d.toISOString().slice(0, 10);
});

async function seed(db: FixtureDb): Promise<void> {
  const ids = [HOME.id, ...PEERS.map((p) => p.id)];
  await db`DELETE FROM institution_financial_records WHERE id BETWEEN ${RECORD_BASE} AND ${RECORD_BASE + 999}`;
  await db`UPDATE institution_sources SET institution_name = ${SHOWN_NAME} WHERE id = ${HOME.id}`;
  await db`UPDATE users SET institution_name = ${SHOWN_NAME} WHERE id = ${FIXTURE_USERS.pro.id}`;
  let recordId = RECORD_BASE;
  for (const [index, date] of DATES.entries()) {
    const year = date.slice(0, 4);
    for (const [n, id] of ids.entries()) {
      // Credit unions file fee income year to date: this quarter plus the earlier ones in the year.
      const own = (i: number) => Math.round((n === 0 ? 11_840 : 9_600 + n * 310) * (1 + i * 0.012) * (n === 0 && i === DATES.length - 1 ? 0.9 : 1));
      let ytd = 0;
      for (let i = index; i >= 0 && DATES[i].slice(0, 4) === year; i -= 1) ytd += own(i);
      const deposits = Math.round((n === 0 ? 7_420_000 : 6_100_000 + n * 140_000) * (1 + index * 0.01));
      const assets = Math.round(deposits * 1.19);
      recordId += 1;
      await db`INSERT INTO institution_financial_records (id, institution_id, report_date, source, service_charge_income, total_deposits, total_assets, raw_json, source_url, fetched_at)
               VALUES (${recordId}, ${id}, ${date}, 'ncua', ${ytd}, ${deposits}, ${assets}, ${db.json({ ACCT_131: ytd * 1000, ACCT_018: deposits * 1000, ACCT_010: assets * 1000 })},
                       ${`https://ncua.gov/files/publications/analysis/call-report-data-${year}-${date.slice(5, 7)}.zip`}, ${`${year}-${date.slice(5, 7)}-28T00:00:00Z`}::timestamptz + INTERVAL '45 days')`;
    }
  }
  await db`DELETE FROM fed_economic_indicators WHERE series_id = ANY(${SERIES})`;
  for (const [i, month] of MONTHS.entries()) {
    await db`INSERT INTO fed_economic_indicators (series_id, observation_date, value, fetched_at) VALUES
             ('FEDFUNDS', ${month}, ${5.3 - i * 0.1}, now()), ('UNRATE', ${month}, ${4.1 + (i % 3) * 0.1}, now()), ('FLUR', ${month}, ${3.2 + (i % 2) * 0.1}, now())`;
  }
}

async function shoot(page: Page, name: string): Promise<void> {
  const dir = process.env.HAMILTON_SCREENS_DIR;
  if (!dir) return;
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

const SECTIONS = ["Summary", "Financials", "Competition", "Market", "Regulation", "Management considerations"];

test.describe("monthly briefing (#1897)", () => {
  test.beforeAll(async () => {
    const db = connectFixtureDb();
    try { await seed(db); } finally { await db.end(); }
  });
  test.afterAll(async () => {
    const db = connectFixtureDb();
    try {
      await db`DELETE FROM institution_financial_records WHERE id BETWEEN ${RECORD_BASE} AND ${RECORD_BASE + 999}`;
      await db`DELETE FROM fed_economic_indicators WHERE series_id = ANY(${SERIES})`;
    } finally { await db.end(); }
  });

  for (const width of [1440, 390]) {
    test(`build, edit and export at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width > 500 ? 900 : 844 });
      const start = `/pro/reports/monthly?instId=${HOME.id}`;
      await signIn(page, FIXTURE_USERS.pro.email, start);
      await page.goto(start);
      await expect(page.getByRole("heading", { name: "Monthly briefing", level: 1 })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await shoot(page, `start-${width}`);

      await page.getByRole("button", { name: /^Build the .* briefing$/ }).click();
      await page.waitForURL(/report_id=/, { timeout: 120_000 });
      for (const heading of SECTIONS) await expect(page.getByRole("heading", { name: heading, level: 2 })).toBeVisible();
      await expect(page.getByText(/NCUA 5300 call report, ACCT_131/).first()).toBeVisible();
      await expect(page.getByText(/Bank Fee Index, .*, \d+ institutions/).first()).toBeVisible();
      await expect(page.getByText(/Federal Reserve Board H\.15 \(FEDFUNDS\)/).first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await shoot(page, `briefing-${width}`);

      const market = page.locator("#section-market");
      await market.getByRole("button", { name: "Edit words" }).click();
      await market.getByRole("textbox").fill("Our team reads the rate cuts as easing deposit pricing this quarter.");
      await page.getByRole("button", { name: "Save briefing" }).click();
      await expect(page.getByText("Saved. The PDF uses this version.")).toBeVisible();
      await expect(market.getByText("Words edited by your team.")).toBeVisible();
      await market.scrollIntoViewIfNeeded();
      const dir = process.env.HAMILTON_SCREENS_DIR;
      if (dir) await market.screenshot({ path: path.join(dir, `edited-market-${width}.png`) });

      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download PDF" }).click();
      const file = await download;
      expect(file.suggestedFilename()).toMatch(/^monthly-briefing-\d{4}-\d{2}\.pdf$/);
      if (dir && width === 1440) await file.saveAs(path.join(dir, "monthly-briefing.pdf"));
    });
  }
});
