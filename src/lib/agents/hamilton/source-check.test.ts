import { describe, expect, it, vi } from "vitest";

import {
  SOURCE_CHECK_REASON,
  SOURCE_CHECK_RESTORE_PREFIX,
  markRestoredForSourceCheck,
  READER_LOSS_RESTORES_ON,
  readerLostLine,
  restorableName,
  importedTwinFingerprint,
  linkImportedFeesToTwins,
  takeDownUntraceableFees,
  traceLiveFee,
  twinStatesFee,
  type LiveFeeRow,
} from "./source-check";

// From Texar FCU's stored fee schedule text.
const TEXAR = [
  "Service | Fee",
  "Cashiers Check | $3",
  "Overdraft Protection Items - Negative $25 or less | $5",
  "Overdraft Protection Items - Negative from $50.01 and more | $35",
  "Overnight Courier Service",
  "$50.00",
  "/Item",
  "Wire Transfer - Incoming",
  "Wire Transfer - Outgoing",
  "$25.00",
  "Notary Service | FREE",
].join("\n");

function fee(id: number, name: string, amount: string | null, source = "knox", documentId: number | null = 7): LiveFeeRow {
  return {
    fee_published_id: id,
    lineage_ref: id + 1000,
    fee_raw_id: id + 2000,
    institution_id: 42,
    source,
    source_document_id: documentId,
    canonical_fee_key: "other",
    fee_name: name,
    amount,
  };
}

const texts = [{ source_document_id: 7, normalized_text: TEXAR }];

// Georgia United FCU (8565): its truth-in-savings PDF re-read on Oct 8 puts every fee name
// in one run and every price in another, so no line pairs them. Knox read the fees on Oct 5.
const GUCU_REREAD = [
  "me Debit OverdraftOverdraftOverdraft ProtectionReturned ItemStop PaymentACH OverdraftDebit Card OverdraftExpedited Card Delivery",
  "$35.00/Item$35.00/Item$35.00/Item$32.00/Request$35.00/Item$35.00/Item$30.00/Card$5.00 $65.00/Year$85.00/Year",
].join("\n");
const READ_AT = "2026-10-05T07:00:00Z";
const REREAD_AT = "2026-10-08T21:17:52Z";

function knoxFee(id: number, name: string, amount: string, excerpt: string, readAt = READ_AT): LiveFeeRow {
  return {
    ...fee(id, name, amount),
    canonical_fee_key: "stop_payment",
    raw_created_at: readAt,
    conditions: `Knox deterministic extraction from Rosetta artifact #60. canonical_hint=stop_payment; text_hash=x; excerpt="${excerpt}"`,
  };
}

const gucuTexts = [{ source_document_id: 7, normalized_text: GUCU_REREAD, updated_at: REREAD_AT }];
const stopPayment = knoxFee(21162, "Stop Payment", "32", "(each submission/resubmission) Stop Payment $32.00/Request EFT");

describe("restorableName", () => {
  // UAT passed "PREMIUM / PREMIUM RDC CHECKING MINIMUM BALANCE FEE"; the repeated-word rule
  // holds it back too, on purpose: a restore errs toward leaving a fee down.
  it("passes the names UAT confirmed and fails the three it failed on name alone (Oct 9)", () => {
    for (const name of ["Overdraft Protection Transfer", "Stop Payment", "5” x 5” Box", "Legal Process", "Cashier’s Check"]) {
      expect(restorableName(name)).toBe(true);
    }
    for (const name of [
      "Mechanical Repair Coverage (MRC) Stop Payments Quoted Rate Check / ACH / Electronic Check",
      "Account Research/Reconciliation Fee Subpoena/Levy/Garnishment Research per Hour Lost",
      "services Account Closing (within first 90 days) Does not apply to Youth Savings accounts",
      "Wire Transfer | Incoming",
      "SAFE DEPOSIT BOX FEES x Box",
      "Free Official Checks, per check",
      "Per Check Safe Deposit Box Annual 2X5+",
      "ATMs Non S&T ATM Transactions ATM Service Fees",
      "SAFE DEPOSIT BOXES Auburn Hills, Warren, Waterford West",
      "USD Inactive Membership Fee",
      "Automated overdraft LOC transfer after 2",
    ]) {
      expect(restorableName(name)).toBe(false);
    }
  });
});

describe("readerLostLine", () => {
  it("keeps a fee whose own document was re-read after Knox read it and whose stored line still states it", () => {
    const verdict = traceLiveFee(stopPayment, gucuTexts);
    expect(verdict.kind).toBe("untraceable");
    expect(readerLostLine(stopPayment, gucuTexts, verdict.kind === "untraceable" ? verdict.reason : "")).toBe(true);
  });

  it("does not when the text Knox read is still the current one", () => {
    const notRewritten = [{ ...gucuTexts[0], updated_at: "2026-10-01T00:00:00Z" }];
    expect(readerLostLine(stopPayment, notRewritten, "amount_not_the_fee")).toBe(false);
    expect(readerLostLine({ ...stopPayment, raw_created_at: null }, gucuTexts, "amount_not_the_fee")).toBe(false);
  });

  it("does not when the price on the stored line belongs to the next line's fee", () => {
    const nextLinePrice = knoxFee(46987, "Notary Service", "10", "Notary Service / $10 low balance fee if balance falls below $2,500");
    expect(readerLostLine(nextLinePrice, gucuTexts, "amount_not_the_fee")).toBe(false);
  });

  it("does not when the stored line never stated the fee", () => {
    // Prod row 48249: an overdraft fee whose stored line is the incoming international wire.
    const wrongLine = knoxFee(48249, "Overdraft or Non-sufficient Funds (NSF) Charges::", "40", "International Incoming | $ 40");
    expect(readerLostLine(wrongLine, gucuTexts, "amount_not_the_fee")).toBe(false);
  });

  it("does not for other reasons, $0 rows, rows Knox did not read, or rows with no stored line", () => {
    expect(readerLostLine(stopPayment, gucuTexts, "amount_is_a_threshold")).toBe(false);
    expect(readerLostLine({ ...stopPayment, amount: "0" }, gucuTexts, "amount_not_the_fee")).toBe(false);
    expect(readerLostLine({ ...stopPayment, source: "migration_v10" }, gucuTexts, "amount_not_the_fee")).toBe(false);
    expect(readerLostLine({ ...stopPayment, conditions: "canonical_hint=stop_payment" }, gucuTexts, "amount_not_the_fee")).toBe(false);
  });
});

describe("traceLiveFee", () => {
  it("takes down a balance threshold published as the fee (Texar $50.01)", () => {
    expect(traceLiveFee(fee(1, "Overdraft Protection Items - Negative from", "50.01"), texts).kind).toBe("untraceable");
  });

  it("keeps the price of a tier, a price under its name and a free service", () => {
    expect(traceLiveFee(fee(2, "Overdraft Protection Items - Negative or less", "5"), texts).kind).toBe("traced");
    expect(traceLiveFee(fee(3, "Overnight Courier Service", "50"), texts).kind).toBe("traced");
    expect(traceLiveFee(fee(4, "Notary Service", "0"), texts).kind).toBe("traced");
  });

  it("never gives a fee the next fee's price", () => {
    expect(traceLiveFee(fee(5, "Wire Transfer - Incoming", "25"), texts).kind).toBe("untraceable");
  });

  it("relinks an imported fee to the stored schedule that states it, but not a Knox fee", () => {
    expect(traceLiveFee(fee(6, "Cashiers Check", "3", "migration_v10", null), texts)).toEqual({ kind: "relinked", sourceDocumentId: 7 });
    expect(traceLiveFee(fee(7, "Cashiers Check", "3", "knox", 8), texts)).toEqual({ kind: "untraceable", reason: "no_source_text" });
  });

  it("takes down a fee with no stored schedule or no amount", () => {
    expect(traceLiveFee(fee(8, "Cashiers Check", "3", "migration_v10", null), [])).toEqual({ kind: "untraceable", reason: "no_source_text" });
    expect(traceLiveFee(fee(9, "Cashiers Check", null), texts)).toEqual({ kind: "untraceable", reason: "no_amount" });
  });
});

describe("takeDownUntraceableFees", () => {
  // Fee 1 failed its first look 13 hours ago, on another run.
  const firstLook = [
    {
      fee_published_id: 1,
      kind: "takedown_pending",
      evidence: { flag_run_id: 4, flagged_at: new Date(Date.now() - 13 * 3_600_000).toISOString(), reason: "amount_is_a_threshold" },
    },
  ];
  function createDb(rows: LiveFeeRow[], flags: unknown[] = firstLook, storedTexts: Array<{ source_document_id: number; normalized_text: string }> = texts) {
    const calls: string[] = [];
    const db = vi.fn((strings: TemplateStringsArray) => {
      const query = strings.join("?");
      calls.push(query);
      if (query.includes("to_regclass('public.pipeline_feedback')")) return Promise.resolve([{ ready: true }]);
      if (query.includes("FROM pipeline_feedback") && query.includes("dedupe_key = ANY")) return Promise.resolve(flags);
      if (query.includes("MAX(fp.fee_published_id)")) return Promise.resolve([{ institution_id: 42, max_fee_id: 9 }]);
      if (query.includes("FROM agent_source_texts")) return Promise.resolve(storedTexts.map((text) => ({ ...text, institution_id: 42 })));
      if (query.includes("JOIN raw_fee_observations")) return Promise.resolve(rows);
      return Promise.resolve([]);
    });
    return { db: db as unknown as Parameters<typeof takeDownUntraceableFees>[0], calls };
  }

  it("relinks, takes down and logs the batch", async () => {
    const { db, calls } = createDb([
      fee(1, "Overdraft Protection Items - Negative from", "50.01"),
      fee(2, "Cashiers Check", "3", "migration_v10", null),
      fee(3, "Notary Service", "0"),
    ]);
    const result = await takeDownUntraceableFees(db, { runId: 5, batchId: "agentic-run-5", dryRun: false, stateCode: "TX" });

    expect(result).toMatchObject({ institutionsChecked: 1, liveFeesChecked: 3, traced: 1, relinked: 1 });
    expect(result.takedowns.map((row) => row.feePublishedId)).toEqual([1]);
    expect(calls.some((query) => query.includes("UPDATE raw_fee_observations"))).toBe(true);
    expect(calls.some((query) => query.includes("UPDATE published_fee_records"))).toBe(true);
    expect(calls.some((query) => query.includes("review_status = 'rejected'"))).toBe(true);
    expect(calls.some((query) => query.includes("INSERT INTO pipeline_attempts"))).toBe(true);
    expect(calls.some((query) => query.includes("'hamilton.source_check'"))).toBe(true);
    expect(SOURCE_CHECK_REASON).toBe("source_check_untraceable");
  });

  it("takes nothing down on a first failure: it logs the fee for a second look", async () => {
    const { db, calls } = createDb([fee(1, "Overdraft Protection Items - Negative from", "50.01")], []);
    const result = await takeDownUntraceableFees(db, { runId: 5, batchId: "b", dryRun: false, stateCode: "TX" });

    expect(result.takedowns).toEqual([]);
    expect(result.flagged).toBe(1);
    expect(calls.some((query) => query.includes("INSERT INTO pipeline_feedback"))).toBe(true);
    expect(calls.some((query) => query.includes("SET rolled_back_at = NOW()"))).toBe(false);
  });

  it("waits when the first look is from this run or too recent", async () => {
    const recent = [{ ...firstLook[0], evidence: { ...firstLook[0].evidence, flagged_at: new Date().toISOString() } }];
    const { db } = createDb([fee(1, "Overdraft Protection Items - Negative from", "50.01")], recent);
    const result = await takeDownUntraceableFees(db, { runId: 5, batchId: "b", dryRun: false, stateCode: "TX" });
    expect(result.takedowns).toEqual([]);
    expect(result.awaitingSecondLook).toBe(1);
  });

  it("makes a fee whose first look is pending due again", async () => {
    const { db, calls } = createDb([fee(1, "Overdraft Protection Items - Negative from", "50.01")]);
    await takeDownUntraceableFees(db, { runId: 5, batchId: "b", dryRun: true, stateCode: "TX" });
    expect(calls[0]).toMatch(/OR EXISTS[\s\S]*FROM pipeline_feedback[\s\S]*kind = \?/);
  });

  it("restores an earlier takedown that now traces and leaves the rest down", async () => {
    const { db, calls } = createDb([
      { ...fee(3, "Overnight Courier Service", "50"), taken_down: true },
      { ...fee(1, "Overdraft Protection Items - Negative from", "50.01"), taken_down: true },
    ]);
    const result = await takeDownUntraceableFees(db, { runId: 6, batchId: "b", dryRun: true, stateCode: "TX" });

    expect(result.restored).toBe(1);
    expect(result.takedowns).toEqual([]);
    expect(result.liveFeesChecked).toBe(1);
    expect(calls[0]).toContain("rolled_back_reason LIKE");
  });

  it("checks any state's institutions when the step has no state, never-checked ones first", async () => {
    const { db, calls } = createDb([fee(1, "Overdraft Protection Items - Negative from", "50.01")]);
    const result = await takeDownUntraceableFees(db, { runId: 7, batchId: "b", dryRun: true });
    expect(result.institutionsChecked).toBe(1);
    expect(calls[0]).toMatch(/ORDER BY NOT[\s\S]*EXISTS[\s\S]*live\.institution_id/);
  });

  it("fills a state step's batch from other states once its own state is done", async () => {
    const { db, calls } = createDb([fee(1, "Overdraft Protection Items - Negative from", "50.01")]);
    await takeDownUntraceableFees(db, { runId: 8, batchId: "b", dryRun: true, stateCode: "TX" });
    const due = calls[0];
    // The step's state sorts first; it never limits which institutions are due.
    expect(due.split("ORDER BY")[0]).not.toContain("state_code");
    expect(due.split("ORDER BY")[1]).toContain("state_code");
  });

  it("keeps a live fee a re-read lost the line of, and leaves an earlier takedown down while restores are off", async () => {
    const { db, calls } = createDb(
      [{ ...stopPayment, fee_published_id: 1 }, { ...stopPayment, fee_published_id: 2, taken_down: true }],
      firstLook,
      gucuTexts,
    );
    const result = await takeDownUntraceableFees(db, { runId: 9, batchId: "b", dryRun: false });

    expect(READER_LOSS_RESTORES_ON).toBe(false);
    expect(result.readerLost).toBe(1);
    expect(result.takedowns).toEqual([]);
    expect(result.flagged).toBe(0);
    expect(result.restored).toBe(0);
    expect(calls.some((query) => query.includes("SET rolled_back_at = NOW()"))).toBe(false);
    expect(calls.some((query) => query.includes("SET rolled_back_at = NULL"))).toBe(false);
  });

  it("writes nothing on a dry run", async () => {
    const { db, calls } = createDb([fee(1, "Overdraft Protection Items - Negative from", "50.01")]);
    const result = await takeDownUntraceableFees(db, { runId: 5, batchId: "b", dryRun: true, stateCode: "TX" });
    expect(result.takedowns).toHaveLength(1);
    expect(calls.some((query) => query.includes("UPDATE"))).toBe(false);
  });
});

describe("linkImportedFeesToTwins", () => {
  const twin = (name: string, amount: string, text: string | null = TEXAR) => ({
    ...fee(9, name, amount, "migration_v10", null),
    twin_raw_id: 3009,
    twin_document_id: 7,
    normalized_text: text,
  });

  it("links an imported fee to its twin's document only when that document states the fee", () => {
    expect(twinStatesFee(twin("Cashiers Check", "3.00"))).toBe(true);
    expect(twinStatesFee(twin("Cashiers Check", "8.00"))).toBe(false);
    expect(twinStatesFee(twin("Cashiers Check", "3.00", null))).toBe(false);
  });

  function twinDb(rows: unknown[]) {
    return vi.fn((strings: TemplateStringsArray) => {
      const text = Array.isArray(strings) ? strings.join(" ") : String(strings);
      if (text.includes("JOIN raw_fee_observations twin")) return Promise.resolve(rows);
      return Promise.resolve([]);
    });
  }

  it("points the verified row at the twin and records the pair", async () => {
    const db = twinDb([twin("Cashiers Check", "3.00")]);
    const result = await linkImportedFeesToTwins(db as never, { runId: 9, dryRun: false });
    expect(result).toEqual({ checked: 1, linked: 1, untraced: 0 });
    const statements = db.mock.calls.map((call) => (call[0] as unknown as string[]).join(" "));
    expect(statements.some((text) => text.includes("UPDATE verified_fee_observations"))).toBe(true);
    expect(statements.some((text) => /(UPDATE|INSERT INTO) published_fee_records/.test(text))).toBe(false);
    const attempt = db.mock.calls.find((call) => (call[0] as unknown as string[]).join(" ").includes("INSERT INTO pipeline_attempts"));
    expect(attempt).toContain(importedTwinFingerprint(1009, 3009));
  });

  it("writes nothing in a dry run, and nothing but the attempt when the fee does not trace", async () => {
    const dry = twinDb([twin("Cashiers Check", "3.00")]);
    expect(await linkImportedFeesToTwins(dry as never, { runId: 9, dryRun: true })).toEqual({ checked: 1, linked: 1, untraced: 0 });
    expect(dry.mock.calls).toHaveLength(1);
    const db = twinDb([twin("Cashiers Check", "8.00")]);
    expect(await linkImportedFeesToTwins(db as never, { runId: 9, dryRun: false })).toEqual({ checked: 1, linked: 0, untraced: 1 });
    const statements = db.mock.calls.map((call) => (call[0] as unknown as string[]).join(" "));
    expect(statements.some((text) => text.includes("UPDATE verified_fee_observations"))).toBe(false);
  });
});

describe("markRestoredForSourceCheck", () => {
  it("leaves one marker per restored fee so its bank is checked again", async () => {
    const db = vi.fn<(...args: unknown[]) => Promise<unknown[]>>(() => Promise.resolve([]));
    await markRestoredForSourceCheck(db as unknown as Parameters<typeof markRestoredForSourceCheck>[0], [
      { institution_id: 7, fee_published_id: 41 },
      { institution_id: 8, fee_published_id: 42 },
    ], { runId: 3, restoredBy: "hamilton.rules_recheck" });
    expect(db).toHaveBeenCalledTimes(1);
    const [strings, ...values] = db.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(strings.join("?")).toContain("INSERT INTO pipeline_attempts");
    expect(values).toContain(SOURCE_CHECK_RESTORE_PREFIX);
    expect(values).toContainEqual([7, 8]);
    expect(values).toContainEqual([41, 42]);
  });

  it("writes nothing when nothing was restored", async () => {
    const db = vi.fn(() => Promise.resolve([]));
    await markRestoredForSourceCheck(db as unknown as Parameters<typeof markRestoredForSourceCheck>[0], [], { runId: 3, restoredBy: "x" });
    expect(db).not.toHaveBeenCalled();
  });
});
