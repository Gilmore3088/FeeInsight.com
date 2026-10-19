import { beforeEach, describe, expect, it, vi } from "vitest";
import { SPECIAL_UNIT_FREQUENCIES } from "@/lib/fee-unit";

const mocks = vi.hoisted(() => ({
  institution: vi.fn(), fees: vi.fn(), market: vi.fn(),
}));
vi.mock("@/lib/data-store", () => ({
  getInstitutionById: mocks.institution,
  getFeesByInstitution: mocks.fees,
}));
vi.mock("@/lib/data-store/local-market", () => ({ getLocalMarketCompetitors: mocks.market }));

import { getLocalCompetitors } from "./tool-local-competitors";

describe("local competitor subject prices (#2248)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.institution.mockResolvedValue({ institution_name: "Own Bank", cert_number: 123, city: "Town", state_code: "VA" });
    mocks.market.mockResolvedValue(null);
  });

  it("does not put a special-unit own price beside filtered peer prices", async () => {
    for (const frequency of SPECIAL_UNIT_FREQUENCIES) {
      mocks.fees.mockResolvedValue([
        { fee_category: "account_research", amount: 5, frequency: ` \t${frequency.toUpperCase()}\u00a0`, review_status: "approved" },
        { fee_category: "account_research", amount: 30, frequency: "per_item", review_status: "approved" },
        { fee_category: "document_reproduction", amount: 8, frequency: null, review_status: "approved" },
        { fee_category: "stop_payment", amount: 20, frequency: "per_item", review_status: "pending" },
      ]);
      const result = await getLocalCompetitors.execute!({ institution_id: 1 }, { toolCallId: "unit-test", messages: [] });
      expect(result).toMatchObject({ your_fees: { account_research: 30, document_reproduction: 8 } });
      expect(mocks.market).toHaveBeenLastCalledWith(expect.objectContaining({
        categories: ["account_research", "document_reproduction"],
      }));
    }
  });
});
