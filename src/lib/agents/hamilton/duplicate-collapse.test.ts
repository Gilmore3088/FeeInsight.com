import { describe, expect, it, vi } from "vitest";

import { collapsePublishedDuplicates } from "./duplicate-collapse";

type DbMock = ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };

function createDbMock(rows: Array<Record<string, unknown>>): DbMock {
  const db = vi.fn(() => Promise.resolve([])) as DbMock;
  db.unsafe = vi.fn(() => Promise.resolve(rows));
  return db;
}

function asDb(db: DbMock): Parameters<typeof collapsePublishedDuplicates>[0] {
  return db as unknown as Parameters<typeof collapsePublishedDuplicates>[0];
}

const duplicate = {
  fee_published_id: 501,
  kept_fee_published_id: 777,
  institution_id: 42,
  canonical_fee_key: "overdraft",
  fee_name: "Overdraft fee",
  amount: "35.00",
};

describe("Hamilton duplicate collapse", () => {
  it("closes exact repeats of a live row, keeping the newest, and logs a run event", async () => {
    const db = createDbMock([duplicate]);

    const collapsed = await collapsePublishedDuplicates(asDb(db), {
      runId: 120,
      batchId: "agentic-run-120",
      dryRun: false,
    });

    expect(collapsed).toEqual([
      {
        feePublishedId: 501,
        keptFeePublishedId: 777,
        institutionId: 42,
        canonicalFeeKey: "overdraft",
        feeName: "Overdraft fee",
        amount: 35,
      },
    ]);
    const [query, params] = db.unsafe.mock.calls[0] as [string, unknown[]];
    expect(query).toContain("UPDATE published_fee_records fp");
    expect(query).toContain("rolled_back_at IS NULL");
    expect(query).toContain("PARTITION BY fp.institution_id");
    expect(query).toContain("lower(btrim(fp.fee_name))");
    // A copy with a stated frequency is kept over one without, then the newest.
    expect(query).toContain("ORDER BY (fp.frequency IS NULL), fp.published_at DESC, fp.fee_published_id DESC");
    // Frequency is not part of the line: "per item", "per occurrence" and unstated are one fee,
    // while two different stated frequencies keep both rows.
    expect(query).not.toContain("COALESCE(fp.frequency, '')");
    expect(query).toContain("WHEN fp.frequency IN ('per_item', 'per_occurrence', 'per_transaction', 'one_time') THEN 'each'");
    expect(query).toContain("ranked.min_class IS NULL OR ranked.min_class = ranked.max_class");
    expect(query).toContain("'duplicate of #' || dup.kept_fee_published_id::text");
    expect(params).toEqual([500, "agentic-run-120"]);
    expect(JSON.stringify(db.mock.calls)).toContain("hamilton.duplicates_collapsed");
  });

  it("reports duplicates in a dry run without writing", async () => {
    const db = createDbMock([duplicate]);

    const collapsed = await collapsePublishedDuplicates(asDb(db), {
      runId: 121,
      batchId: "agentic-run-121",
      dryRun: true,
      institutionId: 42,
    });

    expect(collapsed).toHaveLength(1);
    const [query, params] = db.unsafe.mock.calls[0] as [string, unknown[]];
    expect(query).not.toContain("UPDATE");
    expect(query).toContain("fp.institution_id = $2");
    expect(params).toEqual([500, 42]);
    expect(db).not.toHaveBeenCalled();
  });

  it("never fails the publish step when the sweep fails", async () => {
    const db = createDbMock([]);
    db.unsafe.mockRejectedValueOnce(new Error("boom"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      collapsePublishedDuplicates(asDb(db), { runId: 122, batchId: "agentic-run-122", dryRun: false }),
    ).resolves.toEqual([]);
    error.mockRestore();
  });
});
