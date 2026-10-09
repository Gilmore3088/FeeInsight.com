import { describe, expect, it, vi } from "vitest";

import {
  HELD_SET_ASIDE_FLAG,
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
  supersededConditions,
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
    const promote = calls.find((call) => call.text.includes("UPDATE raw_fee_observations fr"))!;
    expect(promote.values).toContain(457013);
    expect(JSON.stringify(promote.values)).toContain("needs_darwin_verification");
    expect(JSON.stringify(promote.values)).toContain("text_hash=1f6e;");
    const marked = calls.find((call) => call.text.includes("WHERE fee_raw_id = ANY"))!;
    expect(marked.values).toContainEqual([457099]);
    expect(JSON.stringify(marked.values)).toContain(supersededRecheckFlag());
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
