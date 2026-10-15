import { describe, expect, it, vi } from "vitest";

import { gluedSentenceHead, gluedSentenceSplit, isCutoffName, liveFragmentName, liveFragmentShape } from "@/lib/agents/knox/name-retidy";

import {
  FRAGMENT_NAME_TAKEDOWN_LIVE,
  LIVE_FRAGMENT_BATCH,
  LIVE_FRAGMENT_REREAD_KIND,
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
  // v5: a priced sentence_end line with no rename stays live and asks Knox to re-read it.
  { fee_published_id: "60006", fee_verified_id: "9007", institution_id: "78", fee_name: "Paper statement fee for the", amount: "2" },
];

describe("Darwin live fragment re-check", () => {
  it("ships with the takedown off", () => {
    expect(FRAGMENT_NAME_TAKEDOWN_LIVE).toBe(false);
    expect(LIVE_FRAGMENT_BATCH).toBe(2_000);
  });

  it("counts by pattern and action with samples of each", () => {
    const found = findLiveFragments(ROWS);
    expect(found).toMatchObject({
      checked: 8,
      matched: 6,
      wouldTakeDown: 2,
      wouldRename: 1,
      wouldReread: 1,
      exempt: 2,
      exemptByReason: { parenthetical: 1, trailing_range_priced: 1 },
      byPattern: { sentence_end: 2, trailing_range: 2, pronoun: 2, plus: 0 },
      byAction: {
        takedown: { sentence_end: 1, trailing_range: 1, pronoun: 0, plus: 0 },
        rename: { sentence_end: 0, trailing_range: 0, pronoun: 1, plus: 0 },
        exempt: { sentence_end: 0, trailing_range: 1, pronoun: 1, plus: 0 },
        reread: { sentence_end: 1, trailing_range: 0, pronoun: 0, plus: 0 },
      },
    });
    // The $0 waived price still comes down (#1436); a priced sentence_end line with no rename stays live for a re-read.
    expect(found.samples[0]).toMatchObject({ feePublishedId: 58414, feeVerifiedId: 9001, institutionId: 5314, feeName: ROW_58414, amount: 0, pattern: "sentence_end", action: "takedown", takedownReason: "fragment" });
    expect(found.samples[0]).not.toHaveProperty("rereadRequest");
    expect(found.samplesByAction.takedown.map((fee) => fee.feePublishedId)).toEqual([58414, 60005]);
    expect(found.samplesByAction.reread).toEqual([expect.objectContaining({ feePublishedId: 60006, rereadRequest: true })]);
    expect(found.samplesByAction.reread[0]).not.toHaveProperty("takedownReason");
    expect(found.samplesByAction.rename).toEqual([expect.objectContaining({ feePublishedId: 60003, renameTo: "Overdraft Fee" })]);
    expect(found.samplesByAction.exempt.map((fee) => [fee.feePublishedId, fee.exemptReason])).toEqual([[60002, "trailing_range_priced"], [60004, "parenthetical"]]);
  });

  it("splits the ledger detail by action with samples", () => {
    const found = findLiveFragments(ROWS);
    const detail = liveFragmentDetail({ ...found, live: false, dryRun: true, afterId: 0, nextAfterId: 0, takenDown: [], renamed: [], rereadRequested: [], duplicateCheckFailed: false });
    expect(detail).toMatchObject({ version: LIVE_FRAGMENT_STRATEGY.version, would_take_down: 2, would_rename: 1, would_reread: 1, exempt: 2, taken_down: 0, renamed: 0 });
    expect(detail.samples_by_action.rename[0]).toMatchObject({ fee_published_id: 60003, action: "rename", rename_to: "Overdraft Fee" });
    expect(detail.samples_by_action.exempt[1]).toMatchObject({ fee_published_id: 60004, action: "exempt", exempt_reason: "parenthetical" });
    expect(detail.samples_by_action.takedown).toHaveLength(2);
    expect(detail.samples_by_action.reread[0]).toMatchObject({ fee_published_id: 60006, action: "reread", reread_request: true });
  });

  it("in shadow reports what it would take down, records the cursor and writes no fee", async () => {
    const db = dbFor(ROWS, "58000");
    const result = await recheckLiveFragmentNames(asDb(db), { runId: 7, stepId: 70, dryRun: false });
    expect(result).toMatchObject({ live: false, checked: 8, matched: 6, wouldTakeDown: 2, wouldRename: 1, wouldReread: 1, exempt: 2, afterId: 58000, nextAfterId: 0, takenDown: [], renamed: [], rereadRequested: [] });
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

  it("switched on, archives the takedowns with their pattern, renames the glued names and leaves the exempt and reread live", async () => {
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
    // The takedown never carries the renamed, exempt or reread fees.
    const takedown = db.mock.calls.find(([strings]) => (strings as TemplateStringsArray).join("?").includes("rolled_back_reason"));
    expect(takedown?.[2]).toEqual([58414, 60005]);
    // The rename goes through Knox's path: the old name logged, then the guarded name update.
    expect(texts.some((text) => text.includes("INSERT INTO pipeline_feedback"))).toBe(true);
    expect(texts.some((text) => text.includes("SET fee_name = rename.new_name") && text.includes("fp.fee_name = rename.old_name"))).toBe(true);
    const feedback = db.mock.calls.find(([strings]) => (strings as TemplateStringsArray).join("?").includes("INSERT INTO pipeline_feedback"));
    expect(String(feedback?.[1])).toContain("darwin.live_fragment_check");
    expect(String(feedback?.[1])).toContain("\"new_name\":\"Overdraft Fee\"");
    expect(calls).toContain("darwin.live_fragment_name_renamed");
    // v5 (#1499): the sentence_end line with no rename stays live and asks Knox to re-read it, after the rename's row.
    expect(result.rereadRequested).toEqual([60006]);
    const feedbackCalls = db.mock.calls.filter(([strings]) => (strings as TemplateStringsArray).join("?").includes("INSERT INTO pipeline_feedback"));
    expect(feedbackCalls).toHaveLength(2);
    const reread = JSON.parse(String(feedbackCalls[1][1]));
    expect(reread).toEqual([expect.objectContaining({
      kind: LIVE_FRAGMENT_REREAD_KIND,
      signal: "wrong",
      about_stage: "extract",
      reported_by: "darwin",
      check_name: "darwin.live_fragment_check",
      fee_published_id: 60006,
      fee_verified_id: 9007,
      dedupe_key: "darwin.live_fragment_check:reread:pub:60006",
      evidence: expect.objectContaining({ request: "reread_source_line", reason: "kept live: sentence_end with no name", kept_live: true }),
    })]);
    expect(liveFragmentDetail(result)).toMatchObject({ would_request_reread: 1, reread_requested: 1 });
  });

  it("asks for no re-read in shadow, and keeps the takedowns when the request fails", async () => {
    const shadow = dbFor(ROWS);
    const off = await recheckLiveFragmentNames(asDb(shadow), { runId: 7, dryRun: false });
    expect(off).toMatchObject({ wouldRequestReread: 1, rereadRequested: [] });
    expect(JSON.stringify(shadow.mock.calls)).not.toContain(LIVE_FRAGMENT_REREAD_KIND);
    const db = dbFor(ROWS);
    const base = db.getMockImplementation() as (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
    db.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.join("?").includes("FROM verified_fee_observations fv") ? Promise.reject(new Error("read failed")) : base(strings, ...values));
    const on = await recheckLiveFragmentNames(asDb(db), { runId: 7, dryRun: false, live: true });
    expect(on.takenDown).toEqual([58414, 60005]);
    expect(on.rereadRequested).toEqual([]);
    // The reread fee is never in the archive update, whether its request is written or not.
    expect(JSON.stringify(db.mock.calls.filter(([strings]) => (strings as TemplateStringsArray).join("?").includes("UPDATE published_fee_records")))).not.toContain("60006");
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
    // postgres.js sends the cooked template text: the regex must reach Postgres as \s+, not s+.
    expect(read).toContain("regexp_replace(fp.fee_name, '\\s+', ' ', 'g')");
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
    expect(totals).toMatchObject({ checked: 8, matched: 6, wouldTakeDown: 2, wouldRename: 1, wouldReread: 1, exempt: 2 });
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
    expect(text).toContain("from '^((?!");
    expect(text).toContain("COALESCE(amount, -1) = 0");
    expect(text).toContain("\\y(?:waiv");
    expect(text).toContain("GROUPING SETS ((action, reason, pattern), (action, reason), (action), ())");
    expect(text).toContain("'rename_duplicate'");
    expect(text).toContain("row_number() OVER (PARTITION BY v.first_reason IN ('rename', 'rename_tail')");
    expect(text).toContain("l.canonical_fee_key IS NOT DISTINCT FROM r.canonical_fee_key");
    expect(text).toContain("quarantined_at IS NULL");
  });

  it("v2: reads the head after the glued footnote number and refuses opening-deposit renames in SQL too", () => {
    const text = liveFragmentCountSql();
    expect(LIVE_FRAGMENT_STRATEGY.version).toBe(5);
    expect(text).toContain("AS figure_is_amount");
    expect(text).toContain("AND NOT COALESCE(figure_is_amount, false) THEN 'rename_tail'");
    expect(text).toContain("btrim(regexp_replace(name, '\\s*\\((?:cont\\.?|continued)\\)', '', 'gi')), '^(?:(?:\\d{2}");
    expect(text).toContain("substring(readable from '^((?!");
    expect(text).toContain("THEN 'rename_tail'");
    expect(text).toContain("regexp_matches(name, '\\$\\s?(\\d");
    expect(text).toContain("AND amount < 100");
    expect(text).toContain("name !~* '\\y(?:minimum|min|opening|initial)");
    expect(text).toContain("head !~* '^(?:customers?|no\\s+matter|to\\s+request|all)\\y");
    expect(text).not.toContain("(?<");
  });

  it("v5: mirrors the generic-head gate and the count-aware figure gate in SQL", () => {
    const text = liveFragmentCountSql();
    expect(text).toContain("AS head_generic");
    expect(text).toContain("AS generic_ok");
    expect(text).toContain("AND renamable AND generic_ok THEN 'rename'");
    expect(text).toContain("AND NOT head_ok AND NOT generic_ok AND tail_ok");
    expect(text).toContain("regexp_matches(readable, '(\\$\\s?)?(\\d");
    expect(text).toContain("WHERE NOT (amount < 100 AND m[1] IS NULL AND m[2] !~ '\\.' AND m[3] IS NOT NULL)");
    expect(text).toContain("\\y(?:may\\s+therefore|");
    expect(text).toContain("(?:only\\s+)?(?:if|when)");
    expect(text).toContain("'^activation\\s+(?:fees?|charges?)$'");
    expect(text).toContain("WHEN pattern = 'sentence_end' AND COALESCE(amount, 0) > 0 AND name !~* '\\y(?:waiv");
    expect(text).toContain("WHEN reason = 'reread' THEN 'reread'");
    expect(text).toContain("AND NOT amount_refused THEN 'reread'");
    expect(text).toContain("THEN 'fragment_reread'");
    expect(text).toContain("WHEN reason IN ('fragment', 'fragment_reread', 'rename_duplicate') THEN 'takedown'");
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
    ["Overdraft Fee You will be charged when an item is paid into overdraft", 35, "overdraft", { pattern: "pronoun", action: "rename", renameTo: "Overdraft Fee", renameVia: "head" }],
    ["Returned Item Fee - you will be charged for each item returned", 30, "nsf", { pattern: "pronoun", action: "rename", renameTo: "Returned Item Fee", renameVia: "head" }],
    ["Stop Payment You will be charged", 30, "stop_payment", { pattern: "pronoun", action: "rename", renameTo: "Stop Payment", renameVia: "head" }],
    ["Inactive fee: This account may be subject to an Inactive fee of", 5, null, { pattern: "sentence_end", action: "rename", renameTo: "Inactive fee", renameVia: "head" }],
    // ... unless the amount is $0 or the name speaks of a waiver: a waived price comes down.
    ["Monthly Service Fee You will be charged unless", 0, null, { pattern: "pronoun", action: "takedown" }],
    ["Monthly Service Fee You can avoid this fee by", 10, null, { pattern: "sentence_end", action: "takedown" }],
    // Pure fragments come down.
    ["Dormant accounts will be charged a monthly", 5, "dormant_account", { pattern: "pronoun", action: "takedown" }],
    ["If you close your account within 90 days", 25, null, { pattern: "pronoun", action: "takedown" }],
    ["Wire Transfer Fee if you request a wire", 25, null, { pattern: "pronoun", action: "takedown" }],
    // A sentence_end line at $0, with no amount or with waiver wording is a waived price: it comes down (5314, #1436).
    [ROW_58414, 0, null, { pattern: "sentence_end", action: "takedown" }],
    [ROW_58414, 7.95, null, { pattern: "sentence_end", action: "takedown" }],
    ["Paper statement fee for the", null, null, { pattern: "sentence_end", action: "takedown" }],
    ["Paper statement fee is waived for", 2, null, { pattern: "sentence_end", action: "takedown" }],
    ["Paper statement fee for the", 0, null, { pattern: "sentence_end", action: "takedown" }],
    // v5: a plain sentence_end line no gate refused on its amount stays live for a Knox re-read.
    ["Paper statement fee for the", 2, null, { pattern: "sentence_end", action: "reread" }],
    ["+ $5.00 for each additional", 5, null, { pattern: "plus", action: "takedown" }],
    // Trailing range: down only on waiver wording or $0; otherwise report only.
    ["Overdraft fee charged per", 35, null, { pattern: "trailing_range", action: "exempt", exemptReason: "trailing_range_priced" }],
    ["NSF fee (ACH, ATM, or check) - per", 30, null, { pattern: "trailing_range", action: "exempt", exemptReason: "trailing_range_priced" }],
    ["Monthly maintenance fee waived per", 10, null, { pattern: "trailing_range", action: "takedown" }],
    ["Late Fee | Up to", 0, null, { pattern: "trailing_range", action: "takedown" }],
    ["Discounted Safe Deposit Box rent up to", 40, null, { pattern: "trailing_range", action: "takedown" }],
    // v2 (#1499) prod hand-check.
    ["Returned/Non-Sufficient Funds (NSF) fee (per item). This fee applies to", 40, null, { pattern: "sentence_end", action: "rename", renameTo: "Returned/Non-Sufficient Funds (NSF) fee (per item)", renameVia: "head" }],
    ["Legal Attachments, Levies, and Garnishment Fee A fee of", 60, null, { pattern: "sentence_end", action: "rename", renameTo: "Legal Attachments, Levies, and Garnishment Fee", renameVia: "head" }],
    ["ATM Withdrawal Service Charge at Non-BankFive ATM BankFive may impose a", 1.5, null, { pattern: "sentence_end", action: "rename", renameTo: "ATM Withdrawal Service Charge at Non-BankFive ATM", renameVia: "head" }],
    ["Monthly maintenance fee if the average daily balance falls below", 6.05, null, { pattern: "sentence_end", action: "rename", renameTo: "Monthly maintenance fee", renameVia: "head" }],
    ["10NON-MEMBER LOAN APPLICATION FEE THE FEE IS NON-REFUNDABLE AND IS", 25, null, { pattern: "sentence_end", action: "rename", renameTo: "NON-MEMBER LOAN APPLICATION FEE", renameVia: "head" }],
    // v5 (142422): a generic head renames on a balance-below condition under $100 (see the v5 block).
    ["Monthly Fee if the balance falls below", 5, null, { pattern: "sentence_end", action: "rename", renameTo: "Monthly Fee", renameVia: "head" }],
    ["Account Fees The following fees apply to", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Bank sending the wire may charge a fee of", 15, null, { pattern: "sentence_end", action: "reread" }],
    ["ATM5, Telephone Banking and Bill Payment The minimum opening deposit is", 20, null, { pattern: "sentence_end", action: "takedown" }],
    // A minimum or opening deposit in the line is never renamed, even under a clean head.
    ["Paper Statement Fee The minimum opening deposit is", 20, null, { pattern: "sentence_end", action: "takedown" }],
    ["Teller Check Payable to Someone Other than", 10, null, { pattern: "sentence_end", action: "reread" }],
    ["Monthly Service Fee waived with minimum daily balance of", 10, null, { pattern: "sentence_end", action: "takedown" }],
    // v3 (#1499): an "if"/"when" condition renames only on a balance condition under $100.
    ["Monthly Service Fee if balance below", 500, null, { pattern: "sentence_end", action: "takedown" }],
    ["Monthly Service Fee if balance below", 10, null, { pattern: "sentence_end", action: "rename", renameTo: "Monthly Service Fee", renameVia: "head" }],
    ["Monthly Service Fee If your average daily balance falls below", 10, null, { pattern: "sentence_end", action: "rename", renameTo: "Monthly Service Fee", renameVia: "head" }],
    ["Overdraft Fee when overdrawn by more than", 5, null, { pattern: "sentence_end", action: "takedown" }],
    ["Excess Withdrawal Fee if more than", 6, null, { pattern: "sentence_end", action: "takedown" }],
    ["Dormant Account Fee if inactive for more than", 12, null, { pattern: "sentence_end", action: "takedown" }],
    ["Dormant Account Fee If inactive for 12 months or more the fee is", 5, null, { pattern: "sentence_end", action: "takedown" }],
    // v3: another price in the name means no rename (133792, 55708).
    ["a $35 Overdraft Fee if the transaction is paid or a $15 NSF Fee if returned and", 15, null, { pattern: "sentence_end", action: "takedown" }],
    ["A $20 NSF fee is charged per item; users may therefore incur $45 in NSF fees per day and", 45, null, { pattern: "sentence_end", action: "takedown" }],
    ["Overdraft Fee You will be charged $35 per item for", 25, null, { pattern: "sentence_end", action: "takedown" }],
    ["Overdraft Fee You will be charged $35 per item for", 35, null, { pattern: "sentence_end", action: "rename", renameTo: "Overdraft Fee", renameVia: "head" }],
    // v3: "(cont.)" dropped (44880).
    ["Inactive Accounts Fee (cont.) This fee is charged to", 5, null, { pattern: "sentence_end", action: "rename", renameTo: "Inactive Accounts Fee", renameVia: "head" }],
    // v3: a sentence_end line with no head takes the fee its sentence ends on (tail).
    ["Paper statements are available for a monthly paper statement fee of", 3, null, { pattern: "sentence_end", action: "rename", renameTo: "Monthly paper statement fee", renameVia: "tail" }],
    ["If your balance falls below $500 you will be charged a minimum balance fee of", 6, null, { pattern: "sentence_end", action: "rename", renameTo: "Minimum balance fee", renameVia: "tail" }],
    ["There will be a card replacement fee of", 10, null, { pattern: "sentence_end", action: "rename", renameTo: "Card replacement fee", renameVia: "tail" }],
    ["you will be charged an overdraft fee of", 35, null, { pattern: "sentence_end", action: "rename", renameTo: "Overdraft fee", renameVia: "tail" }],
    ["The account is charged a fee of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["You will pay a service charge fee of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["You will pay a monthly fee of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["You will pay a minimum fee of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["You can avoid the paper statement fee of", 3, null, { pattern: "sentence_end", action: "takedown" }],
    ["Accounts opened with a minimum opening deposit have a setup fee of", 25, null, { pattern: "sentence_end", action: "takedown" }],
    ["If your balance falls below $500 you will be charged a minimum balance fee of", 0, null, { pattern: "sentence_end", action: "takedown" }],
    ["Customers who opt in pay a paper statement fee of", 3, null, { pattern: "sentence_end", action: "rename", renameTo: "Paper statement fee", renameVia: "tail" }],
    // v4 (#1499 review): no tail rename when a figure in the line equals the amount.
    ["If your balance falls below $500 you will be charged a minimum balance fee of", 500, null, { pattern: "sentence_end", action: "takedown" }],
    ["If your balance falls below $500 you will be charged a minimum balance fee of", 500.0, null, { pattern: "sentence_end", action: "takedown" }],
    ["If your balance falls below $1,000 you will be charged a minimum balance fee of", 1000, null, { pattern: "sentence_end", action: "takedown" }],
    ["Accounts with a balance under $500 will be charged a maintenance fee of", 500, null, { pattern: "sentence_end", action: "takedown" }],
    ["Accounts with a balance under $500 will be charged a maintenance fee of", 10, null, { pattern: "sentence_end", action: "rename", renameTo: "Maintenance fee", renameVia: "tail" }],
    ["Wires are $15 incoming and an outgoing wire fee of", 15, null, { pattern: "sentence_end", action: "takedown" }],
    ["Wires are $15 incoming and an outgoing wire fee of", 25, null, { pattern: "sentence_end", action: "takedown" }],
    ["Overdrafts of more than $5 will be charged an overdraft fee of", 5, null, { pattern: "sentence_end", action: "takedown" }],
    ["Overdrafts of more than $5 will be charged an overdraft fee of", 25, null, { pattern: "sentence_end", action: "rename", renameTo: "Overdraft fee", renameVia: "tail" }],
    ["Accounts inactive for 12 months will be charged a dormant account fee of", 12, null, { pattern: "sentence_end", action: "takedown" }],
    ["Accounts inactive for 12 months will be charged a dormant account fee of", 10, null, { pattern: "sentence_end", action: "rename", renameTo: "Dormant account fee", renameVia: "tail" }],
    // v5 (137819): "6 withdrawals" is a count, so the figure gate no longer reads it as the amount.
    ["If you exceed 6 withdrawals per month you will be charged an excess withdrawal fee of", 6, null, { pattern: "sentence_end", action: "rename", renameTo: "Excess withdrawal fee", renameVia: "tail" }],
    ["If you exceed 6 withdrawals per month you will be charged an excess withdrawal fee of", 10, null, { pattern: "sentence_end", action: "rename", renameTo: "Excess withdrawal fee", renameVia: "tail" }],
    // v4: a balance condition that also counts an excess is a threshold.
    ["Excess Transaction Fee if more than 6 per month, balance below", 10, null, { pattern: "sentence_end", action: "takedown" }],
    // v4 round-3 hand check. Total wording is a sum, never renamed (55708).
    ["Bill Pay NSF Fee. This fee is passed along per returned payment; Bill Pay users may therefore incur $45 in NSF fees for", 45, null, { pattern: "sentence_end", action: "takedown" }],
    ["Overdraft Fee. You may be charged up to a total of", 105, null, { pattern: "sentence_end", action: "takedown" }],
    // A dormancy tier after a cell break is the fee's condition (44880).
    ["Inactive Accounts Fee (cont.) | If more than 3 years dormant the fee is", 15, null, { pattern: "sentence_end", action: "rename", renameTo: "Inactive Accounts Fee", renameVia: "head" }],
    ["Dormant Account Fee | If inactive for 12 months the fee is", 5, null, { pattern: "sentence_end", action: "rename", renameTo: "Dormant Account Fee", renameVia: "head" }],
    ["Inactive Accounts Fee | If more than 3 years dormant the fee is", 3, null, { pattern: "sentence_end", action: "takedown" }],
    ["Dormant Account Fee if inactive for more than", 12, null, { pattern: "sentence_end", action: "takedown" }],
    // Tail qualifiers dropped; generic tails and "our"/"your" refused.
    ["Each returned item is charged the appropriate returned item fee of", 30, null, { pattern: "sentence_end", action: "rename", renameTo: "Returned item fee", renameVia: "tail" }],
    ["Each item paid is charged the Bank's normal overdraft item charge of", 30, null, { pattern: "sentence_end", action: "rename", renameTo: "Overdraft item charge", renameVia: "tail" }],
    ["Items are subject to a handling fee of", 5, null, { pattern: "sentence_end", action: "reread" }],
    // v5 (98668): a bare "Activation fee" is too generic (it was a gift card's).
    ["New cards carry a low activation fee of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["This account has a monthly flat fee of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["This account has a small monthly fee of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Payments received after the due date carry a late charge of", 15, null, { pattern: "sentence_end", action: "reread" }],
    ["Withdrawals at an Allpoint network our ATM fee of", 2, null, { pattern: "sentence_end", action: "reread" }],
    // A lower-case head before a balance-below condition (132041).
    ["monthly service fee if balance falls below", 10, null, { pattern: "sentence_end", action: "rename", renameTo: "Monthly service fee", renameVia: "head" }],
    ["monthly service fee if more than 6 withdrawals, balance below", 10, null, { pattern: "sentence_end", action: "takedown" }],
    // "/" and a parenthetical inside a tail (68548, 97910).
    ["Each item returned unpaid is charged a Return Item/Insufficient Funds Fee of", 30, null, { pattern: "sentence_end", action: "rename", renameTo: "Return Item/Insufficient Funds Fee", renameVia: "tail" }],
    ["After 5 days the account is charged a Consecutive days overdrawn (OD) fee of", 25, null, { pattern: "sentence_end", action: "rename", renameTo: "Consecutive days overdrawn (OD) fee", renameVia: "tail" }],
    ["After 5 days the account is charged a Consecutive days overdrawn (OD) fee of", 5, null, { pattern: "sentence_end", action: "takedown" }],
    // v4 review: "up to", "a minimum of" state a price on a fee line, so the figure is another price.
    ["Overdraft Fee You will be charged up to $35 per item", 5, null, { pattern: "pronoun", action: "takedown" }],
    ["Wire Transfer Fee You will be charged up to $35 per wire", 15, null, { pattern: "pronoun", action: "takedown" }],
    ["Stop Payment Fee You will be charged a minimum of $30", 10, null, { pattern: "pronoun", action: "takedown" }],
    ["Wires are up to $15 incoming and an outgoing wire fee of", 25, null, { pattern: "sentence_end", action: "takedown" }],
    // A tail that opens on a parenthetical names no fee.
    ["Accounts overdrawn are charged the (OD) fee of", 25, null, { pattern: "sentence_end", action: "reread" }],
    ["Accounts overdrawn are charged a (see schedule) fee of", 25, null, { pattern: "sentence_end", action: "reread" }],
    // A head that is refused does not fall back to the tail when the line has a head split from a threshold.
    ["Overdraft Fee when overdrawn by more than $5 a daily overdraft fee of", 5, null, { pattern: "sentence_end", action: "takedown" }],
    // v5 (#1499, prod hand-check of v4: 101 of 105 renames right).
    // 55708: the stored name is cut just after "may therefore" (the "$45 in NSF fees" is gone): a total, no rename.
    ["NSF fee. This fee is passed along for each returned Bill Pay payment, so you may therefore", 45, null, { pattern: "pronoun", action: "takedown" }],
    ["Bill Pay NSF Fee. Bill Pay users may therefore be charged for", 45, null, { pattern: "sentence_end", action: "takedown" }],
    // 64144: a period and a fee word alone is generic, as head or tail.
    ["Per quarter charge. This fee is charged to", 3, null, { pattern: "sentence_end", action: "reread" }],
    ["Accounts are assessed a per quarter charge of", 3, null, { pattern: "sentence_end", action: "reread" }],
    ["Per month fee. This fee is charged to", 3, null, { pattern: "sentence_end", action: "reread" }],
    ["Inactive accounts are charged a per year fee of", 3, null, { pattern: "sentence_end", action: "reread" }],
    ["Quarterly charge. This fee is charged to", 3, null, { pattern: "sentence_end", action: "reread" }],
    // 98668: a bare "Activation fee" (a gift card's) is generic; a named one is not.
    ["Gift cards carry an activation fee of", 4, null, { pattern: "sentence_end", action: "reread" }],
    ["Activation fee. This fee is charged to", 4, null, { pattern: "sentence_end", action: "reread" }],
    ["New cards carry a debit card activation fee of", 5, null, { pattern: "sentence_end", action: "rename", renameTo: "Debit card activation fee", renameVia: "tail" }],
    ["Card Activation Fee. This fee is charged to", 4, null, { pattern: "sentence_end", action: "rename", renameTo: "Card Activation Fee", renameVia: "head" }],
    // 132041: "only if" / "only when" before a balance-below condition reaches the balance gate.
    ["Monthly maintenance fee only if the balance falls below", 5, null, { pattern: "sentence_end", action: "rename", renameTo: "Monthly maintenance fee", renameVia: "head" }],
    ["monthly maintenance fee only when the balance falls below", 5, null, { pattern: "sentence_end", action: "rename", renameTo: "Monthly maintenance fee", renameVia: "head" }],
    ["Monthly maintenance fee only if the balance falls below", 500, null, { pattern: "sentence_end", action: "takedown" }],
    ["Excess Withdrawal Fee only if more than", 6, null, { pattern: "sentence_end", action: "takedown" }],
    // 142684: "your" is allowed in a balance-below condition only.
    ["Monthly maintenance fee if your daily balance falls below", 5, null, { pattern: "sentence_end", action: "rename", renameTo: "Monthly maintenance fee", renameVia: "head" }],
    ["Monthly maintenance fee if your daily balance falls below", 500, null, { pattern: "sentence_end", action: "takedown" }],
    ["Wire Transfer Fee if your wire is sent to", 25, null, { pattern: "sentence_end", action: "reread" }],
    ["Monthly maintenance fee if you let the balance fall below", 5, null, { pattern: "sentence_end", action: "reread" }],
    // 142422, 110391, 110392: a generic head before a balance-below condition is the fee, correctly priced.
    ["Monthly Fee if balance falls below", 5, null, { pattern: "sentence_end", action: "rename", renameTo: "Monthly Fee", renameVia: "head" }],
    ["Monthly service charge if balance falls below", 5, null, { pattern: "sentence_end", action: "rename", renameTo: "Monthly service charge", renameVia: "head" }],
    ["Monthly service charge only when balance falls below", 4, null, { pattern: "sentence_end", action: "rename", renameTo: "Monthly service charge", renameVia: "head" }],
    ["Service charge if your balance falls below", 5, null, { pattern: "sentence_end", action: "rename", renameTo: "Service charge", renameVia: "head" }],
    // ... but only there: at $100 or more, with an excess, on another condition or none, a generic head is still no name.
    ["Monthly Fee if balance falls below", 500, null, { pattern: "sentence_end", action: "takedown" }],
    ["Monthly Fee if more than 6 withdrawals, balance below", 5, null, { pattern: "sentence_end", action: "takedown" }],
    ["Monthly Fee | If inactive for 12 months the fee is", 5, null, { pattern: "sentence_end", action: "takedown" }],
    ["Monthly Fee. This fee is charged to", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Service charge if the 5-day average balance falls below", 5, null, { pattern: "sentence_end", action: "takedown" }],
    // A generic head that is refused still lets the line's tail name the fee, as before v5.
    ["Monthly Fee. There is a paper statement fee of", 3, null, { pattern: "sentence_end", action: "rename", renameTo: "Paper statement fee", renameVia: "tail" }],
    // 109893: the glued footnote "10" is no figure for the figure gate.
    ["10NON-MEMBER LOAN APPLICATION FEE Non-members applying for a loan pay a loan application fee of", 10, null, { pattern: "sentence_end", action: "rename", renameTo: "Loan application fee", renameVia: "tail" }],
    ["10NON-MEMBER LOAN APPLICATION FEE if the balance falls below", 10, null, { pattern: "sentence_end", action: "rename", renameTo: "NON-MEMBER LOAN APPLICATION FEE", renameVia: "head" }],
    // 137819: a bare whole figure before a count noun is a count, never the price.
    ["Accounts with more than 6 debits per month are charged an excessive transaction fee of", 6, null, { pattern: "sentence_end", action: "rename", renameTo: "Excessive transaction fee", renameVia: "tail" }],
    ["Accounts with more than 3 Withdrawals per month are charged an excess withdrawal fee of", 3, null, { pattern: "sentence_end", action: "rename", renameTo: "Excess withdrawal fee", renameVia: "tail" }],
    // ... but a dollar figure, a decimal, a figure with no count noun, or a span of time still is one
    // (97910's "After 5 days" $5 and 44880's "3 years dormant" $3 above stay takedowns).
    ["Accounts with more than $6 in debits are charged an excessive transaction fee of", 6, null, { pattern: "sentence_end", action: "takedown" }],
    ["Accounts with more than 6.00 debits are charged an excessive transaction fee of", 6, null, { pattern: "sentence_end", action: "takedown" }],
    // The count skip holds only under $100: a count equal to a large amount is the amount misread.
    ["Accounts with more than 1,000 items are charged an item processing fee of", 1000, null, { pattern: "sentence_end", action: "takedown" }],
    ["Accounts with more than 6 per month are charged an excessive transaction fee of", 6, null, { pattern: "sentence_end", action: "takedown" }],
    ["Accounts inactive for 12 Months are charged a dormant account fee of", 12, null, { pattern: "sentence_end", action: "takedown" }],
    // 109893: the capitalised "THERE IS A" opens the sentence after the glued footnote, so the head is read.
    ["10NON-MEMBER LOAN APPLICATION FEE THERE IS A $10.00 NON-MEMBER APPLICATION FEE FOR", 10, null, { pattern: "sentence_end", action: "rename", renameTo: "NON-MEMBER LOAN APPLICATION FEE", renameVia: "head" }],
    ["10NON-MEMBER LOAN APPLICATION FEE. THERE IS A $10.00 NON-MEMBER APPLICATION FEE TO", 10, null, { pattern: "sentence_end", action: "rename", renameTo: "NON-MEMBER LOAN APPLICATION FEE", renameVia: "head" }],
    // 125166: with its figures in the name, the second price refuses the rename ...
    ["$3.00 per monthly fee if balance falls below $150, $9 per item charge after 3 withdrawals of", 9, null, { pattern: "sentence_end", action: "takedown" }],
    // ... known, accepted: the stored name lost them, so the generic head renames on the balance gate at $9.
    ["per monthly fee if balance falls below", 9, null, { pattern: "sentence_end", action: "rename", renameTo: "Per monthly fee", renameVia: "head" }],
    // Known miss (125163): the source line is "$5 monthly service charge when balance falls below $300.
    // $2 paper statement fee.", but the stored name lost both $ figures and the row carries no source
    // text (published_fee_records and verified_fee_observations have no source-line column; the raw
    // row's conditions / extraction_note would need a new join), so the second price cannot be seen
    // and $2 is still renamed. Asserted as-is so a fix shows up here.
    ["Monthly service charge when balance falls below", 2, null, { pattern: "sentence_end", action: "rename", renameTo: "Monthly service charge", renameVia: "head" }],
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
    ["Second Party Check Fee You will be charged", "Second Party Check Fee"],
    ["First Check Order Fee. You will be charged", "First Check Order Fee"],
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
    ["Third Party Item You will pay", "Third Party Item"],
    ["Fee Per Item You will", null],
    ["Our Wire Fee You will pay", null],
    ["Wire Fee for our members You will", null],
    ["Overdraft Fee Waived You will", null],
    ["Cargo por Sobregiro You will be charged", null],
    // v2 (#1499) prod hand-check. Generic heads are no name (88206, 126998, 116036, 65340, 13617, 49798).
    ["Account Fees The following fees apply", null],
    ["Monthly Fee If your balance falls below", null],
    ["Monthly Fee if the balance falls below", null],
    ["Quarterly fee: This fee is charged", null],
    ["Additional fees The fee for", null],
    ["Other Charges You will", null],
    ["ATM & Visa Debit Card You will be charged", null],
    ["Monthly Service Fee You will be charged", "Monthly Service Fee"],
    // A footnote number glued to the name (109893, 87357); never an ordinal, a time or a form number.
    ["10NON-MEMBER LOAN APPLICATION FEE You will be charged", "NON-MEMBER LOAN APPLICATION FEE"],
    ["6A monthly fee You will be charged", null],
    ["24 Hour ATM Fee You will be charged", "24 Hour ATM Fee"],
    ["24HR Banking Fee You will be charged", "24HR Banking Fee"],
    ["1099 Form Copy Fee You will be charged", "1099 Form Copy Fee"],
    ["1ST CHECK ORDER FEE You will be charged", null],
    // Clause heads (125909, 62983, 54122, 142713, 77786).
    ["Customers who opt to receive paper statements will be charged", null],
    ["No matter how many drafts you write", null],
    ["To request Overnight/2-day shipping of a debit card You will be charged", "Overnight/2-day shipping of a debit card"],
    ["To request a replacement card You will be charged", null],
    ["Bank sending the wire You may also be charged", null],
    ["All Returned Items You will be charged", null],
    ["ATM5, Telephone Banking and Bill Payment The minimum opening deposit is", null],
    // The wider split for sentence_end names (42560, 20754, 32742, 91862).
    ["Returned/Non-Sufficient Funds (NSF) fee (per item). This fee applies to", "Returned/Non-Sufficient Funds (NSF) fee (per item)"],
    ["Legal Attachments, Levies, and Garnishment Fee A fee of", "Legal Attachments, Levies, and Garnishment Fee"],
    ["Overdraft Fee the charge is", "Overdraft Fee"],
    ["ATM Withdrawal Service Charge at Non-BankFive ATM BankFive may impose a", "ATM Withdrawal Service Charge at Non-BankFive ATM"],
    ["Monthly maintenance fee if the average daily balance falls below", "Monthly maintenance fee"],
    ["Returned Item Fee may be charged", null],
    ["Teller Check Payable to Someone Other than", null],
    // v3 (#1499): "(cont.)" dropped; "2FA" is a name, not a footnote.
    ["Inactive Accounts Fee (cont.) This fee is charged to", "Inactive Accounts Fee"],
    ["Inactive Accounts Fee (continued). This fee is charged to", "Inactive Accounts Fee"],
    ["2FA Token Fee You will be charged", "2FA Token Fee"],
    ["3D Secure Fee You will be charged", "3D Secure Fee"],
    ["6NO-FEE ATM Card You will be charged", "6NO-FEE ATM Card"],
    ["2FA-Token Fee You will be charged", "2FA-Token Fee"],
    ["7NSF Fee You will be charged", "NSF Fee"],
    ["10NON-MEMBER LOAN APPLICATION FEE THERE IS A $10.00 NON-MEMBER APPLICATION FEE FOR", "NON-MEMBER LOAN APPLICATION FEE"],
    ["OVERDRAFT FEE THERE IS A CHARGE", "OVERDRAFT FEE"],
    // v5 (#1499): "only if", and "your" in a balance-below condition; generic and bare activation heads stay null.
    ["Monthly maintenance fee only if the balance falls below", "Monthly maintenance fee"],
    ["Monthly maintenance fee if your daily balance falls below", "Monthly maintenance fee"],
    ["Monthly maintenance fee if your Balance is under", "Monthly maintenance fee"],
    ["Monthly maintenance fee if your account is closed", null],
    ["Monthly maintenance fee if we close your balance below", null],
    ["Per quarter charge. This fee is charged to", null],
    ["Activation fee. This fee is charged to", null],
    ["Service charge if balance falls below", null],
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

  it("v3: counts renames by head and tail, with the way in each sample", () => {
    const found = findLiveFragments([
      { fee_published_id: 1, fee_verified_id: 1, institution_id: 9, fee_name: "Overdraft Fee You will be charged", amount: 35, canonical_fee_key: null },
      { fee_published_id: 2, fee_verified_id: 2, institution_id: 9, fee_name: "There will be a card replacement fee of", amount: 10, canonical_fee_key: null },
      { fee_published_id: 3, fee_verified_id: 3, institution_id: 9, fee_name: "Excess Withdrawal Fee if more than", amount: 6, canonical_fee_key: null },
    ]);
    expect(found).toMatchObject({ wouldRename: 2, wouldRenameByVia: { head: 1, tail: 1 }, wouldTakeDown: 1, wouldReread: 0, wouldRequestReread: 1 });
    const detail = liveFragmentDetail({ ...found, live: false, dryRun: true, afterId: 0, nextAfterId: 0, takenDown: [], renamed: [], rereadRequested: [], duplicateCheckFailed: false });
    expect(detail.would_rename_by_via).toEqual({ head: 1, tail: 1 });
    expect(detail.samples_by_action.rename.map((fee) => [fee.fee_published_id, fee.rename_to, fee.rename_via])).toEqual([[1, "Overdraft Fee", "head"], [2, "Card replacement fee", "tail"]]);
  });

  it("v5: keeps the 44880, 97910, 62758 and 68548 outcomes", () => {
    expect(liveFragmentVerdict("Inactive Accounts Fee (cont.) | If more than 3 years dormant the fee is", 15)).toMatchObject({ action: "rename", renameTo: "Inactive Accounts Fee" });
    expect(liveFragmentVerdict("After 5 days the account is charged a Consecutive days overdrawn (OD) fee of", 25)).toMatchObject({ action: "rename", renameTo: "Consecutive days overdrawn (OD) fee" });
    expect(liveFragmentVerdict("Withdrawals at an Allpoint network our ATM fee of", 2)).toEqual({ pattern: "sentence_end", action: "reread" });
    // 68548: its tail is a name the bank already has live at that price and category, so it comes down.
    const found = findLiveFragments([
      { fee_published_id: 1, fee_verified_id: 1, institution_id: 9, fee_name: "Return Item/Insufficient Funds Fee", amount: 30, canonical_fee_key: "nsf" },
      { fee_published_id: 2, fee_verified_id: 2, institution_id: 9, fee_name: "Each item returned unpaid is charged a Return Item/Insufficient Funds Fee of", amount: 30, canonical_fee_key: "nsf" },
    ]);
    expect(found.matches).toEqual([expect.objectContaining({ feePublishedId: 2, action: "takedown", takedownReason: "rename_duplicate", renameTo: "Return Item/Insufficient Funds Fee", renameVia: "tail" })]);
  });

  it("v5: a sentence_end line refused on its amount comes down and still asks Knox to re-read; a waived one asks nothing", async () => {
    const rows = [
      // Refused on the amount: a threshold, total wording, another price, a figure equal to the amount.
      { fee_published_id: 1, fee_verified_id: 11, institution_id: 9, fee_name: "Monthly Service Fee if balance below", amount: 500 },
      { fee_published_id: 2, fee_verified_id: 12, institution_id: 9, fee_name: "Excess Withdrawal Fee if more than", amount: 6 },
      { fee_published_id: 3, fee_verified_id: 13, institution_id: 9, fee_name: "Dormant Account Fee if inactive for more than", amount: 12 },
      { fee_published_id: 4, fee_verified_id: 14, institution_id: 9, fee_name: "A $20 NSF fee is charged per item; users may therefore incur $45 in NSF fees per day and", amount: 45 },
      { fee_published_id: 5, fee_verified_id: 15, institution_id: 9, fee_name: "a $35 Overdraft Fee if the transaction is paid or a $15 NSF Fee if returned and", amount: 15 },
      { fee_published_id: 6, fee_verified_id: 16, institution_id: 9, fee_name: "Overdraft Fee You will be charged $35 per item for", amount: 25 },
      { fee_published_id: 7, fee_verified_id: 17, institution_id: 9, fee_name: "Overdrafts of more than $5 will be charged an overdraft fee of", amount: 5 },
      // A waived price: down, no request.
      { fee_published_id: 8, fee_verified_id: 18, institution_id: 9, fee_name: ROW_58414, amount: 0 },
      // No gate refused the amount: kept live, re-read.
      { fee_published_id: 9, fee_verified_id: 19, institution_id: 9, fee_name: "Paper statement fee for the", amount: 2 },
    ];
    const found = findLiveFragments(rows);
    expect(found.matches.map((fee) => [fee.feePublishedId, fee.action, fee.rereadRequest ?? false])).toEqual([
      [1, "takedown", true], [2, "takedown", true], [3, "takedown", true], [4, "takedown", true], [5, "takedown", true],
      [6, "takedown", true], [7, "takedown", true], [8, "takedown", false], [9, "reread", true],
    ]);
    expect(found).toMatchObject({ wouldTakeDown: 8, wouldReread: 1, wouldRequestReread: 8 });
    const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      void values;
      const text = strings.join("?");
      if (text.includes("FROM agent_run_events")) return Promise.resolve([]);
      if (text.includes("FROM published_fee_records")) return Promise.resolve(rows);
      if (text.includes("UPDATE published_fee_records")) return Promise.resolve(rows.filter((row) => row.fee_published_id !== 9).map((row) => ({ fee_published_id: row.fee_published_id })));
      return Promise.resolve([]);
    });
    const result = await recheckLiveFragmentNames(asDb(db), { runId: 7, dryRun: false, live: true });
    expect(result.takenDown).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(result.rereadRequested).toEqual([9, 1, 2, 3, 4, 5, 6, 7]);
    const feedback = db.mock.calls.find(([strings]) => (strings as TemplateStringsArray).join("?").includes("INSERT INTO pipeline_feedback"));
    const written = JSON.parse(String(feedback?.[1])) as Array<{ fee_published_id: number; evidence: Record<string, unknown> }>;
    expect(written.find((row) => row.fee_published_id === 9)?.evidence).toMatchObject({ reason: "kept live: sentence_end with no name", kept_live: true });
    expect(written.find((row) => row.fee_published_id === 1)?.evidence).toMatchObject({ reason: "fragment name: sentence_end" });
    expect(written.find((row) => row.fee_published_id === 1)?.evidence).not.toHaveProperty("kept_live");
    expect(written.some((row) => row.fee_published_id === 8)).toBe(false);
  });

  it("v5: gluedSentenceSplit returns a generic head only when asked, flagged", () => {
    expect(gluedSentenceSplit("Monthly Fee if the balance falls below")).toBeNull();
    expect(gluedSentenceSplit("Monthly Fee if the balance falls below", { allowGeneric: true })).toEqual({ head: "Monthly Fee", rest: " if the balance falls below", generic: true });
    expect(gluedSentenceSplit("Monthly maintenance fee if your daily balance falls below")).toEqual({ head: "Monthly maintenance fee", rest: " if your daily balance falls below", generic: false });
    // Every other bar still refuses it, generic or not.
    expect(gluedSentenceSplit("Activation fee. This fee is charged to", { allowGeneric: true })).toBeNull();
    expect(gluedSentenceSplit("Wire Fee if you request", { allowGeneric: true })).toBeNull();
  });

  it("collides with a live name in the same read", () => {
    const found = findLiveFragments([
      { fee_published_id: 1, fee_verified_id: 1, institution_id: 9, fee_name: "Account Closing Fee", amount: 25, canonical_fee_key: "early_closure" },
      { fee_published_id: 2, fee_verified_id: 2, institution_id: 9, fee_name: "Account Closing Fee You will be charged on early closing", amount: 25, canonical_fee_key: "early_closure" },
    ]);
    expect(found.matches).toEqual([expect.objectContaining({ feePublishedId: 2, action: "takedown", takedownReason: "rename_duplicate" })]);
  });
});
