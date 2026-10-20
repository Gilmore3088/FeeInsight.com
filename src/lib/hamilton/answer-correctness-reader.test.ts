import { beforeEach, describe, expect, it, vi } from "vitest";

const { getContractFeeRows } = vi.hoisted(() => ({ getContractFeeRows: vi.fn() }));
vi.mock("@/lib/data-store/fee-index", () => ({ getContractFeeRows, getFeeValuesForInstitutions: vi.fn() }));

import { liveCatalogReader } from "./answer-correctness";
import { overdraftResearch } from "./workspace/test-fixtures";
import type { FeeResearch } from "./workspace/types";

// Invented figures for tests only; no figure here is live data.
const row = (institution_id: number, amount: number, fee_category: string) => ({ institution_id, amount, fee_category, charter_type: "bank" });
const structure: FeeResearch["structure"] = {
  groupLabel: "peers",
  columns: [{ category: "od_protection_transfer", label: "Transfer fee" }],
  rows: [{ institutionId: 1, name: "Peer 1", own: false, values: { od_protection_transfer: 10 } }],
  source: { label: "Fees", table: "published_fee_catalog" },
};

describe("liveCatalogReader (#2029)", () => {
  beforeEach(() => {
    getContractFeeRows.mockReset();
    getContractFeeRows.mockImplementation(async ({ categories }: { categories: string[] }) =>
      categories[0] === "od_protection_transfer" ? [row(1, 10, "od_protection_transfer")] : [row(1, 30, "overdraft")],
    );
  });

  it("reads the live transfer-from-savings rows when the answer carries a structure set", async () => {
    const live = await liveCatalogReader()(1000, overdraftResearch({ structure }));
    expect(live?.transferRows).toEqual([expect.objectContaining({ institution_id: 1, amount: 10, fee_category: "od_protection_transfer" })]);
    expect(getContractFeeRows).toHaveBeenCalledWith({ categories: ["od_protection_transfer"] });
  });

  it("does not read transfer rows without a structure set", async () => {
    const live = await liveCatalogReader()(1000, overdraftResearch({ structure: null }));
    expect(live).toEqual({ rows: [expect.objectContaining({ fee_category: "overdraft" })] });
    expect(getContractFeeRows).toHaveBeenCalledTimes(1);
  });

  it("leaves the answer unchecked when the transfer rows cannot be read", async () => {
    getContractFeeRows.mockImplementation(async ({ categories }: { categories: string[] }) => {
      if (categories[0] === "od_protection_transfer") throw new Error("read failed");
      return [row(1, 30, "overdraft")];
    });
    expect(await liveCatalogReader()(1000, overdraftResearch({ structure }))).toBeNull();
  });
});
