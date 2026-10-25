/**
 * Command center journey (#1891, Hamilton V5 plan P5): a Pro subscriber whose workspace has an
 * institution lands on its command center, sees the five questions answered with sources, and
 * follows one into the page behind it. A fee whose figure on file was corrected between two
 * quarterly copies is shown as an update to our data, never as the institution's price change.
 * A subscriber with no institution on file sees the national overview under a way to choose one.
 *
 * Seeds its own synthetic rows on the fixture home and its peers (teardown removes them by
 * institution and user): twelve quarter ends of NCUA filings, the workspace selection, and two
 * stored quarterly briefings in which the stop payment figure moved from $30 to $25 with no
 * confirmed change. HAMILTON_SCREENS_DIR=<dir> also saves desktop and phone screenshots.
 */
import path from "node:path";
import { expect, test, type Page } from "playwright/test";
import { FIXTURE_USERS, HOME, PEERS, connectFixtureDb, type FixtureDb } from "./fixtures";
import { signIn } from "./helpers";

/** Screenshots never show the shared fixture home's name, which echoes a real credit union's. */
const HOME_NAME = "Lakeshore Test Credit Union";
const RECORD_BASE = 9_706_000;
const ENDS = ["03-31", "06-30", "09-30", "12-31"];
/** Fourteen quarter ends, Q1 2023 to Q2 2026: whole years, so each quarter splits from the year to date. */
const DATES = Array.from({ length: 14 }, (_, i) => `${2023 + Math.floor(i / 4)}-${ENDS[i % 4]}`);

function storedBriefing(stopPayment: number, generatedAt: string) {
  const row = (feeCategory: string, displayName: string, current: number) => ({
    feeCategory,
    displayName,
    current,
    band: null,
    peerLabel: "Credit unions in FL, GA and AL",
  });
  return {
    institutionId: HOME.id,
    institutionName: HOME_NAME,
    stateCode: "FL",
    observations: [],
    institutionFinancials: null,
    nationalIncome: null,
    nationalIncomeSeries: [],
    feesReviewed: 3,
    positions: [row("nsf", "NSF", 27), row("overdraft", "Overdraft", 27), row("stop_payment", "Stop Payment", stopPayment)],
    peerLabel: "Credit unions in FL, GA and AL",
    generatedAt,
    provenance: { engineVersion: "1.21.0", generatedAt, dataAsOf: {}, sources: [], assumptions: [], clientFacts: [] },
  };
}

async function seed(db: FixtureDb): Promise<void> {
  const ids = [HOME.id, ...PEERS.map((p) => p.id)];
  // The base fixture files one 2026-06-30 row each; this journey files the whole series in its place.
  await db`DELETE FROM institution_financial_records WHERE institution_id = ANY(${ids})`;
  await db`DELETE FROM hamilton_briefing_snapshots WHERE institution_id = ${HOME.id}`;
  await db`UPDATE institution_sources SET institution_name = ${HOME_NAME} WHERE id = ${HOME.id}`;
  await db`UPDATE users SET institution_name = ${HOME_NAME} WHERE id = ${FIXTURE_USERS.pro.id}`;
  await db`UPDATE institution_sources SET cert_number = '61840' WHERE id = ${HOME.id}`;
  await db`UPDATE institution_sources SET asset_size_tier = 'large' WHERE id = ANY(${ids})`;
  await db`INSERT INTO hamilton_workspace_contexts (user_id, selected_institution_id, selected_source)
           VALUES (${FIXTURE_USERS.pro.id}, ${HOME.id}, 'manual')
           ON CONFLICT (user_id) DO UPDATE SET selected_institution_id = EXCLUDED.selected_institution_id`;
  await db`DELETE FROM hamilton_workspace_contexts WHERE user_id = ${FIXTURE_USERS.proNoHome.id}`;

  let recordId = RECORD_BASE;
  for (const [index, date] of DATES.entries()) {
    for (const [n, id] of ids.entries()) {
      const own = (i: number) => Math.round((n === 0 ? 11_840 : 9_600 + n * 310) * (1 + i * 0.012) * (DATES[i].endsWith("12-31") ? 1.04 : 1));
      let ytd = 0;
      for (let i = index; i >= 0 && DATES[i].slice(0, 4) === date.slice(0, 4); i -= 1) ytd += own(i);
      const deposits = Math.round((n === 0 ? 7_420_000 : 6_100_000 + n * 140_000) * (1 + index * 0.012));
      const assets = Math.round(deposits * 1.19);
      recordId += 1;
      await db`INSERT INTO institution_financial_records (id, institution_id, report_date, source, source_cert_number, service_charge_income, total_deposits, total_assets, raw_json, source_url, fetched_at)
               VALUES (${recordId}, ${id}, ${date}, 'ncua', ${n === 0 ? "61840" : String(70_000 + n)}, ${ytd}, ${deposits}, ${assets},
                       ${db.json({ ACCT_131: ytd * 1000 + 317, ACCT_018: deposits * 1000 + 211, ACCT_010: assets * 1000 + 98 })},
                       ${`https://ncua.gov/files/publications/analysis/call-report-data-${date.slice(0, 4)}-${date.slice(5, 7)}.zip`},
                       ${`${date.slice(0, 4)}-${date.slice(5, 7)}-28T00:00:00Z`}::timestamptz + INTERVAL '45 days')`;
    }
  }

  for (const [quarter, stopPayment, generatedAt] of [
    ["2026-Q3", 30, "2026-07-06T12:00:00Z"],
    ["2026-Q4", 25, "2026-10-05T12:00:00Z"],
  ] as const) {
    await db`INSERT INTO hamilton_briefing_snapshots (institution_id, quarter, engine_version, briefing)
             VALUES (${HOME.id}, ${quarter}, '1.21.0', ${db.json(storedBriefing(stopPayment, generatedAt))})`;
  }
}

async function shoot(page: Page, name: string): Promise<void> {
  const dir = process.env.HAMILTON_SCREENS_DIR;
  if (!dir) return;
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

const QUESTIONS = [
  `How is ${HOME_NAME} doing?`,
  "How has it changed?",
  "How does it compare with real peers?",
  "What happened in its market and in regulation?",
  "What to look at next",
];

test.describe("command center (#1891)", () => {
  test.beforeAll(async () => {
    const db = connectFixtureDb();
    try {
      await seed(db);
    } finally {
      await db.end();
    }
  });

  for (const width of [1440, 390]) {
    test(`linked account lands on the command center at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width > 500 ? 900 : 844 });
      await signIn(page, FIXTURE_USERS.pro.email, "/pro/hamilton");
      await page.goto("/pro/hamilton");
      await expect(page.getByRole("heading", { name: HOME_NAME, level: 1 })).toBeVisible();
      for (const question of QUESTIONS) await expect(page.getByRole("heading", { name: question, level: 2 })).toBeVisible();
      await expect(page.getByText(/Fee income in Q2 2026 was \$[\d.]+ million/)).toBeVisible();
      await expect(page.getByText("Source: NCUA 5300 call report, Q2 2026", { exact: false }).first()).toBeVisible();

      // V5 P5: the corrected stop payment figure is a data update, never the institution's price change.
      await expect(page.getByText("No price change on its published schedules is confirmed since Q3 2026.")).toBeVisible();
      await expect(page.getByText(`1 fee figure on file changed without a confirmed price change; these are updates to our data, not price changes by ${HOME_NAME}.`)).toBeVisible();
      await expect(page.getByText("Stop Payment: the figure on file moved from $30.00 to $25.00.", { exact: false })).toBeVisible();
      await expect(page.getByText(/published price moved/)).toHaveCount(0);

      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await shoot(page, `command-center-${width}`);

      await page.getByRole("link", { name: "Financial performance" }).first().click();
      await page.waitForURL(/\/pro\/financials\?instId=9701001/);
      await expect(page.getByRole("heading", { name: "Financial performance", level: 1 })).toBeVisible();
    });
  }

  test("an account with no institution keeps a clear way to choose one", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, FIXTURE_USERS.proNoHome.email, "/pro/hamilton");
    await page.goto("/pro/hamilton");
    const choose = page.getByRole("link", { name: "Choose your institution" });
    await expect(choose).toBeVisible();
    await expect(choose).toHaveAttribute("href", "/pro/settings");
    await shoot(page, "command-center-unlinked-1440");
  });
});
