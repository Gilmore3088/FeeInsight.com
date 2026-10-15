import { beforeEach, describe, expect, it, vi } from "vitest";

// Invented institutions and figures for tests only; nothing here is live data.
const mocks = vi.hoisted(() => ({ generateVerifiedSection: vi.fn(), assembleReportInputs: vi.fn() }));
vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));
vi.mock("./generate", () => ({ generateVerifiedSection: mocks.generateVerifiedSection }));
vi.mock("./report-inputs", () => ({ assembleReportInputs: mocks.assembleReportInputs }));

const { prepareReportAnswer, reconcileReportAnswer, writeReportAnswer } = await import("./report-answer-read");
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

  it("ties only the bank's own verified fees the page states to the live catalog", async () => {
    const read = vi.fn(async () => new Map([["overdraft", 29]]));
    const tied = await reconcileReportAnswer(prepared, "Its $32 overdraft and $31 NSF fees sit above the $30 median.", read);
    // The provisional NSF fee has no published row to check; the wire fee is not stated.
    expect(read).toHaveBeenCalledWith(7, ["overdraft"]);
    expect(tied).toEqual({ checked: true, figures: 1, failures: ["Overdraft (OD): the report uses $32.00, the catalog has $29.00"] });
    expect(await reconcileReportAnswer(prepared, "Peers vary.", read)).toEqual({ checked: false, figures: 0, failures: [] });
  });
});
