import { CATEGORY_AMOUNT_ENVELOPES } from "./envelopes";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { conditionalZero, DARWIN_BATCH_KEY_VERSION, DARWIN_CATEGORY_HOLDS, DARWIN_SOURCE_CHECK_VERSION, DARWIN_VERIFY_STRATEGY, FREQUENCY_SETTLED_FLAG, pendingCategoryLesson, postSourceCheck, runDarwinVerify, statedInOwnSource, verificationReasonCode, type RawFeeRow } from "./verify";
import { CATEGORY_GUARD_VERSION, refileCategory } from "@/lib/fee-category-guard";
import { DARWIN_PEER_STRATEGY, DARWIN_SECOND_SOURCE_STRATEGY, resetWiderPeerLevelCache, SECOND_SOURCE_FLAG } from "./peer-checks";
import { learnedEnvelope, resetLearnedEnvelopeCache } from "./learned-envelopes";
import { DARWIN_CATEGORY_MODEL_STRATEGY, resetCategoryModelCache } from "./category-model";

type DbMock = ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

/** The stored text of document 55, the schedule Knox read the test fees from. */
const SCHEDULE_TEXT = [
  "Overdraft fee $35.00",
  "Courtesy overdraft fee $5.00",
  "Paper statement Free",
  "Bill Pay - FREE with E-Statements and Debit Card | $6.95 per Month",
  "Monthly fee for balance of $500 & over | FREE",
  "E-Statement | FREE",
].join("\n");
const PINNACLE_TEXT = "- We've eliminated Non-sufficient Funds (NSF) Returned Item fees for consumer clients and lowered them from $38 to $30 for business clients.";
const SOURCE_TEXTS = [
  { source_document_id: 21164, normalized_text: PINNACLE_TEXT },
  { source_document_id: 55, normalized_text: SCHEDULE_TEXT },
  { source_document_id: 57, normalized_text: SCHEDULE_TEXT },
  {
    source_document_id: 58,
    normalized_text: [
      "Money Market Savings Account (below $2,500) | $15/mo. | Dormant Fee | $5/mo.",
      "Interest Checking (below $1,500) | $15/mo. | Levies and Writs per document $75",
    ].join("\n"),
  },
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

  it("fully verifies Pinnacle's eliminated consumer NSF and charged business NSF", async () => {
    const observations = ([['consumer', 0], ['business', 30]] as const).map(([fee_audience, amount], index) => ({
      ...rawFee, fee_raw_id: 321490 + index, institution_id: 47, source_document_id: 21164,
      fee_name: `Non-sufficient Funds (NSF) Returned Item fees (${fee_audience})`, fee_audience, amount,
      outlier_flags: ["needs_darwin_verification", "canonical_hint:nsf", ...(amount === 0 ? ["knox_review:zero"] : [])],
      conditions: `canonical_hint=nsf; excerpt="${PINNACLE_TEXT}"`,
    }));
    const result = await runDarwinVerify({ runId: 101, db: asVerifyDb(createDbMock(observations)) });
    expect(result.results.map((row) => [row.amount, row.status, row.reasonCode])).toEqual([[0, "verified", null], [30, "verified", null]]);
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

  it("holds no row once the guard carries its category lesson (bond returns, guard v58)", () => {
    // Raw 246460 (2026-10-09): "Bond return items" $35 filed nsf was held as category_lesson_pending
    // until guard v58 re-filed returned bonds and coupons to deposited_item_return.
    expect(DARWIN_CATEGORY_HOLDS).toEqual([]);
    expect(pendingCategoryLesson("nsf", "Bond return items")).toBeNull();
    expect(refileCategory("nsf", "Bond return items")).toBe("deposited_item_return");
    expect(refileCategory("nsf", "Bond/Coupon Returned Item Fee")).toBe("deposited_item_return");
    expect(refileCategory("nsf", "NSF returned item fee")).toBe("nsf");
  });

  it("rejects a fee its own stored schedule does not state", async () => {
    const db = createDbMock([{ ...rawFee, amount: "36.00" }]);

    const result = await runDarwinVerify({ runId: 108, db: asVerifyDb(db) });

    expect(result.verifiedFees).toBe(0);
    expect(result.results[0]).toMatchObject({ status: "skipped", decision: "rejected", reasonCode: "not_in_source" });
    const insertSql = db.mock.calls.map((call) => templateText(call[0])).join("\n");
    expect(insertSql).not.toContain("INSERT INTO verified_fee_observations");
  });

  it("settles a stated frequency the fee's own line contradicts, and flags the row", async () => {
    // Held excess-withdrawal rows (Oct 9): Knox read "monthly" from the allowance, the line charges per withdrawal.
    const perWithdrawal = {
      ...rawFee,
      fee_raw_id: 802,
      frequency: "monthly",
      conditions: "canonical_hint=overdraft; excerpt=\"Overdraft fee $35.00 per item in excess of one during a month\"",
    };
    const db = createDbMock([perWithdrawal]);
    await runDarwinVerify({ runId: 101, limit: 999, db: asVerifyDb(db) });
    const insert = db.mock.calls.find((call) => templateText(call[0]).includes("INSERT INTO verified_fee_observations"));
    expect(insert).toBeDefined();
    const params = JSON.stringify(insert!.slice(1));
    expect(params).toContain('"per_item"');
    expect(params).not.toContain('"monthly"');
    expect(params).toContain(FREQUENCY_SETTLED_FLAG);

    // A line that agrees keeps Knox's frequency and gets no flag.
    const agreeing = createDbMock([rawFee]);
    await runDarwinVerify({ runId: 102, limit: 999, db: asVerifyDb(agreeing) });
    const agreeingInsert = agreeing.mock.calls.find((call) => templateText(call[0]).includes("INSERT INTO verified_fee_observations"));
    expect(JSON.stringify(agreeingInsert!.slice(1))).toContain('"per_item"');
    expect(JSON.stringify(agreeingInsert!.slice(1))).not.toContain(FREQUENCY_SETTLED_FLAG);
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

  it("holds a $0 fee whose own schedule line prices it instead of verifying it free", async () => {
    const zero = (id: number, name: string, hint: string, excerpt: string) => ({
      ...rawFee,
      fee_raw_id: id,
      fee_name: name,
      amount: "0.00",
      outlier_flags: ["knox_review:zero", "needs_darwin_verification", `canonical_hint:${hint}`],
      conditions: `canonical_hint=${hint}; excerpt="${excerpt}"`,
    });
    const db = createDbMock([
      zero(901, "Bill Pay", "bill_pay", "Bill Pay - FREE with E-Statements and Debit Card | $6.95 per Month"),
      zero(902, "Monthly fee for balance of $500 & over", "monthly_maintenance", "Monthly fee for balance of $500 & over | FREE"),
      zero(903, "Paper statement", "paper_statement", "Paper statement Free"),
    ]);

    const result = await runDarwinVerify({ runId: 108, db: asVerifyDb(db) });

    const byId = new Map(result.results.map((row) => [row.feeRawId, row]));
    expect(byId.get(901)).toMatchObject({ status: "skipped", decision: "needs_review", reasonCode: "conditional_zero" });
    expect(byId.get(902)).toMatchObject({ status: "skipped", decision: "needs_review" });
    expect(["conditional_zero", "name_rule"]).toContain(byId.get(902)?.reasonCode);
    expect(byId.get(903)).toMatchObject({ status: "verified" });
    expect(result.verifiedFees).toBe(1);
  });

  it("never verifies into a retired category and applies Hamilton's name rules first", async () => {
    const db = createDbMock([
      {
        ...rawFee,
        fee_raw_id: 904,
        fee_name: "E-Statement",
        amount: "0.00",
        outlier_flags: ["knox_review:zero", "needs_darwin_verification", "canonical_hint:estatement_fee"],
        conditions: 'canonical_hint=estatement_fee; excerpt="E-Statement | FREE"',
      },
      {
        ...rawFee,
        fee_raw_id: 905,
        fee_name: "Overdraft fee if you opt in",
        amount: "35.00",
        conditions: 'canonical_hint=overdraft; excerpt="Overdraft fee $35.00"',
      },
    ]);

    const result = await runDarwinVerify({ runId: 109, db: asVerifyDb(db) });

    const byId = new Map(result.results.map((row) => [row.feeRawId, row]));
    expect(byId.get(904)).toMatchObject({ status: "skipped", decision: "rejected", reasonCode: "retired_category" });
    expect(byId.get(905)?.status).toBe("skipped");
    expect(result.verifiedFees).toBe(0);
    expect(JSON.stringify(db.mock.calls)).toContain("retired_category");
  });

  describe("postSourceCheck", () => {
    it("reads '$0 if condition, else $X' as a priced fee", () => {
      expect(conditionalZero(0, "Bill Pay - FREE with E-Statements | $6.95 per Month", "Bill Pay")).toBe(true);
      expect(conditionalZero(0, "Monthly Fee: $0 with $100 minimum daily balance OR $2.50/month", "Monthly Fee")).toBe(true);
      expect(conditionalZero(0, "Paper statement Free", "Paper statement")).toBe(false);
      expect(conditionalZero(0, "E-Statement | $0.00", "E-Statement")).toBe(false);
      expect(conditionalZero(6.95, "Bill Pay $6.95 per Month", "Bill Pay")).toBe(false);
      expect(conditionalZero(0, null, "Bill Pay $6.95 per Month")).toBe(true);
      // A neighbour's price in the same table row is not this fee's (dry read of the live rows, 2026-10-09).
      expect(conditionalZero(0, "Monthly Maintenance | Free | Assisted Phone Transactions* | $3", "Monthly Maintenance")).toBe(false);
      expect(conditionalZero(0, "Replacement ATM Card/PIN ........ $3.50 | Member ........ N/C", "Notary Service: Member")).toBe(false);
      expect(conditionalZero(0, "Gift Card Fee…………. $3.00 per Card | Notary/ Medallion Signature Fee ………FREE", "Notary/ Medallion Signature Fee")).toBe(false);
      expect(conditionalZero(0, "Share Draft Copy | FREE online | Cash Advance Fee 2.00% or $10", "Share Draft Copy")).toBe(false);
      // A comma list or a dot-leader run is cells too; a line with no word of the name prices nothing.
      expect(conditionalZero(0, "FREE Debit Card, FREE Online Banking, FREE Bill Pay, FREE eStatements, Buy back of unused checks up to $10 within 30 days", "Bill Pay")).toBe(false);
      expect(conditionalZero(0, "Closure (the first 90 days)………. $10.00 per Acct Coin Acceptance Rolled………………….4% of Deposit Garnish & Levy Fee ……………………$25.00 per Item", "Occurrence Notary/ Medallion Signature Fee")).toBe(false);
      expect(conditionalZero(0, "Levies and Writs per document $75", "Notary Fee")).toBe(false);
      // UAT takedown check 7/10 (2026-10-09): member tiers, comparison-table columns, other labels in the cell.
      expect(conditionalZero(0, "Notary Fee | $0 - Members $5 - Non-Members", "Notary Fee")).toBe(false);
      expect(conditionalZero(0, "Notary Service | Members: Free, Non-members: $10 per signature", "Notary Service")).toBe(false);
      expect(conditionalZero(0, "Monthly fee | $0 | $5* | $0", "Monthly fee")).toBe(false);
      expect(conditionalZero(0, "Fees and Requirements | Monthly Service Charge: FREE Minimum Balance: $1.00 Minimum deposit to open: $0 | Monthly Balance Fee: $7.50 if balance falls below $1.00", "Monthly Service Charge")).toBe(false);
      expect(conditionalZero(0, "Monthly Service Charge: $0 with $500 balance, otherwise $7.50 Minimum deposit to open: $25", "Monthly Service Charge")).toBe(true);
      expect(conditionalZero(0, "No monthly service fee and just $1 minimum opening requirement.", "No Monthly Service Fee")).toBe(false);
      expect(conditionalZero(0, "Monthly Service Fee: $0 Minimum to open: $50", "Monthly Service Fee")).toBe(false);
      expect(conditionalZero(0, "$2.00 Monthly Service Charge7. Service charge waived for clients age 18 and under.", "Service Charge7. Service charge waived for clients age 18 and under.")).toBe(true);
      // The fee's own price cell still counts, as does a balance band in its own cell.
      expect(conditionalZero(0, "Paper Statement | FREE with e-statements | $2.00 per month", "Paper Statement")).toBe(false);
      expect(conditionalZero(0, "Monthly fee for balance of $500 & over | FREE", "Monthly fee for balance of & over")).toBe(true);
    });

    it("orders retired type, conditional zero, then name rule", () => {
      expect(postSourceCheck("estatement_fee", "E-Statement", 0, "E-Statement | FREE")).toEqual({ code: "retired_category" });
      expect(postSourceCheck("bill_pay", "Bill Pay", 0, "Bill Pay - FREE | $6.95 per Month")).toEqual({ code: "conditional_zero" });
      expect(postSourceCheck("monthly_maintenance", "Monthly service charge if any of the following qualifications are met", 0, "FREE")).toEqual({
        code: "name_rule",
        rule: "waiver_sentence",
      });
      expect(postSourceCheck("overdraft", "Overdraft fee", 35, "Overdraft fee $35.00")).toBeNull();
    });
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

  it("does not collapse equal prices across customer audiences", async () => {
    const db = createDbMock([
      { ...rawFee, fee_audience: "consumer" },
      { ...rawFee, fee_raw_id: 802, fee_audience: "business" },
    ]);
    const result = await runDarwinVerify({ runId: 107, db: asVerifyDb(db) });
    expect(result).toMatchObject({ verifiedFees: 2, skippedFees: 0 });
  });

  it("verifies the same fee line once per batch", async () => {
    const db = createDbMock([rawFee, { ...rawFee, fee_raw_id: 802 }]);

    const result = await runDarwinVerify({ runId: 107, db: asVerifyDb(db) });

    expect(result).toMatchObject({ verifiedFees: 1, skippedFees: 1, reasonCounts: { duplicate_in_batch: 1 } });
    expect(result.results[1]).toMatchObject({ decision: "duplicate" });
  });

  it("verifies two products' fees with one price on one document as two fees (batch key v3, SCCU 8109)", async () => {
    const moneyMarket = {
      ...rawFee, fee_name: "Money Market Savings Account (below $2,500)", amount: "15.00", frequency: "monthly", source_document_id: 58,
      outlier_flags: ["needs_darwin_verification", "canonical_hint:minimum_balance"],
      conditions: "canonical_hint=minimum_balance; excerpt=\"Money Market Savings Account (below $2,500) | $15/mo. | Dormant Fee | $5/mo.\"",
    };
    const interestChecking = {
      ...moneyMarket, fee_raw_id: 802, fee_name: "Interest Checking (below $1,500)",
      conditions: "canonical_hint=minimum_balance; excerpt=\"Interest Checking (below $1,500) | $15/mo. | Levies and Writs per document $75\"",
    };
    const db = createDbMock([moneyMarket, interestChecking, { ...interestChecking, fee_raw_id: 803 }]);

    const result = await runDarwinVerify({ runId: 109, db: asVerifyDb(db) });

    // The same line read twice (raw 803) is still one fee.
    expect(result).toMatchObject({ verifiedFees: 2, skippedFees: 1, reasonCounts: { duplicate_in_batch: 1 } });
    expect(DARWIN_BATCH_KEY_VERSION).toBe(4);
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
      // A hold outside a hand-set envelope is re-checked once today's envelope takes the amount.
      expect(query).toContain("pa.detail->>'reason_code' = 'outside_envelope'");
      expect(query).toContain("->>'min')::numeric");
      expect(params).toContain(JSON.stringify(CATEGORY_AMOUNT_ENVELOPES));
      expect(CATEGORY_AMOUNT_ENVELOPES.account_research).toEqual({ min: 1, max: 150 });
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
      expect(query).toMatch(/reason_code' IN \('category_mismatch', 'category_lesson_pending'\)[\s\S]*category_guard_version/);
      expect(params).toEqual(expect.arrayContaining([CATEGORY_GUARD_VERSION]));
    });

    it("re-reads not_in_source rejections once after the source check changes", async () => {
      const db = learningDb([]);

      await runDarwinVerify({ runId: 405, db: asVerifyDb(db) });

      const [query, params] = db.unsafe.mock.calls[0] as [string, unknown[]];
      expect(query).toMatch(/reason_code' = 'not_in_source'[\s\S]*COALESCE\(\(pa\.detail->>'source_check_version'\)::int, 0\) </);
      expect(params).toEqual(expect.arrayContaining([DARWIN_SOURCE_CHECK_VERSION]));
    });

    it("re-checks old batch duplicates on a current copy that has no verified twin", async () => {
      const db = learningDb([]);

      await runDarwinVerify({ runId: 404, db: asVerifyDb(db) });

      const [query, params] = db.unsafe.mock.calls[0] as [string, unknown[]];
      expect(query).toMatch(/reason_code' = 'duplicate_in_batch'[\s\S]*batch_key_version[\s\S]*superseded_by_id IS NULL[\s\S]*twin_raw.source_document_id = fr.source_document_id[\s\S]*twin_raw.conditions from 'excerpt=/);
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
      const vtFee = { ...rawFee, fee_audience: "consumer", state_code: "VT", asset_size_tier: null, asset_size: 600000, source_document_id: 55 };
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

      it.each(["business", "unknown"] as const)("does not hold %s fee against consumer-only state peers", async (fee_audience) => {
        const db = passTwoDb([{ ...vtFee, fee_audience, amount: "5.00" }]);
        const result = await runDarwinVerify({ runId: 507, stateCode: "VT", db: asVerifyDb(db) });
        expect(result).toMatchObject({ verifiedFees: 1, peerOutliers: 0 });
        expect(result.results[0].peerCheck).toBeNull();
        expect(strategyAttempts(db, DARWIN_PEER_STRATEGY.strategy)).toHaveLength(0);
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
          { fee_raw_id: 700, institution_id: 42, source_document_id: 44, amount: "35.00", outlier_flags: ["canonical_hint:overdraft"], conditions: null, fee_audience: "consumer" },
        ]);

        const result = await runDarwinVerify({ runId: 504, stateCode: "VT", db: asVerifyDb(db) });

        expect(result).toMatchObject({ verifiedFees: 1, secondSourceAgreements: 1 });
        const insert = db.mock.calls.find((call) => templateText(call[0]).includes("INSERT INTO verified_fee_observations"));
        expect(JSON.stringify(insert)).toContain(SECOND_SOURCE_FLAG);
        const second = strategyAttempts(db, DARWIN_SECOND_SOURCE_STRATEGY.strategy);
        expect(second).toHaveLength(1);
        expect(second[0]).toEqual(expect.arrayContaining(["ok"]));
      });

      it("ignores a business copy when corroborating a consumer fee", async () => {
        const db = passTwoDb([vtFee], [
          { fee_raw_id: 700, institution_id: 42, source_document_id: 44, amount: "35.00", outlier_flags: ["canonical_hint:overdraft"], conditions: null, fee_audience: "business" },
        ]);

        const result = await runDarwinVerify({ runId: 507, stateCode: "VT", db: asVerifyDb(db) });

        expect(result).toMatchObject({ verifiedFees: 1, secondSourceAgreements: 0, secondSourceDisagreements: 0 });
        expect(result.results[0].secondSource).toBeNull();
      });

      it("notes a disagreeing older copy without blocking the row", async () => {
        const db = passTwoDb([vtFee], [
          { fee_raw_id: 700, institution_id: 42, source_document_id: 44, amount: "30.00", outlier_flags: ["canonical_hint:overdraft"], conditions: null, fee_audience: "consumer" },
          { fee_raw_id: 801, institution_id: 42, source_document_id: 55, amount: "35.00", outlier_flags: ["canonical_hint:overdraft"], conditions: null, fee_audience: "consumer" },
        ]);

        const result = await runDarwinVerify({ runId: 505, stateCode: "VT", db: asVerifyDb(db) });

        expect(result).toMatchObject({ verifiedFees: 1, secondSourceAgreements: 0, secondSourceDisagreements: 1 });
        expect(strategyAttempts(db, DARWIN_SECOND_SOURCE_STRATEGY.strategy)[0]).toEqual(expect.arrayContaining(["evidence_mismatch"]));
      });
    });
  });
});
