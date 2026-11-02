// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const knox = vi.hoisted(() => ({ inserts: [] as Array<{ candidate: { feeName: string; amount: number; canonicalHint: string }; extraFlags?: string[] }> }));
vi.mock("@/lib/agents/knox/extract", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return {
    ...real,
    insertCandidateWithLearning: vi.fn(async (_db: unknown, options: { candidate: { feeName: string; amount: number; canonicalHint: string }; extraFlags?: string[] }) => {
      knox.inserts.push(options);
      return { inserted: true, takenDownBy: null, declinedReason: null };
    }),
  };
});
vi.mock("@/lib/agents/knox/takedown-lessons", async (importOriginal) => {
  const real = await importOriginal<{ emptyTakedownLessons: () => unknown }>();
  return { ...real, loadTakedownLessons: vi.fn(async () => real.emptyTakedownLessons()) };
});

import { runFreeSpecialists } from "@/lib/agents/knox/specialists";
import { darwinStandingDecisionSql } from "./verify";
import {
  HOLD_REFETCH_REQUEST_KIND,
  HOLD_REREAD_ARCHIVED_FLAG,
  HOLD_REREAD_FLAG,
  HOLD_REREAD_REPLACED_FLAG,
  HOLD_SOURCE_REREAD_CHECK,
  HOLD_SOURCE_REREAD_LIVE,
  HOLD_SOURCE_REREAD_STRATEGY,
  holdRereadCountSql,
  holdRereadRowsSql,
  holdRoute,
  judgeHoldReread,
  runHoldSourceReread,
  type HoldRereadRow,
} from "./hold-source-reread";
import { holdRereadRecheckSql } from "./hold-source-reread-switch";
import { FEEDBACK_KINDS } from "@/lib/agents/learning/feedback-kinds";

// Windows of the banks' stored texts around each held fee's line (agent_source_texts, prod,
// read-only, Nov 2): the oldest range holds the first run would read.
// Inst 6191, text 38543, held raw 111826 (atm_non_network $15).
const REISSUE = [
  "Photocopy Fee | $1 per page",
  "",
  "Reinstatement of Account | $50",
  "",
  "Reissue Lost/Stolen Visa ATM/Check Card | $15",
  "",
  "Statement Copy | $1 per page",
  "",
  "Stop Payment (Check or ACH) | $32 per request",
].join("\n");
// Inst 3075, text 3035, held raw 115405 (dormant_account $40).
const ESCHEAT = [
  "Duplicate Image Statement ............................................................................................................. $5.00",
  "Escheat Fee .................................................................................................................................... $40.00",
  "Inactivity Fee ....................................................................................................................... $2.00/Month",
].join("\n");
// Inst 4134, text 3138, held raw 117384 (minimum_balance $1,500).
const TALBOT = [
  "Master NOW Account",
  "",
  "$300 minimum opening deposit required",
  "",
  "Interest bearing checking account",
  "",
  "$1,500 minimum balance to obtain APY (annual percentage yield)",
  "",
  "$1,500 minimum balance to avoid monthly maintenance fee of $7",
].join("\n");
// Inst 5895, text 1283, held raw 114751 (money_order $1,000).
const DEL_ONE = [
  "Outgoing Wire Transfer | $25.00 each",
  "",
  "Money Orders | $2.00 each (max amt for issue per money order $1,000)",
  "Foreign Cash Advance Fee",
  "$10.00",
].join("\n");

const read = (text: string) => runFreeSpecialists(text).candidates;

describe("judgeHoldReread", () => {
  it("re-files a hold today's team reads on the same line at the same price under one other category", () => {
    const verdict = judgeHoldReread({ fee_name: "Reissue Lost/Stolen Visa ATM/Check Card", amount: "15.00", held_canonical_fee_key: "atm_non_network" }, REISSUE, read(REISSUE));
    expect(verdict).toMatchObject({ outcome: "recategorized", newKey: "card_replacement" });
    expect(verdict.candidate).toMatchObject({ amount: 15, canonicalHint: "card_replacement" });
  });

  it("confirms a hold today's team reads again at the held amount, traced by the shared source check", () => {
    const verdict = judgeHoldReread({ fee_name: "Escheat Fee", amount: "40.00", held_canonical_fee_key: "dormant_account" }, ESCHEAT, read(ESCHEAT));
    expect(verdict.outcome).toBe("confirmed");
    expect(verdict.sourceLine).toContain("Escheat Fee");
  });

  it("takes two looks before a balance threshold misread as a fee is archived", () => {
    const row = { fee_name: "minimum balance to obtain APY (annual percentage yield)", amount: "1500.00", held_canonical_fee_key: "minimum_balance" };
    expect(judgeHoldReread(row, TALBOT, read(TALBOT))).toMatchObject({ outcome: "not_found_pending", refusedBy: "source_check:amount_is_a_threshold" });
    expect(judgeHoldReread(row, TALBOT, read(TALBOT), true).outcome).toBe("not_found");
  });

  it("keeps a hold today's team still reads at the held amount when the source check does not trace it", () => {
    const verdict = judgeHoldReread({ fee_name: "each (max amt for issue per money order", amount: "1000.00", held_canonical_fee_key: "money_order" }, DEL_ONE, read(DEL_ONE));
    expect(verdict.outcome).toBe("unconfirmed");
  });

  it("replaces a held amount the current copy no longer prints with the one it does", () => {
    const text = "Other Fees\n\nStop Payment | $25.00\n\nReturned Mail | $5.00";
    const verdict = judgeHoldReread({ fee_name: "Stop Payment", amount: "250.00", held_canonical_fee_key: "stop_payment" }, text, read(text));
    expect(verdict).toMatchObject({ outcome: "changed", newAmount: 25, newWithinRange: true });
  });

  it("never replaces a held amount the page still prints as the fee's price", () => {
    const text = "Other Fees\n\nStop Payment | $25.00\n\nStop Payment | $250.00";
    const reads = read(text).filter((candidate) => candidate.amount === 25);
    expect(judgeHoldReread({ fee_name: "Stop Payment", amount: "250.00", held_canonical_fee_key: "stop_payment" }, text, reads).outcome).toBe("ambiguous");
  });

  it("reports no text when the current copy has none", () => {
    expect(judgeHoldReread({ fee_name: "Escheat Fee", amount: 40, held_canonical_fee_key: "dormant_account" }, null, []).outcome).toBe("no_text");
  });
});

describe("holdRoute", () => {
  const now = new Date("2026-11-02T12:00:00Z");
  it("sends a stale or never-checked copy for a fresh fetch, else re-reads it", () => {
    expect(holdRoute({ current_document_id: null, current_checked_at: null, document_text_id: null }, now)).toBe("no_document");
    expect(holdRoute({ current_document_id: 1, current_checked_at: null, document_text_id: 9 }, now)).toBe("refetch");
    expect(holdRoute({ current_document_id: 1, current_checked_at: "2026-09-01T00:00:00Z", document_text_id: 9 }, now)).toBe("refetch");
    expect(holdRoute({ current_document_id: 1, current_checked_at: "2026-10-20T00:00:00Z", document_text_id: null }, now)).toBe("no_text");
    expect(holdRoute({ current_document_id: 1, current_checked_at: "2026-10-20T00:00:00Z", document_text_id: 9 }, now)).toBe("reread");
  });
});

describe("SQL", () => {
  it("leaves the verify selection unchanged while the switch is off", () => {
    expect(HOLD_SOURCE_REREAD_LIVE).toBe(false);
    expect(holdRereadRecheckSql(false)).toBe("");
    expect(darwinStandingDecisionSql(true, undefined, false)).toBe(darwinStandingDecisionSql(true));
    expect(darwinStandingDecisionSql(true)).not.toContain(HOLD_SOURCE_REREAD_STRATEGY.strategy);
  });

  it("hands a confirmed hold back to verify once with the switch on", () => {
    const on = darwinStandingDecisionSql(true, undefined, true);
    expect(on).toContain(holdRereadRecheckSql(true));
    expect(holdRereadRecheckSql(true)).toContain(`hr.strategy = '${HOLD_SOURCE_REREAD_STRATEGY.strategy}'`);
    expect(holdRereadRecheckSql(true)).toContain("hr.detail->>'outcome' = 'confirmed'");
    expect(holdRereadRecheckSql(true)).toContain("hr.created_at > pa.created_at");
  });

  it("selects range and peer holds, oldest first, once per current text", () => {
    const query = holdRereadRowsSql();
    expect(query).toContain("last.reason IN ('outside_envelope', 'peer_outlier')");
    expect(query).toContain("ORDER BY k.held_at ASC, k.fee_raw_id ASC");
    expect(query).toContain("COALESCE(sd.superseded_by_id, sd.id)");
    expect(query).toContain("'text:' || r.document_text_id");
    expect(holdRereadCountSql()).toMatch(/^-- Darwin hold source re-read[\s\S]*BEGIN READ ONLY;[\s\S]*ROLLBACK;\n$/);
    expect(holdRereadCountSql()).not.toMatch(/\$[12]::/);
  });

  it("registers Magellan's refetch request with its reader", () => {
    expect(FEEDBACK_KINDS[HOLD_REFETCH_REQUEST_KIND]).toEqual({ readers: ["src/lib/agents/magellan/live-source-refetch.ts"] });
  });
});

function heldRow(overrides: Partial<HoldRereadRow>): HoldRereadRow {
  return {
    fee_raw_id: 1,
    institution_id: 100,
    source_document_id: 10,
    fee_name: "",
    amount: 1,
    held_reason: "outside_envelope",
    held_canonical_fee_key: "atm_non_network",
    held_at: "2026-10-04T20:25:25Z",
    current_document_id: 10,
    current_url: "https://bank.example/fees",
    current_checked_at: "2026-10-30T00:00:00Z",
    document_text_id: null,
    text_hash: "abc",
    text_source_url: "https://bank.example/fees",
    route: "reread",
    reread_key: "text:0",
    first_not_found_at: null,
    ...overrides,
  };
}

const ROWS: HoldRereadRow[] = [
  heldRow({ fee_raw_id: 111826, fee_name: "Reissue Lost/Stolen Visa ATM/Check Card", amount: "15.00", document_text_id: 1, reread_key: "text:1" }),
  heldRow({
    fee_raw_id: 117384, fee_name: "minimum balance to obtain APY (annual percentage yield)", amount: "1500.00", held_canonical_fee_key: "minimum_balance",
    document_text_id: 2, reread_key: "text:2", first_not_found_at: "2026-11-01T00:00:00Z",
  }),
  heldRow({ fee_raw_id: 500, fee_name: "Wire", amount: 90, route: "refetch", current_document_id: 77, current_checked_at: "2026-08-01T00:00:00Z", reread_key: "fetch:77" }),
  heldRow({ fee_raw_id: 501, fee_name: "Wire", amount: 90, route: "no_text", source_document_id: 11, current_document_id: 78, reread_key: "notext:78" }),
];

function fakeDb(rows: HoldRereadRow[]) {
  const queries: string[] = [];
  const db = ((strings: TemplateStringsArray) => {
    const text = strings.join("?");
    queries.push(text);
    if (text.includes("information_schema") || text.includes("to_regclass")) return Promise.resolve([{ ready: true, learning_schema_ready: true }]);
    if (text.includes("FROM agent_source_texts WHERE id = ANY")) return Promise.resolve([{ id: 1, normalized_text: REISSUE }, { id: 2, normalized_text: TALBOT }]);
    if (text.includes("INSERT INTO pipeline_feedback")) return Promise.resolve([{ id: 1 }]);
    if (text.includes("UPDATE raw_fee_observations")) return Promise.resolve([{ fee_raw_id: 1 }]);
    return Promise.resolve([]);
  }) as unknown as Parameters<typeof runHoldSourceReread>[0];
  (db as unknown as { unsafe: (query: string) => Promise<HoldRereadRow[]> }).unsafe = (query: string) => {
    queries.push(query);
    return Promise.resolve(rows);
  };
  return { db, queries };
}

describe("runHoldSourceReread", () => {
  beforeEach(() => { knox.inserts = []; });
  const now = new Date("2026-11-02T12:00:00Z");

  it("only reports with the switch off: one event, no attempt, request, raw row or flag", async () => {
    const { db, queries } = fakeDb(ROWS);
    const result = await runHoldSourceReread(db, { runId: 9, stepId: 3, dryRun: false, now });
    expect(result).toMatchObject({ live: false, selected: 4, routes: { reread: 2, refetch: 1, no_text: 1 }, superseded: 2, reread: 2, refetchRequested: 0, attempts: 0 });
    expect(result.outcomes).toEqual({ recategorized: 1, not_found: 1 });
    expect(queries.some((query) => /INSERT INTO pipeline_attempts|INSERT INTO pipeline_feedback|UPDATE raw_fee_observations/.test(query))).toBe(false);
    expect(knox.inserts).toEqual([]);
    expect(queries.filter((query) => query.includes("INSERT INTO agent_run_events"))).toHaveLength(1);
  });

  it("writes nothing at all on a dry run", async () => {
    const { db, queries } = fakeDb(ROWS);
    await runHoldSourceReread(db, { runId: 9, dryRun: true, live: true, now });
    expect(queries.some((query) => /INSERT|UPDATE/.test(query))).toBe(false);
  });

  it("acts with the switch on: refetch request, replacement through Knox's insert, archive after two looks", async () => {
    const { db, queries } = fakeDb(ROWS);
    const result = await runHoldSourceReread(db, { runId: 9, stepId: 3, dryRun: false, live: true, now });
    expect(result.refetchRequested).toBe(1);
    expect(result.replaced).toEqual([111826]);
    expect(result.archived).toEqual([117384]);
    expect(result.attempts).toBe(4);
    expect(knox.inserts).toHaveLength(1);
    expect(knox.inserts[0].candidate).toMatchObject({ amount: 15, canonicalHint: "card_replacement" });
    expect(knox.inserts[0].extraFlags).toEqual([HOLD_REREAD_FLAG]);
    expect(queries.filter((query) => query.includes("INSERT INTO pipeline_attempts"))).toHaveLength(4);
    expect(queries.filter((query) => query.includes("UPDATE raw_fee_observations"))).toHaveLength(2);
    expect(queries.some((query) => query.includes("INSERT INTO pipeline_feedback"))).toBe(true);
    expect(result.samples.map((sample) => sample.outcome)).toContain("recategorized");
    expect([HOLD_REREAD_REPLACED_FLAG, HOLD_REREAD_ARCHIVED_FLAG, HOLD_SOURCE_REREAD_CHECK]).toEqual(["darwin_hold_reread_replaced", "darwin_hold_not_on_current_copy", "darwin.hold_source_reread"]);
  });

  it("skips a whole-table pass that ran within the interval", async () => {
    const { db, queries } = fakeDb(ROWS);
    const recent = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join("?");
      if (text.includes("FROM agent_run_events")) return Promise.resolve([{ created_at: new Date(now.getTime() - 60_000) }]);
      return (db as unknown as (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>)(strings, ...values);
    }) as unknown as Parameters<typeof runHoldSourceReread>[0];
    const result = await runHoldSourceReread(recent, { runId: 9, dryRun: false, now });
    expect(result.skipped).toBe(true);
    expect(queries.some((query) => query.includes("ORDER BY k.held_at"))).toBe(false);
  });
});
