import { describe, expect, it, vi } from "vitest";
import { ACCOUNT_TYPE_CHECKED_FLAG, ACCOUNT_TYPE_COLUMN_CHECKED_FLAG, ACCOUNT_TYPE_COLUMN_READ_LIVE, applyAccountTypeHold, columnProductOf, feedbackRow, planColumnHolds, passesWithoutAccountWords, planHolds, splitUntyped, type HoldRow } from "./account-type-hold";
import { feedbackRowRead, FEEDBACK_KINDS } from "@/lib/agents/learning/feedback-kinds";
import { publishSkipReason } from "./publish";

const LIVE: HoldRow[] = [
  // Live rows, prod, Oct 16.
  { fee_published_id: 141227, fee_verified_id: 1, institution_id: 927, fee_name: "Monthly maintenance fee", product_name: "MMDA – Money Market Deposit Account – Personal", amount: "10.00" },
  { fee_published_id: 65609, fee_verified_id: 2, institution_id: 217, fee_name: "Service charge fee", product_name: "DIRECT SAVINGS ACCOUNT", amount: "2.00" },
  { fee_published_id: 126011, fee_verified_id: 3, institution_id: 2878, fee_name: "Monthly maintenance fee", product_name: "First Business Checking", amount: "10.00" },
  { fee_published_id: 999, fee_verified_id: 4, institution_id: 1, fee_name: "Monthly Service Fee", product_name: "Everyday Checking", amount: "5.00" },
  { fee_published_id: 998, fee_verified_id: 5, institution_id: 2, fee_name: "Monthly Service Fee", product_name: null, amount: "8.00" },
];

describe("account type hold (#1100 gap 1)", () => {
  it("holds a non-checking account's monthly fee and leaves checking and unstated ones", () => {
    const plan = planHolds(LIVE);
    expect(plan.typed.map((hold) => [hold.feePublishedId, hold.accountType])).toEqual([
      [141227, "money_market"], [65609, "savings"], [126011, "business"],
    ]);
    expect(plan.untyped.map((row) => row.fee_published_id)).toEqual([999, 998]);
  });

  it("brings a guard-refused row back as verified only when it is a real fee once its account words are set aside", () => {
    // Doc 362 (inst 954), prod: "Monthly Account Fee - Business Advantage Checking | $20.00" (shortened).
    const text = "Business Checking Accounts\nMonthly Account Fee - Business Advantage Checking | $20.00\nStop payment | $30.00";
    expect(passesWithoutAccountWords({ fee_verified_id: 4436, institution_id: 954, fee_name: "Monthly Account Fee - Business Advantage Checking", product_name: null, amount: 20, normalized_text: text })).toBe(true);
    // An annual IRA fee is not a monthly fee once "IRA" is set aside.
    expect(passesWithoutAccountWords({ fee_verified_id: 1, institution_id: 1, fee_name: "IRA Annual Maintenance Fee", product_name: null, amount: 10, normalized_text: "IRA Annual Maintenance Fee $10.00" })).toBe(false);
    // No stored text: stays rejected.
    expect(passesWithoutAccountWords({ fee_verified_id: 2, institution_id: 1, fee_name: "Statement Savings monthly fee", product_name: null, amount: 2, normalized_text: null })).toBe(false);
  });

  it("publish skips a held monthly maintenance row and nothing else", () => {
    const row = {
      fee_verified_id: 1, fee_raw_id: 1, institution_id: 1, source_url: "https://bank.example/fees", document_r2_key: null,
      extraction_confidence: 0.95, canonical_fee_key: "monthly_maintenance", variant_type: null,
      outlier_flags: ["agentic_darwin_verified", "account_type:savings"], verified_by_agent_event_id: "00000000-0000-4000-8000-000000000001",
      fee_name: "Monthly fee", amount: "5.00", frequency: "monthly", raw_agent_event_id: null, source_document_id: 1, fee_audience: "unknown",
      document_url: "https://bank.example/fees",
    } as unknown as Parameters<typeof publishSkipReason>[0];
    expect(publishSkipReason(row, 0.5)).toBe("Held: a savings account's monthly fee, not consumer checking");
    expect(String(publishSkipReason({ ...row, canonical_fee_key: "stop_payment" } as typeof row, 0.5))).not.toMatch(/^Held:/);
  });

  it("writes nothing on a dry run", async () => {
    const calls: string[] = [];
    const db = vi.fn((strings: TemplateStringsArray) => {
      const text = strings.join("?");
      calls.push(text);
      return Promise.resolve(text.includes("FROM published_fee_records fp") ? LIVE : []);
    }) as unknown as Parameters<typeof applyAccountTypeHold>[0];
    Object.assign(db, { unsafe: vi.fn(() => Promise.resolve([])) });
    const result = await applyAccountTypeHold(db, { runId: 1, batchId: "agentic-run-1", dryRun: true });
    expect(result.heldLive).toHaveLength(3);
    expect(calls.some((text) => /UPDATE|INSERT/.test(text))).toBe(false);
  });

  it("marks an untyped row checked only when it has a product, so a product Knox fills later is still held", async () => {
    expect(splitUntyped(planHolds(LIVE).untyped)).toEqual({ check: [LIVE[3]], recheck: [LIVE[4]] });

    // A stateful fake of the live read: rows carry their flags, the read skips checked rows, and
    // the flag UPDATE writes back.
    const flags = new Map<number, string[]>();
    const product = new Map<number, string | null>(LIVE.map((row) => [Number(row.fee_verified_id), row.product_name]));
    const down = new Set<number>();
    const liveRows = () => LIVE
      .filter((row) => !down.has(Number(row.fee_published_id)))
      .map((row) => ({ ...row, product_name: product.get(Number(row.fee_verified_id)) ?? null }));
    const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join("?");
      if (text.includes("UPDATE published_fee_records")) {
        const ids = values[1] as number[];
        ids.forEach((id) => down.add(Number(id)));
        return Promise.resolve(ids.map((id) => ({ fee_published_id: id })));
      }
      if (text.includes("UPDATE verified_fee_observations")) {
        const [, ids, types] = values as [string, number[], string[]];
        ids.forEach((id, index) => flags.set(Number(id), [...(flags.get(Number(id)) ?? []), types[index]]));
        return Promise.resolve([]);
      }
      if (text.includes("FROM published_fee_records fp")) {
        return Promise.resolve(liveRows().filter((row) => !(flags.get(Number(row.fee_verified_id)) ?? []).includes(ACCOUNT_TYPE_CHECKED_FLAG)));
      }
      return Promise.resolve([]);
    }) as unknown as Parameters<typeof applyAccountTypeHold>[0];

    const first = await applyAccountTypeHold(db, { runId: 1, batchId: "agentic-run-1", dryRun: false });
    expect(first.heldLive.map((hold) => hold.feePublishedId)).toEqual([141227, 65609, 126011]);
    expect(first.checkedUntyped).toBe(1);
    expect(first.recheckNoProduct).toBe(1);
    expect(flags.get(4)).toEqual([ACCOUNT_TYPE_CHECKED_FLAG]);
    expect(flags.get(5)).toBeUndefined();

    // A later Knox read fills fee 5's product with a savings account: the next step holds it.
    product.set(5, "Statement Savings");
    const second = await applyAccountTypeHold(db, { runId: 2, batchId: "agentic-run-2", dryRun: false });
    expect(second.heldLive.map((hold) => [hold.feePublishedId, hold.accountType])).toEqual([[998, "savings"]]);
    expect(flags.get(5)).toEqual(["account_type:savings"]);
    expect(second.checkedUntyped).toBe(0);
  });

  it("puts a failed read on the run ledger as an error and a step.warning", async () => {
    const calls: string[] = [];
    const db = vi.fn((strings: TemplateStringsArray) => {
      const text = strings.join("?");
      calls.push(text);
      if (text.includes("FROM published_fee_records fp")) return Promise.reject(new Error("boom"));
      return Promise.resolve([]);
    }) as unknown as Parameters<typeof applyAccountTypeHold>[0];
    const result = await applyAccountTypeHold(db, { runId: 1, stepId: 2, batchId: "agentic-run-1", dryRun: false });
    expect(result.error).toBe("boom");
    expect(result.heldLive).toEqual([]);
    expect(calls.some((text) => text.includes("'step.warning'"))).toBe(true);
  });

  it("labels a release a restore record, never the takedown's wrong category (#1680)", async () => {
    const hold = planHolds([{ fee_published_id: null, fee_verified_id: 4436, institution_id: 954, fee_name: "Monthly Account Fee - Business Advantage Checking", product_name: null, amount: "20.00" }]).typed[0];
    const live = feedbackRow({ ...hold, feePublishedId: 12138 }, "live", 1);
    const released = feedbackRow(hold, "restored", 1);
    expect([live.signal, live.kind, live.aboutStage]).toEqual(["wrong", "wrong_category", "publish"]);
    expect([released.signal, released.kind, released.aboutStage, released.weight]).toEqual(["restored", "account_type_hold_released", "publish", 0]);
    // Same stage as before, so the shared upsert (which keeps about_stage) never leaves a stale stage.
    expect(released.dedupeKey).toBe("hamilton.account_type_hold:restored:4436");
    expect("record" in FEEDBACK_KINDS.account_type_hold_released).toBe(true);
    expect(feedbackRowRead({ kind: released.kind, about_stage: released.aboutStage, check_name: released.checkName ?? null })).toBe(true);

    // Through the step: a refused row that passes without its account words goes back to verified
    // and its feedback row is a restore.
    const text = "Business Checking Accounts\nMonthly Account Fee - Business Advantage Checking | $20.00\nStop payment | $30.00";
    const refused: HoldRow[] = [{ fee_verified_id: 4436, institution_id: 954, fee_name: "Monthly Account Fee - Business Advantage Checking", product_name: null, amount: "20.00", source_document_id: 362, normalized_text: text }];
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const sqlText = strings.join("?");
      calls.push({ text: sqlText, values });
      return Promise.resolve(sqlText.includes("fv.review_status = 'rejected'") ? refused : []);
    }) as unknown as Parameters<typeof applyAccountTypeHold>[0];
    const result = await applyAccountTypeHold(db, { runId: 7, batchId: "agentic-run-7", dryRun: false });
    expect(result.restoredHeld.map((row) => row.feeVerifiedId)).toEqual([4436]);
    const insert = calls.find((call) => call.text.includes("INSERT INTO pipeline_feedback"))!;
    const rows = JSON.parse(insert.values.find((value) => typeof value === "string" && value.startsWith("[")) as string) as Array<Record<string, unknown>>;
    expect(rows.map((row) => [row.signal, row.kind, row.dedupe_key])).toEqual([["restored", "account_type_hold_released", "hamilton.account_type_hold:restored:4436"]]);
  });

  it("names #1100 in the rollback reason", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join("?");
      calls.push({ text, values });
      if (text.includes("UPDATE published_fee_records")) return Promise.resolve((values[1] as number[]).map((id) => ({ fee_published_id: id })));
      return Promise.resolve(text.includes("FROM published_fee_records fp") ? LIVE : []);
    }) as unknown as Parameters<typeof applyAccountTypeHold>[0];
    await applyAccountTypeHold(db, { runId: 1, batchId: "agentic-run-1", dryRun: false });
    const update = calls.find((call) => call.text.includes("UPDATE published_fee_records"))!;
    expect(update.values[2]).toEqual(["account_type_hold: money_market (#1100)", "account_type_hold: savings (#1100)", "account_type_hold: business (#1100)"]);
  });

  it("leaves a listed fee live whatever its stored product says, in any copy (keep-live list)", () => {
    const row: HoldRow = { fee_published_id: 28834, fee_verified_id: 9, institution_id: 5800, fee_name: "Monthly Service Fee", product_name: "REGULAR SHARE FEES", amount: "5.00", source_document_id: 3633 };
    expect(planHolds([row]).typed).toEqual([]);
    // A new copy of the same fee (new published and verified ids, the name's case changed) stays live.
    expect(planHolds([{ ...row, fee_published_id: 150000, fee_verified_id: 99, fee_name: "monthly service fee" }]).typed).toEqual([]);
    // Another bank's fee, or another price, is still held.
    expect(planHolds([{ ...row, institution_id: 5801 }]).typed.map((hold) => hold.accountType)).toEqual(["savings"]);
    expect(planHolds([{ ...row, amount: "6.00" }]).typed.map((hold) => hold.accountType)).toEqual(["savings"]);
    // The same name and price on another document (another account's list) is held.
    expect(planHolds([{ ...row, source_document_id: 9999 }]).typed.map((hold) => hold.accountType)).toEqual(["savings"]);
  });

  it("every hold read selects the stored document, so the keep-live list can match (#1653 review)", async () => {
    const reads: string[] = [];
    const db = vi.fn((strings: TemplateStringsArray) => {
      const text = strings.join("?");
      if (/^\s*SELECT/.test(text)) reads.push(text);
      return Promise.resolve([]);
    }) as unknown as Parameters<typeof applyAccountTypeHold>[0];
    await applyAccountTypeHold(db, { runId: 1, batchId: "agentic-run-1", dryRun: true });
    expect(reads.length).toBeGreaterThanOrEqual(3);
    // In each read's own select list (before its first FROM), not only somewhere in the query:
    // the third read also names it in its LATERAL text lookup.
    for (const text of reads) expect(text.split(/\bFROM\b/)[0]).toMatch(/\bfr\.source_document_id\b/);
  });

  it("scopes all three reads to one bank when given an institution, and to none otherwise (publish-sweeps review)", async () => {
    const reads: Array<{ text: string; values: unknown[] }> = [];
    const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join("?");
      if (/^\s*SELECT/.test(text)) reads.push({ text, values });
      return Promise.resolve([]);
    }) as unknown as Parameters<typeof applyAccountTypeHold>[0];
    await applyAccountTypeHold(db, { runId: 1, batchId: "agentic-run-1", dryRun: true, institutionId: 77 });
    expect(reads).toHaveLength(3);
    for (const read of reads) {
      expect(read.text).toMatch(/\?::bigint IS NULL OR f[pv]\.institution_id = \?::bigint/);
      expect(read.values.filter((value) => value === 77)).toHaveLength(2);
    }
    reads.length = 0;
    await applyAccountTypeHold(db, { runId: 1, batchId: "agentic-run-1", dryRun: true });
    for (const read of reads) expect(read.values.filter((value) => value === null)).toHaveLength(2);
  });
});

describe("account type hold: the table column of a row with no product (#1672)", () => {
  // Lower East Side People's FCU (inst 6748), doc 3089 / text 7104 (shortened): live 135709, raw 155829.
  const TEXT = [
    "Dividend Rates",
    "Savings Account | Checking Account | Money Market | Certificate Accounts | Holiday Account",
    "0% | 0% | 0.50% APY | 0.50% APY - 6m 0.75% APY - 12m | 1% APY Rates are subject to change",
    "Does not earn dividends | Does not earn dividends | Earn dividends | Earn dividends | Highest dividends",
    "Min Balance: $75.00 | Min Balance: None | Min Balance: $1,000.00 | Min Balance: Entire Deposit | Min Balance: $15.00",
    "No monthly fee, if the Min balance is maintained; otherwise $3.00 | No monthly fee | No monthly fee, if the Min balance is maintained; otherwise $10.00 | No monthly fee | No monthly fee",
  ].join("\n");
  const NOTE = "Knox deterministic extraction from Rosetta artifact #7104. canonical_hint=monthly_maintenance; text_hash=a8cb; excerpt=\"No monthly fee | No monthly fee, if the Min balance is maintained; otherwise $10.00\"";
  const ROW: HoldRow = { fee_published_id: 135709, fee_verified_id: 34734, institution_id: 6748, fee_name: "No monthly fee", product_name: null, amount: "10.00", source_document_id: 3089, institution_name: "Lower East Side People's FCU" };
  const CHECKING: HoldRow = { fee_published_id: 77, fee_verified_id: 78, institution_id: 1, fee_name: "Monthly fee", product_name: null, amount: "5.00", source_document_id: 2 };
  const CHECKING_TEXT = "Account | Basic Checking\nMonthly fee | $5.00";
  const CHECKING_NOTE = "Knox deterministic extraction. canonical_hint=monthly_maintenance; excerpt=\"Monthly fee | $5.00\"";

  it("is off until a sample of the dry run is read clean", () => {
    expect(ACCOUNT_TYPE_COLUMN_READ_LIVE).toBe(false);
  });

  it("types a row with no product by the account its table column names", () => {
    const read = { fee_verified_id: 34734, note: NOTE, normalized_text: TEXT };
    expect(columnProductOf(ROW, read)).toBe("Money Market");
    const plan = planColumnHolds([ROW], new Map([[34734, read]]));
    expect(plan.typed.map((hold) => [hold.feePublishedId, hold.accountType, hold.productName])).toEqual([[135709, "money_market", "Money Market"]]);
    // No stored text, no stored line, or a line that is no table row: nothing.
    expect(columnProductOf(ROW, { ...read, normalized_text: null })).toBeNull();
    expect(columnProductOf(ROW, { ...read, note: "canonical_hint=monthly_maintenance;" })).toBeNull();
    expect(columnProductOf(ROW, { ...read, note: "excerpt=\"No monthly fee, if the Min balance is maintained; otherwise $10.00\"" })).toBeNull();
    // A checking column stays untyped.
    expect(planColumnHolds([CHECKING], new Map([[78, { fee_verified_id: 78, note: CHECKING_NOTE, normalized_text: CHECKING_TEXT }]])).untyped).toEqual([CHECKING]);
  });

  function fakeDb(state: { flags: Map<number, string[]>; calls: string[] }) {
    return vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join("?");
      state.calls.push(text);
      if (text.includes("UPDATE published_fee_records")) return Promise.resolve((values[1] as number[]).map((id) => ({ fee_published_id: id })));
      if (text.includes("UPDATE verified_fee_observations")) {
        const [, ids, types] = values as [string, number[], string[]];
        ids.forEach((id, index) => state.flags.set(Number(id), [...(state.flags.get(Number(id)) ?? []), types[index]]));
        return Promise.resolve([]);
      }
      if (text.includes("FROM published_fee_records fp")) return Promise.resolve([ROW, CHECKING]);
      if (text.includes("LIKE '%excerpt=%|%'")) {
        return Promise.resolve([
          { fee_verified_id: 34734, note: NOTE, source_document_id: 3089 },
          { fee_verified_id: 78, note: CHECKING_NOTE, source_document_id: 2 },
        ].filter((row) => !(state.flags.get(row.fee_verified_id) ?? []).includes(ACCOUNT_TYPE_COLUMN_CHECKED_FLAG)));
      }
      if (text.includes("DISTINCT ON (t.source_document_id)")) return Promise.resolve([{ source_document_id: 3089, normalized_text: TEXT }, { source_document_id: 2, normalized_text: CHECKING_TEXT }]);
      return Promise.resolve([]);
    }) as unknown as Parameters<typeof applyAccountTypeHold>[0];
  }

  it("switched off: a dry run reports the hold, a real run reads no text and changes nothing", async () => {
    const state = { flags: new Map<number, string[]>(), calls: [] as string[] };
    const dry = await applyAccountTypeHold(fakeDb(state), { runId: 1, batchId: "agentic-run-1", dryRun: true });
    expect(dry.heldLive).toEqual([]);
    expect(dry.columnShadow.map((hold) => [hold.feePublishedId, hold.accountType])).toEqual([[135709, "money_market"]]);
    expect(dry.recheckNoProduct).toBe(2);
    state.calls.length = 0;
    const real = await applyAccountTypeHold(fakeDb(state), { runId: 2, batchId: "agentic-run-2", dryRun: false });
    expect(real.heldLive).toEqual([]);
    expect(real.columnShadow).toEqual([]);
    expect(state.calls.some((text) => text.includes("DISTINCT ON (t.source_document_id)") || text.includes("LIKE '%excerpt=%|%'") || /UPDATE|INSERT/.test(text))).toBe(false);
  });

  it("switched on: takes the fee down by its column's type and reads an untyped row's text once", async () => {
    const state = { flags: new Map<number, string[]>(), calls: [] as string[] };
    const db = fakeDb(state);
    const first = await applyAccountTypeHold(db, { runId: 1, batchId: "agentic-run-1", dryRun: false, columnLive: true });
    expect(first.heldLive.map((hold) => [hold.feePublishedId, hold.accountType, hold.productName])).toEqual([[135709, "money_market", "Money Market"]]);
    expect(state.flags.get(34734)).toEqual(["account_type:money_market"]);
    // The checking row keeps waiting for a product, and its text is not read again.
    expect(state.flags.get(78)).toEqual([ACCOUNT_TYPE_COLUMN_CHECKED_FLAG]);
    expect(first.recheckNoProduct).toBe(1);
    const update = state.calls.find((text) => text.includes("UPDATE published_fee_records"));
    expect(update).toBeDefined();
  });
});
