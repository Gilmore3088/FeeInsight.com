import { beforeEach, describe, expect, it, vi } from "vitest";

import { DARWIN_BATCH_KEY_VERSION, DARWIN_VERIFY_STRATEGY, runDarwinVerify, statedInOwnSource, verificationReasonCode, type RawFeeRow } from "./verify";
import { CATEGORY_GUARD_VERSION } from "@/lib/fee-category-guard";
import { DARWIN_PEER_STRATEGY, DARWIN_SECOND_SOURCE_STRATEGY, resetWiderPeerLevelCache, SECOND_SOURCE_FLAG } from "./peer-checks";
import { learnedEnvelope, resetLearnedEnvelopeCache } from "./learned-envelopes";
import { DARWIN_CATEGORY_MODEL_STRATEGY, resetCategoryModelCache } from "./category-model";

type DbMock = ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

/** The stored text of document 55, the schedule Knox read the test fees from. */
const SCHEDULE_TEXT = ["Overdraft fee $35.00", "Courtesy overdraft fee $5.00", "Paper statement Free"].join("\n");
const SOURCE_TEXTS = [
  { source_document_id: 55, normalized_text: SCHEDULE_TEXT },
  { source_document_id: 57, normalized_text: SCHEDULE_TEXT },
];

function createDbMock(rows: Array<Record<string, unknown>>): DbMock {
  const db = vi.fn((strings: TemplateStringsArray) => {
    const text = templateText(strings);
    if (text.includes("FROM agent_source_texts")) return Promise.resolve(SOURCE_TEXTS);
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
  source_document_id: 55,
  outlier_flags: ["needs_darwin_verification", "canonical_hint:overdraft"],
  conditions: "canonical_hint=overdraft; excerpt=\"Overdraft fee $35\"",
};

describe("Darwin agentic verification", () => {
  beforeEach(() => {
    resetLearnedEnvelopeCache();
    resetWiderPeerLevelCache();
  });

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
    // Pass 2 may read evidence (peer levels, learned ranges); a dry run never writes.
    const reads = db.unsafe.mock.calls.map((call) => String(call[0]));
    expect(reads.every((text) => !/\b(INSERT|UPDATE|DELETE)\b/.test(text))).toBe(true);
    const statements = db.mock.calls.map((call) => templateText(call[0]));
    expect(statements.every((text) => !/\b(INSERT|UPDATE|DELETE)\b/.test(text))).toBe(true);
  });

  it("re-files a row whose own name says the neighbouring category", async () => {
    const db = createDbMock([{ ...rawFee, fee_name: "Overdraft Transfer Fee (Sweep)", amount: "7.50" }]);

    const result = await runDarwinVerify({ runId: 105, db: asVerifyDb(db), dryRun: true });

    expect(result.results[0]).toMatchObject({ canonicalFeeKey: "od_protection_transfer" });
    expect(result.results[0]).not.toMatchObject({ reasonCode: "category_mismatch" });
  });

  it("rejects rows whose name contradicts the hinted category", async () => {
    const db = createDbMock([
      {
        ...rawFee,
        fee_name: "Overdraft Fee - Daily Maximum",
        amount: "7.50",
      },
    ]);

    const result = await runDarwinVerify({
      runId: 104,
      db: asVerifyDb(db),
    });

    expect(result.verifiedFees).toBe(0);
    expect(result.results[0]).toMatchObject({
      status: "skipped",
      canonicalFeeKey: "overdraft",
      reasonCode: "category_mismatch",
    });
    const insertSql = db.mock.calls.map((call) => templateText(call[0])).join("\n");
    expect(insertSql).not.toContain("INSERT INTO verified_fee_observations");
  });

  it("rejects a fee its own stored schedule does not state", async () => {
    const db = createDbMock([{ ...rawFee, amount: "36.00" }]);

    const result = await runDarwinVerify({ runId: 108, db: asVerifyDb(db) });

    expect(result.verifiedFees).toBe(0);
    expect(result.results[0]).toMatchObject({ status: "skipped", decision: "rejected", reasonCode: "not_in_source" });
    const insertSql = db.mock.calls.map((call) => templateText(call[0])).join("\n");
    expect(insertSql).not.toContain("INSERT INTO verified_fee_observations");
  });

  describe("statedInOwnSource", () => {
    const texts = new Map(SOURCE_TEXTS.map((text) => [text.source_document_id, text.normalized_text]));

    it("traces a fee to the document Knox read it from", () => {
      expect(statedInOwnSource(rawFee, texts)).toBe(true);
    });

    it("does not trace a fee with no stored text, another price, or another document", () => {
      expect(statedInOwnSource({ ...rawFee, amount: "36.00" }, texts)).toBe(false);
      expect(statedInOwnSource({ ...rawFee, source_document_id: 56 }, texts)).toBe(false);
      expect(statedInOwnSource({ ...rawFee, source_document_id: null }, texts)).toBe(false);
      expect(statedInOwnSource({ ...rawFee, fee_name: "Wire transfer fee" }, texts)).toBe(false);
    });
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
    expect(JSON.stringify(db.mock.calls)).toContain("missing_canonical");
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

  describe("reason codes", () => {
    const row = rawFee as unknown as RawFeeRow;

    it("gives every failed rule its own code", () => {
      expect(verificationReasonCode(row, "overdraft")).toBeNull();
      expect(verificationReasonCode(row, null)).toBe("missing_canonical");
      expect(verificationReasonCode({ ...row, fee_name: " " }, "overdraft")).toBe("missing_name");
      expect(verificationReasonCode({ ...row, fee_name: "Overdraft Transfer Fee (Sweep)" }, "overdraft")).toBe("category_mismatch");
      expect(verificationReasonCode({ ...row, source_url: null, document_r2_key: null }, "overdraft")).toBe("missing_lineage");
      expect(verificationReasonCode({ ...row, amount: null }, "overdraft")).toBe("invalid_amount");
      expect(verificationReasonCode({ ...row, amount: "-5" }, "overdraft")).toBe("invalid_amount");
      expect(verificationReasonCode({ ...row, amount: "350.00" }, "overdraft")).toBe("outside_envelope");
      // A $2 "overdraft" is a transfer fee or a threshold, not a per-item price.
      expect(verificationReasonCode({ ...row, amount: "2.00" }, "overdraft")).toBe("outside_envelope");
      expect(verificationReasonCode({ ...row, amount: "5.00" }, "overdraft")).toBeNull();
      expect(verificationReasonCode({ ...row, amount: "350.00" }, "safe_deposit_box")).toBeNull();
    });

    it("holds an amount above a learned ceiling for a category with no hand-set range", () => {
      const gift = { ...row, fee_name: "Gift Card Purchase" };
      const learned = new Map([["gift_card_purchase", learnedEnvelope("gift_card_purchase", 5.25, 539)!]]);
      // Without learned ranges the $0.01-$2,500 catch-all lets a $500 "maximum card load" through.
      expect(verificationReasonCode({ ...gift, amount: "500.00" }, "gift_card_purchase")).toBeNull();
      expect(verificationReasonCode({ ...gift, amount: "500.00" }, "gift_card_purchase", learned)).toBe("outside_envelope");
      expect(verificationReasonCode({ ...gift, amount: "4.95" }, "gift_card_purchase", learned)).toBeNull();
      // Only the top is learned: a few cents stays a real price.
      expect(verificationReasonCode({ ...gift, amount: "0.25" }, "gift_card_purchase", learned)).toBeNull();
    });

    it("accepts $0 only when Knox read explicit free-fee language", () => {
      const statement = { ...row, fee_name: "Paper Statement" };
      expect(verificationReasonCode({ ...statement, amount: "0" }, "paper_statement")).toBe("invalid_amount");
      expect(
        verificationReasonCode(
          { ...statement, amount: "0.00", outlier_flags: ["knox_review:zero", "needs_darwin_verification", "canonical_hint:paper_statement"] },
          "paper_statement",
        ),
      ).toBeNull();
    });
  });

  it("verifies a free fee and marks it zero_fee for Hamilton", async () => {
    const db = createDbMock([
      {
        ...rawFee,
        fee_name: "Paper statement",
        amount: "0.00",
        outlier_flags: ["knox_review:zero", "needs_darwin_verification", "canonical_hint:paper_statement"],
      },
    ]);

    const result = await runDarwinVerify({ runId: 105, db: asVerifyDb(db) });

    expect(result).toMatchObject({ verifiedFees: 1, zeroFeesVerified: 1 });
    const insert = db.mock.calls.find((call) => templateText(call[0]).includes("INSERT INTO verified_fee_observations"));
    expect(insert?.slice(1)).toContain(JSON.stringify(["agentic_darwin_verified", "zero_fee"]));
  });

  it("sends out-of-range amounts to review with the category's range in the signal", async () => {
    const db = createDbMock([{ ...rawFee, amount: "350.00" }]);

    const result = await runDarwinVerify({ runId: 106, db: asVerifyDb(db) });

    expect(result.results[0]).toMatchObject({ status: "skipped", decision: "needs_review", reasonCode: "outside_envelope" });
    expect(result.reasonCounts).toEqual({ outside_envelope: 1 });
    const calls = JSON.stringify(db.mock.calls);
    expect(calls).toContain("amount_envelopes");
    expect(calls).toContain("outside_envelope");
  });

  it("verifies the same fee line once per batch", async () => {
    const db = createDbMock([rawFee, { ...rawFee, fee_raw_id: 802 }]);

    const result = await runDarwinVerify({ runId: 107, db: asVerifyDb(db) });

    expect(result).toMatchObject({ verifiedFees: 1, skippedFees: 1, reasonCounts: { duplicate_in_batch: 1 } });
    expect(result.results[1]).toMatchObject({ decision: "duplicate" });
  });

  it("verifies the same fee once on each stored copy of a page", async () => {
    // An older and a newer copy of the same URL are different documents: the fee on the
    // bank's current copy is not a duplicate of the one on the older copy.
    const db = createDbMock([rawFee, { ...rawFee, fee_raw_id: 802, source_document_id: 57 }]);

    const result = await runDarwinVerify({ runId: 108, db: asVerifyDb(db) });

    expect(result).toMatchObject({ verifiedFees: 2, skippedFees: 0 });
  });

  describe("with the learning core", () => {
    function learningDb(rows: Array<Record<string, unknown>>): DbMock {
      const db = createDbMock(rows);
      db.mockImplementation((strings: TemplateStringsArray) => {
        const text = templateText(strings);
        if (text.includes("learning_schema_ready")) return Promise.resolve([{ learning_schema_ready: true }]);
        if (text.includes("superseded_by_id")) return Promise.resolve([{ ready: true }]);
        if (text.includes("FROM agent_source_texts")) return Promise.resolve(SOURCE_TEXTS);
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

    it("records the learned category model's dispute without changing the decision", async () => {
      resetCategoryModelCache();
      const catalog = [
        { name: "overdraft fee", category_key: "overdraft", count: "40" },
        { name: "paid overdraft item", category_key: "overdraft", count: "20" },
        { name: "zipper bag", category_key: "night_deposit", count: "20" },
        { name: "night deposit bag", category_key: "night_deposit", count: "20" },
      ];
      const db = learningDb([rawFee, { ...rawFee, fee_raw_id: 803, fee_name: "Zipper bag", amount: "5.00" }]);
      const base = db.getMockImplementation() as (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
      db.mockImplementation(((strings: TemplateStringsArray, ...values: unknown[]) =>
        templateText(strings).includes("FROM published_fee_catalog")
          ? Promise.resolve(catalog)
          : base(strings, ...values)) as never);

      const result = await runDarwinVerify({ runId: 404, db: asVerifyDb(db) });

      resetCategoryModelCache();
      expect(result.categoryModelDisputes).toBe(1);
      expect(result.results[1].categoryModel).toMatchObject({ disputed: true, suggested: "night_deposit" });
      expect(result.results[1].decision).not.toBe("needs_review");
      const shadow = attemptValues(db).filter((values) => values.includes(DARWIN_CATEGORY_MODEL_STRATEGY.strategy));
      expect(shadow).toHaveLength(2);
      expect(shadow[1]).toEqual(expect.arrayContaining(["raw:803", "evidence_mismatch"]));
    });

    it("re-checks category rejections once after the category guard changes", async () => {
      const db = learningDb([]);

      await runDarwinVerify({ runId: 403, db: asVerifyDb(db) });

      const [query, params] = db.unsafe.mock.calls[0] as [string, unknown[]];
      expect(query).toMatch(/reason_code' = 'category_mismatch'[\s\S]*category_guard_version/);
      expect(params).toEqual(expect.arrayContaining([CATEGORY_GUARD_VERSION]));
    });

    it("re-checks old batch duplicates on a current copy that has no verified twin", async () => {
      const db = learningDb([]);

      await runDarwinVerify({ runId: 404, db: asVerifyDb(db) });

      const [query, params] = db.unsafe.mock.calls[0] as [string, unknown[]];
      expect(query).toMatch(/reason_code' = 'duplicate_in_batch'[\s\S]*batch_key_version[\s\S]*superseded_by_id IS NULL[\s\S]*twin_raw.source_document_id = fr.source_document_id/);
      expect(params).toEqual(expect.arrayContaining([DARWIN_BATCH_KEY_VERSION]));
    });

    it("selects rows whose flags are stored as a real JSON array", async () => {
      const db = learningDb([]);

      await runDarwinVerify({ runId: 402, db: asVerifyDb(db) });

      expect(String(db.unsafe.mock.calls[0][0])).toContain("fr.outlier_flags ? 'needs_darwin_verification'");
    });

    it("takes whole source documents, never part of one", async () => {
      const db = learningDb([]);

      await runDarwinVerify({ runId: 403, db: asVerifyDb(db) });

      const query = String(db.unsafe.mock.calls[0][0]);
      expect(query).toContain("COALESCE(fr.source_document_id::text, 'row:' || fr.fee_raw_id::text) AS batch_document_key");
      expect(query).toContain("WHERE rows_before < $1");
      expect(query).not.toMatch(/LIMIT \$1/);
    });

    describe("pass 2", () => {
      const vtFee = { ...rawFee, state_code: "VT", asset_size_tier: null, asset_size: 600000, source_document_id: 55 };
      const overdraftPeers = [
        { canonical_fee_key: "overdraft", tier: "community_mid", p25: "30", median: "32", p75: "34", institutions: 9 },
        { canonical_fee_key: "overdraft", tier: "all", p25: "30", median: "32", p75: "34", institutions: 9 },
      ];

      function passTwoDb(rows: Array<Record<string, unknown>>, copies: Array<Record<string, unknown>> = []): DbMock {
        const db = learningDb(rows);
        const template = db.getMockImplementation() as (...args: unknown[]) => unknown;
        db.mockImplementation(((strings: TemplateStringsArray, ...values: unknown[]) => {
          if (templateText(strings).includes("FROM raw_fee_observations fr")) return Promise.resolve(copies);
          return template(strings, ...values);
        }) as never);
        db.unsafe.mockImplementation((query: string) => {
          if (query.includes("published_fee_catalog")) return Promise.resolve(overdraftPeers);
          if (query.includes("FROM raw_fee_observations")) return Promise.resolve(rows);
          return Promise.resolve([]);
        });
        return db;
      }

      function strategyAttempts(db: DbMock, strategy: string): unknown[][] {
        return attemptValues(db).filter((values) => values.includes(strategy));
      }

      it("flags a fee far outside its state peers for review, with the range as the reason", async () => {
        const db = passTwoDb([{ ...vtFee, amount: "5.00" }]);

        const result = await runDarwinVerify({ runId: 501, stepId: 7, stateCode: "VT", db: asVerifyDb(db) });

        expect(result).toMatchObject({ verifiedFees: 0, peerOutliers: 1, reasonCounts: { peer_outlier: 1 } });
        expect(result.results[0]).toMatchObject({ decision: "needs_review", reasonCode: "peer_outlier" });
        expect(result.results[0].reason).toContain("$5.00 is outside the community mid state peer range $10.00-$102.00");
        const statements = db.mock.calls.map((call) => templateText(call[0])).join("\n");
        expect(statements).not.toContain("INSERT INTO verified_fee_observations");
        expect(JSON.stringify(db.mock.calls)).toContain("peer_outliers");
        const peer = strategyAttempts(db, DARWIN_PEER_STRATEGY.strategy);
        expect(peer).toHaveLength(1);
        expect(peer[0]).toEqual(expect.arrayContaining(["verify", "raw:801", "evidence_mismatch"]));
      });

      it("verifies a fee inside its peer range and logs the peer check as passed", async () => {
        const db = passTwoDb([vtFee]);

        const result = await runDarwinVerify({ runId: 502, stateCode: "VT", db: asVerifyDb(db) });

        expect(result).toMatchObject({ verifiedFees: 1, peerOutliers: 0 });
        expect(strategyAttempts(db, DARWIN_PEER_STRATEGY.strategy)[0]).toEqual(expect.arrayContaining(["ok"]));
      });

      it("skips the peer check when the state has fewer than eight peers", async () => {
        const db = passTwoDb([{ ...vtFee, amount: "5.00" }]);
        overdraftPeers.forEach((level) => (level.institutions = 7));
        try {
          const result = await runDarwinVerify({ runId: 503, stateCode: "VT", db: asVerifyDb(db) });
          expect(result).toMatchObject({ verifiedFees: 1, peerOutliers: 0 });
          expect(strategyAttempts(db, DARWIN_PEER_STRATEGY.strategy)).toHaveLength(0);
        } finally {
          overdraftPeers.forEach((level) => (level.institutions = 9));
        }
      });

      it("falls back to national peers when the state has too few, and records it without holding", async () => {
        const db = passTwoDb([{ ...vtFee, amount: "5.00" }]);
        overdraftPeers.forEach((level) => (level.institutions = 7));
        const national = [{ district: null, canonical_fee_key: "overdraft", tier: "all", p25: "30", median: "32", p75: "34", institutions: "900" }];
        const base = db.unsafe.getMockImplementation() as (query: string) => Promise<unknown>;
        db.unsafe.mockImplementation((query: string) =>
          query.includes("districts(state_code") ? Promise.resolve(national) : base(query));
        try {
          const result = await runDarwinVerify({ runId: 506, stateCode: "VT", db: asVerifyDb(db) });
          expect(result).toMatchObject({ verifiedFees: 1, peerOutliers: 0, peerFallbackChecks: 1, peerFallbackOutliers: 1 });
          expect(result.results[0].peerCheck).toMatchObject({ scope: "national", outlier: true, peerCount: 900 });
          const peer = strategyAttempts(db, DARWIN_PEER_STRATEGY.strategy);
          expect(peer).toHaveLength(1);
          expect(JSON.stringify(peer[0])).toContain('\\"peer_scope\\":\\"national\\"');
          expect(JSON.stringify(peer[0])).toContain('\\"peer_held\\":false');
        } finally {
          overdraftPeers.forEach((level) => (level.institutions = 9));
        }
      });

      it("records a sister document with the same amount as second-source evidence", async () => {
        const db = passTwoDb([vtFee], [
          { fee_raw_id: 700, institution_id: 42, source_document_id: 44, amount: "35.00", outlier_flags: ["canonical_hint:overdraft"], conditions: null },
        ]);

        const result = await runDarwinVerify({ runId: 504, stateCode: "VT", db: asVerifyDb(db) });

        expect(result).toMatchObject({ verifiedFees: 1, secondSourceAgreements: 1 });
        const insert = db.mock.calls.find((call) => templateText(call[0]).includes("INSERT INTO verified_fee_observations"));
        expect(JSON.stringify(insert)).toContain(SECOND_SOURCE_FLAG);
        const second = strategyAttempts(db, DARWIN_SECOND_SOURCE_STRATEGY.strategy);
        expect(second).toHaveLength(1);
        expect(second[0]).toEqual(expect.arrayContaining(["ok"]));
      });

      it("notes a disagreeing older copy without blocking the row", async () => {
        const db = passTwoDb([vtFee], [
          { fee_raw_id: 700, institution_id: 42, source_document_id: 44, amount: "30.00", outlier_flags: ["canonical_hint:overdraft"], conditions: null },
          { fee_raw_id: 801, institution_id: 42, source_document_id: 55, amount: "35.00", outlier_flags: ["canonical_hint:overdraft"], conditions: null },
        ]);

        const result = await runDarwinVerify({ runId: 505, stateCode: "VT", db: asVerifyDb(db) });

        expect(result).toMatchObject({ verifiedFees: 1, secondSourceAgreements: 0, secondSourceDisagreements: 1 });
        expect(strategyAttempts(db, DARWIN_SECOND_SOURCE_STRATEGY.strategy)[0]).toEqual(expect.arrayContaining(["evidence_mismatch"]));
      });
    });
  });
});
