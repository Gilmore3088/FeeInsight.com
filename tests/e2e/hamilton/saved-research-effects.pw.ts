/** FR-20 / BA-J02: actual saves and independently read durable effects; strict v1 remains separate. */
import { expect, test, withJourneyCapture, type Page } from "./evidence";
import { withPeerResearchActionEvidence } from "./action-evidence";
import { FIXTURE_USERS, HOME, connectFixtureDb, seedHamiltonFixtures } from "./fixtures";
import { ask, navigate, signIn } from "./helpers";
import type { PeerListData } from "../../../src/lib/hamilton/peer-list";
import type { BrowserContext } from "playwright/test";

const FLORIDA = [9701002, 9701003, 9701004, 9701005, 9701006, 9701007, 9701008];
const ALL_TEN_NAMES = ["Indian River Test CU", "Gulf Breeze Test CU", "Suncoast Harbor Test CU", "Palmetto Grove Test CU", "Keystone Bay Test CU", "Lantana Test CU", "Coquina Test CU", "Peachtree Test CU", "Chattahoochee Test CU", "Savannah Marsh Test CU"];
const peerTable = (page: Page) => page.getByRole("table", { name: "Peer table" }).last();
const feeTable = (page: Page) => page.locator("table[aria-label^='Published']").last();

async function snapshot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo({ top: 0, left: 0, behavior: "instant" }); });
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await test.info().attach(name, { path, contentType: "image/png" });
}

async function assertSavedPage(page: Page, expectedOrder: number[]): Promise<void> {
  await expect(page.getByRole("region", { name: "Institution context" })).toContainText(`Researching: ${HOME.name}`);
  await expect(page.getByText(`Research subject: ${HOME.name}`).first()).toBeVisible();
  await expect(peerTable(page).locator("tbody tr")).toHaveCount(7);
  const rows = peerTable(page).locator("tbody tr");
  const actualIds: number[] = [];
  for (const row of await rows.all()) {
    const link = row.locator("th a").first();
    const href = await link.getAttribute("href");
    const id = Number(new URL(href ?? "", String(test.info().project.use.baseURL)).searchParams.get("instId"));
    actualIds.push(id);
    const fixtureIndex = FLORIDA.indexOf(id);
    expect(fixtureIndex).toBeGreaterThanOrEqual(0);
    await expect(link).toHaveText(ALL_TEN_NAMES[fixtureIndex]);
    await expect(row).toContainText("Jun 2026");
    await expect(row.getByRole("link", { name: "NCUA filing source" })).toHaveAttribute("href", "https://ncua.gov/fixture");
  }
  expect(actualIds).toEqual(expectedOrder);
  expect(actualIds.slice().sort((a, b) => a - b)).toEqual(FLORIDA);
  await expect(feeTable(page).getByRole("row", { name: /Indian River Test CU/ })).toContainText("1% of the transaction");
  await expect(feeTable(page).getByRole("row", { name: /Indian River Test CU/ })).not.toContainText("$1");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
}

test.beforeAll(async () => {
  const db = connectFixtureDb();
  try { await seedHamiltonFixtures(db); } finally { await db.end(); }
});

// Independent tests: a failed desktop capture must not silently skip the phone's complete chain.
for (const width of [1440, 390]) {
  test(`BA-J02 saved peer research at ${width}: native save, fixture read-back and fresh phone ownership`, async ({ page, browser }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await signIn(page, FIXTURE_USERS.pro.email, `/pro/analyze?instId=${HOME.id}`);
    await navigate(page, `/pro/analyze?instId=${HOME.id}`);
    await ask(page, "List ten similarly sized credit unions");
    await expect(page.getByRole("heading", { name: `10 of 12 matching institutions for ${HOME.name}.` })).toBeVisible();
    await expect(peerTable(page).locator("tbody tr")).toHaveCount(10);
    for (const name of ALL_TEN_NAMES) await expect(peerTable(page)).toContainText(name);
    await expect(page.getByText(/Selection criteria: credit unions · nationwide · ≥ \$4\.5B · ≤ \$18B/)).toBeVisible();
    await ask(page, "Only Florida");
    await expect(page.getByRole("heading", { name: "7 of 10 previously displayed peers are in FL." })).toBeVisible();
    await expect(peerTable(page).locator("tbody tr")).toHaveCount(7);
    await ask(page, "Compare their NSF fees");
    await expect(feeTable(page).getByRole("row", { name: /Gulf Breeze Test CU/ })).toContainText("$0");
    await expect(feeTable(page).getByRole("row", { name: /Suncoast Harbor Test CU/ })).toContainText("Source over a year old");
    for (const name of ["Palmetto Grove Test CU", "Coquina Test CU"]) {
      await expect(feeTable(page).getByRole("row", { name: new RegExp(name) })).toContainText("No published consumer NSF / returned item fee on file");
    }
    await expect(feeTable(page)).not.toContainText(/\bfree\b/i);
    await snapshot(page, `saved-research-nsf-${width}`);
    await ask(page, "Compare their foreign transaction fees");
    await expect(feeTable(page).getByRole("row", { name: /Indian River Test CU/ })).toContainText("1% of the transaction");
    await expect(page.getByRole("link", { name: "Reopen saved research" })).toHaveCount(0);

    const captureFailures: Error[] = [];
    let savedPeerOrder: number[] = [];
    const captureFreshPage = async (target: Page, run: () => Promise<void>, name: string): Promise<void> => {
      let assertionsCompleted = false;
      try {
        await withJourneyCapture(target, test.info(), async () => { await run(); assertionsCompleted = true; }, name);
      } catch (error) {
        // Finish the independent read-back/denial witnesses, then propagate the unchanged v1 gate.
        if (!assertionsCompleted || !(error instanceof Error) || !error.message.startsWith("Browser evidence blocked:")) throw error;
        captureFailures.push(error);
      }
    };
    await withPeerResearchActionEvidence(page, test.info(), async () => {
      const responsePromise = page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.origin === new URL(String(test.info().project.use.baseURL)).origin
          && url.pathname === "/api/hamilton/ask" && response.request().method() === "POST";
      });
      await page.getByRole("button", { name: "Save this peer research" }).click();
      const response = await responsePromise;
      expect(response.status()).toBe(200);
      const bytes = await response.body();
      expect(bytes.length).toBeLessThanOrEqual(2_000_000);
      // Parsed transiently for the returned identity; neither bytes nor JSON are attached.
      const result: { savedAnalysisId?: string } = JSON.parse(bytes.toString("utf8"));
      const reopen = page.getByRole("link", { name: "Reopen saved research" });
      await expect(reopen).toBeVisible();
      const href = (await reopen.getAttribute("href")) ?? "";
      expect(href).toMatch(/^\/pro\/peer-research\/[0-9a-f-]{36}$/);
      return { apiArtifactId: result.savedAnalysisId ?? "", uiArtifactId: href.split("/").at(-1) ?? "" };
    }, async saved => {
      expect(saved.user_id).toBe(String(FIXTURE_USERS.pro.id));
      expect(saved.institution_id).toBe(String(HOME.id));
      expect(saved.status).toBe("active");
      expect(saved.response_json.identityContext).toMatchObject({ version: 1, researchInstitutionId: HOME.id,
        accountInstitutionId: HOME.id, accountStatus: "identified", researchInstitutionName: HOME.name,
        researchSelectionSource: "Saved, server-revalidated peer research" });
      const data = saved.response_json.peerListSnapshot as PeerListData;
      expect(data.version).toBe(1);
      expect(data.status).toBe("ready");
      expect(data.subject).toMatchObject({ institutionId: HOME.id, totalAssetsUsd: 9_000_000_000, reportDate: "2026-06-30" });
      expect(data.rows.map(row => row.institutionId).sort((a, b) => a - b)).toEqual(FLORIDA);
      for (const row of data.rows) {
        expect(row).toMatchObject({ reportDate: "2026-06-30", source: "ncua", sourceUrl: "https://ncua.gov/fixture" });
      }
      expect(data.feeComparison?.comparedPeerIds.slice().sort((a, b) => a - b)).toEqual(FLORIDA);
      expect(data.feeComparison?.rateFees).toEqual(expect.arrayContaining([expect.objectContaining({ institutionId: 9701002, rateLabel: "1% of the transaction" })]));
      savedPeerOrder = data.rows.map(row => row.institutionId);
    }, async artifactId => {
      let phone: BrowserContext | undefined;
      let other: BrowserContext | undefined;
      let primaryError: unknown;
      let failed = false;
      let cleanupFailed = false;
      let completed = false;
      try {
        phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
        other = await browser.newContext({ viewport: { width: 390, height: 844 } });
        const mobile = await phone.newPage();
        await captureFreshPage(mobile, async () => {
          await signIn(mobile, FIXTURE_USERS.pro.email, `/pro/analyze?instId=${HOME.id}`);
          await mobile.getByRole("button", { name: "Research another institution", exact: true }).click();
          await mobile.getByLabel("Institution", { exact: true }).fill("Indian River Test CU");
          await mobile.getByRole("button", { name: /Indian River Test CU/ }).click();
          await expect(mobile).toHaveURL(/instId=9701002(?:&|$)/);
          await expect(mobile.getByRole("region", { name: "Institution context" })).toContainText("Researching: Indian River Test CU");
          // Same saved ID, deliberately conflicting URL/default, newly authenticated context.
          await navigate(mobile, `/pro/peer-research/${artifactId}?instId=9701002`);
          await assertSavedPage(mobile, savedPeerOrder);
          await snapshot(mobile, `same-saved-peer-phone-${width}`);
        }, `same-saved-peer-phone-${width}`);
        const denied = await other.newPage();
        await captureFreshPage(denied, async () => {
          await signIn(denied, FIXTURE_USERS.proNoHome.email, "/pro/analyze?instId=9701002");
          await navigate(denied, `/pro/peer-research/${artifactId}?instId=9701002`);
          await expect(denied.getByRole("heading", { name: "We couldn't find that page" })).toBeVisible();
          await expect(denied.getByText("Indian River Test CU")).toHaveCount(0);
          await expect(denied.getByRole("region", { name: "Institution context" })).not.toContainText("Researching:");
          await snapshot(denied, `other-account-peer-denial-${width}`);
        }, `other-account-peer-denial-${width}`);
        completed = true;
      } catch (error) {
        failed = true;
        primaryError = error;
      } finally {
        try { await phone?.close(); } catch { cleanupFailed = true; }
        try { await other?.close(); } catch { cleanupFailed = true; }
      }
      if (failed) throw primaryError;
      if (!completed || cleanupFailed || !phone || phone === page.context()) throw new Error("Fresh artifact context capture did not complete");
      return { freshContext: true, authenticatedActorMatches: true, artifactSubjectMatches: true,
        shellSubjectMatches: true, semanticMatches: true, wrongUserDenied: true };
    });
    if (captureFailures.length) throw captureFailures[0];
  });
}
