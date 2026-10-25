import { describe, expect, it } from "vitest";
import {
  CATALOG_SOURCE_LABEL,
  NO_MEDIAN_LIMIT,
  PROPOSED_FEE_LIMIT,
  PROVISIONAL_PEERS_LIMIT,
  READ_AT_REPORT_LIMIT,
  SAVED_ANSWER_METHOD,
  findingChartCaption,
  positionFinding,
  readAddedFindingEvidence,
  savedAnswerEvidence,
  testFinding,
} from "./report-finding-evidence";
import type { AnalyzeResponse } from "./types";

const peer = (count: number, tier: "strong" | "provisional" = "strong") => ({
  fee_category: "nsf", median_amount: 30, p25_amount: 25, p75_amount: 34, institution_count: count, maturity_tier: tier, last_updated: "2026-10-12T00:00:00.000Z",
});
const own = (price: number | null, fees = [{ name: "NSF", amount: price ?? 0 }]) => ({ price, low: price ?? 20, high: price ?? 36, fees });
const base = { feeCategory: "nsf", institutionName: "Lakeshore Test Credit Union", peerLabel: "Similar credit unions", readAt: "2026-10-25T14:00:00.000Z" };
const NAME = "NSF / Returned Item";

describe("a Position finding carries its chart, sources, method, dates and limits (#1899)", () => {
  it("re-reads the fee against 10 or more peers and draws the range", () => {
    const f = positionFinding({ ...base, own: own(27), peer: peer(12) });
    expect(f.title).toBe(`${NAME}: $27.00 against a peer group median of $30.00`);
    expect(f.detail).toBe("$3.00 (10%) below the median of 12 institutions in the peer group (Similar credit unions).");
    expect(f.evidence.chart).toEqual({ feeCategory: "nsf", feeName: NAME, subjectLabel: "Lakeshore Test Credit Union", subject: 27, p25: 25, median: 30, p75: 34, peerCount: 12, peerLabel: "Similar credit unions" });
    expect(f.evidence.sources).toEqual([{ label: CATALOG_SOURCE_LABEL, detail: `Lakeshore Test Credit Union's published ${NAME} fee and the published ${NAME} fees of 12 institutions in the peer group (Similar credit unions).` }]);
    expect(f.evidence.method).toContain("median and middle half (25th to 75th percentile)");
    expect(f.evidence.dates).toBe("Read from published fee schedules on Oct 25, 2026, when this report was made. Newest peer group fee record: Oct 12, 2026.");
    expect(f.evidence.limitations).toEqual([READ_AT_REPORT_LIMIT]);
    expect(findingChartCaption(f.evidence.chart!)).toBe(`${NAME}: Lakeshore Test Credit Union fee $27.00; peer group median $30.00 across 12 institutions; middle half $25.00 to $34.00.`);
  });

  it("gives no median under 10 peers and says why", () => {
    const f = positionFinding({ ...base, own: own(27), peer: peer(9) });
    expect(f.evidence.chart).toBeNull();
    expect(f.title).toBe(`${NAME}: $27.00; too few in the peer group for a median`);
    expect(f.detail).toContain(NO_MEDIAN_LIMIT);
    expect(JSON.stringify(f)).not.toContain("$30.00");
    expect(f.evidence.limitations).toContain(NO_MEDIAN_LIMIT);
  });

  it("names provisional peers and an institution with several fees, without a single price", () => {
    const f = positionFinding({ ...base, own: own(null, [{ name: "NSF paper", amount: 20 }, { name: "NSF electronic", amount: 36 }]), peer: peer(15, "provisional") });
    expect(f.evidence.chart?.subject).toBeNull();
    expect(f.title).toBe(`${NAME}: $20.00 to $36.00 against a peer group median of $30.00`);
    expect(f.evidence.limitations).toContain(PROVISIONAL_PEERS_LIMIT);
    expect(f.evidence.limitations.some((l) => l.includes("lists several"))).toBe(true);
  });

  it("states that no published fee was found rather than repeating what the browser sent", () => {
    const f = positionFinding({ ...base, own: null, peer: peer(12) });
    expect(f.title).toBe(`${NAME}: no published fee found`);
    expect(f.evidence.chart).toBeNull();
  });
});

describe("a Test finding is the reader's proposed fee, labelled as such (#1899)", () => {
  it("draws the proposed fee against the peers beside the current fee", () => {
    const f = testFinding({ ...base, own: own(27), peer: peer(12), proposedFee: 32 });
    expect(f.title).toBe(`${NAME}: test of $32.00 against a current published fee of $27.00`);
    expect(f.detail).toBe("$2.00 (7%) above the median of 12 institutions in the peer group (Similar credit unions), if adopted.");
    expect(f.evidence.chart).toMatchObject({ subjectLabel: "Tested", subject: 32, current: 27, median: 30 });
    expect(f.evidence.limitations[0]).toBe(PROPOSED_FEE_LIMIT);
  });

  it("draws nothing without a recorded proposed fee", () => {
    const f = testFinding({ ...base, own: own(27), peer: peer(12), proposedFee: null });
    expect(f.evidence.chart).toBeNull();
    expect(f.title).toBe(`${NAME}: a test with no fee recorded`);
  });
});

describe("an Ask finding carries the saved answer's own evidence (#1899)", () => {
  const answer: AnalyzeResponse = {
    title: "NSF at Lakeshore",
    confidence: { level: "medium", basis: ["Published schedule"] },
    hamiltonView: "Lakeshore charges $27.",
    whatThisMeans: "",
    whyItMatters: [],
    evidence: { metrics: [{ label: "NSF fee", value: "$27", note: "Published schedule" }] },
    exploreFurther: [],
  };

  it("keeps the figures, save date and limits as saved", () => {
    const e = savedAnswerEvidence(answer, "2026-10-20T09:00:00.000Z");
    expect(e.method).toBe(SAVED_ANSWER_METHOD);
    expect(e.figures).toEqual([{ label: "NSF fee", value: "$27", note: "Published schedule" }]);
    expect(e.dates).toBe("Answer saved Oct 20, 2026. Figures are as saved and were not refreshed.");
    expect(e.limitations).toContain("Published schedule");
    expect(e.sources[0].label).toBe("Saved Hamilton answer");
  });

  it("reads an answer saved without confidence or evidence without failing", () => {
    const e = savedAnswerEvidence({ ...answer, confidence: undefined, evidence: undefined } as unknown as AnalyzeResponse, null);
    expect(e.figures).toEqual([]);
    expect(e.dates).toContain("Save date not recorded");
    expect(e.limitations).toHaveLength(1);
  });
});

describe("readAddedFindingEvidence", () => {
  it("reads a stored block and refuses a malformed one", () => {
    const stored = positionFinding({ ...base, own: own(27), peer: peer(12) }).evidence;
    expect(readAddedFindingEvidence(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
    expect(readAddedFindingEvidence({ method: "x" })).toBeNull();
    expect(readAddedFindingEvidence(null)).toBeNull();
  });
});
