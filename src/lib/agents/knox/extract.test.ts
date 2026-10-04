import { describe, expect, it, vi } from "vitest";

import { KNOX_EXTRACT_STRATEGY, KNOX_REEXTRACT_MAX_FEES, runKnoxExtract } from "./extract";

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
    expect(insertSql).toContain("ON CONFLICT DO NOTHING");
    expect(JSON.stringify(db.mock.calls)).toContain("needs_darwin_verification");
    expect(JSON.stringify(db.mock.calls)).toContain("knox_extraction_completed");
    expect(JSON.stringify(db.mock.calls)).toContain("raw_observations_pending_verification");
    expect(JSON.stringify(db.mock.calls)).not.toContain("No fee for e-statements");
  });

  it("sends free fees to Darwin and holds ranges for review", async () => {
    const db = createDbMock([
      { ...textArtifact, normalized_text: ["Overdraft fee | $35.00", "Paper statement | Free", "Check printing $15 - $40"].join("\n") },
    ]);

    const result = await runKnoxExtract({ runId: 110, db: asExtractDb(db) });

    expect(result).toMatchObject({ extractedFees: 1, insertedFees: 1, heldForReview: 2 });
    expect(result.results[0].heldInserted).toBe(2);
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
      expect(attemptValues(db)[0]).toEqual(
        expect.arrayContaining([42, 501, "extract", KNOX_EXTRACT_STRATEGY.strategy, "text-hash", "ok", 3, 106, 11]),
      );
      const [query, params] = db.unsafe.mock.calls[0] as [string, unknown[]];
      expect(query).toContain("FROM pipeline_attempts pa");
      expect(query).toContain("pa.input_fingerprint = adt.text_hash");
      expect(params).toEqual(expect.arrayContaining([KNOX_EXTRACT_STRATEGY.strategy, KNOX_EXTRACT_STRATEGY.version]));
      // A text with few fees goes back to Knox when the rules version moves.
      expect(query).toContain("FROM raw_fee_observations thin");
      expect(params).toEqual(expect.arrayContaining([KNOX_REEXTRACT_MAX_FEES]));
    });

    it("flags a yield far below the institution's usual fee count as low_yield", async () => {
      const db = learningDb([{ ...textArtifact, expected_fee_count: 40 }]);

      const result = await runKnoxExtract({ runId: 107, db: asExtractDb(db) });

      expect(result.results[0].attemptOutcome).toBe("low_yield");
      expect(attemptValues(db)[0]).toEqual(expect.arrayContaining(["low_yield"]));
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
            { stage: "extract", strategy: "extract.rules", version: 2, fingerprint: "text-hash", outcome: "no_candidates", at: "2026-09-01T00:00:00Z" },
          ],
        },
      ]);

      const result = await runKnoxExtract({ runId: 109, db: asExtractDb(db) });

      expect(result).toMatchObject({ skippedKnownInputs: 1, processedDocuments: 0, insertedFees: 0 });
      expect(attemptValues(db)).toHaveLength(0);
    });
  });
});
