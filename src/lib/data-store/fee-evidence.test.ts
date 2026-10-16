import { beforeEach, describe, expect, it, vi } from "vitest";

const unsafe = vi.fn();
vi.mock("./connection", () => ({ getSql: () => ({ unsafe }), sql: vi.fn() }));

import { FEE_EVIDENCE_MAX_IDS, getFeeEvidence } from "./fee-evidence";

describe("getFeeEvidence", () => {
  beforeEach(() => unsafe.mockReset());

  it("reads each row's own document text and keys the evidence by catalog id", async () => {
    unsafe
      .mockResolvedValueOnce([
        { id: "60940", fee_name: "Account Fees: The monthly service charge", amount: "10.00", fee_category: "monthly_maintenance", extraction_note: null, conditions: null, source_document_id: "18090" },
        { id: "11764", fee_name: "Express Checking Monthly Fee", amount: "5.00", fee_category: "monthly_maintenance", extraction_note: null, conditions: null, source_document_id: null },
      ])
      .mockResolvedValueOnce([
        {
          source_document_id: "18090",
          normalized_text: "NOW Checking\n\nMinimum Balance: $500\n\nAccount Fees: The monthly service charge if the daily balance drops below $500.00 any day of the statement cycle is $10.00.\n",
        },
      ]);
    const evidence = await getFeeEvidence([60940, 11764, 60940, -1]);
    expect(unsafe).toHaveBeenCalledTimes(2);
    expect(unsafe.mock.calls[0][1]).toEqual([[60940, 11764]]);
    expect(unsafe.mock.calls[1][1]).toEqual([[18090]]);
    expect(evidence.get(60940)).toMatchObject({ heading: "NOW Checking", basis: "traced" });
    expect(evidence.get(60940)?.line).toContain("$10.00");
    // No document and no stored line: nothing a reader can check, so no evidence.
    expect(evidence.get(11764)).toBeNull();
  });

  it("reads nothing for no ids and caps a call", async () => {
    expect((await getFeeEvidence([])).size).toBe(0);
    expect(unsafe).not.toHaveBeenCalled();
    unsafe.mockResolvedValueOnce([]);
    await getFeeEvidence(Array.from({ length: FEE_EVIDENCE_MAX_IDS + 20 }, (_, i) => i + 1));
    expect((unsafe.mock.calls[0][1] as number[][])[0]).toHaveLength(FEE_EVIDENCE_MAX_IDS);
  });
});
