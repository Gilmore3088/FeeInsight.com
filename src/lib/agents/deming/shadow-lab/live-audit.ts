import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hashText } from "@/lib/agents/rosetta/read";
import { FEE_FAMILIES } from "@/lib/fee-taxonomy";
import { toCents } from "./rows";
import type { FeeRef, ShadowCase } from "./types";

/**
 * The weekly live accuracy audit as shadow-lab cases (#2064): published fees a reviewer checked
 * against the bank's own schedule, replayed on the schedule text the reviewer saved. One case is
 * one saved document; each audit row that names it adds expectations by its verdict
 * (`expectationsForRow`). A row is never filled in: one the rules cannot score is counted by
 * verdict and reason (`liveAuditNotReplayable`).
 */

export const LIVE_AUDIT_FIXTURE = "src/lib/agents/deming/__fixtures__/live-audit-2026-w43.json";
const ISSUE = "#2064 W43 live audit";

export interface LiveAuditRow {
  case_key: string;
  institution_id: number;
  verdict: string;
  category: string | null;
  fee_name?: string | null;
  amount_on_site?: string | null;
  schedule_amount?: string | null;
  correction?: string | null;
  document_key?: string | null;
  not_replayable?: string | null;
}

export interface LiveAuditFixture {
  about: { rows: number; rows_per_verdict: Record<string, number> } & Record<string, unknown>;
  documents: { document_key: string; institution_id: number; text: string }[];
  rows: LiveAuditRow[];
}

export type RowExpectation = { publish: FeeRef[]; forbid: FeeRef[] } | { skip: string };

const CANONICAL_KEYS = new Set(Object.values(FEE_FAMILIES).flat());
const DOLLAR_FIGURE = /\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)/g;
const PLAIN_DOLLARS = /^\$\s?[\d,]+(?:\.\d+)?$/;
const HALF_HOUR = /half[-\s]?hour|1\/2[-\s]?hour/i;
const HOUR = /\bhour\b|\/\s?hr\b/i;
/** A correction that tells the reviewer what to do is not a name ("Name the account"). */
const INSTRUCTION = /^(?:name|preserve|remove|use|keep|label|split|drop|do|show|separate|add)\b/i;

const SKIP = {
  rate: "the live amount is a rate, not a dollar price",
  scheduleRate: "the schedule amount is a rate",
  notOneFigure: "the schedule amount is not one dollar figure",
  noCategory: "no canonical category for the missing fee",
  statedPrice: "the live price is in the schedule; the error is a tier, unit or condition the lab does not score",
  confirmed: "a matched row in the same schedule has this category and price",
  verdict: "the verdict has no replay rule",
} as const;

function dollarsToCents(value: string): number | null {
  return toCents(value.replace(/[$,\s]/g, ""));
}

function liveCents(row: LiveAuditRow): number | null {
  const amount = (row.amount_on_site ?? "").trim();
  return PLAIN_DOLLARS.test(amount) ? dollarsToCents(amount) : null;
}

function scheduleFigures(text: string | null | undefined): number[] {
  return [...(text ?? "").matchAll(DOLLAR_FIGURE)].map((m) => dollarsToCents(m[1]) ?? -1).filter((cents) => cents >= 0);
}

const canonical = (key: string | null | undefined): key is string => key != null && CANONICAL_KEYS.has(key);

function ref(key: string, row: LiveAuditRow, cents: number, extra: Partial<FeeRef> = {}): FeeRef {
  return { canonicalFeeKey: key, feeName: row.fee_name ?? null, amountCents: cents, ...extra };
}

function expectedName(correction: string | null | undefined): string | null {
  const name = (correction ?? "").trim();
  return name && !INSTRUCTION.test(name) ? name : null;
}

/**
 * One audit row's expectations. `confirmed` holds "category:cents" of the rows in the same
 * schedule the audit matched: a price confirmed elsewhere in the schedule is never forbidden.
 */
export function expectationsForRow(row: LiveAuditRow, confirmed: ReadonlySet<string>): RowExpectation {
  const category = row.category ?? "";
  const cents = liveCents(row);
  const forbidLive = (extra: Partial<FeeRef> = {}): RowExpectation =>
    confirmed.has(`${category}:${cents}`) ? { skip: SKIP.confirmed } : { publish: [], forbid: [ref(category, row, cents ?? 0, extra)] };

  switch (row.verdict) {
    case "MATCH":
      if (cents == null) return { skip: SKIP.rate };
      return { publish: [ref(category, row, cents, { expectedName: row.fee_name ?? null })], forbid: [] };
    case "BAD_NAME": {
      if (cents == null) return { skip: SKIP.rate };
      const name = expectedName(row.correction);
      return { publish: [ref(category, row, cents, name ? { expectedName: name } : {})], forbid: [] };
    }
    case "MISSING": {
      const key = canonical(row.correction) ? row.correction : canonical(category) ? category : null;
      if (!key) return { skip: SKIP.noCategory };
      if ((row.schedule_amount ?? "").includes("%")) return { skip: SKIP.scheduleRate };
      const figures = scheduleFigures(row.schedule_amount);
      if (figures.length !== 1) return { skip: SKIP.notOneFigure };
      return { publish: [{ canonicalFeeKey: key, feeName: null, amountCents: figures[0] }], forbid: [] };
    }
    case "WRONG_AMOUNT": {
      if (cents == null) return { skip: SKIP.rate };
      const schedule = row.schedule_amount ?? "";
      const figures = scheduleFigures(schedule);
      if (figures.includes(cents)) {
        if (HALF_HOUR.test(schedule)) return forbidLive({ frequency: "!per_half_hour" });
        if (HOUR.test(schedule)) return forbidLive({ frequency: "!hourly" });
        return { skip: SKIP.statedPrice };
      }
      const wrong = forbidLive();
      if ("skip" in wrong) return wrong;
      return figures.length === 1 ? { publish: [ref(category, row, figures[0])], forbid: wrong.forbid } : wrong;
    }
    case "WRONG_CATEGORY": {
      if (cents == null) return { skip: SKIP.rate };
      const wrong = forbidLive();
      if ("skip" in wrong) return wrong;
      const fixed = canonical(row.correction) && row.correction !== category ? [ref(row.correction, row, cents)] : [];
      return { publish: fixed, forbid: wrong.forbid };
    }
    case "NOT_A_FEE":
      return cents == null ? { skip: SKIP.rate } : forbidLive();
    default:
      return { skip: SKIP.verdict };
  }
}

export function readLiveAudit(root: string = process.cwd()): LiveAuditFixture {
  return JSON.parse(readFileSync(join(root, LIVE_AUDIT_FIXTURE), "utf8")) as LiveAuditFixture;
}

function confirmedPrices(rows: LiveAuditRow[]): Map<string, Set<string>> {
  const byDocument = new Map<string, Set<string>>();
  for (const row of rows) {
    const cents = liveCents(row);
    if (row.verdict !== "MATCH" || !row.document_key || cents == null) continue;
    const set = byDocument.get(row.document_key) ?? new Set<string>();
    set.add(`${row.category}:${cents}`);
    byDocument.set(row.document_key, set);
  }
  return byDocument;
}

/** Each replayable row with its expectations, or the reason it is not scored. */
function scoredRows(fixture: LiveAuditFixture): { row: LiveAuditRow; result: RowExpectation }[] {
  const confirmed = confirmedPrices(fixture.rows);
  return fixture.rows.map((row) => ({
    row,
    result:
      row.not_replayable || !row.document_key
        ? { skip: row.not_replayable ?? "no saved document" }
        : expectationsForRow(row, confirmed.get(row.document_key) ?? new Set()),
  }));
}

export function liveAuditCases(fixture: LiveAuditFixture): ShadowCase[] {
  const texts = new Map(fixture.documents.map((d) => [d.document_key, d.text]));
  const expected = new Map<string, { publish: FeeRef[]; forbid: FeeRef[]; rows: string[] }>();
  for (const { row, result } of scoredRows(fixture)) {
    if ("skip" in result || !row.document_key) continue;
    const entry = expected.get(row.document_key) ?? { publish: [], forbid: [], rows: [] };
    entry.publish.push(...result.publish);
    entry.forbid.push(...result.forbid);
    entry.rows.push(row.case_key);
    expected.set(row.document_key, entry);
  }
  return [...expected.entries()].map(([key, entry]) => {
    const text = texts.get(key) ?? null;
    return {
      caseKey: `live_audit:${key}`,
      scenario: "live_audit",
      provenance: { fixture: LIVE_AUDIT_FIXTURE, fixtureCaseKey: entry.rows.join(","), textHash: hashText(text ?? ""), issue: ISSUE },
      document: { url: null, text },
      expected: { publish: entry.publish, forbid: entry.forbid },
      status: "ok",
    };
  });
}

/** Audit rows the lab does not score, grouped by verdict and reason. */
export function liveAuditNotReplayable(fixture: LiveAuditFixture): { issue: string; failure: string; reason: string }[] {
  const counts = new Map<string, number>();
  for (const { row, result } of scoredRows(fixture)) {
    if (!("skip" in result)) continue;
    const key = `${row.verdict}\u0000${result.skip}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([key, count]) => {
      const [verdict, reason] = key.split("\u0000");
      return { issue: ISSUE, failure: `${count} ${verdict} ${count === 1 ? "row" : "rows"}`, reason };
    });
}
