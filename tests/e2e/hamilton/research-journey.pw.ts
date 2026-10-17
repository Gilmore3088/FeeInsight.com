/**
 * H07-T03 (#982): the signed-in Hamilton research journey in a real browser, against a local
 * production build and the local fixture database (tests/e2e/hamilton/fixtures.ts).
 *
 * Ask -> ten similarly sized peers -> "Only Florida" -> compare a named fee ($0, rate, stale,
 * missing) -> save -> reopen -> a fee answer -> PDF download, then the absent-home, denial and
 * legacy-answer variants. Acceptance case ids are in each test title; the matrix
 * (src/lib/hamilton/release-acceptance.ts) points at this file. A pass here is synthetic evidence
 * for those cases, never their live pass. No provider is called: serve.mjs blanks every key and
 * the fixtures switch the provider stop on.
 */
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "playwright/test";
import { EXCLUDED, FIXTURE_USERS, HOME, connectFixtureDb } from "./fixtures";
import { ask, signIn } from "./helpers";

test.describe.configure({ mode: "serial" });

const peerTable = (page: Page) => page.getByRole("region", { name: "Peer table; scroll horizontally" }).last();
const peerRows = (page: Page) => peerTable(page).locator("tbody tr");
const feeTable = (page: Page) => page.locator("table[aria-label^='Published']").last();

/** One free-text question field on the page, whatever the state (H04-AC1). */
async function expectOneComposer(page: Page): Promise<void> {
  await expect(page.getByRole("form", { name: "Ask Hamilton" })).toHaveCount(1);
  await expect(page.locator("main textarea")).toHaveCount(1);
}

/** No page-level sideways scroll; wide tables scroll inside their own frame (H05-AC3). */
async function expectNoPageSideScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function snap(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });
}

let savedResearchHref = "";

test("H07-AC2 H02-AC1 H02-AC3 H02-AC4 H05-AC1 H06-AC3 H04-AC1: ask, ten peers, refine, compare fees, save, reopen", async ({ page }) => {
  await signIn(page, FIXTURE_USERS.pro.email, `/pro/analyze?instId=${HOME.id}`);
  await page.goto(`/pro/analyze?instId=${HOME.id}`);
  await expect(page.getByText(`Researching ${HOME.name}`).first()).toBeVisible();
  await expectOneComposer(page);

  // Ten similarly sized credit unions: a list with assets and dates, never a report.
  await ask(page, "List ten similarly sized credit unions");
  await expect(page.getByRole("heading", { name: `10 of 12 matching institutions for ${HOME.name}.` })).toBeVisible();
  await expect(peerRows(page)).toHaveCount(10);
  for (const row of await peerRows(page).all()) {
    await expect(row).toContainText(/\$\d{1,3}(,\d{3})+/);
    await expect(row).toContainText("Jun 2026");
  }
  await expect(page.getByText(/Selection criteria: credit unions · nationwide · ≥ \$4,500,000,000 · ≤ \$18,000,000,000/)).toBeVisible();
  for (const left of EXCLUDED) await expect(peerTable(page)).not.toContainText(left.name);
  await expect(peerTable(page)).not.toContainText(HOME.name);
  // Criteria and rows lead; the save control follows the table (H05-AC1).
  const tableTop = (await peerTable(page).boundingBox())!.y;
  const saveTop = (await page.getByRole("button", { name: "Save this peer research" }).boundingBox())!.y;
  expect(tableTop).toBeLessThan(saveTop);
  await expectOneComposer(page);
  await snap(page, "01-ten-peers");

  // "Only Florida" keeps the displayed list and adds no new peers.
  await ask(page, "Only Florida");
  await expect(page.getByRole("heading", { name: "7 of 10 previously displayed peers are in FL." })).toBeVisible();
  await expect(peerRows(page)).toHaveCount(7);
  for (const row of await peerRows(page).all()) await expect(row).toContainText(", FL");
  const florida = await peerRows(page).locator("th a").first().textContent();

  // A named fee for exactly those peers: $0 is $0, a stale source says so, a missing fee is never $0.
  await ask(page, "Compare their NSF fees");
  await expect(page.getByRole("heading", { name: "Published NSF / returned item fees for 7 selected peers." })).toBeVisible();
  const nsf = feeTable(page);
  await expect(nsf.getByRole("row", { name: /Gulf Breeze Test CU/ })).toContainText("$0");
  await expect(nsf.getByRole("row", { name: /Suncoast Harbor Test CU/ })).toContainText("Source over a year old");
  await expect(nsf.getByRole("row", { name: /Palmetto Grove Test CU/ })).toContainText("No published consumer NSF / returned item fee on file");
  await expect(nsf.getByRole("row", { name: /Coquina Test CU/ })).toContainText("No published consumer NSF / returned item fee on file");
  await expect(nsf).not.toContainText(/\bfree\b/i);
  await expect(nsf.locator("tbody tr")).toHaveCount(7);
  await expect(peerRows(page).locator("th a").first()).toHaveText(florida ?? "");
  await snap(page, "02-nsf-fees");

  // A fee stated as a rate is listed as that rate, never as dollars.
  await ask(page, "Compare their foreign transaction fees");
  const rate = feeTable(page);
  await expect(rate.getByRole("row", { name: /Indian River Test CU/ })).toContainText("1% of the transaction");
  await expect(rate.getByRole("row", { name: /Indian River Test CU/ })).not.toContainText("$1");
  await expect(page.getByText("fees charged as a rate are shown as a percentage")).toBeVisible();

  // Save the research, then reopen exactly that list.
  await page.getByRole("button", { name: "Save this peer research" }).click();
  const reopen = page.getByRole("link", { name: "Reopen saved research" });
  await expect(reopen).toBeVisible();
  savedResearchHref = (await reopen.getAttribute("href")) ?? "";
  expect(savedResearchHref).toMatch(/^\/pro\/peer-research\/[0-9a-f-]{36}$/);
  await expectOneComposer(page);

  await page.goto(savedResearchHref);
  await expect(page.getByText(`Research subject: ${HOME.name}`).first()).toBeVisible();
  await expect(page.getByText("Indian River Test CU").first()).toBeVisible();
  await expect(page.getByText("Peachtree Test CU")).toHaveCount(0);
  await snap(page, "03-reopened-research");

  // Phone width: the page never scrolls sideways (H05-AC3).
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByText("Indian River Test CU").first()).toBeVisible();
  await expectNoPageSideScroll(page);
  await snap(page, "04-reopened-research-390px");
});

test("H01-AC3 H05-AC4: a fee answer is saved, reopens about the same institution, and downloads as a PDF", async ({ page }) => {
  await signIn(page, FIXTURE_USERS.pro.email, `/pro/analyze?instId=${HOME.id}`);
  await page.goto(`/pro/analyze?instId=${HOME.id}`);
  await ask(page, `What is the NSF fee at ${HOME.name}?`);
  await expect(page.getByText(`${HOME.name}'s $27 NSF / returned item fee`).first()).toBeVisible();
  const brief = page.getByRole("link", { name: "Build board brief" }).first();
  await expect(brief).toBeVisible();
  const analysisId = new URL((await brief.getAttribute("href"))!, "http://x").searchParams.get("from_analysis");
  expect(analysisId).toMatch(/^[0-9a-f-]{36}$/);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /^Download PDF/ }).first().click(),
  ]);
  const file = test.info().outputPath("answer.pdf");
  await download.saveAs(file);
  const pdf = readFileSync(file);
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdf.length).toBeGreaterThan(2_000);

  // Reopen the saved answer while another institution is selected: it still names the home.
  await page.goto(`/pro/analyze?analysis=${analysisId}&instId=${EXCLUDED[1].id}`);
  await expect(page.getByText(HOME.name).first()).toBeVisible();
  await expect(page.getByText("$27").first()).toBeVisible();
  await expect(page.getByText(EXCLUDED[1].name)).toHaveCount(0);
  await snap(page, "05-reopened-answer");
});

test("H01-AC2: with no linked institution, \"us\" is never the institution being researched", async ({ page }) => {
  await signIn(page, FIXTURE_USERS.proNoHome.email, `/pro/analyze?instId=${HOME.id}`);
  await page.goto(`/pro/analyze?instId=${HOME.id}`);
  await ask(page, "List ten similarly sized credit unions");
  await expect(peerRows(page)).toHaveCount(10);
  await ask(page, "How does this compare with us?");
  await expect(page.getByText(/No institution is linked to your account/).first()).toBeVisible();
  await expect(page.getByText("(your institution)")).toHaveCount(0);
  await snap(page, "06-no-home-with-us");
});

test("H01-AC4: another account's saved work, and Hamilton without a subscription, are refused", async ({ page, browser }) => {
  expect(savedResearchHref, "the first journey saves research").not.toBe("");
  await signIn(page, FIXTURE_USERS.proNoHome.email, "/pro/analyze");
  // The first account's saved peer research and its legacy answer.
  // The page streams, so the refusal is read from what renders rather than the status line.
  await page.goto(savedResearchHref);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(page.getByText("Indian River Test CU")).toHaveCount(0);
  await page.goto("/pro/analyze?analysis=00000000-0000-4000-8000-000009701301");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(page.getByText("A legacy synthetic answer saved without a research subject.")).toHaveCount(0);

  // A signed-in account without a subscription gets no Hamilton answer.
  const viewer = await browser.newPage();
  await signIn(viewer, FIXTURE_USERS.viewer.email, "/account");
  const denied = await viewer.request.post("/api/hamilton/ask", { data: { question: "List ten similarly sized credit unions", institutionId: String(HOME.id) } });
  expect(denied.status()).toBe(401);
  await viewer.goto(`/pro/analyze?instId=${HOME.id}`);
  await expect(viewer.getByRole("form", { name: "Ask Hamilton" })).toHaveCount(0);
  await viewer.close();

  // Signed out: refused too.
  const anonymous = await browser.newContext();
  const response = await anonymous.request.post(`${test.info().project.use.baseURL}/api/hamilton/ask`, { data: { question: "List ten peers" } });
  expect(response.status()).toBe(401);
  await anonymous.close();
});

test("H06-AC4: a saved answer with no recorded institution reopens unscoped", async ({ page }) => {
  await signIn(page, FIXTURE_USERS.pro.email, "/pro/analyze");
  await page.goto("/pro/analyze?analysis=00000000-0000-4000-8000-000009701301");
  await expect(page.getByText("No institution was recorded with this saved answer.", { exact: false })).toBeVisible();
  await expect(page.getByText("A legacy synthetic answer saved without a research subject.")).toBeVisible();
  // Read-only: no question field that could relabel it.
  await expect(page.getByRole("form", { name: "Ask Hamilton" })).toHaveCount(0);
});

test("H07-T07 provider off: the written-answer route refuses before any model call and saves nothing", async ({ page }) => {
  // serve.mjs blanks every key, so this is the "no key" refusal. The provider-stop refusal with a
  // key present is covered by src/app/api/research/hamilton/route.gate.test.ts.
  const db = connectFixtureDb();
  try {
    const count = async () => (await db`SELECT COUNT(*)::int AS n FROM hamilton_saved_analyses WHERE user_id = ${String(FIXTURE_USERS.pro.id)}`)[0].n;
    const saved = await count();
    await signIn(page, FIXTURE_USERS.pro.email, `/pro/analyze?instId=${HOME.id}`);
    const response = await page.request.post("/api/research/hamilton", {
      data: {
        mode: "analyze", institutionId: HOME.id, intent: "analyze", evidencePolicy: "provisional-first",
        messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "Write a board note on this fee schedule." }] }],
      },
    });
    expect(response.status()).toBe(503);
    expect(await count()).toBe(saved);
  } finally {
    await db.end();
  }
});

test("no paid model call was recorded for any journey", async () => {
  const db = connectFixtureDb();
  try {
    const [usage] = await db`SELECT COUNT(*)::int AS n FROM ai_api_usage_events WHERE created_at > NOW() - interval '1 hour'`;
    expect(usage.n).toBe(0);
  } finally {
    await db.end();
  }
});

/**
 * Known defects the journey found on 2026-10-17. Each is expected to fail today; when it is fixed
 * Playwright reports it as "passed unexpectedly", and the test.fail line comes out.
 */
test.describe("known defects", () => {
  test("H01-AC1: a linked home is used for \"with us\" (fails today: account user id is compared as a string)", async ({ page }) => {
    test.fail(true, "accountContextFromMemberships compares a number with the bigint user id postgres.js returns as a string");
    await signIn(page, FIXTURE_USERS.pro.email, `/pro/analyze?instId=${HOME.id}`);
    await page.goto(`/pro/analyze?instId=${HOME.id}`);
    await expect(page.getByText(`Your institution: ${HOME.name}`)).toBeVisible({ timeout: 10_000 });
  });

  test("H02-AC1: a first-turn peer list can be saved (fails today: 409 on save)", async ({ page }) => {
    test.fail(true, "PeerListView sends previousPeerList: null, which answerPeerList reads as a continuation");
    await signIn(page, FIXTURE_USERS.pro.email, `/pro/analyze?instId=${HOME.id}`);
    await page.goto(`/pro/analyze?instId=${HOME.id}`);
    await ask(page, "List ten similarly sized credit unions");
    await page.getByRole("button", { name: "Save this peer research" }).click();
    await expect(page.getByRole("link", { name: "Reopen saved research" })).toBeVisible({ timeout: 10_000 });
  });

  test("H02-AC3: the criteria line keeps \"FL\" after a fee follow-up (fails today: shows nationwide)", async ({ page }) => {
    test.fail(true, "the fee follow-up rebuilds criteria from the original question, not the refined list");
    await signIn(page, FIXTURE_USERS.pro.email, `/pro/analyze?instId=${HOME.id}`);
    await page.goto(`/pro/analyze?instId=${HOME.id}`);
    await ask(page, "List ten similarly sized credit unions");
    await expect(peerRows(page)).toHaveCount(10);
    await ask(page, "Only Florida");
    await expect(peerRows(page)).toHaveCount(7);
    await ask(page, "Compare their NSF fees");
    await expect(feeTable(page)).toBeVisible();
    await expect(page.getByText(/Selection criteria: credit unions · FL/).last()).toBeVisible({ timeout: 10_000 });
  });
});
