import { describe, expect, it, vi } from "vitest";

import { KNOX_EXTRACT_STRATEGY, KNOX_REEXTRACT_MAX_FEES, KNOX_REREAD_ASSET_FLOOR, runKnoxExtract } from "./extract";

type DbMock = ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

function createDbMock(rows: Array<Record<string, unknown>>): DbMock {
  const db = vi.fn((strings: TemplateStringsArray) => {
    const text = templateText(strings);
    if (text.includes("INSERT INTO raw_fee_observations")) {
      return Promise.resolve([{ fee_raw_id: db.mock.calls.length + 900 }]);
    }
    return Promise.resolve([]);
  }) as DbMock;
  db.unsafe = vi.fn((query: string) => {
    if (query.includes("FROM agent_source_texts")) return Promise.resolve(rows);
    return Promise.resolve([]);
  });
  return db;
}

function asExtractDb(db: DbMock): NonNullable<Parameters<typeof runKnoxExtract>[0]["db"]> {
  return db as unknown as NonNullable<Parameters<typeof runKnoxExtract>[0]["db"]>;
}

const textArtifact = {
  document_text_id: 701,
  source_document_id: 501,
  institution_id: 42,
  institution_name: "Test Bank",
  source_url: "https://testbank.example/fees",
  text_hash: "text-hash",
  normalized_text: [
    "Monthly maintenance fee $5.00 per month",
    "Overdraft fee $35.00 per item",
    "Outgoing domestic wire transfer fee $25.00",
    "No fee for e-statements",
    "Schedule of fees effective January 1, 2026 $0",
  ].join("\n"),
};

describe("Knox agentic extraction", () => {
  it("extracts conservative raw fee observations from Rosetta text artifacts", async () => {
    const db = createDbMock([textArtifact]);

    const result = await runKnoxExtract({
      runId: 101,
      limit: 500,
      db: asExtractDb(db),
    });

    expect(result).toMatchObject({
      selectedDocuments: 1,
      processedDocuments: 1,
      extractedFees: 3,
      insertedFees: 3,
      skippedFees: 0,
      limit: 100,
      dryRun: false,
    });
    expect(result.results[0].candidates.map((candidate) => candidate.canonicalHint)).toEqual([
      "monthly_maintenance",
      "overdraft",
      "wire_domestic_outgoing",
    ]);
    expect(result.results[0].candidates[0]).toMatchObject({
      feeName: "Monthly maintenance fee",
      amount: 5,
      frequency: "monthly",
    });

    const unsafeSql = db.unsafe.mock.calls.map((call) => String(call[0])).join("\n");
    expect(unsafeSql).toContain("FROM agent_source_texts");
    expect(unsafeSql).toContain("fr.source = 'knox'");

    const insertSql = db.mock.calls.map((call) => templateText(call[0])).join("\n");
    expect(insertSql).toContain("INSERT INTO raw_fee_observations");
    expect(insertSql).toContain("INSERT INTO hamilton_signals");
    // A categorized fee takes over a row an older version held as unclassified.
    expect(insertSql).toContain("DO UPDATE SET");
    expect(insertSql).toContain("fr.outlier_flags ? 'knox_review:unclassified'");
    expect(insertSql).toContain("knox_promoted_from_held");
    expect(JSON.stringify(db.mock.calls)).toContain("needs_darwin_verification");
    expect(JSON.stringify(db.mock.calls)).toContain("knox_extraction_completed");
    expect(JSON.stringify(db.mock.calls)).toContain("raw_observations_pending_verification");
    expect(JSON.stringify(db.mock.calls)).not.toContain("No fee for e-statements");
  });

  it("records shadow calibrated confidence and the text's layout without changing the stored confidence", async () => {
    const db = createDbMock([textArtifact]);
    const base = db.getMockImplementation() as (strings: TemplateStringsArray, ...values: unknown[]) => unknown;
    db.mockImplementation(((strings: TemplateStringsArray, ...values: unknown[]) => {
      if (templateText(strings).includes("FROM published_fee_records fp")) {
        return Promise.resolve([{ strategy: "extract.rules", canonical_fee_key: "overdraft", published: 100, live: 10 }]);
      }
      return base(strings, ...values);
    }) as never);

    const result = await runKnoxExtract({ runId: 111, db: asExtractDb(db) });

    expect(result).toMatchObject({ calibrationGroups: 1, calibratedBelowPublishFloor: 1 });
    expect(result.layouts).toEqual({ "plain/short": { documents: 1, thin: 0 } });
    const inserts = db.mock.calls.filter((call) => templateText(call[0]).includes("INSERT INTO raw_fee_observations"));
    const overdraft = inserts.find((call) => String(call[10]).includes("canonical_hint=overdraft"))!;
    expect(String(overdraft[10])).toMatch(/calibrated_confidence=0\.2\d;/);
    expect(Number(overdraft[5])).toBeGreaterThanOrEqual(0.8);
    const maintenance = inserts.find((call) => String(call[10]).includes("canonical_hint=monthly_maintenance"))!;
    // No survival history for the category: the formula's value, unchanged.
    expect(String(maintenance[10])).toContain(`calibrated_confidence=${Number(maintenance[5]).toFixed(2)};`);
  });

  it("sends free fees to Darwin and holds ranges for review", async () => {
    const db = createDbMock([
      { ...textArtifact, normalized_text: ["Overdraft fee | $35.00", "Paper statement | Free", "Check printing $15 - $40"].join("\n") },
    ]);

    const result = await runKnoxExtract({ runId: 110, db: asExtractDb(db) });

    expect(result).toMatchObject({ extractedFees: 1, insertedFees: 1, heldForReview: 2 });
    expect(result.results[0].heldInserted).toBe(2);
    // The free fee goes to Darwin and is reported apart, so the live board can count it.
    expect(result).toMatchObject({ freeFees: 1 });
    expect(result.results[0].freeInserted).toBe(1);
    const inserts = db.mock.calls.filter((call) => templateText(call[0]).includes("INSERT INTO raw_fee_observations"));
    const flags = inserts.map((call) => call.slice(1).find((value) => typeof value === "string" && value.startsWith("[")) as string);
    expect(flags).toEqual([
      JSON.stringify(["needs_darwin_verification", "canonical_hint:overdraft"]),
      JSON.stringify(["knox_review:zero", "needs_darwin_verification", "canonical_hint:paper_statement"]),
      JSON.stringify(["knox_review:range", "canonical_hint:check_printing", "amount_max:40"]),
    ]);
  });

  it("re-extracts a document whose text changed and retires rows from the older text", async () => {
    const db = createDbMock([textArtifact]);
    db.mockImplementation((strings: TemplateStringsArray) => {
      const text = templateText(strings);
      if (text.includes("UPDATE raw_fee_observations")) return Promise.resolve([{ fee_raw_id: 11 }, { fee_raw_id: 12 }]);
      if (text.includes("INSERT INTO raw_fee_observations")) return Promise.resolve([{ fee_raw_id: 950 }]);
      return Promise.resolve([]);
    });

    const result = await runKnoxExtract({ runId: 111, db: asExtractDb(db) });

    const selectSql = String(db.unsafe.mock.calls[0][0]);
    expect(selectSql).toContain("position(('text_hash=' || adt.text_hash || ';')");
    expect(result.retiredOlderRows).toBe(2);
    const retire = db.mock.calls.find((call) => templateText(call[0]).includes("UPDATE raw_fee_observations"));
    expect(templateText(retire?.[0])).toContain("- 'needs_darwin_verification'");
    expect(templateText(retire?.[0])).toContain("superseded_by_reread");
    expect(templateText(retire?.[0])).toContain("FROM verified_fee_observations fv");
    expect(retire?.slice(1)).toEqual(expect.arrayContaining([501, "text_hash=text-hash;"]));
  });

  it("keeps dry runs read-only while still reporting candidates", async () => {
    const db = createDbMock([textArtifact]);

    const result = await runKnoxExtract({
      runId: 102,
      dryRun: true,
      db: asExtractDb(db),
    });

    expect(result.extractedFees).toBe(3);
    expect(result.insertedFees).toBe(0);
    expect(result.skippedFees).toBe(3);
    expect(result.dryRun).toBe(true);
    expect(db.unsafe).toHaveBeenCalledTimes(1);
    expect(db).not.toHaveBeenCalled();
  });

  it("skips documents without recognizable banking fee lines", async () => {
    const db = createDbMock([
      {
        ...textArtifact,
        document_text_id: 702,
        normalized_text: "Schedule of fees\nRates effective today\nFree online banking",
      },
    ]);

    const result = await runKnoxExtract({
      runId: 103,
      db: asExtractDb(db),
    });

    expect(result).toMatchObject({
      selectedDocuments: 1,
      processedDocuments: 1,
      extractedFees: 0,
      insertedFees: 0,
      skippedFees: 0,
    });
    const insertSql = db.mock.calls.map((call) => templateText(call[0])).join("\n");
    expect(insertSql).not.toContain("INSERT INTO raw_fee_observations");
    expect(insertSql).toContain("INSERT INTO hamilton_signals");
    expect(JSON.stringify(db.mock.calls)).toContain("knox_extraction_needs_review");
    expect(JSON.stringify(db.mock.calls)).toContain("extraction_needs_review");
  });

  it("filters extraction candidates by state lane", async () => {
    const db = createDbMock([]);

    await runKnoxExtract({
      runId: 104,
      stateCode: "CA",
      db: asExtractDb(db),
    });

    const unsafeSql = db.unsafe.mock.calls.map((call) => String(call[0])).join("\n");
    expect(unsafeSql).toContain("JOIN institution_sources inst ON inst.id = adt.institution_id");
    expect(unsafeSql).toContain("upper(btrim(inst.state_code))");
  });

  it("never extracts the same text twice, even under another document id", async () => {
    const db = createDbMock([]);

    await runKnoxExtract({ runId: 105, db: asExtractDb(db) });

    const unsafeSql = db.unsafe.mock.calls.map((call) => String(call[0])).join("\n");
    expect(unsafeSql).toContain("prior.text_hash = adt.text_hash");
  });

  describe("one document per page", () => {
    function currentCopyDb(rows: Array<Record<string, unknown>>, retired: number[]): DbMock {
      const db = createDbMock(rows);
      db.mockImplementation((strings: TemplateStringsArray) => {
        const text = templateText(strings);
        if (text.includes("column_name = 'superseded_by_id'")) return Promise.resolve([{ ready: true }]);
        if (text.includes("INSERT INTO raw_fee_observations")) return Promise.resolve([{ fee_raw_id: 900 }]);
        if (text.includes("superseded_by_newer_copy")) return Promise.resolve(retired.map((id) => ({ fee_raw_id: id })));
        if (text.includes("old_copy.superseded_by_id IS NOT NULL")) return Promise.resolve(retired.map((id) => ({ fee_raw_id: id })));
        return Promise.resolve([]);
      });
      return db;
    }

    it("reads the current copy of a page, not an older copy", async () => {
      const db = currentCopyDb([], []);

      await runKnoxExtract({ runId: 106, db: asExtractDb(db) });

      const unsafeSql = db.unsafe.mock.calls.map((call) => String(call[0])).join("\n");
      expect(unsafeSql).toContain("current_text.source_document_id = old_copy.superseded_by_id");
    });

    it("retires older-copy rows only for a category the current copy has", async () => {
      const db = currentCopyDb([textArtifact], [11, 12]);

      const result = await runKnoxExtract({ runId: 107, db: asExtractDb(db) });

      expect(result.retiredOlderCopyRows).toBe(2);
      const sqlText = db.mock.calls.map((call) => templateText(call[0])).join("\n");
      expect(sqlText).toContain("cur.source_document_id = old_copy.superseded_by_id");
      expect(sqlText).toContain("NOT EXISTS (\n         SELECT 1 FROM verified_fee_observations fv");
      expect(sqlText).toContain('|| \'["superseded_by_newer_copy"]\'::jsonb');
    });

    it("lets a current copy be read when only an older copy of the same text holds rows", async () => {
      const db = currentCopyDb([], []);

      await runKnoxExtract({ runId: 108, db: asExtractDb(db) });

      const unsafeSql = db.unsafe.mock.calls.map((call) => String(call[0])).join("\n");
      expect(unsafeSql).toContain("AND mine.superseded_by_id IS NULL");
      expect(unsafeSql).toContain("AND theirs.superseded_by_id IS NOT NULL");
    });

    it("leaves older copies alone before the current-copy column exists", async () => {
      const db = createDbMock([textArtifact]);

      const result = await runKnoxExtract({ runId: 109, db: asExtractDb(db) });

      expect(result.retiredOlderCopyRows).toBe(0);
      const unsafeSql = db.unsafe.mock.calls.map((call) => String(call[0])).join("\n");
      expect(unsafeSql).not.toContain("old_copy.superseded_by_id");
    });
  });

  describe("with the learning core", () => {
    function learningDb(rows: Array<Record<string, unknown>>): DbMock {
      const db = createDbMock(rows);
      db.mockImplementation((strings: TemplateStringsArray) => {
        const text = templateText(strings);
        if (text.includes("learning_schema_ready")) return Promise.resolve([{ learning_schema_ready: true }]);
        if (text.includes("INSERT INTO raw_fee_observations")) return Promise.resolve([{ fee_raw_id: 900 }]);
        return Promise.resolve([]);
      });
      return db;
    }

    function attemptValues(db: DbMock): unknown[][] {
      return db.mock.calls
        .filter((call) => templateText(call[0]).includes("INSERT INTO pipeline_attempts"))
        .map((call) => call.slice(1));
    }

    it("records an attempt with its yield and excludes extracted text hashes in SQL", async () => {
      const db = learningDb([textArtifact]);

      const result = await runKnoxExtract({ runId: 106, stepId: 11, db: asExtractDb(db) });

      expect(result).toMatchObject({ learning: true, insertedFees: 3, outcomes: { ok: 1 } });
      expect(attemptValues(db).at(-1)).toEqual(
        expect.arrayContaining([42, 501, "extract", KNOX_EXTRACT_STRATEGY.strategy, "text-hash", "ok", 3, 106, 11]),
      );
      const [query, params] = db.unsafe.mock.calls[0] as [string, unknown[]];
      expect(query).toContain("FROM pipeline_attempts pa");
      expect(query).toContain("pa.input_fingerprint = adt.text_hash");
      expect(params).toEqual(expect.arrayContaining([KNOX_EXTRACT_STRATEGY.strategy, KNOX_EXTRACT_STRATEGY.version]));
      // A text with few fees goes back to Knox when the rules version moves.
      expect(query).toContain("FROM raw_fee_observations thin");
      expect(params).toEqual(expect.arrayContaining([KNOX_REEXTRACT_MAX_FEES]));
      // A large bank's page is read again once per rules version, ahead of other texts.
      expect(query).toContain("COALESCE(inst.asset_size, 0) >=");
      expect(params).toEqual(expect.arrayContaining([KNOX_REREAD_ASSET_FLOOR]));
      expect(query).toContain(`ORDER BY (COALESCE(inst.asset_size, 0) >= ${KNOX_REREAD_ASSET_FLOOR}) DESC`);
    });

    it("reads a page's current copy again when its older copy still carries live fees", async () => {
      const db = createDbMock([]);
      db.mockImplementation((strings: TemplateStringsArray) => {
        const text = templateText(strings);
        if (text.includes("learning_schema_ready")) return Promise.resolve([{ learning_schema_ready: true }]);
        if (text.includes("column_name = 'superseded_by_id'")) return Promise.resolve([{ ready: true }]);
        return Promise.resolve([]);
      });

      await runKnoxExtract({ runId: 110, db: asExtractDb(db) });

      const [query] = db.unsafe.mock.calls[0] as [string, unknown[]];
      expect(query).toContain("WHERE older_copy.superseded_by_id = adt.source_document_id");
      expect(query).toContain("live_fee.rolled_back_at IS NULL");
    });

    it("records each pass 2 specialist as its own strategy without folding it into the playbook", async () => {
      const db = learningDb([
        {
          ...textArtifact,
          normalized_text: ["Stop Payment", "$30.00 per item", "Wire Transfers", "Incoming Domestic", "$15.00"].join("\n"),
        },
      ]);

      const result = await runKnoxExtract({ runId: 110, stepId: 12, db: asExtractDb(db) });

      expect(result.results[0].candidates.map((fee) => [fee.feeName, fee.amount, fee.canonicalHint, fee.strategy])).toEqual([
        ["Stop Payment", 30, "stop_payment", "extract.table"],
        ["Wire Transfers: Incoming Domestic", 15, "wire_domestic_incoming", "extract.table"],
      ]);
      const strategies = attemptValues(db).map((values) => values[3]);
      expect(strategies).toEqual([
        "extract.table",
        "extract.family.overdraft_nsf",
        "extract.family.wires",
        "extract.family.atm_card",
        "extract.family.account",
        "extract.family.checks",
        "extract.family.services",
        KNOX_EXTRACT_STRATEGY.strategy,
      ]);
      expect(attemptValues(db)[0]).toEqual(expect.arrayContaining(["extract.table", 2, "text-hash", "ok", 2, 0]));
      // Only the rules attempt (the document's total) updates the playbook.
      expect(db.mock.calls.filter((call) => templateText(call[0]).includes("do_not_retry = "))).toHaveLength(1);
      const insertFlags = db.mock.calls
        .filter((call) => templateText(call[0]).includes("INSERT INTO raw_fee_observations"))
        .map((call) => String(call[11]));
      expect(insertFlags[0]).toContain("knox_specialist:extract.table");
    });

    it("flags a yield far below the institution's usual fee count as low_yield", async () => {
      const db = learningDb([{ ...textArtifact, expected_fee_count: 40 }]);

      const result = await runKnoxExtract({ runId: 107, db: asExtractDb(db) });

      expect(result.results[0].attemptOutcome).toBe("low_yield");
      expect(attemptValues(db).at(-1)).toEqual(expect.arrayContaining(["low_yield"]));
    });

    it("records no_candidates so the same text is not retried with this version", async () => {
      const db = learningDb([{ ...textArtifact, normalized_text: "Rates effective today\nFree online banking" }]);

      const result = await runKnoxExtract({ runId: 108, db: asExtractDb(db) });

      expect(result.outcomes).toEqual({ no_candidates: 1 });
      const playbookUpdate = db.mock.calls.find((call) => templateText(call[0]).includes("do_not_retry = "));
      expect(JSON.parse(String(playbookUpdate?.[4]))).toEqual([
        expect.objectContaining({ stage: "extract", fingerprint: "text-hash", outcome: "no_candidates" }),
      ]);
    });

    it("skips a text the playbook already marked as failed for this version", async () => {
      const db = learningDb([
        {
          ...textArtifact,
          do_not_retry: [
            { stage: "extract", strategy: KNOX_EXTRACT_STRATEGY.strategy, version: KNOX_EXTRACT_STRATEGY.version, fingerprint: "text-hash", outcome: "no_candidates", at: "2026-09-01T00:00:00Z" },
          ],
        },
      ]);

      const result = await runKnoxExtract({ runId: 109, db: asExtractDb(db) });

      expect(result).toMatchObject({ skippedKnownInputs: 1, processedDocuments: 0, insertedFees: 0 });
      expect(attemptValues(db)).toHaveLength(0);
    });
  });
});
