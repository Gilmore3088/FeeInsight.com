/** Existing saved board-brief UPDATE, PDF parity and late-save navigation.
 * Prospective native literals: test-results/engineering-verification/board-brief-save/native-design-v1.json.
 * Seeded reports prove continuity, not upstream generation or current-bank truth.
 */
import { createHash, randomInt, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extractText } from "unpdf";
import type postgres from "postgres";
import type { Browser, BrowserContext } from "playwright/test";
import { expect, test, withJourneyCapture, type Page } from "./evidence";
import { connectFixtureDb, FIXTURE_USERS, HOME, type FixtureDb } from "./fixtures";
import { signIn } from "./helpers";
import type { ReportSummaryResponse } from "../../../src/lib/hamilton/types";

test.use({ trace: "off" }); // Traces retain cookies and response bodies.
const A = "00000000-0000-4000-8000-000009701411";
const B = "00000000-0000-4000-8000-000009701412";
const ANALYSIS = "00000000-0000-4000-8000-000009701311";
const OWNER = 9701101;
const TITLE = "Lakeshore board brief A";
const EDITED = "Lakeshore board brief A: reviewed";
const NOTE = "Reviewed for the synthetic November committee.";
const OTHER_TITLE = "Indian River board brief B";
const DATE = "2026-06-30";
const SOURCE = "https://fixture.test/9701001/saved-wire.pdf";
const LIMIT = "Synthetic stored snapshot; no current schedule recheck.";
const SAVED = "Saved. The PDF uses this version.";
const artifactHref = (id: string) => `/pro/reports?report_id=${id}`;

function report(isA: boolean): ReportSummaryResponse {
  const name = isA ? HOME.name : "Indian River Test CU";
  const wire = isA ? 35 : 41, peer = isA ? 30 : 29, difference = isA ? 5 : 12;
  const headline = `${name}: saved wire fee $${wire}; original peer median $${peer}; difference $${difference}.`;
  return {
    title: isA ? TITLE : OTHER_TITLE,
    identityContext: { version: 1, researchInstitutionId: isA ? HOME.id : 9701002, researchInstitutionName: name,
      accountInstitutionId: HOME.id, accountInstitutionName: HOME.name, accountStatus: "identified" },
    boardBrief: { ...(isA ? { sourceAnalysisId: ANALYSIS } : {}), teamNote: "", includeEvidence: true },
    answer: { headline, decisions: [] }, executiveSummary: [headline], snapshot: [],
    strategicRationale: "Frozen synthetic evidence for a saved-report continuity check.",
    tradeoffs: [{ label: "Stored-source limit", value: LIMIT }], recommendation: LIMIT,
    implementationNotes: ["Built from a saved synthetic Hamilton answer. Figures are not refreshed."],
    exhibits: [{ id: "statistical_appendix", title: "Original saved wire evidence", subtitle: `Reporting date ${DATE}; not refreshed`,
      columns: ["Measure", "Value", "Source / note"], rows: [
        ["Saved wire fee", `$${wire}`, `Synthetic stored schedule, ${DATE}`],
        ["Original peer median", `$${peer}`, "Original synthetic cohort"],
        ["Difference", `$${difference}`, "Saved wire fee minus original peer median"],
      ], note: LIMIT }],
    sources: [{ label: "Synthetic stored schedule", detail: `Original saved schedule; reporting date ${DATE}`,
      url: isA ? SOURCE : "https://fixture.test/9701002/saved-wire.pdf" }],
    exportControls: { pdfEnabled: true, shareEnabled: false },
  };
}

type Row = Record<string, unknown> & { id: string; report_json: ReportSummaryResponse };
async function guard(db: FixtureDb): Promise<number> {
  const target = new URL(process.env.E2E_DATABASE_URL!);
  expect(["postgres:", "postgresql:"]).toContain(target.protocol);
  expect(target.hostname).toBe("127.0.0.1"); expect(target.port).toBe("65435");
  expect(target.pathname).toBe("/engineering_board_brief_20261108"); expect(target.search).toBe(""); expect(target.hash).toBe("");
  const [row] = await db<{ name: string; host: string; port: number; timezone: string; tls: boolean; pid: number }[]>`
    SELECT current_database() AS name, host(inet_server_addr()) AS host, inet_server_port() AS port,
           current_setting('TimeZone') AS timezone, (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS tls,
           pg_backend_pid() AS pid`;
  expect(row).toMatchObject({ name: "engineering_board_brief_20261108", host: "127.0.0.1", port: 65435, timezone: "UTC", tls: true });
  return row.pid;
}

async function inventory(db: FixtureDb) {
  const reports = await db<{ row: Row }[]>`SELECT to_jsonb(r) AS row FROM hamilton_reports r WHERE user_id = ${String(OWNER)} ORDER BY id LIMIT 1001`;
  const analyses = await db<{ row: Record<string, unknown> }[]>`SELECT to_jsonb(a) AS row FROM hamilton_saved_analyses a WHERE user_id = ${String(OWNER)} ORDER BY id LIMIT 1001`;
  expect(reports.length).toBeLessThanOrEqual(1000); expect(analyses.length).toBeLessThanOrEqual(1000);
  return { reports: reports.map(r => r.row), analyses: analyses.map(a => a.row) };
}
async function saved(db: FixtureDb, id: string): Promise<Row> {
  const [value] = await db<{ row: Row }[]>`SELECT to_jsonb(r) AS row FROM hamilton_reports r WHERE id = ${id} AND user_id = ${String(OWNER)}`;
  expect(value).toBeDefined(); return value.row;
}
function editedRow(before: Row): Row {
  const original = before.report_json;
  return { ...before, report_json: { ...original, title: EDITED,
    boardBrief: { ...original.boardBrief!, teamNote: NOTE },
    implementationNotes: [...original.implementationNotes, `Team note (user-authored): ${NOTE}`] } };
}
function assertEdited(actual: Row, before: Row) {
  expect(actual).toEqual(editedRow(before));
  expect(actual.report_json.exhibits).toEqual(report(true).exhibits);
  expect(actual.report_json.sources).toEqual(report(true).sources);
  expect(actual.report_json.identityContext).toEqual(report(true).identityContext);
  expect(actual.report_json.boardBrief?.sourceAnalysisId).toBe(ANALYSIS);
}
async function seed(db: FixtureDb, reader: FixtureDb) {
  // Global setup owns the base fixture. Preserve unrelated artifacts produced by
  // the unchanged creation journey; reset only this continuity case's fixed IDs.
  await db`DELETE FROM hamilton_reports WHERE id IN (${A}::uuid, ${B}::uuid) AND user_id = ${String(OWNER)}`;
  await db`DELETE FROM hamilton_saved_analyses WHERE id = ${ANALYSIS}::uuid AND user_id = ${String(OWNER)}`;
  const answer = { title: TITLE, confidence: { level: "medium", basis: ["Synthetic stored evidence"] },
    hamiltonView: `${HOME.name}: saved wire fee $35; original peer median $30; difference $5.`, whatThisMeans: LIMIT,
    whyItMatters: [], evidence: { metrics: [] }, exploreFurther: [] };
  await db`INSERT INTO hamilton_saved_analyses (id, user_id, institution_id, title, analysis_focus, prompt, response_json)
    VALUES (${ANALYSIS}, ${String(OWNER)}, ${String(HOME.id)}, ${TITLE}, 'pricing', 'Saved synthetic wire review', ${db.json(answer)})`;
  for (const isA of [true, false]) {
    const value = report(isA);
    // postgres.js must receive an object, not an already serialized JSON string.
    const json: postgres.JSONValue = JSON.parse(JSON.stringify(value));
    await db`INSERT INTO hamilton_reports
      (id, user_id, institution_id, report_type, report_json, status, evidence_policy, selected_source, selected_source_label,
       peer_baseline_source, peer_baseline_label, peer_fallback_reason, selected_verified_fee_count, selected_provisional_fee_count, selected_fee_delta_count)
      VALUES (${isA ? A : B}, ${String(OWNER)}, ${isA ? String(HOME.id) : "9701002"}, 'board_brief', ${db.json(json)}, 'generated',
       'source-diligence', 'manual', 'Original saved analysis', 'saved-peer-set', 'Original synthetic cohort',
       'Saved synthetic evidence; no current cohort lookup.', 0, 0, 0)`;
  }
  // Read the real persisted fixture independently before any page can consume it.
  const reports = await reader<{ kind: string; row: Row }[]>`
    SELECT jsonb_typeof(report_json) AS kind, to_jsonb(r) AS row FROM hamilton_reports r
    WHERE id IN (${A}::uuid, ${B}::uuid) AND user_id = ${String(OWNER)} ORDER BY id`;
  expect(reports).toHaveLength(2);
  for (const [index, saved] of reports.entries()) {
    const isA = index === 0;
    expect(saved.kind).toBe("object");
    expect(saved.row.report_json).toEqual(report(isA));
    expect(saved.row).toMatchObject({ id: isA ? A : B, user_id: String(OWNER), institution_id: isA ? String(HOME.id) : "9701002",
      report_type: "board_brief", status: "generated", scenario_id: null, peer_set_id: null,
      evidence_policy: "source-diligence", selected_source: "manual", selected_source_label: "Original saved analysis",
      peer_baseline_source: "saved-peer-set", peer_baseline_label: "Original synthetic cohort",
      peer_fallback_reason: "Saved synthetic evidence; no current cohort lookup.",
      selected_verified_fee_count: 0, selected_provisional_fee_count: 0, selected_fee_delta_count: 0 });
  }
  const analyses = await reader<{ kind: string; row: Record<string, unknown> }[]>`
    SELECT jsonb_typeof(response_json) AS kind, to_jsonb(a) AS row FROM hamilton_saved_analyses a
    WHERE id = ${ANALYSIS}::uuid AND user_id = ${String(OWNER)}`;
  expect(analyses).toHaveLength(1); expect(analyses[0].kind).toBe("object");
  expect(analyses[0].row.response_json).toEqual(answer);
  expect(analyses[0].row).toMatchObject({ id: ANALYSIS, user_id: String(OWNER), institution_id: String(HOME.id),
    title: TITLE, analysis_focus: "pricing", prompt: "Saved synthetic wire review", response_json: answer });
  return { nativeReportJsonbType: "object", nativeAnalysisJsonbType: "object", reports: 2, analyses: 1, exactFixtureReadback: true };
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
async function shot(page: Page, name: string) {
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo({ top: 0, left: 0, behavior: "instant" }); });
  const file = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path: file, fullPage: true, animations: "disabled" });
  await test.info().attach(name, { path: file, contentType: "image/png" });
}
async function rendered(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.waitForTimeout(300); return { animationFrames: 2, minimumMilliseconds: 300 };
}
async function editor(page: Page, title: string) {
  await expect(page.getByRole("heading", { name: "Board brief", exact: true })).toBeVisible();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(title);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
}

type NativePost = { nativeId: string; frame: string; loader: string; ordinal: number; terminal: "finished" | "failed" | null; status: number | null; terminalOrdinal: number | null };
async function observe(page: Page) {
  const session = await page.context().newCDPSession(page), rows: NativePost[] = [];
  let ordinal = 0;
  const origin = new URL(String(test.info().project.use.baseURL)).origin;
  session.on("Network.requestWillBeSent", (e: { requestId: string; frameId?: string; loaderId: string; request: { method: string; url: string } }) => {
    const url = new URL(e.request.url);
    if (url.origin === origin && url.pathname === "/pro/reports" && e.request.method === "POST") rows.push({ nativeId: e.requestId,
      frame: e.frameId ?? "", loader: e.loaderId, ordinal: ++ordinal, terminal: null, status: null, terminalOrdinal: null });
  });
  session.on("Network.responseReceived", (e: { requestId: string; response: { status: number } }) => { const row = rows.find(r => r.nativeId === e.requestId); if (row) row.status = e.response.status; });
  session.on("Network.loadingFinished", (e: { requestId: string }) => { const row = rows.find(r => r.nativeId === e.requestId); if (row) { row.terminal = "finished"; row.terminalOrdinal = ++ordinal; } });
  session.on("Network.loadingFailed", (e: { requestId: string }) => { const row = rows.find(r => r.nativeId === e.requestId); if (row) { row.terminal = "failed"; row.terminalOrdinal = ++ordinal; } });
  await session.send("Network.enable"); await session.send("Page.enable");
  const document = async () => { const { frameTree } = await session.send("Page.getFrameTree"); return {
    frame: frameTree.frame.id, loader: frameTree.frame.loaderId, timeOrigin: await page.evaluate(() => performance.timeOrigin) }; };
  const finish = async (row: NativePost) => { await expect.poll(() => row.terminal).toBe("finished"); expect(row.status).toBe(200); };
  return { rows, document, finish,
    settled: async () => { await expect.poll(() => rows.filter(r => r.terminal === null).length).toBe(0); expect(rows.every(r => r.terminal === "finished" && r.status === 200)).toBe(true); },
    receipt: () => rows.map((r, i) => ({ requestRef: `report-action-${i + 1}`, sessionRef: "board-page-session", framePresent: Boolean(r.frame),
      documentPresent: Boolean(r.loader), ordinal: r.ordinal, terminalOrdinal: r.terminalOrdinal, status: r.status, terminal: r.terminal })),
    close: async () => { try { await session.detach(); return true; } catch { return false; } },
  };
}

type Env = { page: Page; db: FixtureDb; reader: FixtureDb; observations: Record<string, unknown>;
  fresh: (label: string, run: (page: Page) => Promise<void>) => Promise<void> };
async function runCase(page: Page, browser: Browser, width: number, caseId: string, run: (env: Env) => Promise<void>) {
  const contexts: BrowserContext[] = [], diagnostics: Error[] = [], observations: Record<string, unknown> = {};
  let db: FixtureDb | undefined, reader: FixtureDb | undefined, primary: unknown;
  let failed = false, completed = false, cleanupFailed = false, attachmentFailed = false;
  try {
    expect(identity().clean).toBe(true);
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    db = connectFixtureDb(); reader = connectFixtureDb();
    expect(await guard(reader)).not.toBe(await guard(db));
    observations.seedReadback = await seed(db, reader); observations.baseline = "SEEDED_EXISTING_REPORT_NOT_UPSTREAM_CREATION_PROOF";
    const fresh = async (label: string, callback: (target: Page) => Promise<void>) => {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } }); contexts.push(context);
      const target = await context.newPage(); let assertionsCompleted = false;
      try { await withJourneyCapture(target, test.info(), async () => { await callback(target); assertionsCompleted = true; }, label); }
      catch (error) { if (!assertionsCompleted || !(error instanceof Error) || !error.message.startsWith("Browser evidence blocked:")) throw error; diagnostics.push(error); }
    };
    await run({ page, db, reader, observations, fresh }); completed = true;
  } catch (error) { primary = error; failed = true; }
  finally {
    cleanupFailed = observations.observerCleanupFailed === true;
    for (const context of contexts) try { await context.close(); } catch { cleanupFailed = true; }
    try { await reader?.end(); } catch { cleanupFailed = true; }
    try { await db?.end(); } catch { cleanupFailed = true; }
    try { await test.info().attach("board-brief-continuity-evidence", { contentType: "application/json", body: JSON.stringify({
      schemaVersion: 1, provenance: "LOCAL_BROWSER_BOARD_BRIEF_UNTRUSTED", caseId, width, identity: identity(),
      completed, cleanupFailed, observations, strictBrowserAcceptance: "NOT_ASSESSED", trustedWorkflowProvenance: "NOT_ESTABLISHED", fullM5Complete: false,
    }, null, 2) }); } catch { attachmentFailed = true; }
  }
  if (failed) throw primary;
  if (!completed || cleanupFailed || attachmentFailed || identity().clean !== true) throw new Error("Board-brief native evidence incomplete");
  if (diagnostics.length) throw diagnostics[0];
}

async function withGate(db: FixtureDb, reader: FixtureDb, run: (release: () => Promise<void>, blockerPid: number) => Promise<void>) {
  const fault = `engineering_board_ack_${randomUUID().replaceAll("-", "").slice(0, 16)}`, key = 9701108003000 + randomInt(1_000_000_000);
  let blocker: FixtureDb | undefined, held = false, madeFunction = false, madeTrigger = false, primary: unknown, failed = false;
  const errors: string[] = [];
  const release = async () => {
    let releaseFailed = false;
    try { if (held) { const [r] = await blocker!<{ released: boolean }[]>`SELECT pg_advisory_unlock(${key}::bigint) AS released`; expect(r.released).toBe(true); held = false; } }
    catch { releaseFailed = true; }
    try { if (blocker) { await blocker.end(); blocker = undefined; held = false; } } catch { releaseFailed = true; }
    if (releaseFailed) throw new Error("Owned board-brief blocker release or close failed");
  };
  try {
    blocker = connectFixtureDb(); const pid = await guard(blocker);
    expect(pid).not.toBe(await guard(reader)); expect(pid).not.toBe(await guard(db));
    const [lock] = await blocker<{ acquired: boolean }[]>`SELECT pg_try_advisory_lock(${key}::bigint) AS acquired`; expect(lock.acquired).toBe(true); held = true;
    await db.unsafe(`CREATE FUNCTION public.${fault}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = '${A}'::uuid AND NEW.user_id = '${OWNER}' THEN PERFORM set_config('lock_timeout','90000',true); PERFORM pg_advisory_xact_lock(${key}::bigint); END IF; RETURN NEW; END $$`);
    madeFunction = true;
    await db.unsafe(`CREATE TRIGGER ${fault} BEFORE UPDATE ON public.hamilton_reports FOR EACH ROW EXECUTE FUNCTION public.${fault}()`); madeTrigger = true;
    await run(release, pid);
  } catch (error) { primary = error; failed = true; }
  finally {
    try { await release(); } catch { errors.push("blocker release"); }
    try { await db`SET lock_timeout = '5000'`; } catch { errors.push("cleanup deadline"); }
    if (madeTrigger) try { await db.unsafe(`DROP TRIGGER ${fault} ON public.hamilton_reports`); } catch { errors.push("trigger removal"); }
    if (madeFunction) try { await db.unsafe(`DROP FUNCTION public.${fault}()`); } catch { errors.push("function removal"); }
    try { const [r] = await reader<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = ${fault}`; expect(r.n).toBe(0);
      const [fn] = await reader<{ absent: boolean }[]>`SELECT to_regprocedure(${`public.${fault}()`}) IS NULL AS absent`; expect(fn.absent).toBe(true);
    } catch { errors.push("independent absence check"); }
    try { await test.info().attach("board-brief-gate-cleanup", { contentType: "application/json", body: JSON.stringify({ errors, blockerHeld: held }) }); } catch { errors.push("cleanup attachment"); }
  }
  if (failed) throw primary; if (errors.length) throw new Error("Board-brief fixture fault cleanup failed");
}

for (const width of [1440, 390]) {
  test(`BBE-N01/N02/N04 at ${width}: existing edit, actual PDF and fresh phone owner`, async ({ page, browser }) => runCase(page, browser, width, "BBE-N01/N02/N04", async ({ reader, observations, fresh }) => {
    await signIn(page, FIXTURE_USERS.pro.email, artifactHref(A)); await editor(page, TITLE);
    const before = await inventory(reader), original = await saved(reader, A), observer = await observe(page);
    try {
      await page.getByLabel("Title", { exact: true }).fill(EDITED); await page.getByLabel(/^Team note/).fill(NOTE);
      await expect(page.getByRole("button", { name: "Download PDF", exact: true })).toBeDisabled();
      await page.getByRole("button", { name: "Save brief", exact: true }).click();
      await expect(page.getByRole("status")).toHaveText(SAVED);
      await expect.poll(() => observer.rows.length).toBe(1); await observer.finish(observer.rows[0]);
      expect(new URL(page.url()).searchParams.get("report_id")).toBe(A);
      expect([...new URL(page.url()).searchParams.keys()]).toEqual(["report_id"]);
      assertEdited(await saved(reader, A), original);
      expect(await inventory(reader)).toEqual({ ...before, reports: before.reports.map(r => r.id === A ? editedRow(r) : r) });
      await editor(page, EDITED); await shot(page, `saved-existing-board-${width}`); observations.N01_completed = true;
      const [download, response] = await Promise.all([
        page.waitForEvent("download"), page.waitForResponse(r => new URL(r.url()).pathname === "/api/pro/report-pdf" && r.request().method() === "POST"),
        page.getByRole("button", { name: "Download PDF", exact: true }).click(),
      ]);
      expect(response.status()).toBe(200); expect(response.headers()["content-type"]).toContain("application/pdf");
      const pdfPath = test.info().outputPath(`existing-board-brief-${width}.pdf`); await download.saveAs(pdfPath); expect(await download.failure()).toBeNull();
      const bytes = readFileSync(pdfPath); expect(bytes.subarray(0, 5).toString()).toBe("%PDF-"); expect(bytes.length).toBeGreaterThan(500); expect(bytes.length).toBeLessThan(5_000_000);
      const text = (await extractText(new Uint8Array(bytes), { mergePages: true })).text.replace(/\s+/g, " ");
      for (const literal of [EDITED, NOTE, HOME.name, "$35", "$30", "$5", DATE, SOURCE, LIMIT]) expect(text).toContain(literal);
      // Bind the independently frozen figures to their labels, not just a bag of numbers.
      // PdfExhibit emits saved rows/cells in order; extraction whitespace is normalized above.
      expect(text).toContain("Lakeshore Test Credit Union: saved wire fee $35; original peer median $30; difference $5.");
      expect(text).toMatch(/Saved wire fee\s+\$35\s+Synthetic stored schedule,\s+2026-06-30/);
      expect(text).toMatch(/Original peer median\s+\$30\s+Original synthetic cohort/);
      expect(text).toMatch(/Difference\s+\$5\s+Saved wire fee minus original peer median/);
      expect(text).toContain("Reporting date 2026-06-30; not refreshed");
      expect(text).toMatch(/Synthetic stored schedule\s+·\s+Original saved schedule; reporting date 2026-06-30\s+https:\/\/fixture\.test\/9701001\/saved-wire\.pdf/);
      expect(text).toContain("Synthetic stored snapshot; no current schedule recheck.");
      expect(text).not.toContain(OTHER_TITLE); expect(text).not.toContain("Indian River Test CU");
      await test.info().attach(`existing-board-brief-${width}`, { path: pdfPath, contentType: "application/pdf" });
      observations.pdf = { sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length, literalParity: true };
      const updated = await inventory(reader); expect(updated).toEqual({ ...before, reports: before.reports.map(r => r.id === A ? editedRow(r) : r) });
      observations.N02_completed = true;
      await fresh(`board-fresh-owner-${width}`, async target => {
        await signIn(target, FIXTURE_USERS.pro.email, "/pro/reports?instId=9701002");
        await expect(target.getByRole("region", { name: "Institution context" })).toContainText("Researching: Indian River Test CU");
        const open = target.getByRole("link", { name: `Open ${EDITED}`, exact: true });
        expect(new URL((await open.getAttribute("href"))!, String(test.info().project.use.baseURL)).searchParams.get("report_id")).toBe(A);
        await open.click(); await editor(target, EDITED); await expect(target.getByLabel(/^Team note/)).toHaveValue(NOTE);
        expect(new URL(target.url()).searchParams.get("report_id")).toBe(A);
        await expect(target.getByRole("region", { name: "Institution context" })).toContainText(`Researching: ${HOME.name}`);
        await expect(target.getByText(report(true).answer!.headline, { exact: true })).toBeVisible();
        await rendered(target); assertEdited(await saved(reader, A), original); expect(await inventory(reader)).toEqual(updated);
        await shot(target, `existing-board-fresh-owner-${width}`); observations.freshOwner_completed = true;
      });
      await fresh(`board-other-owner-denial-${width}`, async target => {
        await signIn(target, FIXTURE_USERS.proNoHome.email, artifactHref(A));
        await expect(target.locator("#hamilton-content p[role=alert]").filter({ hasText: /^Saved report not found or unavailable\.$/ })).toHaveText("Saved report not found or unavailable.");
        await expect(target.getByRole("button", { name: "Save brief", exact: true })).toHaveCount(0);
        await expect(target.getByRole("button", { name: "Download PDF", exact: true })).toHaveCount(0);
        await expect(target.getByText(EDITED, { exact: true })).toHaveCount(0);
        expect(await inventory(reader)).toEqual(updated); await shot(target, `existing-board-other-owner-${width}`); observations.otherOwnerDenied_completed = true;
      });
      observations.N04_completed = true;
    } finally { observations.actions = observer.receipt(); observations.observerCleanupFailed = !(await observer.close()); }
  }));

  test(`BBE-N03 at ${width}: actual Reports navigation wins over a held save ACK`, async ({ page, browser }) => runCase(page, browser, width, "BBE-N03", async ({ db, reader, observations }) => {
    await signIn(page, FIXTURE_USERS.pro.email, artifactHref(A)); await editor(page, TITLE);
    const before = await inventory(reader), original = await saved(reader, A), observer = await observe(page), document = await observer.document();
    let downloads = 0; const onDownload = () => { downloads++; }; page.on("download", onDownload);
    observations.outcome = "UNKNOWN_UNTIL_REAL_B_NAVIGATION_AND_OLD_ACK_EOF";
    try {
      await withGate(db, reader, async (release, blockerPid) => {
        await page.getByLabel("Title", { exact: true }).fill(EDITED); await page.getByLabel(/^Team note/).fill(NOTE);
        await page.getByRole("button", { name: "Save brief", exact: true }).click();
        const waiters = () => reader<{ pid: number; metadataUpdate: boolean; active: boolean }[]>`
          SELECT pid, query LIKE '%UPDATE hamilton_reports%' AS "metadataUpdate", state = 'active' AS active
          FROM pg_stat_activity WHERE datname = current_database() AND ${blockerPid} = ANY(pg_blocking_pids(pid))`;
        await expect.poll(async () => (await waiters()).length).toBe(1); const [waiter] = await waiters(); expect(waiter.active && waiter.metadataUpdate).toBe(true);
        await expect.poll(() => observer.rows.length).toBe(1); const held = observer.rows[0]; expect(held.terminal).toBeNull();
        expect(held.frame).toBe(document.frame); expect(held.loader).toBe(document.loader);
        expect(await observer.document()).toEqual(document); expect(await saved(reader, A)).toEqual(original);
        await expect(page.getByRole("button", { name: "Saving…", exact: true })).toBeDisabled();
        if (width === 390) await page.getByRole("button", { name: "Open navigation", exact: true }).click();
        await page.getByRole("navigation", { name: "Hamilton workspace" }).getByRole("link", { name: "Reports", exact: true }).click();
        const openB = page.getByRole("link", { name: `Open ${OTHER_TITLE}`, exact: true }); await expect(openB).toBeVisible(); await openB.click();
        await editor(page, OTHER_TITLE); expect(new URL(page.url()).searchParams.get("report_id")).toBe(B);
        expect(await observer.document()).toEqual(document); expect(held.terminal).toBeNull();
        await shot(page, `board-B-before-release-${width}`); observations.B_beforeRelease = true;
        await release(); await observer.finish(held);
        await expect.poll(async () => (await waiters()).length).toBe(0); assertEdited(await saved(reader, A), original);
        observations.postTerminalObservation = await rendered(page); expect(await observer.document()).toEqual(document);
        await editor(page, OTHER_TITLE); await expect(page.getByLabel(/^Team note/)).toHaveValue("");
        expect(new URL(page.url()).searchParams.get("report_id")).toBe(B); expect([...new URL(page.url()).searchParams.keys()]).toEqual(["report_id"]);
        await expect(page.getByRole("status")).toHaveText(SAVED); await expect(page.locator("#hamilton-content").getByRole("alert")).toHaveCount(0); expect(downloads).toBe(0);
        expect(await inventory(reader)).toEqual({ ...before, reports: before.reports.map(r => r.id === A ? editedRow(r) : r) });
        await observer.settled(); await shot(page, `board-B-after-old-ACK-${width}`);
        observations.outcome = "BOUNDED_STALE_SAVE_ACK_SUPPRESSED_AFTER_NATIVE_EOF"; observations.N03_completed = true;
      });
    } finally { page.off("download", onDownload); observations.actions = observer.receipt(); observations.observerCleanupFailed = !(await observer.close()); }
  }));
}
