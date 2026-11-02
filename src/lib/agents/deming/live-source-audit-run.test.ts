// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const { claim, settle, storedText, storedReading, warning } = vi.hoisted(() => ({ claim: vi.fn(), settle: vi.fn(),
  storedText: vi.fn(async () => new Map<number, number>()),
  storedReading: vi.fn(async (..._args: unknown[]) => new Map<number, { text: string; url: string | null }>()),
  warning: vi.fn(async (_db: unknown, o: { error: unknown }) => (o.error instanceof Error ? o.error.message : String(o.error))) }));
vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));
vi.mock("@/lib/data-store/live-source-audit", () => ({ claimLiveAuditChunk: claim, settleLiveAuditChunk: settle, readStoredTextChars: storedText, readStoredTexts: storedReading }));
vi.mock("@/lib/agents/hamilton/step-warning", () => ({ recordStepWarning: warning }));
vi.mock("@/lib/data-store/live-source-capture", () => ({ requestLiveSourceCaptures: vi.fn(async () => []) }));
import { freezeLiveAuditFee, liveAuditPolicyFingerprint, makeLiveAuditDraw, LIVE_SOURCE_AUDIT as LIMITS, type LiveAuditCatalogRow, type LiveAuditFee, type LiveAuditObservation, type LiveAuditGraph, type LiveAuditPolicy } from "./live-source-audit";
import { liveAuditChunkSummary, runLiveAuditChunk, sameBytesUnjudged, unsupportedSameBytes } from "./live-source-audit-run";
import { LiveAuditSqlBudgetError } from "@/lib/data-store/live-source-sql";
import { requestLiveSourceCaptures } from "@/lib/data-store/live-source-capture";

const at = new Date().toISOString();
function draw(n: number) {
  const rows = Array.from({ length: n }, (_, i) => {
    const id = i + 1;
    return freezeLiveAuditFee({ id, fee_published_id: id, fee_verified_id: id, fee_raw_id: id, institution_id: id, source_document_id: id,
      canonical_fee_key: "overdraft", fee_name: "Overdraft Fee", amount: 35, amount_kind: "flat", account_product_type: null, frequency: "per_item",
      conditions: null, waiver_text: null, rate_basis: null, fee_audience: "consumer" } as LiveAuditCatalogRow,
    { id, institutionId: id, url: `https://institution${id}.invalid/fees`, contentHash: "a".repeat(64), r2Key: null, status: "success", supersededById: null }, null);
  });
  const groups = rows.map((fee) => {
    const policy: LiveAuditPolicy = { institutionId: fee.institutionId, websiteUrl: `https://institution${fee.id}.invalid/`, feeScheduleUrl: fee.source.url,
      canonicalSourceUrl: fee.source.url, sourceKind: "pdf", readStrategy: "pdf_text", correctionVersion: 0, lockedByCorrection: false,
      lastSourceHash: fee.source.contentHash, lastSuccessfulSourceDocumentId: fee.source.id, doNotRetry: [], rejectedSourceUrls: [] };
    return { institutionId: fee.institutionId, policy, policyFingerprint: liveAuditPolicyFingerprint(policy), feeIds: [fee.id], sources: [fee.source] };
  });
  return makeLiveAuditDraw({ day: at.slice(0, 10), asOf: at, seed: "a".repeat(64), populationIds: rows.map((f) => f.id), rows, groups });
}
const emptyGraph = (): LiveAuditGraph => ({ entryUrl: null, pages: [], candidateUrls: [], complete: false, reason: "official_homepage_unavailable" });

describe("live-source chunk budget (#2061)", () => {
  beforeEach(() => {
    claim.mockReset(); settle.mockReset();
    settle.mockImplementation(async () => 99);
  });

  it("fits its own work and receipt phase inside the step price the tick checks", () => {
    expect(LIMITS.workMs + LIMITS.settleMs).toBeLessThanOrEqual(LIMITS.stepMs);
    expect(LIMITS.groupStartMs).toBeLessThan(LIMITS.workMs);
    expect(LIMITS.leaseMs).toBeGreaterThanOrEqual(LIMITS.workMs + LIMITS.settleMs);
  });

  it("starts no institution after the start cutoff, leaving the rest unattempted rather than unknown", async () => {
    const d = draw(LIMITS.groupsPerChunk);
    claim.mockResolvedValue({ origin: { id: 1, detail: d, valid: true, createdAt: at },
      claim: { protocol: 1, series: d.series, drawId: 1, fromGroup: 0, throughGroup: d.groups.length, ownerRunId: 1, ownerStepId: 1, leaseUntil: at, eventId: 5 }, graphBytes: 0 });
    let clock = 0;
    const observed: number[] = [];
    // Each finished observation moves the shared injected clock 5 s; once it reaches the 40 s
    // cutoff no worker starts another institution, though all twelve were claimed.
    const result = await runLiveAuditChunk({ db: vi.fn() as never, context: { runId: 1, stepId: 1, stepKey: "deming-live-source-audit" }, drawId: 1,
      now: () => clock,
      observe: async (group) => { observed.push(group.institutionId); await Promise.resolve(); clock += 5_000; return emptyGraph(); } });
    expect(result).toMatchObject({ claimed: true, persisted: true });
    expect(result.groups).toBe(observed.length);
    expect(observed.length).toBeLessThan(LIMITS.groupsPerChunk);
    const call = settle.mock.calls[0][0];
    expect(call.nextGroup).toBe(observed.length);
    expect(call.observations).toHaveLength(observed.length);
  });

  it("reads a whole chunk when groups are quick", async () => {
    const d = draw(LIMITS.groupsPerChunk);
    claim.mockResolvedValue({ origin: { id: 1, detail: d, valid: true, createdAt: at },
      claim: { protocol: 1, series: d.series, drawId: 1, fromGroup: 0, throughGroup: d.groups.length, ownerRunId: 1, ownerStepId: 1, leaseUntil: at, eventId: 5 }, graphBytes: 0 });
    const result = await runLiveAuditChunk({ db: vi.fn() as never, context: { runId: 1, stepId: 1, stepKey: "deming-live-source-audit" }, drawId: 1,
      now: () => 0, observe: async () => emptyGraph() });
    expect(result.groups).toBe(LIMITS.groupsPerChunk);
    expect(settle.mock.calls[0][0].nextGroup).toBe(LIMITS.groupsPerChunk);
  });

  it("does not record a bank cut off by the work budget; the next chunk reads it again", async () => {
    const d = draw(3);
    claim.mockResolvedValue({ origin: { id: 1, detail: d, valid: true, createdAt: at },
      claim: { protocol: 1, series: d.series, drawId: 1, fromGroup: 0, throughGroup: 3, ownerRunId: 1, ownerStepId: 1, leaseUntil: at, eventId: 5 }, graphBytes: 0 });
    // In draw order: group 0 is quick, group 1 is still loading when the budget runs out, group 2 is quick.
    const slow = (signal: AbortSignal) => new Promise<LiveAuditGraph>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    const result = await runLiveAuditChunk({ db: vi.fn() as never, context: { runId: 1, stepId: 1, stepKey: "deming-live-source-audit" }, drawId: 1,
      now: () => 0, workMs: 30, observe: async (group, { signal }) => group.institutionId === d.groups[1].institutionId ? slow(signal) : emptyGraph() });
    expect(result.groups).toBe(1);
    const call = settle.mock.calls[0][0];
    expect(call.nextGroup).toBe(1);
    expect(call.observations.map((o: { feeId: number }) => o.feeId)).toEqual(d.groups[0].feeIds);
  });

  it("records the chunk's first bank as unknown when even it is cut, so the draw always advances", async () => {
    const d = draw(2);
    claim.mockResolvedValue({ origin: { id: 1, detail: d, valid: true, createdAt: at },
      claim: { protocol: 1, series: d.series, drawId: 1, fromGroup: 0, throughGroup: 2, ownerRunId: 1, ownerStepId: 1, leaseUntil: at, eventId: 5 }, graphBytes: 0 });
    const result = await runLiveAuditChunk({ db: vi.fn() as never, context: { runId: 1, stepId: 1, stepKey: "deming-live-source-audit" }, drawId: 1,
      now: () => 0, workMs: 30, observe: (_group, { signal }) => new Promise<LiveAuditGraph>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })) });
    expect(result.groups).toBe(1);
    const call = settle.mock.calls[0][0];
    expect(call.nextGroup).toBe(1);
    expect(call.observations).toMatchObject([{ feeId: d.groups[0].feeIds[0], status: "unknown", reason: "live_observation_failed" }]);
  });
});

describe("live-source chunk verdicts and save (2026-11-02)", () => {
  const ctx = { runId: 1, stepId: 1, stepKey: "deming-live-source-audit" };
  const page = (url: string, text: string): LiveAuditGraph => ({ entryUrl: url, complete: true, reason: null, candidateUrls: [url], failed: [], pages: [{
    requestedUrl: url, finalUrl: url, contentHash: "b".repeat(64), textHash: "c".repeat(64), checkedAt: new Date().toISOString(), contentType: "text/plain",
    etag: null, lastModified: null, status: 200, effectiveDate: null, text, links: [] }] });
  beforeEach(() => { claim.mockReset(); settle.mockReset(); settle.mockImplementation(async () => 99); vi.mocked(requestLiveSourceCaptures).mockReset(); vi.mocked(requestLiveSourceCaptures).mockResolvedValue([]); });
  const lease = (d: ReturnType<typeof draw>) => claim.mockResolvedValue({ origin: { id: 1, detail: d, valid: true, createdAt: at },
    claim: { protocol: 1, series: d.series, drawId: 1, fromGroup: 0, throughGroup: d.groups.length, ownerRunId: 1, ownerStepId: 1, leaseUntil: at, eventId: 5 }, graphBytes: 0 });

  it("fetches each fee's own address and scores every page that loads", async () => {
    const d = draw(3); lease(d);
    const urls: string[][] = [];
    // The third page is a real page without the fee (long enough not to read as a script shell).
    const terms = Array.from({ length: 6 }, (_, i) => `Section ${i + 1}. Terms and disclosures for personal deposit accounts.`).join("\n");
    const texts = ["Overdraft Fee $35.00 per item", "Overdraft Fee $40.00 per item", `Stop Payment $30.00 per item\n${terms}`];
    const result = await runLiveAuditChunk({ db: vi.fn() as never, context: ctx, drawId: 1, now: () => 0,
      observe: async (group, options) => { urls.push(options.urls ?? []); const i = d.groups.indexOf(group); return page(options.urls![0], texts[i]); } });
    expect(urls).toEqual(d.groups.map((g) => [d.rows.find((r) => r.id === g.feeIds[0])!.source.url]));
    expect(result.verdicts).toEqual({ supported: 1, mismatch: 1, not_found: 1, unknown: 0 });
    expect(settle.mock.calls[0][0].observations.map((o: { status: string }) => o.status)).toEqual(["supported", "mismatch", "not_found"]);
  });

  it("asks for captures after the save, in their own transaction, with the draw it already holds", async () => {
    const d = draw(1); lease(d);
    vi.mocked(requestLiveSourceCaptures).mockResolvedValue([77]);
    const result = await runLiveAuditChunk({ db: vi.fn() as never, context: ctx, drawId: 1, now: () => 0, observe: async (_g, o) => page(o.urls![0], "Overdraft Fee $40.00 per item") });
    expect(settle.mock.calls[0][0].afterInsert).toBeUndefined();
    expect(vi.mocked(requestLiveSourceCaptures).mock.calls[0][3]).toMatchObject({ origin: { id: 1 } });
    expect(result).toMatchObject({ persisted: true, captureRequestIds: [77] });
  });

  it("keeps a saved chunk when the capture admission runs out of its budget", async () => {
    const d = draw(1); lease(d);
    vi.mocked(requestLiveSourceCaptures).mockRejectedValue(new LiveAuditSqlBudgetError());
    const result = await runLiveAuditChunk({ db: vi.fn() as never, context: ctx, drawId: 1, now: () => 0, observe: async (_g, o) => page(o.urls![0], "Overdraft Fee $35.00 per item") });
    expect(result).toMatchObject({ persisted: true, captureRequestIds: [], captureReason: expect.stringContaining("live_audit_sql_budget_exhausted") });
  });

  it("keeps a saved chunk and names the error when capture admission hits a statement timeout", async () => {
    // A statement timeout arrives as a plain PostgresError, not the budget error (found on a real DB).
    const d = draw(1); lease(d);
    vi.mocked(requestLiveSourceCaptures).mockRejectedValue(new Error("canceling statement due to statement timeout"));
    const result = await runLiveAuditChunk({ db: vi.fn() as never, context: ctx, drawId: 1, now: () => 0, observe: async (_g, o) => page(o.urls![0], "Overdraft Fee $40.00 per item") });
    expect(result).toMatchObject({ persisted: true, captureRequestIds: [], captureOutcome: "failed", captureReason: "canceling statement due to statement timeout" });
  });

  it("records a failed capture admission as a step warning and never reports a request count for it", async () => {
    for (const [error, outcome] of [[new LiveAuditSqlBudgetError("unknown"), "unknown"], [new LiveAuditSqlBudgetError(), "failed"]] as const) {
      warning.mockClear(); const d = draw(1); lease(d);
      vi.mocked(requestLiveSourceCaptures).mockRejectedValue(error);
      const result = await runLiveAuditChunk({ db: vi.fn() as never, context: ctx, drawId: 1, now: () => 0, observe: async (_g, o) => page(o.urls![0], "Overdraft Fee $40.00 per item") });
      expect(result).toMatchObject({ persisted: true, captureOutcome: outcome, captureReason: error.message.slice(0, 200) });
      expect(warning).toHaveBeenCalledTimes(1);
      expect(warning.mock.calls[0][1]).toMatchObject({ runId: ctx.runId, stepId: ctx.stepId, check: "live-source-audit", what: `Live-source chunk capture admission ${outcome}`, error });
      // After an unknown COMMIT some requests may exist: the receipt names the outcome, not "0 requests".
      const summary = liveAuditChunkSummary(result);
      expect(summary).toContain(`capture admission ${outcome}: ${error.message}`);
      expect(summary).not.toMatch(/exact-document capture requests/);
    }
    expect(liveAuditChunkSummary({ claimed: true, persisted: true, groups: 1, reason: null, captureRequestIds: [7, 8], captureOutcome: null }))
      .toContain("2 exact-document capture requests");
  });

  it("records an unreadable stored text length as a step warning and still scores with the floor alone", async () => {
    warning.mockClear(); const d = draw(1); lease(d);
    storedText.mockRejectedValueOnce(new Error("relation \"agent_source_texts\" does not exist"));
    const result = await runLiveAuditChunk({ db: vi.fn() as never, context: ctx, drawId: 1, now: () => 0, observe: async (_g, o) => page(o.urls![0], "Overdraft Fee $35.00 per item") });
    expect(result).toMatchObject({ persisted: true, verdicts: { supported: 1 }, storedTextReason: 'relation "agent_source_texts" does not exist' });
    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning.mock.calls[0][1]).toMatchObject({ runId: ctx.runId, stepId: ctx.stepId, what: expect.stringContaining("stored text lengths") });
    expect(liveAuditChunkSummary(result)).toContain("stored text lengths not read");
  });

  it("judges a same-bytes fee the plain reading lost on the stored reading of those bytes, and only that fee", async () => {
    const d = draw(2); lease(d); storedReading.mockClear();
    const terms = Array.from({ length: 6 }, (_, i) => `Section ${i + 1}. Terms and disclosures for personal deposit accounts.`).join("\n");
    const lost = `Overdraft\nStop Payment\n$35.00 per item\n$30.00 per item\n${terms}`;
    const reading = "Overdraft Fee | $35.00 per item\nStop Payment | $30.00 per item";
    storedReading.mockImplementation(async (_db, ids) => new Map(ids.map((id) => [id, { text: reading, url: `https://institution${id}.invalid/fees` }])));
    // Fee 1's page serves its stored copy's bytes; fee 2's page changed bytes.
    const result = await runLiveAuditChunk({ db: vi.fn() as never, context: ctx, drawId: 1, now: () => 0,
      observe: async (group, o) => { const g = page(o.urls![0], lost); if (group.institutionId === 1) g.pages[0].contentHash = "a".repeat(64); return g; } });
    expect(storedReading.mock.calls[0][1]).toEqual([1]);
    expect(result).toMatchObject({ verdicts: { supported: 1, not_found: 1 }, storedReadingSupported: [1], unsupportedSameBytes: [] });
    const saved = settle.mock.calls[0][0].observations as Array<{ feeId: number }>;
    expect(saved.find((o) => o.feeId === 1)).toMatchObject({ status: "supported", sourceLine: "Overdraft Fee | $35.00 per item" });
    expect(saved.find((o) => o.feeId === 2)).toMatchObject({ status: "not_found" });
  });

  it("never judges a fee on a stored reading taken from another page (a landing page whose text came from a linked PDF)", async () => {
    const d = draw(1); lease(d); storedReading.mockClear();
    const terms = Array.from({ length: 6 }, (_, i) => `Section ${i + 1}. Terms and disclosures for personal deposit accounts.`).join("\n");
    // Same landing-page bytes, but the stored reading was read from the PDF it links to, which the audit never fetched.
    storedReading.mockImplementation(async (_db, ids) => new Map(ids.map((id) => [id, { text: "Overdraft Fee | $35.00 per item", url: `https://institution${id}.invalid/2026-fee-schedule.pdf` }])));
    const result = await runLiveAuditChunk({ db: vi.fn() as never, context: ctx, drawId: 1, now: () => 0,
      observe: async (_g, o) => { const g = page(o.urls![0], `Overdraft\n${terms}`); g.pages[0].contentHash = "a".repeat(64); return g; } });
    expect(storedReading).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ verdicts: { not_found: 1 }, storedReadingSupported: [], unsupportedSameBytes: [1] });
  });

  it("caps the same-bytes re-judge by documents, not fees, and counts the fees left out", () => {
    const fees = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, source: { id: i < 5 ? 1 : i, contentHash: "h" } })) as never as LiveAuditFee[];
    const obs = fees.map((f) => ({ feeId: f.id, contentHash: "h", status: "not_found", reason: "x" })) as never as LiveAuditObservation[];
    const { fees: kept, dropped } = sameBytesUnjudged(obs, fees);
    expect(new Set(kept.map((f) => f.source.id)).size).toBe(24);
    expect(kept.length).toBe(28); expect(dropped).toBe(2);
  });

  it("keeps the live verdicts and warns when the stored readings cannot be read", async () => {
    warning.mockClear(); const d = draw(1); lease(d);
    const terms = Array.from({ length: 6 }, (_, i) => `Section ${i + 1}. Terms and disclosures for personal deposit accounts.`).join("\n");
    storedReading.mockRejectedValueOnce(new Error("statement timeout"));
    const result = await runLiveAuditChunk({ db: vi.fn() as never, context: ctx, drawId: 1, now: () => 0,
      observe: async (_g, o) => { const g = page(o.urls![0], `Stop Payment $30.00 per item\n${terms}`); g.pages[0].contentHash = "a".repeat(64); return g; } });
    expect(result).toMatchObject({ persisted: true, verdicts: { not_found: 1 }, storedReadingSupported: [], storedReadingReason: "statement timeout", unsupportedSameBytes: [1] });
  });

  it("names the unsupported fees a re-fetch cannot help (same bytes as the stored copy)", () => {
    const rows = [{ id: 1, source: { contentHash: "a".repeat(64) } }, { id: 2, source: { contentHash: "a".repeat(64) } }];
    const base = { fingerprint: "f".repeat(64), reason: "x", dimensions: [], observedAt: at, expiresAt: at, requestedUrl: null, finalUrl: null, textHash: null, sourceLine: null, graphHash: null };
    expect(unsupportedSameBytes([{ ...base, feeId: 1, status: "not_found", contentHash: "a".repeat(64) }, { ...base, feeId: 2, status: "not_found", contentHash: "b".repeat(64) },
      { ...base, feeId: 1, status: "supported", contentHash: "a".repeat(64) }], rows)).toEqual([1]);
  });
});
