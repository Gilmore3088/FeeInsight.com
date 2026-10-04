import { describe, expect, it, vi } from "vitest";

import { runHamiltonPublish } from "./publish";

type DbMock = ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

function createDbMock(
  rows: Array<Record<string, unknown>>,
  priorPublishedRows: Array<Record<string, unknown>> = [],
): DbMock {
  let nextPublishedId = 1201;
  const db = vi.fn((strings: TemplateStringsArray) => {
    const text = templateText(strings);
    if (text.includes("INSERT INTO published_fee_records")) {
      return Promise.resolve([{ fee_published_id: nextPublishedId++ }]);
    }
    if (text.includes("FROM published_fee_records")) {
      return Promise.resolve(priorPublishedRows);
    }
    return Promise.resolve([]);
  }) as DbMock;
  db.unsafe = vi.fn((query: string) => {
    if (query.includes("FROM verified_fee_observations")) return Promise.resolve(rows);
    return Promise.resolve([]);
  });
  return db;
}

function asPublishDb(db: DbMock): NonNullable<Parameters<typeof runHamiltonPublish>[0]["db"]> {
  return db as unknown as NonNullable<Parameters<typeof runHamiltonPublish>[0]["db"]>;
}

const verifiedFee = {
  fee_verified_id: 801,
  fee_raw_id: 701,
  institution_id: 42,
  source_url: "https://testbank.example/fees",
  document_r2_key: null,
  extraction_confidence: "0.9200",
  canonical_fee_key: "overdraft",
  variant_type: null,
  outlier_flags: ["agentic_darwin_verified"],
  verified_by_agent_event_id: "00000000-0000-4000-8000-000000000801",
  fee_name: "Overdraft fee",
  amount: "35.00",
  frequency: "per_item",
  raw_agent_event_id: "00000000-0000-4000-8000-000000000701",
};

const priorPublishedFee = {
  fee_published_id: 601,
  amount: "30.00",
  fee_name: "Overdraft fee",
  published_at: "2026-07-01T00:00:00.000Z",
};

describe("Hamilton agentic publish", () => {
  it("rejects verified rows filed under the wrong category instead of publishing them", async () => {
    const db = createDbMock([
      { ...verifiedFee, fee_name: "Continuous Overdraft Fee (per day)", amount: "3.00" },
    ]);

    const result = await runHamiltonPublish({ runId: 105, db: asPublishDb(db) });

    expect(result.publishedFees).toBe(0);
    expect(result.results[0]).toMatchObject({
      status: "skipped",
      reason: expect.stringContaining("Category guard (name_contradicts)"),
    });
    const writes = db.mock.calls.map((call) => templateText(call[0])).join("\n");
    expect(writes).not.toContain("INSERT INTO published_fee_records");
    expect(writes).toContain("UPDATE verified_fee_observations");
    expect(JSON.stringify(db.mock.calls)).toContain("category_guard:name_contradicts");
  });

  it("only reports category rejections on a dry run", async () => {
    const db = createDbMock([{ ...verifiedFee, fee_name: "Stop Payment Fee" }]);

    const result = await runHamiltonPublish({ runId: 106, dryRun: true, db: asPublishDb(db) });

    expect(result.results[0]).toMatchObject({
      status: "skipped",
      reason: expect.stringContaining("Category guard (name_unsupported)"),
    });
    expect(db).not.toHaveBeenCalled();
  });

  it("publishes eligible Darwin-verified rows to published_fee_records", async () => {
    const db = createDbMock([verifiedFee]);

    const result = await runHamiltonPublish({
      runId: 101,
      limit: 500,
      db: asPublishDb(db),
    });

    expect(result).toMatchObject({
      selectedVerifiedFees: 1,
      processedVerifiedFees: 1,
      publishedFees: 1,
      skippedFees: 0,
      limit: 500,
      minConfidence: 0.8,
      dryRun: false,
      batchId: "agentic-run-101",
    });
    expect(result.results[0]).toMatchObject({
      feeVerifiedId: 801,
      institutionId: 42,
      canonicalFeeKey: "overdraft",
      status: "published",
      feePublishedId: 1201,
    });

    const unsafeSql = db.unsafe.mock.calls.map((call) => String(call[0])).join("\n");
    expect(unsafeSql).toContain("FROM verified_fee_observations");
    expect(unsafeSql).toContain("JOIN raw_fee_observations");
    expect(unsafeSql).toContain("NOT EXISTS");
    expect(unsafeSql).toContain("published_fee_records");

    const insertSql = db.mock.calls.map((call) => templateText(call[0])).join("\n");
    expect(insertSql).toContain("INSERT INTO published_fee_records");
    expect(insertSql).toContain("INSERT INTO hamilton_signals");
    expect(insertSql).toContain("batch_id");
    expect(insertSql).toContain("ON CONFLICT DO NOTHING");
    expect(insertSql).not.toContain("promote_to_tier3");
    expect(insertSql).not.toContain("agent_events");
    expect(JSON.stringify(db.mock.calls)).toContain("hamilton_publication_completed");
    expect(JSON.stringify(db.mock.calls)).toContain("published_public_ready");
    expect(JSON.stringify(db.mock.calls)).toContain("refresh_recommended");
  });

  it("emits a fee movement signal when a published amount changes from the prior live catalog row", async () => {
    const db = createDbMock([verifiedFee], [priorPublishedFee]);

    const result = await runHamiltonPublish({
      runId: 106,
      db: asPublishDb(db),
    });

    expect(result.publishedFees).toBe(1);
    expect(result.results[0]).toMatchObject({
      previousFeePublishedId: 601,
      previousAmount: 30,
      amountDelta: 5,
      movementDirection: "increase",
    });

    const selectSql = db.mock.calls.map((call) => templateText(call[0])).join("\n");
    expect(selectSql).toContain("FROM published_fee_records");
    expect(selectSql).toContain("COALESCE(variant_type");
    expect(selectSql).toContain("COALESCE(frequency");
    expect(selectSql).toContain("rolled_back_at IS NULL");

    const callsJson = JSON.stringify(db.mock.calls);
    expect(callsJson).toContain("hamilton_publication_completed");
    expect(callsJson).toContain("hamilton_fee_movement_detected");
    expect(callsJson).toContain("published_fee_movement");
    expect(callsJson).toContain("amount_delta");
    expect(callsJson).toContain(":5");
  });

  it("skips re-verified rows whose content is already live in the catalog", async () => {
    const db = createDbMock([verifiedFee], [{ ...priorPublishedFee, amount: "35.00" }]);

    const result = await runHamiltonPublish({
      runId: 107,
      db: asPublishDb(db),
    });

    expect(result.publishedFees).toBe(0);
    expect(result.skippedFees).toBe(1);
    expect(result.results[0]).toMatchObject({
      status: "skipped",
      reason: "Identical fee already published",
      feePublishedId: null,
      previousFeePublishedId: 601,
      previousAmount: 35,
    });

    const insertSql = db.mock.calls.map((call) => templateText(call[0])).join("\n");
    expect(insertSql).not.toContain("INSERT INTO published_fee_records");
  });

  it("keeps dry runs read-only while still reporting publishable rows", async () => {
    const db = createDbMock([verifiedFee]);

    const result = await runHamiltonPublish({
      runId: 102,
      dryRun: true,
      db: asPublishDb(db),
    });

    expect(result.publishedFees).toBe(1);
    expect(result.results[0]).toMatchObject({ status: "published", feePublishedId: null });
    expect(db.unsafe).toHaveBeenCalledTimes(1);
    expect(db).not.toHaveBeenCalled();
  });

  it("skips rows below the publish confidence threshold", async () => {
    const db = createDbMock([
      {
        ...verifiedFee,
        extraction_confidence: "0.7100",
      },
    ]);

    const result = await runHamiltonPublish({
      runId: 103,
      db: asPublishDb(db),
    });

    expect(result).toMatchObject({
      selectedVerifiedFees: 1,
      processedVerifiedFees: 1,
      publishedFees: 0,
      skippedFees: 1,
    });
    expect(result.results[0]).toMatchObject({
      status: "skipped",
      reason: "Below publish confidence threshold",
    });
    expect(db).not.toHaveBeenCalled();
  });

  it("skips rows with blocking review flags", async () => {
    const db = createDbMock([
      {
        ...verifiedFee,
        outlier_flags: ["agentic_darwin_verified", "needs_human"],
      },
    ]);

    const result = await runHamiltonPublish({
      runId: 104,
      db: asPublishDb(db),
    });

    expect(result.publishedFees).toBe(0);
    expect(result.skippedFees).toBe(1);
    expect(result.results[0].reason).toBe("Blocking flag: needs_human");
    expect(db).not.toHaveBeenCalled();
  });

  it("filters publish candidates by state lane", async () => {
    const db = createDbMock([]);

    await runHamiltonPublish({
      runId: 105,
      stateCode: "CA",
      db: asPublishDb(db),
    });

    const unsafeSql = db.unsafe.mock.calls.map((call) => String(call[0])).join("\n");
    expect(unsafeSql).toContain("JOIN institution_sources inst ON inst.id = fv.institution_id");
    expect(unsafeSql).toContain("upper(btrim(inst.state_code))");
  });
});
