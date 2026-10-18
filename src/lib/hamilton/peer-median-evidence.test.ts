/**
 * Peer medians name their records (#981, H06-T04): one published row per peer, a peer_median
 * derivation that recomputes, binding only where a sentence calls the figure the median, and the
 * same records in the saved appendix and board brief.
 */
import { describe, expect, it } from "vitest";
import {
  buildFeeResearchEvidence,
  MAX_PEER_MEDIAN_RECORDS,
  PEER_AGGREGATE_LIMITATION,
  PEER_MEDIAN_RECORDS_LIMITATION,
  peerMedianCoverage,
  peerMedianEvidence,
} from "./evidence-contract";
import { savedEvidenceAppendix } from "./evidence-export";
import { bindNarrative, MEDIAN_AS_FEE_LIMITATION } from "./narrative-bound";
import { readNarrativeBinding } from "./written-answer-binding";
import { evidenceRecordsExhibit, readerLimitation, savedAnswerLimits } from "./board-brief";
import { overdraftResearch } from "./workspace/test-fixtures";
import type { FeeResearch, PeerValue } from "./workspace/types";

const withRecords = (peer: PeerValue, i: number): PeerValue => ({
  ...peer,
  feeRecords: [
    // A lower tier first: the peer's value (overdraft: highest tier) is the second row.
    ...(i === 0 ? [{ id: 5000, amount: 10, feeName: "Overdraft fee, tier 1", frequency: "per_item", feeAudience: "consumer" as const, sourceDocumentId: peer.institutionId, documentUrl: null }] : []),
    { id: 1000 + i, amount: peer.amount, feeName: "Overdraft fee", frequency: "per_item", feeAudience: "consumer" as const, sourceDocumentId: peer.institutionId, documentUrl: `https://example.org/peer-${peer.institutionId}.pdf` },
  ],
});
const base = overdraftResearch();
const research: FeeResearch = { ...base, peers: base.peers.map(withRecords) };

describe("peer median evidence", () => {
  it("names one published row per peer and recomputes the band's median from them", () => {
    const found = peerMedianEvidence(research)!;
    expect(found.facts).toHaveLength(16);
    expect(found.facts[0]).toMatchObject({ id: "fee:published:1000", value: 20, scope: { institutionId: 1, feeCategory: "overdraft", product: "Overdraft fee", accountApplicability: "consumer" }, source: { recordId: 1000, sourceDocumentIds: [1], table: "published_fee_catalog" } });
    expect(found.derivation).toMatchObject({ id: "derived:peer_median:1:overdraft", value: 29.5, scope: { institutionId: null }, derivation: { kind: "peer_median", formula: "median of published peer amounts" } });
    expect(found.derivation.derivation.inputFactIds).toEqual(found.facts.map(f => f.id));
    const bundle = buildFeeResearchEvidence(research);
    expect(bundle.derivations.map(d => d.derivation.kind)).toContain("peer_median");
    expect(bundle.limitations).toContain(PEER_MEDIAN_RECORDS_LIMITATION);
    expect(bundle.limitations).not.toContain(PEER_AGGREGATE_LIMITATION);
  });
  it("stays directional when a peer has no row of its value, frequencies differ, the group is large, or the rows miss the median", () => {
    const missing = { ...research, peers: research.peers.map((p, i) => (i === 3 ? { ...p, feeRecords: undefined } : p)) };
    const mixed = { ...research, peers: research.peers.map((p, i) => (i === 3 ? { ...p, feeRecords: p.feeRecords!.map(r => ({ ...r, frequency: "per_day" })) } : p)) };
    const noDocument = { ...research, peers: research.peers.map((p, i) => (i === 3 ? { ...p, feeRecords: p.feeRecords!.map(r => ({ ...r, sourceDocumentId: null })) } : p)) };
    const off = { ...research, band: { ...research.band!, median: 31 } };
    const big = { ...research, peers: Array.from({ length: MAX_PEER_MEDIAN_RECORDS + 1 }, (_, i) => withRecords({ ...research.peers[0], institutionId: 200 + i, amount: 30 }, i + 1)), band: { ...research.band!, median: 30, n: MAX_PEER_MEDIAN_RECORDS + 1 } };
    for (const r of [missing, mixed, noDocument, off, big]) {
      expect(peerMedianEvidence(r)).toBeNull();
      expect(buildFeeResearchEvidence(r).limitations).toContain(PEER_AGGREGATE_LIMITATION);
    }
    expect(buildFeeResearchEvidence(base).derivations.some(d => d.derivation.kind === "peer_median")).toBe(false);
  });
  it("says how many peers were left out of the record check and why, and never 0 of N (#1717)", () => {
    const three = { ...research, peers: research.peers.map((p, i) => (i < 3 ? { ...p, feeRecords: undefined } : p)) };
    expect(peerMedianCoverage(three)).toEqual({ context: "peer_median", total: 16, leftOut: 3, byReason: { not_verified: 3 } });
    const bundle = buildFeeResearchEvidence(three);
    const line = "3 of 16 peers left out of the record check: not yet verified.";
    expect(bundle.peerCoverage).toEqual(peerMedianCoverage(three));
    expect(bundle.limitations).toContain(line);
    expect(readerLimitation(line)).toBe(line);
    // The line reaches the saved answer's limits, as the board brief and export print them.
    expect(savedAnswerLimits({ title: "t", confidence: { level: "medium" as const, basis: [] }, hamiltonView: "", whatThisMeans: "", whyItMatters: [], evidence: { metrics: [] }, exploreFurther: [], factEvidence: bundle })).toContain(line);
    expect(peerMedianCoverage(research)).toBeNull();
    const full = buildFeeResearchEvidence(research);
    expect(full.peerCoverage).toBeUndefined();
    expect(full.limitations.some(l => /left out/.test(l))).toBe(false);
    // Peers without records but a median that fails for another reason (frequencies differ): no per-peer line.
    const mixed = { ...research, peers: research.peers.map((p, i) => (i === 3 ? { ...p, feeRecords: p.feeRecords!.map(r => ({ ...r, frequency: "per_day" })) } : p)) };
    expect(buildFeeResearchEvidence(mixed).limitations.some(l => /left out/.test(l))).toBe(false);
    // A group the record check can't take at all (too large, or not the band's size) names no left-out peers.
    const big = { ...research, peers: Array.from({ length: MAX_PEER_MEDIAN_RECORDS + 1 }, (_, i) => ({ ...research.peers[0], institutionId: 200 + i, amount: 30, feeRecords: undefined })), band: { ...research.band!, median: 30, n: MAX_PEER_MEDIAN_RECORDS + 1 } };
    const offCount = { ...three, band: { ...research.band!, n: 17 } };
    for (const r of [big, offCount]) {
      expect(peerMedianCoverage(r)).toBeNull();
      expect(buildFeeResearchEvidence(r).limitations.some(l => /left out/.test(l))).toBe(false);
    }
  });
  it("binds a sentence that calls the figure the median, and leaves out the median stated as the bank's fee", () => {
    const evidence = buildFeeResearchEvidence(research);
    const names = new Map([[1, "Example Valley Credit Union"]]);
    const median = bindNarrative({ text: "The peer median overdraft fee is $29.50.", evidence, names });
    expect(median.supported[0].factIds).toEqual(expect.arrayContaining(["derived:peer_median:1:overdraft", "fee:published:1000", "fee:published:1015"]));
    const asFee = bindNarrative({ text: "Example Valley Credit Union charges $29.50 for an overdraft.", evidence, names });
    expect(asFee.omitted).toEqual([{ text: "Example Valley Credit Union charges $29.50 for an overdraft.", reason: "median_as_fee" }]);
    expect(asFee.limitations).toContain(MEDIAN_AS_FEE_LIMITATION);
    expect(readNarrativeBinding(asFee)).toEqual(asFee);
    // An average is a different figure from the median; it stays Hamilton's reading.
    expect(bindNarrative({ text: "Peers charge an average of $29.50, close to the median.", evidence, names }).interpretation).toHaveLength(1);
  });
  it("prints the peer records and recomputes the median in the saved appendix and board brief", () => {
    const factEvidence = buildFeeResearchEvidence(research);
    const analysis = { title: "t", confidence: { level: "medium" as const, basis: [] }, hamiltonView: "", whatThisMeans: "", whyItMatters: [], evidence: { metrics: [] }, exploreFurther: [], factEvidence };
    const appendix = savedEvidenceAppendix(analysis);
    const row = appendix.derivations.find(d => d.id === "derived:peer_median:1:overdraft")!;
    expect(row.problems).toEqual([]);
    expect(appendix.facts.filter(f => f.id.startsWith("fee:published:10")).every(f => f.problems.length === 0)).toBe(true);
    const exhibit = evidenceRecordsExhibit(analysis)!;
    expect(exhibit.rows.find(r => r[2].includes("derived:peer_median:1:overdraft"))?.[3]).toBe("Recalculated from the saved records");
    expect(readerLimitation(PEER_MEDIAN_RECORDS_LIMITATION)).toBe("The peer median is worked out from each peer's own published fee, listed in the records table. The other peer figures, such as the middle half and wider-market medians, are directional.");
  });
});
