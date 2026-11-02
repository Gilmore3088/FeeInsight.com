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
  confirmedAmountLimit,
  holdReasonCleared,
  holdRereadCountSql,
  holdRereadDetail,
  holdRereadRowsSql,
  holdRoute,
  judgeHoldReread,
  runHoldSourceReread,
  type HoldRereadRow,
} from "./hold-source-reread";
import { holdRereadRecheckSql } from "./hold-source-reread-switch";
import { FEEDBACK_KINDS } from "@/lib/agents/learning/feedback-kinds";
import { insertCandidateWithLearning } from "@/lib/agents/knox/extract";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import type { PeerCheckResult } from "./peer-checks";

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

// A misread today's team repeats: a $0.15 coin-roll price read again as a safe deposit box rent.
const BOX = "Coin Roll | $0.15 per roll\n\nSafe Deposit Box Rental | $0.15 per roll";

const read = (text: string) => runFreeSpecialists(text).candidates;
/** One read of a line as the first read made it, for the confirmed-limit cases. */
const misread = (feeName: string, amount: number, canonicalHint: string, excerpt: string) =>
  [{ feeName, amount, canonicalHint, excerpt, frequency: "per_item", confidence: 0.9, waivable: false }] as unknown as ReturnType<typeof read>;

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

  it("keeps a balance threshold held: on a minimum-balance fee the threshold is the value", () => {
    const row = { fee_name: "minimum balance to obtain APY (annual percentage yield)", amount: "1500.00", held_canonical_fee_key: "minimum_balance" };
    expect(checkFeeAgainstSource(TALBOT, row.fee_name, 1500, ".", "minimum_balance")).toMatchObject({ ok: false, reason: "amount_is_a_threshold" });
    expect(judgeHoldReread(row, TALBOT, read(TALBOT)).outcome).toBe("stated_unread");
    expect(judgeHoldReread(row, TALBOT, read(TALBOT), true).outcome).toBe("stated_unread");
  });

  it("takes two looks before a fee the page no longer names is archived", () => {
    const row = { fee_name: "Paper Statement Fee", amount: "4.00", held_canonical_fee_key: "paper_statement" };
    expect(judgeHoldReread(row, REISSUE, read(REISSUE))).toMatchObject({ outcome: "not_found_pending", refusedBy: "source_check:name_not_in_text" });
    expect(judgeHoldReread(row, REISSUE, read(REISSUE), true).outcome).toBe("not_found");
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

  it("never confirms an amount its traced line gives as a cap (v2)", () => {
    const line = "Overdraft Fees: maximum of $125.00 per day";
    const row = { fee_name: "Overdraft Fees", amount: 125, held_canonical_fee_key: "overdraft" };
    expect(checkFeeAgainstSource(line, row.fee_name, 125, ".", "overdraft").ok).toBe(true);
    expect(judgeHoldReread(row, line, misread(row.fee_name, 125, "overdraft", line)))
      .toMatchObject({ outcome: "stated_unread", refusedBy: "amount_is_a_limit:cap_or_deposit_figure" });
  });

  it("confirms a repeated misread; whether it releases is today's rules' call (v2)", () => {
    expect(judgeHoldReread({ fee_name: "Safe Deposit Box Rental", amount: 0.15, held_canonical_fee_key: "safe_deposit_box" }, BOX, read(BOX)).outcome).toBe("confirmed");
  });

  it("reports no text when the current copy has none", () => {
    expect(judgeHoldReread({ fee_name: "Escheat Fee", amount: 40, held_canonical_fee_key: "dormant_account" }, null, []).outcome).toBe("no_text");
  });
});

describe("confirmedAmountLimit", () => {
  it("reads a balance to avoid the fee, a daily cap and a maximum as limits, and a price as none", () => {
    expect(confirmedAmountLimit("Monthly maintenance fee", "monthly_maintenance", 1500, "$1,500 minimum balance to avoid monthly maintenance fee of $7")).toBe("balance_to_avoid");
    expect(confirmedAmountLimit("Monthly Service Charge", "monthly_maintenance", 1000, "Monthly Service Charge $10 if balance falls below $1,000")).toBe("balance_to_avoid");
    expect(confirmedAmountLimit("Overdraft Fee", "overdraft", 125, "Overdraft Fee $25.00 per item (max $125 per day)")).toBe("daily_cap");
    expect(confirmedAmountLimit("Overdraft Fee", "overdraft", 125, "Overdraft Fee | $25.00 per item, maximum of $125.00 per day")).toBe("cap_or_deposit_figure");
    expect(confirmedAmountLimit("Overdraft Fee", "overdraft", 25, "Overdraft Fee | $25.00 per item, maximum of $125.00 per day")).toBeNull();
    expect(confirmedAmountLimit("Escheat Fee", "dormant_account", 40, "Escheat Fee ..... $40.00")).toBeNull();
  });
});

describe("holdReasonCleared", () => {
  const none = new Map();
  const outlier = { outlier: true, scope: "state" } as PeerCheckResult;
  const inside = { outlier: false, scope: "state" } as PeerCheckResult;
  const range = (fee_name: string, amount: number, key: string) => ({ fee_name, amount, held_reason: "outside_envelope", held_canonical_fee_key: key });

  it("releases a range hold only when its amount now sits inside today's range", () => {
    expect(holdReasonCleared(range("Escheat Fee", 40, "dormant_account"), none, null)).toEqual({ cleared: true, check: "inside_hand_range" });
    expect(holdReasonCleared(range("Safe Deposit Box Rental", 0.15, "safe_deposit_box"), none, null)).toEqual({ cleared: false, check: "outside_hand_range" });
    expect(holdReasonCleared(range("Minimum balance to avoid fee", 2500, "minimum_balance"), none, null).cleared).toBe(false);
    expect(holdReasonCleared(range("Overdraft Fee", 125, "overdraft"), none, null).cleared).toBe(false);
  });

  it("reads a category without a hand range by its learned range, as verify does", () => {
    const key = "zz_unranged_fee";
    const learned = new Map([[key, { min: 0.01, max: 40, p95: 20, institutions: 30 }]]);
    expect(holdReasonCleared(range("Thing Fee", 30, key), learned, null)).toEqual({ cleared: true, check: "inside_learned_range" });
    expect(holdReasonCleared(range("Thing Fee", 60, key), learned, null)).toEqual({ cleared: false, check: "outside_learned_range" });
  });

  it("releases a peer hold only when today's peer check passes it", () => {
    const peer = { fee_name: "Overdraft Fee", amount: 39, held_reason: "peer_outlier", held_canonical_fee_key: "overdraft" };
    expect(holdReasonCleared(peer, none, outlier)).toEqual({ cleared: false, check: "peer_outlier" });
    expect(holdReasonCleared(peer, none, inside)).toEqual({ cleared: true, check: "peer_clears" });
    expect(holdReasonCleared(peer, none, null)).toEqual({ cleared: true, check: "peer_clears" });
    expect(holdReasonCleared(peer, none, undefined)).toEqual({ cleared: false, check: "peer_unknown" });
    expect(holdReasonCleared({ ...peer, amount: 125 }, none, inside).cleared).toBe(false);
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
    expect(query).toContain("LEFT JOIN institution_sources inst ON inst.id = fr.institution_id");
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
  heldRow({
    fee_raw_id: 900, fee_name: "Paper Statement Fee", amount: "4.00", held_canonical_fee_key: "paper_statement",
    document_text_id: 1, reread_key: "text:1", first_not_found_at: "2026-11-01T00:00:00Z",
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
    if (text.includes("FROM agent_source_texts WHERE id = ANY")) {
      return Promise.resolve([{ id: 1, normalized_text: REISSUE }, { id: 2, normalized_text: TALBOT }, { id: 3, normalized_text: ESCHEAT }, { id: 4, normalized_text: BOX }]);
    }
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
    expect(result).toMatchObject({ live: false, selected: 5, routes: { reread: 3, refetch: 1, no_text: 1 }, superseded: 2, reread: 3, refetchRequested: 0, attempts: 0 });
    expect(result.outcomes).toEqual({ recategorized: 1, stated_unread: 1, not_found: 1 });
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
    expect(result.takenOver).toEqual([]);
    expect(result.archived).toEqual([900]);
    expect(result.attempts).toBe(5);
    expect(knox.inserts).toHaveLength(1);
    expect(knox.inserts[0].candidate).toMatchObject({ amount: 15, canonicalHint: "card_replacement" });
    expect(knox.inserts[0].extraFlags).toEqual([HOLD_REREAD_FLAG]);
    expect(queries.filter((query) => query.includes("INSERT INTO pipeline_attempts"))).toHaveLength(5);
    // The held row retired before Knox's insert, then marked replaced; the not-found archived.
    const updates = queries.filter((query) => query.includes("UPDATE raw_fee_observations"));
    expect(updates).toHaveLength(3);
    expect(queries.indexOf(updates[0])).toBeLessThan(queries.findIndex((query) => query.includes("needs_darwin_verification' AS pending")));
    expect(queries.some((query) => query.includes("INSERT INTO pipeline_feedback"))).toBe(true);
    expect(result.samples.map((sample) => sample.outcome)).toContain("recategorized");
    expect([HOLD_REREAD_REPLACED_FLAG, HOLD_REREAD_ARCHIVED_FLAG, HOLD_SOURCE_REREAD_CHECK]).toEqual(["darwin_hold_reread_replaced", "darwin_hold_not_on_current_copy", "darwin.hold_source_reread"]);
  });

  it("keeps the hold when Knox's insert writes no row and no live or pending row has the new read's key", async () => {
    vi.mocked(insertCandidateWithLearning).mockResolvedValueOnce({ inserted: false, takenDownBy: null, declinedReason: null });
    const { db, queries } = fakeDb(ROWS.slice(0, 1));
    const result = await runHoldSourceReread(db, { runId: 9, stepId: 3, dryRun: false, live: true, now });
    expect(result.replaced).toEqual([]);
    expect(result.takenOver).toEqual([]);
    expect(result.attempts).toBe(1);
    // No savepoint on the double: the retire is undone by hand, before the attempt is logged.
    const updates = queries.filter((query) => query.includes("UPDATE raw_fee_observations"));
    expect(updates).toHaveLength(2);
    expect(updates[1]).toContain("- 'superseded_by_reread'");
    expect(queries.findIndex((query) => query.includes("INSERT INTO pipeline_attempts"))).toBeGreaterThan(queries.indexOf(updates[1]));
  });

  // v2: a confirmation releases its hold only when the held reason no longer applies today.
  const CONFIRMS: HoldRereadRow[] = [
    heldRow({ fee_raw_id: 115405, fee_name: "Escheat Fee", amount: "40.00", held_canonical_fee_key: "dormant_account", document_text_id: 3, reread_key: "text:3" }),
    heldRow({ fee_raw_id: 700, fee_name: "Safe Deposit Box Rental", amount: "0.15", held_canonical_fee_key: "safe_deposit_box", document_text_id: 4, reread_key: "text:4" }),
  ];

  it("counts would-release against still-held confirmations with the switch off", async () => {
    const { db, queries } = fakeDb([...ROWS, ...CONFIRMS]);
    const result = await runHoldSourceReread(db, { runId: 9, stepId: 3, dryRun: false, now });
    expect(result.outcomes).toEqual({ recategorized: 1, stated_unread: 1, not_found: 1, confirmed: 1, confirmed_still_held: 1 });
    const detail = holdRereadDetail(result);
    expect(detail).toMatchObject({ version: 2, would_release: 1, confirmed_still_held: 1, confirmed_limit: 0, would_replace: { recategorized: 1, changed: 0 } });
    const samples = Object.fromEntries(detail.samples.map((sample) => [sample.fee_raw_id, sample]));
    expect(samples[115405]).toMatchObject({ outcome: "confirmed", release_check: "inside_hand_range" });
    expect(samples[700]).toMatchObject({ outcome: "confirmed_still_held", release_check: "outside_hand_range" });
    expect(queries.some((query) => /INSERT INTO pipeline_attempts|UPDATE raw_fee_observations/.test(query))).toBe(false);
  });

  it("hands back only the confirmation that clears today's rules with the switch on", async () => {
    const { db, queries } = fakeDb(CONFIRMS);
    const result = await runHoldSourceReread(db, { runId: 9, stepId: 3, dryRun: false, live: true, now });
    expect(result.handedBack).toBe(1);
    expect(result.attempts).toBe(2);
    expect(result.replaced).toEqual([]);
    expect(queries.some((query) => query.includes("UPDATE raw_fee_observations"))).toBe(false);
    expect(queries.filter((query) => query.includes("INSERT INTO pipeline_attempts"))).toHaveLength(2);
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
