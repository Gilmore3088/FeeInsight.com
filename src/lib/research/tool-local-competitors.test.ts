import { beforeEach, describe, expect, it, vi } from "vitest";
import { ownFeeFromRows, type InstitutionOwnFee } from "@/lib/own-fee";

const mocks = vi.hoisted(() => ({
  institution: vi.fn(), ownFees: vi.fn(), market: vi.fn(),
}));
vi.mock("@/lib/data-store", () => ({ getInstitutionById: mocks.institution }));
vi.mock("@/lib/data-store/fee-index", () => ({ getInstitutionOwnFees: mocks.ownFees }));
vi.mock("@/lib/data-store/local-market", () => ({ getLocalMarketCompetitors: mocks.market }));

import { getLocalCompetitors } from "./tool-local-competitors";

function own(category: string, rows: { fee_name: string; amount: number }[], value: number): [string, InstitutionOwnFee] {
  return [category, ownFeeFromRows(category, rows, value, false)!];
}

const run = () => getLocalCompetitors.execute!({ institution_id: 1 }, { toolCallId: "unit-test", messages: [] });

describe("local competitor subject prices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.institution.mockResolvedValue({ institution_name: "Own Bank", cert_number: 123, city: "Town", state_code: "VA" });
    mocks.market.mockResolvedValue(null);
  });

  it("should_read_the_subject_through_the_shared_own_fee_reader", async () => {
    mocks.ownFees.mockResolvedValue(new Map([own("document_reproduction", [{ fee_name: "Copy", amount: 8 }], 8)]));
    await run();
    expect(mocks.ownFees).toHaveBeenCalledWith(1);
  });

  it("should_show_a_range_not_the_first_row_when_the_subject_states_several_fees (#1994)", async () => {
    mocks.ownFees.mockResolvedValue(new Map([
      own("garnishment", [{ fee_name: "Levy", amount: 150 }, { fee_name: "Garnishment", amount: 175 }], 162.5),
      own("document_reproduction", [{ fee_name: "Copy", amount: 8 }], 8),
    ]));
    const result = await run();
    expect(result).toMatchObject({
      your_fees: { document_reproduction: 8 },
      your_several_fees: {
        garnishment: { low: 150, high: 175, fees: [{ name: "Levy", amount: 150 }, { name: "Garnishment", amount: 175 }] },
      },
    });
    expect((result as { your_fees: Record<string, number> }).your_fees).not.toHaveProperty("garnishment");
    expect(mocks.market).toHaveBeenLastCalledWith(expect.objectContaining({
      categories: expect.arrayContaining(["garnishment", "document_reproduction"]),
    }));
  });

  it("should_omit_your_several_fees_when_every_category_states_one_price", async () => {
    mocks.ownFees.mockResolvedValue(new Map([
      own("stop_payment", [{ fee_name: "Stop payment", amount: 30 }, { fee_name: "Stop payment", amount: 30 }], 30),
    ]));
    const result = await run();
    expect(result).toMatchObject({ your_fees: { stop_payment: 30 } });
    expect(result).not.toHaveProperty("your_several_fees");
  });

  it("should_round_your_several_fees_to_cents_as_your_fees_are (#975)", async () => {
    mocks.ownFees.mockResolvedValue(new Map([
      own("garnishment", [{ fee_name: "Levy", amount: 150.004 }, { fee_name: "Garnishment", amount: 175.126 }], 162.565),
    ]));
    const result = await run();
    expect(result).toMatchObject({
      your_several_fees: {
        garnishment: { low: 150, high: 175.13, fees: [{ name: "Levy", amount: 150 }, { name: "Garnishment", amount: 175.13 }] },
      },
    });
  });
});
