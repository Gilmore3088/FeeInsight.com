/**
 * Correctness for Hamilton's answer eval (#1079): do the numbers in an answer tie back to the live
 * fee catalog? The same reconciliation the `report-reconciliation` skill runs on a report, applied
 * to one answer, deterministic and read-only (no model calls, no writes):
 *
 * 1. Rows: every fee value the answer is built on (the bank's own value, every peer, market-layer
 *    and local-competitor value) is that institution's live value in `published_fee_catalog` under
 *    the statistics contract (approved, sourced, consumer rows; one value per institution:
 *    `valuePerInstitution`). A value with no live row, or a different live value, is a failure.
 * 2. Statistics: each printed peer band and market-layer p25, median and p75 recomputes with the
 *    contract (`summarizeFees`) from those members' live values, within one cent; the national
 *    layer counts every live institution publishing the fee.
 * 3. Figures: every dollar figure in a sentence the answer sources to `published_fee_catalog` is a
 *    live-recomputed value from (1) and (2), or the gap between two of them, within the rounding
 *    the figure is printed at, or a price the question itself named.
 *
 * 4. Filings (written answers, #1077 claim contract step 7): every filing figure the sentence
 *    binding supports (a `filing:` fact, or a derived quarter or peer median whose input filings
 *    are named) is re-read live from its filing row (`readFilingValues`, data-store/filing-reread.ts).
 *    A changed value fails, and so does a row no longer on file; a re-read that cannot run leaves
 *    the answer unchecked.
 *
 * Limits, stated so the rate is read for what it is: percentages and counts in the text are not
 * yet checked; other-source money the written answer's tools read that no supported filing claim
 * names (national data, fee changes, complaints, a filing sentence the binding left as Hamilton's
 * reading) is still accepted as stated; a filed peer median whose peer list was shortened names no
 * input rows, so only its stated value is known; and the whole-schedule overview's peer medians are
 * accepted as printed, because the overview does not carry its peer members (the bank's own value
 * on each line is re-read live).
 * The overdraft pricing groups' rules ("$15.01 to $30") are fixed definitions and are skipped.
 * The structure set's transfer from savings is a different fee from the one asked about, so its
 * members' values and the "typically $X" line recompute from their own live rows (#2029).
 */

import { getContractFeeRows, getFeeValuesForInstitutions } from "@/lib/data-store/fee-index";
import { countedAmounts, summarizeFees, valuePerInstitution, type StatsInputRow } from "@/lib/data-store/fee-stats";
import { extractFigures } from "./figure-check";
import { ARCHETYPE_RULE_PATTERN, typicalTransfer } from "./workspace/storyline";
import { MIN_PEERS_FOR_POSITION } from "./workspace/scenario";
import type { ScheduleOverview } from "./workspace/schedule";
import type { AskResponse, Fact, FeeResearch, PeerValue } from "./workspace/types";
import { readFilingValues, type FilingRereadKey, type FilingRereadTable } from "@/lib/data-store/filing-reread";
import type { HamiltonEvidenceBundle, HamiltonEvidenceFact } from "./evidence-contract";
import type { NarrativeBinding } from "./narrative-bound";

const FEE_TABLE = "published_fee_catalog";
/** The structure line's lower-cost path: "N of M in the group price a transfer from savings, typically $X". */
const TRANSFER_CATEGORY = "od_protection_transfer";
/** Recomputed statistics tie out within one cent (the skill's threshold). */
const CENT = 0.0051;
/** Untied figures listed per answer; the count beyond is summarized. */
const MAX_LISTED = 6;
/** Hamilton's minimum sample for a peer median (MIN_PEERS_FOR_POSITION). */
const MIN_FOR_MEDIAN = MIN_PEERS_FOR_POSITION;

/** Live values the answer is checked against, for the fees it covers. */
export interface LiveFeeValues {
  /** The answered fee's live rows nationally (the statistics contract's input). */
  rows: StatsInputRow[];
  /** The bank's own live value per fee, for the whole-schedule lines; absent when not read. */
  ownByCategory?: Map<string, number>;
  /**
   * Live transfer-from-savings rows (#2029), read when the answer carries a structure set: its
   * members' transfer values and the typical transfer recompute from them. Absent when not read.
   */
  transferRows?: StatsInputRow[];
}

export interface CorrectnessResult {
  /** False when the answer cites no catalog figure and is built on no fee research, or the catalog (or a filing re-read) could not be read. */
  checked: boolean;
  /** Catalog-sourced dollar figures checked in the text. */
  figures: number;
  /** Supported filing claims re-read live (written answers only). */
  filings?: number;
  failures: string[];
}

/** One supported filing claim: a sentence the binding supports and a filing fact it rests on. */
export interface FilingClaim {
  sentence: string;
  /** The filing fact's value as the answer's tools read it, in its own unit. */
  value: number;
  unit: HamiltonEvidenceFact["unit"];
  key: FilingRereadKey;
}

/** Live filing values for the claims' keys, or null when they could not be read. */
export type FilingReader = (keys: FilingRereadKey[]) => Promise<Map<string, number | null> | null>;

const REREAD_TABLES = new Set<FilingRereadTable>(["institution_financial_records", "institution_call_report_items"]);

function filingKey(fact: HamiltonEvidenceFact): FilingRereadKey | null {
  const { scope, source } = fact;
  const origin = fact.id.split(":")[1];
  const basis = scope.periodBasis;
  if (source.evidenceClass !== "filing" || !REREAD_TABLES.has(source.table as FilingRereadTable)) return null;
  if ((origin !== "fdic" && origin !== "ncua") || typeof scope.institutionId !== "number" || !scope.reportingDate || !scope.metric) return null;
  if (basis !== "ytd" && basis !== "standalone_quarter" && basis !== "point_in_time") return null;
  return { id: fact.id, table: source.table as FilingRereadTable, source: origin, institutionId: scope.institutionId, reportDate: scope.reportingDate, metric: scope.metric, basis };
}

/**
 * The filing claims a binding supports: each supported sentence's `filing:` facts, and the input
 * filings of each derived fact it cites (a profile quarter, a filed peer median with its peers named).
 */
export function supportedFilingClaims(binding: NarrativeBinding | null, bundle: HamiltonEvidenceBundle | null): FilingClaim[] {
  if (!binding || !bundle) return [];
  const facts = new Map(bundle.facts.map((f) => [f.id, f]));
  const derived = new Map(bundle.derivations.map((d) => [d.id, d]));
  const out: FilingClaim[] = [];
  for (const sentence of binding.supported) {
    const seen = new Set<string>();
    const ids = sentence.factIds.flatMap((id) => (derived.has(id) ? derived.get(id)!.derivation.inputFactIds : [id]));
    for (const id of ids) {
      const fact = facts.get(id);
      const key = fact ? filingKey(fact) : null;
      if (!fact || !key || seen.has(id) || typeof fact.value !== "number" || !Number.isFinite(fact.value)) continue;
      seen.add(id);
      out.push({ sentence: sentence.text, value: fact.value, unit: fact.unit, key });
    }
  }
  return out;
}

/** Live filing reads for the eval: one database read per call (data-store/filing-reread.ts); null when it fails. */
export function liveFilingReader(): FilingReader {
  return (keys) => readFilingValues(keys).catch(() => null);
}

const filingFigure = (value: number, unit: FilingClaim["unit"]) =>
  unit === "usd" ? `$${Math.round(value).toLocaleString("en-US")}` : String(value);
const sameFiling = (stated: number, live: number, unit: FilingClaim["unit"]) =>
  Math.abs(stated - live) <= (unit === "usd" ? 0.5 : 1e-9 * Math.max(1, Math.abs(live)));
const snippet = (text: string) => (text.length > 80 ? `${text.slice(0, 80)}…` : text);

/** Step 4: each supported filing claim against its live row; failures in place, the number re-read returned. */
function reconcileFilings(claims: readonly FilingClaim[], live: ReadonlyMap<string, number | null>, failures: string[]): number {
  for (const claim of claims) {
    const value = live.get(claim.key.id);
    const what = `${claim.key.metric} for ${claim.key.reportDate} (${claim.key.basis.replace(/_/g, " ")})`;
    if (value === null || value === undefined) {
      failures.push(`filing claim "${snippet(claim.sentence)}": the answer uses ${filingFigure(claim.value, claim.unit)} for ${what}, and the live filing has no row for it`);
    } else if (!sameFiling(claim.value, value, claim.unit)) {
      failures.push(`filing claim "${snippet(claim.sentence)}": the answer uses ${filingFigure(claim.value, claim.unit)} for ${what}, the live filing has ${filingFigure(value, claim.unit)}`);
    }
  }
  return claims.length;
}

const money = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
const near = (a: number | null | undefined, b: number | null | undefined) =>
  a === null || a === undefined || b === null || b === undefined ? (a ?? null) === (b ?? null) : Math.abs(a - b) <= CENT;

/** Every sentence the answer sources to the live fee catalog. */
export function catalogFacts(response: AskResponse): Fact[] {
  return answerFacts(response).filter((f) => f.source?.table === FEE_TABLE);
}

/** Every sourced sentence of an answer, the storyline's included. */
function answerFacts(response: AskResponse): Fact[] {
  const story = response.answer?.storyline;
  const all: Fact[] = [
    ...(response.facts ?? []),
    ...(response.answer?.claims ?? []),
    ...(response.answer?.drivers ?? []),
    ...(story
      ? [
          ...story.situation,
          ...story.complication,
          ...story.lenses.finance,
          ...story.lenses.market,
          ...story.watch,
          ...story.exhibits.flatMap((e) => (e.takeaway ? [e.takeaway] : [])),
          ...(story.options ?? []).flatMap((o) => o.consequences),
        ]
      : []),
  ];
  return all;
}

/** Dollar figures the question itself gives ("what if we charged $35"): the reader's, not the catalog's. */
export function questionFigures(question: string): number[] {
  return extractFigures(question).filter((f) => f.kind === "usd").map((f) => f.value);
}

/** A printed figure ties when it is an anchor, a member's value, or the gap between two anchors. */
export function ties(value: number, tolerance: number, anchors: number[], singles: number[]): boolean {
  const hit = (v: number) => Math.abs(Math.abs(value) - Math.abs(v)) <= tolerance;
  if (anchors.some(hit) || singles.some(hit)) return true;
  for (const a of anchors) for (const b of anchors) if (a !== b && hit(a - b)) return true;
  return false;
}

interface Group {
  label: string;
  members: PeerValue[];
  printed?: { p25: number | null; median: number | null; p75: number | null };
  /** True for the national layer: every live institution publishing the fee belongs to it. */
  whole?: boolean;
}

function groupsOf(research: FeeResearch): Group[] {
  const groups: Group[] = [
    {
      label: `peer group (${research.peerLabel})`,
      members: research.peers,
      printed: research.band && research.band.n >= MIN_FOR_MEDIAN ? research.band : undefined,
    },
  ];
  for (const layer of research.layers) {
    if (layer.members.length === 0) continue;
    groups.push({ label: `${layer.label} layer`, members: layer.members, printed: layer, whole: layer.scope === "national" });
  }
  if (research.localCompetitors?.length) groups.push({ label: "local competitors", members: research.localCompetitors });
  return groups;
}

/**
 * Reconciles one answer against live values. `live` is null when the catalog could not be read:
 * the answer is then left unchecked rather than called right or wrong.
 */
export function reconcileAnswer(input: ReconcileInput): CorrectnessResult {
  const facts = catalogFacts(input.response);
  const base = reconcileValues(input, facts);
  if (!base) return { checked: false, figures: 0, failures: [] };
  return tieText(facts.map((f) => f.text).join("\n"), base.anchors, base.singles, base.failures);
}

/**
 * Reconciles the paid memo written over an answer's storyline (#1079): the answer's values and
 * statistics as above, then every dollar figure in the memo's text. A memo figure ties when it is
 * a live value, a recomputed statistic or a gap between two, or a figure the storyline states from
 * a source other than the fee catalog (call reports, fee changes, money at stake, a tested price),
 * which this check accepts as printed just as it does for the free answer.
 */
export function reconcileMemoText(input: ReconcileInput & { text: string; extra?: number[] }): CorrectnessResult {
  const base = reconcileValues(input, catalogFacts(input.response));
  if (!base) return { checked: false, figures: 0, failures: [] };
  // Other-source figures count as stated, never as ends of a gap: a memo may repeat them, not build on them here.
  // `extra` is the same for numbers the reader supplied (a tested price), which no catalog row holds.
  return tieText(input.text, base.anchors, [...base.singles, ...otherSourceFigures(input.response), ...(input.extra ?? [])], base.failures);
}

/**
 * Reconciles a Simulate read (#1079) on its own text (#1414): every dollar figure must be a live
 * value, a recomputed statistic, a figure the storyline states from another source, or a gap
 * between two anchors, where the reader's tested prices (`readerAnchors`) are anchors too, so "the
 * tested $37 is $3 below p75" ties. The free answer's own stale values are that answer's failures,
 * not the read's.
 */
export function reconcileSimulateText(input: ReconcileInput & { text: string; readerAnchors: number[] }): CorrectnessResult {
  const base = reconcileValues(input, catalogFacts(input.response));
  if (!base) return { checked: false, figures: 0, failures: [] };
  return tieText(input.text, [...base.anchors, ...input.readerAnchors], [...base.singles, ...otherSourceFigures(input.response)], []);
}

/**
 * Reconciles a written answer (#1079) on its own text: every dollar figure must be a live value, a
 * recomputed statistic or a gap between two for the asked fee, or one of `extra` (money the answer's
 * tools read from sources other than the fee catalog). The free answer's research only names the
 * fee and members to recompute; its own stale values are that answer's failures, not this one's.
 *
 * `filings` (#1077 step 7): the supported filing claims and their live re-read. A claim whose live
 * value differs, or whose row is gone, fails, even though its figure is in `extra` (the tools did
 * read it). When there are claims and `live` is null (the re-read failed), the answer is unchecked.
 */
export function reconcileWrittenText(input: ReconcileInput & {
  text: string; extra?: number[];
  filings?: { claims: readonly FilingClaim[]; live: ReadonlyMap<string, number | null> | null };
}): CorrectnessResult {
  const base = reconcileValues(input, catalogFacts(input.response));
  if (!base) return { checked: false, figures: 0, failures: [] };
  const claims = input.filings?.claims ?? [];
  if (claims.length > 0 && !input.filings?.live) return { checked: false, figures: 0, failures: [] };
  const failures: string[] = [];
  const filings = claims.length > 0 ? reconcileFilings(claims, input.filings!.live!, failures) : 0;
  const tied = tieText(input.text, base.anchors, [...base.singles, ...(input.extra ?? [])], failures);
  return input.filings ? { ...tied, filings } : tied;
}

/** Dollar figures the answer states from sources other than the fee catalog, accepted as printed. */
function otherSourceFigures(response: AskResponse): number[] {
  const story = response.answer?.storyline;
  const text = [
    ...answerFacts(response).filter((f) => f.source?.table !== FEE_TABLE).map((f) => f.text),
    ...(story?.keyFigures ?? []).filter((k) => k.source?.table !== FEE_TABLE).map((k) => k.value),
  ].join("\n");
  const out = extractFigures(text).filter((f) => f.kind === "usd").map((f) => f.value);
  for (const e of story?.exhibits ?? []) {
    const x = e.exhibit;
    if (x.kind === "change_timeline") for (const ev of x.events) out.push(...[ev.from, ev.to].filter((v): v is number => v !== null));
    if (x.kind === "money_at_stake") for (const r of x.rows) out.push(r.low, r.high);
    if (x.kind === "structure_matrix" && x.incomeSplit) {
      const i = x.incomeSplit;
      out.push(i.own, i.peerMedian, i.priceExplained, i.otherExplained);
    }
  }
  for (const o of story?.options ?? []) if (typeof o.price === "number") out.push(o.price);
  return out;
}

/** Up to 40 characters either side of a figure, on its own line. */
function around(text: string, index: number): string {
  const start = Math.max(text.lastIndexOf("\n", index) + 1, index - 40);
  const nl = text.indexOf("\n", index);
  const end = Math.min(nl === -1 ? text.length : nl, index + 40);
  return `${start > 0 && text[start - 1] !== "\n" ? "…" : ""}${text.slice(start, end).replace(/[()]/g, "")}${end < text.length && text[end] !== "\n" ? "…" : ""}`;
}

/** The text with the pricing groups' rules blanked (same length, so indices still point into it). */
function withoutGroupRules(text: string): string {
  return text.replace(ARCHETYPE_RULE_PATTERN, (rule) => " ".repeat(rule.length));
}

function tieText(text: string, anchors: number[], singles: number[], failures: string[]): CorrectnessResult {
  const usd = extractFigures(withoutGroupRules(text)).filter((f) => f.kind === "usd");
  // Each untied figure with the words around it, so the failing sentence can be found (#981).
  const untied = [...new Map(usd.filter((f) => !ties(f.value, f.tolerance, anchors, singles)).map((f) => [f.raw, `${f.raw} (${around(text, f.index)})`])).values()];
  if (untied.length > 0) {
    failures.push(`figures that tie to no live catalog value: ${untied.slice(0, MAX_LISTED).join(", ")}${untied.length > MAX_LISTED ? ` and ${untied.length - MAX_LISTED} more` : ""}`);
  }
  return { checked: true, figures: usd.length, failures };
}

interface ReconcileInput {
  question: string;
  response: AskResponse;
  research: FeeResearch | null;
  schedule?: ScheduleOverview | null;
  live: LiveFeeValues | null;
}

/** The bank's own live amounts, as the statistics contract counts them: non-negative numbers. */
function ownAmounts(rows: StatsInputRow[], institutionId: number): number[] {
  return rows
    .filter((r) => Number(r.institution_id) === institutionId && r.amount !== null && r.amount !== "")
    .map((r) => Number(r.amount))
    .filter((a) => Number.isFinite(a) && a >= 0);
}

/** A stated range of several own fees that does not match the bank's live rows; null when it does. */
function severalFeesFailure(several: { low: number; high: number }, amounts: number[]): string | null {
  const stated = `${money(several.low)} to ${money(several.high)}`;
  if (amounts.length === 0) return `your fee: the answer uses ${stated}, and the catalog has no live row for it`;
  const low = Math.min(...amounts);
  const high = Math.max(...amounts);
  if (near(several.low, low) && near(several.high, high)) return null;
  return `your fee: the answer uses ${stated}, the catalog has ${near(low, high) ? money(low) : `${money(low)} to ${money(high)}`}`;
}

/** Steps 1 and 2: the values and statistics, and the anchors a figure may tie to; null when unchecked. */
function reconcileValues(input: ReconcileInput, facts: Fact[]): { failures: string[]; anchors: number[]; singles: number[] } | null {
  const { question, research, schedule, live } = input;
  if (!live || (!research && facts.length === 0)) return null;
  const failures: string[] = [];
  // Anchors: the bank's own values, recomputed statistics and the question's prices; a sentence may
  // state one of them or the gap between two. Singles: each member's live value, stated as is.
  const anchors: number[] = questionFigures(question);
  const singles: number[] = [];

  if (research) {
    const values = valuePerInstitution(live.rows);
    const own = values.get(research.institutionId) ?? null;
    const several = research.current === null ? research.ownSeveral ?? null : null;
    if (several) {
      // Several different fees are stated as their range, not one value (#2030): check its ends.
      const failure = severalFeesFailure(several, ownAmounts(live.rows, research.institutionId));
      if (failure) failures.push(failure);
    } else if (!near(research.current, own)) {
      failures.push(
        own === null
          ? `your fee: the answer uses ${money(research.current!)}, and the catalog has no live row for it`
          : `your fee: the answer uses ${research.current === null ? "none" : money(research.current)}, the catalog has ${money(own)}`,
      );
    }
    if (own !== null) anchors.push(own);
    for (const r of live.rows) {
      if (Number(r.institution_id) === research.institutionId && Number.isFinite(Number(r.amount))) anchors.push(Number(r.amount));
    }

    for (const group of groupsOf(research)) {
      let missing = 0;
      let differ = 0;
      const counted: { institutionId: number; amount: number; countedAs?: number }[] = [];
      for (const m of group.members) {
        const value = values.get(m.institutionId);
        if (value === undefined) {
          missing++;
          continue;
        }
        if (!near(m.amount, value)) differ++;
        singles.push(value);
        counted.push({ institutionId: m.institutionId, amount: value, countedAs: m.countedAs });
      }
      if (missing > 0) failures.push(`${group.label}: ${missing} of ${group.members.length} values have no live catalog row`);
      if (differ > 0) failures.push(`${group.label}: ${differ} of ${group.members.length} values differ from the catalog`);
      if (group.whole) {
        const liveCount = [...values.keys()].filter((id) => id !== research.institutionId).length;
        if (liveCount !== group.members.length) {
          failures.push(`${group.label}: counts ${group.members.length} institutions, the catalog has ${liveCount} publishing this fee`);
        }
      }
      // Statistics rule 7 (count once) as the band applies it: sister charters of one shared
      // schedule (each member's `countedAs`) are one value. Those values are already collapsed,
      // so summarizeFees must not collapse again.
      const memberRows: StatsInputRow[] = countedAmounts(counted).map((amount, index) => ({ institution_id: index + 1, amount, fee_category: research.feeCategory }));
      const stats = summarizeFees(memberRows, { countSharedScheduleOnce: false });
      const recomputed = { p25: stats.p25_amount, median: stats.median_amount, p75: stats.p75_amount };
      if (group.printed) {
        const printed = group.printed;
        const off = (["p25", "median", "p75"] as const).filter((k) => printed[k] !== null && !near(printed[k], recomputed[k]));
        if (off.length > 0) failures.push(`${group.label}: ${off.join(", ")} do not recompute from the members' live values`);
      }
      anchors.push(...[stats.median_amount, stats.p25_amount, stats.p75_amount, stats.min_amount, stats.max_amount].filter((v): v is number => v !== null));
    }
  }

  if (research?.structure && live.transferRows) reconcileTransfers(research.structure, live.transferRows, { failures, anchors, singles });

  if (schedule) {
    for (const row of schedule.positions) {
      const own = live.ownByCategory?.get(row.feeCategory);
      if (live.ownByCategory && !near(row.current, own ?? null)) {
        failures.push(`${row.displayName}: the overview uses ${money(row.current)}, the catalog has ${own === undefined ? "no live row" : money(own)}`);
      }
      if (own !== undefined) anchors.push(own);
      // Accepted as printed: the overview carries no peer members to recompute from.
      anchors.push(row.peerMedian, ...(row.band ? [row.band.p25, row.band.p75] : []));
    }
  }

  return { failures, anchors, singles };
}

/**
 * The structure set's transfer values (#2029): each one the answer states is that institution's
 * live value, and the typical transfer recomputes from the group's live values with the storyline's
 * own rule (the contract median of the priced ones).
 */
function reconcileTransfers(
  set: NonNullable<FeeResearch["structure"]>,
  rows: StatsInputRow[],
  out: { failures: string[]; anchors: number[]; singles: number[] },
): void {
  const values = valuePerInstitution(rows);
  const stated = set.rows.filter((r) => r.values[TRANSFER_CATEGORY] !== undefined);
  const groupLive: number[] = [];
  let missing = 0;
  let differ = 0;
  for (const row of stated) {
    const value = values.get(row.institutionId);
    if (value === undefined) {
      missing++;
      continue;
    }
    if (!near(row.values[TRANSFER_CATEGORY], value)) differ++;
    if (row.own) {
      out.anchors.push(value);
    } else {
      out.singles.push(value);
      groupLive.push(value);
    }
  }
  const label = "transfer from savings (structure group)";
  if (missing > 0) out.failures.push(`${label}: ${missing} of ${stated.length} values have no live catalog row`);
  if (differ > 0) out.failures.push(`${label}: ${differ} of ${stated.length} values differ from the catalog`);
  const typical = typicalTransfer(groupLive);
  if (typical !== null) out.anchors.push(typical);
}

export type LiveReader = (institutionId: number, research: FeeResearch | null, schedule?: ScheduleOverview | null) => Promise<LiveFeeValues | null>;

/** Live reads for the eval, cached per fee for the whole run: one national read per fee. */
export function liveCatalogReader(): LiveReader {
  const byCategory = new Map<string, Promise<StatsInputRow[] | null>>();
  const rowsFor = (category: string) => {
    if (!byCategory.has(category)) {
      byCategory.set(
        category,
        getContractFeeRows({ categories: [category] })
          .then((rows) => rows.map((r) => ({
            institution_id: r.institution_id,
            amount: r.amount,
            fee_category: r.fee_category,
            charter_type: r.charter_type,
            schedule_keys: r.schedule_keys ?? null,
            schedule_group: r.schedule_group ?? null,
          })))
          .catch(() => null),
      );
    }
    return byCategory.get(category)!;
  };
  return async (institutionId, research, schedule) => {
    const rows = research ? await rowsFor(research.feeCategory) : [];
    if (rows === null) return null;
    // A structure set states a transfer from savings: read that fee too, or leave the answer unchecked.
    const transferRows = research?.structure ? await rowsFor(TRANSFER_CATEGORY) : undefined;
    if (transferRows === null) return null;
    const base: LiveFeeValues = transferRows ? { rows, transferRows } : { rows };
    if (!schedule || schedule.positions.length === 0) return base;
    const own = await getFeeValuesForInstitutions([institutionId], schedule.positions.map((p) => p.feeCategory)).catch(() => null);
    if (!own) return null;
    return { ...base, ownByCategory: own.get(institutionId) ?? new Map() };
  };
}
