import { describe, expect, it, vi } from "vitest";

import { gluedSentenceHead, gluedSentenceSplit, isCutoffName, liveFragmentName, liveFragmentShape } from "@/lib/agents/knox/name-retidy";

import {
  FRAGMENT_NAME_TAKEDOWN_LIVE,
  LIVE_FRAGMENT_BATCH,
  LIVE_FRAGMENT_CAP_WORDING,
  LIVE_FRAGMENT_CREDIT,
  LIVE_FRAGMENT_CREDIT_WORD,
  LIVE_FRAGMENT_IF_THRESHOLD_WORD,
  LIVE_FRAGMENT_REREAD_KIND,
  LIVE_FRAGMENT_SQL_SPACES,
  LIVE_FRAGMENT_STRATEGY,
  liveFragmentCheckShape,
  liveFragmentCredit,
  liveFragmentCreditHeaded,
  liveFragmentCapRefused,
  countLiveFragmentNames,
  findLiveFragments,
  liveFragmentCountSql,
  liveFragmentDetail,
  liveFragmentVerdict,
  recheckLiveFragmentNames,
  liveNameKey,
  liveTwinKey,
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
    expect(liveFragmentName("Fee Schedule A")).toBeNull();
    expect(liveFragmentName("CHECK PRINTING N/A")).toBeNull();
    // v6 (review 9): Knox's shape, which the public name reads, is main's: no all-capitals article rule.
    for (const label of ["WIRE FEE FOR THE", "SERVICE CHARGE A", "BILL PAY A", "TRANSFER TO A", "SAFE DEPOSIT BOX SIZE A", "PLAN A"]) {
      expect(liveFragmentName(label)).toBeNull();
    }
    // Darwin's live check reads it on its own (109893): a verb or function word and the article.
    expect(liveFragmentCheckShape("10NON-MEMBER LOAN APPLICATION FEE: IF YOU ARE NOT A MEMBER OF WCDU, THERE IS A")).toBe("sentence_end");
    expect(liveFragmentCheckShape("NSF FEE. THERE IS A")).toBe("sentence_end");
    expect(liveFragmentCheckShape("STOP PAYMENT FEE YOU WILL BE CHARGED A")).toBe("sentence_end");
    expect(liveFragmentCheckShape("WIRE FEE FOR THE")).toBe("sentence_end");
    for (const label of ["SAFE DEPOSIT BOX SIZE A", "CHECKING PLAN A", "OPTION A", "SCHEDULE A", "SERVICE CHARGE A", "BILL PAY A", "MONTHLY SERVICE CHARGE A", "CHECKING - PAY THE"]) {
      expect(liveFragmentCheckShape(label)).toBeNull();
    }
  });
});

type DbMock = ReturnType<typeof vi.fn>;

function dbFor(rows: Array<Record<string, unknown>>, cursor: string | null = null, existing: Array<Record<string, unknown>> | null = []): DbMock {
  return vi.fn((strings: TemplateStringsArray) => {
    const text = strings.join("?");
    if (text.includes("FROM agent_run_events")) return Promise.resolve(cursor == null ? [] : [{ next_after_id: cursor }]);
    if (text.includes("lower(btrim(regexp_replace(translate(fp.fee_name")) return existing == null ? Promise.reject(new Error("read failed")) : Promise.resolve(existing);
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
  { fee_published_id: "60003", fee_verified_id: "9004", institution_id: "77", fee_name: "Overdraft Fee. This fee will be charged for each item", amount: "35", canonical_fee_key: "overdraft", source_document_id: "501" },
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
    const db = dbFor(ROWS, null, [{ institution_id: "77", canonical_fee_key: "overdraft", amount: "35.00", fee_name: "Overdraft  Fee ", source_document_id: "501" }]);
    const result = await recheckLiveFragmentNames(asDb(db), { runId: 7, dryRun: false, live: true });
    expect(result.renamed).toEqual([]);
    expect(result.takenDown).toEqual([58414, 60003, 60005]);
    expect(result).toMatchObject({ wouldRename: 0, wouldTakeDown: 3, takedownByReason: { fragment: 2, rename_duplicate: 1 } });
    expect(JSON.stringify(db.mock.calls)).toContain("fragment name: pronoun (rename_duplicate)");
    const read = db.mock.calls.map(([strings]) => (strings as TemplateStringsArray).join("?")).find((text) => text.includes("lower(btrim(regexp_replace"));
    expect(read).toContain("fp.quarantined_at IS NULL");
    // postgres.js sends the cooked template text: the regex must reach Postgres as \s+, not s+.
    expect(read).toContain("?), '\\s+', ' ', 'g')");
    // Round 7 (#1521): the no-break spaces and U+FEFF read as spaces here too, as in JS's \s.
    expect(read).toContain("regexp_replace(translate(fp.fee_name, ?, ?)");
    const readCall = db.mock.calls.find(([strings]) => (strings as TemplateStringsArray).join("?").includes("lower(btrim(regexp_replace"));
    expect(readCall).toContain(LIVE_FRAGMENT_SQL_SPACES);
    expect(LIVE_FRAGMENT_SQL_SPACES).toBe("\u00a0\u2007\u202f\ufeff");
    expect(read).toContain("fr.source_document_id");
  });

  it("v6: keeps live for a re-read, not takes down, a rename onto a live name from another document or none", async () => {
    for (const doc of ["502", null]) {
      const db = dbFor(ROWS, null, [{ institution_id: "77", canonical_fee_key: "overdraft", amount: "35.00", fee_name: "Overdraft Fee", source_document_id: doc }]);
      const result = await recheckLiveFragmentNames(asDb(db), { runId: 7, dryRun: false, live: true });
      expect(result.renamed).toEqual([]);
      expect(result.takenDown).toEqual([58414, 60005]);
      expect(result).toMatchObject({ wouldRename: 0, takedownByReason: { fragment: 2, rename_duplicate: 0 } });
      expect(result.samplesByAction.reread.map((fee) => fee.feePublishedId)).toContain(60003);
    }
  });

  it("counts the duplicate in shadow and in a dry run too", async () => {
    const existing = [{ institution_id: "77", canonical_fee_key: "overdraft", amount: "35", fee_name: "Overdraft Fee", source_document_id: 501 }];
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
    expect(LIVE_FRAGMENT_STRATEGY.version).toBe(6);
    expect(text).toContain("AS figure_is_amount");
    expect(text).toContain("AND tail_ok AND tail !~ '[0-9$]'");
    expect(text).toContain("btrim(regexp_replace(name, '\\s*\\((?:cont\\.?|continued)\\)', '', 'gi')), '^(?:(?:\\d{2}");
    expect(text).toContain("substring(readable from '^((?!");
    expect(text).toContain("THEN 'rename_tail'");
    expect(text).toContain("'gi'), '\\$\\s?(\\d");
    expect(text).toContain("COALESCE(amount < 100 AND NOT COALESCE(figure_is_amount, false)");
    expect(text).toContain("name ~* '\\y(?:minimum|min|opening|initial)");
    expect(text).toContain("head !~* '^(?:customers?|no\\s+matter|to\\s+request|all)\\y");
    expect(text).not.toContain("(?<");
  });

  it("v5: mirrors the generic-head gate and the count-aware figure gate in SQL", () => {
    const text = liveFragmentCountSql();
    expect(text).toContain("AS head_generic");
    // Round 4: the narrow rename forms (`exception_ok`), the rename bar on the rest and on the whole tail line.
    expect(text).toContain("AS exception_ok");
    expect(text).toContain("AND (exception_ok OR (head_ok AND NOT rest ~* ");
    expect(text).toContain("AND NOT gate_refused AND renamable AND NOT head_ok AND NOT exception_ok AND readable ~* ");
    expect(text).toContain("AS first_is_amount");
    expect(text).toContain("regexp_matches(readable, '(\\$\\s?)?(\\d");
    expect(text).toContain("WHERE m[1] IS NULL AND m[2] !~ '\\.\\d{2}$' AND NOT (amount < 100 AND m[2] !~ '\\.' AND m[3] IS NOT NULL)");
    // Round 6 (rev12): no-break spaces read as spaces, as in JS; a soft if/when refusal or a floor never takes a line down.
    // Round 7 (#1521): U+FEFF too.
    expect(text).toContain("translate(COALESCE(fp.fee_name, ''), U&'\\00A0\\2007\\202F\\FEFF', '    ')");
    expect(text).toContain("AS takedown_refused");
    expect(text).toContain("WHEN takedown_refused AND NOT (amount < 100) THEN 'fragment_reread'");
    expect(text).toContain("\\y(?:may\\s+therefore|");
    expect(text).toContain("(?:only\\s+)?(?:if|when)");
    expect(text).toContain("'^activation\\s+(?:fees?|charges?)$'");
    expect(text).toContain("WHEN pattern = 'plus' OR amount IS NULL OR amount <= 0 OR ((EXISTS (SELECT 1 FROM regexp_matches(name, ");
    expect(text).toContain("WHEN reason = 'reread' THEN 'reread'");
    expect(text).toContain("ELSE 'reread'");
    expect(text).toContain("WHEN reason IN ('fragment', 'fragment_reread', 'rename_duplicate') THEN 'takedown'");
  });
});

describe("live fragment switch-on rules (#1443)", () => {
  it.each([
    // Parentheticals: a pronoun inside one qualifies the fee.
    ["Stop Payment (per item, if you request it)", 30, "stop_payment", { pattern: "pronoun", action: "exempt", exemptReason: "parenthetical" }],
    ["Cashier's Check (if you are not a member)", 10, null, { pattern: "pronoun", action: "exempt", exemptReason: "parenthetical" }],
    // ... but not when the pronoun is outside it too.
    // v6 (#1499): a pronoun line with no rename and a plausible amount stays live for a Knox re-read.
    ["Paper Statement (monthly) you will be charged", 3, null, { pattern: "pronoun", action: "reread" }],
    // Glued sentence: the fee keeps its leading name.
    ["Overdraft Fee You will be charged when an item is paid into overdraft", 35, "overdraft", { pattern: "pronoun", action: "reread" }],
    ["Returned Item Fee - you will be charged for each item returned", 30, "nsf", { pattern: "pronoun", action: "reread" }],
    ["Stop Payment You will be charged", 30, "stop_payment", { pattern: "pronoun", action: "rename", renameTo: "Stop Payment", renameVia: "head" }],
    ["Inactive fee: This account may be subject to an Inactive fee of", 5, null, { pattern: "sentence_end", action: "reread" }],
    // ... unless the amount is $0 or the name speaks of a waiver: a waived price comes down.
    ["Monthly Service Fee You will be charged unless", 0, null, { pattern: "pronoun", action: "takedown" }],
    // v6: waiver wording alone at a positive amount no longer takes the fee down, and never renames it: reread.
    ["Monthly Service Fee You can avoid this fee by", 10, null, { pattern: "sentence_end", action: "reread" }],
    // Pure fragments come down.
    ["Dormant accounts will be charged a monthly", 5, "dormant_account", { pattern: "pronoun", action: "reread" }],
    ["If you close your account within 90 days", 25, null, { pattern: "pronoun", action: "reread" }],
    ["Wire Transfer Fee if you request a wire", 25, null, { pattern: "pronoun", action: "reread" }],
    // A sentence_end line at $0, with no amount or with waiver wording is a waived price: it comes down (5314, #1436).
    [ROW_58414, 0, null, { pattern: "sentence_end", action: "takedown" }],
    // v6: at a positive price the waiver wording alone keeps it live for a re-read ($0 above still comes down).
    [ROW_58414, 7.95, null, { pattern: "sentence_end", action: "reread" }],
    ["Paper statement fee for the", null, null, { pattern: "sentence_end", action: "takedown" }],
    ["Paper statement fee is waived for", 2, null, { pattern: "sentence_end", action: "reread" }],
    ["Paper statement fee for the", 0, null, { pattern: "sentence_end", action: "takedown" }],
    // v5: a plain sentence_end line no gate refused on its amount stays live for a Knox re-read.
    ["Paper statement fee for the", 2, null, { pattern: "sentence_end", action: "reread" }],
    ["+ $5.00 for each additional", 5, null, { pattern: "plus", action: "takedown" }],
    // Trailing range: down only on waiver wording or $0; otherwise report only.
    ["Overdraft fee charged per", 35, null, { pattern: "trailing_range", action: "exempt", exemptReason: "trailing_range_priced" }],
    ["NSF fee (ACH, ATM, or check) - per", 30, null, { pattern: "trailing_range", action: "exempt", exemptReason: "trailing_range_priced" }],
    ["Monthly maintenance fee waived per", 10, null, { pattern: "trailing_range", action: "reread" }],
    ["Late Fee | Up to", 0, null, { pattern: "trailing_range", action: "takedown" }],
    ["Discounted Safe Deposit Box rent up to", 40, null, { pattern: "trailing_range", action: "reread" }],
    // v2 (#1499) prod hand-check.
    ["Returned/Non-Sufficient Funds (NSF) fee (per item). This fee applies to", 40, null, { pattern: "sentence_end", action: "reread" }],
    ["Legal Attachments, Levies, and Garnishment Fee A fee of", 60, null, { pattern: "sentence_end", action: "reread" }],
    ["ATM Withdrawal Service Charge at Non-BankFive ATM BankFive may impose a", 1.5, null, { pattern: "sentence_end", action: "reread" }],
    ["Monthly maintenance fee if the average daily balance falls below", 6.05, null, { pattern: "sentence_end", action: "rename", renameTo: "Monthly maintenance fee", renameVia: "head" }],
    ["10NON-MEMBER LOAN APPLICATION FEE THE FEE IS NON-REFUNDABLE AND IS", 25, null, { pattern: "sentence_end", action: "reread" }],
    // v5 (142422): a generic head renames on a balance-below condition under $100 (see the v5 block).
    ["Monthly Fee if the balance falls below", 5, null, { pattern: "sentence_end", action: "rename", renameTo: "Monthly Fee", renameVia: "head" }],
    ["Account Fees The following fees apply to", 5, null, { pattern: "sentence_end", action: "reread" }],
    // v6 (142713): another bank's charge is no fee of this bank.
    ["Bank sending the wire may charge a fee of", 15, null, { pattern: "sentence_end", action: "reread" }],
    ["ATM5, Telephone Banking and Bill Payment The minimum opening deposit is", 20, null, { pattern: "sentence_end", action: "reread" }],
    // A minimum or opening deposit in the line is never renamed, even under a clean head.
    ["Paper Statement Fee The minimum opening deposit is", 20, null, { pattern: "sentence_end", action: "reread" }],
    ["Teller Check Payable to Someone Other than", 10, null, { pattern: "sentence_end", action: "reread" }],
    // v6 (144639): a fee line ending on "balance of" under $100 is kept live for a re-read, never renamed.
    ["Monthly Service Fee waived with minimum daily balance of", 10, null, { pattern: "sentence_end", action: "reread" }],
    // v3 (#1499): an "if"/"when" condition renames only on a balance condition under $100.
    ["Monthly Service Fee if balance below", 500, null, { pattern: "sentence_end", action: "takedown" }],
    ["Monthly Service Fee if balance below", 10, null, { pattern: "sentence_end", action: "rename", renameTo: "Monthly Service Fee", renameVia: "head" }],
    ["Monthly Service Fee If your average daily balance falls below", 10, null, { pattern: "sentence_end", action: "rename", renameTo: "Monthly Service Fee", renameVia: "head" }],
    ["Overdraft Fee when overdrawn by more than", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Excess Withdrawal Fee if more than", 6, null, { pattern: "sentence_end", action: "reread" }],
    ["Dormant Account Fee if inactive for more than", 12, null, { pattern: "sentence_end", action: "reread" }],
    ["Dormant Account Fee If inactive for 12 months or more the fee is", 5, null, { pattern: "sentence_end", action: "reread" }],
    // v3: another price in the name means no rename (133792, 55708).
    // v6 (125163, 125166): when the amount is a later price on the line, the line is no rename but a reread.
    ["a $35 Overdraft Fee if the transaction is paid or a $15 NSF Fee if returned and", 15, null, { pattern: "sentence_end", action: "reread" }],
    ["a $35 Overdraft Fee if the transaction is paid or a $15 NSF Fee if returned and", 20, null, { pattern: "sentence_end", action: "reread" }],
    ["A $20 NSF fee is charged per item; users may therefore incur $45 in NSF fees per day and", 45, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee You will be charged $35 per item for", 25, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee You will be charged $35 per item for", 35, null, { pattern: "sentence_end", action: "reread" }],
    // v3: "(cont.)" dropped (44880).
    ["Inactive Accounts Fee (cont.) This fee is charged to", 5, null, { pattern: "sentence_end", action: "reread" }],
    // v3: a sentence_end line with no head takes the fee its sentence ends on (tail).
    ["Paper statements are available for a monthly paper statement fee of", 3, null, { pattern: "sentence_end", action: "reread" }],
    ["If your balance falls below $500 you will be charged a minimum balance fee of", 6, null, { pattern: "sentence_end", action: "reread" }],
    ["There will be a card replacement fee of", 10, null, { pattern: "sentence_end", action: "reread" }],
    // Round 7 (#1521): a line cut at its start (lower case) takes no tail rename; a capital lead still does.
    ["you will be charged an overdraft fee of", 35, null, { pattern: "sentence_end", action: "reread" }],
    ["You will be charged an overdraft fee of", 35, null, { pattern: "sentence_end", action: "rename", renameTo: "Overdraft fee", renameVia: "tail" }],
    ["The account is charged a fee of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["You will pay a service charge fee of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["You will pay a monthly fee of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["You will pay a minimum fee of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["You can avoid the paper statement fee of", 3, null, { pattern: "sentence_end", action: "reread" }],
    ["Accounts opened with a minimum opening deposit have a setup fee of", 25, null, { pattern: "sentence_end", action: "reread" }],
    ["If your balance falls below $500 you will be charged a minimum balance fee of", 0, null, { pattern: "sentence_end", action: "takedown" }],
    ["Customers who opt in pay a paper statement fee of", 3, null, { pattern: "sentence_end", action: "reread" }],
    // v4 (#1499 review): no tail rename when a figure in the line equals the amount.
    ["If your balance falls below $500 you will be charged a minimum balance fee of", 500, null, { pattern: "sentence_end", action: "takedown" }],
    ["If your balance falls below $500 you will be charged a minimum balance fee of", 500.0, null, { pattern: "sentence_end", action: "takedown" }],
    ["If your balance falls below $1,000 you will be charged a minimum balance fee of", 1000, null, { pattern: "sentence_end", action: "takedown" }],
    ["Accounts with a balance under $500 will be charged a maintenance fee of", 500, null, { pattern: "sentence_end", action: "takedown" }],
    ["Accounts with a balance under $500 will be charged a maintenance fee of", 10, null, { pattern: "sentence_end", action: "reread" }],
    ["Wires are $15 incoming and an outgoing wire fee of", 15, null, { pattern: "sentence_end", action: "reread" }],
    ["Wires are $15 incoming and an outgoing wire fee of", 25, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdrafts of more than $5 will be charged an overdraft fee of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdrafts of more than $5 will be charged an overdraft fee of", 25, null, { pattern: "sentence_end", action: "reread" }],
    ["Accounts inactive for 12 months will be charged a dormant account fee of", 12, null, { pattern: "sentence_end", action: "reread" }],
    ["Accounts inactive for 12 months will be charged a dormant account fee of", 10, null, { pattern: "sentence_end", action: "reread" }],
    // v5 (137819): "6 withdrawals" is a count, so the figure gate no longer reads it as the amount.
    ["If you exceed 6 withdrawals per month you will be charged an excess withdrawal fee of", 6, null, { pattern: "sentence_end", action: "reread" }],
    ["If you exceed 6 withdrawals per month you will be charged an excess withdrawal fee of", 10, null, { pattern: "sentence_end", action: "reread" }],
    // v4: a balance condition that also counts an excess is a threshold.
    ["Excess Transaction Fee if more than 6 per month, balance below", 10, null, { pattern: "sentence_end", action: "reread" }],
    // v4 round-3 hand check. Total wording is a sum, never renamed (55708).
    ["Bill Pay NSF Fee. This fee is passed along per returned payment; Bill Pay users may therefore incur $45 in NSF fees for", 45, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee. You may be charged up to a total of", 105, null, { pattern: "sentence_end", action: "takedown" }],
    // A dormancy tier after a cell break is the fee's condition (44880).
    ["Inactive Accounts Fee (cont.) | If more than 3 years dormant the fee is", 15, null, { pattern: "sentence_end", action: "rename", renameTo: "Inactive Accounts Fee", renameVia: "head" }],
    ["Dormant Account Fee | If inactive for 12 months the fee is", 5, null, { pattern: "sentence_end", action: "rename", renameTo: "Dormant Account Fee", renameVia: "head" }],
    ["Inactive Accounts Fee | If more than 3 years dormant the fee is", 3, null, { pattern: "sentence_end", action: "reread" }],
    ["Dormant Account Fee if inactive for more than", 12, null, { pattern: "sentence_end", action: "reread" }],
    // Tail qualifiers dropped; generic tails and "our"/"your" refused.
    ["Each returned item is charged the appropriate returned item fee of", 30, null, { pattern: "sentence_end", action: "reread" }],
    ["Each item paid is charged the Bank's normal overdraft item charge of", 30, null, { pattern: "sentence_end", action: "reread" }],
    ["Items are subject to a handling fee of", 5, null, { pattern: "sentence_end", action: "reread" }],
    // v5 (98668): a bare "Activation fee" is too generic (it was a gift card's).
    ["New cards carry a low activation fee of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["This account has a monthly flat fee of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["This account has a small monthly fee of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Payments received after the due date carry a late charge of", 15, null, { pattern: "sentence_end", action: "reread" }],
    ["Withdrawals at an Allpoint network our ATM fee of", 2, null, { pattern: "sentence_end", action: "reread" }],
    // A lower-case head before a balance-below condition (132041); v6 (125163, 125166): a line opening in lower
    // case was cut where its price stood, so its head is no rename: kept live, re-read.
    ["monthly service fee if balance falls below", 10, null, { pattern: "sentence_end", action: "reread" }],
    ["monthly service fee if more than 6 withdrawals, balance below", 10, null, { pattern: "sentence_end", action: "reread" }],
    // "/" and a parenthetical inside a tail (68548, 97910).
    ["Each item returned unpaid is charged a Return Item/Insufficient Funds Fee of", 30, null, { pattern: "sentence_end", action: "reread" }],
    ["After 5 days the account is charged a Consecutive days overdrawn (OD) fee of", 25, null, { pattern: "sentence_end", action: "reread" }],
    ["After 5 days the account is charged a Consecutive days overdrawn (OD) fee of", 5, null, { pattern: "sentence_end", action: "reread" }],
    // v4 review: "up to", "a minimum of" state a price on a fee line, so the figure is another price.
    ["Overdraft Fee You will be charged up to $35 per item", 5, null, { pattern: "pronoun", action: "reread" }],
    ["Wire Transfer Fee You will be charged up to $35 per wire", 15, null, { pattern: "pronoun", action: "reread" }],
    ["Stop Payment Fee You will be charged a minimum of $30", 10, null, { pattern: "pronoun", action: "reread" }],
    ["Wires are up to $15 incoming and an outgoing wire fee of", 25, null, { pattern: "sentence_end", action: "reread" }],
    // A tail that opens on a parenthetical names no fee.
    ["Accounts overdrawn are charged the (OD) fee of", 25, null, { pattern: "sentence_end", action: "reread" }],
    ["Accounts overdrawn are charged a (see schedule) fee of", 25, null, { pattern: "sentence_end", action: "reread" }],
    // A head that is refused does not fall back to the tail when the line has a head split from a threshold.
    ["Overdraft Fee when overdrawn by more than $5 a daily overdraft fee of", 5, null, { pattern: "sentence_end", action: "reread" }],
    // v5 (#1499, prod hand-check of v4: 101 of 105 renames right).
    // 55708: the stored name is cut just after "may therefore" (the "$45 in NSF fees" is gone): a total, no rename.
    ["NSF fee. This fee is passed along for each returned Bill Pay payment, so you may therefore", 45, null, { pattern: "pronoun", action: "reread" }],
    ["Bill Pay NSF Fee. Bill Pay users may therefore be charged for", 45, null, { pattern: "sentence_end", action: "reread" }],
    // 64144: a period and a fee word alone is generic, as head or tail.
    ["Per quarter charge. This fee is charged to", 3, null, { pattern: "sentence_end", action: "reread" }],
    ["Accounts are assessed a per quarter charge of", 3, null, { pattern: "sentence_end", action: "reread" }],
    ["Per month fee. This fee is charged to", 3, null, { pattern: "sentence_end", action: "reread" }],
    ["Inactive accounts are charged a per year fee of", 3, null, { pattern: "sentence_end", action: "reread" }],
    ["Quarterly charge. This fee is charged to", 3, null, { pattern: "sentence_end", action: "reread" }],
    // 98668: a bare "Activation fee" (a gift card's) is generic; a named one is not.
    ["Gift cards carry an activation fee of", 4, null, { pattern: "sentence_end", action: "reread" }],
    ["Activation fee. This fee is charged to", 4, null, { pattern: "sentence_end", action: "reread" }],
    ["New cards carry a debit card activation fee of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Card Activation Fee. This fee is charged to", 4, null, { pattern: "sentence_end", action: "reread" }],
    // 132041: "only if" / "only when" before a balance-below condition reaches the balance gate.
    ["Monthly maintenance fee only if the balance falls below", 5, null, { pattern: "sentence_end", action: "rename", renameTo: "Monthly maintenance fee", renameVia: "head" }],
    ["monthly maintenance fee only when the balance falls below", 5, null, { pattern: "sentence_end", action: "rename", renameTo: "Monthly maintenance fee", renameVia: "head" }],
    ["Monthly maintenance fee only if the balance falls below", 500, null, { pattern: "sentence_end", action: "takedown" }],
    ["Excess Withdrawal Fee only if more than", 6, null, { pattern: "sentence_end", action: "reread" }],
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
    ["Monthly Fee if more than 6 withdrawals, balance below", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Monthly Fee | If inactive for 12 months the fee is", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Monthly Fee. This fee is charged to", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Service charge if the 5-day average balance falls below", 5, null, { pattern: "sentence_end", action: "reread" }],
    // A generic head that is refused still lets the line's tail name the fee, as before v5.
    ["Monthly Fee. There is a paper statement fee of", 3, null, { pattern: "sentence_end", action: "reread" }],
    // 109893: the glued footnote "10" is no figure for the figure gate.
    ["10NON-MEMBER LOAN APPLICATION FEE Non-members applying for a loan pay a loan application fee of", 10, null, { pattern: "sentence_end", action: "reread" }],
    ["10NON-MEMBER LOAN APPLICATION FEE if the balance falls below", 10, null, { pattern: "sentence_end", action: "rename", renameTo: "NON-MEMBER LOAN APPLICATION FEE", renameVia: "head" }],
    // 137819: a bare whole figure before a count noun is a count, never the price.
    ["Accounts with more than 6 debits per month are charged an excessive transaction fee of", 6, null, { pattern: "sentence_end", action: "reread" }],
    ["Accounts with more than 3 Withdrawals per month are charged an excess withdrawal fee of", 3, null, { pattern: "sentence_end", action: "reread" }],
    // ... but a dollar figure, a decimal, a figure with no count noun, or a span of time still is one
    // (97910's "After 5 days" $5 and 44880's "3 years dormant" $3 above stay takedowns).
    ["Accounts with more than $6 in debits are charged an excessive transaction fee of", 6, null, { pattern: "sentence_end", action: "reread" }],
    ["Accounts with more than 6.00 debits are charged an excessive transaction fee of", 6, null, { pattern: "sentence_end", action: "reread" }],
    // The count skip holds only under $100: a count equal to a large amount is the amount misread.
    ["Accounts with more than 1,000 items are charged an item processing fee of", 1000, null, { pattern: "sentence_end", action: "takedown" }],
    ["Accounts with more than 6 per month are charged an excessive transaction fee of", 6, null, { pattern: "sentence_end", action: "reread" }],
    ["Accounts inactive for 12 Months are charged a dormant account fee of", 12, null, { pattern: "sentence_end", action: "reread" }],
    // 109893: the capitalised "THERE IS A" opens the sentence after the glued footnote, so the head is read.
    ["10NON-MEMBER LOAN APPLICATION FEE THERE IS A $10.00 NON-MEMBER APPLICATION FEE FOR", 10, null, { pattern: "sentence_end", action: "reread" }],
    ["10NON-MEMBER LOAN APPLICATION FEE. THERE IS A $10.00 NON-MEMBER APPLICATION FEE TO", 10, null, { pattern: "sentence_end", action: "reread" }],
    // 125166: with its figures in the name, the second price ($9, the amount) bars the rename: kept live, re-read (v6) ...
    ["$3.00 per monthly fee if balance falls below $150, $9 per item charge after 3 withdrawals of", 9, null, { pattern: "sentence_end", action: "reread" }],
    // ... and 125163 the same: $2 is the paper statement fee, not the $5 monthly service charge.
    ["$5 monthly service charge when balance falls below $300. $2 paper statement fee for", 2, null, { pattern: "sentence_end", action: "reread" }],
    // ... and the live names, which lost their figures, open in lower case: no rename, kept live (v6).
    ["per monthly fee if balance falls below", 9, null, { pattern: "sentence_end", action: "reread" }],
    // v6 (#1499, prod check of v5). A: gates that refused real fees.
    // 96650-96652, 136152: "if Account Falls Below" (and "... Minimum Balance of") is a balance condition.
    ["Regular Checking Business Service Charge if Account Falls Below", 10, null, { pattern: "sentence_end", action: "rename", renameTo: "Regular Checking Business Service Charge", renameVia: "head" }],
    ["Money Market Business Service Charge if Account Falls Below", 15, null, { pattern: "sentence_end", action: "rename", renameTo: "Money Market Business Service Charge", renameVia: "head" }],
    ["Statement Savings Business Service Charge if Account Falls Below", 5, null, { pattern: "sentence_end", action: "rename", renameTo: "Statement Savings Business Service Charge", renameVia: "head" }],
    // v6 review: "... Minimum Balance of" ends on the threshold: its amount is refused, never renamed.
    ["Monthly Maintenance Fee if Account Falls Below Minimum Balance of", 4, null, { pattern: "sentence_end", action: "rename", renameTo: "Monthly Maintenance Fee", renameVia: "head" }],
    ["Regular Checking Business Service Charge if Account Falls Below", 150, null, { pattern: "sentence_end", action: "takedown" }],
    // 129443: a balance band is the fee's own tier: kept live for a re-read, not taken down.
    ["monthly service charge if the average daily is more than or equal to but less than", 1, null, { pattern: "sentence_end", action: "reread" }],
    // 142676, 146563, 146643: a fee/charge head before ":" or a dash and an if/when clause.
    ["Closing Fee: When the account is closed within 90 days of the open date, there will be a", 20, null, { pattern: "sentence_end", action: "reread" }],
    ["Inactivity Fee - If no activity for 12 consecutive months, a monthly inactivity fee of", 3, null, { pattern: "sentence_end", action: "rename", renameTo: "Inactivity Fee", renameVia: "head" }],
    // v6 review: the colon gate carries the balance gate's bars, so an excess ("more than 10 business days") refuses the amount.
    ["Continuous Overdraft Charge: If your account remains overdrawn for more than 10 business days, a", 1, null, { pattern: "sentence_end", action: "rename", renameTo: "Continuous Overdraft Charge", renameVia: "head" }],
    // ... never when a figure in the line is the amount, and never with no colon or dash.
    ["Inactivity Fee - If no activity for 12 consecutive months, a monthly inactivity fee of", 12, null, { pattern: "sentence_end", action: "reread" }],
    ["Dormant Account Fee If inactive for 12 months or more the fee is", 5, null, { pattern: "sentence_end", action: "reread" }],
    // 70303: "$5.00" after "more than" is a threshold, not another price.
    ["Overdraft (OD) or Non-sufficient Funds (NSF) item - account overdrawn more than $5.00 Fees for", 30, null, { pattern: "sentence_end", action: "reread" }],
    // B: waiver wording at a positive price is the fee's price: reread, or a tail rename.
    ["combined balance requirement in qualifying related accounts to avoid monthly service fee of", 15, null, { pattern: "sentence_end", action: "reread" }],
    ["Monthly Maintenance Fee at each statement cycle, but may be reduced or eliminated by", 6.5, null, { pattern: "sentence_end", action: "reread" }],
    ["Fee Monthly fee waived first 3 months and no fee in months with a", 4.95, null, { pattern: "sentence_end", action: "reread" }],
    ["Any overdraft fees charged on this account will be at a discounted fee of", 15, null, { pattern: "sentence_end", action: "reread" }],
    ["average collected daily balance required to avoid monthly service charge of", 10, null, { pattern: "sentence_end", action: "reread" }],
    ["average collected daily balance required to avoid monthly service charge of", 15, null, { pattern: "sentence_end", action: "reread" }],
    // v6 review: waiver or discount wording bars every rename, head or tail: kept live for a re-read.
    ["Minimum balance to avoid imposition of fees - A club fee of", 8, null, { pattern: "sentence_end", action: "reread" }],
    ["MONTHLY FEE: The Primary Account Owner Must Meet One of the Following Monthly Statement Cycle Requirements to Avoid a", 12, null, { pattern: "sentence_end", action: "reread" }],
    ["monthly maintenance fee. If primary account holder is over age 50, a discounted monthly maintenance fee of", 4.95, null, { pattern: "sentence_end", action: "reread" }],
    // 133104: a line ending on "balance of" read the threshold as its amount (down, with a re-read request) unless it
    // names a fee or charge under $100 (v6, 144639): then it is kept live for a re-read, never renamed.
    ["Avoid service charge with minimum balance of", 3, null, { pattern: "sentence_end", action: "reread" }],
    ["Account maintains a minimum balance of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Service charge if your account is below the minimum balance of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Service charge if your account is below the minimum balance of", 150, null, { pattern: "sentence_end", action: "takedown" }],
    // 133104: a dollar figure with a period ("$3 per quarter") is the fee's own price, so the figure gate lets it through.
    ["Quarterly service charge of $3 per quarter if balance falls below", 3, null, { pattern: "sentence_end", action: "reread" }],
    ["Service charge $3 per quarter when the minimum balance of", 3, null, { pattern: "sentence_end", action: "reread" }],
    // 37674: "$2,500 if not fee will be charged" is a balance, not a priced fee: kept live, re-read.
    ["Elite Money Market Minimum balance $2,500 if not fee will be charged monthly", 12, null, { pattern: "pronoun", action: "reread" }],
    ["Elite Money Market if not fee will be charged monthly", 12, null, { pattern: "pronoun", action: "reread" }],
    // 93834: "reduced to" is a reduced rate: no rename ("Debit" stays in the head when there is one), kept live.
    ["Debit Card overdraft fee will be reduced to $5.00", 5, null, { pattern: "pronoun", action: "reread" }],
    ["Debit Card overdraft fee will be reduced to", 5, null, { pattern: "sentence_end", action: "reread" }],
    // A credit or discount amount comes down (87742's "−$2"), as does a $0 waiver (58414 above).
    ["Monthly fee −$2 discount with e-statements for", 2, null, { pattern: "sentence_end", action: "reread" }],
    ["E-statement discount of $2 per month for", 2, null, { pattern: "sentence_end", action: "takedown" }],
    ["E-statement $2.50 credit per month for", 2.5, null, { pattern: "sentence_end", action: "reread" }],
    ["Monthly fee reduced by $2 for", 2, null, { pattern: "sentence_end", action: "takedown" }],
    ["E-statement discount for", -2, null, { pattern: "sentence_end", action: "takedown" }],
    // C: pronoun lines. Real fees stay live for a re-read.
    ["balance will be assessed a monthly service fee of either", 2.5, null, { pattern: "pronoun", action: "reread" }],
    ["If an account has been inactive after a period of one year, the credit union will charge a monthly fee until su", 5, null, { pattern: "pronoun", action: "reread" }],
    ["We will charge your account", 6.99, null, { pattern: "pronoun", action: "reread" }],
    // ... a worked example, a $0 waiver and another bank's charge come down.
    ["available in your account, our payment of this transaction will result in an overdraft transaction. Because the transact", 20, null, { pattern: "pronoun", action: "reread" }],
    ["For example, if you have $50 available and you write a check that", 35, null, { pattern: "pronoun", action: "takedown" }],
    ["Monthly service charges will be waived for minors", 0, null, { pattern: "pronoun", action: "takedown" }],
    ["Bank sending the wire will typically charge", 20, null, { pattern: "pronoun", action: "reread" }],
    // v6 review: "typically charge" alone is no refusal; only "bank sending" / "sending bank" name another bank.
    ["Receiving banks will typically charge a fee", 15, null, { pattern: "pronoun", action: "reread" }],
    // ... "other banks" alone is no refusal (a foreign ATM fee is this bank's fee).
    ["ATM Fee at other banks You will be charged", 2, null, { pattern: "pronoun", action: "reread" }],
    // D: a cap or floor is a limit, not the price: down, with a re-read request.
    ["Generally 4% of principal and interest for government loans (VA &amp;amp; FHA); maximum late charge of", 30, null, { pattern: "sentence_end", action: "reread" }],
    ["Non-member check cashing min or 1% with max of", 25, null, { pattern: "sentence_end", action: "reread" }],
    ["Greater of", 10, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee. The lesser of", 30, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft fees are capped at", 105, null, { pattern: "sentence_end", action: "takedown" }],
    // ... "Max" naming a product is no cap.
    ["Max Checking Monthly Fee You will be charged", 12, null, { pattern: "pronoun", action: "rename", renameTo: "Max Checking Monthly Fee", renameVia: "head" }],
    // E (109893): an all-capitals line ending on "A" is a sentence_end, and the colon head renames.
    ["10NON-MEMBER LOAN APPLICATION FEE: IF YOU ARE NOT A MEMBER OF WCDU, THERE IS A", 10, null, { pattern: "sentence_end", action: "reread" }],
    // v6 review, 1: the colon or dash head gate carries the threshold bars; a threshold is refused (fragment_reread).
    ["Overdraft Fee: If overdrawn by more than", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Excess Withdrawal Fee: If more than", 6, null, { pattern: "sentence_end", action: "reread" }],
    ["Dormant Account Fee - If inactive for more than", 12, null, { pattern: "sentence_end", action: "reread" }],
    ["Monthly Service Fee: If balance falls below", 500, null, { pattern: "sentence_end", action: "takedown" }],
    ["Monthly Service Fee - When balance falls below", 1500, null, { pattern: "sentence_end", action: "takedown" }],
    ["Closing Fee - If closed early the", 150, null, { pattern: "sentence_end", action: "reread" }],
    ["Closing Fee: When the account is closed the", 25, null, { pattern: "sentence_end", action: "reread" }],
    // v6 review, 2: waiver wording bars a rename; a line ending on "balance of" / "balance is" is refused before any rename.
    ["Monthly Service Fee You can avoid this fee by keeping a minimum balance of", 500, null, { pattern: "sentence_end", action: "takedown" }],
    ["Monthly Service Fee You can avoid this fee by keeping a minimum balance of", 10, null, { pattern: "sentence_end", action: "reread" }],
    ["Monthly Service Fee. You can avoid this fee with a balance of", 600, null, { pattern: "sentence_end", action: "takedown" }],
    ["Monthly Service Fee You may avoid the fee if your balance is", 1000, null, { pattern: "sentence_end", action: "takedown" }],
    ["Overdraft Fee You will be charged a reduced fee of", 15, null, { pattern: "sentence_end", action: "reread" }],
    ["to avoid monthly service fee of", 15, null, { pattern: "sentence_end", action: "reread" }],
    // v6 review, 3: "... Minimum Balance of" is no balance condition; "account goes below" still is, under $100.
    ["Service Charge if Balance Falls Below Minimum Balance of", 50, null, { pattern: "sentence_end", action: "reread" }],
    ["Monthly fee if account falls below the required minimum daily balance of", 8, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee if account goes below", 35, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee if account goes below", 500, null, { pattern: "sentence_end", action: "takedown" }],
    // v6 review, 4: a whole line ending on a threshold is refused with no head split too.
    ["Monthly Service Fee: if balance falls below", 500, null, { pattern: "sentence_end", action: "takedown" }],
    ["Excess Withdrawal Fee: if more than", 6, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee - when overdrawn by more than", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Dormant fee if inactive for", 12, null, { pattern: "sentence_end", action: "reread" }],
    // ... under $100 "below" is no refusal: kept live for a re-read.
    ["Monthly Fee: if balance falls below", 5, null, { pattern: "sentence_end", action: "reread" }],
    // v6 review, 5: "credit card" / "credit union" is no credit; a hyphen after a name is a separator.
    ["Cash advance fee $10 credit card cash advances will", 10, null, { pattern: "pronoun", action: "reread" }],
    ["Annual fee $25 credit union members will", 25, null, { pattern: "pronoun", action: "reread" }],
    ["Wire Fee - $25 if you", 25, null, { pattern: "pronoun", action: "reread" }],
    ["Wire Fee -$25 if you", 25, null, { pattern: "pronoun", action: "reread" }],
    ["Overdraft fee of −$5 per day you", 5, null, { pattern: "pronoun", action: "reread" }],
    ["Monthly fee (-$2 with e-statements) for", 2, null, { pattern: "sentence_end", action: "reread" }],
    ["Wire fee $5 credit to your account for", 5, null, { pattern: "sentence_end", action: "takedown" }],
    // v6 review, 6: a bare "for example" is no worked example; "Example:" and "for example, if" are.
    ["Fees for certain items, for example stop payments, will be charged a fee of", 30, null, { pattern: "sentence_end", action: "reread" }],
    ["Example: if you write a check for", 35, null, { pattern: "sentence_end", action: "takedown" }],
    // v6 review, 7: "maximum of 3 per day" and "MAX CHECKING" are no cap; "maximum charge of", "maximum of" at the end are.
    ["Overdraft Fee You will be charged $35 per item, maximum of 3 per day for", 35, null, { pattern: "sentence_end", action: "reread" }],
    ["MAX CHECKING MONTHLY FEE YOU WILL", 10, null, { pattern: "pronoun", action: "rename", renameTo: "MAX CHECKING MONTHLY FEE", renameVia: "head" }],
    ["Late Fee - maximum charge of", 30, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft fees per day maximum of", 105, null, { pattern: "sentence_end", action: "takedown" }],
    // v6 review, 8: an all-capitals line ends on an article only after a verb or function word.
    ["NSF FEE. THERE IS A", 30, null, { pattern: "sentence_end", action: "reread" }],
    ["STOP PAYMENT FEE YOU WILL BE CHARGED A", 30, null, { pattern: "sentence_end", action: "rename", renameTo: "STOP PAYMENT FEE", renameVia: "head" }],
    // v6 review 9 and prod r9: thresholds after a colon head or a glued "You will be charged ..." never rename; under $100 on
    // a fee line they are kept live (reread), at $100 or more refused; reduced prices never rename; a credit, discount or cap
    // that is not the amount, "because the transaction" mid-sentence and a later "sending bank" take nothing down; a
    // refused generic if-clause bars the tail (35202, 64144 exact names included).
    ["NSF Fee: If the item is greater than", 5, "nsf", { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee: If overdrawn by", 5, "overdraft", { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee: If you are overdrawn by at least", 5, "overdraft", { pattern: "pronoun", action: "reread" }],
    ["Late Fee: If your payment is late by", 15, null, { pattern: "sentence_end", action: "reread" }],
    ["Early Closing Fee: When you close the account within", 25, null, { pattern: "pronoun", action: "reread" }],
    ["Early Closing Fee: When you close the account before", 25, null, { pattern: "pronoun", action: "reread" }],
    ["Paper Statement Fee You will be charged unless your average balance is greater than", 2500, null, { pattern: "sentence_end", action: "takedown" }],
    ["Monthly Maintenance Fee You will be charged unless your balance is at least", 1500, null, { pattern: "pronoun", action: "takedown" }],
    ["Monthly Maintenance Fee You will be charged unless you maintain a balance at", 1500, null, { pattern: "sentence_end", action: "reread" }],
    ["Monthly Maintenance Fee You will be charged unless you keep", 1500, null, { pattern: "pronoun", action: "reread" }],
    ["Monthly Maintenance Fee You will be charged unless your balance stays above", 1500, null, { pattern: "pronoun", action: "takedown" }],
    ["Dormant Account Fee You will be charged after 12 months", 12, null, { pattern: "pronoun", action: "reread" }],
    ["Overdraft Fee You will be charged for items exceeding", 5, "overdraft", { pattern: "pronoun", action: "reread" }],
    ["Excess Transaction Fee You will be charged for each transaction above", 6, null, { pattern: "pronoun", action: "reread" }],
    ["Excess Transaction Fee You will be charged for each transaction greater than", 6, null, { pattern: "sentence_end", action: "reread" }],
    ["Excess Withdrawal Fee You will be charged for withdrawals in excess of", 6, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee You will be charged a lower fee of", 15, "overdraft", { pattern: "sentence_end", action: "reread" }],
    ["Overdraft fee will be lowered to", 10, "overdraft", { pattern: "sentence_end", action: "reread" }],
    ["Paper Statement Fee You will be charged half of", 2, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee You will be charged for each additional item after", 36, "overdraft", { pattern: "pronoun", action: "reread" }],
    ["Overdraft Fee You will be charged because the transaction exceeds your balance", 30, "overdraft", { pattern: "pronoun", action: "reread" }],
    ["Incoming wire fee you will be charged; the sending bank sets its own fee", 15, null, { pattern: "pronoun", action: "reread" }],
    ["Monthly maintenance fee you will be charged, $2 credit with e-statements", 10, null, { pattern: "pronoun", action: "reread" }],
    ["Monthly fee $10, discount of $5 if you enroll in e-statements you will", 10, null, { pattern: "pronoun", action: "reread" }],
    ["$15 credit check fee you will be charged", 15, null, { pattern: "pronoun", action: "reread" }],
    ["-$5.00 per statement if you choose paper statements you will", 5, null, { pattern: "pronoun", action: "reread" }],
    ["Research Fee $25 per hour, minimum charge one hour, you will", 25, null, { pattern: "pronoun", action: "reread" }],
    ["Overdraft fee $30 per item. Maximum daily fees you will be charged", 30, null, { pattern: "pronoun", action: "reread" }],
    ["Service Charge if balance falls below the minimum; a monthly maintenance charge of", 500, null, { pattern: "sentence_end", action: "takedown" }],
    ["Service Charge if balance falls below the minimum; a monthly maintenance charge of", 10, null, { pattern: "sentence_end", action: "reread" }],
    ["Paper statement fee you will be charged if your balance is less than", 50, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee You will be charged if overdrawn by", 5, "overdraft", { pattern: "sentence_end", action: "reread" }],
    ["Excess Activity Fee You will be charged per item over the limit of", 20, null, { pattern: "sentence_end", action: "reread" }],
    ["Statement Fee You will be charged for statements older than", 12, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee for each item we pay that overdraws your account more than", 35, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee for each item we pay that overdraws your account more than", 150, null, { pattern: "sentence_end", action: "takedown" }],
    ["Per quarter charge if balance falls below", 3, null, { pattern: "sentence_end", action: "reread" }],
    // 125163 and 125166, the live names exactly (v6): cut at their start, so kept live, never renamed.
    ["monthly service charge when balance falls below", 2, null, { pattern: "sentence_end", action: "reread" }],
    // 133104, 144639, 37674, 93834, the live names exactly (v6): real fees kept live for a re-read.
    ["Service charge per month if a minimum balance of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Elite Money Market Account: minimum balance of $5,000, if not fee will be charged monthly", 12, null, { pattern: "pronoun", action: "reread" }],
    ["Card overdraft fee will be reduced", 5, null, { pattern: "pronoun", action: "reread" }],
    // Was a known miss (125163): the source line is "$5 monthly service charge when balance falls below $300.
    // $2 paper statement fee.", but the stored name lost both $ figures and the row carries no source
    // text (published_fee_records and verified_fee_observations have no source-line column; the raw
    // row's conditions / extraction_note would need a new join), so the second price cannot be seen.
    // The live name opens in lower case and is now a reread (above); the same words with a capital
    // first letter still rename. Asserted as-is so a fix shows up here.
    ["Monthly service charge when balance falls below", 2, null, { pattern: "sentence_end", action: "rename", renameTo: "Monthly service charge", renameVia: "head" }],
    // v6 round 4 (#1499): the rev10 review probes, every one a row with its expected action under the
    // conservative design (a gap fails safe to `reread`).
    ["You will be charged an overdraft fee because the transaction overdraws your account", 30, "overdraft", { pattern: "pronoun", action: "reread" }],
    ["Incoming Wire Fee - sending bank may also charge you", 15, "wire_domestic_incoming", { pattern: "pronoun", action: "reread" }],
    ["Excess withdrawal fee for each withdrawal in excess of", 6, null, { pattern: "sentence_end", action: "reread" }],
    ["Dormant account fee after no activity for", 12, null, { pattern: "sentence_end", action: "reread" }],
    ["Inactive Account Fee after the account has no activity for", 24, null, { pattern: "sentence_end", action: "reread" }],
    ["Checking Monthly Fee for seniors age 65 and over is", 3, null, { pattern: "sentence_end", action: "reread" }],
    ["Monthly Fee for students is", 2, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee You will be charged after the first 3 items per day", 36, "overdraft", { pattern: "pronoun", action: "reread" }],
    ["Wire Transfer Fee for non-members the fee is", 25, null, { pattern: "sentence_end", action: "reread" }],
    ["Monthly Fee if your balance falls below the minimum, a monthly service fee of", 500, null, { pattern: "sentence_end", action: "reread" }],
    ["Monthly Service Fee if average balance is below the minimum, you will be charged", 300, null, { pattern: "pronoun", action: "reread" }],
    ["Monthly Service Fee: if balance falls below", 50, null, { pattern: "sentence_end", action: "reread" }],
    ["Monthly fee if balance falls below", 99, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee: If the account remains overdrawn for", 25, "overdraft", { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee: When the account is overdrawn more than 5 days, the", 25, "overdraft", { pattern: "sentence_end", action: "reread" }],
    ["Account Closing Fee: If closed within 90 days of", 25, null, { pattern: "sentence_end", action: "reread" }],
    ["Account Closing Fee: If the account is closed within 180 days of opening, the", 25, null, { pattern: "sentence_end", action: "reread" }],
    ["Account Closing Fee: If the account is closed within 180 days of opening, the", 180, null, { pattern: "sentence_end", action: "takedown" }],
    ["Early Closing Fee: When you close the account in less than", 25, null, { pattern: "sentence_end", action: "reread" }],
    ["Early Closing Fee: When you close the account in under", 25, null, { pattern: "pronoun", action: "reread" }],
    ["Coin counting fee: if more than", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Coin counting fee: if you deposit over", 100, null, { pattern: "pronoun", action: "takedown" }],
    ["Statement copy fee: When you request more than", 2, null, { pattern: "sentence_end", action: "reread" }],
    ["Late Fee: If payment is", 15, null, { pattern: "sentence_end", action: "reread" }],
    ["Late charge If payment is not made within 10 days, the late charge is", 10, null, { pattern: "sentence_end", action: "reread" }],
    ["Late charge If payment is not made within 10 days, the late charge is", 25, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee If the account is overdrawn by", 5, "overdraft", { pattern: "sentence_end", action: "reread" }],
    ["Monthly Maintenance Fee You will be charged unless you maintain a balance of", 1500, null, { pattern: "sentence_end", action: "takedown" }],
    ["Monthly Maintenance Fee You will be charged unless you maintain a balance of", 10, null, { pattern: "sentence_end", action: "reread" }],
    ["Monthly Maintenance Fee You will be charged unless your daily balance is", 1500, null, { pattern: "sentence_end", action: "takedown" }],
    ["Monthly Maintenance Fee You will be charged unless your daily balance is", 15, null, { pattern: "sentence_end", action: "reread" }],
    ["ATM Fee You will be charged after", 4, null, { pattern: "pronoun", action: "reread" }],
    ["ATM Fee You will be charged after the first", 4, null, { pattern: "pronoun", action: "reread" }],
    ["ATM Fee You will be charged for each withdrawal after the first", 4, null, { pattern: "pronoun", action: "reread" }],
    ["Check Printing Fee You will be charged for orders of more than", 100, null, { pattern: "sentence_end", action: "takedown" }],
    ["Photocopy Fee You will be charged for copies after the first", 10, null, { pattern: "pronoun", action: "reread" }],
    ["Wire Fee You will be charged on wires up to", 10000, null, { pattern: "trailing_range", action: "exempt", exemptReason: "trailing_range_priced" }],
    ["Overdraft Fee You will be charged up to", 6, null, { pattern: "trailing_range", action: "exempt", exemptReason: "trailing_range_priced" }],
    ["Dormant Account Fee You will be charged after the account is dormant for", 12, null, { pattern: "sentence_end", action: "reread" }],
    ["Dormant Account Fee You will be charged after", 12, null, { pattern: "pronoun", action: "reread" }],
    ["Dormant Account Fee You will be charged after 12 months", 5, null, { pattern: "pronoun", action: "reread" }],
    ["Account Inactive Fee if inactive for more than 12 months a fee of", 12, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee: When the account is overdrawn more than 5 days, a daily fee of", 5, "overdraft", { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee: When your account remains overdrawn for more than 7 consecutive days, an additional fee of", 25, "overdraft", { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee - If your account remains overdrawn more than 10 business days, a sustained overdraft fee of", 35, "overdraft", { pattern: "sentence_end", action: "reread" }],
    ["NSF Fee: When the account stays negative more than 5 days, the", 25, "nsf", { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee: If overdrawn more than 5 days, the fee is", 5, "overdraft", { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee: If the account remains overdrawn for more than 30 days, you will be charged", 30, "overdraft", { pattern: "pronoun", action: "reread" }],
    ["Overdraft Fee: If the item is less than $5, the fee is", 15, "overdraft", { pattern: "sentence_end", action: "reread" }],
    ["Stop Payment Fee: If placed online, the fee is", 15, "stop_payment", { pattern: "sentence_end", action: "reread" }],
    ["Wire Fee: When sent internationally, the fee is", 45, "wire_domestic_outgoing", { pattern: "sentence_end", action: "reread" }],
    ["Paper Statement Fee: If you are 65 or older, the fee is", 1, "paper_statement", { pattern: "sentence_end", action: "reread" }],
    ["Monthly Service Fee You will be charged if you do not maintain a minimum of", 500, "monthly_maintenance", { pattern: "sentence_end", action: "reread" }],
    ["Monthly Service Fee You will be charged if your balance drops beneath", 500, "monthly_maintenance", { pattern: "pronoun", action: "reread" }],
    ["Monthly Service Fee You will be charged when your balance falls short of", 1000, "monthly_maintenance", { pattern: "sentence_end", action: "reread" }],
    ["Monthly Maintenance Fee You will be charged without monthly direct deposits of", 500, "monthly_maintenance", { pattern: "sentence_end", action: "reread" }],
    ["Monthly Maintenance Fee You will be charged if your balance is not at", 1500, "monthly_maintenance", { pattern: "sentence_end", action: "reread" }],
    ["Monthly Maintenance Fee You will be charged if your balance dips to", 1000, "monthly_maintenance", { pattern: "sentence_end", action: "reread" }],
    ["Monthly Maintenance Fee You will be charged if the balance is not kept at", 1000, "monthly_maintenance", { pattern: "sentence_end", action: "reread" }],
    ["Monthly Maintenance Fee You will be charged if your balance does not reach", 1000, "monthly_maintenance", { pattern: "pronoun", action: "reread" }],
    ["Monthly Maintenance Fee You will be charged when the balance goes lower than", 1000, "monthly_maintenance", { pattern: "sentence_end", action: "reread" }],
    ["Monthly Maintenance Fee You will be charged if you have fewer than", 10, "monthly_maintenance", { pattern: "sentence_end", action: "reread" }],
    ["Monthly Maintenance Fee You will be charged with less than", 500, "monthly_maintenance", { pattern: "sentence_end", action: "takedown" }],
    ["Monthly Maintenance Fee You will be charged on balances under", 500, "monthly_maintenance", { pattern: "pronoun", action: "takedown" }],
    ["Monthly Maintenance Fee You will be charged on balances less than", 50, "monthly_maintenance", { pattern: "sentence_end", action: "reread" }],
    ["Monthly Maintenance Fee You will be charged on balances less than", 500, "monthly_maintenance", { pattern: "sentence_end", action: "takedown" }],
    ["Monthly Maintenance Fee You will be charged on balances below", 50, "monthly_maintenance", { pattern: "sentence_end", action: "reread" }],
    ["Monthly Maintenance Fee You will be charged if you have no direct deposit; it is waived with a balance of", 10, "monthly_maintenance", { pattern: "sentence_end", action: "reread" }],
    ["Senior Checking Monthly Fee You will be charged a reduced rate of", 3, "monthly_maintenance", { pattern: "sentence_end", action: "reread" }],
    ["Monthly Maintenance Fee You will be charged; seniors pay", 3, "monthly_maintenance", { pattern: "pronoun", action: "reread" }],
    ["Monthly Maintenance Fee You will be charged; for seniors the fee is", 3, "monthly_maintenance", { pattern: "sentence_end", action: "reread" }],
    ["Service Charge: For customers age 65 or older, the monthly maintenance fee is", 3, "monthly_maintenance", { pattern: "sentence_end", action: "reread" }],
    ["Service Charge: Senior citizens pay a monthly maintenance fee of", 3, "monthly_maintenance", { pattern: "sentence_end", action: "reread" }],
    ["Service Charge: E-statement customers pay a monthly maintenance fee of", 3, "monthly_maintenance", { pattern: "sentence_end", action: "reread" }],
    ["Monthly Fee: Students pay a monthly maintenance fee of", 2, "monthly_maintenance", { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee You will be charged per item, up to a maximum of $175 per day", 35, "overdraft", { pattern: "pronoun", action: "reread" }],
    ["Overdraft Fee you will be charged per item; maximum daily fee", 35, "overdraft", { pattern: "pronoun", action: "reread" }],
    ["NSF Fee you will be charged for each item, max 4 fees per day", 30, "nsf", { pattern: "pronoun", action: "reread" }],
    ["Overdraft Fee you will be charged per item, capped at 5 per day", 35, "overdraft", { pattern: "pronoun", action: "reread" }],
    ["Overdraft Fee you will be charged per item with a maximum of 5 per day; cap of", 35, "overdraft", { pattern: "sentence_end", action: "reread" }],
    ["Late Fee you will be charged 5% of the payment, minimum charge", 15, "late_payment", { pattern: "pronoun", action: "reread" }],
    ["Late Fee you will be charged the greater of 5% or", 15, "late_payment", { pattern: "sentence_end", action: "reread" }],
    ["Club account fee you will be charged if the minimum opening deposit is not made", 5, null, { pattern: "pronoun", action: "reread" }],
    ["Overdraft Fee you will be charged per item ($5 for items under $20)", 35, "overdraft", { pattern: "pronoun", action: "reread" }],
    ["Overdraft Fee You will be charged $5 for items of $20 or less; otherwise", 35, "overdraft", { pattern: "pronoun", action: "reread" }],
    ["Wire Transfer Fee $15 domestic, $45 international, you will", 15, "wire_domestic_outgoing", { pattern: "pronoun", action: "reread" }],
    ["Wire Transfer Fee $15 domestic, $45 international, you will", 45, "wire_international_outgoing", { pattern: "pronoun", action: "reread" }],
    ["Card Replacement Fee $5 credit/debit card you will be charged", 5, "card_replacement", { pattern: "pronoun", action: "reread" }],
    ["Card Replacement Fee $10 credit or debit card you will be charged", 10, "card_replacement", { pattern: "pronoun", action: "reread" }],
    ["Annual Fee $25 credit builder loan, you will", 25, null, { pattern: "pronoun", action: "reread" }],
    ["Overdraft Fee $35 per item you will be charged. Example: if you", 35, "overdraft", { pattern: "pronoun", action: "reread" }],
    ["Excess withdrawal fee you will be charged for each withdrawal over 6, for example, if", 10, "excess_withdrawal", { pattern: "pronoun", action: "reread" }],
    ["Overdraft Fee you will be charged $35. Because the transaction", 35, "overdraft", { pattern: "pronoun", action: "reread" }],
    ["Overdraft Fee you will be charged; the sending bank", 35, "overdraft", { pattern: "pronoun", action: "reread" }],
    ["Overdraft Fee you will be charged per item overdrawn by more than", 35, "overdraft", { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee you will be charged per item overdrawn by more than", 5, "overdraft", { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee you will be charged per item overdrawn by more than", 150, "overdraft", { pattern: "sentence_end", action: "takedown" }],
    ["You will be charged if your balance falls below", 50, null, { pattern: "sentence_end", action: "reread" }],
    ["You will be charged if overdrawn by more than", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Fee you will be charged if more than", 6, null, { pattern: "sentence_end", action: "reread" }],
    ["Monthly fee you will be charged if more than", 6, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee: If overdrawn by more than", 35, "overdraft", { pattern: "sentence_end", action: "reread" }],
    ["Service Charge if balance falls below", 50, "monthly_maintenance", { pattern: "sentence_end", action: "reread" }],
    ["Service Charge if balance falls below", 5, "monthly_maintenance", { pattern: "sentence_end", action: "rename", renameTo: "Service Charge", renameVia: "head" }],
    ["Service Charge if balance falls below the minimum; a monthly maintenance charge of", 10, "monthly_maintenance", { pattern: "sentence_end", action: "reread" }],
    ["Service Charge if more than or equal to $500 but less than", 5, "monthly_maintenance", { pattern: "sentence_end", action: "reread" }],
    ["Monthly Fee if balance is more than or equal to $500 but less than", 500, "monthly_maintenance", { pattern: "sentence_end", action: "takedown" }],
    ["Monthly Fee if balance is more than or equal to $500 but less than", 5, "monthly_maintenance", { pattern: "sentence_end", action: "reread" }],
    ["Savings Account Fee if balance falls below minimum balance of", 50, "monthly_maintenance", { pattern: "sentence_end", action: "reread" }],
    ["Savings Service Charge if balance falls below the required minimum balance of", 25, "monthly_maintenance", { pattern: "sentence_end", action: "reread" }],
    ["Monthly Maintenance Fee if Account Falls Below Minimum Balance of", 99, "monthly_maintenance", { pattern: "sentence_end", action: "reread" }],
    ["Monthly Maintenance Fee if Account Falls Below Minimum Balance of", 100, "monthly_maintenance", { pattern: "sentence_end", action: "takedown" }],
    ["Monthly Maintenance Fee if the balance falls below", 10, "monthly_maintenance", { pattern: "sentence_end", action: "rename", renameTo: "Monthly Maintenance Fee", renameVia: "head" }],
    ["Monthly Maintenance Fee if the balance falls below $500 a reduced fee of", 5, "monthly_maintenance", { pattern: "sentence_end", action: "reread" }],
    ["Monthly Maintenance Fee if the balance falls below $500 you will", 5, "monthly_maintenance", { pattern: "pronoun", action: "reread" }],
    ["Monthly Maintenance Fee if the balance falls below $500 you will", 500, "monthly_maintenance", { pattern: "pronoun", action: "reread" }],
    ["Monthly Maintenance Fee if the balance falls below $500, or $2 with e-statements you will", 2, "monthly_maintenance", { pattern: "pronoun", action: "reread" }],
    ["Monthly Maintenance Fee: $10, or $5 with e-statements, you will", 5, "monthly_maintenance", { pattern: "pronoun", action: "reread" }],
    ["Monthly Maintenance Fee: $10, $5 with e-statements, you will", 10, "monthly_maintenance", { pattern: "pronoun", action: "reread" }],
    ["Monthly Maintenance Fee: $10, $5 with e-statements, you will", 5, "monthly_maintenance", { pattern: "pronoun", action: "reread" }],
    ["Overdraft Fee You will be charged for the second item and after", 15, "overdraft", { pattern: "pronoun", action: "reread" }],
    ["Overdraft Fee You will be charged for the first item only. Subsequent items are", 15, "overdraft", { pattern: "pronoun", action: "reread" }],
    ["Overdraft Fee You will be charged for the 1st item; subsequent items are", 15, "overdraft", { pattern: "pronoun", action: "reread" }],
    ["Overdraft Fee You will be charged for subsequent items is", 25, "overdraft", { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee You will be charged on the 4th and subsequent items, the", 38, "overdraft", { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee You will be charged on the fourth and subsequent items, the", 38, "overdraft", { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee You will be charged a tiered fee. Tier 2 is", 38, "overdraft", { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee You will be charged a smaller fee of", 15, "overdraft", { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee You will be charged a de minimis fee of", 5, "overdraft", { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee You will be charged a fee for items $5 and under of", 5, "overdraft", { pattern: "sentence_end", action: "reread" }],
    ["Monthly Service Fee: When your balance falls below $1,000, a reduced fee of", 5, "monthly_maintenance", { pattern: "sentence_end", action: "reread" }],
    ["Monthly Service Fee: When you enroll in e-statements, the fee is", 3, "monthly_maintenance", { pattern: "sentence_end", action: "reread" }],
    ["Monthly Service Fee: When you have direct deposit, the fee is", 3, "monthly_maintenance", { pattern: "sentence_end", action: "reread" }],
    ["Monthly Service Fee: When you are 55 or older, the", 3, "monthly_maintenance", { pattern: "sentence_end", action: "reread" }],
    ["Monthly Service Fee: If you are a student the fee is", 2, "monthly_maintenance", { pattern: "sentence_end", action: "reread" }],
    ["Monthly Service Fee: If under age 18, the fee is", 0.5, "monthly_maintenance", { pattern: "sentence_end", action: "reread" }],
    ["Monthly Service Fee - When the account has e-statements the", 4, "monthly_maintenance", { pattern: "sentence_end", action: "reread" }],
    ["Paper Statement Fee - When combined with another account the", 1, "paper_statement", { pattern: "sentence_end", action: "reread" }],
    ["ATM Fee - When using a non-network ATM outside the US, the", 5, "atm_non_network", { pattern: "sentence_end", action: "reread" }],
    ["Inactivity Fee: When the account is inactive for 12 months, the", 5, "dormant_account", { pattern: "sentence_end", action: "rename", renameTo: "Inactivity Fee", renameVia: "head" }],
    ["Inactivity Fee: When the account is inactive for more than 12 months, the", 5, "dormant_account", { pattern: "sentence_end", action: "rename", renameTo: "Inactivity Fee", renameVia: "head" }],
    ["Inactivity Fee: When the account is inactive for more than 12 months and the balance is under $100, the", 5, "dormant_account", { pattern: "sentence_end", action: "reread" }],
    ["Inactivity Fee: When the balance is under $100, the", 5, "dormant_account", { pattern: "sentence_end", action: "reread" }],
    ["Inactivity Fee: When the account has a balance of less than $100, the", 5, "dormant_account", { pattern: "sentence_end", action: "reread" }],
    ["Inactivity Fee: When no activity for more than 12 months, a fee of", 12, "dormant_account", { pattern: "sentence_end", action: "reread" }],
    ["Inactivity Fee: When no activity for more than 12 months, a fee of", 5, "dormant_account", { pattern: "sentence_end", action: "reread" }],
    ["Dormant Fee: When inactive more than 24 months, the fee increases to", 10, "dormant_account", { pattern: "sentence_end", action: "reread" }],
    ["Dormant Fee: When inactive more than 24 months, the fee increases to", 24, "dormant_account", { pattern: "sentence_end", action: "reread" }],
    ["Statement Fee: When more than 3 statements are requested, the", 3, "statement_copy", { pattern: "sentence_end", action: "reread" }],
    ["Statement Fee: When more than 3 years old, the", 3, "statement_copy", { pattern: "sentence_end", action: "reread" }],
    ["Research Fee: When older than 2 years, the", 25, "account_research", { pattern: "sentence_end", action: "reread" }],
    ["Research Fee: When more than 2 years old, the", 25, "account_research", { pattern: "sentence_end", action: "reread" }],
    ["Research Fee: When more than 2 years old, the", 2, "account_research", { pattern: "sentence_end", action: "reread" }],
    ["Excess Withdrawal Fee: When more than 6 days per month the", 10, "excess_withdrawal", { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee You will be charged when your balance is more than $5 negative, the", 35, "overdraft", { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee You will be charged when the item exceeds $5 the", 35, "overdraft", { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee You will be charged when the item exceeds $5 the", 5, "overdraft", { pattern: "sentence_end", action: "reread" }],
    ["Monthly Fee You will be charged a monthly maintenance fee of", 500, "monthly_maintenance", { pattern: "sentence_end", action: "reread" }],
    ["Monthly Fee You will be charged a monthly maintenance fee of", 10, "monthly_maintenance", { pattern: "sentence_end", action: "reread" }],
    ["Account Fee You will be charged a dormant account fee of", 10, "dormant_account", { pattern: "sentence_end", action: "reread" }],
    ["MONTHLY SERVICE CHARGE IF BALANCE FALLS BELOW", 500, "monthly_maintenance", { pattern: "sentence_end", action: "takedown" }],
    ["MONTHLY SERVICE CHARGE IF BALANCE FALLS BELOW", 5, "monthly_maintenance", { pattern: "sentence_end", action: "rename", renameTo: "MONTHLY SERVICE CHARGE", renameVia: "head" }],
    ["MONTHLY SERVICE CHARGE: IF BALANCE FALLS BELOW $500 THERE IS A", 5, "monthly_maintenance", { pattern: "sentence_end", action: "reread" }],
    ["MONTHLY SERVICE CHARGE: IF BALANCE FALLS BELOW $500 THERE IS A", 500, "monthly_maintenance", { pattern: "sentence_end", action: "takedown" }],
    ["OVERDRAFT FEE: IF OVERDRAWN MORE THAN 5 DAYS, THERE IS A", 25, "overdraft", { pattern: "sentence_end", action: "reread" }],
    ["WIRE FEE FOR THE", 25, "wire_domestic_outgoing", { pattern: "sentence_end", action: "reread" }],
    ["OVERDRAFT FEE CHARGED A", 35, "overdraft", { pattern: "sentence_end", action: "reread" }],
    ["SAFE DEPOSIT BOX RENTAL FEE FOR A", 50, "safe_deposit_box", { pattern: "sentence_end", action: "reread" }],
    ["STOP PAYMENT FEE TO THE", 30, "stop_payment", { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee $30 per item, maximum of $150 per day, you will be charged", 30, "overdraft", { pattern: "pronoun", action: "reread" }],
    ["Overdraft fee you will be charged $35 per item (maximum of $175 per day)", 35, "overdraft", { pattern: "pronoun", action: "reread" }],
    ["Overdraft fee you will be charged $35 per item, max $175 per day", 35, "overdraft", { pattern: "pronoun", action: "reread" }],
    ["NSF fee of $30 per item will be charged, up to a maximum of $120 per day", 30, "nsf", { pattern: "pronoun", action: "reread" }],
    ["Overdraft Fee: $35 per item, daily maximum of $140. You will", 35, "overdraft", { pattern: "pronoun", action: "reread" }],
    ["Overdraft fee $35 per item; we will not charge more than $175 per day", 35, "overdraft", { pattern: "pronoun", action: "reread" }],
    ["Research Fee $25 per hour, maximum charge $100, you will", 25, "account_research", { pattern: "pronoun", action: "reread" }],
    ["Overdraft Fee you will be charged per item, daily maximum $175", 35, "overdraft", { pattern: "pronoun", action: "reread" }],
    ["Overdraft Fee you will be charged per item, limit of 5 per day", 35, "overdraft", { pattern: "pronoun", action: "reread" }],
    ["Overdraft Fee you will be charged per item, maximum 5 per day", 35, "overdraft", { pattern: "pronoun", action: "reread" }],
    ["Overdraft Fee you will be charged per item, maximum of 5 fees per day", 35, "overdraft", { pattern: "pronoun", action: "reread" }],
    ["Overdraft Fee you will be charged per item, max of 4 charges per day", 35, "overdraft", { pattern: "pronoun", action: "reread" }],
    // Prod r10: 106716 is a real fee read at its threshold ("greater than $500 $10.00 per check"): under $100 a
    // refusal is always a reread. 64675 (stored name not in the report; this row rebuilds its class) renamed to
    // "Also, the order": a target needs a fee noun and no sentence opener. 85002 (rebuilt): "over the phone" is no condition.
    ["Cashier's Check (to third party) greater than", 10, null, { pattern: "sentence_end", action: "reread" }],
    ["Also, the order. There is an overdraft item fee of", 32.98, null, { pattern: "sentence_end", action: "reread" }],
    ["Stop Payment Fee. This fee applies to requests placed over the phone and is charged per item at", 35, null, { pattern: "sentence_end", action: "reread" }],
    // A head that ran into the sentence after a dash ("Overdraft Fee - this fee") is no target.
    ["Overdraft Fee - this fee will be charged per item", 35, null, { pattern: "pronoun", action: "reread" }],
    // v6 round 5 (#1499): the rev11 review probes, each with its expected action under the allowlist design.
    ["Levy/Garnishment Fee $125 per levy, charged to", 125, null, { pattern: "sentence_end", action: "reread" }],
    ["Legal Process Fee $100 per occurrence, assessed for", 100, null, { pattern: "sentence_end", action: "reread" }],
    ["Legal Process Fee $100 per levy, charged to", 100, null, { pattern: "sentence_end", action: "reread" }],
    ["Legal Process Fee $100 per levy, charged to", 99, null, { pattern: "sentence_end", action: "reread" }],
    ["Garnishment Fee $150.00 per order, payable by", 150, null, { pattern: "sentence_end", action: "reread" }],
    ["Safe Deposit Box 10x10 $150, billed to", 150, null, { pattern: "sentence_end", action: "reread" }],
    ["Safe Deposit Box Drilling Fee $150 plus $10 key replacement fee if you", 150, null, { pattern: "pronoun", action: "reread" }],
    ["Safe Deposit Box Drilling Fee $150 plus $10 key replacement fee if you", 99, null, { pattern: "pronoun", action: "reread" }],
    ["Legal Process Fee $100 per levy, plus $25 per hour research if you request", 100, null, { pattern: "pronoun", action: "reread" }],
    ["Levy Fee $125 per levy; research at $25 per hour will be", 125, null, { pattern: "pronoun", action: "reread" }],
    ["International Wire Transfer Outgoing $100.00 per wire, plus correspondent bank charges of", 100, null, { pattern: "sentence_end", action: "reread" }],
    ["Legal Process Fee greater of $100 or actual cost; you will", 100, null, { pattern: "pronoun", action: "reread" }],
    ["Legal Process Fee up to a maximum of", 100, null, { pattern: "sentence_end", action: "takedown" }],
    ["Account Research $25 per hour, minimum charge $100 you will", 100, null, { pattern: "pronoun", action: "reread" }],
    ["Escheatment Fee $100 when the account is turned over to the state, you will", 100, null, { pattern: "pronoun", action: "reread" }],
    ["Incoming Wire Transfer: sending bank may charge you", 15, null, { pattern: "pronoun", action: "reread" }],
    ["Incoming Wire Transfer: Sending bank may also charge a fee; you will", 15, null, { pattern: "pronoun", action: "reread" }],
    ["Wire Transfer Incoming; sending bank charges may apply to", 15, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Item: Example: if you", 35, null, { pattern: "pronoun", action: "reread" }],
    ["Stop Payment. For example, if you", 30, null, { pattern: "pronoun", action: "reread" }],
    ["NSF Item; for example, if you write a check for", 35, null, { pattern: "sentence_end", action: "reread" }],
    ["Paid Overdraft Item. Because the transaction overdraws your account, you will", 35, null, { pattern: "pronoun", action: "reread" }],
    ["Overdraft Fee −$35 per item you will", 35, null, { pattern: "pronoun", action: "reread" }],
    ["Overdraft Fee (−$35) per item if you", 35, null, { pattern: "pronoun", action: "reread" }],
    ["Overdraft Fee (-$35) per item if you", 35, null, { pattern: "pronoun", action: "reread" }],
    ["Wire Transfer Fee −$25 per wire, you will", 25, null, { pattern: "pronoun", action: "reread" }],
    ["Paper Statement Fee (waived with e-statements) per", 3, null, { pattern: "trailing_range", action: "reread" }],
    ["Stop Payment Fee (no charge for online requests) up to", 30, null, { pattern: "trailing_range", action: "reread" }],
    ["Monthly Service Fee - waived with direct deposit, per", 10, null, { pattern: "trailing_range", action: "reread" }],
    ["ACH Origination Fee $25 credit file you will be charged", 25, null, { pattern: "pronoun", action: "reread" }],
    ["Overdraft Protection Transfer $10 credit to checking when you", 10, null, { pattern: "pronoun", action: "reread" }],
    ["Credit Report Fee $15 credit pull for", 15, null, { pattern: "sentence_end", action: "reread" }],
    ["Loan Application Fee $25 credit application you will", 25, null, { pattern: "pronoun", action: "reread" }],
    ["Overdraft Fee The fee for each item thereafter is", 36, null, { pattern: "sentence_end", action: "reread" }],
    ["NSF Fee The fee for the second item is", 38, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee The charge for the third and later items is", 37, null, { pattern: "sentence_end", action: "reread" }],
    ["Returned Item Fee The fee for repeat items is", 35, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee The fee for the fourth and each later item is", 38, null, { pattern: "sentence_end", action: "reread" }],
    ["Monthly Service Fee The fee for business accounts is", 15, null, { pattern: "sentence_end", action: "reread" }],
    ["Stop Payment Fee The fee for online requests is", 20, null, { pattern: "sentence_end", action: "reread" }],
    ["Stop Payment Fee The fee for commercial accounts is", 35, null, { pattern: "sentence_end", action: "reread" }],
    ["Wire Transfer Fee The fee for international wires is", 45, null, { pattern: "sentence_end", action: "reread" }],
    ["Monthly Maintenance Fee The fee for Premier Checking is", 25, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee The fee for employee accounts is", 15, null, { pattern: "sentence_end", action: "reread" }],
    ["Monthly Service Fee The fee is prorated for", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Monthly Service Fee The fee drops to", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Monthly Service Fee The fee falls to", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Monthly Maintenance Fee The fee with direct deposit is", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Monthly Maintenance Fee The fee with e-Statements is", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Paper Statement Fee The fee for e-Statement accounts is", 1, null, { pattern: "sentence_end", action: "reread" }],
    ["Monthly Service Fee The fee for accounts with e-Statements is", 3, null, { pattern: "sentence_end", action: "reread" }],
    ["Monthly Service Fee The fee for accounts with direct deposit is", 3, null, { pattern: "sentence_end", action: "reread" }],
    ["Monthly Service Fee This fee is waived with direct deposit, otherwise it is", 10, null, { pattern: "sentence_end", action: "reread" }],
    ["Monthly Service Fee The fee for accounts enrolled in eStatements is", 3, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee The fee for the first item is", 25, null, { pattern: "sentence_end", action: "reread" }],
    ["Monthly Service Fee The fee for military accounts is", 0.5, null, { pattern: "sentence_end", action: "reread" }],
    ["Monthly Service Fee The fee for youth accounts is", 2, null, { pattern: "sentence_end", action: "reread" }],
    ["Monthly Service Fee The fee for IOLTA accounts is", 20, null, { pattern: "sentence_end", action: "reread" }],
    ["Monthly Service Fee The fee for non-profit organizations is", 10, null, { pattern: "sentence_end", action: "reread" }],
    ["Business accounts are charged a paper statement fee of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Commercial accounts will be charged a monthly maintenance fee of", 25, null, { pattern: "sentence_end", action: "reread" }],
    ["Accounts with direct deposit are charged a monthly maintenance fee of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Accounts enrolled in e-Statements are assessed a monthly service charge of", 2, null, { pattern: "sentence_end", action: "reread" }],
    ["Business accounts are charged an overdraft fee of", 40, null, { pattern: "sentence_end", action: "reread" }],
    ["Second and later items are charged an overdraft fee of", 38, null, { pattern: "sentence_end", action: "reread" }],
    ["Repeat items will incur an NSF fee of", 38, null, { pattern: "sentence_end", action: "reread" }],
    ["Items presented thereafter incur an overdraft fee of", 38, null, { pattern: "sentence_end", action: "reread" }],
    ["Online stop payment requests carry a stop payment fee of", 20, null, { pattern: "sentence_end", action: "reread" }],
    ["Accounts with eStatements pay a paper statement fee of", 0.5, null, { pattern: "sentence_end", action: "reread" }],
    ["Employee accounts are charged an overdraft fee of", 15, null, { pattern: "sentence_end", action: "reread" }],
    ["Monthly Service Fee if the balance falls below", 50, null, { pattern: "sentence_end", action: "reread" }],
    ["Monthly Service Fee if the balance falls below", 25, null, { pattern: "sentence_end", action: "reread" }],
    ["Monthly Service Fee if the balance falls below", 99, null, { pattern: "sentence_end", action: "reread" }],
    ["Inactivity Fee If account is inactive for 12 months, the", 12, null, { pattern: "sentence_end", action: "reread" }],
    ["Inactivity Fee If account is inactive for 12 months, the", 10, null, { pattern: "sentence_end", action: "rename", renameTo: "Inactivity Fee", renameVia: "head" }],
    ["Dormant Account Fee When the account has been dormant for 24 months, the fee is", 5, null, { pattern: "sentence_end", action: "rename", renameTo: "Dormant Account Fee", renameVia: "head" }],
    ["Continuous Overdraft Charge If the account remains overdrawn for 5 days, a", 25, null, { pattern: "sentence_end", action: "rename", renameTo: "Continuous Overdraft Charge", renameVia: "head" }],
    ["Daily Overdraft Fee If account is overdrawn for more than 5 consecutive days, the", 6, null, { pattern: "sentence_end", action: "rename", renameTo: "Daily Overdraft Fee", renameVia: "head" }],
    ["Extended Overdraft Fee When the account remains negative for 7 business days, a", 35, null, { pattern: "sentence_end", action: "rename", renameTo: "Extended Overdraft Fee", renameVia: "head" }],
    ["Dormant Account Fee | If inactive for 24 months the fee is", 10, null, { pattern: "sentence_end", action: "rename", renameTo: "Dormant Account Fee", renameVia: "head" }],
    ["Overdraft Fee for each item we pay that overdraws your account more than", 100, null, { pattern: "sentence_end", action: "takedown" }],
    ["Cashier's Check (to third party) greater than", 100, null, { pattern: "sentence_end", action: "takedown" }],
    ["Cashier's Check (to third party) greater than", 99.99, null, { pattern: "sentence_end", action: "reread" }],
    ["Paper Statement Fee This fee is not charged for e-statement accounts. It is", 2, null, { pattern: "sentence_end", action: "reread" }],
    ["Wire Fee - Outgoing The fee for wires sent online is", 20, null, { pattern: "sentence_end", action: "reread" }],
    ["Stop Payment Fee The fee for requests made online is", 20, null, { pattern: "sentence_end", action: "reread" }],
    ["Stop Payment Fee The fee for requests made in branch is", 30, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee The fee per item is capped at", 35, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee The fee per item is limited to", 35, null, { pattern: "sentence_end", action: "reread" }],
    ["Monthly Fee The fee for the Basic account is", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee This fee applies to items paid into overdraft by", 35, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee This fee is not charged on overdrafts of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee No fee is charged on overdrafts of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee There is no fee for overdrafts of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee Overdrafts that are paid will be charged a fee of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Wire Fee This fee is for wires to", 25, null, { pattern: "sentence_end", action: "reread" }],
    ["Monthly Service Fee The service fee for Personal accounts is", 8, null, { pattern: "sentence_end", action: "reread" }],
    ["Monthly Service Fee The service fee for Business accounts is", 12, null, { pattern: "sentence_end", action: "reread" }],
    ["Safe Deposit Box Fee The fee for the large box is", 150, null, { pattern: "sentence_end", action: "reread" }],
    ["Safe Deposit Box Fee The fee for a 3x5 box is", 30, null, { pattern: "sentence_end", action: "reread" }],
    ["Safe Deposit Box Fee The fee for small boxes is", 30, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee This fee applies to items that overdraw the account by", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee This fee applies to items paid into overdraft by", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee This fee is not assessed on items of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["NSF Fee This fee is not charged for items of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee This fee does not apply to overdrafts of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee This fee does not apply to overdrafts of", 10, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee There is no fee for overdrafts of", 10, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee There is no charge for overdrafts of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee No fee will be charged for overdrafts of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee This fee will not be charged for overdrafts of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee: This fee is not charged on overdrafts of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee - This fee is not charged on overdrafts of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Charge The charge is not assessed for items of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee The fee is not charged when the overdraft is", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee This fee applies to overdrafts of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee Each item thereafter is", 36, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee The fee for the second and third items is", 36, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee The fee for items four and up is", 36, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee The fee for the 2nd item is", 36, null, { pattern: "sentence_end", action: "reread" }],
    ["NSF Fee The fee for the second presentment is", 38, null, { pattern: "sentence_end", action: "reread" }],
    ["NSF Fee The fee for a re-presented item is", 38, null, { pattern: "sentence_end", action: "reread" }],
    ["Monthly Service Fee The fee for eStatement users is", 3, null, { pattern: "sentence_end", action: "reread" }],
    ["Monthly Service Fee The fee for paperless accounts is", 3, null, { pattern: "sentence_end", action: "reread" }],
    ["Monthly Service Fee The fee goes down to", 3, null, { pattern: "sentence_end", action: "reread" }],
    ["Monthly Service Fee The fee is cut to", 3, null, { pattern: "sentence_end", action: "reread" }],
    ["Monthly Service Fee The fee for direct deposit accounts is", 3, null, { pattern: "sentence_end", action: "reread" }],
    ["Monthly Service Fee The fee with eStatements and direct deposit is", 3, null, { pattern: "sentence_end", action: "reread" }],
    ["Monthly Maintenance Fee The fee for accounts with a $500 balance is", 3, null, { pattern: "sentence_end", action: "reread" }],
    ["Wire Transfer Incoming: Sending bank may charge you", 15, null, { pattern: "pronoun", action: "reread" }],
    ["Incoming Wires: sending bank may also charge you", 15, null, { pattern: "pronoun", action: "reread" }],
    ["Incoming Domestic Wire. The sending bank may charge you", 15, null, { pattern: "pronoun", action: "reread" }],
    ["Domestic Incoming Wire Transfer; The bank sending the wire will charge you", 15, null, { pattern: "pronoun", action: "reread" }],
    ["Wire In – Sending bank fees may apply; you will", 15, null, { pattern: "pronoun", action: "reread" }],
    ["Incoming Wire Transfer Fee: sending bank may charge you", 15, null, { pattern: "pronoun", action: "reread" }],
    ["Incoming International Wire: For example, if you", 15, null, { pattern: "pronoun", action: "reread" }],
    ["Stop Payment Request. Example: if you", 30, null, { pattern: "pronoun", action: "reread" }],
    ["Overdraft Item Fee. Example: if you", 35, null, { pattern: "pronoun", action: "reread" }],
    ["ATM Withdrawal (non-network). Example: if you", 3, null, { pattern: "pronoun", action: "reread" }],
    ["Overdraft Fee $35 per item –$35 per item you will", 35, null, { pattern: "pronoun", action: "reread" }],
    ["Overdraft Fee – $35 per item you will", 35, null, { pattern: "pronoun", action: "reread" }],
    ["ACH Origination $25 credit batch you will", 25, null, { pattern: "pronoun", action: "reread" }],
    ["Returned Deposit Item $10 credit reversal if you", 10, null, { pattern: "pronoun", action: "reread" }],
    ["Wire Transfer $25 credit to beneficiary when you", 25, null, { pattern: "pronoun", action: "reread" }],
    ["Garnishment Fee $125 per levy you will be charged", 125, null, { pattern: "pronoun", action: "reread" }],
    ["Legal Process / Levy $100.00 per occurrence assessed to", 100, null, { pattern: "sentence_end", action: "reread" }],
    ["Legal Process / Levy $100.00 per occurrence assessed to", 99.99, null, { pattern: "sentence_end", action: "reread" }],
    ["Safe Deposit Box Drilling $175.00 per box, charged to", 175, null, { pattern: "sentence_end", action: "reread" }],
    ["Collection Item (Outgoing) $100 per item, plus other bank fees of", 100, null, { pattern: "sentence_end", action: "reread" }],
    ["Check Printing $100 per order you will", 100, null, { pattern: "pronoun", action: "reread" }],
    ["Legal Process Fee $100 per levy, plus $25 per hour research if you request", 99, null, { pattern: "pronoun", action: "reread" }],
    ["Safe Deposit Box Rental 10x10 $150; Late Fee $10 if you", 150, null, { pattern: "pronoun", action: "reread" }],
    ["Account Reconciliation $100 per hour, minimum of", 100, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee The number of overdraft fees charged is limited to", 6, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee Fees are limited to", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee No fee for overdrafts of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee No fee is charged for overdrafts of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee No fee will be assessed on items of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["NSF Fee No fee will be charged on items of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee You will not be charged for overdrafts of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee The bank will not charge a fee for overdrafts of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee This fee is not charged if the overdraft is", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee Items that overdraw the account by", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee The account must be overdrawn by", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee This fee applies when the account is overdrawn by", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Savings Service Charge if the balance falls below", 25, null, { pattern: "sentence_end", action: "reread" }],
    ["Savings Service Charge if the balance falls below", 50, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee The fee for consumer accounts is", 30, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee The fee for personal accounts is", 30, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee The fee for business accounts is", 35, null, { pattern: "sentence_end", action: "reread" }],
    // v6 round 6 (#1499): the rev12 review probes (three carry a no-break space).
    ["Legal Process Fee If we receive a levy or garnishment, you will be charged a", 100, null, { pattern: "sentence_end", action: "reread" }],
    ["Legal Process Fee If we receive a levy or garnishment, you will be charged a", 125, null, { pattern: "sentence_end", action: "reread" }],
    ["Garnishment Fee When a garnishment is received you will be charged", 100, null, { pattern: "pronoun", action: "reread" }],
    ["Levy Fee When we receive a levy on your account you will", 150, null, { pattern: "pronoun", action: "reread" }],
    ["Safe Deposit Box Drilling Fee If keys are lost, you will be charged", 150, null, { pattern: "pronoun", action: "reread" }],
    ["Safe Deposit Box Drilling Fee if both keys are lost you will", 175, null, { pattern: "pronoun", action: "reread" }],
    ["Box Drilling Charge If you lose your keys, the drilling charge is", 200, null, { pattern: "sentence_end", action: "reread" }],
    ["Legal Process Fee 100.00 per occurrence assessed to", 100, null, { pattern: "sentence_end", action: "reread" }],
    ["Levy/Garnishment Fee 125.00 per order, charged to", 125, null, { pattern: "sentence_end", action: "reread" }],
    ["Legal Process 100.00 each, charged to", 100, null, { pattern: "sentence_end", action: "reread" }],
    ["Garnishment Fee 100 per order you will", 100, null, { pattern: "pronoun", action: "reread" }],
    ["Safe Deposit Box 10x10 150.00 annual rent, billed to", 150, null, { pattern: "sentence_end", action: "reread" }],
    ["Legal Process Fee $100.00 per occurrence, plus actual costs if you", 100, null, { pattern: "pronoun", action: "reread" }],
    ["Legal Process Fee $100 or actual cost, whichever is greater; you will", 100, null, { pattern: "pronoun", action: "reread" }],
    ["Legal Process Fee minimum charge $100; you will", 100, null, { pattern: "pronoun", action: "reread" }],
    ["Account Research Fee $25 per hour, $100 minimum; you will", 100, null, { pattern: "pronoun", action: "reread" }],
    ["Paper Statement Fee $3.00 per month; you will receive a credit of $3.00 if you", 3, null, { pattern: "pronoun", action: "reread" }],
    ["Monthly Service Charge $5 is reduced by $5 if you", 5, null, { pattern: "pronoun", action: "reread" }],
    ["Monthly Maintenance Fee $10; discount of $10 if you", 10, null, { pattern: "pronoun", action: "reread" }],
    ["Paper Statement Fee $2 per month, $2 credit to your account if you", 2, null, { pattern: "pronoun", action: "reread" }],
    ["Overdraft Fee (-$35) if you", 35, null, { pattern: "pronoun", action: "reread" }],
    ["Overdraft Fee ( -$35 ) if you", 35, null, { pattern: "pronoun", action: "reread" }],
    ["Overdraft Fee (- $35) per item if you", 35, null, { pattern: "pronoun", action: "reread" }],
    ["Wire Fee (\u2212$15) you will", 15, null, { pattern: "pronoun", action: "reread" }],
    ["Incoming Wire Fee (-$15) per wire if you", 15, null, { pattern: "pronoun", action: "reread" }],
    ["Sending bank fees may apply; Incoming Wire Fee you will", 15, null, { pattern: "pronoun", action: "reread" }],
    ["Sending Bank Charges may apply. Incoming Wire Fee, you will be charged", 15, null, { pattern: "pronoun", action: "reread" }],
    ["Example: Overdraft Fee you will be charged", 35, null, { pattern: "pronoun", action: "takedown" }],
    ["are charged a monthly maintenance fee of", 2, null, { pattern: "sentence_end", action: "reread" }],
    ["are charged a check cashing fee of", 10, null, { pattern: "sentence_end", action: "reread" }],
    ["will be charged a check cashing fee of", 10, null, { pattern: "sentence_end", action: "reread" }],
    ["is charged a paper statement fee of", 1, null, { pattern: "sentence_end", action: "reread" }],
    ["are charged a dormant account fee of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Accounts are charged a paper statement fee of", 1, null, { pattern: "sentence_end", action: "rename", renameTo: "Paper statement fee", renameVia: "tail" }],
    ["Accounts are charged a check cashing fee of", 5, null, { pattern: "sentence_end", action: "rename", renameTo: "Check cashing fee", renameVia: "tail" }],
    ["will be charged a coin counting fee of", 3, null, { pattern: "sentence_end", action: "reread" }],
    ["you will be charged a lesser fee of", 10, null, { pattern: "sentence_end", action: "reread" }],
    ["You will be charged a second-item fee of", 15, null, { pattern: "sentence_end", action: "rename", renameTo: "Second-item fee", renameVia: "tail" }],
    ["You will be charged a weekend overdraft fee of", 10, null, { pattern: "sentence_end", action: "rename", renameTo: "Weekend overdraft fee", renameVia: "tail" }],
    ["You will be charged a teen account fee of", 2, null, { pattern: "sentence_end", action: "rename", renameTo: "Teen account fee", renameVia: "tail" }],
    ["You will be charged a youth account fee of", 2, null, { pattern: "sentence_end", action: "rename", renameTo: "Youth account fee", renameVia: "tail" }],
    ["You will be charged a business overdraft fee of", 30, null, { pattern: "sentence_end", action: "rename", renameTo: "Business overdraft fee", renameVia: "tail" }],
    ["You will be charged a premier account fee of", 5, null, { pattern: "sentence_end", action: "rename", renameTo: "Premier account fee", renameVia: "tail" }],
    ["You will be charged an e-statement fee of", 1, null, { pattern: "sentence_end", action: "rename", renameTo: "E-statement fee", renameVia: "tail" }],
    ["You will be charged a courtesy overdraft fee of", 25, null, { pattern: "sentence_end", action: "rename", renameTo: "Courtesy overdraft fee", renameVia: "tail" }],
    ["You will be charged a partial overdraft fee of", 10, null, { pattern: "sentence_end", action: "reread" }],
    ["You will be charged a nominal fee of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["You will be charged a small item overdraft fee of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["You will be charged a first overdraft fee of", 15, null, { pattern: "sentence_end", action: "rename", renameTo: "First overdraft fee", renameVia: "tail" }],
    ["You will be charged a later overdraft fee of", 35, null, { pattern: "sentence_end", action: "rename", renameTo: "Later overdraft fee", renameVia: "tail" }],
    ["You will be charged an excess item fee of", 25, null, { pattern: "sentence_end", action: "rename", renameTo: "Excess item fee", renameVia: "tail" }],
    ["You will be charged a de minimis fee of", 0.5, null, { pattern: "sentence_end", action: "reread" }],
    ["You will be charged a sixth item fee of", 10, null, { pattern: "sentence_end", action: "rename", renameTo: "Sixth item fee", renameVia: "tail" }],
    ["You will be charged a reduced overdraft fee of", 15, null, { pattern: "sentence_end", action: "reread" }],
    ["is charged a junior saver fee of", 1, null, { pattern: "sentence_end", action: "reread" }],
    ["Teen Overdraft Fee You will be charged", 10, null, { pattern: "pronoun", action: "rename", renameTo: "Teen Overdraft Fee", renameVia: "head" }],
    ["Second Overdraft Fee You will be charged", 30, null, { pattern: "pronoun", action: "rename", renameTo: "Second Overdraft Fee", renameVia: "head" }],
    ["Subsequent Overdraft Fee You will be charged", 37, null, { pattern: "pronoun", action: "rename", renameTo: "Subsequent Overdraft Fee", renameVia: "head" }],
    ["Discounted Overdraft Fee You will be charged", 15, null, { pattern: "pronoun", action: "reread" }],
    ["Senior Citizen Monthly Fee You will be charged", 2, null, { pattern: "pronoun", action: "rename", renameTo: "Senior Citizen Monthly Fee", renameVia: "head" }],
    ["Low Balance Fee You will be charged", 10, null, { pattern: "pronoun", action: "rename", renameTo: "Low Balance Fee", renameVia: "head" }],
    ["Small Overdraft Fee You will be charged", 5, null, { pattern: "pronoun", action: "rename", renameTo: "Small Overdraft Fee", renameVia: "head" }],
    ["Reduced NSF Fee You will be charged", 15, null, { pattern: "pronoun", action: "reread" }],
    ["Overdraft Fee - Second Item. You will be charged", 30, null, { pattern: "pronoun", action: "rename", renameTo: "Overdraft Fee - Second Item", renameVia: "head" }],
    ["Overdraft Fee - Business. You will be charged", 35, null, { pattern: "pronoun", action: "reread" }],
    ["Overdraft Fee (Business). You will be charged", 35, null, { pattern: "pronoun", action: "rename", renameTo: "Overdraft Fee (Business)", renameVia: "head" }],
    ["Overdraft Fee (after fifth item). You will be charged", 35, null, { pattern: "pronoun", action: "rename", renameTo: "Overdraft Fee (after fifth item)", renameVia: "head" }],
    ["Overdraft Fee (each additional item). You will be charged", 35, null, { pattern: "pronoun", action: "rename", renameTo: "Overdraft Fee (each additional item)", renameVia: "head" }],
    ["Overdraft Fee (waived for students). You will be charged", 35, null, { pattern: "pronoun", action: "reread" }],
    ["Overdraft Fee (students). You will be charged", 15, null, { pattern: "pronoun", action: "rename", renameTo: "Overdraft Fee (students)", renameVia: "head" }],
    ["Overdraft Fee (non-members). You will be charged", 15, null, { pattern: "pronoun", action: "rename", renameTo: "Overdraft Fee (non-members)", renameVia: "head" }],
    ["Overdraft Fee (balances under five hundred). You will be charged", 15, null, { pattern: "pronoun", action: "rename", renameTo: "Overdraft Fee (balances under five hundred)", renameVia: "head" }],
    ["Paper Statement Fee This fee will be charged", 2, null, { pattern: "pronoun", action: "rename", renameTo: "Paper Statement Fee", renameVia: "head" }],
    ["Dormant Account Fee You will", 5, null, { pattern: "pronoun", action: "rename", renameTo: "Dormant Account Fee", renameVia: "head" }],
    ["Overdraft Fee You will", 15, null, { pattern: "pronoun", action: "rename", renameTo: "Overdraft Fee", renameVia: "head" }],
    ["Overdraft Fee You'll", 35, null, { pattern: "pronoun", action: "rename", renameTo: "Overdraft Fee", renameVia: "head" }],
    ["Overdraft Fee: You will be charged each", 35, null, { pattern: "pronoun", action: "rename", renameTo: "Overdraft Fee", renameVia: "head" }],
    ["Overdraft Fee. Will be charged a", 35, null, { pattern: "sentence_end", action: "rename", renameTo: "Overdraft Fee", renameVia: "head" }],
    ["E-Statement Discount Fee You will be charged", 2, null, { pattern: "pronoun", action: "reread" }],
    ["Non-Member Check Cashing Fee You will be charged", 10, null, { pattern: "pronoun", action: "rename", renameTo: "Non-Member Check Cashing Fee", renameVia: "head" }],
    ["Member Check Cashing Fee You will be charged", 0.5, null, { pattern: "pronoun", action: "rename", renameTo: "Member Check Cashing Fee", renameVia: "head" }],
    ["Non Member Fee You will be charged", 5, null, { pattern: "pronoun", action: "rename", renameTo: "Non Member Fee", renameVia: "head" }],
    ["Business Overdraft Fee You will be charged", 35, null, { pattern: "pronoun", action: "rename", renameTo: "Business Overdraft Fee", renameVia: "head" }],
    ["Monthly Service Fee if the balance falls below", 24, null, { pattern: "sentence_end", action: "rename", renameTo: "Monthly Service Fee", renameVia: "head" }],
    ["Senior Monthly Service Fee if the balance falls below", 2, null, { pattern: "sentence_end", action: "rename", renameTo: "Senior Monthly Service Fee", renameVia: "head" }],
    ["Student Checking Monthly Fee if the balance falls below", 3, null, { pattern: "sentence_end", action: "rename", renameTo: "Student Checking Monthly Fee", renameVia: "head" }],
    ["Paper Statement Fee if the balance falls below", 2, null, { pattern: "sentence_end", action: "rename", renameTo: "Paper Statement Fee", renameVia: "head" }],
    ["Overdraft Fee if the balance falls below", 20, null, { pattern: "sentence_end", action: "rename", renameTo: "Overdraft Fee", renameVia: "head" }],
    ["Second Item Fee if the balance falls below", 10, null, { pattern: "sentence_end", action: "rename", renameTo: "Second Item Fee", renameVia: "head" }],
    ["Inactivity Fee If the account is inactive for 12 months, the", 5, null, { pattern: "sentence_end", action: "rename", renameTo: "Inactivity Fee", renameVia: "head" }],
    ["Inactivity Fee If the account is inactive for 12 months, the fee is", 12, null, { pattern: "sentence_end", action: "reread" }],
    ["Continuous Overdraft Charge If your account remains overdrawn for more than 5 business days, a", 25, null, { pattern: "sentence_end", action: "rename", renameTo: "Continuous Overdraft Charge", renameVia: "head" }],
    ["Continuous Overdraft Charge If your account remains overdrawn for more than 5 business days, a", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Daily Overdraft Charge If your account remains overdrawn for 7 days, the", 5, null, { pattern: "sentence_end", action: "rename", renameTo: "Daily Overdraft Charge", renameVia: "head" }],
    ["Inactive Accounts Fee (cont.) | If more than 3 years dormant the fee is", 3, null, { pattern: "sentence_end", action: "reread" }],
    ["Overdraft Fee $35 per item, $25 for business accounts, you will", 25, null, { pattern: "pronoun", action: "reread" }],
    ["Overdraft Fee $35 per item, $25 for business accounts, you will", 35, null, { pattern: "pronoun", action: "reread" }],
    ["Wire Fee $25 domestic, $45 international; you will", 45, null, { pattern: "pronoun", action: "reread" }],
    ["Wire Fee $25 domestic, $45 international; you will", 25, null, { pattern: "pronoun", action: "reread" }],
    ["Overdraft Fee $5 for items under $20; you will", 5, null, { pattern: "pronoun", action: "reread" }],
    ["Overdraft Fee $5 for overdrafts of $20 or less, you will", 5, null, { pattern: "pronoun", action: "reread" }],
    ["Overdraft Fee $5 for overdrafts of $20 or less, you will", 20, null, { pattern: "pronoun", action: "reread" }],
    ["Safe Deposit Box Fee $100 per year, $50 for seniors, you will", 100, null, { pattern: "pronoun", action: "reread" }],
    ["Safe Deposit Box Fee $100 per year, $50 for seniors, you will", 50, null, { pattern: "pronoun", action: "reread" }],
    ["Legal Process Fee $150 per levy, $100 if you", 100, null, { pattern: "pronoun", action: "reread" }],
    ["Legal Process Fee $150 per levy, $100 if you", 150, null, { pattern: "pronoun", action: "reread" }],
    ["Check Cashing Fee $100 minimum balance required if you", 100, null, { pattern: "pronoun", action: "reread" }],
    ["Monthly Fee $100 minimum balance; you will", 100, null, { pattern: "pronoun", action: "reread" }],
    ["Monthly Fee $10 unless you keep $100 minimum balance; you will", 100, null, { pattern: "pronoun", action: "reread" }],
    ["Credit of $5 for e-statements if you", 5, null, { pattern: "pronoun", action: "takedown" }],
    // Round 7 (#1521): a credit after a fee head and a clause break, with no price of its own, is a reread.
    ["Paper Statement Fee; e-statement credit of $2 if you", 2, null, { pattern: "pronoun", action: "reread" }],
    ["Overdraft Fee $35, refund credit of $35 if you", 35, null, { pattern: "pronoun", action: "reread" }],
    ["Overdraft Fee per item for items over $5. You will be charged", 5, null, { pattern: "pronoun", action: "reread" }],
    ["Overdraft Fee per item for items over $5. You will be charged", 35, null, { pattern: "pronoun", action: "reread" }],
    ["Incoming Wire Fee. Example: if you", 15, null, { pattern: "pronoun", action: "reread" }],
    ["Overdraft Fee. For example, if you", 35, null, { pattern: "pronoun", action: "reread" }],
    ["Overdraft Fee\u00a0You will be charged", 35, null, { pattern: "pronoun", action: "rename", renameTo: "Overdraft Fee", renameVia: "head" }],
    ["Overdraft\u00a0Fee You will be charged", 35, null, { pattern: "pronoun", action: "rename", renameTo: "Overdraft Fee", renameVia: "head" }],
    ["You will be charged a small overdraft fee of", 10, null, { pattern: "sentence_end", action: "reread" }],
    ["You will be charged a small item fee of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["will be charged a small overdraft fee of", 10, null, { pattern: "sentence_end", action: "reread" }],
    ["You will be charged a low balance fee of", 10, null, { pattern: "sentence_end", action: "reread" }],
    ["You will be charged a low overdraft fee of", 10, null, { pattern: "sentence_end", action: "reread" }],
    ["You will be charged a standard overdraft fee of", 35, null, { pattern: "sentence_end", action: "rename", renameTo: "Overdraft fee", renameVia: "tail" }],
    ["You will be charged a minimal overdraft fee of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["You will be charged a nominal overdraft fee of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["You will be charged a modest overdraft fee of", 10, null, { pattern: "sentence_end", action: "rename", renameTo: "Modest overdraft fee", renameVia: "tail" }],
    ["You will be charged a usual overdraft fee of", 35, null, { pattern: "sentence_end", action: "rename", renameTo: "Overdraft fee", renameVia: "tail" }],
    ["You will be charged a regular overdraft fee of", 35, null, { pattern: "sentence_end", action: "rename", renameTo: "Overdraft fee", renameVia: "tail" }],
    ["You will be charged a current overdraft fee of", 35, null, { pattern: "sentence_end", action: "rename", renameTo: "Overdraft fee", renameVia: "tail" }],
    ["You will be charged a separate overdraft fee of", 10, null, { pattern: "sentence_end", action: "rename", renameTo: "Separate overdraft fee", renameVia: "tail" }],
    ["You will be charged a lesser overdraft fee of", 15, null, { pattern: "sentence_end", action: "reread" }],
    ["You will be charged an alternate overdraft fee of", 15, null, { pattern: "sentence_end", action: "rename", renameTo: "Alternate overdraft fee", renameVia: "tail" }],
    ["You will be charged a flat overdraft fee of", 15, null, { pattern: "sentence_end", action: "rename", renameTo: "Flat overdraft fee", renameVia: "tail" }],
    ["You will be charged a one-time overdraft fee of", 15, null, { pattern: "sentence_end", action: "rename", renameTo: "One-time overdraft fee", renameVia: "tail" }],
    ["You will be charged a weekly overdraft fee of", 15, null, { pattern: "sentence_end", action: "rename", renameTo: "Weekly overdraft fee", renameVia: "tail" }],
    ["You will be charged a teen overdraft fee of", 15, null, { pattern: "sentence_end", action: "rename", renameTo: "Teen overdraft fee", renameVia: "tail" }],
    ["You will be charged a junior overdraft fee of", 15, null, { pattern: "sentence_end", action: "rename", renameTo: "Junior overdraft fee", renameVia: "tail" }],
    ["You will be charged a youth overdraft fee of", 15, null, { pattern: "sentence_end", action: "rename", renameTo: "Youth overdraft fee", renameVia: "tail" }],
    ["You will be charged a starter account overdraft fee of", 15, null, { pattern: "sentence_end", action: "rename", renameTo: "Starter account overdraft fee", renameVia: "tail" }],
    ["You will be charged a basic overdraft fee of", 15, null, { pattern: "sentence_end", action: "rename", renameTo: "Basic overdraft fee", renameVia: "tail" }],
    ["You will be charged a premium overdraft fee of", 15, null, { pattern: "sentence_end", action: "rename", renameTo: "Premium overdraft fee", renameVia: "tail" }],
    ["You will be charged an elder overdraft fee of", 15, null, { pattern: "sentence_end", action: "rename", renameTo: "Elder overdraft fee", renameVia: "tail" }],
    ["You will be charged a veteran overdraft fee of", 15, null, { pattern: "sentence_end", action: "rename", renameTo: "Veteran overdraft fee", renameVia: "tail" }],
    ["You will be charged a military overdraft fee of", 15, null, { pattern: "sentence_end", action: "rename", renameTo: "Military overdraft fee", renameVia: "tail" }],
    ["You will be charged an employee overdraft fee of", 15, null, { pattern: "sentence_end", action: "rename", renameTo: "Employee overdraft fee", renameVia: "tail" }],
    ["You will be charged a staff overdraft fee of", 15, null, { pattern: "sentence_end", action: "rename", renameTo: "Staff overdraft fee", renameVia: "tail" }],
    ["You will be charged a minor overdraft fee of", 15, null, { pattern: "sentence_end", action: "rename", renameTo: "Minor overdraft fee", renameVia: "tail" }],
    ["You will be charged a promotional overdraft fee of", 15, null, { pattern: "sentence_end", action: "rename", renameTo: "Promotional overdraft fee", renameVia: "tail" }],
    ["You will be charged an introductory overdraft fee of", 15, null, { pattern: "sentence_end", action: "rename", renameTo: "Introductory overdraft fee", renameVia: "tail" }],
    ["You will be charged a waived overdraft fee of", 0, null, { pattern: "sentence_end", action: "takedown" }],
    ["You will be charged a partial waiver fee of", 15, null, { pattern: "sentence_end", action: "reread" }],
    ["You will be charged an e-statement discount fee of", 2, null, { pattern: "sentence_end", action: "reread" }],
    ["You will be charged a paper statement fee of", 2, null, { pattern: "sentence_end", action: "rename", renameTo: "Paper statement fee", renameVia: "tail" }],
    ["Is charged a small overdraft fee of", 10, null, { pattern: "sentence_end", action: "reread" }],
    ["Monthly Service Fee\u00a0if the balance falls below", 10, null, { pattern: "sentence_end", action: "rename", renameTo: "Monthly Service Fee", renameVia: "head" }],
    ["Overdraft Fee You will be charged", 35, null, { pattern: "pronoun", action: "rename", renameTo: "Overdraft Fee", renameVia: "head" }],
    ["Small Item Overdraft Fee You will be charged", 5, null, { pattern: "pronoun", action: "rename", renameTo: "Small Item Overdraft Fee", renameVia: "head" }],
    ["Teen Overdraft Fee: you will be charged per item", 10, null, { pattern: "pronoun", action: "rename", renameTo: "Teen Overdraft Fee", renameVia: "head" }],
    ["Military Overdraft Fee You will be charged", 10, null, { pattern: "pronoun", action: "rename", renameTo: "Military Overdraft Fee", renameVia: "head" }],
    ["Overdraft Fee Waiver You will be charged", 10, null, { pattern: "pronoun", action: "reread" }],
    ["Promotional Wire Fee You will be charged", 10, null, { pattern: "pronoun", action: "rename", renameTo: "Promotional Wire Fee", renameVia: "head" }],
    ["Introductory Monthly Fee You will be charged", 5, null, { pattern: "pronoun", action: "rename", renameTo: "Introductory Monthly Fee", renameVia: "head" }],
    // Round 7 (#1521, review of bf43365e, probes rev13/probe8). An if-clause comparative that is a count, a
    // duration or legal wording is no money threshold: kept live for a re-read at $100 too.
    ["Legal Process Fee If we are served under a court order, you will be charged", 100, null, { pattern: "pronoun", action: "reread" }],
    ["Garnishment Fee If more than one order is received, you will be charged", 100, null, { pattern: "pronoun", action: "reread" }],
    ["Account Research Fee If research exceeds one hour, the", 100, null, { pattern: "sentence_end", action: "reread" }],
    ["Inactivity Fee If the account is inactive for more than 12 months, the", 100, null, { pattern: "sentence_end", action: "reread" }],
    ["Escheat Fee if the account is dormant for more than 3 years you will", 100, null, { pattern: "pronoun", action: "reread" }],
    ["Safe Deposit Box Drilling Fee If you lose more than one key, you will be charged", 150, null, { pattern: "pronoun", action: "reread" }],
    // ... a "$" or cents figure, "balance" or "minimum" after the comparative is still a threshold.
    ["Monthly Fee If balance falls below $100, you will be charged", 100, null, { pattern: "pronoun", action: "takedown" }],
    ["Monthly Fee If balance falls below 1,000.00, you will be charged", 1000, null, { pattern: "pronoun", action: "takedown" }],
    ["Service Charge If your balance is under the minimum, you will be charged", 150, null, { pattern: "pronoun", action: "takedown" }],
    ["Legal Process Fee If we receive a levy against your account balance, you will be charged", 125, null, { pattern: "pronoun", action: "reread" }],
    // The credit guard reads a bare cents price as the fee's own, like "$".
    ["Paper Statement Fee 3.00 per month; you will receive a credit of $3.00 if you", 3, null, { pattern: "pronoun", action: "reread" }],
    // "credit union", "Credit Card", "Discount Brokerage", "Refund Check" are no credit wording for a bare "(-$N)".
    ["Overdraft Fee (-$35) credit union members if you", 35, null, { pattern: "pronoun", action: "reread" }],
    ["Overdraft Fee (-$35) Credit Card if you", 35, null, { pattern: "pronoun", action: "reread" }],
    ["Overdraft Fee (-$35) Discount Brokerage if you", 35, null, { pattern: "pronoun", action: "reread" }],
    ["Credit Card Late Fee (-$25) if you", 25, null, { pattern: "pronoun", action: "reread" }],
    ["Discount Brokerage Fee (-$25) if you", 25, null, { pattern: "pronoun", action: "reread" }],
    ["Overdraft Fee (-$35) credited back if you", 35, null, { pattern: "pronoun", action: "takedown" }],
    ["Overdraft Fee (\u2212$35) refund if you", 35, null, { pattern: "pronoun", action: "takedown" }],
    // A credit line with no price of its own after a fee head and a break is a reread; with no head, or a head with another price, it comes down.
    ["Paper Statement Fee | credit of $3.00 if you", 3, null, { pattern: "pronoun", action: "reread" }],
    ["Paper Statement Fee - e-statement discount of $2 if you", 2, null, { pattern: "pronoun", action: "reread" }],
    ["Credit of $5 for e-statements; Overdraft Fee if you", 5, null, { pattern: "pronoun", action: "takedown" }],
    ["Overdraft Fee $35; credit of $5 if you", 5, null, { pattern: "pronoun", action: "takedown" }],
    // A lower-case tail lead was cut at its start: no tail rename.
    ["accounts are charged an overdraft fee of", 38, null, { pattern: "sentence_end", action: "reread" }],
    ["accounts are charged a monthly maintenance fee of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["you'll be charged an overdraft fee of", 35, null, { pattern: "sentence_end", action: "reread" }],
    ["Accounts are charged an overdraft fee of", 38, null, { pattern: "sentence_end", action: "rename", renameTo: "Overdraft fee", renameVia: "tail" }],
    // Accepted in round 7, pending James (#1521): a floor still holds a cap or a "$N minimum balance" line as a
    // reread; closing these the issue's way would add takedowns.
    ["Overdraft Fee $35, maximum of $100 per day; $5 minimum if you", 100, null, { pattern: "pronoun", action: "reread" }],
    ["Monthly Fee waived with $500 minimum balance; you will", 500, null, { pattern: "pronoun", action: "reread" }],
    // U+FEFF reads as a space, as in JS's \s.
    ["Overdraft\ufeffFee You will be charged", 35, null, { pattern: "pronoun", action: "rename", renameTo: "Overdraft Fee", renameVia: "head" }],
    ["\ufeffOverdraft Fee You will be charged", 35, null, { pattern: "pronoun", action: "rename", renameTo: "Overdraft Fee", renameVia: "head" }],
    // #1516: a clause head ("More than", "Over", "Less than", "Up to" a count) is never a fee name; v6 keeps it live for a re-read.
    ["More than 10 items per statement will be charged an item fee of", 10, null, { pattern: "sentence_end", action: "reread" }],
    ["Over 6 withdrawals per month will be charged a fee of", 5, null, { pattern: "sentence_end", action: "reread" }],
    ["Less than 3 items will be charged a fee of", 2, null, { pattern: "sentence_end", action: "reread" }],
    ["Up to 5 checks you will be charged a fee of", 3, null, { pattern: "sentence_end", action: "reread" }],
    ["MORE THAN TEN ITEMS - You will be charged a fee of", 10, null, { pattern: "sentence_end", action: "reread" }],
  ] as const)("%j at $%s is %j", (name, amount, key, verdict) => {
    expect(liveFragmentVerdict(name, amount, key)).toEqual(verdict);
  });

  it.each([
    // v6 round 4: rev10 probes that carry no live fragment shape at all.
    ["NSF Fee: If the item is at least", 5, "nsf"],
    ["Overdraft Fee: If the item amount exceeds", 5, "overdraft"],
    ["Statement Fee: If the balance falls below the minimum balance", 5, null],
    ["Account Closing Fee: If closed within", 90, null],
    ["Coin counting fee: if coins exceed", 5, null],
    ["Wire Fee - When sent after", 25, null],
    ["Late Fee: If payment is received after", 25, null],
    ["Late Fee: If payment is not received within", 15, null],
    ["MONTHLY SERVICE CHARGE A", 5, null],
    ["BILL PAY A", 5, null],
    // v6 round 5: rev11 probes with no live fragment shape.
    ["Overdraft Fee Overdrafts of five dollars or less are not charged; others are", 35, null],
    // v6 round 6: rev12 probes with no live fragment shape.
    ["Excess Withdrawal Fee is charged", 10, null],
    ["Excessive Transaction Fee is charged per item", 2, null],
    ["Items Over Ten Per Month Fee is charged", 2, null],
    ["Paper Statement Fee This fee is charged", 2, null],
    ["Overdraft Fee | is charged per occurrence", 35, null],
  ] as const)("leaves rev10 probe %j at $%s with no fragment shape", (name, amount, key) => {
    expect(liveFragmentVerdict(name, amount, key)).toBeNull();
  });

  it("leaves a name with no fragment shape alone", () => {
    expect(liveFragmentVerdict("ePLUS Checking Monthly service charge", 7.95)).toBeNull();
    expect(liveFragmentVerdict(null, null)).toBeNull();
  });

  it("keeps live, not renames, a glued name whose cleaned name the category guard refuses", () => {
    // The guard accepts the full name under stop_payment but not "Paper Statement Fee": the fee comes down.
    // v6: it stays live for a Knox re-read instead of coming down.
    // Round 5: the guard on an allowlisted charge sentence ("per check" lets check_printing accept the full name).
    expect(liveFragmentVerdict("Paper Statement Fee You will be charged per check", 30, "check_printing")).toEqual({ pattern: "pronoun", action: "reread" });
    expect(liveFragmentVerdict("Paper Statement Fee You will be charged per check", 30, null)).toMatchObject({ action: "rename" });
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

  it("takes down a rename onto a live name of its own document, and the second of two renames from one line", () => {
    const rows = [
      // v6: the second of two renames onto one name comes down only from the same document and line (the same stored name).
      { fee_published_id: 2, fee_verified_id: 2, institution_id: 9, fee_name: "Overdraft Fee. This fee will be charged", amount: 35, canonical_fee_key: "overdraft", source_document_id: 70 },
      { fee_published_id: 1, fee_verified_id: 1, institution_id: 9, fee_name: "Overdraft Fee. This fee will be charged", amount: 35, canonical_fee_key: "overdraft", source_document_id: 70 },
      // ... another line of that document, or another document, is another account's fee: kept live, re-read.
      { fee_published_id: 6, fee_verified_id: 6, institution_id: 9, fee_name: "Overdraft Fee. This fee will be charged per item", amount: 35, canonical_fee_key: "overdraft", source_document_id: 70 },
      { fee_published_id: 7, fee_verified_id: 7, institution_id: 9, fee_name: "Overdraft Fee. This fee will be charged", amount: 35, canonical_fee_key: "overdraft", source_document_id: 71 },
      { fee_published_id: 8, fee_verified_id: 8, institution_id: 9, fee_name: "Overdraft Fee. This fee will be charged", amount: 35, canonical_fee_key: "overdraft" },
      { fee_published_id: 3, fee_verified_id: 3, institution_id: 9, fee_name: "Stop Payment Fee. This fee will be charged", amount: 30, canonical_fee_key: "stop_payment", source_document_id: 70 },
      // Another bank, another price or another category is no collision.
      { fee_published_id: 4, fee_verified_id: 4, institution_id: 10, fee_name: "Overdraft Fee. This fee will be charged", amount: 35, canonical_fee_key: "overdraft", source_document_id: 70 },
      { fee_published_id: 5, fee_verified_id: 5, institution_id: 9, fee_name: "Overdraft Fee. This fee will be charged", amount: 30, canonical_fee_key: "overdraft", source_document_id: 70 },
    ];
    const none = findLiveFragments(rows).matches.map((fee) => [fee.feePublishedId, fee.action, fee.takedownReason ?? fee.renameTo]);
    expect(none).toEqual([
      [1, "rename", "Overdraft Fee"], [2, "takedown", "rename_duplicate"], [3, "rename", "Stop Payment Fee"], [4, "rename", "Overdraft Fee"],
      [5, "rename", "Overdraft Fee"], [6, "reread", "Overdraft Fee"], [7, "reread", "Overdraft Fee"], [8, "reread", "Overdraft Fee"],
    ]);
    // A live twin counts only with its document: one of the fragment's document takes it down, a bare name keeps it live.
    const taken = findLiveFragments(rows, new Set([liveNameKey(9, "stop_payment", "30.00", "STOP  payment fee "), liveTwinKey(9, "stop_payment", "30.00", "STOP  payment fee ", 70) as string]));
    expect(taken.matches.find((fee) => fee.feePublishedId === 3)).toMatchObject({ action: "takedown", takedownReason: "rename_duplicate" });
    expect(taken.takedownByReason).toEqual({ fragment: 0, rename_duplicate: 2 });
    expect(taken.renameDuplicateSamples.map((fee) => fee.feePublishedId)).toEqual([2, 3]);
    const bare = findLiveFragments(rows, new Set([liveNameKey(9, "stop_payment", "30.00", "Stop Payment Fee")]));
    expect(bare.matches.find((fee) => fee.feePublishedId === 3)).toMatchObject({ action: "reread", rereadRequest: true });
  });

  it("v3: counts renames by head and tail, with the way in each sample", () => {
    const found = findLiveFragments([
      { fee_published_id: 1, fee_verified_id: 1, institution_id: 9, fee_name: "Overdraft Fee. This fee will be charged", amount: 35, canonical_fee_key: null },
      { fee_published_id: 2, fee_verified_id: 2, institution_id: 9, fee_name: "You will be charged a card replacement fee of", amount: 10, canonical_fee_key: null },
      { fee_published_id: 3, fee_verified_id: 3, institution_id: 9, fee_name: "Excess Withdrawal Fee if more than", amount: 6, canonical_fee_key: null },
    ]);
    // v6 (prod r9): "Excess Withdrawal Fee if more than" $6 names a fee under $100: kept live for a re-read.
    expect(found).toMatchObject({ wouldRename: 2, wouldRenameByVia: { head: 1, tail: 1 }, wouldTakeDown: 0, wouldReread: 1, wouldRequestReread: 1 });
    const detail = liveFragmentDetail({ ...found, live: false, dryRun: true, afterId: 0, nextAfterId: 0, takenDown: [], renamed: [], rereadRequested: [], duplicateCheckFailed: false });
    expect(detail.would_rename_by_via).toEqual({ head: 1, tail: 1 });
    expect(detail.samples_by_action.rename.map((fee) => [fee.fee_published_id, fee.rename_to, fee.rename_via])).toEqual([[1, "Overdraft Fee", "head"], [2, "Card replacement fee", "tail"]]);
  });

  it("v5: keeps the 44880, 97910, 62758 and 68548 outcomes", () => {
    expect(liveFragmentVerdict("Inactive Accounts Fee (cont.) | If more than 3 years dormant the fee is", 15)).toMatchObject({ action: "rename", renameTo: "Inactive Accounts Fee" });
    // Round 4 (D): a tail line with a figure ("After 5 days") is kept live, re-read.
    expect(liveFragmentVerdict("After 5 days the account is charged a Consecutive days overdrawn (OD) fee of", 25)).toEqual({ pattern: "sentence_end", action: "reread" });
    expect(liveFragmentVerdict("Withdrawals at an Allpoint network our ATM fee of", 2)).toEqual({ pattern: "sentence_end", action: "reread" });
    // 68548: its tail is a name the bank already has live at that price and category, so it comes down.
    const found = findLiveFragments([
      { fee_published_id: 1, fee_verified_id: 1, institution_id: 9, fee_name: "Return Item/Insufficient Funds Fee", amount: 30, canonical_fee_key: "nsf", source_document_id: 5 },
      { fee_published_id: 2, fee_verified_id: 2, institution_id: 9, fee_name: "You will be charged a Return Item/Insufficient Funds Fee of", amount: 30, canonical_fee_key: "nsf", source_document_id: 5 },
    ]);
    expect(found.matches).toEqual([expect.objectContaining({ feePublishedId: 2, action: "takedown", takedownReason: "rename_duplicate", renameTo: "Return Item/Insufficient Funds Fee", renameVia: "tail" })]);
  });

  it("v5: a sentence_end line refused on its amount comes down and still asks Knox to re-read; a waived one asks nothing", async () => {
    const rows = [
      // Refused on the amount: a threshold, total wording, another price, a figure equal to the amount.
      { fee_published_id: 1, fee_verified_id: 11, institution_id: 9, fee_name: "Monthly Service Fee if balance below", amount: 500 },
      // v6 (prod r9): at $100 or more; under $100 a fee line's threshold reading is kept live (`liveFragmentSoft`).
      { fee_published_id: 2, fee_verified_id: 12, institution_id: 9, fee_name: "Excess Withdrawal Fee if more than", amount: 150 },
      { fee_published_id: 3, fee_verified_id: 13, institution_id: 9, fee_name: "Dormant Account Fee if inactive for more than", amount: 120 },
      { fee_published_id: 4, fee_verified_id: 14, institution_id: 9, fee_name: "A $20 NSF fee is charged per item; users may therefore incur $45 in NSF fees per day and", amount: 45 },
      { fee_published_id: 5, fee_verified_id: 15, institution_id: 9, fee_name: "a $35 Overdraft Fee if the transaction is paid or a $15 NSF Fee if returned and", amount: 20 },
      { fee_published_id: 6, fee_verified_id: 16, institution_id: 9, fee_name: "Overdraft Fee You will be charged $35 per item for", amount: 25 },
      { fee_published_id: 7, fee_verified_id: 17, institution_id: 9, fee_name: "Overdrafts of more than $5 will be charged an overdraft fee of", amount: 5 },
      // A waived price: down, no request.
      { fee_published_id: 8, fee_verified_id: 18, institution_id: 9, fee_name: ROW_58414, amount: 0 },
      // No gate refused the amount: kept live, re-read.
      { fee_published_id: 9, fee_verified_id: 19, institution_id: 9, fee_name: "Paper statement fee for the", amount: 2 },
    ];
    const found = findLiveFragments(rows);
    // Round 4: every refusal under $100 (rows 4 to 7) is kept live for a re-read; at $100 or more it comes down.
    expect(found.matches.map((fee) => [fee.feePublishedId, fee.action, fee.rereadRequest ?? false])).toEqual([
      [1, "takedown", true], [2, "takedown", true], [3, "takedown", true], [4, "reread", true], [5, "reread", true],
      [6, "reread", true], [7, "reread", true], [8, "takedown", false], [9, "reread", true],
    ]);
    expect(found).toMatchObject({ wouldTakeDown: 4, wouldReread: 5, wouldRequestReread: 8 });
    const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      void values;
      const text = strings.join("?");
      if (text.includes("FROM agent_run_events")) return Promise.resolve([]);
      if (text.includes("FROM published_fee_records")) return Promise.resolve(rows);
      if (text.includes("UPDATE published_fee_records")) return Promise.resolve(rows.filter((row) => row.fee_published_id !== 9).map((row) => ({ fee_published_id: row.fee_published_id })));
      return Promise.resolve([]);
    });
    const result = await recheckLiveFragmentNames(asDb(db), { runId: 7, dryRun: false, live: true });
    expect(result.takenDown).toEqual([1, 2, 3, 8]);
    expect(result.rereadRequested).toEqual([4, 5, 6, 7, 9, 1, 2, 3]);
    const feedback = db.mock.calls.find(([strings]) => (strings as TemplateStringsArray).join("?").includes("INSERT INTO pipeline_feedback"));
    const written = JSON.parse(String(feedback?.[1])) as Array<{ fee_published_id: number; evidence: Record<string, unknown> }>;
    expect(written.find((row) => row.fee_published_id === 9)?.evidence).toMatchObject({ reason: "kept live: sentence_end with no name", kept_live: true });
    expect(written.find((row) => row.fee_published_id === 1)?.evidence).toMatchObject({ reason: "fragment name: sentence_end" });
    expect(written.find((row) => row.fee_published_id === 1)?.evidence).not.toHaveProperty("kept_live");
    expect(written.some((row) => row.fee_published_id === 8)).toBe(false);
  });

  it("v6: a credit needs a minus glued to the $ or credit wording; a dash before a price is none", () => {
    expect(LIVE_FRAGMENT_CREDIT.test("Wire Transfer Fee - $25 per outgoing wire")).toBe(false);
    // Round 5 (rev11): credits are an allowlist; a minus after a head and an open parenthesis are none.
    expect(LIVE_FRAGMENT_CREDIT.test("Monthly fee −$2 discount")).toBe(false);
    expect(LIVE_FRAGMENT_CREDIT.test("Monthly fee (-$2 with e-statements)")).toBe(false);
    expect(LIVE_FRAGMENT_CREDIT.test("Overdraft Fee (−$35) per item")).toBe(true);
    expect(LIVE_FRAGMENT_CREDIT.test("Overdraft credit of $5")).toBe(true);
    expect(LIVE_FRAGMENT_CREDIT.test("$5 credit applied to your statement")).toBe(true);
    expect(LIVE_FRAGMENT_CREDIT.test("ACH Origination $25 credit batch you will")).toBe(false);
    // Round 6 (rev12): a figure outside the credit equal to the amount is the fee; a bare "(-$N)" needs credit wording.
    expect(liveFragmentCredit("Paper Statement Fee $3.00 per month; you will receive a credit of $3.00 if you", 3)).toBe(false);
    expect(liveFragmentCredit("Overdraft Fee (-$35) if you", 35)).toBe(false);
    expect(liveFragmentCredit("Overdraft Fee (-$35) refund if you", 35)).toBe(true);
    // Round 7 (#1521): whole credit words only, never a product or institution noun; a bare cents price is the fee's own.
    expect(LIVE_FRAGMENT_CREDIT_WORD.test("credit union")).toBe(false);
    expect(LIVE_FRAGMENT_CREDIT_WORD.test("Credit Card")).toBe(false);
    expect(LIVE_FRAGMENT_CREDIT_WORD.test("Discount Brokerage")).toBe(false);
    expect(LIVE_FRAGMENT_CREDIT_WORD.test("creditor")).toBe(false);
    expect(LIVE_FRAGMENT_CREDIT_WORD.test("credited back")).toBe(true);
    expect(LIVE_FRAGMENT_CREDIT_WORD.test("refund")).toBe(true);
    expect(liveFragmentCredit("Overdraft Fee (-$35) credit union members if you", 35)).toBe(false);
    expect(liveFragmentCredit("Paper Statement Fee 3.00 per month; you will receive a credit of $3.00 if you", 3)).toBe(false);
    expect(liveFragmentCreditHeaded("Paper Statement Fee | credit of $3.00 if you")).toBe(true);
    expect(liveFragmentCreditHeaded("Overdraft Fee $35; credit of $5 if you")).toBe(false);
    expect(liveFragmentCreditHeaded("Monthly fee reduced by $2 for")).toBe(false);
    expect(liveFragmentCreditHeaded("Credit of $5 for e-statements if you")).toBe(false);
    // A comparative counts as an if-clause threshold only before a money figure, "balance" or "minimum".
    expect(LIVE_FRAGMENT_IF_THRESHOLD_WORD.test(" If more than one order is received")).toBe(false);
    expect(LIVE_FRAGMENT_IF_THRESHOLD_WORD.test(" If we are served under a court order")).toBe(false);
    expect(LIVE_FRAGMENT_IF_THRESHOLD_WORD.test(" If the account is inactive for more than 12 months, the")).toBe(false);
    expect(LIVE_FRAGMENT_IF_THRESHOLD_WORD.test(" If your balance is below $500")).toBe(true);
    expect(LIVE_FRAGMENT_IF_THRESHOLD_WORD.test(" if balance is less than 1,000.00")).toBe(true);
    expect(LIVE_FRAGMENT_IF_THRESHOLD_WORD.test(" if your account falls below the required minimum balance")).toBe(true);
    expect(LIVE_FRAGMENT_CREDIT.test("Overdraft Fee (- $35) per item")).toBe(false);
    expect(LIVE_FRAGMENT_CAP_WORDING.test("Max Checking Monthly Fee")).toBe(false);
    expect(LIVE_FRAGMENT_CAP_WORDING.test("MAXIMUM LATE CHARGE OF")).toBe(true);
    // v6 review: a cap word counts only before "of $", a dollar figure or a charge/fee word.
    expect(LIVE_FRAGMENT_CAP_WORDING.test("MAX CHECKING MONTHLY FEE YOU WILL")).toBe(false);
    expect(LIVE_FRAGMENT_CAP_WORDING.test("$35 per item, maximum of 3 per day for")).toBe(false);
    expect(LIVE_FRAGMENT_CAP_WORDING.test("maximum of $105 per day")).toBe(true);
    expect(LIVE_FRAGMENT_CAP_WORDING.test("Overdraft fees are capped at")).toBe(true);
    expect(LIVE_FRAGMENT_CREDIT.test("Cash advance fee $10 credit card cash advances")).toBe(false);
    expect(LIVE_FRAGMENT_CREDIT.test("E-statement $2.50 credit per month")).toBe(false);
    expect(LIVE_FRAGMENT_CREDIT.test("Wire Fee -$25 if you")).toBe(false);
    // v6 (review 9): a hyphen at the start is a bullet, "credit check" is no credit, and the credit's figure must be the amount.
    expect(LIVE_FRAGMENT_CREDIT.test("-$5 for e-statements")).toBe(false);
    expect(LIVE_FRAGMENT_CREDIT.test("$15 credit check fee")).toBe(false);
    expect(liveFragmentCredit("Monthly maintenance fee you will be charged, $2 credit with e-statements", 10)).toBe(false);
    expect(liveFragmentCredit("Monthly maintenance fee you will be charged, $2 credit with e-statements", 2)).toBe(false);
    expect(liveFragmentCredit("Monthly maintenance fee, $2 credit to your account with e-statements", 2)).toBe(true);
    expect(liveFragmentCredit("Monthly fee $10, discount of $5 if you enroll", 10)).toBe(false);
    // ... and a cap word refuses only when the line states no price equal to the amount outside the cap's figure.
    expect(liveFragmentCapRefused("Research Fee $25 per hour, minimum charge one hour, you will", 25)).toBe(false);
    expect(liveFragmentCapRefused("Overdraft fee $30 per item. Maximum daily fees you will be charged", 30)).toBe(false);
    expect(liveFragmentCapRefused("Overdraft Fee You will be charged a maximum of $105 per day", 105)).toBe(true);
    expect(liveFragmentCapRefused("Overdraft fees per day maximum of", 105)).toBe(true);
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
      { fee_published_id: 1, fee_verified_id: 1, institution_id: 9, fee_name: "Account Closing Fee", amount: 25, canonical_fee_key: "early_closure", source_document_id: 3 },
      { fee_published_id: 2, fee_verified_id: 2, institution_id: 9, fee_name: "Account Closing Fee. This fee will be charged", amount: 25, canonical_fee_key: "early_closure", source_document_id: 3 },
    ]);
    expect(found.matches).toEqual([expect.objectContaining({ feePublishedId: 2, action: "takedown", takedownReason: "rename_duplicate" })]);
    // v6: the same name read from another document (a savings page against a checking page) is kept live, re-read.
    const other = findLiveFragments([
      { fee_published_id: 1, fee_verified_id: 1, institution_id: 9, fee_name: "Account Closing Fee", amount: 25, canonical_fee_key: "early_closure", source_document_id: 3 },
      { fee_published_id: 2, fee_verified_id: 2, institution_id: 9, fee_name: "Account Closing Fee. This fee will be charged", amount: 25, canonical_fee_key: "early_closure", source_document_id: 4 },
    ]);
    expect(other.matches).toEqual([expect.objectContaining({ feePublishedId: 2, action: "reread", rereadRequest: true })]);
  });
});
