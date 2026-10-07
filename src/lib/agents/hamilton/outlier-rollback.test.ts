import { describe, expect, it, vi } from "vitest";

import { amountEnvelopesJson, outlierReason, restoreOutliersNowInRange, rollBackPublishedOutliers } from "./outlier-rollback";
import { CANONICAL_KEY_MAP } from "@/lib/fee-taxonomy";

type DbMock = ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };

function createDbMock(rows: Array<Record<string, unknown>>): DbMock {
  const db = vi.fn(() => Promise.resolve([])) as DbMock;
  db.unsafe = vi.fn(() => Promise.resolve(rows));
  return db;
}

function asDb(db: DbMock): Parameters<typeof rollBackPublishedOutliers>[0] {
  return db as unknown as Parameters<typeof rollBackPublishedOutliers>[0];
}

const outlier = {
  fee_published_id: 9001,
  institution_id: 42,
  canonical_fee_key: "monthly_maintenance",
  fee_name: "Monthly service charge",
  amount: "1500.00",
};

describe("Hamilton outlier rollback", () => {
  it("serializes a Darwin range for every canonical key", () => {
    const parsed = JSON.parse(amountEnvelopesJson()) as Record<string, { min: number; max: number }>;
    expect(Object.keys(parsed).length).toBe(new Set(Object.values(CANONICAL_KEY_MAP)).size);
    expect(parsed.monthly_maintenance).toEqual({ min: 1, max: 50 });
  });

  it("explains which side of the range an amount fell on", () => {
    expect(outlierReason("monthly_maintenance", 1500)).toBe(
      "Amount $1,500 is above the monthly_maintenance range ($1-$50)",
    );
    expect(outlierReason("wire_intl_outgoing", 2)).toContain("below");
  });

  it("rolls back live out-of-range rows with a reason and batch id, and logs a run event", async () => {
    const db = createDbMock([outlier]);

    const rollbacks = await rollBackPublishedOutliers(asDb(db), {
      runId: 111,
      batchId: "agentic-run-111",
      dryRun: false,
    });

    expect(rollbacks).toEqual([
      {
        feePublishedId: 9001,
        institutionId: 42,
        canonicalFeeKey: "monthly_maintenance",
        feeName: "Monthly service charge",
        amount: 1500,
        reason: "Amount $1,500 is above the monthly_maintenance range ($1-$50)",
      },
    ]);
    const [query, params] = db.unsafe.mock.calls[0] as [string, unknown[]];
    expect(query).toContain("UPDATE published_fee_records");
    expect(query).toContain("SET rolled_back_at = NOW()");
    expect(query).toContain("rolled_back_reason = 'amount_outside_category_range'");
    expect(query).toContain("fp.rolled_back_at IS NULL");
    expect(query).toContain("fp.amount > 0");
    expect(params[params.length - 1]).toBe("agentic-run-111");
    expect(JSON.stringify(db.mock.calls)).toContain("hamilton.outliers_rolled_back");
  });

  it("only reads in a dry run", async () => {
    const db = createDbMock([outlier]);

    const rollbacks = await rollBackPublishedOutliers(asDb(db), {
      runId: 112,
      batchId: "agentic-run-112",
      dryRun: true,
    });

    expect(rollbacks).toHaveLength(1);
    expect(String(db.unsafe.mock.calls[0][0])).not.toContain("UPDATE");
    expect(db).not.toHaveBeenCalled();
  });

  it("scopes the sweep to one institution when asked", async () => {
    const db = createDbMock([]);

    await rollBackPublishedOutliers(asDb(db), {
      runId: 113,
      batchId: "agentic-run-113",
      dryRun: false,
      institutionId: 42,
    });

    const [query, params] = db.unsafe.mock.calls[0] as [string, unknown[]];
    expect(query).toContain("fp.institution_id = $3");
    expect(params[2]).toBe(42);
    expect(params[3]).toBe("agentic-run-113");
    expect(db).not.toHaveBeenCalled();
  });

  it("never fails the publish when the sweep errors", async () => {
    const db = createDbMock([]);
    db.unsafe = vi.fn(() => Promise.reject(new Error("boom")));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      rollBackPublishedOutliers(asDb(db), { runId: 114, batchId: "agentic-run-114", dryRun: false }),
    ).resolves.toEqual([]);
    spy.mockRestore();
  });

  it("restores an earlier outlier takedown now inside its range, never over a live copy", async () => {
    const db = createDbMock([{ ...outlier, amount: "25.00" }]);

    const restores = await restoreOutliersNowInRange(asDb(db), { runId: 8, dryRun: false });

    expect(restores.map((fee) => fee.feePublishedId)).toEqual([9001]);
    const [query, params] = db.unsafe.mock.calls[0] as [string, unknown[]];
    expect(query).toContain("SET rolled_back_at = NULL");
    expect(query).toContain("rolled_back_at IS NOT NULL");
    expect(query).toContain("NOT EXISTS");
    expect(params[2]).toBe("amount_outside_category_range");
    expect(JSON.stringify(db.mock.calls)).toContain("hamilton.outliers_restored");
  });

  it("only reads when restoring in a dry run", async () => {
    const db = createDbMock([{ ...outlier, amount: "25.00" }]);

    await restoreOutliersNowInRange(asDb(db), { runId: 8, dryRun: true });

    expect((db.unsafe.mock.calls[0] as [string])[0]).not.toContain("UPDATE");
    expect(db).not.toHaveBeenCalled();
  });
});
