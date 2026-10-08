import { describe, expect, it, vi } from "vitest";

import { restoreFeesNowInTaxonomy, rollBackOffTaxonomyFees, taxonomyFeeKeys } from "./off-taxonomy-rollback";
import { RETIRED_CATEGORY_KEYS } from "@/lib/fee-fold";
import { FEE_FAMILIES } from "@/lib/fee-taxonomy";

type DbMock = ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };

function createDbMock(rows: Array<Record<string, unknown>>): DbMock {
  const db = vi.fn(() => Promise.resolve([])) as DbMock;
  db.unsafe = vi.fn(() => Promise.resolve(rows));
  return db;
}

function asDb(db: DbMock): Parameters<typeof rollBackOffTaxonomyFees>[0] {
  return db as unknown as Parameters<typeof rollBackOffTaxonomyFees>[0];
}

const offTaxonomy = {
  fee_published_id: 7001,
  institution_id: 42,
  canonical_fee_key: "zipper_bags",
  fee_name: "Zipper bags",
  amount: "5.00",
};

describe("Hamilton off-taxonomy rollback", () => {
  // The 15 categories folded into the top 50 stay valid here: the fold step re-files them, and
  // a fee with no home goes through its second look rather than this rollback.
  it("keeps exactly the taxonomy's fee categories and the folded ones", () => {
    const keys = taxonomyFeeKeys();
    expect(new Set(keys)).toEqual(new Set([...Object.values(FEE_FAMILIES).flat(), ...RETIRED_CATEGORY_KEYS]));
    expect(keys).not.toContain("zipper_bags");
  });

  it("rolls back live off-taxonomy rows with a reason and batch id, and logs a run event", async () => {
    const db = createDbMock([offTaxonomy]);

    const rollbacks = await rollBackOffTaxonomyFees(asDb(db), {
      runId: 211,
      batchId: "agentic-run-211",
      dryRun: false,
    });

    expect(rollbacks).toEqual([
      { feePublishedId: 7001, institutionId: 42, canonicalFeeKey: "zipper_bags", feeName: "Zipper bags", amount: 5 },
    ]);
    const [query, params] = db.unsafe.mock.calls[0] as [string, unknown[]];
    expect(query).toContain("UPDATE published_fee_records");
    expect(query).toContain("rolled_back_reason = 'category_outside_taxonomy'");
    expect(query).toContain("fp.rolled_back_at IS NULL");
    expect(query).toContain("NOT (fp.canonical_fee_key = ANY($1::text[]))");
    expect(params[0]).toEqual(taxonomyFeeKeys());
    expect(params[params.length - 1]).toBe("agentic-run-211");
    expect(JSON.stringify(db.mock.calls)).toContain("hamilton.off_taxonomy_rolled_back");
  });

  it("only reads in a dry run", async () => {
    const db = createDbMock([offTaxonomy]);

    const rollbacks = await rollBackOffTaxonomyFees(asDb(db), {
      runId: 212,
      batchId: "agentic-run-212",
      dryRun: true,
    });

    expect(rollbacks).toHaveLength(1);
    expect(String(db.unsafe.mock.calls[0][0])).not.toContain("UPDATE");
    expect(db).not.toHaveBeenCalled();
  });

  it("scopes the sweep to one institution when asked", async () => {
    const db = createDbMock([]);

    await rollBackOffTaxonomyFees(asDb(db), {
      runId: 213,
      batchId: "agentic-run-213",
      dryRun: false,
      institutionId: 42,
    });

    const [query, params] = db.unsafe.mock.calls[0] as [string, unknown[]];
    expect(query).toContain("fp.institution_id = $3");
    expect(params[2]).toBe(42);
    expect(params[3]).toBe("agentic-run-213");
  });

  it("never fails the publish when the sweep errors", async () => {
    const db = createDbMock([]);
    db.unsafe = vi.fn(() => Promise.reject(new Error("boom")));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      rollBackOffTaxonomyFees(asDb(db), { runId: 214, batchId: "agentic-run-214", dryRun: false }),
    ).resolves.toEqual([]);
    spy.mockRestore();
  });

  it("restores an earlier off-taxonomy takedown whose category is in the taxonomy today", async () => {
    const db = createDbMock([{ ...offTaxonomy, canonical_fee_key: "safe_deposit_box" }]);

    const restores = await restoreFeesNowInTaxonomy(asDb(db), { runId: 8, dryRun: false });

    expect(restores.map((fee) => fee.feePublishedId)).toEqual([7001]);
    const [query, params] = db.unsafe.mock.calls[0] as [string, unknown[]];
    expect(query).toContain("SET rolled_back_at = NULL");
    expect(query).toContain("canonical_fee_key = ANY($1::text[])");
    expect(query).toContain("NOT EXISTS");
    expect(params[2]).toBe("category_outside_taxonomy");
    expect(JSON.stringify(db.mock.calls)).toContain("hamilton.off_taxonomy_restored");
  });
});
