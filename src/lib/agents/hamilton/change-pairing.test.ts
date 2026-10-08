import { describe, expect, it } from "vitest";
import { judgeChangePair, type ChangePairRow } from "@/lib/agents/hamilton/change-pairing";

const pair = (overrides: Partial<ChangePairRow> = {}): ChangePairRow => ({
  change_id: 1,
  new_fee_published_id: 64710,
  previous_fee_published_id: 18085,
  fee_name: "Cashier's Check",
  new_amount: 5,
  previous_amount: 8,
  new_url: "https://www.tidemarkfcu.org/wp-content/uploads/2026/05/Truth-in-Savings-Disclosure-2026.05.05.pdf",
  previous_url: "https://www.tidemarkfcu.org/wp-content/uploads/2025/05/Truth-in-Savings-Disclosure-2025.05.01.pdf",
  new_document_id: 19128,
  previous_document_id: 2416,
  ...overrides,
});

describe("judgeChangePair", () => {
  it("counts a newer copy of the same schedule as like for like", () => {
    expect(judgeChangePair(pair(), [])).toBe("like_for_like");
  });

  it("rejects a consumer disclosure paired with the business schedule (Tidemark FCU, 8 Oct)", () => {
    const business = pair({ previous_url: "https://www.tidemarkfcu.org/wp-content/uploads/2025/10/Business Rate and Fee Schedule 2025.10.30.pdf" });
    expect(judgeChangePair(business, [])).toBe("cross_page");
  });

  it("rejects a change with no published pair or no known page", () => {
    expect(judgeChangePair(pair({ previous_fee_published_id: null }), [])).toBe("no_pair");
    expect(judgeChangePair(pair({ new_url: null, previous_url: null }), [])).toBe("cross_page");
  });

  it("rejects a page that lists the fee at both prices", () => {
    const lines = [
      { source_document_id: 19128, fee_name: "Cashier's Check", amount: 5 },
      { source_document_id: 19128, fee_name: "Cashier's Check", amount: 8 },
    ];
    expect(judgeChangePair(pair(), lines)).toBe("lists_both");
  });
});
