import { beforeEach, describe, expect, it, vi } from "vitest";
import { ownFeeFromRows, type InstitutionOwnFee } from "@/lib/own-fee";

const mocks = vi.hoisted(() => ({
  institution: vi.fn(), ownFees: vi.fn(), market: vi.fn(),
}));
vi.mock("@/lib/data-store", () => ({ getInstitutionById: mocks.institution }));
vi.mock("@/lib/data-store/fee-index", () => ({ getInstitutionOwnFees: mocks.ownFees }));
vi.mock("@/lib/data-store/local-market", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data-store/local-market")>()),
  getLocalMarketCompetitors: mocks.market,
}));

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

describe("local competitor identity (#1077, Cycle A defect 2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.institution.mockResolvedValue({ institution_name: "Own Bank", cert_number: 123, city: "Town", state_code: "VA" });
    mocks.ownFees.mockResolvedValue(new Map([own("overdraft", [{ fee_name: "Overdraft", amount: 37 }], 37)]));
  });

  it("should_carry_the_subject_and_each_competitor_by_id_with_the_market_and_its_document", async () => {
    mocks.market.mockResolvedValue({
      basis: "branch_counties", label: "Town, VA area (2 counties)", county_fips: [51001, 51003], sod_year: 2025,
      competitors: [{
        institution_id: 42, institution_name: "Rival  Bank", charter_type: "bank", market_deposits: 1000,
        fees: { overdraft: 35, stop_payment: 30 }, several: {},
        document_url: "https://fixture.invalid/42.pdf", document_date: "2026-09-30",
      }],
    });
    const result = await run();
    expect(result).toMatchObject({
      institution: "Own Bank", institution_id: 1, your_fees: { overdraft: 37 },
      market: "Town, VA area (2 counties)", market_basis: "branch_counties", county_fips: [51001, 51003], sod_year: 2025,
      competitors: [{
        institution_id: 42, name: "Rival Bank", fees: { overdraft: 35, stop_payment: 30 },
        fee_basis: { overdraft: "max", stop_payment: "median" },
        document_url: "https://fixture.invalid/42.pdf", document_date: "2026-09-30",
      }],
    });
  });

  it("should_give_no_basis_for_a_category_shown_only_as_several_fees", async () => {
    mocks.market.mockResolvedValue({
      basis: "hq_city", label: "Town, VA area", county_fips: [51001], sod_year: 2025,
      competitors: [{
        institution_id: 43, institution_name: "Other CU", charter_type: "credit_union", market_deposits: null,
        fees: { overdraft: 32.5 },
        several: { overdraft: { low: 30, high: 35, fees: [{ name: "Standard", amount: 30 }, { name: "Premium", amount: 35 }] } },
        document_url: null, document_date: null,
      }],
    });
    const result = (await run()) as { competitors: Array<Record<string, unknown>> };
    expect(result.competitors[0]).toMatchObject({ institution_id: 43, fees: {}, fee_basis: {}, several_fees: { overdraft: { low: 30, high: 35 } } });
  });

  it("should_carry_the_subject_id_when_no_market_is_found", async () => {
    mocks.market.mockResolvedValue(null);
    expect(await run()).toMatchObject({ institution: "Own Bank", institution_id: 1 });
  });
});
