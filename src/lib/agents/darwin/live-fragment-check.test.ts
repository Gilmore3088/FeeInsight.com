import { describe, expect, it, vi } from "vitest";

import { gluedSentenceHead, isCutoffName, liveFragmentName, liveFragmentShape } from "@/lib/agents/knox/name-retidy";

import {
  FRAGMENT_NAME_TAKEDOWN_LIVE,
  LIVE_FRAGMENT_BATCH,
  LIVE_FRAGMENT_STRATEGY,
  countLiveFragmentNames,
  findLiveFragments,
  liveFragmentCountSql,
  liveFragmentDetail,
  liveFragmentVerdict,
  recheckLiveFragmentNames,
  liveNameKey,
} from "./live-fragment-check";

// Institution 5314, row 58414 (#1443): the waived price of "ePLUS Checking Monthly service charge" $7.95.
const ROW_58414 = "or take advantage of both options to reduce your monthly fee to";

describe("liveFragmentName (live twin of isCutoffName)", () => {
  it.each([
    [ROW_58414, "sentence_end"],
    ["Overdraft fee charged per", "trailing_range"],
    ["Late Fee | Up to", "trailing_range"],
    ["NSF fee (ACH, ATM, or check) - per", "trailing_range"],
    ["Dormant accounts will be charged a monthly", "pronoun"],
    ["If you close your account within 90 days", "pronoun"],
    ["Inactive fee: This account may be subject to an Inactive fee of", "sentence_end"],
    ["Paper statement fee for the", "sentence_end"],
    ["+ $5.00 for each additional", "plus"],
  ])("takes %j down as %s", (name, pattern) => {
    expect(liveFragmentName(name)).toBe(pattern);
    // Every live match is also a publish-time cut-off name: the twin only narrows the hold.
    expect(isCutoffName(name)).toBe(true);
  });

  it.each([
    "N/A",
    "Check Printing N/A",
    "Loan Application, each",
    "my Value Checking",
    "Save Your Way",
    "Check Printing i.e. Deluxe",
    "Other services not listed above",
    "+Returned Item Fee – per item returned",
    "+ Stop Payment Fee",
    "ePLUS Checking Monthly service charge",
    "",
  ])("leaves %j live", (name) => {
    expect(liveFragmentName(name)).toBeNull();
  });

  it("reads a lower-case article as a fragment and the capital A of N/A as a name", () => {
    expect(liveFragmentName("Wire transfer fee for a")).toBe("sentence_end");
    expect(liveFragmentName("Wire Transfer Plan A")).toBeNull();
  });
});

type DbMock = ReturnType<typeof vi.fn>;

function dbFor(rows: Array<Record<string, unknown>>, cursor: string | null = null, existing: Array<Record<string, unknown>> | null = []): DbMock {
  return vi.fn((strings: TemplateStringsArray) => {
    const text = strings.join("?");
    if (text.includes("FROM agent_run_events")) return Promise.resolve(cursor == null ? [] : [{ next_after_id: cursor }]);
    if (text.includes("lower(btrim(regexp_replace(fp.fee_name")) return existing == null ? Promise.reject(new Error("read failed")) : Promise.resolve(existing);
    if (text.includes("FROM published_fee_records")) return Promise.resolve(rows);
    if (text.includes("UPDATE published_fee_records")) return Promise.resolve(rows.filter((row) => liveFragmentName(row.fee_name as string)).map((row) => ({ fee_published_id: row.fee_published_id })));
    return Promise.resolve([]);
  });
}

const asDb = (db: DbMock) => db as unknown as Parameters<typeof recheckLiveFragmentNames>[0];

const ROWS = [
  { fee_published_id: "58414", fee_verified_id: "9001", institution_id: "5314", fee_name: ROW_58414, amount: "0.00" },
  { fee_published_id: "58415", fee_verified_id: "9002", institution_id: "5314", fee_name: "ePLUS Checking Monthly service charge", amount: "7.95" },
  { fee_published_id: "60001", fee_verified_id: null, institution_id: "77", fee_name: "Loan Application, each", amount: "25" },
  { fee_published_id: "60002", fee_verified_id: "9003", institution_id: "77", fee_name: "Late Fee | Up to", amount: "15" },
  { fee_published_id: "60003", fee_verified_id: "9004", institution_id: "77", fee_name: "Overdraft Fee You will be charged when an item is paid into overdraft", amount: "35", canonical_fee_key: "overdraft" },
  { fee_published_id: "60004", fee_verified_id: "9005", institution_id: "77", fee_name: "Stop Payment (per item, if you request it)", amount: "30", canonical_fee_key: "stop_payment" },
  { fee_published_id: "60005", fee_verified_id: "9006", institution_id: "78", fee_name: "Monthly maintenance fee waived per", amount: "0" },
];

describe("Darwin live fragment re-check", () => {
  it("ships with the takedown off", () => {
    expect(FRAGMENT_NAME_TAKEDOWN_LIVE).toBe(false);
    expect(LIVE_FRAGMENT_BATCH).toBe(2_000);
  });

  it("counts by pattern and action with samples of each", () => {
    const found = findLiveFragments(ROWS);
    expect(found).toMatchObject({
      checked: 7,
      matched: 5,
      wouldTakeDown: 2,
      wouldRename: 1,
      exempt: 2,
      exemptByReason: { parenthetical: 1, trailing_range_priced: 1 },
      byPattern: { sentence_end: 1, trailing_range: 2, pronoun: 2, plus: 0 },
      byAction: {
        takedown: { sentence_end: 1, trailing_range: 1, pronoun: 0, plus: 0 },
        rename: { sentence_end: 0, trailing_range: 0, pronoun: 1, plus: 0 },
        exempt: { sentence_end: 0, trailing_range: 1, pronoun: 1, plus: 0 },
      },
    });
    expect(found.samples[0]).toMatchObject({ feePublishedId: 58414, feeVerifiedId: 9001, institutionId: 5314, feeName: ROW_58414, amount: 0, pattern: "sentence_end", action: "takedown" });
    expect(found.samplesByAction.takedown.map((fee) => fee.feePublishedId)).toEqual([58414, 60005]);
    expect(found.samplesByAction.rename).toEqual([expect.objectContaining({ feePublishedId: 60003, renameTo: "Overdraft Fee" })]);
    expect(found.samplesByAction.exempt.map((fee) => [fee.feePublishedId, fee.exemptReason])).toEqual([[60002, "trailing_range_priced"], [60004, "parenthetical"]]);
  });

  it("splits the ledger detail by action with samples", () => {
    const found = findLiveFragments(ROWS);
    const detail = liveFragmentDetail({ ...found, live: false, dryRun: true, afterId: 0, nextAfterId: 0, takenDown: [], renamed: [], duplicateCheckFailed: false });
    expect(detail).toMatchObject({ version: LIVE_FRAGMENT_STRATEGY.version, would_take_down: 2, would_rename: 1, exempt: 2, taken_down: 0, renamed: 0 });
    expect(detail.samples_by_action.rename[0]).toMatchObject({ fee_published_id: 60003, action: "rename", rename_to: "Overdraft Fee" });
    expect(detail.samples_by_action.exempt[1]).toMatchObject({ fee_published_id: 60004, action: "exempt", exempt_reason: "parenthetical" });
    expect(detail.samples_by_action.takedown).toHaveLength(2);
  });

  it("in shadow reports what it would take down, records the cursor and writes no fee", async () => {
    const db = dbFor(ROWS, "58000");
    const result = await recheckLiveFragmentNames(asDb(db), { runId: 7, stepId: 70, dryRun: false });
    expect(result).toMatchObject({ live: false, checked: 7, matched: 5, wouldTakeDown: 2, wouldRename: 1, exempt: 2, afterId: 58000, nextAfterId: 0, takenDown: [], renamed: [] });
    const calls = JSON.stringify(db.mock.calls);
    expect(calls).not.toContain("UPDATE");
    expect(calls).toContain("darwin.live_fragment_check");
  });

  it("carries the cursor on when the batch is full", async () => {
    const db = dbFor(ROWS.slice(0, 2));
    const result = await recheckLiveFragmentNames(asDb(db), { runId: 7, dryRun: false, limit: 2 });
    expect(result.afterId).toBe(0);
    expect(result.nextAfterId).toBe(58415);
  });

  it("a dry run writes nothing at all", async () => {
    const db = dbFor(ROWS);
    await recheckLiveFragmentNames(asDb(db), { runId: 7, dryRun: true, live: true });
    const calls = JSON.stringify(db.mock.calls);
    expect(calls).not.toContain("UPDATE");
    expect(calls).not.toContain("INSERT");
  });

  it("switched on, archives the takedowns with their pattern, renames the glued names and leaves the exempt live", async () => {
    const db = dbFor(ROWS);
    const result = await recheckLiveFragmentNames(asDb(db), { runId: 7, stepId: 70, dryRun: false, live: true });
    expect(result.takenDown).toEqual([58414, 60005]);
    expect(result.renamed).toEqual([60003]);
    const texts = db.mock.calls.map(([strings]) => (strings as TemplateStringsArray).join("?"));
    const calls = JSON.stringify(db.mock.calls);
    expect(calls).toContain("UPDATE published_fee_records");
    expect(calls).toContain("fragment name: sentence_end");
    expect(calls).toContain("fragment name: trailing_range");
    expect(calls).toContain("UPDATE verified_fee_observations");
    expect(calls).toContain("darwin.live_fragment_name_taken_down");
    // The takedown never carries the renamed or exempt fees.
    const takedown = db.mock.calls.find(([strings]) => (strings as TemplateStringsArray).join("?").includes("rolled_back_reason"));
    expect(takedown?.[2]).toEqual([58414, 60005]);
    // The rename goes through Knox's path: the old name logged, then the guarded name update.
    expect(texts.some((text) => text.includes("INSERT INTO pipeline_feedback"))).toBe(true);
    expect(texts.some((text) => text.includes("SET fee_name = rename.new_name") && text.includes("fp.fee_name = rename.old_name"))).toBe(true);
    const feedback = db.mock.calls.find(([strings]) => (strings as TemplateStringsArray).join("?").includes("INSERT INTO pipeline_feedback"));
    expect(String(feedback?.[1])).toContain("darwin.live_fragment_check");
    expect(String(feedback?.[1])).toContain("\"new_name\":\"Overdraft Fee\"");
    expect(calls).toContain("darwin.live_fragment_name_renamed");
  });

  it("takes down, not renames, a fee whose new name another live fee of the bank has at that price and category", async () => {
    const db = dbFor(ROWS, null, [{ institution_id: "77", canonical_fee_key: "overdraft", amount: "35.00", fee_name: "Overdraft  Fee " }]);
    const result = await recheckLiveFragmentNames(asDb(db), { runId: 7, dryRun: false, live: true });
    expect(result.renamed).toEqual([]);
    expect(result.takenDown).toEqual([58414, 60003, 60005]);
    expect(result).toMatchObject({ wouldRename: 0, wouldTakeDown: 3, takedownByReason: { fragment: 2, rename_duplicate: 1 } });
    expect(JSON.stringify(db.mock.calls)).toContain("fragment name: pronoun (rename_duplicate)");
    const read = db.mock.calls.map(([strings]) => (strings as TemplateStringsArray).join("?")).find((text) => text.includes("lower(btrim(regexp_replace"));
    expect(read).toContain("fp.quarantined_at IS NULL");
  });

  it("counts the duplicate in shadow and in a dry run too", async () => {
    const existing = [{ institution_id: "77", canonical_fee_key: "overdraft", amount: "35", fee_name: "Overdraft Fee" }];
    for (const options of [{ dryRun: false }, { dryRun: true }]) {
      const result = await recheckLiveFragmentNames(asDb(dbFor(ROWS, null, existing)), { runId: 7, ...options });
      expect(result).toMatchObject({ wouldRename: 0, takedownByReason: { rename_duplicate: 1 }, takenDown: [], renamed: [] });
      expect(liveFragmentDetail(result).samples_rename_duplicate[0]).toMatchObject({ fee_published_id: 60003, rename_to: "Overdraft Fee", takedown_reason: "rename_duplicate" });
    }
  });

  it("renames nothing when the duplicate-name read fails", async () => {
    const result = await recheckLiveFragmentNames(asDb(dbFor(ROWS, null, null)), { runId: 7, dryRun: false, live: true });
    expect(result.duplicateCheckFailed).toBe(true);
    expect(result.renamed).toEqual([]);
    expect(result.takenDown).toEqual([58414, 60005]);
  });

  it("keeps the renames on the ledger when the rename event fails", async () => {
    const db = dbFor(ROWS);
    const base = db.getMockImplementation() as (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
    db.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.join("?").includes("INSERT INTO agent_run_events") && values.includes("darwin.live_fragment_name_renamed")
        ? Promise.reject(new Error("event failed"))
        : base(strings, ...values));
    const result = await recheckLiveFragmentNames(asDb(db), { runId: 7, dryRun: false, live: true });
    expect(result.renamed).toEqual([60003]);
  });

  it("an institution-scoped run reads that bank and leaves the cursor alone", async () => {
    const db = dbFor(ROWS);
    const result = await recheckLiveFragmentNames(asDb(db), { runId: 7, dryRun: false, institutionId: 5314 });
    expect(result.afterId).toBeNull();
    expect(result.nextAfterId).toBeNull();
    expect(JSON.stringify(db.mock.calls)).not.toContain("FROM agent_run_events");
  });

  it("reads the cursor only from whole-table steps, so a scoped run's event can't reset it", async () => {
    const db = dbFor(ROWS, "60002");
    await recheckLiveFragmentNames(asDb(db), { runId: 8, dryRun: false });
    const cursorRead = db.mock.calls.map(([strings]) => (strings as TemplateStringsArray).join("?")).find((text) => text.includes("FROM agent_run_events"));
    expect(cursorRead).toContain("detail->>'next_after_id' IS NOT NULL");
  });

  it("counts the whole live table in one read", async () => {
    const db = dbFor(ROWS);
    const totals = await countLiveFragmentNames(asDb(db));
    expect(totals).toMatchObject({ checked: 7, matched: 5, wouldTakeDown: 2, wouldRename: 1, exempt: 2 });
    expect(totals).not.toHaveProperty("matches");
    expect(db).toHaveBeenCalledTimes(1);
  });

  it("gives a read-only SQL with Postgres word boundaries", () => {
    const text = liveFragmentCountSql();
    expect(text).not.toMatch(/\\b/);
    expect(text).toContain("\\y(?:you|will)\\y");
    expect(text).toContain("name ~* '\\y(?:up\\s+to|per)\\s*$'");
    expect(text).toContain("'\\y(?:up\\s+to|per)\\s*$'");
    expect(text).not.toMatch(/\b(?:UPDATE|INSERT|DELETE)\b/);
  });

  it("splits the read-only SQL by action, mirroring the new rules", () => {
    const text = liveFragmentCountSql();
    expect(text).toContain("ELSE 'exempt'");
    expect(text).toContain("THEN 'parenthetical'");
    expect(text).toContain("THEN 'rename'");
    expect(text).toContain("'\\([^()]*\\)'");
    expect(text).toContain("substring(name from '^((?!");
    expect(text).toContain("COALESCE(amount, -1) = 0");
    expect(text).toContain("\\y(?:waiv");
    expect(text).toContain("GROUPING SETS ((action, reason, pattern), (action, reason), (action), ())");
    expect(text).toContain("'rename_duplicate'");
    expect(text).toContain("row_number() OVER (PARTITION BY v.first_reason = 'rename'");
    expect(text).toContain("l.canonical_fee_key IS NOT DISTINCT FROM r.canonical_fee_key");
    expect(text).toContain("quarantined_at IS NULL");
  });
});

describe("live fragment switch-on rules (#1443)", () => {
  it.each([
    // Parentheticals: a pronoun inside one qualifies the fee.
    ["Stop Payment (per item, if you request it)", 30, "stop_payment", { pattern: "pronoun", action: "exempt", exemptReason: "parenthetical" }],
    ["Cashier's Check (if you are not a member)", 10, null, { pattern: "pronoun", action: "exempt", exemptReason: "parenthetical" }],
    // ... but not when the pronoun is outside it too.
    ["Paper Statement (monthly) you will be charged", 3, null, { pattern: "pronoun", action: "takedown" }],
    // Glued sentence: the fee keeps its leading name.
    ["Overdraft Fee You will be charged when an item is paid into overdraft", 35, "overdraft", { pattern: "pronoun", action: "rename", renameTo: "Overdraft Fee" }],
    ["Returned Item Fee - you will be charged for each item returned", 30, "nsf", { pattern: "pronoun", action: "rename", renameTo: "Returned Item Fee" }],
    ["Stop Payment You will be charged", 30, "stop_payment", { pattern: "pronoun", action: "rename", renameTo: "Stop Payment" }],
    ["Inactive fee: This account may be subject to an Inactive fee of", 5, null, { pattern: "sentence_end", action: "rename", renameTo: "Inactive fee" }],
    // ... unless the amount is $0 or the name speaks of a waiver: a waived price comes down.
    ["Monthly Service Fee You will be charged unless", 0, null, { pattern: "pronoun", action: "takedown" }],
    ["Monthly Service Fee You can avoid this fee by", 10, null, { pattern: "sentence_end", action: "takedown" }],
    // Pure fragments come down.
    ["Dormant accounts will be charged a monthly", 5, "dormant_account", { pattern: "pronoun", action: "takedown" }],
    ["If you close your account within 90 days", 25, null, { pattern: "pronoun", action: "takedown" }],
    ["Wire Transfer Fee if you request a wire", 25, null, { pattern: "pronoun", action: "takedown" }],
    [ROW_58414, 0, null, { pattern: "sentence_end", action: "takedown" }],
    ["Paper statement fee for the", 2, null, { pattern: "sentence_end", action: "takedown" }],
    ["+ $5.00 for each additional", 5, null, { pattern: "plus", action: "takedown" }],
    // Trailing range: down only on waiver wording or $0; otherwise report only.
    ["Overdraft fee charged per", 35, null, { pattern: "trailing_range", action: "exempt", exemptReason: "trailing_range_priced" }],
    ["NSF fee (ACH, ATM, or check) - per", 30, null, { pattern: "trailing_range", action: "exempt", exemptReason: "trailing_range_priced" }],
    ["Monthly maintenance fee waived per", 10, null, { pattern: "trailing_range", action: "takedown" }],
    ["Late Fee | Up to", 0, null, { pattern: "trailing_range", action: "takedown" }],
    ["Discounted Safe Deposit Box rent up to", 40, null, { pattern: "trailing_range", action: "takedown" }],
  ] as const)("%j at $%s is %j", (name, amount, key, verdict) => {
    expect(liveFragmentVerdict(name, amount, key)).toEqual(verdict);
  });

  it("leaves a name with no fragment shape alone", () => {
    expect(liveFragmentVerdict("ePLUS Checking Monthly service charge", 7.95)).toBeNull();
    expect(liveFragmentVerdict(null, null)).toBeNull();
  });

  it("takes down a glued name whose cleaned name the category guard refuses", () => {
    // The guard accepts the full name under stop_payment but not "Paper Statement Fee": the fee comes down.
    expect(liveFragmentVerdict("Paper Statement Fee You will be charged for a stop payment", 30, "stop_payment")).toEqual({ pattern: "pronoun", action: "takedown" });
    expect(liveFragmentVerdict("Paper Statement Fee You will be charged for a stop payment", 30, null)).toMatchObject({ action: "rename" });
  });

  it("takes down a glued name with no known amount", () => {
    expect(liveFragmentVerdict("Overdraft Fee You will be charged", null)).toEqual({ pattern: "pronoun", action: "takedown" });
  });

  it("keeps the raw shape for parentheticals and drops it from the fragment predicate", () => {
    expect(liveFragmentShape("Stop Payment (per item, if you request it)")).toBe("pronoun");
    expect(liveFragmentName("Stop Payment (per item, if you request it)")).toBeNull();
    expect(liveFragmentName("Stop Payment (if you request")).toBe("pronoun");
  });

  it.each([
    ["Overdraft Fee You will be charged", "Overdraft Fee"],
    ["OVERDRAFT FEE YOU WILL BE CHARGED", "OVERDRAFT FEE"],
    ["Stop Payment | You will be charged", "Stop Payment"],
    ["Inactive fee: This account may be subject to", "Inactive fee"],
    ["Dormant accounts will be charged a monthly", null],
    ["If you close your account", null],
    ["Fees will be charged when you", null],
    ["Wire Fee if you request", null],
    ["Account is charged a fee You will", null],
    // The reviewer's good heads.
    ["ATM Fee You may be charged by the ATM owner", "ATM Fee"],
    ["Overdraft Fee per item. You will be charged", "Overdraft Fee per item"],
    ["Account Closing Fee If you close within 90 days", "Account Closing Fee"],
    ["NSF Fee This fee will apply per item", "NSF Fee"],
    ["Wire Transfer Fee You will be charged for each outgoing wire", "Wire Transfer Fee"],
    ["Courtesy Pay Fee You will be charged up to 5 items per day", "Courtesy Pay Fee"],
    ["Stop Payment Fee. Please note you will be charged", "Stop Payment Fee"],
    ["Overdraft Protection Transfer Fee - We will transfer", "Overdraft Protection Transfer Fee"],
    // The reviewer's bad heads: a person in the head, one word, a lead article/quantifier/ordinal, fee nouns alone.
    ["Checks Your order will be", null],
    ["Wire You will pay", null],
    ["Fee You will be charged", null],
    ["Deposits You will", null],
    ["A Fee You will be charged", null],
    ["An Item You will pay", null],
    ["Any Fee You will pay", null],
    ["Each Item You will pay", null],
    ["Every Item You will pay", null],
    ["2nd Item You will pay", null],
    ["Second Item You will pay", null],
    ["Fee Per Item You will", null],
    ["Our Wire Fee You will pay", null],
    ["Wire Fee for our members You will", null],
    ["Overdraft Fee Waived You will", null],
    ["Cargo por Sobregiro You will be charged", null],
  ])("gluedSentenceHead(%j) is %j", (name, head) => {
    expect(gluedSentenceHead(name)).toBe(head);
  });

  it("takes down a rename onto a live name, and the second of two renames onto the same name", () => {
    const rows = [
      { fee_published_id: 2, fee_verified_id: 2, institution_id: 9, fee_name: "Overdraft Fee - you will be charged per item", amount: 35, canonical_fee_key: "overdraft" },
      { fee_published_id: 1, fee_verified_id: 1, institution_id: 9, fee_name: "Overdraft Fee You will be charged", amount: 35, canonical_fee_key: "overdraft" },
      { fee_published_id: 3, fee_verified_id: 3, institution_id: 9, fee_name: "Stop Payment You will be charged", amount: 30, canonical_fee_key: "stop_payment" },
      // Another bank, another price or another category is no collision.
      { fee_published_id: 4, fee_verified_id: 4, institution_id: 10, fee_name: "Overdraft Fee You will be charged", amount: 35, canonical_fee_key: "overdraft" },
      { fee_published_id: 5, fee_verified_id: 5, institution_id: 9, fee_name: "Overdraft Fee You will be charged", amount: 30, canonical_fee_key: "overdraft" },
    ];
    const none = findLiveFragments(rows).matches.map((fee) => [fee.feePublishedId, fee.action, fee.takedownReason ?? fee.renameTo]);
    expect(none).toEqual([[1, "rename", "Overdraft Fee"], [2, "takedown", "rename_duplicate"], [3, "rename", "Stop Payment"], [4, "rename", "Overdraft Fee"], [5, "rename", "Overdraft Fee"]]);
    const taken = findLiveFragments(rows, new Set([liveNameKey(9, "stop_payment", "30.00", "STOP  payment ")]));
    expect(taken.matches.find((fee) => fee.feePublishedId === 3)).toMatchObject({ action: "takedown", takedownReason: "rename_duplicate" });
    expect(taken.takedownByReason).toEqual({ fragment: 0, rename_duplicate: 2 });
    expect(taken.renameDuplicateSamples.map((fee) => fee.feePublishedId)).toEqual([2, 3]);
  });

  it("collides with a live name in the same read", () => {
    const found = findLiveFragments([
      { fee_published_id: 1, fee_verified_id: 1, institution_id: 9, fee_name: "Account Closing Fee", amount: 25, canonical_fee_key: "early_closure" },
      { fee_published_id: 2, fee_verified_id: 2, institution_id: 9, fee_name: "Account Closing Fee If you close within 90 days", amount: 25, canonical_fee_key: "early_closure" },
    ]);
    expect(found.matches).toEqual([expect.objectContaining({ feePublishedId: 2, action: "takedown", takedownReason: "rename_duplicate" })]);
  });
});
