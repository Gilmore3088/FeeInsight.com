import { describe, expect, it, vi } from "vitest";

import { runHamiltonCategoryGuard } from "./category-guard";

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

const liveRows = [
  { fee_published_id: 1, lineage_ref: 11, institution_id: 7, canonical_fee_key: "overdraft", fee_name: "Overdraft Fee", amount: "35.00" },
  { fee_published_id: 2, lineage_ref: 12, institution_id: 7, canonical_fee_key: "overdraft", fee_name: "Overdraft Transfer Fee (Sweep)", amount: "7.50" },
  { fee_published_id: 3, lineage_ref: 13, institution_id: 8, canonical_fee_key: "monthly_maintenance", fee_name: "Monthly fee, if the balance falls below", amount: "2500.00" },
  { fee_published_id: 4, lineage_ref: 14, institution_id: 8, canonical_fee_key: "atm_non_network", fee_name: "You may withdraw up to", amount: "500.00" },
];

function createDbMock() {
  return vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = templateText(strings);
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
      failingFees: 3,
      rolledBackFees: 0,
      rejectedVerifiedFees: 0,
      dryRun: true,
      byCode: { name_contradicts: 1, amount_out_of_range: 1, name_unsupported: 1 },
    });
    expect(result.failures.map((failure) => failure.feePublishedId)).toEqual([2, 3, 4]);
    const statements = db.mock.calls.map((call) => templateText(call[0])).join("\n");
    expect(statements).not.toContain("UPDATE");
    expect(statements).not.toContain("INSERT");
  });

  it("soft-deletes failing rows and rejects their verified rows", async () => {
    const db = createDbMock();

    const result = await runHamiltonCategoryGuard({ runId: 10, db: db as unknown as GuardDb });

    expect(result).toMatchObject({ failingFees: 3, rolledBackFees: 3, rejectedVerifiedFees: 3 });
    const statements = db.mock.calls.map((call) => templateText(call[0])).join("\n");
    expect(statements).toContain("SET rolled_back_at = NOW()");
    expect(statements).toContain("review_status = 'rejected'");
    expect(statements).not.toContain("DELETE");
    expect(JSON.stringify(db.mock.calls)).toContain("category-guard-run-10");
  });

  it("caps the rollbacks at the run limit", async () => {
    const db = createDbMock();

    const result = await runHamiltonCategoryGuard({ runId: 11, limit: 1, db: db as unknown as GuardDb });

    expect(result).toMatchObject({ failingFees: 3, rolledBackFees: 1 });
  });
});
