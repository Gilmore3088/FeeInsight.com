/** CP-08/11: real brief navigation, pending acknowledgements and saved-answer forks.
 * The prospective four-case design/literals are retained with the local evidence.
 */
import { createHash, randomInt, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { Browser, BrowserContext, Request } from "playwright/test";
import { expect, test, withJourneyCapture, type Page } from "./evidence";
import { connectFixtureDb, FIXTURE_USERS, HOME, PEERS, seedHamiltonFixtures, type FixtureDb } from "./fixtures";
import { ask, navigate, signIn } from "./helpers";
import { createConversation, loadConversationState, saveConversationState } from "../../../src/lib/hamilton/chat-memory";
import { conversationReducer, emptyConversation, type HamiltonConversationState } from "../../../src/lib/hamilton/conversation-state";

test.use({ trace: "off" }); // Traces retain cookies and response bodies.
const MARKET = "Tell me about Ohio";
const LIST = "List ten similarly sized credit unions";
const FORK = "List ten peers";
const SAVED_QUESTION = "What is the NSF fee at Lakeshore Test Credit Union?";
const SAVED_LEAD = "Lakeshore Test Credit Union's NSF / returned item fee is $27 per item (synthetic fixture).";
const LEAD = "10 of 12 matching institutions for Lakeshore Test Credit Union.";
const FAILURE = "We couldn’t finish saving this conversation. Your answers are still here.";
const SUBJECT = { institutionId: "9701001", institutionName: "Lakeshore Test Credit Union" };
// Frozen independently from the fixture assets and the closest-assets SQL, before execution.
const TEN = [9701002, 9701003, 9701010, 9701009, 9701004, 9701005, 9701006, 9701007, 9701011, 9701008];
const REFS = TEN.map(institutionId => ({ institutionId, recordId: institutionId + 100, reportDate: "2026-06-30", source: "ncua" }));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OWNER = FIXTURE_USERS.pro.id;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
type MemoryDb = NonNullable<Parameters<typeof loadConversationState>[2]>;

function identity(): Record<string, unknown> {
  const build = JSON.parse(readFileSync("test-results/engineering-verification/browser/build.json", "utf8"));
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim();
  return { ...build, head, tree, clean: head === build.headSha && tree === build.treeSha
    && !execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], { encoding: "utf8" }).trim()
    && readFileSync(".next/BUILD_ID", "utf8").trim() === build.buildId };
}

async function guard(db: FixtureDb): Promise<number> {
  const url = new URL(process.env.E2E_DATABASE_URL!);
  const [row] = await db<{ name: string; host: string; port: number; timezone: string; tls: boolean; pid: number }[]>`
    SELECT current_database() AS name, host(inet_server_addr()) AS host, inet_server_port() AS port,
           current_setting('TimeZone') AS timezone, (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS tls,
           pg_backend_pid() AS pid`;
  if (!/^engineering_conversation_[0-9]{8}$/.test(row.name) || url.pathname !== `/${row.name}` || url.search || url.hash
    || !["127.0.0.1", "::1"].includes(row.host) || row.port !== Number(url.port) || row.timezone !== "UTC" || row.tls !== true) {
    throw new Error("Continuity verification requires its exact dedicated TLS loopback database");
  }
  return row.pid;
}

async function inventory(db: FixtureDb) {
  const conversations = await db<{ row: Record<string, unknown> }[]>`
    SELECT to_jsonb(c) AS row FROM hamilton_conversations c WHERE user_id = ${String(OWNER)} ORDER BY id`;
  const messages = await db<{ row: Record<string, unknown> }[]>`
    SELECT to_jsonb(m) AS row FROM hamilton_messages m JOIN hamilton_conversations c ON c.id = m.conversation_id
     WHERE c.user_id = ${String(OWNER)} OR m.user_id = ${String(OWNER)} ORDER BY m.id`;
  expect(conversations.length).toBeLessThan(1000);
  expect(messages.length).toBeLessThan(1000);
  return { conversations: conversations.map(r => r.row), messages: messages.map(r => r.row) };
}

async function savedRow(db: FixtureDb, id: string) {
  const rows = await db<{ row: Record<string, unknown> }[]>`SELECT to_jsonb(a) AS row FROM hamilton_saved_analyses a WHERE id = ${id} AND user_id = ${String(OWNER)}`;
  expect(rows).toHaveLength(1);
  return rows[0].row;
}

function assertState(state: HamiltonConversationState | null, id: string, questions: string[], routes: string[], leads: Array<string | null>, peerQuestion?: string): asserts state is HamiltonConversationState {
  expect(state).not.toBeNull();
  expect(state!.conversationId).toBe(id);
  expect(state!.subject).toEqual(SUBJECT);
  expect(state!.turns.map(t => t.question)).toEqual(questions);
  expect(state!.turns.map(t => t.route)).toEqual(routes);
  expect(state!.turns.map(t => t.lead)).toEqual(leads);
  expect(state!.turns.every(t => t.status === "answered")).toBe(true);
  expect(state!.clarification).toBeNull();
  if (peerQuestion) {
    expect(state!.peerSet?.snapshot).toEqual({ originQuestion: peerQuestion, originInstitutionId: SUBJECT.institutionId, originSubjectId: HOME.id, originRows: REFS, selectedIds: TEN });
    expect(state!.peerSet?.answeredQuestion).toBe(peerQuestion);
    expect(state!.peerSet?.answeredNonce).toBe(state!.nonce);
  } else expect(state!.peerSet).toBeNull();
}

async function visiblePeers(page: Page) {
  const rows = page.getByRole("table", { name: "Peer table" }).last().locator("tbody tr");
  await expect(rows).toHaveCount(10);
  for (let i = 0; i < TEN.length; i++) {
    const link = rows.nth(i).locator("th a").first();
    expect(new URL((await link.getAttribute("href"))!, String(test.info().project.use.baseURL)).searchParams.get("instId")).toBe(String(TEN[i]));
    await expect(link).toHaveText(PEERS.find(peer => peer.id === TEN[i])!.name);
    await expect(rows.nth(i)).toContainText("Jun 2026");
    await expect(rows.nth(i).getByRole("link", { name: "NCUA filing source" })).toHaveAttribute("href", "https://ncua.gov/fixture");
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
}

async function screenshot(page: Page, name: string) {
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo({ top: 0, left: 0, behavior: "instant" }); });
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  await test.info().attach(name, { path, contentType: "image/png" });
}

type ActionRequest = { ordinal: number; requestId: string; frameId: string; loaderId: string; documentPath: string; status: number | null; terminal: "finished" | "failed" | null; terminalEvent: number | null };
/** Passive native observer. No headers, bodies, action IDs, route interception or product hooks. */
async function actionObserver(page: Page) {
  const session = await page.context().newCDPSession(page);
  const rows: ActionRequest[] = [];
  let sequence = 0;
  const origin = new URL(String(test.info().project.use.baseURL)).origin;
  const request = (event: { requestId: string; frameId?: string; loaderId: string; documentURL: string; request: { method: string; url: string } }) => {
    const url = new URL(event.request.url);
    if (url.origin !== origin || url.pathname !== "/pro/analyze" || event.request.method !== "POST") return;
    rows.push({ ordinal: ++sequence, requestId: event.requestId, frameId: event.frameId ?? "", loaderId: event.loaderId,
      documentPath: new URL(event.documentURL).pathname, status: null, terminal: null, terminalEvent: null });
  };
  const response = (event: { requestId: string; response: { status: number } }) => { const row = rows.find(r => r.requestId === event.requestId); if (row) row.status = event.response.status; };
  const terminal = (event: { requestId: string }, kind: "finished" | "failed") => { const row = rows.find(r => r.requestId === event.requestId); if (row) { row.terminal = kind; row.terminalEvent = ++sequence; } };
  const finished = (event: { requestId: string }) => terminal(event, "finished");
  const failed = (event: { requestId: string }) => terminal(event, "failed");
  session.on("Network.requestWillBeSent", request);
  session.on("Network.responseReceived", response);
  session.on("Network.loadingFinished", finished);
  session.on("Network.loadingFailed", failed);
  await session.send("Network.enable");
  await session.send("Page.enable");
  const document = async () => {
    const { frameTree } = await session.send("Page.getFrameTree");
    return { frameId: frameTree.frame.id, loaderId: frameTree.frame.loaderId, timeOrigin: await page.evaluate(() => performance.timeOrigin) };
  };
  return {
    rows, document,
    settled: async () => {
      await expect.poll(() => rows.filter(r => r.terminal === null).length).toBe(0);
      expect(rows.every(r => r.terminal === "finished" && r.status === 200)).toBe(true);
    },
    eof: async (row: ActionRequest) => {
      await expect.poll(() => row.terminal).toBe("finished");
      expect(row.status).toBe(200);
    },
    sameDocument: async (before: Awaited<ReturnType<typeof document>>) => expect(await document()).toEqual(before),
    receipt: () => {
      const frames = new Map<string, string>(), loaders = new Map<string, string>();
      const reference = (map: Map<string, string>, id: string, prefix: string) => {
        if (!id) return "MISSING";
        if (!map.has(id)) map.set(id, `${prefix}-${map.size + 1}`);
        return map.get(id)!;
      };
      return rows.map((row, index) => ({ requestRef: `action-${index + 1}`, sessionRef: "continuity-page-session",
        frameRef: reference(frames, row.frameId, "frame"), loaderRef: reference(loaders, row.loaderId, "document"),
        ordinal: row.ordinal, documentPath: row.documentPath, status: row.status, terminal: row.terminal, terminalEvent: row.terminalEvent }));
    },
    close: async () => { try { await session.detach(); return true; } catch { return false; } },
  };
}

async function boundedRender(page: Page) {
  const start = Date.now();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.waitForTimeout(300); // Finite post-terminal observation, never an absence-for-all-time claim.
  return { milliseconds: Date.now() - start, animationFrames: 2 };
}

type Env = { page: Page; browser: Browser; db: FixtureDb; reader: FixtureDb; observations: Record<string, unknown>; diagnostics: Error[];
  fresh: (run: (page: Page) => Promise<void>, label: string) => Promise<void> };

async function runCase(page: Page, browser: Browser, width: number, caseId: string, run: (env: Env) => Promise<void>) {
  const contexts: BrowserContext[] = [];
  const observations: Record<string, unknown> = {};
  const diagnostics: Error[] = [];
  let db: FixtureDb | undefined, reader: FixtureDb | undefined;
  let primary: unknown, failed = false, completed = false, cleanupFailed = false, attachmentFailed = false;
  try {
    expect(identity().clean).toBe(true);
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    db = connectFixtureDb(); reader = connectFixtureDb();
    const writerPid = await guard(db), readerPid = await guard(reader);
    expect(readerPid).not.toBe(writerPid);
    observations.nativeReaderSeparated = true;
    await seedHamiltonFixtures(db);
    const fresh = async (callback: (target: Page) => Promise<void>, label: string) => {
      const context = await browser.newContext({ viewport: { width, height: width === 1440 ? 900 : 844 } });
      contexts.push(context);
      const target = await context.newPage();
      let assertionsCompleted = false;
      try { await withJourneyCapture(target, test.info(), async () => { await callback(target); assertionsCompleted = true; }, label); }
      catch (error) {
        if (!assertionsCompleted || !(error instanceof Error) || !error.message.startsWith("Browser evidence blocked:")) throw error;
        diagnostics.push(error);
      }
    };
    await run({ page, browser, db, reader, observations, diagnostics, fresh });
    completed = true;
  } catch (error) { primary = error; failed = true; }
  finally {
    cleanupFailed = observations.observerCleanupFailed === true || observations.freshOwnerObserverCleanupFailed === true;
    for (const context of contexts) try { await context.close(); } catch { cleanupFailed = true; }
    try { await reader?.end(); } catch { cleanupFailed = true; }
    try { await db?.end(); } catch { cleanupFailed = true; }
    try { await test.info().attach("conversation-continuity-evidence", { contentType: "application/json", body: JSON.stringify({
      provenance: "LOCAL_BROWSER_CONVERSATION_UNTRUSTED", schemaVersion: 1, caseId, width, identity: identity(),
      completed, cleanupFailed, observations, strictBrowserAcceptance: "NOT_ASSESSED", trustedWorkflowProvenance: "NOT_ESTABLISHED", fullM5Complete: false,
    }, null, 2) }); } catch { attachmentFailed = true; }
  }
  if (failed) throw primary;
  if (!completed || cleanupFailed || attachmentFailed || identity().clean !== true) throw new Error("Native conversation continuity evidence is incomplete");
  if (diagnostics.length) throw diagnostics[0];
}

async function state(reader: FixtureDb, id: string) { return loadConversationState(id, OWNER, reader as unknown as MemoryDb); }
async function newAllocation(reader: FixtureDb, before: Awaited<ReturnType<typeof inventory>>) {
  const rows = (await inventory(reader)).conversations.filter(row => !before.conversations.some(old => old.id === row.id));
  expect(rows).toHaveLength(1);
  const id = String(rows[0].id); expect(id).toMatch(UUID); return id;
}

/** Fixture-only metadata fault. All cleanup is attempted, with the original error preserved. */
async function withFault(db: FixtureDb, reader: FixtureDb, mode: "refuse" | "hold", run: (control: { release: () => Promise<void>; blockerPid: number | null }) => Promise<void>) {
  const fault = `engineering_continuity_ack_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const lock = 9701108003000 + randomInt(1_000_000_000);
  let blocker: FixtureDb | undefined, held = false, functionCreated = false, triggerCreated = false;
  let primary: unknown, failed = false;
  const cleanupFailures: string[] = [];
  const release = async () => {
    let releaseFailed = false;
    try {
      if (held) { const [row] = await blocker!<{ released: boolean }[]>`SELECT pg_advisory_unlock(${lock}::bigint) AS released`; expect(row.released).toBe(true); held = false; }
    } catch { releaseFailed = true; }
    // Independently close BEFORE DDL even if unlock or its assertion failed.
    try { if (blocker) { await blocker.end(); blocker = undefined; held = false; } }
    catch { releaseFailed = true; }
    if (releaseFailed) throw new Error("Owned continuity blocker release or close failed");
  };
  try {
    let blockerPid: number | null = null;
    if (mode === "hold") {
      blocker = connectFixtureDb(); blockerPid = await guard(blocker);
      const [acquisition] = await blocker<{ acquired: boolean }[]>`SELECT pg_try_advisory_lock(${lock}::bigint) AS acquired`;
      expect(acquisition.acquired).toBe(true); held = true;
    }
    await db.unsafe(`CREATE FUNCTION public.${fault}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id = '${OWNER}' THEN ${mode === "hold" ? `PERFORM set_config('lock_timeout', '60000', true); PERFORM pg_advisory_xact_lock(${lock}::bigint);` : "RAISE EXCEPTION 'Synthetic continuity acknowledgement failure';"} END IF; RETURN NEW; END $$`);
    functionCreated = true;
    await db.unsafe(`CREATE TRIGGER ${fault} BEFORE UPDATE ON public.hamilton_conversations FOR EACH ROW EXECUTE FUNCTION public.${fault}()`);
    triggerCreated = true;
    await run({ release, blockerPid });
  } catch (error) { primary = error; failed = true; }
  finally {
    try { await release(); } catch { cleanupFailures.push("blocker release"); }
    // Bound DDL cleanup even if the writer/connection is already gone.
    try { await db`SET lock_timeout = '5000'`; } catch { cleanupFailures.push("cleanup deadline"); }
    if (triggerCreated) try { await db.unsafe(`DROP TRIGGER ${fault} ON public.hamilton_conversations`); } catch { cleanupFailures.push("trigger removal"); }
    if (functionCreated) try { await db.unsafe(`DROP FUNCTION public.${fault}()`); } catch { cleanupFailures.push("function removal"); }
    try {
      const [row] = await reader<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = ${fault}`;
      expect(row.n).toBe(0);
      const [fn] = await reader<{ gone: boolean }[]>`SELECT to_regprocedure(${`public.${fault}()`}) IS NULL AS gone`;
      expect(fn.gone).toBe(true);
    } catch { cleanupFailures.push("independent absence check"); }
    try { await test.info().attach("continuity-fault-cleanup", { contentType: "application/json", body: JSON.stringify({ mode, cleanupFailures, blockerHeld: held }) }); }
    catch { cleanupFailures.push("cleanup attachment"); }
  }
  if (failed) throw primary;
  if (cleanupFailures.length) throw new Error("Continuity fixture fault cleanup failed");
}

for (const width of [1440, 390]) {
  test(`CP08-NATIVE-NORMAL at ${width}: acknowledged brief and same-conversation follow-up`, async ({ page, browser }) => runCase(page, browser, width, "N08-01", async ({ reader, observations }) => {
    await signIn(page, FIXTURE_USERS.pro.email, `/pro/analyze?instId=${HOME.id}`);
    await navigate(page, `/pro/analyze?instId=${HOME.id}`);
    const before = await inventory(reader);
    let asks = 0;
    const onRequest = (request: Request) => { if (request.method() === "POST" && ["/api/hamilton/ask", "/api/research/hamilton"].includes(new URL(request.url()).pathname)) asks++; };
    page.on("request", onRequest);
    try {
      await ask(page, MARKET);
      await expect(page.getByRole("heading", { name: "Ohio: fees, finances and market", exact: true })).toBeVisible();
      const id = await newAllocation(reader, before);
      const url = new URL(page.url());
      expect(url.pathname).toBe("/pro/analyze");
      expect([...url.searchParams.keys()].sort()).toEqual(["brief", "conversation", "instId"]);
      expect(url.searchParams.get("brief")).toBe(MARKET);
      expect(url.searchParams.get("instId")).toBe(SUBJECT.institutionId);
      expect(url.searchParams.get("conversation")).toBe(id);
      assertState(await state(reader, id), id, [MARKET], ["market_brief"], [null]);
      expect(asks).toBe(0);
      const form = page.locator('form[action="/pro/analyze"][method="get"]').filter({ has: page.getByRole("textbox", { name: "Ask a follow-up", exact: true }) });
      await expect(form.locator('input[name="conversation"]')).toHaveValue(id);
      await expect(form.locator('input[name="instId"]')).toHaveValue(SUBJECT.institutionId);
      await expect(form.locator('input[name="send"]')).toHaveValue("1");
      await expect(form.locator('input[name="from_brief"]')).toHaveCount(0);
      await screenshot(page, `market-brief-${width}`);
      const handoff = page.waitForRequest(request => { const candidate = new URL(request.url()); return request.isNavigationRequest() && request.method() === "GET" && candidate.pathname === "/pro/analyze" && candidate.searchParams.get("q") === LIST; });
      await form.getByRole("textbox").fill(LIST);
      await form.getByRole("button", { name: "Ask", exact: true }).click();
      const requestUrl = new URL((await handoff).url());
      expect([...requestUrl.searchParams.keys()].sort()).toEqual(["conversation", "instId", "q", "send"]);
      expect(requestUrl.searchParams.get("conversation")).toBe(id);
      expect(requestUrl.searchParams.get("instId")).toBe(SUBJECT.institutionId);
      expect(requestUrl.searchParams.get("send")).toBe("1");
      await expect(page.getByRole("heading", { name: LEAD, exact: true })).toBeVisible();
      await visiblePeers(page);
      await expect.poll(async () => (await state(reader, id))?.turns.length).toBe(2);
      await page.waitForLoadState("networkidle");
      assertState(await state(reader, id), id, [MARKET, LIST], ["market_brief", "peer_list"], [null, LEAD], LIST);
      expect(await newAllocation(reader, before)).toBe(id);
      expect(new URL(page.url()).searchParams.has("send")).toBe(false);
      observations.normalBriefAndGetHandoff = true;
      observations.marketAskApiCalls = 0;
      observations.artifactSha256 = hash(id);
      await screenshot(page, `brief-followup-${width}`);
    } finally { page.off("request", onRequest); }
  }));

  test(`CP08-NATIVE-FAILED-SAVE-RETRY at ${width}: retry does not revive brief intent`, async ({ page, browser }) => runCase(page, browser, width, "N08-02", async ({ db, reader, observations }) => {
    await signIn(page, FIXTURE_USERS.pro.email, `/pro/analyze?instId=${HOME.id}`);
    await navigate(page, `/pro/analyze?instId=${HOME.id}`);
    const before = await inventory(reader);
    const observer = await actionObserver(page);
    let asks = 0;
    const count = (request: Request) => { if (request.method() === "POST" && ["/api/hamilton/ask", "/api/research/hamilton"].includes(new URL(request.url()).pathname)) asks++; };
    page.on("request", count);
    try {
      let id = "", partial: HamiltonConversationState | null = null;
      await withFault(db, reader, "refuse", async () => {
        await ask(page, MARKET);
        await expect(page.getByRole("form", { name: "Ask Hamilton" }).getByRole("alert")).toContainText(FAILURE);
        id = await newAllocation(reader, before);
        partial = await state(reader, id);
        assertState(partial, id, [MARKET], ["market_brief"], [null]);
        expect(new URL(page.url()).searchParams.has("conversation")).toBe(false);
        expect(new URL(page.url()).searchParams.has("brief")).toBe(false);
        await observer.settled();
        expect(observer.rows).toHaveLength(2); // One allocation, one refused record, both real EOF.
        await screenshot(page, `brief-save-refused-${width}`);
      });
      const cursor = observer.rows.length;
      await page.getByRole("button", { name: "Retry saving conversation", exact: true }).click();
      await expect.poll(() => new URL(page.url()).searchParams.get("conversation")).toBe(id);
      await expect.poll(() => observer.rows.length).toBe(cursor + 1);
      await observer.eof(observer.rows[cursor]);
      observations.postTerminalObservation = await boundedRender(page);
      const acknowledged = await state(reader, id);
      assertState(acknowledged, id, [MARKET], ["market_brief"], [null]);
      expect(acknowledged.revision).toBeGreaterThan(partial!.revision);
      expect({ ...acknowledged, revision: 0 }).toEqual({ ...partial!, revision: 0 });
      expect(await newAllocation(reader, before)).toBe(id);
      expect(new URL(page.url()).searchParams.has("brief")).toBe(false);
      expect(new URL(page.url()).searchParams.get("conversation")).toBe(id);
      await expect(page.getByRole("form", { name: "Ask Hamilton" }).getByRole("alert")).toHaveCount(0);
      expect(asks).toBe(0);
      observations.retrySameAllocationNewerWireNoNavigation = true;
      await screenshot(page, `brief-retry-stays-analyze-${width}`);
    } finally { observations.actions = observer.receipt(); page.off("request", count); observations.observerCleanupFailed = !(await observer.close()); }
  }));

  test(`CP08-NATIVE-PENDING-RESET at ${width}: same document ignores completed old save`, async ({ page, browser }) => runCase(page, browser, width, "N08-03", async ({ db, reader, observations }) => {
    await signIn(page, FIXTURE_USERS.pro.email, `/pro/analyze?instId=${HOME.id}`);
    await navigate(page, `/pro/analyze?instId=${HOME.id}`);
    const before = await inventory(reader);
    const observer = await actionObserver(page);
    const document = await observer.document();
    observations.pendingResetOutcome = "UNKNOWN_UNTIL_CORRELATED_EOF_AND_POST_TERMINAL_CHECKS";
    try {
      let oldId = "";
      await withFault(db, reader, "hold", async ({ release, blockerPid }) => {
        await ask(page, MARKET);
        await expect.poll(async () => (await inventory(reader)).messages.length).toBe(before.messages.length + 1);
        oldId = await newAllocation(reader, before);
        assertState(await state(reader, oldId), oldId, [MARKET], ["market_brief"], [null]);
        type Waiter = { pid: number; metadataUpdate: boolean; active: boolean };
        const waiters = () => reader<Waiter[]>`SELECT pid, query LIKE '%UPDATE hamilton_conversations%' AS "metadataUpdate", state = 'active' AS active
          FROM pg_stat_activity WHERE datname = current_database() AND ${blockerPid!} = ANY(pg_blocking_pids(pid))`;
        await expect.poll(async () => (await waiters()).length).toBe(1);
        const [waiter] = await waiters();
        expect(waiter.metadataUpdate && waiter.active).toBe(true);
        expect(waiter.pid).not.toBe(blockerPid);
        await expect.poll(() => observer.rows.length).toBe(2);
        expect(observer.rows[0].terminal).toBe("finished");
        const heldRequest = observer.rows[1];
        expect(heldRequest.terminal).toBeNull();
        expect(heldRequest.frameId).toBe(document.frameId);
        expect(heldRequest.loaderId).toBe(document.loaderId);
        expect(heldRequest.documentPath).toBe("/pro/analyze");
        expect(observer.rows.filter(row => row.terminal === null)).toEqual([heldRequest]);
        await observer.sameDocument(document);
        await expect(page.getByRole("form", { name: "Ask Hamilton" }).getByRole("status")).toHaveText("Saving conversation…");
        await page.getByRole("button", { name: "New conversation", exact: true }).click();
        await expect(page.getByRole("heading", { name: "What are you working on?", exact: true })).toBeVisible();
        await observer.sameDocument(document);
        expect(heldRequest.terminal).toBeNull();
        observations.nativePendingSnapshotAndWaiter = true;
        await screenshot(page, `pending-save-reset-before-release-${width}`);
        await release();
        await observer.eof(heldRequest); // Canceled/missing EOF remains UNKNOWN/failing, never a stale-guard pass.
        await expect.poll(async () => (await waiters()).length).toBe(0);
        const [parent] = await reader<{ title: string }[]>`SELECT title FROM hamilton_conversations WHERE id = ${oldId} AND user_id = ${String(OWNER)}`;
        expect(parent.title).toBe(MARKET);
        observations.postTerminalObservation = await boundedRender(page);
        await observer.sameDocument(document);
        await expect(page.getByRole("heading", { name: "What are you working on?", exact: true })).toBeVisible();
        await expect(page.getByRole("form", { name: "Ask Hamilton" }).getByRole("status")).toHaveCount(0);
        await expect(page.getByRole("form", { name: "Ask Hamilton" }).getByRole("alert")).toHaveCount(0);
        expect(new URL(page.url()).searchParams.has("conversation")).toBe(false);
        expect(new URL(page.url()).searchParams.has("brief")).toBe(false);
        observations.sameDocumentStaleReplySuppressedAfterNativeEof = true;
        observations.pendingResetOutcome = "BOUNDED_NATIVE_OBSERVED";
      });
      await ask(page, LIST);
      await expect(page.getByRole("heading", { name: LEAD, exact: true })).toBeVisible();
      await visiblePeers(page);
      await expect.poll(() => new URL(page.url()).searchParams.get("conversation")).toMatch(UUID);
      const nextId = new URL(page.url()).searchParams.get("conversation")!;
      expect(nextId).not.toBe(oldId);
      assertState(await state(reader, nextId), nextId, [LIST], ["peer_list"], [LEAD], LIST);
      assertState(await state(reader, oldId), oldId, [MARKET], ["market_brief"], [null]);
      expect((await inventory(reader)).conversations.length).toBe(before.conversations.length + 2);
      await observer.settled();
      observations.newViewDifferentAllocation = true;
      await screenshot(page, `pending-reset-new-conversation-${width}`);
    } finally { observations.actions = observer.receipt(); observations.observerCleanupFailed = !(await observer.close()); }
  }));

  test(`CP11-NATIVE-OPEN-AND-FORK at ${width}: unchanged open and earlier answer fork`, async ({ page, browser }) => runCase(page, browser, width, "N11-01/02/03", async ({ db, reader, observations, fresh }) => {
    // Seeded baseline establishes continuity, not upstream generation or UI saving.
    const savedId = randomUUID();
    const response = { title: "Synthetic saved NSF answer", confidence: "medium", hamiltonView: SAVED_LEAD,
      whatThisMeans: "A synthetic source-grounded fixture for saved-answer navigation.", whyItMatters: [], evidence: { metrics: [] }, exploreFurther: [] };
    await db`INSERT INTO hamilton_saved_analyses (id, user_id, institution_id, status, title, analysis_focus, prompt, response_json)
      VALUES (${savedId}, ${String(OWNER)}, ${SUBJECT.institutionId}, 'active', 'Synthetic saved NSF answer', 'pricing', ${SAVED_QUESTION}, ${db.json(response)})`;
    const originalId = await createConversation(OWNER, db as unknown as MemoryDb);
    let seeded = conversationReducer(emptyConversation(SUBJECT), { type: "ask", question: SAVED_QUESTION, route: "written" });
    seeded = conversationReducer(seeded, { type: "answered", turnId: "t1", lead: SAVED_LEAD, route: "written", savedAnalysisId: savedId });
    expect(await saveConversationState(originalId, OWNER, seeded, db as unknown as MemoryDb)).toBe(true);
    await signIn(page, FIXTURE_USERS.pro.email, `/pro/analyze?conversation=${originalId}&instId=${HOME.id}`);
    await navigate(page, `/pro/analyze?conversation=${originalId}&instId=${HOME.id}`);
    await expect(page.getByText(SAVED_LEAD, { exact: true }).first()).toBeVisible();
    // The later original turn is real UI work, so the older fork has something to exclude.
    await ask(page, LIST);
    await expect(page.getByRole("heading", { name: LEAD, exact: true })).toBeVisible();
    await visiblePeers(page);
    await expect.poll(async () => (await state(reader, originalId))?.turns.length).toBe(2);
    await page.waitForLoadState("networkidle");
    const original = await state(reader, originalId);
    assertState(original, originalId, [SAVED_QUESTION, LIST], ["written", "peer_list"], [SAVED_LEAD, LEAD], LIST);
    expect(original.turns[0].savedAnalysisId).toBe(savedId);
    const before = await inventory(reader), savedBefore = await savedRow(reader, savedId);
    observations.baseline = "SEEDED_LOCAL_BASELINE_NOT_UI_SAVE_PROOF_WITH_LATER_REAL_UI_PEER_TURN";
    let forkId = "";
    await fresh(async target => {
      await signIn(target, FIXTURE_USERS.pro.email, "/pro");
      const loggedInBefore = await inventory(reader);
      expect(loggedInBefore).toEqual(before);
      const observer = await actionObserver(target);
      try {
        await navigate(target, `/pro/analyze?conversation=${originalId}&instId=${HOME.id}`);
        await expect(target.getByText("Pick up where you left off", { exact: true })).toBeVisible();
        const earlier = target.getByRole("region", { name: "Earlier in this conversation" });
        await expect(earlier).toContainText(SAVED_QUESTION);
        await expect(earlier).toContainText(LIST);
        await expect(target.getByRole("region", { name: "Institution context" })).toContainText(`Researching: ${HOME.name}`);
        expect(await state(reader, originalId)).toEqual(original);
        await observer.settled();
        observations.unchangedOpenObservation = await boundedRender(target);
        expect(await inventory(reader)).toEqual(before);
        expect(await savedRow(reader, savedId)).toEqual(savedBefore);
        observations.N11_01_completed = true;
        await screenshot(target, `unchanged-original-conversation-${width}`);
        const open = earlier.getByRole("link", { name: "Open this answer", exact: true });
        const href = new URL((await open.getAttribute("href"))!, String(test.info().project.use.baseURL));
        expect(href.pathname).toBe("/pro/analyze");
        // Saved history resolves its own authorized subject; never attach today's institution.
        expect([...href.searchParams.keys()].sort()).toEqual(["analysis"]);
        expect(href.searchParams.get("analysis")).toBe(savedId);
        await open.click();
        await expect(target.getByText(SAVED_LEAD, { exact: true }).first()).toBeVisible();
        await target.waitForLoadState("networkidle");
        expect(new URL(target.url()).searchParams.get("analysis")).toBe(savedId);
        expect([...new URL(target.url()).searchParams.keys()].sort()).toEqual(["analysis"]);
        await expect(target.getByRole("region", { name: "Institution context" })).toContainText(`Researching: ${HOME.name}`);
        await expect(target.getByRole("region", { name: "Earlier in this conversation" })).toHaveCount(0);
        await expect(target.getByText(LIST, { exact: true })).toHaveCount(0);
        await expect(target.getByRole("table", { name: "Peer table" })).toHaveCount(0);
        await observer.settled();
        observations.olderAnswerObservation = await boundedRender(target);
        expect(await inventory(reader)).toEqual(before);
        expect(await savedRow(reader, savedId)).toEqual(savedBefore);
        observations.N11_02_completed = true;
        await screenshot(target, `opened-earlier-saved-answer-${width}`);
        await ask(target, FORK);
        await expect(target.getByRole("heading", { name: LEAD, exact: true })).toBeVisible();
        await visiblePeers(target);
        await expect.poll(() => new URL(target.url()).searchParams.get("conversation")).toMatch(UUID);
        forkId = new URL(target.url()).searchParams.get("conversation")!;
        expect(forkId).not.toBe(originalId);
        expect(await newAllocation(reader, before)).toBe(forkId);
        const fork = await state(reader, forkId);
        assertState(fork, forkId, [SAVED_QUESTION, FORK], ["written", "peer_list"], [SAVED_LEAD, LEAD], FORK);
        expect(fork.turns[0].savedAnalysisId).toBe(savedId);
        await observer.settled();
        expect([...new URL(target.url()).searchParams.keys()].sort()).toEqual(["conversation"]);
        await expect(target.getByRole("region", { name: "Institution context" })).toContainText(`Researching: ${HOME.name}`);
        const settledFork = await state(reader, forkId);
        assertState(settledFork, forkId, [SAVED_QUESTION, FORK], ["written", "peer_list"], [SAVED_LEAD, LEAD], FORK);
        expect(settledFork.turns[0].savedAnalysisId).toBe(savedId);
        const after = await inventory(reader);
        expect(after.conversations.filter(row => row.id !== forkId)).toEqual(before.conversations);
        expect(after.messages.filter(row => row.conversation_id !== forkId)).toEqual(before.messages);
        expect(await savedRow(reader, savedId)).toEqual(savedBefore);
        observations.N11_03_forkCompleted = true;
        observations.originalInventorySha256 = hash(before);
        observations.savedAnalysisSha256 = hash(savedBefore);
        await screenshot(target, `saved-answer-fork-${width}`);
      } finally { observations.freshOwnerActions = observer.receipt(); observations.freshOwnerObserverCleanupFailed = !(await observer.close()); }
    }, `saved-answer-open-and-fork-${width}`);
    const fork = await state(reader, forkId), afterFork = await inventory(reader);
    assertState(fork, forkId, [SAVED_QUESTION, FORK], ["written", "peer_list"], [SAVED_LEAD, LEAD], FORK);
    expect(fork.turns[0].savedAnalysisId).toBe(savedId);
    await fresh(async target => {
      const href = `/pro/analyze?conversation=${forkId}`;
      await signIn(target, FIXTURE_USERS.pro.email, href);
      await navigate(target, href);
      await expect(target.getByText("Pick up where you left off", { exact: true })).toBeVisible();
      expect([...new URL(target.url()).searchParams.keys()].sort()).toEqual(["conversation"]);
      expect(new URL(target.url()).searchParams.get("conversation")).toBe(forkId);
      await expect(target.getByRole("region", { name: "Institution context" })).toContainText(`Researching: ${HOME.name}`);
      await expect(target.getByRole("region", { name: "Earlier in this conversation" })).toContainText(SAVED_QUESTION);
      await expect(target.getByRole("region", { name: "Earlier in this conversation" })).toContainText(FORK);
      await expect(target.getByRole("region", { name: "Earlier in this conversation" }).getByText(LIST, { exact: true })).toHaveCount(0);
      await boundedRender(target);
      const freshFork = await state(reader, forkId);
      assertState(freshFork, forkId, [SAVED_QUESTION, FORK], ["written", "peer_list"], [SAVED_LEAD, LEAD], FORK);
      expect(freshFork.turns[0].savedAnalysisId).toBe(savedId);
      expect(freshFork).toEqual(fork);
      expect(await inventory(reader)).toEqual(afterFork);
      expect(await savedRow(reader, savedId)).toEqual(savedBefore);
      observations.N11_03_freshReadCompleted = true;
      await screenshot(target, `fresh-owner-fork-${width}`);
    }, `saved-answer-fresh-fork-${width}`);
  }));
}
