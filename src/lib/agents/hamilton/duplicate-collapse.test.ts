import { describe, expect, it, vi } from "vitest";

import { collapseNearNameDuplicates, collapsePublishedDuplicates, NEAR_NAME_COLLAPSE_LIVE } from "./duplicate-collapse";

type DbMock = ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };

function createDbMock(rows: Array<Record<string, unknown>>): DbMock {
  const db = vi.fn((strings:TemplateStringsArray) => Promise.resolve(strings.join(" ").includes("UPDATE published_fee_records") ? rows : [])) as DbMock;
  db.unsafe = vi.fn((query:string) => Promise.resolve(query.startsWith("SELECT fp.fee_published_id, to_jsonb")
    ? rows.flatMap((r) => r.keeper ? [r,r.keeper] : [r]) : rows));
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
  published_state:"target",identity_raw_id:null,identity_product:"",
  keeper:{fee_published_id:777,published_state:"keeper",identity_raw_id:null,identity_product:""},
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
    expect(JSON.stringify(db.mock.calls)).toContain("UPDATE published_fee_records fp");
    expect(query).toContain("rolled_back_at IS NULL");
    expect(query).toContain("PARTITION BY fp.institution_id");
    expect(query).toContain("lower(btrim(fp.fee_name))");
    // A copy with a stated frequency is kept over one without, then the newest.
    expect(query).toContain("COALESCE(fp.fee_audience, 'unknown')");
    expect(query).toContain("ORDER BY (fp.frequency IS NULL), fp.published_at DESC, fp.fee_published_id DESC");
    expect(query).toContain("fp.quarantined_at IS NULL");
    // Frequency is not part of the line: "per item", "per occurrence" and unstated are one fee,
    // while two different stated frequencies keep both rows.
    expect(query).not.toContain("COALESCE(fp.frequency, '')");
    expect(query).toContain("WHEN fp.frequency IN ('per_item', 'per_occurrence', 'per_transaction', 'one_time') THEN 'each'");
    expect(query).toContain("ranked.min_class IS NULL OR ranked.min_class = ranked.max_class");
    expect(JSON.stringify(db.mock.calls)).toContain("rolled_back_reason");
    expect(params).toEqual([500]);
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

  it("near-name collapse: shadow by default writes nothing; switched on, closes the one-line read (#1302)", async () => {
    const text = "Account History fee | $2.00 each\nAccount Research fee | $25.00 per hour / 1-hour minimum";
    const rows = [
      { fee_published_id: 79471, fee_name: "Research fee", published_at: "2026-10-07T08:46:25Z" },
      { fee_published_id: 138008, fee_name: "Account Research fee", published_at: "2026-10-12T00:10:36Z" },
    ].map((row) => ({ ...row, institution_id: 5103, source_document_id: 13385, canonical_fee_key: "account_research", variant_type: null, amount: "25.00", frequency: null, fee_audience: "unknown" }));
    const run = (live?: boolean) => {
      const db = createDbMock(rows);
      db.mockImplementation((strings: TemplateStringsArray) =>
        Promise.resolve(strings.join("").includes("agent_source_texts") ? [{ source_document_id: 13385, normalized_text: text }] : strings.join("").includes("UPDATE") ? [{ fee_published_id: 79471 }] : []),
      );
      return { db, result: collapseNearNameDuplicates(asDb(db), { runId: 130, batchId: "agentic-run-130", dryRun: false, live }) };
    };

    expect(NEAR_NAME_COLLAPSE_LIVE).toBe(true);
    const shadow = run(false);
    const reported = await shadow.result;
    expect(reported).toMatchObject({ live: false, documents: 1, pairs: 1, apartOnPage: 0 });
    expect(reported.collapses.map((row) => [row.feePublishedId, row.keptFeePublishedId])).toEqual([[79471, 138008]]);
    expect(JSON.stringify(shadow.db.mock.calls)).not.toContain("UPDATE");

    const switchedOn = run(true);
    const closed = await switchedOn.result;
    expect(closed.collapses).toHaveLength(1);
    const calls = JSON.stringify(switchedOn.db.mock.calls);
    expect(calls).toContain("UPDATE published_fee_records");
    expect(calls).toContain("hamilton.near_name_duplicates_collapsed");
  });
});
