import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IndexRow } from "@/lib/data-store";
import { institutionsFor } from "./(public)/fees/(index)/index-view";

const getIndexRowsCached = vi.fn<(fee: string) => Promise<IndexRow[]>>();
vi.mock("@/lib/data-store/public-cached-reads", () => ({ getIndexRowsCached: (fee: string) => getIndexRowsCached(fee) }));

const { institutionCardFees } = await import("./landing-index-actions");

const row = (id: number, institution_id: number, amount: number): IndexRow => ({
  id,
  institution_id,
  institution_name: `Institution ${institution_id}`,
  amount,
  charter_type: "bank",
  state_code: "FL",
});
const maintenance = [row(1, 7, 10), row(2, 7, 14), row(3, 8, 5)];
const overdraft = [row(4, 8, 30)];

describe("institutionCardFees", () => {
  beforeEach(() => {
    getIndexRowsCached.mockReset();
    getIndexRowsCached.mockImplementation(async (fee) => (fee === "monthly_maintenance" ? maintenance : fee === "overdraft" ? overdraft : []));
  });

  it("returns the value the chart counts for each fee, in cents, and never zero-fills a fee with no row", async () => {
    const value = institutionsFor(maintenance, "monthly_maintenance", null, "all").find((i) => i.id === 7)!.value;
    expect(await institutionCardFees(7, ["monthly_maintenance", "overdraft"])).toEqual({ monthly_maintenance: Math.round(value * 100) });
    expect(await institutionCardFees(9, ["monthly_maintenance", "overdraft"])).toEqual({});
  });

  it("accepts only a positive integer id", async () => {
    for (const bad of [0, -3, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, "7", null, undefined, {}]) {
      expect(await institutionCardFees(bad, ["monthly_maintenance"])).toBeNull();
    }
    expect(getIndexRowsCached).not.toHaveBeenCalled();
  });

  it("reads only the card's own free fees", async () => {
    expect(await institutionCardFees(8, ["monthly_maintenance", "stop_payment", 42, "overdraft", "overdraft"])).toEqual({
      monthly_maintenance: 500,
      overdraft: 3000,
    });
    expect(getIndexRowsCached.mock.calls.map((c) => c[0]).sort()).toEqual(["monthly_maintenance", "overdraft"]);
    getIndexRowsCached.mockClear();
    expect(await institutionCardFees(8, ["stop_payment"])).toBeNull();
    expect(await institutionCardFees(8, "monthly_maintenance")).toBeNull();
    expect(getIndexRowsCached).not.toHaveBeenCalled();
  });

  it("returns nothing when a read fails", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    getIndexRowsCached.mockRejectedValueOnce(new Error("db down"));
    expect(await institutionCardFees(7, ["monthly_maintenance", "overdraft"])).toBeNull();
    quiet.mockRestore();
  });
});
