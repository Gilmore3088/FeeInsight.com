/** Test-side witnesses only. No application hooks, network interception or retained response bodies. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { Page, TestInfo, CDPSession } from "playwright/test";
import { createBrowserActionsCapture, attachBrowserActionsObserver } from "../../../src/lib/engineering-verification/browser-actions.mjs";
import type { BrowserActionsCapture } from "../../../src/lib/engineering-verification/browser-actions.mjs";
import { connectFixtureDb, FIXTURE_USERS, HOME, type FixtureDb } from "./fixtures";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROUTES = ["/login", "/pro/analyze", "/pro/reports", "/pro/peer-research/[id]", "/api/hamilton/ask"];
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export type SavedPeerRow = {
  id: string;
  user_id: string;
  institution_id: string;
  status: string;
  response_json: { peerListSnapshot?: unknown; identityContext?: unknown };
};

function candidateIdentity(): Record<string, unknown> {
  try {
    const build = JSON.parse(readFileSync("test-results/engineering-verification/browser/build.json", "utf8"));
    const headSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const treeSha = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim();
    return { ...build, buildHeadSha: build.headSha, headSha, treeSha,
      clean: headSha === build.headSha && treeSha === build.treeSha
        && !execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], { encoding: "utf8" }).trim()
        && readFileSync(".next/BUILD_ID", "utf8").trim() === build.buildId };
  } catch { return { clean: false }; }
}

/**
 * The caller performs real UI controls and independently asserts the saved snapshot and reopened page.
 * The SQL reader has a fixed table and fixture owner; it cannot be pointed at a production database.
 * Only generated references, protocol metadata and a semantic digest leave this function.
 */
export async function withPeerResearchActionEvidence(
  page: Page,
  info: TestInfo,
  action: () => Promise<{ apiArtifactId: string; uiArtifactId: string }>,
  assertSaved: (row: SavedPeerRow) => Promise<void>,
  reopen: (artifactId: string) => Promise<{ freshContext: boolean; authenticatedActorMatches: boolean; artifactSubjectMatches: boolean; shellSubjectMatches: boolean; semanticMatches: boolean; wrongUserDenied: boolean }>,
): Promise<string> {
  const fixtureOrigin = new URL(String(info.project.use.baseURL)).origin;
  let session: CDPSession | undefined;
  let capture: ReturnType<typeof createBrowserActionsCapture> | undefined;
  let observer: Awaited<ReturnType<typeof attachBrowserActionsObserver>> | undefined;
  let db: FixtureDb | undefined;
  let receipt: BrowserActionsCapture | null = null;
  let resultId: string | null = null;
  let primaryError: unknown;
  let failed = false;
  let callbackPassed = false;
  let cleanupFailed = false;
  let attachmentFailed = false;
  try {
    session = await page.context().newCDPSession(page);
    const version = await session.send("Browser.getVersion");
    capture = createBrowserActionsCapture({ fixtureOrigin, routeTemplates: ROUTES, protocolVersion: version.protocolVersion });
    observer = await attachBrowserActionsObserver(session, capture, { sessionKey: session, contextKey: page.context() });
    db = connectFixtureDb();
    const [database] = await db<{ name: string; address: string }[]>`SELECT current_database() AS name, host(inet_server_addr()) AS address`;
    if (!/^engineering_browser_actions_[0-9]{8}$/.test(database.name) || !["127.0.0.1", "::1"].includes(database.address)) throw new Error("Action witnesses require the dedicated local fixture database");
    // An immutable peer snapshot is a new row. Preexisting IDs cannot supply this save's effect.
    const before = await db<{ id: string }[]>`
      SELECT id::text FROM hamilton_saved_analyses
       WHERE user_id = ${String(FIXTURE_USERS.pro.id)} AND institution_id = ${String(HOME.id)}
       ORDER BY id LIMIT 1001`;
    if (before.length > 1000) throw new Error("Fixture artifact inventory exceeded its bound");
    const beforeIds = new Set(before.map(row => row.id));
    const actionId = capture.beginAction({ operation: "save-peer-research", sessionKey: session,
      request: { method: "POST", routeTemplate: "/api/hamilton/ask", protocol: "json" }, effectKind: "peer-research" });
    const result = await action();
    if (!UUID.test(result.apiArtifactId) || result.apiArtifactId !== result.uiArtifactId) throw new Error("Native save response and UI artifact differ");
    capture.observeUiResult(actionId, { artifactId: result.uiArtifactId, success: true });
    const rows = await db<SavedPeerRow[]>`
      SELECT id::text, user_id, institution_id, status, response_json FROM hamilton_saved_analyses
       WHERE id = ${result.apiArtifactId}::uuid LIMIT 2`;
    if (rows.length !== 1) throw new Error("Saved peer snapshot has no unique persisted row");
    const saved = rows[0];
    await assertSaved(saved);
    capture.observePersistence(actionId, { artifactId: saved.id, beforeExists: beforeIds.has(saved.id), afterExists: true,
      ownerMatches: saved.user_id === String(FIXTURE_USERS.pro.id), institutionMatches: saved.institution_id === String(HOME.id),
      semanticMatches: true, semanticSha256: digest(saved.response_json) });
    const reopened = await reopen(saved.id);
    // Reopening and the denial control must not change the immutable saved snapshot.
    const afterReopen = await db<{ response_json: unknown }[]>`
      SELECT response_json FROM hamilton_saved_analyses
       WHERE id = ${saved.id}::uuid AND user_id = ${String(FIXTURE_USERS.pro.id)}
         AND institution_id = ${String(HOME.id)} AND status = 'active' LIMIT 1`;
    if (afterReopen.length !== 1 || digest(afterReopen[0].response_json) !== digest(saved.response_json)) throw new Error("Reopening changed the saved snapshot");
    capture.observeReopen(actionId, { artifactId: saved.id, ...reopened });
    callbackPassed = true;
    resultId = saved.id;
  } catch (error) {
    failed = true;
    primaryError = error;
  } finally {
    try { await observer?.stop(); } catch { cleanupFailed = true; }
    try { receipt = capture?.finish() ?? null; } catch { cleanupFailed = true; }
    try { await session?.detach(); } catch { cleanupFailed = true; }
    try { await db?.end(); } catch { cleanupFailed = true; }
    try {
      await info.attach("saved-peer-action-evidence", { contentType: "application/json", body: JSON.stringify({
        schemaVersion: 1, provenance: "LOCAL_BROWSER_ACTIONS_UNTRUSTED", identity: candidateIdentity(),
        callbackPassed, cleanupFailed, fixtureKind: "isolated-loopback-synthetic", capture: receipt,
        productionAcceptance: "NOT_ASSESSED", trustedWorkflowProvenance: "NOT_ESTABLISHED",
      }, null, 2) });
    } catch { attachmentFailed = true; }
  }
  if (failed) throw primaryError;
  if (!callbackPassed || cleanupFailed || attachmentFailed || candidateIdentity().clean !== true
    || !receipt?.complete || receipt.actions.length !== 1 || !receipt.actions[0].complete || !resultId) throw new Error("Saved peer action evidence is incomplete");
  return resultId;
}
