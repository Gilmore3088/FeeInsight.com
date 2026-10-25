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
import type { ErrorFixFee } from "./error-fixes";

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
  raw_created_at: "2026-10-01T00:00:00Z",
  ...over,
} as ErrorFixFee);
// The error rows below were recorded on Oct 10, after the fee above was extracted.
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
    // Rosetta reads unchanged bytes once, and Knox reads a text again only at a new version.
    for (const stage of ["read", "verify", "publish"]) expect(errorFixProblems([entry({ stage: stage as never })])[0]).toContain("stage must be one of extract");
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
    const rerun = fee({ raw_created_at: "2026-10-21T00:00:00Z" });
    expect(judgeErrorFix(down, [rerun], TEXT)).toMatchObject({ verdict: "now_matches", judged: [501] });
    expect(judgeErrorFix({ ...down, source_document_id: 77 }, [rerun], TEXT)).toMatchObject({ verdict: "now_matches" });
    expect(judgeErrorFix({ ...down, source_document_id: 78 }, [rerun], TEXT)).toMatchObject({ verdict: "not_reproduced" });
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
    expect(summarizeErrorFixRecheck(result)).toBe("5 open error(s) named by 1 fix(es): 1 closed (now match the bank's document), 2 still wrong after a re-run, 1 taken down with no right fee extracted in their place, 1 waiting for a re-run, 0 not judged (no stored text, or the fee is a rate or has no category).");
  });
});
