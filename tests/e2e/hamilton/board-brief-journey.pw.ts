/**
 * #1899: "Add to report" carries a finding's chart, sources, method, dates and limits into the
 * board brief, and "Build board brief" is checked end to end on a synthetic linked account: the
 * reader tests a price on Try a price and adds it, adds a saved Ask answer, then builds the board
 * brief from a second answer, edits its title and note, saves it and downloads the PDF. The PDF's
 * figures, identity and sources are checked against the fixture database.
 *
 * The shared fixture home's name echoes a real credit union, so this journey renames it for its
 * own run and restores it after. No provider is called: serve.mjs blanks every key and the
 * fixtures switch the provider stop on. HAMILTON_SCREENS_DIR=<dir> also saves desktop and phone
 * screenshots.
 */
import path from "node:path";
import { readFileSync } from "node:fs";
import { extractText } from "unpdf";
import { expect, test, type Page } from "playwright/test";
import { FIXTURE_USERS, HOME, connectFixtureDb, type FixtureDb } from "./fixtures";
import { ask, signIn } from "./helpers";

test.describe.configure({ mode: "serial" });

const NAME = "Lakeshore Test Credit Union";
const TESTED = 32;

let db: FixtureDb;

async function shoot(page: Page, name: string): Promise<void> {
  const dir = process.env.HAMILTON_SCREENS_DIR;
  if (!dir) return;
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

async function noSideScroll(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
}

test.beforeAll(async () => {
  db = connectFixtureDb();
  await db`UPDATE institution_sources SET institution_name = ${NAME} WHERE id = ${HOME.id}`;
  await db`UPDATE users SET institution_name = ${NAME} WHERE id = ${FIXTURE_USERS.pro.id}`;
});

test.afterAll(async () => {
  await db`UPDATE institution_sources SET institution_name = ${HOME.name} WHERE id = ${HOME.id}`;
  await db`UPDATE users SET institution_name = ${HOME.name} WHERE id = ${FIXTURE_USERS.pro.id}`;
  await db?.end();
});

for (const width of [1440, 390]) {
  test(`#1899 at ${width}: added findings carry their evidence into an edited, sourced board brief whose PDF matches the data`, async ({ page }) => {
    await page.setViewportSize({ width, height: width > 500 ? 900 : 844 });
    await signIn(page, FIXTURE_USERS.pro.email, `/pro/analyze?instId=${HOME.id}`);
    // A fresh report list for this run.
    await page.evaluate(() => window.localStorage.removeItem("hamilton-report-basket-v1"));

    // The data the brief must match: the home's published NSF fee.
    const [own] = await db<{ amount: string }[]>`
      SELECT amount::text FROM published_fee_catalog WHERE institution_id = ${HOME.id} AND fee_category = 'nsf' ORDER BY amount LIMIT 1`;
    const ownFee = `$${Number(own.amount).toFixed(2)}`;

    // 1. Try a price: a tested NSF price, placed among the peers, added to the report.
    await page.goto(`/pro/simulate?instId=${HOME.id}&fee=nsf&check=${TESTED}#position-check`);
    const check = page.locator("#position-check");
    await expect(check.getByRole("status")).toContainText(`$${TESTED}`);
    await page.getByRole("button", { name: "+ Add to report" }).click();
    await expect(page.getByText("Added to report")).toBeVisible();
    await noSideScroll(page);
    await shoot(page, `try-a-price-added-${width}`);

    // 2. Ask: an overdraft answer, saved, added to the report.
    await page.goto(`/pro/analyze?instId=${HOME.id}`);
    await ask(page, `What is the overdraft fee at ${NAME}?`);
    const overdraftRow = page.getByRole("region", { name: "Use this answer" }).first();
    await expect(overdraftRow.getByText("Saved", { exact: false }).first()).toBeVisible();
    await overdraftRow.getByRole("button", { name: "+ Add to report" }).click();
    await expect(overdraftRow.getByText("In your report")).toBeVisible();

    // 3. Build board brief from a second answer.
    await page.goto(`/pro/analyze?instId=${HOME.id}`);
    await ask(page, `What is the NSF fee at ${NAME}?`);
    await expect(page.getByText(`${NAME}'s ${ownFee.replace(".00", "")} NSF / returned item fee`).first()).toBeVisible();
    await page.getByRole("link", { name: "Build board brief" }).first().click();
    await page.waitForURL(/from_analysis=/);
    await expect(page.getByRole("heading", { name: "Board brief", level: 1 })).toBeVisible();

    // The two added findings are listed, and the preview prints each with its evidence.
    const picks = page.getByRole("group", { name: "Findings you added" });
    await expect(picks.getByRole("checkbox")).toHaveCount(2);
    const added = page.getByRole("region", { name: "Findings you added" });
    await expect(added).toContainText(`NSF / Returned Item: test of $${TESTED}.00 against a current published fee of ${ownFee}`);
    await expect(added).toContainText("Bank Fee Index published fee catalog");
    await expect(added).toContainText("The tested fee is a figure you entered in Test. It is not a published fee.");
    await expect(added).toContainText("Answer saved");
    await expect(added).toContainText("Method");
    await expect(added.getByRole("img").first()).toBeVisible();
    await noSideScroll(page);
    await shoot(page, `board-brief-editor-${width}`);

    // 4. Edit and save: the saved brief keeps its findings as read on the server.
    const title = `${NAME}: NSF and overdraft for the board (${width})`;
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Team note").fill("Prepared for the October committee.");
    await page.getByRole("button", { name: "Save brief" }).click();
    await page.waitForURL(/report_id=/);
    const reportId = new URL(page.url()).searchParams.get("report_id")!;
    const [saved] = await db<{ report_json: { title: string; addedFindings?: Array<{ source: string; title: string; evidence?: { chart: { subject: number | null; current?: number | null; median: number; peerCount: number } | null; sources: { label: string }[] } }> } }[]>`
      SELECT report_json FROM hamilton_reports WHERE id::text = ${reportId} AND user_id = ${FIXTURE_USERS.pro.id}`;
    expect(saved.report_json.title).toBe(title);
    const findings = saved.report_json.addedFindings ?? [];
    expect(findings.map((f) => f.source).sort()).toEqual(["Ask", "Test"]);
    const tested = findings.find((f) => f.source === "Test")!;
    expect(tested.evidence?.chart?.subject).toBe(TESTED);
    expect(tested.evidence?.chart?.current).toBe(Number(own.amount));
    expect(tested.evidence?.sources[0].label).toBe("Bank Fee Index published fee catalog");
    await expect(page.getByRole("region", { name: "Findings you added" })).toContainText(`test of $${TESTED}.00`);
    await shoot(page, `board-brief-saved-${width}`);

    // 5. The PDF: the edited title and note, the institution, each finding's figures and sources.
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download PDF" }).click()]);
    const file = test.info().outputPath(`board-brief-${width}.pdf`);
    await download.saveAs(file);
    const bytes = readFileSync(file);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    const text = (await extractText(new Uint8Array(bytes), { mergePages: true })).text.replace(/\s+/g, " ");
    expect(text).toContain(title);
    expect(text).toContain("Prepared for the October committee.");
    expect(text).toContain(NAME);
    expect(text).not.toContain("Space Coast");
    expect(text).toContain(`Tested fee $${TESTED}.00; current fee ${ownFee}`);
    if (tested.evidence?.chart) {
      // The median and peer count the PDF prints are the ones saved with the brief.
      expect(text).toContain(`peer group median $${tested.evidence.chart.median.toFixed(2)} across ${tested.evidence.chart.peerCount} institutions`);
    }
    expect(text).toContain("Sources: Bank Fee Index published fee catalog");
    expect(text).toContain("Dates: Read from published fee schedules on");
    expect(text).toContain("Answer saved");
    expect(text).not.toMatch(/—/);
  });
}
