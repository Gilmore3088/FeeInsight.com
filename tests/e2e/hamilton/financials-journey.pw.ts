/**
 * Financial performance journey (#1892): a Pro subscriber opens /pro/financials for a credit union
 * and for a bank, sees the filed quarters beside the peer median, and opens one quarter's evidence.
 *
 * Seeds its own synthetic filers in the fixture id range (teardown removes them): one credit union
 * and one bank, each with twelve same-tier peers and fourteen quarter ends of filings, the credit
 * union's income year to date in whole dollars in the filing and thousands as stored, as the
 * importers store them. HAMILTON_SCREENS_DIR=<dir> also saves desktop and phone screenshots.
 */
import path from "node:path";
import { expect, test, type Page } from "playwright/test";
import { FIXTURE_USERS, HOME, connectFixtureDb, type FixtureDb } from "./fixtures";
import { signIn } from "./helpers";

const CU = { id: 9_701_920, name: "Cedar Hollow Test Credit Union", cert: "68420" };
const BANK = { id: 9_701_940, name: "Harbor Ridge Test Bank", cert: "57311" };
const CU_PEERS = Array.from({ length: 12 }, (_, i) => 9_701_921 + i);
const BANK_PEERS = Array.from({ length: 12 }, (_, i) => 9_701_941 + i);
const RECORD_BASE = 9_705_000;
const ENDS = ["03-31", "06-30", "09-30", "12-31"];
/** Fourteen quarter ends, Q1 2023 to Q2 2026. */
const DATES = Array.from({ length: 14 }, (_, i) => `${2023 + Math.floor(i / 4)}-${ENDS[i % 4]}`);
const quarterOf = (date: string) => Math.ceil(Number(date.slice(5, 7)) / 3);

async function seedFinancials(db: FixtureDb): Promise<void> {
  const institutions: Array<[number, string, "credit_union" | "bank", string]> = [
    [CU.id, CU.name, "credit_union", CU.cert],
    ...CU_PEERS.map((id, i): [number, string, "credit_union", string] => [id, `Peer Test Credit Union ${i + 1}`, "credit_union", String(70_000 + i)]),
    [BANK.id, BANK.name, "bank", BANK.cert],
    ...BANK_PEERS.map((id, i): [number, string, "bank", string] => [id, `Peer Test Bank ${i + 1}`, "bank", String(80_000 + i)]),
  ];
  // Re-runnable: a retried worker seeds again over its own rows.
  const ids = institutions.map(([id]) => id);
  await db`DELETE FROM institution_financial_records WHERE institution_id = ANY(${ids})`;
  await db`DELETE FROM institution_sources WHERE id = ANY(${ids})`;
  if (process.env.HAMILTON_SCREENS_DIR) {
    // Screenshots for review never show the shared fixture home's name, which echoes a real
    // credit union's; teardown and the next seed restore it.
    await db`UPDATE institution_sources SET institution_name = 'Lakeshore Test Credit Union' WHERE id = ${HOME.id}`;
    await db`UPDATE users SET institution_name = 'Lakeshore Test Credit Union' WHERE id = ${FIXTURE_USERS.pro.id}`;
  }
  for (const [id, name, charter, cert] of institutions) {
    await db`INSERT INTO institution_sources (id, institution_name, charter_type, source, cert_number, city, state, state_code, fed_district, status, asset_size_tier)
             VALUES (${id}, ${name}, ${charter}, ${charter === "bank" ? "fdic" : "ncua"}, ${cert}, 'Springfield', 'OH', 'OH', 4, 'active', 'midsize')`;
  }
  let recordId = RECORD_BASE;
  for (const [index, date] of DATES.entries()) {
    const growth = 1 + index * 0.012;
    // Credit unions: fee income is year to date. Stored in thousands, filed in whole dollars.
    for (const [n, id] of [CU.id, ...CU_PEERS].entries()) {
      // The quarter's own income, then the year to date the filing states: this quarter plus the earlier ones in the year.
      const own = (i: number) => Math.round((n === 0 ? 11_840 : 9_600 + n * 310) * (1 + i * 0.012) * (quarterOf(DATES[i]) === 4 ? 1.04 : 1));
      let ytd = 0;
      for (let i = index; i >= 0 && DATES[i].slice(0, 4) === date.slice(0, 4); i -= 1) ytd += own(i);
      const deposits = Math.round((n === 0 ? 7_420_000 : 6_100_000 + n * 140_000) * growth);
      const assets = Math.round(deposits * 1.19);
      const raw = { ACCT_131: ytd * 1000 + 317, ACCT_018: deposits * 1000 + 211, ACCT_010: assets * 1000 + 98 };
      recordId += 1;
      await db`INSERT INTO institution_financial_records (id, institution_id, report_date, source, source_cert_number, service_charge_income, total_deposits, total_assets, raw_json, source_url, fetched_at)
               VALUES (${recordId}, ${id}, ${date}, 'ncua', ${n === 0 ? CU.cert : String(70_000 + n - 1)}, ${ytd}, ${deposits}, ${assets}, ${db.json(raw)},
                       ${`https://ncua.gov/files/publications/analysis/call-report-data-${date.slice(0, 4)}-${date.slice(5, 7)}.zip`}, ${`${date.slice(0, 4)}-${date.slice(5, 7)}-28T00:00:00Z`}::timestamptz + INTERVAL '45 days')`;
    }
    // Banks: FDIC BankFind already states the quarter, in thousands.
    for (const [n, id] of [BANK.id, ...BANK_PEERS].entries()) {
      const quarter = Math.round((n === 0 ? 1_862 : 1_420 + n * 95) * growth * (quarterOf(date) === 1 ? 0.97 : 1));
      const deposits = Math.round((n === 0 ? 2_045_000 : 1_700_000 + n * 60_000) * growth);
      const assets = Math.round(deposits * 1.17);
      recordId += 1;
      await db`INSERT INTO institution_financial_records (id, institution_id, report_date, source, source_cert_number, service_charge_income, total_deposits, total_assets, raw_json, source_url, fetched_at)
               VALUES (${recordId}, ${id}, ${date}, 'fdic', ${n === 0 ? BANK.cert : String(80_000 + n - 1)}, ${quarter}, ${deposits}, ${assets},
                       ${db.json({ ISERCHGQ: quarter, DEP: deposits, ASSET: assets })},
                       ${`https://api.fdic.gov/banks/financials?filters=REPDTE:${date.replaceAll("-", "")}`}, ${`${date.slice(0, 4)}-${date.slice(5, 7)}-28T00:00:00Z`}::timestamptz + INTERVAL '40 days')`;
    }
  }
}

async function shoot(page: Page, name: string): Promise<void> {
  const dir = process.env.HAMILTON_SCREENS_DIR;
  if (!dir) return;
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

test.describe("financial performance (#1892)", () => {
  test.beforeAll(async () => {
    const db = connectFixtureDb();
    try {
      await seedFinancials(db);
    } finally {
      await db.end();
    }
  });

  for (const subject of [
    { slug: "cu", inst: CU, ytd: true, figure: "Fee income, quarter" },
    { slug: "bank", inst: BANK, ytd: false, figure: "Service charges, quarter" },
  ]) {
    for (const width of [1440, 390]) {
      test(`${subject.slug} at ${width}`, async ({ page }) => {
        await page.setViewportSize({ width, height: width > 500 ? 900 : 844 });
        await signIn(page, FIXTURE_USERS.pro.email, `/pro/financials?instId=${subject.inst.id}`);
        await page.goto(`/pro/financials?instId=${subject.inst.id}`);
        await expect(page.getByRole("heading", { name: "Financial performance", level: 1 })).toBeVisible();
        await expect(page.getByText(subject.figure, { exact: true })).toBeVisible();
        await expect(page.getByText("Fee income, year to date as filed")).toHaveCount(subject.ytd ? 1 : 0);
        await expect(page.getByText(/^\d+ in peer group$/).first()).toBeVisible();
        // No horizontal page scroll at phone width: the table scrolls inside its own box.
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await shoot(page, `${subject.slug}-${width}`);

        await page.getByRole("link", { name: "Q2 2026" }).click();
        await page.waitForURL(/quarter=2026-06-30/);
        const evidence = page.locator("#evidence-2026-06-30");
        await expect(evidence).toHaveAttribute("open", "");
        await expect(evidence).toContainText(subject.inst.name);
        await expect(evidence).toContainText("Matches the filing");
        await evidence.scrollIntoViewIfNeeded();
        const dir = process.env.HAMILTON_SCREENS_DIR;
        if (dir) await evidence.screenshot({ path: path.join(dir, `${subject.slug}-evidence-${width}.png`) });
      });
    }
  }
});
