import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { UNSTATED_AUDIENCE_FOOTNOTE } from "@/lib/fee-audience";

const reads = vi.hoisted(() => ({
  inputs: vi.fn(),
  comparable: vi.fn(),
  stats: vi.fn(),
}));

vi.mock("@/lib/data-store/public-cached-reads", () => ({
  getCheckExampleInputsCached: reads.inputs,
  getComparableMarketIndexCached: reads.comparable,
}));
vi.mock("@/lib/public-stats", () => ({
  formatAbsoluteDate: (value: string | null) => value,
  getPublicStatsSummary: reads.stats,
}));
vi.mock("../research/district/[id]/district-hub", () => ({ SourceNote: () => null }));

import { CheckExample, loadCheckExample } from "./check-example";

describe("loadCheckExample", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reads.comparable.mockResolvedValue([]);
    reads.stats.mockResolvedValue({ refreshedOn: "Oct 19, 2026" });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("reads the example from the public cache and is null, not an error, when that read fails", async () => {
    reads.inputs.mockRejectedValue(new Error("pool exhausted"));
    await expect(loadCheckExample(323, [])).resolves.toBeNull();
    expect(reads.inputs).toHaveBeenCalledWith(323);
    expect(reads.comparable).not.toHaveBeenCalled();
  });

  it("is null when the institution has no fees to compare, so the page leaves the example out", async () => {
    reads.inputs.mockResolvedValue({ inst: { institution_name: "Capital City Bank", state_code: "FL" }, fees: [] });
    await expect(loadCheckExample(323, [])).resolves.toBeNull();
  });

  it("uses the same comparable market populations as the institution profile", async () => {
    reads.inputs.mockResolvedValue({
      inst: { institution_name: "Test Bank", state_code: "FL" },
      fees: [{ fee_name: "Non-Network ATM", fee_category: "atm_non_network", amount: 2, review_status: "approved", fee_audience: "consumer", source_document_id: 1 }],
    });
    reads.comparable.mockResolvedValue([{
      fee_category: "atm_non_network", min_amount: 0, p25_amount: 0, median_amount: 1,
      p75_amount: 2, max_amount: 4, institution_count: 40, maturity_tier: "strong",
      unstated_audience_institution_count: 8,
    }]);
    const example = await loadCheckExample(323, []);
    expect(reads.comparable).toHaveBeenCalledWith({ kind: "us" });
    expect(reads.comparable).toHaveBeenCalledWith({ kind: "state", code: "FL" });
    expect(example?.rows[0].state?.median).toBe(1);
    expect(example?.rows[0].nation?.unstated_audience_institution_count).toBe(8);
    if (!example) throw new Error("Expected a comparable example");
    render(createElement(CheckExample, { example, layout: "card" }));
    expect(screen.getByText(UNSTATED_AUDIENCE_FOOTNOTE)).toBeInTheDocument();
  });

  it("leaves the example out when both comparable market reads fail", async () => {
    reads.inputs.mockResolvedValue({
      inst: { institution_name: "Test Bank", state_code: "FL" },
      fees: [{ fee_name: "Non-Network ATM", fee_category: "atm_non_network", amount: 2, review_status: "approved", fee_audience: "consumer", source_document_id: 1 }],
    });
    reads.comparable.mockRejectedValue(new Error("market unavailable"));
    await expect(loadCheckExample(323, [])).resolves.toBeNull();
  });
});
