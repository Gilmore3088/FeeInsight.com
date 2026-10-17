import { beforeEach, describe, expect, it, vi } from "vitest";

// Invented institutions and figures for tests only; nothing here is live data.
const mocks = vi.hoisted(() => ({ generateVerifiedSection: vi.fn(), assembleReportInputs: vi.fn() }));
vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));
vi.mock("./generate", () => ({ generateVerifiedSection: mocks.generateVerifiedSection }));
vi.mock("./report-inputs", () => ({ assembleReportInputs: mocks.assembleReportInputs }));

const { misplacedReportFigures, prepareReportAnswer, reconcileReportAnswer, writeReportAnswer } = await import("./report-answer-read");
type Prepared = NonNullable<Awaited<ReturnType<typeof prepareReportAnswer>>>;

const delta = (category: string, amount: number, tier: "verified" | "provisional" = "verified") => ({
  fee_name: category, fee_category: category, institution_amount: amount, peer_median: 30, peer_p25: 25, peer_p75: 35,
  delta_amount: amount - 30, delta_percent: null, position: "above_peer_median" as const, evidence_tier: tier,
  excluded_from_verified_benchmark: tier !== "verified", institution_count: 12,
  maturity: "strong" as const, confidence: 0.9, source_url: null,
});

const prepared: Prepared = {
  institutionId: 7,
  institutionName: "First Example Bank",
  input: { type: "executive_summary", title: "The Answer", data: {} },
  deltas: [delta("overdraft", 32), delta("nsf", 31, "provisional"), delta("wire_domestic_outgoing", 25)],
  competitorNames: [],
  selectedInstitution: null,
  evidencePolicy: "provisional-first",
};

beforeEach(() => {
  mocks.generateVerifiedSection.mockReset();
  mocks.assembleReportInputs.mockReset();
});

describe("the report answer page for the paid eval (#1079)", () => {
  it("prepares the Peer Benchmarking answer page with no reader, and nothing when the screen would write no report", async () => {
    mocks.assembleReportInputs.mockResolvedValueOnce({
      kind: "ready",
      institutionName: "First Example Bank",
      sectionInputs: [prepared.input, {}, {}],
      selectedFeeDeltas: prepared.deltas,
      exhibitSet: { data: { local_market: { comparisons: [{ competitors: [{ name: "Second Example Bank" }] }] } } },
    });
    const ready = await prepareReportAnswer(7, "First Example Bank", new Date("2026-10-15T12:00:00Z"));
    expect(ready).toMatchObject({ institutionId: 7, input: prepared.input, competitorNames: ["Second Example Bank"] });
    const call = mocks.assembleReportInputs.mock.calls[0][0];
    expect(call.params).toMatchObject({ templateType: "peer_benchmarking", institutionId: 7, dateFrom: "2026-07-15", dateTo: "2026-10-15" });
    expect(call.userId).toBeNull();
    expect(await call.resolveFindings("7")).toEqual([]);
    mocks.assembleReportInputs.mockResolvedValueOnce({ kind: "insufficient" });
    expect(await prepareReportAnswer(7, "First Example Bank")).toBeNull();
  });

  it("passes when the figures trace and the partner review finds nothing, and tags the call for the eval", async () => {
    mocks.generateVerifiedSection.mockResolvedValue({ status: "ok", section: { narrative: "HEADLINE: First Example Bank's overdraft fee sits above peers.\nDECISION: Review overdraft.\nWHY: It is above peers.\nCONFIDENCE: High." }, figuresChecked: 0 });
    const tracking = { operation: "report_answer_eval", subjectKey: "k", agentRunId: 3 };
    const result = await writeReportAnswer({ ...prepared, deltas: [delta("overdraft", 32)] }, tracking);
    expect(mocks.generateVerifiedSection).toHaveBeenCalledWith(prepared.input, tracking);
    expect(result.status).toBe("written");
  });

  it("fails form for an untraced figure, and reports a refused provider as unavailable", async () => {
    mocks.generateVerifiedSection.mockResolvedValueOnce({ status: "needs_review", section: { narrative: "No headline." }, unmatched: ["$91.37"] });
    const flagged = await writeReportAnswer(prepared, {});
    expect(flagged).toMatchObject({ status: "written", passed: false });
    expect(flagged.status === "written" && flagged.problems[0]).toBe("figures not in the report data: $91.37");
    mocks.generateVerifiedSection.mockRejectedValueOnce(new Error("Provider budget guard blocked this call."));
    expect(await writeReportAnswer(prepared, {})).toEqual({ status: "unavailable", reason: "Hamilton's writing budget for today is used up." });
  });

  it("re-reads the comparison and holds each verified fee the page names to it", async () => {
    const fresh = (overdraft: number, median = 30) => vi.fn(async () => prepared.deltas.map((d) => (d.fee_category === "overdraft" ? { ...d, institution_amount: overdraft, peer_median: median } : d)));
    // The page names overdraft by amount and the wire fee by name; NSF is provisional.
    const text = "Its $32 overdraft and $31 NSF fees sit above peers; its Outgoing Domestic Wire fee does not.";
    const named = prepared.deltas.filter((d) => d.fee_category !== "nsf").length;
    const ok = await reconcileReportAnswer(prepared, text, fresh(32));
    expect(ok.figures).toBeGreaterThanOrEqual(1);
    expect(ok.figures).toBeLessThanOrEqual(named);
    expect(ok.failures).toEqual([]);
    const moved = await reconcileReportAnswer(prepared, text, fresh(29));
    expect(moved.failures).toContain("Overdraft (OD): the report uses $32.00, the catalog has $29.00");
    const median = await reconcileReportAnswer(prepared, text, fresh(32, 28));
    expect(median.failures).toContain("Overdraft (OD): the report's peer median is $30.00, the catalog's is $28.00");
    const gone = await reconcileReportAnswer(prepared, text, vi.fn(async () => []));
    expect(gone.failures[0]).toMatch(/a fresh read has no comparison for it/);
    expect(await reconcileReportAnswer(prepared, "Peers vary.", fresh(32))).toEqual({ checked: false, figures: 0, failures: [] });
    // A page names "overdraft", not the display label "Overdraft (OD)", and states no amount (#1414).
    const byName = await reconcileReportAnswer(prepared, "Its overdraft fee sits above peers.", fresh(29));
    expect(byName).toMatchObject({ checked: true, figures: 1 });
    expect(byName.failures).toEqual(["Overdraft (OD): the report uses $32.00, the catalog has $29.00"]);
  });

  it("ties each figure to the fee its sentence names (#1414 item 8)", async () => {
    const deltas = [delta("overdraft", 32), { ...delta("wire_domestic_outgoing", 25), peer_median: 20, peer_p25: 15, peer_p75: 22 }];
    // Right: the bank's amount and the median, each labeled.
    expect(misplacedReportFigures("Its overdraft fee is $32, above the peer median of $30.", deltas)).toEqual([]);
    expect(misplacedReportFigures("Peers charge $30 for an overdraft; this bank charges $32.", deltas)).toEqual([]);
    expect(misplacedReportFigures("The overdraft fee sits $2 above the median.", deltas)).toEqual([]);
    // The peer median stated as the bank's own fee.
    expect(misplacedReportFigures("The bank charges $30 for an overdraft.", deltas)).toEqual(["Overdraft (OD): the page states the peer median $30.00 as the bank's own fee $32.00"]);
    // The bank's amount stated as the median.
    expect(misplacedReportFigures("The overdraft median is $32.", deltas)).toEqual(["Overdraft (OD): the page states the bank's $32.00 as the peer median $30.00"]);
    // Another fee's figure on this fee.
    expect(misplacedReportFigures("The bank charges $20 for an overdraft.", deltas)).toEqual(["Overdraft (OD): the page states $20.00, which is the peer median for Wire Transfer (Domestic Out)"]);
    // Two fees in one sentence, or a figure that matches nothing, is left to other checks.
    expect(misplacedReportFigures("Its $25 wire and $32 overdraft fees sit above peers.", deltas)).toEqual([]);
    expect(misplacedReportFigures("The overdraft fee is $99.", deltas)).toEqual([]);
    // reconcileReportAnswer reports it with the fresh-read checks, and without a fresh read.
    const page = "The bank charges $30 for an overdraft.";
    const tied = await reconcileReportAnswer({ ...prepared, deltas }, page, vi.fn(async () => deltas));
    expect(tied).toEqual({ checked: true, figures: 1, failures: ["Overdraft (OD): the page states the peer median $30.00 as the bank's own fee $32.00"] });
    expect((await reconcileReportAnswer({ ...prepared, deltas }, page, vi.fn(async () => null))).failures).toHaveLength(1);
  });
});
