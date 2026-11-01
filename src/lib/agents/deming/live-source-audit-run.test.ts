// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const { claim, settle } = vi.hoisted(() => ({ claim: vi.fn(), settle: vi.fn() }));
vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));
vi.mock("@/lib/data-store/live-source-audit", () => ({ claimLiveAuditChunk: claim, settleLiveAuditChunk: settle }));
vi.mock("@/lib/data-store/live-source-capture", () => ({ requestLiveSourceCaptures: vi.fn(async () => []) }));
import { freezeLiveAuditFee, liveAuditPolicyFingerprint, makeLiveAuditDraw, LIVE_SOURCE_AUDIT as LIMITS, type LiveAuditCatalogRow, type LiveAuditGraph, type LiveAuditPolicy } from "./live-source-audit";
import { runLiveAuditChunk } from "./live-source-audit-run";

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
});
