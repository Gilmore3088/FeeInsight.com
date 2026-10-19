import { beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({
  inputs: vi.fn(),
  stateIndexes: vi.fn(),
  national: vi.fn(),
  stats: vi.fn(),
}));

vi.mock("@/lib/data-store/public-cached-reads", () => ({
  getCheckExampleInputsCached: reads.inputs,
  getStateFeeIndexesCached: reads.stateIndexes,
}));
vi.mock("@/lib/public-stats", () => ({
  formatAbsoluteDate: (value: string | null) => value,
  getPublicNationalIndex: reads.national,
  getPublicStatsSummary: reads.stats,
}));
vi.mock("../institution/[id]/profile-data", () => ({ isVerifiedFee: () => true }));
vi.mock("../research/district/[id]/district-hub", () => ({ SourceNote: () => null }));

import { loadCheckExample } from "./check-example";

describe("loadCheckExample", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("reads the example from the public cache and is null, not an error, when that read fails", async () => {
    reads.inputs.mockRejectedValue(new Error("pool exhausted"));
    await expect(loadCheckExample(323, [])).resolves.toBeNull();
    expect(reads.inputs).toHaveBeenCalledWith(323);
    expect(reads.national).not.toHaveBeenCalled();
  });

  it("is null when the institution has no fees to compare, so the page leaves the example out", async () => {
    reads.inputs.mockResolvedValue({ inst: { institution_name: "Capital City Bank", state_code: "FL" }, fees: [] });
    await expect(loadCheckExample(323, [])).resolves.toBeNull();
  });
});
