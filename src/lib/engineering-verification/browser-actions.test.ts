// @vitest-environment node
/** Independent frozen C/E/P cases. Synthetic protocol/witness inputs remain local and untrusted. */
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { attachBrowserActionsObserver, createBrowserActionsCapture } from "./browser-actions.mjs";
import type { BrowserActionSpec } from "./browser-actions.mjs";

const ORIGIN = "http://127.0.0.1:3197";
const PRIVATE = "PRIVATE_ACTION_CANARY_73f4";
const SESSION = `session-${PRIVATE}`;
const FRAME = `frame-${PRIVATE}`;
const DOCUMENT = `loader-${PRIVATE}`;
const ARTIFACT = `artifact-native-${PRIVATE}`;
const ROUTES = ["/pro/analyze", "/pro/reports", "/api/hamilton/ask", "/api/pro/report-pdf", "/pro/peer-research/[id]"];
type Operation = Omit<BrowserActionSpec, "sessionKey">;
const PEER: Operation = { operation: "save-peer-research", request: { method: "POST", routeTemplate: "/api/hamilton/ask", protocol: "json" }, effectKind: "peer-research" };
const ANALYSIS: Operation = { operation: "save-analysis", request: { method: "POST", routeTemplate: "/api/hamilton/ask", protocol: "json" }, effectKind: "analysis" };
const BOARD: Operation = { operation: "save-board-brief", request: { method: "POST", routeTemplate: "/pro/reports", protocol: "next-action" }, effectKind: "board-brief" };
type Capture = ReturnType<typeof createBrowserActionsCapture>;
type RequestOptions = { session?: string; frameId?: string; loaderId?: string; url?: string; method?: string; status?: number; mimeType?: string; headers?: Record<string, string>; [key: string]: unknown };

function capture(options: Record<string, unknown> = {}) {
  const value = createBrowserActionsCapture({ protocolVersion: "1.3", fixtureOrigin: ORIGIN, routeTemplates: ROUTES, ...options });
  value.registerSession(SESSION, { contextKey: `context-${PRIVATE}` });
  value.ingest(SESSION, "Page.frameNavigated", { frame: { id: FRAME, loaderId: DOCUMENT, url: ORIGIN + "/pro/analyze" }, type: "Navigation" });
  return value;
}
function begin(value: Capture, operation = PEER) {
  return value.beginAction({ ...operation, sessionKey: SESSION });
}
function request(value: Capture, id = "native-post-1", options: RequestOptions = {}) {
  const { session = SESSION, frameId = FRAME, loaderId = DOCUMENT, url = ORIGIN + "/api/hamilton/ask", method = "POST", headers = {}, ...rest } = options;
  value.ingest(session, "Network.requestWillBeSent", { requestId: id, frameId, loaderId, timestamp: 1, wallTime: 1, type: "Fetch", documentURL: ORIGIN + "/pro/analyze", request: { url, method, headers, postData: PRIVATE, postDataEntries: [{ bytes: PRIVATE }] }, ...rest });
}
function response(value: Capture, id = "native-post-1", options: RequestOptions = {}) {
  const { session = SESSION, frameId = FRAME, loaderId = DOCUMENT, url = ORIGIN + "/api/hamilton/ask", status = 200, mimeType = "application/json", headers = {}, ...rest } = options;
  value.ingest(session, "Network.responseReceived", { requestId: id, frameId, loaderId, timestamp: 1, type: "Fetch", response: { url, status, mimeType, headers }, ...rest });
}
function eof(value: Capture, id = "native-post-1", session = SESSION) {
  value.ingest(session, "Network.loadingFinished", { requestId: id, timestamp: 1, encodedDataLength: 42 });
}
function transport(value: Capture, id = "native-post-1", options: RequestOptions = {}) {
  request(value, id, options); response(value, id, options); eof(value, id, (options.session as string | undefined) ?? SESSION);
}
function ui(value: Capture, actionId: string | null, artifactId = ARTIFACT) {
  value.observeUiResult(actionId, { artifactId, success: true });
}
function persistence(value: Capture, actionId: string | null, overrides: Record<string, unknown> = {}) {
  value.observePersistence(actionId, { artifactId: ARTIFACT, beforeExists: false, afterExists: true, ownerMatches: true, institutionMatches: true, semanticMatches: true, ...overrides });
}
function reopen(value: Capture, actionId: string | null, overrides: Record<string, unknown> = {}) {
  value.observeReopen(actionId, { artifactId: ARTIFACT, authenticatedActorMatches: true, artifactSubjectMatches: true, shellSubjectMatches: true, semanticMatches: true, freshContext: true, wrongUserDenied: true, ...overrides });
}
function finished(operation = PEER) {
  const value = capture(), id = begin(value, operation);
  const native = operation === BOARD ? { url: ORIGIN + "/pro/reports", mimeType: "text/x-component", headers: { "Next-Action": PRIVATE } } : {};
  transport(value, "native-post-1", native); ui(value, id); persistence(value, id); reopen(value, id);
  return { value, id };
}
function action(value: Capture) {
  const result = value.finish();
  expect(result.actions).toHaveLength(1);
  return { result, row: result.actions[0] };
}

describe("bounded action witnesses preserve local authority", () => {
  it.each([PEER, ANALYSIS, BOARD])("observes a complete exact fresh-artifact local action (%s)", (operation) => {
    const { value, id } = finished(operation);
    expect(id).not.toBeNull();
    const { result, row } = action(value);
    expect(result).toMatchObject({ authority: "LOCAL_UNTRUSTED", status: "LOCAL_ACTIONS_UNTRUSTED", complete: true, closed: true, truncated: false });
    expect(row).toMatchObject({ operation: operation.operation, effectKind: operation.effectKind, association: "exactly_one", transport: "finished", actionSettlement: "observed", persistedEffect: "observed", reopen: "observed", complete: true });
    expect(result.protocol).toMatchObject({ status: "LOCAL_PROTOCOL_UNTRUSTED", completenessScope: "registered_cdp_sessions", unobservedTargets: "unknown" });
    expect(JSON.stringify(result)).not.toContain("CODE_VERIFIED");
    expect(JSON.stringify(result)).not.toContain(PRIVATE);
  });

  it("keeps native protocol action/effect unknown even when the separate local action layer has evidence", () => {
    const { value } = finished(); const { result } = action(value);
    expect(result.protocol.requests[0]).toMatchObject({ transport: "finished", actionSettlement: "unknown", effect: "unknown" });
  });

  it("uses the same generated artifact reference in UI, persistence, reopen and summary", () => {
    const { value } = finished(); const { result, row } = action(value);
    const refs = result.events.filter(event => event.actionId === row.actionId && event.artifactRef !== undefined).map(event => event.artifactRef);
    expect(refs).toHaveLength(3);
    expect(refs).toEqual([row.artifactRef, row.artifactRef, row.artifactRef]);
  });

  it("does not accept an older request that started before beginAction", () => {
    const value = capture(); transport(value); const id = begin(value); ui(value, id); persistence(value, id); reopen(value, id);
    const { result, row } = action(value);
    expect(result.status).toBe("BLOCKED"); expect(row.actionSettlement).toBe("unknown");
  });

  it("does not borrow another same-URL POST's EOF", () => {
    const value = capture(), id = begin(value); request(value, "native-a"); request(value, "native-b"); response(value, "native-b"); eof(value, "native-b"); ui(value, id); persistence(value, id); reopen(value, id);
    const { result, row } = action(value);
    expect(result.status).toBe("BLOCKED"); expect(row.association).toBe("unknown"); expect(row.actionSettlement).toBe("unknown");
  });

  it("does not borrow a same-URL POST from another native session", () => {
    const value = capture(), id = begin(value), other = "another-native-session";
    value.registerSession(other, { contextKey: "another-context" });
    value.ingest(other, "Page.frameNavigated", { frame: { id: FRAME, loaderId: DOCUMENT, url: ORIGIN + "/pro/analyze" }, type: "Navigation" });
    transport(value, "native-post-1", { session: other }); ui(value, id); persistence(value, id); reopen(value, id);
    const { result, row } = action(value);
    expect(result.status).toBe("BLOCKED"); expect(row.actionSettlement).toBe("unknown");
  });

  it("does not infer request completion from response200 and a UI result", () => {
    const value = capture(), id = begin(value); request(value); response(value); ui(value, id); persistence(value, id); reopen(value, id);
    const { result, row } = action(value);
    expect(result.status).toBe("BLOCKED"); expect(row).toMatchObject({ transport: "unknown", actionSettlement: "unknown" });
  });

  it("does not infer application settlement from EOF without its source-known UI result", () => {
    const value = capture(); begin(value); transport(value);
    const { result, row } = action(value);
    expect(result.status).toBe("BLOCKED"); expect(row.actionSettlement).toBe("unknown");
  });

  it("preserves canceled POST transport even with an independently observed persisted effect", () => {
    const value = capture(), id = begin(value); request(value); response(value);
    value.ingest(SESSION, "Network.loadingFailed", { requestId: "native-post-1", type: "Fetch", timestamp: 1, canceled: true, errorText: "net::ERR_ABORTED" });
    ui(value, id); persistence(value, id); reopen(value, id);
    const { result, row } = action(value);
    expect(result.status).toBe("BLOCKED"); expect(row).toMatchObject({ transport: "canceled", actionSettlement: "unknown", persistedEffect: "observed", complete: false });
    expect(result.protocol.requests[0]).toMatchObject({ transport: "canceled", actionSettlement: "unknown", effect: "unknown" });
  });

  it.each(["same_document", "document"])("does not use later %s navigation to settle a canceled POST", (kind) => {
    const value = capture(), id = begin(value); request(value); response(value);
    value.ingest(SESSION, "Network.loadingFailed", { requestId: "native-post-1", type: "Fetch", timestamp: 1, canceled: true, errorText: "net::ERR_ABORTED" });
    if (kind === "same_document") value.ingest(SESSION, "Page.navigatedWithinDocument", { frameId: FRAME, url: ORIGIN + "/pro/reports", navigationType: "historyApi" });
    else value.ingest(SESSION, "Page.frameNavigated", { frame: { id: FRAME, loaderId: "next-document", url: ORIGIN + "/pro/reports" }, type: "Navigation" });
    ui(value, id); persistence(value, id); reopen(value, id);
    const { result, row } = action(value);
    expect(result.status).toBe("BLOCKED"); expect(row.actionSettlement).toBe("unknown");
  });

  it.each([{ status: 409 }, { mimeType: "text/html" }, { url: "https://remote.invalid/api/hamilton/ask" }])("blocks wrong native response semantics %j", (options) => {
    const value = capture(), id = begin(value); request(value); response(value, "native-post-1", options); eof(value); ui(value, id); persistence(value, id); reopen(value, id);
    const { result, row } = action(value);
    expect(result.status).toBe("BLOCKED"); expect(row.actionSettlement).toBe("unknown");
  });

  it("rejects overlapping/nested action windows rather than assigning a common POST", () => {
    const value = capture(); begin(value); begin(value); transport(value);
    expect(value.finish().status).toBe("BLOCKED");
  });
});

describe("effect and reopen comparisons cannot be borrowed", () => {
  it.each(["afterExists", "ownerMatches", "institutionMatches", "semanticMatches"])("blocks a negative native fixture comparison (%s)", (key) => {
    const value = capture(), id = begin(value); transport(value); ui(value, id); persistence(value, id, { [key]: false }); reopen(value, id);
    const { result, row } = action(value);
    expect(result.status).toBe("BLOCKED"); expect(row.persistedEffect).toBe("unknown");
  });

  it("cannot use a different native artifact ID even when its saved values look right", () => {
    const value = capture(), id = begin(value); transport(value); ui(value, id); persistence(value, id, { artifactId: "different-artifact" }); reopen(value, id);
    const { result, row } = action(value);
    expect(result.status).toBe("BLOCKED"); expect(row.persistedEffect).toBe("unknown");
  });

  it.each(["authenticatedActorMatches", "artifactSubjectMatches", "shellSubjectMatches", "semanticMatches", "freshContext", "wrongUserDenied"])("blocks incomplete fresh authorized reopen evidence (%s)", (key) => {
    const value = capture(), id = begin(value); transport(value); ui(value, id); persistence(value, id); reopen(value, id, { [key]: false });
    const { result, row } = action(value);
    expect(result.status).toBe("BLOCKED"); expect(row.reopen).toBe("unknown");
  });

  it("does not accept an unrelated reopened report with the same title/subject", () => {
    const value = capture(), id = begin(value); transport(value); ui(value, id); persistence(value, id); reopen(value, id, { artifactId: "other-report" });
    const { result, row } = action(value);
    expect(result.status).toBe("BLOCKED"); expect(row.reopen).toBe("unknown");
  });

  it("does not accept read-back before the actual action result boundary", () => {
    const value = capture(), id = begin(value); transport(value); persistence(value, id); ui(value, id); reopen(value, id);
    expect(value.finish().status).toBe("BLOCKED");
  });

  it("rejects duplicate UI, persistence or reopen records rather than overwriting evidence", () => {
    for (const duplicate of ["ui", "persistence", "reopen"]) {
      const { value, id } = finished();
      if (duplicate === "ui") ui(value, id); else if (duplicate === "persistence") persistence(value, id); else reopen(value, id);
      expect(value.finish().status).toBe("BLOCKED");
    }
  });

  it("does not import a generated action ID from an earlier capture", () => {
    const first = finished(); const earlierId = first.id; first.value.finish();
    const next = capture(); transport(next); ui(next, earlierId); persistence(next, earlierId); reopen(next, earlierId);
    expect(next.finish().status).toBe("BLOCKED");
  });
});

describe("bounded privacy and passive observer", () => {
  it("retains no raw header/body/native/action/artifact/URL/error canary or hash", () => {
    const value = capture(), id = begin(value);
    const url = ORIGIN + `/api/hamilton/ask?token=${PRIVATE}#${PRIVATE}`;
    request(value, PRIVATE, { url, headers: { Authorization: `Bearer ${PRIVATE}`, Cookie: PRIVATE, "Next-Action": PRIVATE } });
    response(value, PRIVATE, { url, headers: { "set-cookie": PRIVATE } }); eof(value, PRIVATE);
    ui(value, id); persistence(value, id); reopen(value, id);
    const { result } = action(value), text = JSON.stringify(result);
    expect(text).not.toContain(PRIVATE); expect(text).not.toContain(createHash("sha256").update(PRIVATE).digest("hex"));
  });

  it("rejects extra witness fields without retaining private payloads", () => {
    const value = capture(), id = begin(value); transport(value); ui(value, id);
    persistence(value, id, { rawQuery: PRIVATE, effectStatus: "VERIFIED" }); reopen(value, id);
    const { result, row } = action(value);
    expect(result.status).toBe("BLOCKED"); expect(row.persistedEffect).toBe("unknown"); expect(JSON.stringify(result)).not.toContain(PRIVATE);
  });

  it("blocks session loss, request overflow and unknown protocol instead of accepting the completed artifact", () => {
    for (const options of [{ protocolVersion: "unknown-version" }, { maxRequests: 1 }]) {
      const value = capture(options), id = begin(value); transport(value); request(value, "extra"); ui(value, id); persistence(value, id); reopen(value, id);
      expect(value.finish().status).toBe("BLOCKED");
    }
    const { value } = finished(); value.sessionLost(SESSION); expect(value.finish().status).toBe("BLOCKED");
  });

  it("honors the explicit action bound and never emits a passed empty inventory", () => {
    const value = capture({ maxActions: 1 }); const first = begin(value); expect(first).not.toBeNull();
    transport(value); ui(value, first); persistence(value, first); reopen(value, first);
    expect(begin(value)).toBeNull(); expect(value.finish().status).toBe("BLOCKED");
    expect(capture().finish().status).toBe("BLOCKED");
  });

  it("fails closed without throwing when capture configuration is malformed", () => {
    let value: Capture | undefined;
    expect(() => {
      value = capture({ routeTemplates: 42 });
      begin(value);
    }).not.toThrow();
    expect(value?.finish().status).toBe("BLOCKED");
  });

  it("does not associate a fixture POST with an action begun in a foreign main document", () => {
    const value = createBrowserActionsCapture({ protocolVersion: "1.3", fixtureOrigin: ORIGIN, routeTemplates: ROUTES });
    value.registerSession(SESSION, { contextKey: "foreign-document-context" });
    value.ingest(SESSION, "Page.frameNavigated", { frame: { id: FRAME, loaderId: DOCUMENT, url: "https://foreign.invalid/" }, type: "Navigation" });
    const id = begin(value);
    transport(value, "native-post-1", { documentURL: "https://foreign.invalid/" }); ui(value, id); persistence(value, id); reopen(value, id);
    const result = value.finish();
    expect(result.status).toBe("BLOCKED");
    expect(result.actions.every(row => row.actionSettlement === "unknown" && !row.complete)).toBe(true);
  });

  it.each([
    { ...PEER, operation: "write-anything" },
    { ...PEER, request: { ...PEER.request, method: "GET" } },
    { ...PEER, request: { ...PEER.request, routeTemplate: "/api/pro/report-pdf" } },
    { ...PEER, effectKind: "board-brief" },
  ])("does not broaden the fixed operation/route/protocol tuples (%j)", (spec) => {
    // Deliberately bypass the static finite union to exercise the untrusted runtime boundary.
    const value = capture(); expect(begin(value, spec as Operation)).toBeNull(); expect(value.finish().status).toBe("BLOCKED");
  });

  it("subscribes passively with only Network/Page enable and initial frame tree", async () => {
    const session = new EventEmitter() as EventEmitter & { send: (method: string) => Promise<unknown>; off: EventEmitter["off"] };
    const commands: string[] = [];
    session.send = async (method) => { commands.push(method); return method === "Page.getFrameTree" ? { frameTree: { frame: { id: FRAME, loaderId: DOCUMENT, url: ORIGIN + "/pro/analyze" } } } : {}; };
    const value = createBrowserActionsCapture({ protocolVersion: "1.3", fixtureOrigin: ORIGIN, routeTemplates: ROUTES });
    const attached = await attachBrowserActionsObserver(session, value, { sessionKey: SESSION, contextKey: "context" });
    expect(commands).toEqual(["Network.enable", "Page.enable", "Page.getFrameTree"]);
    await attached.stop();
    for (const name of ["Network.requestWillBeSent", "Network.responseReceived", "Network.loadingFinished", "Network.loadingFailed", "Page.frameNavigated", "Page.navigatedWithinDocument", "Page.frameDetached"]) expect(session.listenerCount(name)).toBe(0);
  });
});
