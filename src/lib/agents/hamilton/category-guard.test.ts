import { describe, expect, it, vi } from "vitest";

import { restoreTarget, runHamiltonCategoryGuard } from "./category-guard";

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

const liveRows = [
  { fee_published_id: 1, lineage_ref: 11, institution_id: 7, canonical_fee_key: "overdraft", fee_name: "Overdraft Fee", amount: "35.00" },
  { fee_published_id: 2, lineage_ref: 12, institution_id: 7, canonical_fee_key: "overdraft", fee_name: "Overdraft Transfer Fee (Sweep)", amount: "7.50" },
  { fee_published_id: 3, lineage_ref: 13, institution_id: 8, canonical_fee_key: "monthly_maintenance", fee_name: "Monthly fee, if the balance falls below", amount: "2500.00" },
  { fee_published_id: 4, lineage_ref: 14, institution_id: 8, canonical_fee_key: "atm_non_network", fee_name: "You may withdraw up to", amount: "500.00" },
];

// Rows 2 and 4 failed their first look 13 hours ago, on another run.
const firstLooks = [2, 4].map((id) => ({
  fee_published_id: id,
  kind: "takedown_pending",
  evidence: { flag_run_id: 1, flagged_at: new Date(Date.now() - 13 * 3_600_000).toISOString(), reason: "name" },
}));

function createDbMock(flags: unknown[] = firstLooks, takenDown: unknown[] = []) {
  return vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = templateText(strings);
    if (text.includes("to_regclass('public.pipeline_feedback')")) return Promise.resolve([{ ready: true }]);
    if (text.includes("FROM pipeline_feedback")) return Promise.resolve(flags);
    if (text.includes("rolled_back_at IS NOT NULL")) return Promise.resolve(takenDown);
    if (text.includes("UPDATE published_fee_records") && text.includes("rolled_back_at = NULL")) {
      return Promise.resolve((values[0] as number[]).map((id, i) => ({ fee_published_id: id, lineage_ref: id + 10, canonical_fee_key: (values[1] as string[])[i] })));
    }
    if (text.includes("FROM published_fee_records")) return Promise.resolve(liveRows);
    if (text.includes("UPDATE published_fee_records")) {
      return Promise.resolve((values[1] as number[]).map((id) => ({ fee_published_id: id })));
    }
    if (text.includes("UPDATE verified_fee_observations")) {
      return Promise.resolve((values[0] as number[]).map((id) => ({ fee_verified_id: id })));
    }
    return Promise.resolve([]);
  });
}

type GuardDb = NonNullable<Parameters<typeof runHamiltonCategoryGuard>[0]["db"]>;

describe("Hamilton category guard repair", () => {
  it("reports failing live rows on a dry run without writing", async () => {
    const db = createDbMock();

    const result = await runHamiltonCategoryGuard({ runId: 9, dryRun: true, db: db as unknown as GuardDb });

    expect(result).toMatchObject({
      scannedFees: 4,
      failingFees: 2,
      rolledBackFees: 0,
      rejectedVerifiedFees: 0,
      dryRun: true,
      byCode: { name_contradicts: 1, name_unsupported: 1 },
    });
    // Row 3 names its category; its implausible amount is the outlier rollback's job.
    expect(result.failures.map((failure) => failure.feePublishedId)).toEqual([2, 4]);
    const statements = db.mock.calls.map((call) => templateText(call[0])).join("\n");
    expect(statements).not.toContain("UPDATE");
    expect(statements).not.toContain("INSERT");
  });

  it("soft-deletes failing rows and rejects their verified rows", async () => {
    const db = createDbMock();

    const result = await runHamiltonCategoryGuard({ runId: 10, db: db as unknown as GuardDb });

    expect(result).toMatchObject({ failingFees: 2, rolledBackFees: 2, rejectedVerifiedFees: 2 });
    const statements = db.mock.calls.map((call) => templateText(call[0])).join("\n");
    expect(statements).toContain("SET rolled_back_at = NOW()");
    expect(statements).toContain("review_status = 'rejected'");
    expect(statements).not.toContain("DELETE");
    expect(JSON.stringify(db.mock.calls)).toContain("category-guard-run-10");
  });

  it("takes nothing down on a first failure: it logs both fees for a second look", async () => {
    const db = createDbMock([]);

    const result = await runHamiltonCategoryGuard({ runId: 12, db: db as unknown as GuardDb });

    expect(result).toMatchObject({ failingFees: 0, rolledBackFees: 0, flaggedFees: 2 });
    const statements = db.mock.calls.map((call) => templateText(call[0])).join("\n");
    expect(statements).toContain("INSERT INTO pipeline_feedback");
    expect(statements).not.toContain("SET rolled_back_at = NOW()");
  });

  it("brings back an earlier takedown today's guard passes", async () => {
    const db = createDbMock([], [
      { fee_published_id: 21, lineage_ref: 31, canonical_fee_key: "card_replacement", fee_name: "Visa Check Card Replacement", amount: "10.00", conditions: null },
      { fee_published_id: 22, lineage_ref: 32, canonical_fee_key: "atm_non_network", fee_name: "ATM Limit Adjustment", amount: "5.00", conditions: null },
    ]);

    const result = await runHamiltonCategoryGuard({ runId: 13, db: db as unknown as GuardDb });

    expect(result.restoredFees).toBe(1);
    const restore = db.mock.calls.find((call) => templateText(call[0]).includes("rolled_back_at = NULL"));
    expect(restore?.[1]).toEqual([21]);
  });

  it("brings back an ATM adjustment the guard took down under the type its fold split gives it, logged as a fold", async () => {
    const db = createDbMock([], [
      { fee_published_id: 45585, lineage_ref: 36992, institution_id: 6182, source_document_id: 9, canonical_fee_key: "atm_non_network", fee_name: "ATM Adjustment", amount: "2.00", conditions: null },
    ]);

    const result = await runHamiltonCategoryGuard({ runId: 14, db: db as unknown as GuardDb });

    expect(result).toMatchObject({ restoredFees: 1, refiledFees: 1 });
    const restore = db.mock.calls.find((call) => templateText(call[0]).includes("rolled_back_at = NULL"));
    expect([restore?.[1], restore?.[2]]).toEqual([[45585], ["account_research"]]);
    const statements = db.mock.calls.map((call) => templateText(call[0])).join("\n");
    expect(statements).toContain("INSERT INTO pipeline_feedback");
    expect(statements).not.toContain("DELETE");
  });

  it("keeps a takedown down when neither its own type nor a split or re-file type accepts it", () => {
    const row = { conditions: null, document_nsf_amount: null };
    expect(restoreTarget({ ...row, canonical_fee_key: "atm_non_network", fee_name: "ATM Adjustment Fee", amount: "5.00" })).toBe("account_research");
    expect(restoreTarget({ ...row, canonical_fee_key: "atm_non_network", fee_name: "ATM Limit Adjustment", amount: "5.00" })).toBeNull();
    // The guard's own re-file rule is a home too: a sweep transfer is the OD protection transfer.
    expect(restoreTarget({ ...row, canonical_fee_key: "overdraft", fee_name: "Overdraft Transfer Fee (Sweep)", amount: "7.50" })).toBe("od_protection_transfer");
    expect(restoreTarget({ ...row, canonical_fee_key: "card_replacement", fee_name: "Visa Check Card Replacement", amount: "10.00" })).toBe("card_replacement");
  });

  it("brings an express card replacement back as the rush card fee, once per institution and price", async () => {
    const row = { conditions: null, document_nsf_amount: null };
    expect(restoreTarget({ ...row, canonical_fee_key: "card_replacement", fee_name: "Express Replacement Card", amount: "25.00" })).toBe("rush_card");
    expect(restoreTarget({ ...row, canonical_fee_key: "card_replacement", fee_name: "Replacement Debit Card Two Day Delivery", amount: "20.00" })).toBe("rush_card");
    const db = createDbMock([], [
      { fee_published_id: 350, lineage_ref: 1350, institution_id: 6042, source_document_id: 2536, canonical_fee_key: "card_replacement", fee_name: "Replacement Card - Express Mail", amount: "40.00", conditions: null },
      { fee_published_id: 27687, lineage_ref: 1687, institution_id: 6042, source_document_id: 15325, canonical_fee_key: "card_replacement", fee_name: "Replacement Card Shipped via Express Mail", amount: "40.00", conditions: null },
    ]);

    await runHamiltonCategoryGuard({ runId: 15, db: db as unknown as GuardDb });

    const restore = db.mock.calls.find((call) => templateText(call[0]).includes("rolled_back_at = NULL"));
    expect([restore?.[1], restore?.[2]]).toEqual([[350], ["rush_card"]]);
    expect(templateText(restore?.[0])).toContain("v.to_key <> fp.canonical_fee_key");
  });

  it("caps the rollbacks at the run limit", async () => {
    const db = createDbMock();

    const result = await runHamiltonCategoryGuard({ runId: 11, limit: 1, db: db as unknown as GuardDb });

    expect(result).toMatchObject({ failingFees: 2, rolledBackFees: 1 });
  });

  it("flags a small returned check filed as NSF beside the schedule's own NSF fee", async () => {
    const dean = { fee_published_id: 5, lineage_ref: 15, institution_id: 9, canonical_fee_key: "nsf", fee_name: "Returned Check Fee", amount: "7.00", document_nsf_amount: "35.00" };
    const db = vi.fn((strings: TemplateStringsArray) => {
      const text = templateText(strings);
      if (text.includes("to_regclass('public.pipeline_feedback')")) return Promise.resolve([{ ready: true }]);
      if (text.includes("FROM published_fee_records") && !text.includes("rolled_back_at IS NOT NULL")) return Promise.resolve([dean]);
      return Promise.resolve([]);
    });

    const result = await runHamiltonCategoryGuard({ runId: 9, dryRun: true, db: db as unknown as GuardDb });

    // First failure: logged for a second look, still live.
    expect(result).toMatchObject({ scannedFees: 1, flaggedFees: 1, rolledBackFees: 0, byCode: { schedule_contradicts: 1 } });
  });
});
