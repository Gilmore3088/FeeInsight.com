/** CP-04/09/10: acknowledged history, actual partial-commit recovery and fresh owner reads. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { BrowserContext, Request } from "playwright/test";
import { expect, test, withJourneyCapture, type Page } from "./evidence";
import { connectFixtureDb, FIXTURE_USERS, HOME, seedHamiltonFixtures, type FixtureDb } from "./fixtures";
import { ask, navigate, signIn } from "./helpers";
import { loadConversationState } from "../../../src/lib/hamilton/chat-memory";
import type { HamiltonConversationState } from "../../../src/lib/hamilton/conversation-state";

// Traces retain cookies and response bodies; this verification uses sanitized captures instead.
test.use({ trace: "off" });
const QUESTION = "List ten similarly sized credit unions";
const INITIAL_LEAD = "10 of 12 matching institutions for Lakeshore Test Credit Union.";
const FLORIDA_LEAD = "7 of 10 previously displayed peers are in FL.";
const TEN = [9701002, 9701003, 9701004, 9701005, 9701006, 9701007, 9701008, 9701009, 9701010, 9701011];
const FLORIDA = TEN.slice(0, 7);
const NAMES = ["Indian River Test CU", "Gulf Breeze Test CU", "Suncoast Harbor Test CU", "Palmetto Grove Test CU", "Keystone Bay Test CU", "Lantana Test CU", "Coquina Test CU", "Peachtree Test CU", "Chattahoochee Test CU", "Savannah Marsh Test CU"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY = "hamiltonConversationState";
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
type MemoryDb = NonNullable<Parameters<typeof loadConversationState>[2]>;

async function guard(db: FixtureDb): Promise<void> {
  const [identity] = await db<{ name: string; host: string }[]>`SELECT current_database() AS name, host(inet_server_addr()) AS host`;
  if (!/^engineering_conversation_[0-9]{8}$/.test(identity.name) || !["127.0.0.1", "::1"].includes(identity.host)) {
    throw new Error("Conversation verification requires its dedicated loopback fixture database");
  }
}

function identity(): Record<string, unknown> {
  try {
    const build = JSON.parse(readFileSync("test-results/engineering-verification/browser/build.json", "utf8"));
    const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim();
    return { ...build, head, tree, clean: head === build.headSha && tree === build.treeSha
      && !execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], { encoding: "utf8" }).trim()
      && readFileSync(".next/BUILD_ID", "utf8").trim() === build.buildId };
  } catch { return { clean: false }; }
}

async function snap(page: Page, name: string): Promise<void> {
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo({ top: 0, left: 0, behavior: "instant" }); });
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  await test.info().attach(name, { path, contentType: "image/png" });
}

async function assertPeers(page: Page, ids: number[]): Promise<number[]> {
  const rows = page.getByRole("table", { name: "Peer table" }).last().locator("tbody tr");
  await expect(rows).toHaveCount(ids.length);
  const actual: number[] = [];
  for (const row of await rows.all()) {
    const link = row.locator("th a").first();
    const id = Number(new URL((await link.getAttribute("href")) ?? "", String(test.info().project.use.baseURL)).searchParams.get("instId"));
    actual.push(id);
    expect(ids).toContain(id);
    await expect(link).toHaveText(NAMES[TEN.indexOf(id)]);
    await expect(row).toContainText("Jun 2026");
    await expect(row.getByRole("link", { name: "NCUA filing source" })).toHaveAttribute("href", "https://ncua.gov/fixture");
  }
  expect(actual.slice().sort((a, b) => a - b)).toEqual(ids);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  return actual;
}

function assertState(state: HamiltonConversationState | null, id: string, questions: string[], order: number[], originOrder = order, refinedState?: string): asserts state is HamiltonConversationState {
  expect(state).not.toBeNull();
  expect(state!.conversationId).toBe(id);
  expect(state!.subject).toEqual({ institutionId: String(HOME.id), institutionName: HOME.name });
  expect(state!.turns.map(turn => turn.question)).toEqual(questions);
  expect(state!.turns.map(turn => turn.lead)).toEqual([INITIAL_LEAD, FLORIDA_LEAD].slice(0, questions.length));
  expect(state!.turns.every(turn => turn.status === "answered" && turn.route === "peer_list")).toBe(true);
  expect(state!.peerSet?.snapshot.selectedIds).toEqual(order);
  expect(state!.peerSet?.snapshot).toEqual({
    originQuestion: QUESTION,
    originInstitutionId: String(HOME.id),
    originSubjectId: HOME.id,
    originRows: originOrder.map(institutionId => ({ institutionId, recordId: institutionId + 100, reportDate: "2026-06-30", source: "ncua" })),
    selectedIds: order,
    ...(refinedState ? { refinedState } : {}),
  });
}

const content = (state: HamiltonConversationState) => ({ ...state, revision: 0, conversationId: null });

test.beforeAll(async () => {
  const db = connectFixtureDb();
  try { await guard(db); await seedHamiltonFixtures(db); } finally { await db.end(); }
});

for (const width of [1440, 390]) {
  test(`CP-04/09/10 at ${width}: retry an unacknowledged real snapshot and resume exact owner history`, async ({ page, browser }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    let db: FixtureDb | undefined;
    let reader: FixtureDb | undefined;
    let owner: BrowserContext | undefined;
    let other: BrowserContext | undefined;
    let createdFunction = false;
    let createdTrigger = false;
    let failed = false;
    let primaryError: unknown;
    let cleanupFailed = false;
    let attachmentFailed = false;
    let completed = false;
    let askPosts = 0;
    const fixtureOrigin = new URL(String(test.info().project.use.baseURL)).origin;
    const onRequest = (request: Request) => {
      const url = new URL(request.url());
      if (request.method() === "POST" && url.origin === fixtureOrigin && url.pathname === "/api/hamilton/ask") askPosts++;
    };
    page.on("request", onRequest);
    const diagnostics: Error[] = [];
    const observations: Record<string, unknown> = {};
    const captureFresh = async (target: Page, run: () => Promise<void>, name: string) => {
      let assertionsCompleted = false;
      try { await withJourneyCapture(target, test.info(), async () => { await run(); assertionsCompleted = true; }, name); }
      catch (error) {
        if (!assertionsCompleted || !(error instanceof Error) || !error.message.startsWith("Browser evidence blocked:")) throw error;
        diagnostics.push(error);
      }
    };
    const removeFault = async () => {
      let removalFailed = false;
      if (createdTrigger) {
        try { await db!.unsafe("DROP TRIGGER engineering_conversation_ack_failure ON public.hamilton_conversations"); createdTrigger = false; }
        catch { removalFailed = true; }
      }
      if (createdFunction) {
        try { await db!.unsafe("DROP FUNCTION public.engineering_conversation_ack_failure()"); createdFunction = false; }
        catch { removalFailed = true; }
      }
      if (removalFailed) throw new Error("Synthetic conversation fault cleanup failed");
    };
    try {
      db = connectFixtureDb();
      await guard(db);
      const [writerPid] = await db<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      reader = connectFixtureDb();
      await guard(reader);
      const [readerPid] = await reader<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      expect(readerPid.pid).not.toBe(writerPid.pid);
      const before = await db<{ id: string }[]>`SELECT id FROM hamilton_conversations WHERE user_id = ${String(FIXTURE_USERS.pro.id)} ORDER BY id LIMIT 1001`;
      expect(before.length).toBeLessThanOrEqual(1000);
      const oldIds = new Set(before.map(row => row.id));
      // A real partial write: message INSERT commits; its separate parent UPDATE refuses ACK.
      // Only this dedicated database and fixed synthetic actor can receive the fixture fault.
      expect(Number.isSafeInteger(FIXTURE_USERS.pro.id)).toBe(true);
      await db.unsafe(`CREATE FUNCTION public.engineering_conversation_ack_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id = '${FIXTURE_USERS.pro.id}' THEN RAISE EXCEPTION 'Synthetic conversation acknowledgement failure'; END IF; RETURN NEW; END $$`);
      createdFunction = true;
      await db.unsafe("CREATE TRIGGER engineering_conversation_ack_failure BEFORE UPDATE ON public.hamilton_conversations FOR EACH ROW EXECUTE FUNCTION public.engineering_conversation_ack_failure()");
      createdTrigger = true;
      await signIn(page, FIXTURE_USERS.pro.email, `/pro/analyze?instId=${HOME.id}`);
      await navigate(page, `/pro/analyze?instId=${HOME.id}`);
      await ask(page, QUESTION);
      await expect(page.getByRole("heading", { name: `10 of 12 matching institutions for ${HOME.name}.` })).toBeVisible();
      const order = await assertPeers(page, TEN);
      await expect(page.getByRole("form", { name: "Ask Hamilton" }).getByRole("alert")).toContainText("We couldn’t finish saving this conversation. Your answers are still here.");
      expect(new URL(page.url()).searchParams.has("conversation")).toBe(false);
      const allocated = (await db<{ id: string; user_id: string; created_at: string }[]>`SELECT id, user_id, created_at::text FROM hamilton_conversations WHERE user_id = ${String(FIXTURE_USERS.pro.id)} ORDER BY id LIMIT 1001`).filter(row => !oldIds.has(row.id));
      expect(allocated).toHaveLength(1);
      const original = allocated[0];
      expect(original.id).toMatch(UUID);
      const partial = await loadConversationState(original.id, FIXTURE_USERS.pro.id, reader as unknown as MemoryDb);
      assertState(partial, original.id, [QUESTION], order);
      const [partialCount] = await reader<{ n: number }[]>`SELECT count(*)::int AS n FROM hamilton_messages WHERE conversation_id = ${original.id} AND tool_calls ? ${KEY}`;
      expect(partialCount.n).toBe(1);
      observations.unacknowledgedSnapshotObserved = true;
      observations.artifactRef = "conversation-1";
      observations.firstWireRevision = partial.revision;
      await page.getByRole("form", { name: "Ask Hamilton" }).getByRole("textbox").fill("Only Florida");
      await snap(page, `unacknowledged-conversation-${width}`);
      const asksBeforeRetry = askPosts;
      expect(asksBeforeRetry).toBeGreaterThan(0);
      await removeFault();
      await page.getByRole("button", { name: "Retry saving conversation", exact: true }).click();
      await expect.poll(() => new URL(page.url()).searchParams.get("conversation")).toBe(original.id);
      await expect(page.getByRole("form", { name: "Ask Hamilton" }).getByRole("textbox")).toHaveValue("Only Florida");
      expect(await assertPeers(page, TEN)).toEqual(order);
      const acknowledged = await loadConversationState(original.id, FIXTURE_USERS.pro.id, reader as unknown as MemoryDb);
      assertState(acknowledged, original.id, [QUESTION], order);
      expect(acknowledged.revision).toBeGreaterThan(partial.revision);
      expect(content(acknowledged)).toEqual(content(partial));
      const [afterRetry] = await reader<{ n: number }[]>`SELECT count(*)::int AS n FROM hamilton_messages WHERE conversation_id = ${original.id} AND tool_calls ? ${KEY}`;
      expect(afterRetry.n).toBe(2);
      expect(askPosts).toBe(asksBeforeRetry);
      observations.retryRegeneratedAnswer = false;
      observations.askPostsBeforeRetry = asksBeforeRetry;
      observations.askPostsAfterRetry = askPosts;
      const afterAllocation = (await db<{ id: string; user_id: string; created_at: string }[]>`SELECT id, user_id, created_at::text FROM hamilton_conversations WHERE user_id = ${String(FIXTURE_USERS.pro.id)} ORDER BY id LIMIT 1001`).filter(row => !oldIds.has(row.id));
      expect(afterAllocation).toEqual(allocated);
      observations.retryAcknowledgedSameAllocation = true;
      observations.retryWireRevision = acknowledged.revision;
      observations.acknowledgedSemanticSha256 = digest(acknowledged);
      await snap(page, `acknowledged-conversation-${width}`);

      owner = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const mobile = await owner.newPage();
      await captureFresh(mobile, async () => {
        const href = `/pro/analyze?conversation=${original.id}&instId=${HOME.id}`;
        await signIn(mobile, FIXTURE_USERS.pro.email, href);
        await navigate(mobile, href);
        await expect(mobile.getByText("Pick up where you left off", { exact: true })).toBeVisible();
        await expect(mobile.getByRole("region", { name: "Earlier in this conversation" })).toContainText(QUESTION);
        await expect(mobile.getByRole("region", { name: "Earlier in this conversation" })).toContainText(INITIAL_LEAD);
        await expect(mobile.getByRole("region", { name: "Institution context" })).toContainText(`Researching: ${HOME.name}`);
        expect(new URL(mobile.url()).searchParams.get("conversation")).toBe(original.id);
        expect(await loadConversationState(original.id, FIXTURE_USERS.pro.id, reader as unknown as MemoryDb)).toEqual(acknowledged);
        const [beforeFollowUp] = await reader!<{ n: number }[]>`SELECT count(*)::int AS n FROM hamilton_messages WHERE conversation_id = ${original.id} AND tool_calls ? ${KEY}`;
        expect(beforeFollowUp.n).toBe(2);
        await ask(mobile, "Only Florida");
        await expect(mobile.getByRole("heading", { name: "7 of 10 previously displayed peers are in FL." })).toBeVisible();
        const floridaOrder = await assertPeers(mobile, FLORIDA);
        await expect.poll(async () => (await loadConversationState(original.id, FIXTURE_USERS.pro.id, reader as unknown as MemoryDb))?.turns.length).toBe(2);
        const resumed = await loadConversationState(original.id, FIXTURE_USERS.pro.id, reader as unknown as MemoryDb);
        assertState(resumed, original.id, [QUESTION, "Only Florida"], floridaOrder, order, "FL");
        expect(resumed.revision).toBeGreaterThan(acknowledged.revision);
        observations.freshOwnerResumeAndContinuation = true;
        observations.resumedSemanticSha256 = digest(resumed);
        await snap(mobile, `fresh-conversation-owner-${width}`);
      }, `fresh-conversation-owner-${width}`);
      const ownerBeforeDenial = await loadConversationState(original.id, FIXTURE_USERS.pro.id, reader as unknown as MemoryDb);
      other = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const denied = await other.newPage();
      await captureFresh(denied, async () => {
        const href = `/pro/analyze?conversation=${original.id}&instId=${HOME.id}`;
        await signIn(denied, FIXTURE_USERS.proNoHome.email, href);
        await navigate(denied, href);
        await expect(denied.getByRole("heading", { name: "What are you working on?" })).toBeVisible();
        await expect(denied.getByRole("region", { name: "Earlier in this conversation" })).toHaveCount(0);
        await expect(denied.getByText(QUESTION, { exact: true })).toHaveCount(0);
        await expect(denied.getByRole("table", { name: "Peer table" })).toHaveCount(0);
        expect(await loadConversationState(original.id, FIXTURE_USERS.proNoHome.id, reader as unknown as MemoryDb)).toBeNull();
        observations.otherOwnerHistoryRefused = true;
        await snap(denied, `foreign-conversation-denial-${width}`);
      }, `foreign-conversation-denial-${width}`);
      expect(await loadConversationState(original.id, FIXTURE_USERS.pro.id, reader as unknown as MemoryDb)).toEqual(ownerBeforeDenial);
      completed = true;
    } catch (error) { failed = true; primaryError = error; }
    finally {
      page.off("request", onRequest);
      try { await removeFault(); } catch { cleanupFailed = true; }
      try { await owner?.close(); } catch { cleanupFailed = true; }
      try { await other?.close(); } catch { cleanupFailed = true; }
      try { await reader?.end(); } catch { cleanupFailed = true; }
      try { await db?.end(); } catch { cleanupFailed = true; }
      try { await test.info().attach("conversation-persistence-evidence", { contentType: "application/json", body: JSON.stringify({
        provenance: "LOCAL_BROWSER_CONVERSATION_UNTRUSTED", schemaVersion: 1, identity: identity(), width,
        fixture: "isolated-loopback-synthetic", completed, cleanupFailed, observations,
        strictBrowserAcceptance: "NOT_ASSESSED", trustedWorkflowProvenance: "NOT_ESTABLISHED", fullM5Complete: false,
      }, null, 2) }); } catch { attachmentFailed = true; }
    }
    if (failed) throw primaryError;
    if (!completed || cleanupFailed || attachmentFailed || identity().clean !== true) throw new Error("Native conversation persistence evidence is incomplete");
    if (diagnostics.length) throw diagnostics[0];
  });
}
