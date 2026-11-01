import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import {
  ERROR_FIXES,
  errorFixDetail,
  errorFixProblems,
  errorFixRequests,
  judgeErrorFix,
  runErrorFixRecheck,
  summarizeErrorFixRecheck,
  type ErrorFixEntry,
} from "./error-fixes";
import { KNOX_RULES_STRATEGY } from "@/lib/agents/knox/specialists";
import { DARWIN_RECHECK_CHECK } from "@/lib/agents/darwin/verified-recheck";
import { NAME_QUALITY_CHECK, NOT_A_FEE_CHECK } from "./fresh-audit";
import { DARWIN_VERIFIED_RECHECK_CHECK, ERROR_FIX_CHECKS as TARGET_CHECKS, errorFixRereadDocuments, errorFixVerifyTargets } from "./error-fix-targets";
import { ownDocumentCheck, type ErrorFixFee } from "./error-fixes";

const entry = (over: Partial<ErrorFixEntry> = {}): ErrorFixEntry => ({ pr: 9001, issue: 2058, stage: "extract", merged_on: "2026-10-20", knox_version: KNOX_RULES_STRATEGY.version, kinds: ["wrong_amount_read"], ...over });

const fee = (over: Partial<ErrorFixFee> = {}): ErrorFixFee => ({
  fee_id: 1,
  fee_published_id: 501,
  lineage_ref: 401,
  fee_raw_id: 301,
  institution_id: 9,
  source: "knox",
  source_document_id: 77,
  canonical_fee_key: "stop_payment",
  fee_name: "Stop Payment Fee",
  amount: 35,
  document_url: "https://bank.example/fees.pdf",
  reread_at: "2026-10-01T00:00:00Z",
  published_at: "2026-10-01T00:00:00Z",
  ...over,
} as ErrorFixFee);
// The error rows below were recorded on Oct 10, after the fixed rules last read the fee above.
const at = { created_at: "2026-10-10T00:00:00Z", source_document_id: null };

const TEXT = [{ source_document_id: 77, normalized_text: "OTHER SERVICES\nStop Payment Fee | $35.00\nWire Transfer | $25.00" }];

describe("the error loop: a process fix names its errors, re-runs their banks and re-checks each (#2058)", () => {
  it("ships a registry the step can read", () => {
    expect(errorFixProblems(ERROR_FIXES)).toEqual([]);
  });

  it("refuses an entry that names no rows, a stage a re-run cannot reach, a bad date or a repeated PR", () => {
    expect(errorFixProblems([entry()])).toEqual([]);
    expect(errorFixProblems([entry({ kinds: [] })])[0]).toContain("name the error rows");
    expect(errorFixProblems([entry({ stage: "discover" as never })])[0]).toContain("Magellan");
    expect(errorFixProblems([entry({ merged_on: "Oct 20" })])[0]).toContain("ISO date");
    expect(errorFixProblems([entry(), entry()])[0]).toContain("listed twice");
    expect(errorFixProblems([entry({ kinds: undefined, feedback_ids: [0] })])[0]).toContain("row ids");
  });

  it("refuses an entry with no fixed Knox version, or naming a check the re-check cannot judge", () => {
    expect(errorFixProblems([entry({ knox_version: undefined as never })])[0]).toContain("knox_version");
    // A version no extract can reach yet would leave every row waiting for good.
    expect(errorFixProblems([entry({ knox_version: KNOX_RULES_STRATEGY.version + 1 })])[0]).toContain("above the shipped Knox rules version");
    // The audit's evidence checks are filed against discover or publish, never extract.
    expect(errorFixProblems([entry({ checks: ["hamilton.other_bank_document"] })])[0]).toContain("cannot judge");
    expect(errorFixProblems([entry({ checks: ["hamilton.category_guard", "deming.name_quality"] })])).toEqual([]);
    // An audience or hand judgement is not re-run, so its error could never be judged gone.
    expect(errorFixProblems([entry({ checks: ["darwin.audience_guard"] })])[0]).toContain("cannot judge darwin.audience_guard");
  });

  it("takes read, verify and publish fixes, each re-run by its own step, with no Knox version", () => {
    for (const stage of ["read", "verify", "publish"] as const) {
      expect(errorFixProblems([entry({ stage, knox_version: undefined })])).toEqual([]);
      // Knox does not re-extract at the same version, so a Knox version would claim a re-run that never comes.
      expect(errorFixProblems([entry({ stage })])[0]).toContain("knox_version names an extract fix's rules");
    }
    // Darwin's recheck records its own verdict again, so only a verify fix may name its rows.
    expect(errorFixProblems([entry({ stage: "verify", knox_version: undefined, checks: ["darwin.verified_recheck"] })])).toEqual([]);
    expect(errorFixProblems([entry({ checks: ["darwin.verified_recheck"] })])[0]).toContain("cannot judge darwin.verified_recheck at extract");
    expect(errorFixProblems([entry({ stage: "publish", knox_version: undefined, checks: ["darwin.verified_recheck"] })])[0]).toContain("cannot judge");
  });

  it("keeps the light registry module's check names the fresh audit's and Darwin's own", () => {
    expect([...TARGET_CHECKS]).toEqual(["hamilton.source_check", "hamilton.category_guard", NOT_A_FEE_CHECK, NAME_QUALITY_CHECK]);
    expect(DARWIN_VERIFIED_RECHECK_CHECK).toBe(DARWIN_RECHECK_CHECK);
  });

  it("selects nothing for Rosetta or Darwin while no read or verify fix is registered", async () => {
    const db = vi.fn();
    expect(await errorFixRereadDocuments(db as never, { limit: 10, auxiliaryStrategies: [], settledOutcomes: [], reopenStrategy: "read.reopen", entries: [entry()] })).toEqual([]);
    expect(await errorFixVerifyTargets(db as never, { limit: 10, recheckStrategy: "verify.recheck", entries: [entry()] })).toEqual([]);
    expect(await errorFixRereadDocuments(db as never, { limit: 10, auxiliaryStrategies: [], settledOutcomes: [], reopenStrategy: "read.reopen" })).toEqual([]);
    expect(db).not.toHaveBeenCalled();
  });

  it("checks each judged fee against its own document, which the fresh audit skips when it relinks a fee", () => {
    const OTHER = [...TEXT, { source_document_id: 78, normalized_text: "FEES\nStop Payment Fee | $40.00" }];
    // An imported fee whose own document (77) says $35 but another of the bank's documents says $40:
    // the fresh audit relinks it to 78 and counts it right; the error re-check does not.
    const imported = fee({ source: "import" as never, amount: 40 });
    const named = { ...at, fee_published_id: 501, canonical_fee_key: "stop_payment" };
    expect(judgeErrorFix(named, [imported], OTHER)).toMatchObject({ verdict: "still_wrong", check: "hamilton.source_check", reason: expect.stringMatching(/^own_document:/) });
    expect(ownDocumentCheck(imported, OTHER).verdict).toBe("still_wrong");
    expect(ownDocumentCheck(fee({ source: "import" as never }), OTHER)).toEqual({ verdict: "matches", reason: "ok" });
    // No own document, or no stored text for it: never closed.
    expect(judgeErrorFix(named, [fee({ source: "import" as never, source_document_id: null, amount: 40 })], OTHER)).toMatchObject({ verdict: "unknown", reason: "no_own_document" });
    expect(ownDocumentCheck(fee({ source_document_id: 79 }), OTHER)).toEqual({ verdict: "unknown", reason: "no_stored_text" });
  });

  it("judges a named error the fresh audit does not run only by the stage's own re-run verdict", () => {
    const named = { ...at, fee_published_id: 501, canonical_fee_key: "stop_payment", check_name: "darwin.verified_recheck" };
    // No recheck verdict yet: the fee matching its document says nothing about Darwin's check.
    expect(judgeErrorFix(named, [fee()], TEXT)).toMatchObject({ verdict: "unknown", reason: "named_check_not_rerun" });
    expect(judgeErrorFix(named, [fee()], TEXT, undefined, false, { passed: false, check: "darwin.verified_recheck", reason: "conditional_zero" }))
      .toMatchObject({ verdict: "still_wrong", check: "darwin.verified_recheck", reason: "conditional_zero", judged: [501] });
    expect(judgeErrorFix(named, [fee()], TEXT, undefined, false, { passed: true, check: "darwin.verified_recheck" })).toMatchObject({ verdict: "now_matches" });
    // A pass of Darwin's check still needs the fee in its own document.
    expect(judgeErrorFix(named, [fee({ amount: 30 })], TEXT, undefined, false, { passed: true, check: "darwin.verified_recheck" })).toMatchObject({ verdict: "still_wrong", check: "hamilton.source_check" });
  });

  it("waits for each stage's own re-run: a read of the document, Darwin's recheck, a direct run's publish step", async () => {
    const queriesFor = async (stage: ErrorFixEntry["stage"]) => {
      const queries: string[] = [];
      const db = vi.fn(async (parts: TemplateStringsArray) => { queries.push(parts.join("?")); return []; });
      await errorFixRequests(db as never, [entry({ stage, knox_version: stage === "extract" ? KNOX_RULES_STRATEGY.version : undefined })]);
      return queries.join("\n");
    };
    const read = await queriesFor("read");
    expect(read).toContain("again.stage = 'read'");
    expect(read).toContain("again.strategy <> ALL(");
    expect(read).toContain("f.source_document_id IS NOT NULL");
    // Only a settled read counts, of the current copy at the end of the supersession chain.
    expect(read).toContain("again.outcome = ANY(");
    expect(read).toContain("WITH RECURSIVE chain");
    const verify = await queriesFor("verify");
    expect(verify).toContain("'verified:' || named_fee.lineage_ref::text");
    // A live named fee is Darwin's to re-read; only a bank whose named fee is down is asked for.
    expect(verify).toContain("FROM published_fee_records still_live");
    expect(verify).toContain("step.step_key = ?::text");
    const publish = await queriesFor("publish");
    expect(publish).toContain("run.params_json->>'institution_id' = f.institution_id::text");
    expect(publish).not.toContain("again.stage = 'extract'");
    expect(await queriesFor("extract")).toContain("again.stage = 'extract'");
  });

  it("closes an error whose fee now matches the bank's document", () => {
    expect(judgeErrorFix({ ...at, fee_published_id: 501, canonical_fee_key: "stop_payment" }, [fee()], TEXT)).toMatchObject({ verdict: "now_matches", judged: [501] });
  });

  it("keeps an error whose fee is still not in the document, naming the check it fails", () => {
    const judged = judgeErrorFix({ ...at, fee_published_id: 501, canonical_fee_key: "stop_payment" }, [fee({ amount: 30 })], TEXT);
    expect(judged).toMatchObject({ verdict: "still_wrong", check: "hamilton.source_check" });
  });

  it("judges only a fee the re-run extracted in place of a named fee that is down, and never closes on nothing", () => {
    const down = { ...at, fee_published_id: 500, canonical_fee_key: "stop_payment" };
    // A stop payment fee live since before the error proves nothing about the fix.
    expect(judgeErrorFix(down, [fee()], TEXT)).toMatchObject({ verdict: "not_reproduced", judged: [] });
    // One the re-run extracted after the error, from the error's document, is judged.
    const rerun = fee({ reread_at: "2026-10-21T00:00:00Z", published_at: "2026-10-22T00:00:00Z" });
    expect(judgeErrorFix(down, [rerun], TEXT)).toMatchObject({ verdict: "now_matches", judged: [501] });
    expect(judgeErrorFix({ ...down, source_document_id: 77 }, [rerun], TEXT)).toMatchObject({ verdict: "now_matches" });
    expect(judgeErrorFix({ ...down, source_document_id: 78 }, [rerun], TEXT)).toMatchObject({ verdict: "not_reproduced" });
    // Once a newer copy replaced the error's document, the re-run's fee cites the newer copy.
    expect(judgeErrorFix({ ...down, source_document_id: 78, document_replaced: true }, [rerun], TEXT)).toMatchObject({ verdict: "now_matches" });
    // Taken down with nothing in its category: not closed.
    expect(judgeErrorFix({ ...at, fee_published_id: 500, canonical_fee_key: "nsf" }, [rerun], TEXT)).toMatchObject({ verdict: "not_reproduced", judged: [] });
  });

  it("never closes an error it cannot read: no stored text is unknown", () => {
    expect(judgeErrorFix({ ...at, fee_published_id: 501, canonical_fee_key: "stop_payment" }, [fee()], [])).toMatchObject({ verdict: "unknown" });
  });

  it("never judges a named fee still live as a rate, or one with no category to look for", () => {
    expect(judgeErrorFix({ ...at, fee_published_id: 500, canonical_fee_key: "nsf" }, [fee()], TEXT, undefined, true)).toMatchObject({ verdict: "unknown", judged: [] });
    expect(judgeErrorFix({ ...at, fee_published_id: 500, canonical_fee_key: null }, [fee()], TEXT)).toMatchObject({ verdict: "unknown", judged: [] });
  });

  it("asks for nothing and writes nothing with an empty or broken registry", async () => {
    const db = vi.fn();
    expect(await errorFixRequests(db as never, [])).toEqual([]);
    expect(await errorFixRequests(db as never, [entry({ kinds: [] })])).toEqual([]);
    const result = await runErrorFixRecheck({ db: db as never, entries: [entry({ kinds: [] })] });
    expect(result.problems).toHaveLength(1);
    expect(summarizeErrorFixRecheck(result)).toContain("problem");
    expect(summarizeErrorFixRecheck(await runErrorFixRecheck({ db: db as never, entries: [] }))).toBe("No process fix names the errors it fixes yet.");
    expect(db).not.toHaveBeenCalled();
  });

  it("asks for each bank behind an open, not yet re-run error once, dated the day the fix merged", async () => {
    const queries: string[] = [];
    const db = vi.fn(async (parts: TemplateStringsArray) => {
      queries.push(parts.join("?"));
      return !parts.join("?").includes("FROM pipeline_feedback f") ? [] : [
      { id: 1, institution_id: 9, fee_published_id: 501, canonical_fee_key: "stop_payment", kind: "wrong_amount_read", check_name: "hamilton.source_check", created_at: "2026-10-10", rerun: false },
      { id: 2, institution_id: 9, fee_published_id: 502, canonical_fee_key: "overdraft", kind: "wrong_amount_read", check_name: "hamilton.source_check", created_at: "2026-10-10", rerun: false },
      ];
    });
    const requests = await errorFixRequests(db as never, [entry()]);
    expect(requests).toEqual([expect.objectContaining({ institutionId: 9, requestedAt: "2026-10-20" })]);
    expect(requests[0].reason).toBe("re-check an error here after PR #9001 (#2058) fixed the extract step");
    // Re-run banks and inactive banks are left out in the query, and only judgeable checks named.
    const all = queries.join("\n");
    expect(all).toContain("strategy_version >=");
    expect(all).toContain("COALESCE(inst.status, 'active') = 'active'");
    expect(all).toContain("f.check_name = ANY(");
  });

  it("re-checks only the errors whose bank was read again, records each outcome once, and nothing on a dry run", async () => {
    const writes: Array<Array<{ kind: string; dedupe_key: string; weight: number; signal: string }>> = [];
    const named = [
      { id: 11, institution_id: 9, fee_published_id: 501, canonical_fee_key: "stop_payment", kind: "wrong_amount_read", check_name: "hamilton.source_check", created_at: "2026-10-10", rerun: true },
      { id: 12, institution_id: 9, fee_published_id: 600, canonical_fee_key: "nsf", kind: "wrong_amount_read", check_name: "hamilton.source_check", created_at: "2026-10-10", rerun: "t" },
      { id: 13, institution_id: 9, fee_published_id: 502, canonical_fee_key: "wire_domestic_outgoing", kind: "wrong_amount_read", check_name: "hamilton.source_check", created_at: "2026-10-10", rerun: true },
      { id: 14, institution_id: 9, fee_published_id: 502, canonical_fee_key: "wire_domestic_outgoing", kind: "wrong_amount_read", check_name: "hamilton.source_check", created_at: "2026-10-10", rerun: true, reported_still_wrong: true },
      { id: 15, institution_id: 10, fee_published_id: 700, canonical_fee_key: "overdraft", kind: "wrong_amount_read", check_name: "hamilton.source_check", created_at: "2026-10-10", rerun: false },
    ];
    const makeDb = () => Object.assign(vi.fn(async (parts: TemplateStringsArray, ...values: unknown[]) => {
      const text = parts.join("?");
      if (text.includes("SAVEPOINT") || text.includes("RELEASE") || text.includes("ROLLBACK")) return [];
      if (text.includes("FROM pipeline_feedback f")) return named;
      if (text.includes("FROM published_fee_catalog c")) return [fee(), fee({ fee_id: 2, fee_published_id: 502, canonical_fee_key: "wire_domestic_outgoing", fee_name: "Wire Transfer", amount: 40 })];
      if (text.includes("FROM agent_source_texts")) return TEXT.map((row) => ({ ...row, institution_id: 9 }));
      if (text.includes("INSERT INTO pipeline_feedback")) {
        const rows = JSON.parse(String(values[0]));
        writes.push(rows);
        return rows.map((_: unknown, i: number) => ({ id: i + 1 }));
      }
      return [];
    }), { unsafe: vi.fn(async () => []) });

    const dry = await runErrorFixRecheck({ db: makeDb() as never, entries: [entry()], runId: 7, dryRun: true });
    expect(dry.skipped).toEqual(["dry run"]);
    expect(writes).toHaveLength(0);

    const result = await runErrorFixRecheck({ db: makeDb() as never, entries: [entry()], runId: 7 });
    expect(result.results[0]).toMatchObject({ named: 5, waiting: 1, nowMatches: 1, notReproduced: 1, stillWrong: 2, unknown: 0 });
    // Row 14 was already recorded as still wrong: judged again, not written again.
    expect(writes[0].map((row) => [row.kind, row.dedupe_key, row.signal, row.weight])).toEqual([
      ["error_fix_closed", "deming.error_fix:9001:11:closed", "right", 0],
      // Row 12's fee is down and nothing was extracted in its place: open, not written.
      ["error_fix_still_wrong", "deming.error_fix:9001:13:still_wrong", "wrong", 0],
    ]);
    expect(errorFixDetail(result)).toMatchObject({ entries: 1, closed: 1, not_reproduced: 1, still_wrong: 2, waiting: 1 });
    expect(summarizeErrorFixRecheck(result)).toBe("5 open error(s) named by 1 fix(es): 1 closed (now match the bank's document), 2 still wrong after a re-run, 1 taken down with no right fee extracted in their place, 1 waiting for a re-run, 0 not judged (no stored text or own document, the fee is a rate or has no category, or its check has no re-run verdict yet).");
  });

  it("judges a replacement by when the fixed rules read its text, not by its raw row's age (follow-up 1)", () => {
    const down = { ...at, fee_published_id: 500, canonical_fee_key: "stop_payment" };
    // Knox read the same fee again identically: its raw row is old, but the fixed rules read its
    // text after the error, so the re-run produced it.
    const identical = fee({ reread_at: "2026-10-21T00:00:00Z", published_at: "2026-10-22T00:00:00Z", raw_created_at: "2026-09-01T00:00:00Z" } as Partial<ErrorFixFee>);
    expect(judgeErrorFix(down, [identical], TEXT)).toMatchObject({ verdict: "now_matches", judged: [501] });
    // No read at the fixed version since the error (or none at all): not the re-run's fee.
    expect(judgeErrorFix(down, [fee({ reread_at: null })], TEXT)).toMatchObject({ verdict: "not_reproduced" });
    expect(judgeErrorFix(down, [fee({ reread_at: "2026-10-09T23:59:59Z", published_at: "2026-10-22T00:00:00Z" })], TEXT)).toMatchObject({ verdict: "not_reproduced" });
  });

  it("never closes a taken-down fee on a right fee live beside it since before the error (review blocker)", () => {
    // The document shows Overdraft $30 (right, live since Oct 1) and a business overdraft misread
    // as $54 (named, taken down). The rules bump re-read every text, so the $30 fee has a new
    // reread_at, but it was published before the error: it is not the re-run's replacement.
    const misread = { ...at, fee_published_id: 500, canonical_fee_key: "overdraft", source_document_id: 77 };
    const OD_TEXT = [{ source_document_id: 77, normalized_text: "OTHER SERVICES\nOverdraft Fee | $30.00 per item\nBusiness Overdraft Fee | $34.00 per item" }];
    const liveAllAlong = fee({ fee_published_id: 501, canonical_fee_key: "overdraft", fee_name: "Overdraft Fee", amount: 30, reread_at: "2026-10-21T00:00:00Z", published_at: "2026-10-01T00:00:00Z" });
    expect(judgeErrorFix(misread, [liveAllAlong], OD_TEXT)).toMatchObject({ verdict: "not_reproduced", judged: [] });
    // A restore clears rolled_back_at on the old row and keeps its old published_at: not a fix either.
    const restored = fee({ fee_published_id: 500, canonical_fee_key: "overdraft", fee_name: "Business Overdraft Fee", amount: 34, reread_at: "2026-10-21T00:00:00Z", published_at: "2026-10-01T00:00:00Z" });
    expect(judgeErrorFix({ ...misread, fee_published_id: 499 }, [restored], OD_TEXT)).toMatchObject({ verdict: "not_reproduced" });
    // Once the corrected fee clears Darwin and Hamilton and is published after the error, it is judged.
    const corrected = fee({ fee_published_id: 502, canonical_fee_key: "overdraft", fee_name: "Business Overdraft Fee", amount: 34, reread_at: "2026-10-21T00:00:00Z", published_at: "2026-10-22T00:00:00Z" });
    expect(judgeErrorFix(misread, [liveAllAlong, corrected], OD_TEXT)).toMatchObject({ verdict: "now_matches", judged: [502] });
  });

  it("reads each replacement's last extract attempt at the fix's rules version, on its own document and text", async () => {
    const queries: string[] = [];
    const db = vi.fn(async (parts: TemplateStringsArray) => {
      const text = parts.join("?");
      queries.push(text);
      if (text.includes("FROM pipeline_feedback f")) return [{ id: 1, institution_id: 9, fee_published_id: 500, canonical_fee_key: "stop_payment", kind: "k", check_name: "hamilton.source_check", created_at: "2026-10-10", rerun: true }];
      return [];
    });
    await runErrorFixRecheck({ db: db as never, entries: [entry()], dryRun: true });
    const live = queries.find((text) => text.includes("FROM published_fee_catalog c")) ?? "";
    expect(live).toContain("fp.published_at");
    // The replacement's re-read time is its own fragment (`rereadAtSql`).
    const rereadAt = queries.find((text) => text.includes("pa.source_document_id = c.source_document_id")) ?? "";
    expect(rereadAt).toContain("FROM pipeline_attempts pa");
    expect(rereadAt).toContain("pa.strategy_version >=");
    expect(rereadAt).toContain("pa.input_fingerprint = substring(");
  });

  it("reports rows at banks no longer active apart from those waiting for a re-run (follow-up 2)", async () => {
    const row = (id: number, over: Record<string, unknown>) => ({ id, institution_id: 9, fee_published_id: 500 + id, canonical_fee_key: "stop_payment", kind: "k", check_name: "hamilton.source_check", created_at: "2026-10-10", rerun: false, ...over });
    const db = vi.fn(async (parts: TemplateStringsArray) => parts.join("?").includes("FROM pipeline_feedback f")
      ? [row(1, {}), row(2, { bank_inactive: true }), row(3, { bank_inactive: "t", institution_id: 10 })]
      : []);
    const result = await runErrorFixRecheck({ db: db as never, entries: [entry()] });
    expect(result.results[0]).toMatchObject({ named: 3, waiting: 1, inactive: 2 });
    expect(errorFixDetail(result)).toMatchObject({ waiting: 1, inactive: 2, read_failed: 0 });
    expect(summarizeErrorFixRecheck(result)).toContain("1 waiting for a re-run");
    expect(summarizeErrorFixRecheck(result)).toContain("2 at banks no longer active, so never re-run.");
    // The query marks them with the same active test the direct path's requests use.
    expect(db.mock.calls.map(([parts]) => (parts as TemplateStringsArray).join("?")).join("\n")).toContain("COALESCE(inst.status, 'active') = 'active'");
  });

  it("reads each fix in its own savepoint, so a failed read neither throws nor stops the other fixes (follow-up 3)", async () => {
    const savepoints: string[] = [];
    let failNext = true;
    const query = vi.fn(async (parts: TemplateStringsArray) => {
      const text = parts.join("?");
      if (text.includes("FROM pipeline_feedback f")) {
        if (failNext) { failNext = false; throw new Error("canceling statement due to statement timeout"); }
        return [{ id: 5, institution_id: 9, fee_published_id: 505, canonical_fee_key: "stop_payment", kind: "k", check_name: "hamilton.source_check", created_at: "2026-10-10", rerun: false }];
      }
      return [];
    });
    const db = Object.assign(query, {
      savepoint: vi.fn(async (work: (scope: unknown) => Promise<unknown>) => {
        savepoints.push("open");
        try { return await work(query); } catch (error) { savepoints.push("rolled back"); throw error; }
      }),
    });
    const result = await runErrorFixRecheck({ db: db as never, entries: [entry({ pr: 1 }), entry({ pr: 2 })] });
    expect(savepoints).toEqual(["open", "rolled back", "open"]);
    expect(result.skipped).toEqual(["PR #1 read: canceling statement due to statement timeout"]);
    expect(result.results.map((outcome) => [outcome.pr, outcome.readFailed, outcome.waiting])).toEqual([[1, true, 0], [2, false, 1]]);
    expect(errorFixDetail(result)).toMatchObject({ read_failed: 1, waiting: 1 });
    expect(summarizeErrorFixRecheck(result)).toContain("The read failed for 1 fix(es); they are re-checked on the next run.");
  });
});
