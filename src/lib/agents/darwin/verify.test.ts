import { describe, expect, it, vi } from "vitest";

import { DARWIN_VERIFY_STRATEGY, runDarwinVerify } from "./verify";

type DbMock = ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

function createDbMock(rows: Array<Record<string, unknown>>): DbMock {
  const db = vi.fn((strings: TemplateStringsArray) => {
    const text = templateText(strings);
    if (text.includes("INSERT INTO verified_fee_observations")) {
      return Promise.resolve([{ fee_verified_id: db.mock.calls.length + 1200 }]);
    }
    return Promise.resolve([]);
  }) as DbMock;
  db.unsafe = vi.fn((query: string) => {
    if (query.includes("FROM raw_fee_observations")) return Promise.resolve(rows);
    return Promise.resolve([]);
  });
  return db;
}

function asVerifyDb(db: DbMock): NonNullable<Parameters<typeof runDarwinVerify>[0]["db"]> {
  return db as unknown as NonNullable<Parameters<typeof runDarwinVerify>[0]["db"]>;
}

const rawFee = {
  fee_raw_id: 801,
  institution_id: 42,
  source_url: "https://testbank.example/fees",
  document_r2_key: null,
  extraction_confidence: "0.9200",
  fee_name: "Overdraft fee",
  amount: "35.00",
  frequency: "per_item",
  outlier_flags: ["needs_darwin_verification", "canonical_hint:overdraft"],
  conditions: "canonical_hint=overdraft; excerpt=\"Overdraft fee $35\"",
};

describe("Darwin agentic verification", () => {
  it("verifies Knox raw rows with canonical hints into verified_fee_observations", async () => {
    const db = createDbMock([rawFee]);

    const result = await runDarwinVerify({
      runId: 101,
      limit: 999,
      db: asVerifyDb(db),
    });

    expect(result).toMatchObject({
      selectedRawFees: 1,
      processedRawFees: 1,
      verifiedFees: 1,
      skippedFees: 0,
      limit: 500,
      dryRun: false,
    });
    expect(result.results[0]).toMatchObject({
      feeRawId: 801,
      institutionId: 42,
      canonicalFeeKey: "overdraft",
      status: "verified",
      feeVerifiedId: expect.any(Number),
    });

    const unsafeSql = db.unsafe.mock.calls.map((call) => String(call[0])).join("\n");
    expect(unsafeSql).toContain("FROM raw_fee_observations");
    expect(unsafeSql).toContain("fr.outlier_flags ? 'needs_darwin_verification'");

    const insertSql = db.mock.calls.map((call) => templateText(call[0])).join("\n");
    expect(insertSql).toContain("INSERT INTO verified_fee_observations");
    expect(insertSql).toContain("INSERT INTO hamilton_signals");
    expect(insertSql).toContain("ON CONFLICT DO NOTHING");
    expect(insertSql).not.toContain("promote_to_tier2");
    expect(insertSql).not.toContain("agent_events");
    expect(JSON.stringify(db.mock.calls)).toContain("agentic_darwin_verified");
    expect(JSON.stringify(db.mock.calls)).toContain("darwin_verification_completed");
    expect(JSON.stringify(db.mock.calls)).toContain("verified_unpublished");
  });

  it("keeps dry runs read-only while still reporting verified candidates", async () => {
    const db = createDbMock([rawFee]);

    const result = await runDarwinVerify({
      runId: 102,
      dryRun: true,
      db: asVerifyDb(db),
    });

    expect(result.verifiedFees).toBe(1);
    expect(result.results[0]).toMatchObject({
      status: "verified",
      feeVerifiedId: null,
    });
    expect(db.unsafe).toHaveBeenCalledTimes(1);
    expect(db).not.toHaveBeenCalled();
  });

  it("skips raw rows without a valid canonical hint", async () => {
    const db = createDbMock([
      {
        ...rawFee,
        outlier_flags: ["needs_darwin_verification"],
        conditions: "canonical_hint=not_a_real_fee",
      },
    ]);

    const result = await runDarwinVerify({
      runId: 103,
      db: asVerifyDb(db),
    });

    expect(result).toMatchObject({
      selectedRawFees: 1,
      processedRawFees: 1,
      verifiedFees: 0,
      skippedFees: 1,
    });
    expect(result.results[0]).toMatchObject({
      status: "skipped",
      reason: "Missing or invalid canonical hint",
    });
    const insertSql = db.mock.calls.map((call) => templateText(call[0])).join("\n");
    expect(insertSql).not.toContain("INSERT INTO verified_fee_observations");
    expect(insertSql).toContain("INSERT INTO hamilton_signals");
    expect(JSON.stringify(db.mock.calls)).toContain("darwin_verification_needs_review");
    expect(JSON.stringify(db.mock.calls)).toContain("verification_needs_review");
    expect(JSON.stringify(db.mock.calls)).toContain("Missing or invalid canonical hint");
  });

  it("filters raw verification candidates by state lane", async () => {
    const db = createDbMock([]);

    await runDarwinVerify({
      runId: 104,
      stateCode: "WA",
      db: asVerifyDb(db),
    });

    const unsafeSql = db.unsafe.mock.calls.map((call) => String(call[0])).join("\n");
    expect(unsafeSql).toContain("JOIN institution_sources inst ON inst.id = fr.institution_id");
    expect(unsafeSql).toContain("upper(btrim(inst.state_code))");
  });

  describe("with the learning core", () => {
    function learningDb(rows: Array<Record<string, unknown>>): DbMock {
      const db = createDbMock(rows);
      db.mockImplementation((strings: TemplateStringsArray) => {
        const text = templateText(strings);
        if (text.includes("learning_schema_ready")) return Promise.resolve([{ learning_schema_ready: true }]);
        if (text.includes("INSERT INTO verified_fee_observations")) return Promise.resolve([{ fee_verified_id: 1300 }]);
        return Promise.resolve([]);
      });
      return db;
    }

    function attemptValues(db: DbMock): unknown[][] {
      return db.mock.calls
        .filter((call) => templateText(call[0]).includes("INSERT INTO pipeline_attempts"))
        .map((call) => call.slice(1));
    }

    it("logs every decision so rejected rows are never selected again", async () => {
      const db = learningDb([
        rawFee,
        { ...rawFee, fee_raw_id: 802, outlier_flags: ["needs_darwin_verification"], conditions: null },
      ]);

      const result = await runDarwinVerify({ runId: 401, stepId: 12, db: asVerifyDb(db) });

      expect(result).toMatchObject({ verifiedFees: 1, skippedFees: 1, learning: true, outcomes: { ok: 1, rejected: 1 } });
      const attempts = attemptValues(db);
      expect(attempts[0]).toEqual(expect.arrayContaining([42, "verify", DARWIN_VERIFY_STRATEGY.strategy, "raw:801", "ok", 401, 12]));
      expect(attempts[1]).toEqual(expect.arrayContaining(["verify", "raw:802", "rejected"]));

      const [query, params] = db.unsafe.mock.calls[0] as [string, unknown[]];
      expect(query).toContain("FROM pipeline_attempts pa");
      expect(query).toContain("'raw:' || fr.fee_raw_id::text");
      expect(params).toEqual(expect.arrayContaining([DARWIN_VERIFY_STRATEGY.strategy, DARWIN_VERIFY_STRATEGY.version]));
    });

    it("selects rows whose flags are stored as a real JSON array", async () => {
      const db = learningDb([]);

      await runDarwinVerify({ runId: 402, db: asVerifyDb(db) });

      expect(String(db.unsafe.mock.calls[0][0])).toContain("fr.outlier_flags ? 'needs_darwin_verification'");
    });
  });
});
