import { describe, expect, it, vi } from "vitest";

import { decidePriorFee, HAMILTON_PUBLISH_STRATEGY, runHamiltonPublish } from "./publish";

type DbMock = ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

/** Three live catalog fees per institution, so the fee minimum passes by default. */
function deepInstitutionRows(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const ids = Array.from(new Set(rows.map((row) => row.institution_id)));
  return ids.flatMap((institution_id) =>
    ["monthly_maintenance", "nsf", "wire_domestic_outgoing"].map((canonical_fee_key) => ({
      depth_source: "published",
      institution_id,
      canonical_fee_key,
    })),
  );
}

function createDbMock(
  rows: Array<Record<string, unknown>>,
  priorPublishedRows: Array<Record<string, unknown>> = [],
  depthRows: Array<Record<string, unknown>> = deepInstitutionRows(rows),
): DbMock {
  let nextPublishedId = 1201;
  const db = vi.fn((strings: TemplateStringsArray) => {
    const text = templateText(strings);
    if (text.includes("INSERT INTO published_fee_records")) {
      return Promise.resolve([{ fee_published_id: nextPublishedId++ }]);
    }
    if (text.includes("UPDATE published_fee_records")) {
      return Promise.resolve(priorPublishedRows.slice(0, 1).map((row) => ({ fee_published_id: row.fee_published_id })));
    }
    if (text.includes("FROM published_fee_records")) {
      return Promise.resolve(priorPublishedRows);
    }
    return Promise.resolve([]);
  }) as DbMock;
  db.unsafe = vi.fn((query: string) => {
    if (query.includes("institution_fee_depth")) return Promise.resolve(depthRows);
    if (query.includes("FROM verified_fee_observations")) return Promise.resolve(rows);
    return Promise.resolve([]);
  });
  return db;
}

/** Statements that change data: inserts and updates, signals excluded. */
function writes(db: DbMock): string[] {
  return db.mock.calls
    .map((call) => templateText(call[0]))
    .filter((text) => /INSERT INTO|UPDATE /.test(text) && !text.includes("hamilton_signals"));
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
  source_document_id: 77,
  document_crawled_at: "2026-10-01T00:00:00.000Z",
};

const priorPublishedFee = {
  fee_published_id: 601,
  amount: "30.00",
  fee_name: "Overdraft fee",
  published_at: "2026-07-01T00:00:00.000Z",
  source_document_id: 12,
  document_crawled_at: "2026-07-01T00:00:00.000Z",
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
    expect(selectSql).toContain("COALESCE(fp.variant_type");
    expect(selectSql).toContain("COALESCE(fp.frequency");
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
    expect(db.unsafe).toHaveBeenCalledTimes(2);
    expect(writes(db)).toEqual([]);
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
    expect(writes(db)).toEqual([]);
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
    expect(writes(db)).toEqual([]);
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

  it("closes the prior live row and records the change when an amount moves", async () => {
    const db = createDbMock([verifiedFee], [priorPublishedFee]);

    const result = await runHamiltonPublish({ runId: 108, db: asPublishDb(db) });

    expect(result).toMatchObject({ publishedFees: 1, supersededFees: 1 });
    expect(result.results[0]).toMatchObject({
      feePublishedId: 1201,
      supersededFeePublishedId: 601,
      changeRecorded: true,
    });

    const update = db.mock.calls.find((call) => templateText(call[0]).includes("UPDATE published_fee_records"));
    expect(templateText(update?.[0])).toContain("rolled_back_at = NOW()");
    expect(templateText(update?.[0])).toContain("rolled_back_at IS NULL");
    expect(update?.slice(1)).toEqual(expect.arrayContaining(["agentic-run-108", "superseded by #1201", 601]));

    const change = db.mock.calls.find((call) => templateText(call[0]).includes("INSERT INTO fee_change_records"));
    expect(change?.slice(1)).toEqual(expect.arrayContaining([42, "overdraft", 30, 35, "increase"]));
  });

  it("publishes a second price from the same document as its own fee line", async () => {
    const sameDocumentPrior = { ...priorPublishedFee, fee_name: "Stop payment (ACH)", source_document_id: 77 };
    const db = createDbMock([{ ...verifiedFee, source_document_id: 77 }], [sameDocumentPrior]);

    const result = await runHamiltonPublish({ runId: 111, db: asPublishDb(db) });

    expect(result).toMatchObject({ publishedFees: 1, supersededFees: 0 });
    expect(result.results[0]).toMatchObject({
      status: "published",
      supersededFeePublishedId: null,
      movementDirection: null,
      changeRecorded: false,
    });
    const text = writes(db).join("\n");
    expect(text).not.toContain("UPDATE published_fee_records");
    expect(text).not.toContain("INSERT INTO fee_change_records");
  });

  it("runs insert and supersede inside a savepoint when given a transaction", async () => {
    const db = createDbMock([verifiedFee], [priorPublishedFee]);
    const savepoint = vi.fn((work: (scope: unknown) => Promise<unknown>) => work(db));
    Object.assign(db, { savepoint });

    await runHamiltonPublish({ runId: 109, db: asPublishDb(db) });

    // Prior-row read, insert + supersede, change record, and each signal.
    expect(savepoint.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("reports the supersede in a dry run without writing", async () => {
    const db = createDbMock([verifiedFee], [priorPublishedFee]);

    const result = await runHamiltonPublish({ runId: 110, dryRun: true, db: asPublishDb(db) });

    expect(result.results[0]).toMatchObject({
      status: "published",
      feePublishedId: null,
      supersededFeePublishedId: 601,
      movementDirection: "increase",
    });
    expect(writes(db)).toEqual([]);
  });

  it("publishes a free fee Darwin verified as $0", async () => {
    const db = createDbMock([
      { ...verifiedFee, canonical_fee_key: "paper_statement", fee_name: "Paper Statement", amount: "0.00", outlier_flags: ["agentic_darwin_verified", "zero_fee"] },
    ]);

    const result = await runHamiltonPublish({ runId: 111, db: asPublishDb(db) });

    expect(result).toMatchObject({ publishedFees: 1, zeroFeesPublished: 1 });
  });

  it("does not publish $0 without the free-fee flag, or an amount outside its category's range", async () => {
    const db = createDbMock([
      { ...verifiedFee, amount: "0.00" },
      { ...verifiedFee, fee_verified_id: 802, amount: "350.00" },
    ]);

    const result = await runHamiltonPublish({ runId: 112, db: asPublishDb(db) });

    expect(result.publishedFees).toBe(0);
    expect(result.results.map((row) => row.reason)).toEqual([
      "Missing or invalid amount",
      "Amount outside the category's plausible range",
    ]);
  });

  it("records Darwin's verification event as the publish handshake id", async () => {
    const db = createDbMock([verifiedFee]);

    await runHamiltonPublish({ runId: 113, db: asPublishDb(db) });

    const insert = db.mock.calls.find((call) => templateText(call[0]).includes("INSERT INTO published_fee_records"));
    // Darwin's event id lands in both verified_by_agent_event_id and the handshake column.
    const values = insert?.slice(1) ?? [];
    expect(values.filter((value) => value === verifiedFee.verified_by_agent_event_id)).toHaveLength(2);
  });

  describe("institution fee minimum", () => {
    const pendingRow = (fee_verified_id: number, canonical_fee_key: string, extra: Record<string, unknown> = {}) => ({
      ...verifiedFee,
      fee_verified_id,
      canonical_fee_key,
      depth_source: "pending",
      ...extra,
    });

    it("holds every row for an institution with fewer than three fees", async () => {
      const db = createDbMock([verifiedFee], [], [pendingRow(801, "overdraft"), pendingRow(802, "nsf")]);

      const result = await runHamiltonPublish({ runId: 601, db: asPublishDb(db) });

      expect(result).toMatchObject({
        selectedVerifiedFees: 1,
        processedVerifiedFees: 0,
        publishedFees: 0,
        heldFees: 1,
        minInstitutionFees: 3,
        heldInstitutions: [{ institutionId: 42, feeCount: 2, heldRows: 1 }],
      });
      expect(writes(db)).toEqual([]);
      const selectSql = String(db.unsafe.mock.calls[0][0]);
      expect(selectSql).toContain("COUNT(DISTINCT depth.canonical_fee_key)");
      // Whole source documents move together.
      expect(selectSql).toContain("AS batch_document_key");
      expect(selectSql).toContain("WHERE rows_before < $1");
    });

    it("counts pending rows outside the batch, but not ones a publish rule would skip", async () => {
      const deep = [
        { depth_source: "published", institution_id: 42, canonical_fee_key: "monthly_maintenance" },
        pendingRow(801, "overdraft"),
        pendingRow(802, "nsf"),
      ];
      const published = await runHamiltonPublish({ runId: 602, db: asPublishDb(createDbMock([verifiedFee], [], deep)) });
      expect(published).toMatchObject({ publishedFees: 1, heldFees: 0 });

      const shallow = [...deep.slice(1), pendingRow(803, "monthly_maintenance", { extraction_confidence: "0.4" })];
      const held = await runHamiltonPublish({ runId: 603, db: asPublishDb(createDbMock([verifiedFee], [], shallow)) });
      expect(held).toMatchObject({ publishedFees: 0, heldInstitutions: [{ feeCount: 2 }] });
    });

    it("publishes single fees when the minimum is set to one", async () => {
      const db = createDbMock([verifiedFee], [], []);

      const result = await runHamiltonPublish({ runId: 604, minInstitutionFees: 1, db: asPublishDb(db) });

      expect(result).toMatchObject({ publishedFees: 1, heldFees: 0, minInstitutionFees: 1 });
      expect(db.unsafe.mock.calls.map((call) => String(call[0])).join("\n")).not.toContain("institution_fee_depth");
    });
  });

  describe("with the learning core", () => {
    function learningDb(
      rows: Array<Record<string, unknown>>,
      prior: Array<Record<string, unknown>> = [],
      depthRows?: Array<Record<string, unknown>>,
    ): DbMock {
      const db = createDbMock(rows, prior, depthRows);
      const base = db.getMockImplementation() as (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
      db.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
        if (templateText(strings).includes("learning_schema_ready")) {
          return Promise.resolve([{ learning_schema_ready: true }]);
        }
        return base(strings, ...values);
      });
      return db;
    }

    function attemptValues(db: DbMock): unknown[][] {
      return db.mock.calls
        .filter((call) => templateText(call[0]).includes("INSERT INTO pipeline_attempts"))
        .map((call) => call.slice(1));
    }

    it("logs each decision so skipped rows are never selected again", async () => {
      const db = learningDb([
        verifiedFee,
        { ...verifiedFee, fee_verified_id: 803, extraction_confidence: "0.5" },
      ]);

      const result = await runHamiltonPublish({ runId: 501, stepId: 7, db: asPublishDb(db) });

      expect(result).toMatchObject({ learning: true, outcomes: { ok: 1, rejected: 1 } });
      const attempts = attemptValues(db);
      expect(attempts[0]).toEqual(expect.arrayContaining([42, "publish", HAMILTON_PUBLISH_STRATEGY.strategy, "verified:801", "ok", 501, 7]));
      expect(attempts[1]).toEqual(expect.arrayContaining(["publish", "verified:803", "rejected"]));

      const [query, params] = db.unsafe.mock.calls[0] as [string, unknown[]];
      expect(query).toContain("FROM pipeline_attempts pa");
      expect(query).toContain("'verified:' || fv.fee_verified_id::text");
      expect(params).toEqual(expect.arrayContaining([HAMILTON_PUBLISH_STRATEGY.strategy, HAMILTON_PUBLISH_STRATEGY.version]));
    });

    it("does not log held rows, so they publish once the institution has enough fees", async () => {
      const db = learningDb([verifiedFee], [], [{ ...verifiedFee, depth_source: "pending" }]);

      const result = await runHamiltonPublish({ runId: 503, db: asPublishDb(db) });

      expect(result).toMatchObject({ heldFees: 1, outcomes: {} });
      expect(attemptValues(db)).toEqual([]);
    });

    it("logs an identical re-verified row as unchanged", async () => {
      const db = learningDb([verifiedFee], [{ ...priorPublishedFee, amount: "35.00" }]);

      const result = await runHamiltonPublish({ runId: 502, db: asPublishDb(db) });

      expect(result.outcomes).toEqual({ unchanged: 1 });
    });
  });
});

describe("decidePriorFee", () => {
  const row = { ...verifiedFee };
  const live = (overrides: Record<string, unknown>) => ({ ...priorPublishedFee, ...overrides });

  it("treats a fee with no live row as new", () => {
    expect(decidePriorFee(row, [])).toEqual({ kind: "new" });
  });

  it("skips an amount already live on any line", () => {
    const match = live({ fee_published_id: 602, amount: "35.00" });
    expect(decidePriorFee(row, [live({ source_document_id: 77 }), match])).toEqual({ kind: "identical", prior: match });
  });

  it("keeps lines from the same document side by side", () => {
    expect(decidePriorFee(row, [live({ source_document_id: 77 })])).toEqual({ kind: "additional_line" });
  });

  it("replaces the same-named line from an older document", () => {
    const other = live({ fee_published_id: 603, fee_name: "Overdraft - business" });
    const named = live({ fee_published_id: 604, fee_name: "Overdraft Fee ......" });
    expect(decidePriorFee(row, [other, named])).toEqual({ kind: "supersede", prior: named });
  });

  it("adds a differently named line from a newer document instead of calling it a change", () => {
    const other = live({ fee_published_id: 605, fee_name: "Returned item" });
    expect(decidePriorFee(row, [other])).toEqual({ kind: "additional_line" });
  });

  it("never lets an older document replace a newer live price", () => {
    const newer = live({ fee_published_id: 606, document_crawled_at: "2026-10-04T00:00:00.000Z" });
    expect(decidePriorFee(row, [newer])).toEqual({ kind: "older_document", prior: newer });
  });

  it("does not record a change when either document's date is unknown", () => {
    expect(decidePriorFee({ ...row, document_crawled_at: null }, [live({})])).toEqual({ kind: "additional_line" });
    expect(decidePriorFee(row, [live({ document_crawled_at: null })])).toEqual({ kind: "additional_line" });
  });
});
