// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const { claim, settle } = vi.hoisted(() => ({ claim: vi.fn(), settle: vi.fn() }));
vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));
vi.mock("@/lib/data-store/live-source-audit", () => ({ claimLiveAuditChunk: claim, settleLiveAuditChunk: settle }));
vi.mock("@/lib/data-store/live-source-capture", () => ({ requestLiveSourceCaptures: vi.fn(async () => []) }));
import { freezeLiveAuditFee, liveAuditPolicyFingerprint, makeLiveAuditDraw, LIVE_SOURCE_AUDIT as LIMITS, type LiveAuditCatalogRow, type LiveAuditGraph, type LiveAuditPolicy } from "./live-source-audit";
import { runLiveAuditChunk, unsupportedSameBytes } from "./live-source-audit-run";
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
    expect(result).toMatchObject({ persisted: true, captureRequestIds: [], captureReason: "canceling statement due to statement timeout" });
  });

  it("names the unsupported fees a re-fetch cannot help (same bytes as the stored copy)", () => {
    const rows = [{ id: 1, source: { contentHash: "a".repeat(64) } }, { id: 2, source: { contentHash: "a".repeat(64) } }];
    const base = { fingerprint: "f".repeat(64), reason: "x", dimensions: [], observedAt: at, expiresAt: at, requestedUrl: null, finalUrl: null, textHash: null, sourceLine: null, graphHash: null };
    expect(unsupportedSameBytes([{ ...base, feeId: 1, status: "not_found", contentHash: "a".repeat(64) }, { ...base, feeId: 2, status: "not_found", contentHash: "b".repeat(64) },
      { ...base, feeId: 1, status: "supported", contentHash: "a".repeat(64) }], rows)).toEqual([1]);
  });
});
