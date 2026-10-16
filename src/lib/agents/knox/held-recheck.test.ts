import { describe, expect, it, vi } from "vitest";

import { runFreeSpecialists } from "./specialists";
import { classifyFeeText, KNOX_HELD_NAME_RULES_LIVE } from "./rules";

import {
  fileHeldByName,
  nameFileCheckedFlag,
  footnoteFreeName,
  FOOTNOTE_FREE_NAME_SQL,
  NAME_FILE_KEY_VERSION,
  nameFileHold,
  HELD_SET_ASIDE_FLAG,
  heldNameRelease,
  previewHeldNameRules,
  heldExcerpt,
  heldHint,
  heldConditions,
  heldRecheckFlag,
  promotedConditions,
  promotedName,
  promotionCheckedFlag,
  promotionWithdrawnFlag,
  recategorizeHeld,
  recheckHeldRows,
  recheckPromotedRows,
  recheckSupersededRows,
  recheckUntracedRows,
  refiledConditions,
  refiledFlags,
  refiledRead,
  isRangeBand,
  RANGE_BAND_FLAG,
  RANGE_BAND_SET_ASIDE_BY_FLAG,
  RANGE_BAND_SET_ASIDE_LIVE,
  setAsideRangeBands,
  refileSupersededRows,
  STALE_HINT_REPAIRED_FLAG,
  supersededConditions,
  supersededRefileFlag,
  supersededDryReadFlag,
  supersededRecheckFlag,
  supersededWouldPromoteFlag,
  tracedRead,
  untracedRecheckFlag,
  versionsChecked,
} from "./held-recheck";

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

const conditions = (excerpt: string) =>
  `Knox held for review (unclassified) from Rosetta artifact #704. canonical_hint=none; text_hash=abc; excerpt="${excerpt}"`;

// Production rows an older rules version held (raw 118567, 109417, 109151). A membership
// fee has no category, so it stays held; this one was already read by two versions.
const courtesyPay = { fee_raw_id: 118567, amount: "30.00", conditions: conditions("Courtesy Pay Fee | $30") };
const inactivity = {
  fee_raw_id: 109417,
  amount: "5.00",
  conditions: conditions("Inactivity fee ...................$5.00 per month"),
};
const returnedMail = { fee_raw_id: 109151, amount: "5.00", conditions: conditions("Returned Mail Fee | $5.00/month") };
const membership = {
  fee_raw_id: 109152,
  amount: "5.00",
  fee_name: "Membership Fee",
  conditions: conditions("Membership Fee | $5.00"),
  outlier_flags: ["knox_review:unclassified", "knox_recheck:extract.rules:v20", "knox_recheck:extract.rules:v24"],
};

type Db = Parameters<typeof recheckHeldRows>[0];

function createDb(rows: unknown[]) {
  const db = vi.fn((strings: TemplateStringsArray) => {
    const text = templateText(strings);
    if (text.includes("SELECT fr.fee_raw_id")) return Promise.resolve(rows);
    if (text.includes("RETURNING fr.fee_raw_id")) return Promise.resolve([{ fee_raw_id: 1 }]);
    if (text.includes("to_regclass")) return Promise.resolve([{ ready: true }]);
    if (text.includes("INSERT INTO pipeline_feedback")) return Promise.resolve([{ id: 1 }]);
    return Promise.resolve([]);
  });
  return db;
}

describe("Knox held-line re-check", () => {
  it("reads the excerpt Knox stored with a held row", () => {
    expect(heldExcerpt(courtesyPay.conditions)).toBe("Courtesy Pay Fee | $30");
    expect(heldExcerpt("no excerpt here")).toBeNull();
  });

  it("categorizes held lines today's rules know, at the same amount", () => {
    expect(recategorizeHeld(courtesyPay)?.canonicalHint).toBe("overdraft");
    expect(recategorizeHeld(inactivity)?.canonicalHint).toBe("dormant_account");
    // v26 folds returned mail into account research (James, Oct 7 2026).
    expect(recategorizeHeld(returnedMail)?.canonicalHint).toBe("account_research");
    expect(recategorizeHeld(membership)).toBeNull();
    expect(recategorizeHeld({ ...courtesyPay, amount: "35.00" })).toBeNull();
  });

  it("v34 promotes a held range that says the bank lowered the price, at the stored amount", () => {
    const rangeConditions = (excerpt: string) =>
      `Knox held for review (range) from Rosetta artifact #9. canonical_hint=overdraft; text_hash=abc; excerpt="${excerpt}"`;
    const lowered = { fee_raw_id: 321489, amount: "30.00", conditions: rangeConditions("- We've lowered Overdraft Paid Item fees from $38 to $30 for ***all*** clients.") };
    const raised = { fee_raw_id: 118307, amount: "4.00", conditions: rangeConditions("The return mail fee increased from $4 to $5.") };
    expect(recategorizeHeld(lowered)?.canonicalHint).toBe("overdraft");
    expect(promotedConditions(lowered.conditions, recategorizeHeld(lowered)!)).toMatch(/^Knox extract\.rules v\d+ categorized a line held for review/);
    expect(recategorizeHeld(raised)).toBeNull();
  });

  it("v34 names a promoted line from today's read when its held name does not say the category", () => {
    const park = {
      fee_raw_id: 1,
      amount: "35.00",
      fee_name: "You still pay",
      conditions: conditions("You still pay a fee of $35 per item for overdrawing your account, but your transaction will go through."),
    };
    const candidate = recategorizeHeld(park)!;
    expect(promotedName(park, candidate)).toBe("Overdraft fee (per item for overdrawing your account)");
    expect(promotedName({ ...courtesyPay, fee_name: "Courtesy Pay Fee" }, recategorizeHeld(courtesyPay)!)).toBe("Courtesy Pay Fee");
  });

  it("rewrites the audit text with the category", () => {
    const candidate = recategorizeHeld(courtesyPay)!;
    const text = promotedConditions(courtesyPay.conditions, candidate);
    expect(text).toMatch(/^Knox extract\.rules v\d+ categorized a line held for review from Rosetta artifact #704/);
    expect(text).toContain("canonical_hint=overdraft;");
    expect(text).toContain("text_hash=abc;");
  });

  it("counts the rules versions that have read a held line", () => {
    expect(versionsChecked(membership, 25)).toEqual([20, 24, 25]);
    expect(versionsChecked(courtesyPay, 25)).toEqual([25]);
  });

  it("sends categorized lines to Darwin, sets aside lines read by three versions, and logs every decision", async () => {
    const db = createDb([courtesyPay, inactivity, membership]);
    const result = await recheckHeldRows(db as unknown as Db, { stateCode: "tx", runId: 7 });
    expect(result).toEqual({
      checked: 3,
      promoted: 2,
      stillHeld: 1,
      setAside: 1,
      logged: 1,
      promotedByCategory: { overdraft: 1, dormant_account: 1 },
      dryRun: false,
    });
    const select = templateText(db.mock.calls[0][0]);
    expect(select).toContain("knox_review:unclassified");
    expect(select).toContain("FROM agent_source_texts adt");
    expect(db.mock.calls[0]).toContain("TX");
    const calls = db.mock.calls.map((call) => ({ text: templateText(call[0]), json: JSON.stringify(call) }));
    const promotions = calls.filter((call) => call.text.includes("RETURNING fr.fee_raw_id"));
    expect(promotions[0].json).toContain("canonical_hint:overdraft");
    expect(promotions[0].json).toContain("knox_promoted_from_held");
    const updates = calls.filter((call) => call.text.includes("UPDATE raw_fee_observations"));
    const marked = updates.find((call) => call.json.includes(heldRecheckFlag()));
    expect(marked?.json).toContain("109152");
    const setAside = updates.find((call) => call.json.includes(HELD_SET_ASIDE_FLAG));
    expect(setAside?.json).toContain("109152");
    // Nothing is deleted.
    expect(calls.some((call) => /\bDELETE\b/i.test(call.text))).toBe(false);
    const log = calls.find((call) => call.text.includes("INSERT INTO pipeline_feedback"));
    expect(log?.json).toContain("knox.held:raw:118567");
    expect(log?.json).toContain("promoted_from_held");
    expect(log?.json).toContain("set_aside_no_category");
    expect(log?.json).toContain("[20,24,");
  });

  it("keeps a held line on hold when its promoted name is already a row of the same page (Guaranty, Oct 8)", async () => {
    const db = createDb([courtesyPay]);
    db.mockImplementation((strings: TemplateStringsArray) => {
      const text = templateText(strings);
      if (text.includes("SELECT fr.fee_raw_id")) return Promise.resolve([courtesyPay]);
      if (text.includes("to_regclass")) return Promise.resolve([{ ready: true }]);
      // The same page already has the promoted name at this price: no row is renamed.
      return Promise.resolve([]);
    });
    const result = await recheckHeldRows(db as unknown as Db, { stateCode: "tx", runId: 7 });
    expect(result.promoted).toBe(0);
    expect(result.stillHeld).toBe(1);
    const promotion = db.mock.calls.map((call) => templateText(call[0])).find((text) => text.includes("RETURNING fr.fee_raw_id"));
    expect(promotion).toContain("other.source_document_id = fr.source_document_id");
    expect(promotion).toContain("COALESCE(other.amount, -1) = COALESCE(fr.amount, -1)");
  });

  it("writes nothing on a dry run", async () => {
    const db = createDb([courtesyPay, membership]);
    const result = await recheckHeldRows(db as unknown as Db, { dryRun: true });
    expect(result).toMatchObject({ checked: 2, promoted: 1, stillHeld: 1, setAside: 1, logged: 0, dryRun: true });
    expect(db).toHaveBeenCalledTimes(1);
  });

  it("puts a promotion back on hold when today's rules no longer file it the same", async () => {
    // Raw 145118 (prod, Oct 7): v26 filed a collection phone call as check cashing.
    const promotedConditionsText =
      'Knox extract.rules v26 categorized a line held for review from Rosetta artifact #9. canonical_hint=check_cashing; text_hash=abc; excerpt="Phone Call Collection Fee | $10.00 per call"';
    const phoneCall = {
      fee_raw_id: 145118,
      amount: "10.00",
      fee_name: "Phone Call Collection Fee",
      conditions: promotedConditionsText,
      outlier_flags: ["needs_darwin_verification", "canonical_hint:check_cashing", "knox_promoted_from_held"],
    };
    const kept = {
      ...courtesyPay,
      conditions: promotedConditions(courtesyPay.conditions, recategorizeHeld(courtesyPay)!),
      outlier_flags: ["needs_darwin_verification", "canonical_hint:overdraft", "knox_promoted_from_held"],
    };
    expect(heldConditions(promotedConditionsText)).toBe(
      'Knox held for review (unclassified) from Rosetta artifact #9. canonical_hint=none; text_hash=abc; excerpt="Phone Call Collection Fee | $10.00 per call"',
    );
    const db = createDb([phoneCall, kept]);
    const result = await recheckPromotedRows(db as unknown as Db, { runId: 9 });
    expect(result).toEqual({ checked: 2, withdrawn: 1, withdrawnByCategory: { check_cashing: 1 }, logged: 1, dryRun: false });
    const calls = db.mock.calls.map((call) => ({ text: templateText(call[0]), json: JSON.stringify(call) }));
    expect(calls[0].text).toContain("FROM verified_fee_observations fv");
    // A rate fee has no dollar amount for these rules to price; it is never selected.
    expect(calls[0].json).toContain("knox_rate_fee");
    expect(calls[0].text).toContain("fr.amount IS NOT NULL");
    const withdraw = calls.find((call) => call.json.includes(promotionWithdrawnFlag()));
    expect(withdraw?.json).toContain("145118");
    expect(withdraw?.json).toContain("knox_review:unclassified");
    expect(withdraw?.text).toContain("- 'needs_darwin_verification'");
    const checked = calls.find((call) => call.json.includes(promotionCheckedFlag()) && call.text.includes("UPDATE"));
    expect(checked?.json).toContain("118567");
    expect(checked?.json).not.toContain("145118");
    const log = calls.find((call) => call.text.includes("INSERT INTO pipeline_feedback"));
    expect(log?.json).toContain("knox.held_withdrawn:raw:145118");
    expect(log?.json).toContain("promotion_withdrawn");
    expect(calls.some((call) => /\bDELETE\b/i.test(call.text))).toBe(false);
  });

  it("changes nothing on a dry run of the promotion re-check", async () => {
    const db = createDb([
      {
        fee_raw_id: 1,
        amount: "10.00",
        conditions: 'canonical_hint=check_cashing; excerpt="Phone Call Collection Fee | $10.00 per call"',
        outlier_flags: ["canonical_hint:check_cashing", "knox_promoted_from_held"],
      },
    ]);
    const result = await recheckPromotedRows(db as unknown as Db, { dryRun: true });
    expect(result).toMatchObject({ checked: 1, withdrawn: 1, logged: 0, dryRun: true });
    expect(db).toHaveBeenCalledTimes(1);
  });
});

describe("untraced held lines re-traced with today's rules (Arvest 78, raw 449097)", () => {
  const arvestText = [
    "| Fax Outgoing | Long Distance | $5.00 | per fax request |",
    `| Overdraft (OD) - Paid Item | A fee may be charged, when permitted by law, for each transaction presented to us for payment when the balance in your account after we post all credits and debits for the day ("Ledger Balance") is less than the amount we need to pay your transaction. For all consumer accounts, we will assess a maximum of four (4) OD fees per day. We do not charge a fee if we return the transaction unpaid. | $17.00 | per item |`,
    "| Stop Payment Order | Initial order or a renewal | $30.00 | per item |",
  ].join("\n");
  const untraced = {
    fee_raw_id: 449097,
    amount: "17.00",
    fee_name: "Overdraft (OD) - Paid Item",
    conditions: 'Knox held for review (untraced) from Rosetta artifact #20469. canonical_hint=overdraft; text_hash=948e; excerpt="count after we post all credits"',
    outlier_flags: ["knox_review:untraced"],
    document_text_id: 20469,
  };

  it("reads the held row's category", () => {
    expect(heldHint(untraced.conditions)).toBe("overdraft");
    expect(heldHint("canonical_hint=none; text_hash=abc;")).toBeNull();
  });

  it("promotes a row only when today's rules trace the same name, amount and category", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const db = vi.fn(async (strings: unknown, ...values: unknown[]) => {
      const text = templateText(strings);
      calls.push({ text, values });
      if (text.includes("FROM raw_fee_observations fr") && text.includes("knox_review:untraced") && text.includes("SELECT")) {
        return [untraced, { ...untraced, fee_raw_id: 449098, amount: "35.00" }];
      }
      if (text.includes("SELECT id, normalized_text")) return [{ id: 20469, normalized_text: arvestText }];
      if (text.includes("UPDATE raw_fee_observations fr")) return [{ fee_raw_id: values.at(-1) ?? 449097 }];
      return [];
    });

    const result = await recheckUntracedRows(db as never, { institutionId: 78 });

    expect(result).toEqual({ checked: 2, promoted: 1, stillHeld: 1, dryRun: false });
    const promote = calls.find((call) => call.text.includes("UPDATE raw_fee_observations fr"))!;
    expect(promote.values).toContain(449097);
    expect(JSON.stringify(promote.values)).toContain("needs_darwin_verification");
    const marked = calls.find((call) => call.text.includes("WHERE fee_raw_id = ANY"))!;
    expect(marked.values).toContainEqual([449098]);
    expect(JSON.stringify(marked.values)).toContain(untracedRecheckFlag());
  });

  it("leaves a row whose traced read has another name", () => {
    expect(tracedRead({ ...untraced, fee_name: "Overdraft fee" }, [
      { feeName: "Overdraft (OD) - Paid Item", amount: 17, canonicalHint: "overdraft", frequency: "per_item", confidence: 0.9, excerpt: "", waivable: false },
    ])).toBeNull();
  });
});

describe("lines a re-read retired, read again with today's rules (Northern Trust 25, raw 457013)", () => {
  const ntText = [
    "Legal Document Processing (Levies, Garnishments,",
    "Citations, Subpoenas, Liens, or other Court,",
    "Regulatory, or Administrative Orders)..................................$115.00",
    "Overdrafts Paid and Items Paid against Nonsufficient",
    "Funds (includes but not limited to overdrafts",
    "created by check, in-person withdrawals",
    "at a teller or recurring electronic",
    "debit card payments) ................................... $25.00 per Occurrence",
    "(maximum of 3 overdraft charges per day)",
    "Stop Payment Order............................................................ $30.00 per item",
  ].join("\n");
  const retired = {
    fee_raw_id: 457013,
    amount: "25.00",
    fee_name: "Overdrafts Paid and Items Paid against Nonsufficient Funds",
    conditions: 'Knox paid extraction from Rosetta artifact #20257. canonical_hint=overdraft; text_hash=27e2; excerpt="debit card payments) ... $25.00 per Occurrence"',
    outlier_flags: ["canonical_hint:overdraft", "knox_paid_extraction", "superseded_by_reread"],
    document_text_id: 20257,
    text_hash: "1f6e",
    has_live_twin: false,
  };
  const elsewhere = { ...retired, fee_raw_id: 457099, fee_name: "Courier Service", amount: "15.00", conditions: retired.conditions.replace("overdraft", "account_research") };

  function createSupersededDb(rows: unknown[]) {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const db = vi.fn(async (strings: unknown, ...values: unknown[]) => {
      const text = templateText(strings);
      calls.push({ text, values });
      if (text.includes("information_schema.columns")) return [{ ready: true }];
      if (text.includes("superseded_by_reread") && text.includes("SELECT fr.fee_raw_id")) return rows;
      if (text.includes("SELECT id, normalized_text")) return [{ id: 20257, normalized_text: ntText }];
      if (text.includes("RETURNING fr.fee_raw_id")) return [{ fee_raw_id: 457013 }];
      return [];
    });
    return { db, calls };
  }

  it("sends a retired line back to Darwin when today's rules read the same name, amount and category", async () => {
    const { db, calls } = createSupersededDb([retired, elsewhere]);

    const result = await recheckSupersededRows(db as never, { institutionId: 25, live: true });

    expect(result).toMatchObject({ checked: 2, promoted: 1, liveTwin: 0, notRead: 1, promotedIds: [457013], live: true });
    const select = calls.find((call) => call.text.includes("SELECT fr.fee_raw_id"))!;
    expect(select.values).toContain("knox_paid_extraction");
    const promote = calls.find((call) => call.text.includes("UPDATE raw_fee_observations fr"))!;
    expect(promote.values).toContain(457013);
    expect(JSON.stringify(promote.values)).toContain("needs_darwin_verification");
    expect(JSON.stringify(promote.values)).toContain("text_hash=1f6e;");
    const marked = calls.find((call) => call.text.includes("WHERE fee_raw_id = ANY"))!;
    expect(marked.values).toContainEqual([457099]);
    expect(JSON.stringify(marked.values)).toContain(supersededRecheckFlag());
  });

  it("reads free-pass rows a re-read retired by the same test, and only free-pass rows (#1093 step 2)", async () => {
    const free = { ...retired, conditions: retired.conditions.replace("Knox paid extraction", "Knox read a free fee"), outlier_flags: ["canonical_hint:overdraft", "superseded_by_reread"] };
    const { db, calls } = createSupersededDb([free, elsewhere]);

    const result = await recheckSupersededRows(db as never, { live: true, source: "free" });

    expect(result).toMatchObject({ checked: 2, promoted: 1, notRead: 1, promotedIds: [457013], source: "free" });
    const select = calls.find((call) => call.text.includes("SELECT fr.fee_raw_id"))!;
    expect(select.text).toContain("::boolean");
    expect(select.values).toContain("knox_paid_extraction");
    expect(select.values).toContain(false);
    expect(select.values).toContain(200);
    const promote = calls.find((call) => call.text.includes("UPDATE raw_fee_observations fr"))!;
    expect(JSON.stringify(promote.values)).toContain("needs_darwin_verification");
  });

  it("keeps reading only paid rows by default", async () => {
    const { db, calls } = createSupersededDb([]);
    await recheckSupersededRows(db as never, { live: true });
    const select = calls.find((call) => call.text.includes("SELECT fr.fee_raw_id"))!;
    expect(select.values).toContain(true);
    expect(select.values).toContain(100);
  });

  it("keeps a retired line back when the bank already has a live fee of that category at that price", async () => {
    const { db, calls } = createSupersededDb([{ ...retired, has_live_twin: true }]);

    const result = await recheckSupersededRows(db as never, { institutionId: 25, live: true });

    expect(result).toMatchObject({ checked: 1, promoted: 0, liveTwin: 1 });
    expect(calls.some((call) => call.text.includes("UPDATE raw_fee_observations fr"))).toBe(false);
  });

  it("only marks what it would do while the switch is off", async () => {
    const { db, calls } = createSupersededDb([retired, elsewhere]);

    const result = await recheckSupersededRows(db as never, { institutionId: 25, live: false });

    expect(result).toMatchObject({ checked: 2, promoted: 1, promotedIds: [457013], live: false });
    expect(calls.some((call) => call.text.includes("UPDATE raw_fee_observations fr"))).toBe(false);
    const flagged = JSON.stringify(calls.filter((call) => call.text.includes("WHERE fee_raw_id = ANY")).map((call) => call.values));
    expect(flagged).toContain(supersededDryReadFlag());
    expect(flagged).toContain(supersededWouldPromoteFlag());
  });

  it("reads nothing before the current-copy migration", async () => {
    const db = vi.fn(async (strings: unknown) => (templateText(strings).includes("information_schema.columns") ? [{ ready: false }] : []));

    expect(await recheckSupersededRows(db as never, { live: true })).toMatchObject({ checked: 0, promoted: 0 });
    expect(db).toHaveBeenCalledTimes(1);
  });

  it("gives the row the current text's hash so the next re-read keeps it", () => {
    expect(supersededConditions(retired.conditions, "1f6e", 20257)).toContain("text_hash=1f6e;");
    expect(supersededConditions(retired.conditions, "1f6e", 20257)).not.toContain("text_hash=27e2;");
  });
});

describe("retired lines today's rules file under another category (#1093, Oregonians CU, document 13279)", () => {
  // Lines from the stored text of Oregonians CU's schedule (agent_source_texts, document 13279),
  // read 14 Oct. The rows below were retired by a re-read under the categories an older version gave.
  const oregonians = [
    "Dormant Account $10/month | Account Balance Requirements",
    "Bad Address/Returned Mail $10 Business Money Market Service Charge $10/month",
    "Up to one fee can be waived after the address is updated, if requested. | Charged monthly if balance falls below $5,000 during statement period.",
    "Accounts & Services",
    "Overdraft Transfers $10 | Cards & ATMs",
    "First three per month are free. Card Replacement $10",
    "Stop Payment $25 Card Rush Order Market Cost",
    "Insufficient Funds",
    "Foreign Deposit Items Over $300 $50 Returned Item $15",
    "We can't accept foreign deposit items under $300. | Charged when a check, EFT or ACH item from another institution is",
    "cashed or deposited into an account, then returned unpaid.",
    "Incoming Wires $10",
    "NSF Item Paid $20",
  ].join("\n");
  const retiredRow = (id: number, name: string, amount: string, hint: string) => ({
    fee_raw_id: id,
    institution_id: 8600,
    source_document_id: 13279,
    fee_name: name,
    amount,
    conditions: `Knox deterministic extraction from Rosetta artifact #9001. canonical_hint=${hint}; text_hash=a1d1; excerpt="${name} $${amount}"`,
    outlier_flags: [`canonical_hint:${hint}`, "superseded_by_reread", supersededRecheckFlag()],
    document_text_id: 9001,
    text_hash: "be2f",
    darwin_decided: false,
  });
  const cardReplacement = retiredRow(105836, "Card Replacement", "10.00", "atm_non_network");
  const incomingWires = retiredRow(105838, "Incoming Wires", "10.00", "nsf");
  const badAddress = retiredRow(105835, "Bad Address/Returned Mail", "10.00", "monthly_maintenance");
  const foreignDeposit = retiredRow(105837, "Foreign Deposit Items Over", "300.00", "nsf");
  const reads = () => runFreeSpecialists(oregonians).candidates;

  it("finds today's category for a real fee read under the same name and amount", () => {
    expect(refiledRead(cardReplacement, reads())?.canonicalHint).toBe("card_replacement");
    expect(refiledRead(incomingWires, reads())?.canonicalHint).toBe("wire_domestic_incoming");
    expect(refiledRead(badAddress, reads())?.canonicalHint).toBe("account_research");
  });

  it("does not bring back a threshold today's rules no longer read as a fee", () => {
    expect(refiledRead(foreignDeposit, reads())).toBeNull();
  });

  it("leaves a row today's rules read under its own category to the superseded re-check", () => {
    const read = reads().find((candidate) => candidate.feeName === "Overdraft Transfers");
    expect(read).toBeDefined();
    expect(refiledRead(retiredRow(118488, "Overdraft Transfers", "10.00", read!.canonicalHint), reads())).toBeNull();
  });

  it("files the row under today's category, keeps the old one for reversal, and drops the retired flag", () => {
    const flags = refiledFlags(cardReplacement.outlier_flags, "card_replacement", "atm_non_network");
    expect(flags[0]).toBe("needs_darwin_verification");
    expect(flags.filter((flag) => flag.startsWith("canonical_hint:"))).toEqual(["canonical_hint:card_replacement"]);
    expect(flags).toContain("knox_refiled_from:atm_non_network");
    expect(flags).toContain("knox_promoted_from_superseded");
    expect(flags).not.toContain("superseded_by_reread");
    const audit = refiledConditions(cardReplacement.conditions, "card_replacement", "be2f", 9001);
    expect(audit).toContain("canonical_hint=card_replacement;");
    expect(audit).toContain("text_hash=be2f;");
    expect(audit).not.toContain("atm_non_network");
  });

  function createRefileDb(rows: unknown[], twins: unknown[] = [], stale: unknown[] = []) {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const db = vi.fn(async (strings: unknown, ...values: unknown[]) => {
      const text = templateText(strings);
      calls.push({ text, values });
      if (text.includes("information_schema.columns")) return [{ ready: true }];
      if (text.includes("jsonb_build_array")) return stale;
      if (text.includes("knox_reread_took_over")) return stale;
      if (text.includes("darwin_decided")) return rows;
      if (text.includes("SELECT id, normalized_text")) return [{ id: 9001, normalized_text: oregonians }];
      if (text.includes("jsonb_to_recordset")) return twins;
      if (text.includes("RETURNING fr.fee_raw_id")) return [{ fee_raw_id: values.find((value) => typeof value === "number") }];
      return [];
    });
    return { db, calls };
  }

  it("reads a sample and writes nothing while the switch is off, a new sample each hour", async () => {
    const counted = { ...cardReplacement, total: 1336, decided_total: 881, institutions: 317 };
    const { db, calls } = createRefileDb([counted, incomingWires]);

    const result = await refileSupersededRows(db as never, { live: false, now: new Date("2026-10-14T12:34:00Z") });

    expect(result).toMatchObject({
      live: false, dryRun: true, mode: "sample", candidates: 1336, candidateInstitutions: 317, candidatesDarwinDecided: 881,
      checked: 2, refiled: 2,
    });
    const select = calls.find((call) => call.text.includes("darwin_decided"))!;
    expect(select.values).toContain("2026-10-14T12");
    expect(select.values).toContain(25);
    expect(calls.some((call) => call.text.includes("UPDATE"))).toBe(false);
  });

  it("reads nothing in a state lane while the switch is off, and only the lane's state when it reads", async () => {
    const { db, calls } = createRefileDb([cardReplacement]);
    const skipped = await refileSupersededRows(db as never, { live: false, stateCode: "or", skipSample: true });
    expect(skipped).toMatchObject({ mode: "skipped", checked: 0, candidates: 0 });
    expect(calls).toHaveLength(0);

    await refileSupersededRows(db as never, { live: false, dryRun: true, stateCode: "or", skipSample: true });
    const select = calls.find((call) => call.text.includes("darwin_decided"))!;
    expect(select.text).toContain("inst.state_code");
    expect(select.values).toContain("OR");
    const stale = calls.find((call) => call.text.includes("knox_reread_took_over"))!;
    expect(stale.values).toContain("OR");
  });

  it("reports what it would do in a dry-run extract while off, and writes nothing", async () => {
    const decided = { ...retiredRow(105900, "Statement Copy", "5.00", "paper_statement"), darwin_decided: true };
    const { db, calls } = createRefileDb([cardReplacement, incomingWires, badAddress, foreignDeposit, decided], [], [{ fee_raw_id: 126752 }]);

    const result = await refileSupersededRows(db as never, { live: false, dryRun: true });

    expect(result).toMatchObject({ live: false, dryRun: true, checked: 5, refiled: 3, notRead: 1, darwinDecided: 1, liveTwin: 0, staleHintRows: 1, staleHintRepaired: 0 });
    expect(result.sample.map((row) => `${row.fee_name}:${row.from}->${row.to}`)).toEqual([
      "Card Replacement:atm_non_network->card_replacement",
      "Incoming Wires:nsf->wire_domestic_incoming",
      "Bad Address/Returned Mail:monthly_maintenance->account_research",
    ]);
    expect(calls.some((call) => call.text.includes("UPDATE"))).toBe(false);
  });

  it("re-files and marks rows when live, keeping back a fee whose new category already has a live twin", async () => {
    const twin = [{ institution_id: 8600, fee_category: "card_replacement", amount: "10.00" }];
    const { db, calls } = createRefileDb([cardReplacement, incomingWires], twin, [{ fee_raw_id: 126752 }]);

    const result = await refileSupersededRows(db as never, { live: true });

    expect(result).toMatchObject({ live: true, dryRun: false, checked: 2, refiled: 1, liveTwin: 1, refiledIds: [105838], staleHintRows: 1, staleHintRepaired: 1 });
    const refile = calls.find((call) => call.text.includes("UPDATE raw_fee_observations fr") && call.values.includes(105838))!;
    expect(JSON.stringify(refile.values)).toContain("canonical_hint:wire_domestic_incoming");
    expect(JSON.stringify(refile.values)).toContain("knox_refiled_from:nsf");
    const marked = calls.find((call) => call.text.includes("WHERE fee_raw_id = ANY") && !call.text.includes("jsonb_build_array"))!;
    expect(marked.values).toContainEqual([105836, 105838]);
    expect(JSON.stringify(marked.values)).toContain(supersededRefileFlag());
    const repair = calls.find((call) => call.text.includes("jsonb_build_array"))!;
    expect(JSON.stringify(repair.values)).toContain(STALE_HINT_REPAIRED_FLAG);
  });
});

// #1102 (K9): production held lines (raw ids), read 14 Oct 2026.
describe("held-name rules for unclassified held lines (#1102)", () => {
  const held = (fee_raw_id: number, amount: string, fee_name: string, excerpt: string) => ({
    fee_raw_id, amount, fee_name, conditions: conditions(excerpt), institution_id: 7, outlier_flags: ["knox_review:unclassified", HELD_SET_ASIDE_FLAG],
  });
  const stopPay = held(265119, "30.00", "Stop Pay Fee", "Stop Pay Fee | $30.00 per item");
  const heloc = held(337301, "500.00", "Early closure fee", "Early closure fee of $500 may apply");

  it.each([
    [stopPay, "stop_payment"],
    [held(653776, "95.00", "Deed of Trust Reconveyance Fee", "Deed of Trust Reconveyance Fee | $95.00"), "reconveyance"],
    [held(295678, "5.00", "Early closure fee (90 days)", "Early closure fee (90 days) | $5.00"), "early_closure"],
    [held(643931, "10.00", "Christmas Club Withdrawal Fee", "Christmas Club Withdrawal Fee | $10.00"), "early_closure"],
    // Returned mail is account research (fee-fold.ts), tracing the new address too.
    [held(163946, "3.00", "Returned Statement Fee", "Returned Statement Fee | $3 | per statement"), "account_research"],
    [held(219557, "25.00", "Returned statements after 3, tracer fee", "Returned statements after 3, tracer fee | $25.00"), "account_research"],
    [held(678207, "5.00", "Printed / Mailed Monthly Statement Fee", "Printed / Mailed Monthly Statement Fee | $5.00"), "paper_statement"],
    [held(341058, "25.00", "IRA Early Closeout Fee", "IRA Early Closeout Fee . . . . . . . . $25"), "ira_termination"],
    [held(227987, "100.00", "IRA Account Early Withdrawal Fee", "IRA Account Early Withdrawal Fee | $100.00 per withdrawal"), "ira_distribution"],
    [held(472697, "95.00", "7″x10″ Rental", "7″x10″ Rental | $95.00 annual charge (Eldersburg Location Only)"), "safe_deposit_box"],
    // A HELOC's early closure fee (Great Southern Bank) and a mortgage's 36-month one stay held.
    [heloc, null],
    [held(480501, "750.00", "If you terminate your account within 36 months of opening it, you will be required to pay an early closure fee of", "If you terminate your account within 36 months of opening it, you will be required to pay an early closure fee of $750 plus any mortgage and government taxes"), null],
    [held(1, "350.00", "Early Closure Fee (Home Equities only)", "Early Closure Fee (Home Equities only) | $350.00 | First 2 years."), null],
    // A club line that names no fee (the Texas key leaves it unmapped).
    [held(3, "2.50", "Christmas Club (withdrawals free Oct.1 – Jan.1)", "Christmas Club (withdrawals free Oct.1 – Jan.1) | $2.50"), null],
    // A bare wire line often says incoming or international after its price.
    [held(2, "35.00", "Wire Transfer Fee", "Wire Transfer Fee | $35.00 per International outgoing wire transfer"), null],
    [returnedMail, null],
  ] as const)("files held line %# under its own name's category, or keeps it held", (row, category) => {
    const release = heldNameRelease(row);
    expect(release?.candidate.canonicalHint ?? null).toBe(category);
    if (category) expect(release?.passChecks).toBe(true);
  });

  it("is switched off: today's rules and the held re-check read these names as before", () => {
    expect(KNOX_HELD_NAME_RULES_LIVE).toBe(false);
    expect(classifyFeeText("Stop Pay Fee")).toBeNull();
    expect(recategorizeHeld(stopPay)).toBeNull();
  });

  it("counts what would go to Darwin and writes nothing", async () => {
    const db = createDb([stopPay, heloc, courtesyPay]);
    const result = await previewHeldNameRules(db as never);
    expect(result).toMatchObject({
      live: false, candidates: 3, wouldRelease: 1, passChecks: 1, setAside: 1, institutions: 1, byCategory: { stop_payment: 1 },
      examples: [{ feeRawId: 265119, feeName: "Stop Pay Fee", amount: 30, category: "stop_payment" }],
    });
    expect(db.mock.calls.some(([strings]) => /UPDATE|INSERT/.test(templateText(strings)))).toBe(false);
  });
});

// #1102: one decision per held name. Production held lines (raw ids), read 15 Oct 2026.
describe("held lines filed by their name: a person's label or the store's settled name (#1102)", () => {
  const held = (fee_raw_id: number, amount: string, fee_name: string, excerpt: string, filed_key: string, filed_by: "label" | "store" = "store") => ({
    fee_raw_id, amount, fee_name, conditions: conditions(excerpt), institution_id: 9, source_document_id: 40, filed_key, filed_by, settled_banks: 12,
    // The settled category's live p5 to p95, weighted by row.
    range_p5: "1.00", range_p95: "60.00",
    outlier_flags: ["knox_review:unclassified", HELD_SET_ASIDE_FLAG],
  });
  const returnedStatement = held(200601, "10.00", "Returned Statement Fee", "Returned Statement Fee** | $10.00", "account_research");
  const membership = held(109152, "5.00", "Membership Fee", "Membership Fee | $5.00", "account_research", "label");
  const cashAdvance = held(186564, "3.00", "Credit Card Cash Advance Fee", "$3.00 | Credit Card Cash Advance Fee | 2%", "cash_advance");

  it.each([
    [returnedStatement, null],
    [held(655954, "45.00", "Rush Fee", "Rush Fee | $45.00/card", "rush_card"), null],
    // A rate, or a price for a bundle, is not a plain price.
    [cashAdvance, "not_a_plain_price"],
    [held(300157, "2.00", "Temporary Checks Fee", "Temporary Checks Fee | 4 for $2 | Instant Issue Replacement Fee | $5", "counter_check"), "not_a_plain_price"],
    // Review of #1385: a balance to keep is never a fee by name, and a box size's name key is "x".
    [held(258596, "5.00", "Minimum balance", "Minimum balance: $5 to avoid fees", "minimum_balance"), "not_a_fee_name"],
    [held(188396, "1.00", "Minimum Balance", "Minimum Balance | $1.00 | Mortgage Subordination Preparation Fee | $150.00", "minimum_balance"), "not_a_fee_name"],
    [held(677867, "40.00", "3″ x 10″", "3″ x 10″ | $40.00 annual fee", "safe_deposit_box"), "name_too_short"],
    [held(270231, "10.00", "Monthly Maintenance Fee", "Monthly Maintenance Fee | None | None | $10.00 fee can be avoided by maintaining a $1,500.00 average daily collected balance", "monthly_maintenance"), "requirement_line"],
    // One column of a table of four accounts.
    [held(361489, "7.00", "Monthly Maintenance Fee", "Monthly Maintenance Fee | None | $7.00 | $10.00 | $10.00 | $5.00", "monthly_maintenance"), "several_price_columns"],
    // A person's label files a name that does not say fee; the store never does.
    [{ ...held(687157, "5.00", "Collection Item", "Collection Item | fee charged for payment of a draft held until funds are available | $5.00", "collection_item"), filed_by: "label" as const }, null],
    [held(687158, "5.00", "Collection Item", "Collection Item | fee charged for payment of a draft held until funds are available | $5.00", "collection_item"), "not_a_fee_name"],
    // Live as other lending at 70 banks, but a subordination files as legal process since Oct 15.
    [held(441210, "150.00", "Subordination Fee", "Subordination Fee | $150.00", "other_lending_fee"), "name_reads_other_category"],
    // The $10 is the row before's monthly fee; the paper statement fee is $2.50.
    [held(421833, "10.00", "Paper Statement Fee (per Statement)", "• $10.00/month if none of the above criteria are met. | Paper Statement Fee (per Statement) | $2.50", "paper_statement"), "price_not_under_name"],
    // Outside the category's live spread (p5 to p95, weighted by row).
    [held(200602, "500.00", "Returned Statement Fee", "Returned Statement Fee | $500.00", "account_research"), "outside_category_range"],
    // Second review of #1385: the price is the next fee's, or the line contradicts the store's category.
    [held(506621, "1.00", "Overdraft Transfer Fee", "Overdraft Transfer Fee (Applicable to overdraft transfers generated automatically | Inquiry Fee12. . . . . . . . $1.00 per transaction inquiry", "od_protection_transfer"), "price_not_under_name"],
    [held(114480, "2.00", "Statement Fee", "Statement Fee | $2.00/Copy", "paper_statement"), "line_contradicts_category"],
    [held(108501, "10.00", "Temporary Lien Fee", "Temporary Lien Fee: $10.00 for all collateral titled in Tennessee", "legal_process"), "line_contradicts_category"],
    [{ ...held(337301, "500.00", "Early closure fee", "Early closure fee of $500 may apply", "early_closure"), range_p95: "50.00" }, "outside_category_range"],
    // A description cell ("Fee charged when ...") is not another fee's name.
    // The clause holding the price is another fee's: an early-withdrawal penalty under a maintenance name.
    [held(454145, "25.00", "Monthly Service Charge", "Monthly Service Charge¹ | None. A $25 fee will be assessed for early withdrawals", "monthly_maintenance"), "price_names_other_fee"],
    [held(454146, "25.00", "Early Withdrawal Fee", "Early Withdrawal Fee | A $25 fee will be assessed for early withdrawals", "early_closure"), null],
    [held(680394, "40.00", "STOP PAYMENT FEE", "STOP PAYMENT FEE | Fee charged when you request to refuse payment for a check or ACH transaction | $40.00", "stop_payment"), null],
    // A person's label is not held to the store's spread or wording checks.
    [{ ...held(337302, "500.00", "Early closure fee", "Early closure fee of $500 may apply", "early_closure", "label"), range_p95: null }, null],
  ])("decides whether a held line moves under its name's category (%#)", (row, hold) => {
    expect(nameFileHold(row)).toBe(hold);
  });

  it("sends labelled and settled names to Darwin, marks the ones that stay, and logs each move", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const db = Object.assign(
      vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
        const text = templateText(strings);
        calls.push({ text, values });
        if (text.includes("to_regclass")) return Promise.resolve([{ ready: true }]);
        if (text.includes("RETURNING fr.fee_raw_id")) return Promise.resolve([{ fee_raw_id: values.find((value) => typeof value === "number") }]);
        if (text.includes("INSERT INTO pipeline_feedback")) return Promise.resolve([{ id: 1 }]);
        return Promise.resolve([]);
      }),
      {
        unsafe: vi.fn((text: string, values: unknown[]) => {
          calls.push({ text, values });
          return Promise.resolve([returnedStatement, membership, cashAdvance]);
        }),
      },
    );
    const now = new Date("2026-10-15T12:00:00Z");
    expect(nameFileCheckedFlag(now)).toBe("knox_name_file_checked:k2:2026-W42");
    const result = await fileHeldByName(db as never, { stateCode: "tx", runId: 7, now });
    expect(result).toMatchObject({
      checked: 3, filed: 2, kept: { not_a_plain_price: 1 }, bySource: { label: 1, store: 1 }, byCategory: { account_research: 2 }, institutions: 1, dryRun: false,
    });
    const select = calls[0];
    // Settled names come from a hash join of live fees on the held rows' own names, and labels from
    // the feedback table's unique dedupe key, never a scan of either (review of #1385).
    expect(select.text).toContain("JOIN raw_names r ON r.raw_name = lower(btrim(p.fee_name))");
    // A footnoted held name also reaches the live fees printed without the mark (Oct 15).
    expect(select.text).toContain(`UNION\n        SELECT ${FOOTNOTE_FREE_NAME_SQL("fee_name")} FROM held`);
    expect(select.text).toContain("f.dedupe_key IN (SELECT DISTINCT 'knox.name_label:' || name FROM held");
    // Settled: 90% of the name's live rows in one category, at 5 banks (10 for two words), with the category's p5-p95.
    expect(select.text).toContain("WHERE n >= $5::numeric * total");
    expect(select.values).toEqual(expect.arrayContaining([0.9, 10, 5]));
    expect(select.text).toContain("percentile_cont(0.95)");
    expect(select.text).not.toContain("published_fee_catalog");
    expect(select.values).toEqual(expect.arrayContaining(["knox_name_file_checked:k2:2026-W42", 5, "name_label", "TX"]));
    const moves = calls.filter((call) => call.text.includes("RETURNING fr.fee_raw_id")).map((call) => JSON.stringify(call.values));
    expect(moves[0]).toContain("knox_name_filed:store");
    expect(moves[0]).toContain("canonical_hint:account_research");
    expect(moves[1]).toContain("knox_name_filed:label");
    // The line that stayed gets this week's mark, replacing an older week's; with every candidate
    // read, the lane's other held lines get it too, so the week's later steps read only new lines.
    const marked = calls.find((call) => call.text.includes("fr.fee_raw_id = ANY($2::bigint[])"))!;
    expect(marked.values).toEqual(["knox_name_file_checked:k2:2026-W42", [186564]]);
    expect(marked.text).toContain("NOT LIKE 'knox_name_file_checked:%'");
    const lane = calls.find((call) => call.text.includes("UPDATE raw_fee_observations fr") && call.text.includes("inst.state_code"))!;
    expect(lane.values).toEqual(["knox_name_file_checked:k2:2026-W42", "TX"]);
    expect(calls.find((call) => call.text.includes("INSERT INTO pipeline_feedback"))?.values.join("")).toContain("knox.held:raw:200601");
    expect(calls.some((call) => /\bDELETE\b/i.test(call.text))).toBe(false);

    calls.length = 0;
    const dry = await fileHeldByName(db as never, { dryRun: true });
    expect(dry).toMatchObject({ filed: 2, dryRun: true });
    expect(calls.some((call) => /UPDATE|INSERT/.test(call.text))).toBe(false);
  });
});

describe("held names with footnote marks (Oct 15, after #1385)", () => {
  it("drops a number glued to the first word and the marks †, ‡ and *", () => {
    expect(footnoteFreeName("1Monthly fee")).toBe("monthly fee");
    expect(footnoteFreeName("2Monthly fee")).toBe("monthly fee");
    expect(footnoteFreeName("3Dormant account fee")).toBe("dormant account fee");
    expect(footnoteFreeName("6Paper statement fee")).toBe("paper statement fee");
    expect(footnoteFreeName("Early Closure Fee‡")).toBe("early closure fee");
    expect(footnoteFreeName("Stop Payment Fee*")).toBe("stop payment fee");
    expect(footnoteFreeName("Wire Fee†")).toBe("wire fee");
    // A number that is part of the name, not glued to a word, stays.
    expect(footnoteFreeName("2 Statement Copies Fee")).toBe("2 statement copies fee");
    expect(footnoteFreeName("Monthly fee")).toBe("monthly fee");
  });

  it("writes the same rule in SQL", () => {
    const text = FOOTNOTE_FREE_NAME_SQL("fr.fee_name");
    expect(text).toBe("lower(btrim(regexp_replace(regexp_replace(fr.fee_name, '^\\s*[0-9]+([A-Za-z])', '\\1'), '[†‡*]+', '', 'g')))");
  });

  it("marks a week under the key version, so lines marked under an older one are read again", () => {
    const now = new Date("2026-10-15T12:00:00Z");
    expect(NAME_FILE_KEY_VERSION).toBe(2);
    expect(nameFileCheckedFlag(now)).toBe("knox_name_file_checked:k2:2026-W42");
    // The v1 mark the IN lane wrote on Oct 15 is not this week's mark any more.
    expect(nameFileCheckedFlag(now)).not.toBe("knox_name_file_checked:2026-W42");
  });
});

// #1102: held range lines with no category. Production excerpts, read 16 Oct 2026.
describe("held range lines that are deposit or loan rate bands, not fees (#1102)", () => {
  // The text just before the line in its document; a rate table's own header by default.
  const RATE_HEADER = "Savings Rates | Balance | Dividend Rate | APY";
  const range = (fee_raw_id: number, excerpt: string, hint = "none", prev_context: string | null = RATE_HEADER) => ({
    fee_raw_id,
    amount: "0.00",
    fee_name: "Tier",
    institution_id: fee_raw_id % 3,
    source_document_id: 9,
    conditions: `Knox held for review (range) from Rosetta artifact #704. canonical_hint=${hint}; text_hash=abc; excerpt="${excerpt}"`,
    outlier_flags: hint === "none" ? ["knox_review:range", "amount_max:49999.99"] : ["knox_review:range", `canonical_hint:${hint}`],
    prev_context,
  });
  const tier = range(1, "Tier 3 | $25,000.00 – $49,999.99 | 0.75% | 2.02 to 1.39%");
  const loan = range(2, "Loan amounts range from $1,000 to $75,000 and loan term lengths range from 24 months to 84 months");
  const apy = range(3, "Balances $25,000.00 to $34,999.99 earn 0.75% APY");
  const minimums = range(4, "$2,500 to $24,999.99 | 0.35% | 0.35% | $2,500.00 | $500.00");

  it.each([
    [tier, true],
    [apy, true],
    [minimums, true],
    [range(13, "$3,500 to $20,000 | 11.25% | 48 months"), true],
    [range(14, "If your daily balance is from $10,000.00 to $19,999.99, the second dividend rate and annual percentage yield will apply"), true],
    // No deposit or loan rate signal: a loan amount alone stays held.
    [loan, false],
    // A band whose text cannot be found, or that sits under a fee heading, stays held.
    [range(15, "Tier 3 | $25,000.00 – $49,999.99 | 0.75%", "none", null), false],
    [range(16, "Tier 3 | $25,000.00 – $49,999.99 | 0.75%", "none", "Large Amount (currency) Withdrawal Fee\n"), false],
    // Real fees a second review of #1622 found among the bands, checked against the stored text
    // (production raw ids): a rate charged on an amount, a big-dollar fee, a commission table.
    [range(114351, "$25,000.00 - $49,999.99…… 1.25% of amount withdrawn(1)", "none", "Large Amount (currency) Withdrawal Fee\n"), false],
    [range(114352, "$50,000.00 - $99,999.99…… 1.25% of amount withdrawn(1)"), false],
    [range(114536, "$25,000.00 - $49,999.99…… 1.25% of amount withdrawn(1)"), false],
    [range(114537, "$50,000.00 - $99,999.99…… 1.25% of amount withdrawn(1)"), false],
    [range(325674, "$25,000.00 - $49,999.99…… 1.25% of amount withdrawn(1)"), false],
    [range(325675, "$50,000.00 - $99,999.99…… 1.25% of amount withdrawn(1)"), false],
    [range(484337, "Foreign $15,001-$25,000 | ½ of 1%"), false],
    [range(662023, "First Mortgage rate modification | $1,500 - $2,500 based on mortgage balance"), false],
    [range(154206, "First Mortgage rate modification | $1,500 - $2,500 based on mortgage balance"), false],
    [range(454859, "$50,001 - $100,000 | $125 + 0.55% of principal"), false],
    [range(454862, "$0 - $10,000 | The lesser of 5% of principal"), false],
    // A balance band priced in its own cell is a fee: it stays held.
    [range(5, "Tier 1 | $50.00 - $149.99 | $2.00"), false],
    [range(6, "Average monthly balance from $0.00 to $99.99: $5.00"), false],
    [range(7, "Money Market Account | $.01 - $1499.99 | $10.00 if below $1500"), false],
    // A fee word, a box, a wire or a waiver: a fee line.
    [range(8, "$0 -$999.99 -- Service charge: $11.00/month. No interest."), false],
    [range(9, "Box Rental | Range from $20-$100/Year ⓘDepending on size"), false],
    [range(10, "$50.01 - $500 | 4% (Waived w/combined Deposit & Loan Balance Relationship of $10,000 or greater)"), false],
    // A price that is itself a small range is a fee, not a band (review of #1622; production raw ids).
    [range(115327, "Balance Verification Letters | $5.00 to $25.00"), false],
    [range(408784, "Pay-By-Phone Loan Payment | $1.00 - $5.00"), false],
    [range(376138, "Personal Checking $8-$9 (based on balance)"), false],
    [range(376139, "Commercial Checking $6-$15 (based on balance)"), false],
    [range(423664, "Negative account balance $0-$9.99 | Medallion Signature guarantee, members | 5.00"), false],
    [range(152384, "Health Savings Account | $0.00 - $3.00 | $500.00 - $2000.00"), false],
    // No rate or balance word: left held.
    [range(11, "Available in any denomination from $10 to $1,000."), false],
    // A range with a fee category is a real fee priced as a range (#1060), never a band.
    [range(12, "Safe Deposit Boxes (Annual) $20.00-$100.00 interest", "safe_deposit_box"), false],
  ] as const)("reads held range line %# as a band or not", (row, band) => {
    expect(isRangeBand(row)).toBe(band);
  });

  it("is switched off: counts the bands and writes nothing", async () => {
    expect(RANGE_BAND_SET_ASIDE_LIVE).toBe(false);
    const db = createDb([tier, apy, range(5, "Tier 1 | $50.00 - $149.99 | $2.00")]);
    const result = await setAsideRangeBands(db as never, { stateCode: "tx" });
    expect(result).toMatchObject({ live: false, dryRun: true, checked: 3, bands: 2, institutions: 2, setAside: 0 });
    // The uncapped lane count comes from the query itself, not from the rows read.
    const counted = createDb([{ ...tier, candidates: "5047" }]);
    expect(await setAsideRangeBands(counted as never)).toMatchObject({ candidates: 5047, checked: 1 });
    expect(result.examples.map((example) => example.feeRawId)).toEqual([1, 3]);
    expect(db.mock.calls.some(([strings]) => /UPDATE|INSERT/.test(templateText(strings)))).toBe(false);
  });

  it("switched on, flags each band set aside (kept, never deleted) and logs it", async () => {
    const db = vi.fn((strings: TemplateStringsArray) => {
      const text = templateText(strings);
      if (text.includes("SELECT fr.fee_raw_id")) return Promise.resolve([tier, apy]);
      // Raw 3 was already set aside by another pass, so this pass did not set it aside.
      if (text.includes("UPDATE raw_fee_observations")) return Promise.resolve([{ fee_raw_id: 1, set_aside_here: true }, { fee_raw_id: 3, set_aside_here: false }]);
      if (text.includes("to_regclass")) return Promise.resolve([{ ready: true }]);
      if (text.includes("INSERT INTO pipeline_feedback")) return Promise.resolve([{ id: 1 }, { id: 2 }]);
      return Promise.resolve([]);
    });
    const result = await setAsideRangeBands(db as never, { live: true, runId: 5 });
    expect(result).toMatchObject({ live: true, dryRun: false, bands: 2, setAside: 2 });
    const update = db.mock.calls.find(([strings]) => templateText(strings).includes("UPDATE raw_fee_observations"));
    expect(templateText(update?.[0])).not.toMatch(/DELETE/);
    // A line already set aside keeps its own flag; only a line this pass sets aside is marked as such.
    expect(templateText(update?.[0])).not.toMatch(/ - /);
    expect(update?.slice(1)).toContain(JSON.stringify([RANGE_BAND_FLAG]));
    expect(update?.slice(1)).toContain(JSON.stringify([RANGE_BAND_FLAG, HELD_SET_ASIDE_FLAG, RANGE_BAND_SET_ASIDE_BY_FLAG]));
    const insert = db.mock.calls.find(([strings]) => templateText(strings).includes("INSERT INTO pipeline_feedback"));
    const logged = JSON.stringify(insert?.slice(1));
    expect(logged).toContain('\\"set_aside_by_this_pass\\":true');
    expect(logged).toContain('\\"set_aside_by_this_pass\\":false');
  });

  it("a dry run writes nothing even with the switch on", async () => {
    const db = createDb([tier]);
    const result = await setAsideRangeBands(db as never, { live: true, dryRun: true });
    expect(result).toMatchObject({ bands: 1, setAside: 0, dryRun: true });
    expect(db.mock.calls.some(([strings]) => /UPDATE|INSERT/.test(templateText(strings)))).toBe(false);
  });
});
