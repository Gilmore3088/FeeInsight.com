/**
 * Hamilton's answer as a consulting memo: the question type picks a storyline, and the
 * storyline picks three to five exhibits, each titled with the point it makes. Pure and
 * deterministic: every figure comes from FeeResearch with its source.
 *
 * One storyline serves both readers (James, 2026-10-06): the finance lens carries money,
 * rules and notice for a CFO or board; the market lens carries position and competitor
 * moves for product and marketing. Options sit side by side with their consequences and
 * are never ranked or picked; nothing here says to raise, lower or drop a fee.
 */

import { subjectPossessive, subjectName } from "./subject";
import { formatDollarsInWords, formatFeeAmount } from "@/lib/format";
import { formatRatePercent } from "@/lib/percent-fees";
import { MAX_STORY_LINE_WORDS, words } from "./four-roles";
import { plainName, proseFeeName } from "./names";
import { ownRate, ownRateSource, rateRelation, ratesOf } from "./rates";
import { MIN_PEERS_FOR_POSITION, pricePosition } from "./scenario";
import { segmentExhibit, shortSegmentLabel } from "./segment";
import type { ArchetypeKey, KeyFigure, StoryExhibit, StoryOption, Storyline, StorylineKind } from "./storyline-types";
import type { Exhibit, Fact, FeeResearch, HamiltonAnswer, SegmentMember, SourceRef } from "./types";

/** How the question reads, as far as the storyline needs it. */
export interface StoryIntent {
  /** Prices the question names. */
  tested?: number[];
  /** The reader asked for a view or named an objective. */
  wantsDecision?: boolean;
  focus?: "position" | "competitors" | "trend";
  /** The question is about caps, transfers or how the fee is charged rather than its price. */
  structure?: boolean;
  /** The question asks about rules or regulators, so the finance lens names the bank's own regulator. */
  regulation?: boolean;
}

export const MIN_STORY_EXHIBITS = 3;
export const MAX_STORY_EXHIBITS = 5;
/** Rows a structure matrix shows after the bank's own. */
const MAX_MATRIX_ROWS = 12;
/** Names an archetype lists. */
const MAX_ARCHETYPE_NAMES = 5;
/** A peer within this many dollars of the bank's price is "close" for the watch list. */
const CLOSE_PRICE = 2;
const CHANGE_WINDOW_DAYS = 180;

const STRUCTURE_QUESTION = /\b(caps?|capped|per day|a day|daily|transfers?|continuous|sustained|structure|de minimis|grace|how many items)\b/i;

/** Whether a question is about how a fee is charged rather than its price. */
export function asksAboutStructure(question: string): boolean {
  return STRUCTURE_QUESTION.test(question);
}

const ARCHETYPES: { key: ArchetypeKey; label: string; rule: string; test: (v: number) => boolean }[] = [
  { key: "zero_od", label: "No fee", rule: "$0 published", test: (v) => v === 0 },
  { key: "low_capped", label: "Low", rule: "$0.01 to $15", test: (v) => v > 0 && v <= 15 },
  { key: "mid", label: "Mid", rule: "$15.01 to $30", test: (v) => v > 15 && v <= 30 },
  { key: "premium", label: "Premium", rule: "Over $30", test: (v) => v > 30 },
];

// ─── Small formatters ────────────────────────────────────────────────────────

function money(n: number): string {
  return formatFeeAmount(n) ?? `$${n}`;
}

function count(n: number): string {
  return n.toLocaleString("en-US");
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** "2026-08-02" -> "Aug 2". */
function shortDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function longDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function article(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

function capitalize(text: string): string {
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : text;
}

function feeSource(research: FeeResearch): SourceRef {
  return { label: "Bank Fee Index, published fee schedules", table: "published_fee_catalog", asOf: research.provenance.dataAsOf.fees ?? null };
}

// ─── The comparison group ────────────────────────────────────────────────────

interface Group {
  /** As it reads in a sentence: "peers", "institutions with $10 billion or more in assets". */
  label: string;
  members: { name: string; amount: number }[];
}

function segmentLed(research: FeeResearch): boolean {
  return !!research.segment && research.segment.problem === null;
}

function comparisonGroup(research: FeeResearch): Group {
  const seg = research.segment;
  if (seg && seg.problem === null) {
    return { label: shortSegmentLabel(seg.segment), members: seg.members.map((m: SegmentMember) => ({ name: m.institutionName, amount: m.amount })) };
  }
  return { label: "peers", members: research.peers.map((p) => ({ name: p.institutionName, amount: p.amount })) };
}

// ─── Exhibits, each with the point it makes ──────────────────────────────────

type Piece = Omit<StoryExhibit, "id" | "number"> & { key: string };

function positionPiece(research: FeeResearch, name: string): Piece | null {
  const band = research.band;
  if (!band || band.n < MIN_PEERS_FOR_POSITION) return null;
  const position = research.current !== null ? pricePosition(research.current, research.peers.map((p) => p.amount)) : null;
  const actionTitle =
    research.current !== null && position !== null
      ? `Peers' middle half charges ${money(band.p25)} to ${money(band.p75)}; ${subjectPossessive(research, false)} ${money(research.current)} sits at the ${ordinal(position)} percentile.`
      : `The middle half of ${count(band.n)} peers charges ${money(band.p25)} to ${money(band.p75)}.`;
  const national = research.layers.find((l) => l.scope === "national");
  const exhibit: Exhibit = {
    kind: "fee_position",
    title: `${capitalize(name)} fee: ${subjectName(research)} against ${count(band.n)} peers`,
    unit: "dollars",
    own: research.current,
    ownLabel: research.institutionName,
    band: { label: research.peerLabel, p25: band.p25, median: band.median, p75: band.p75, n: band.n },
    markers: [
      { label: "Peer median", scope: "peer", value: band.median, n: band.n },
      ...research.layers
        .filter((l) => l.median !== null)
        .map((l) => ({ label: l.scope === "national" ? "National median" : `${l.label} median`, scope: l.scope, value: l.median as number, n: l.n })),
    ],
    sources: [feeSource(research), ...research.layers.filter((l) => l.median !== null).map((l) => ({ ...l.source, asOf: l.asOf }))],
  };
  return {
    key: "position",
    actionTitle,
    exhibit,
    takeaway:
      national && national.median !== null
        ? { text: `The national median is ${money(national.median)} across ${count(national.n)} institutions.`, source: { ...national.source, asOf: national.asOf ?? null }, sampleSize: national.n }
        : undefined,
  };
}

function segmentPiece(research: FeeResearch, name: string): Piece | null {
  const seg = research.segment;
  if (!seg || seg.problem !== null || seg.members.length === 0) return null;
  const n = seg.members.length;
  const median = seg.band ? `; the median is ${money(seg.band.median)}` : "";
  const zero = seg.zeroCount > 0 ? `, ${count(seg.zeroCount)} at $0` : "";
  const exhibit: Exhibit = {
    kind: "segment_table",
    title: `${capitalize(name)} fees, ${shortSegmentLabel(seg.segment)}, largest first`,
    members: seg.members,
    own: research.current,
    ownLabel: research.institutionName,
    sources: [seg.source],
    note: seg.institutionsInSegment > n ? `${count(seg.institutionsInSegment - n)} more publish no ${name} fee yet.` : undefined,
  };
  return {
    key: "segment",
    actionTitle: `${count(n)} of ${count(seg.institutionsInSegment)} ${shortSegmentLabel(seg.segment)} publish ${article(name)} ${name} fee${zero}${median}.`,
    exhibit,
    takeaway:
      seg.withDailyCap > 0
        ? { text: `${count(seg.withDailyCap)} of the ${count(n)} also publish a daily cap on items charged.`, source: seg.source, sampleSize: n }
        : undefined,
  };
}

function largestPiece(research: FeeResearch, name: string): Piece | null {
  const seg = research.segment;
  if (!seg || seg.problem !== null) return null;
  const exhibit = segmentExhibit(seg, research.feeCategory, research.current, research.institutionName);
  if (!exhibit || exhibit.kind !== "competitor_range" || exhibit.items.length < 2) return null;
  const amounts = exhibit.items.map((i) => i.amount);
  const lo = Math.min(...amounts);
  const hi = Math.max(...amounts);
  return {
    key: "largest",
    actionTitle: `The ${count(exhibit.items.length)} largest ${shortSegmentLabel({ ...seg.segment, largest: null })} that publish one charge ${money(lo)} to ${money(hi)}.`,
    exhibit,
  };
}

function localPiece(research: FeeResearch, name: string): Piece | null {
  const list = research.localCompetitors ?? [];
  if (list.length === 0) return null;
  const items = list.slice(0, MAX_MATRIX_ROWS).sort((a, b) => a.amount - b.amount);
  const lo = items[0].amount;
  const hi = items[items.length - 1].amount;
  const below = research.current !== null ? items.filter((i) => i.amount < research.current!).length : null;
  const actionTitle =
    below !== null
      ? `${count(below)} of ${count(items.length)} competitors in ${subjectPossessive(research, false)} market charge less than ${subjectPossessive(research, false)} ${money(research.current!)}; their range is ${money(lo)} to ${money(hi)}.`
      : `${count(items.length)} competitors in ${subjectPossessive(research, false)} market charge ${money(lo)} to ${money(hi)} for ${article(name)} ${name}.`;
  return {
    key: "local",
    actionTitle,
    exhibit: {
      kind: "competitor_range",
      title: `${capitalize(name)} fees in ${subjectPossessive(research, false)} market, by local deposits`,
      unit: "dollars",
      own: research.current,
      ownLabel: research.institutionName,
      items: items.map((p) => ({ name: p.institutionName, amount: p.amount, url: p.documentUrls[0] ?? null, deposits: p.marketDeposits ?? null })),
      sources: [research.localMarket?.source ?? feeSource(research)],
      note: list.length > MAX_MATRIX_ROWS ? `The ${MAX_MATRIX_ROWS} largest by local deposits of ${list.length}.` : undefined,
    },
  };
}

/** "5 over $30 and 11 at $15.01–$30": only the groups that have members, largest first. */
function listParts(parts: [number, string][]): string {
  const shown = parts.filter(([n]) => n > 0).sort((a, b) => b[0] - a[0]).map(([n, text]) => `${count(n)} ${text}`);
  if (shown.length <= 1) return shown[0] ?? "none publish one";
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

export function archetypeOf(amount: number): ArchetypeKey {
  return (ARCHETYPES.find((a) => a.test(amount)) ?? ARCHETYPES[ARCHETYPES.length - 1]).key;
}

function archetypePiece(research: FeeResearch, name: string): Piece | null {
  if (research.feeCategory !== "overdraft" && research.feeCategory !== "nsf") return null;
  const group = comparisonGroup(research);
  const n = group.members.length;
  if (n < MIN_PEERS_FOR_POSITION) return null;
  const archetypes = ARCHETYPES.map((a) => {
    const members = group.members.filter((m) => a.test(m.amount));
    const names = segmentLed(research) ? members : [...members].sort((x, y) => x.name.localeCompare(y.name));
    return { key: a.key, label: a.label, rule: a.rule, count: members.length, names: names.slice(0, MAX_ARCHETYPE_NAMES).map((m) => m.name) };
  });
  const by = Object.fromEntries(archetypes.map((a) => [a.key, a.count])) as Record<ArchetypeKey, number>;
  const ownKey = research.current !== null ? archetypeOf(research.current) : null;
  const source = segmentLed(research) ? research.segment!.source : feeSource(research);
  const groupWord = segmentLed(research) ? "of them" : "peers";
  const ownGroup = ownKey ? archetypes.find((a) => a.key === ownKey)! : null;
  return {
    key: "archetype",
    actionTitle: `Of ${count(n)} ${group.label}: ${listParts(
      [
        [by.zero_od, "at $0"],
        [by.low_capped, "up to $15"],
        [by.mid, "at $15.01–$30"],
        [by.premium, "over $30"],
      ],
    )}.`,
    exhibit: {
      kind: "archetype_map",
      title: `${capitalize(name)} pricing groups among ${group.label}`,
      archetypes,
      ownKey,
      sources: [source],
    },
    takeaway:
      ownGroup && research.current !== null
        ? {
            text: `${subjectPossessive(research)} ${money(research.current)} puts ${subjectName(research)} in the ${ownGroup.label.toLowerCase()} group (${ownGroup.rule}) with ${count(ownGroup.count)} ${groupWord}.`,
            source,
            sampleSize: n,
          }
        : undefined,
  };
}

function structurePiece(research: FeeResearch): Piece | null {
  const set = research.structure;
  if (!set) return null;
  const group = set.rows.filter((r) => !r.own);
  if (group.length < MIN_PEERS_FOR_POSITION) return null;
  const has = (category: string) => group.filter((r) => r.values[category] !== undefined).length;
  const nsf = has("nsf");
  const transfer = has("od_protection_transfer");
  const cap = has("od_daily_cap");
  const label = set.groupLabel.startsWith("peers") ? "peers" : set.groupLabel;
  const shown = [set.rows.find((r) => r.own), ...group.slice(0, MAX_MATRIX_ROWS)].filter((r): r is NonNullable<typeof r> => !!r);
  return {
    key: "structure",
    actionTitle: `Of ${count(group.length)} ${label}: ${count(nsf)} publish an NSF fee, ${count(transfer)} a transfer fee, ${count(cap)} a daily cap.`,
    exhibit: {
      kind: "structure_matrix",
      title: `Overdraft and NSF structure: ${subjectName(research)} and ${label}`,
      columns: set.columns.map((c) => c.label),
      rows: shown.map((r) => ({
        name: r.name,
        cells: set.columns.map((c) => (r.values[c.category] === undefined ? null : money(r.values[c.category]))),
        own: r.own || undefined,
      })),
      sources: [{ ...set.source, asOf: set.source.asOf ?? research.provenance.dataAsOf.fees ?? null }],
      note: group.length > MAX_MATRIX_ROWS ? `Showing ${MAX_MATRIX_ROWS} of ${group.length}.` : undefined,
    },
  };
}

/** A line naming an institution, or the same line without the name when a long name would run past a storyline line's limit. */
function namedWithin(named: string, unnamed: string): string {
  return words(named) <= MAX_STORY_LINE_WORDS ? named : unnamed;
}

/** Monthly maintenance: the bank's account lineup beside the group's, one row per institution. */
function lineupPiece(research: FeeResearch): Piece | null {
  const set = research.lineup;
  const own = set?.rows.find((r) => r.own);
  if (!set || !own) return null;
  const group = set.rows.filter((r) => !r.own);
  const label = set.groupLabel.startsWith("peers") ? "peers" : set.groupLabel;
  const withFree = group.filter((r) => r.summary.shareWithFreeAccount === 1).length;
  const ownSummary = own.summary;
  const ownLowest = ownSummary.lowestMonthlyFee;
  // Lead with the bank's lowest price; the table carries the account count.
  const ownLead =
    ownLowest === 0
      ? `${subjectPossessive(research)} lineup includes a no-fee account`
      : ownLowest === null
        ? `${subjectPossessive(research)} schedule shows ${count(ownSummary.accounts)} ${ownSummary.accounts === 1 ? "account" : "accounts"}`
        : `${subjectPossessive(research)} lowest monthly fee is ${money(ownLowest)}`;
  const actionTitle =
    group.length >= MIN_PEERS_FOR_POSITION
      ? `${ownLead}; ${count(withFree)} of ${count(group.length)} ${label} offer a no-fee account.`
      : `${ownLead}; too few ${label} publish their lineup to compare.`;
  const shown = [own, ...group.slice(0, MAX_MATRIX_ROWS)];
  return {
    key: "lineup",
    actionTitle,
    exhibit: {
      kind: "structure_matrix",
      title: `Checking lineup: ${subjectName(research)} and ${label}`,
      columns: ["Accounts", "Lowest monthly fee", "Median monthly fee", "No-fee account", "Median balance to avoid the fee"],
      rows: shown.map((r) => ({
        name: r.name,
        cells: [
          count(r.summary.accounts),
          r.summary.lowestMonthlyFee === null ? null : money(r.summary.lowestMonthlyFee),
          r.summary.medianMonthlyFee === null ? null : money(r.summary.medianMonthlyFee),
          r.summary.shareWithFreeAccount === 1 ? "Yes" : "No",
          r.summary.medianMinBalanceToAvoid === null ? null : money(r.summary.medianMinBalanceToAvoid),
        ],
        own: r.own || undefined,
      })),
      sources: [{ ...set.source, asOf: set.source.asOf ?? research.provenance.dataAsOf.fees ?? null }],
      note: [group.length > MAX_MATRIX_ROWS ? `Showing ${MAX_MATRIX_ROWS} of ${group.length}.` : null, "A blank balance means the schedule states none."]
        .filter(Boolean)
        .join(" "),
    },
  };
}

/** The fee as a rate: the bank's own rate beside the national rate picture, never beside dollars. */
function ratePiece(research: FeeResearch, name: string): Piece | null {
  const rates = ratesOf(research);
  if (!rates) return null;
  const own = ownRate(research);
  const { n, median, p25, p75, min, max } = rates.national;
  if (!own && median === null) return null;
  const relation = own ? rateRelation(own.ratePercent, rates) : null;
  const actionTitle =
    own && relation && median !== null
      ? `${subjectPossessive(research)} ${formatRatePercent(own.ratePercent)} ${name} rate is ${relation} the national median rate of ${formatRatePercent(median)} across ${count(n)} institutions.`
      : own
        ? `${subjectPossessive(research)} ${name} fee is ${own.label}; too few institutions state it as a rate for a national median.`
        : `Where institutions state the ${name} fee as a rate, the national median is ${formatRatePercent(median)} across ${count(n)} institutions.`;
  const institutions = count(n);
  const rows: { name: string; cells: (string | null)[]; own?: boolean }[] = [
    { name: research.institutionName, cells: [own?.label ?? null, null], own: true },
  ];
  if (median !== null) {
    rows.push({ name: "National median", cells: [formatRatePercent(median), institutions] });
    if (p25 !== null && p75 !== null) rows.push({ name: "Middle half", cells: [`${formatRatePercent(p25)} to ${formatRatePercent(p75)}`, institutions] });
    if (min !== null && max !== null) rows.push({ name: "Lowest to highest", cells: [`${formatRatePercent(min)} to ${formatRatePercent(max)}`, institutions] });
  }
  return {
    key: "rate",
    actionTitle,
    exhibit: {
      kind: "structure_matrix",
      title: `${capitalize(name)} rate: ${subjectName(research)} and the nation`,
      columns: ["Rate", "Institutions"],
      rows,
      sources: [...(own ? [ownRateSource(rates, own, research)] : []), rates.source],
    },
    takeaway:
      median !== null
        ? { text: `${institutions} institutions state the ${name} fee as a rate nationally.`, source: rates.source, sampleSize: n }
        : undefined,
  };
}

function stateName(research: FeeResearch): string | null {
  return research.layers.find((l) => l.scope === "state")?.label ?? null;
}

function recentEvents(research: FeeResearch) {
  return [...(research.changeEvents ?? [])].filter((e) => e.from !== null && e.to !== null).sort((a, b) => b.date.localeCompare(a.date));
}

function changePiece(research: FeeResearch, name: string): Piece | null {
  const events = recentEvents(research);
  const state = stateName(research);
  if (events.length === 0 || !state) return null;
  const cuts = events.filter((e) => (e.to as number) < (e.from as number)).length;
  const source: SourceRef = { label: "Fee changes seen on published schedules", table: "fee_change_records", asOf: events[0].date };
  return {
    key: "changes",
    actionTitle: `${count(events.length)} ${events.length === 1 ? "institution" : "institutions"} in ${state} changed ${article(name)} ${name} fee in the last ${CHANGE_WINDOW_DAYS} days; ${count(cuts)} lowered it.`,
    exhibit: {
      kind: "change_timeline",
      title: `${capitalize(name)} fee changes in ${state}, newest first`,
      events: events.map((e) => ({ date: e.date, institutionName: e.institutionName, from: e.from, to: e.to, url: null })),
      sources: [source],
    },
  };
}

function moneyPiece(research: FeeResearch, name: string): Piece | null {
  const line = research.revenueLine;
  const fin = research.institutionFinancials;
  const rows: { label: string; low: number; high: number; evidenceLevel: "institution" }[] = [];
  const sources: SourceRef[] = [];
  if (line) {
    rows.push({ label: line.combinedWith ? `${line.label}, with ${line.combinedWith}` : line.label, low: line.annualIncome, high: line.annualIncome, evidenceLevel: "institution" });
    sources.push({ ...line.source, asOf: line.quarterEnd });
  }
  if (fin?.latestTtm != null) {
    rows.push({ label: `${fin.label}, last four quarters`, low: fin.latestTtm, high: fin.latestTtm, evidenceLevel: "institution" });
    sources.push({ ...fin.sourceRef, asOf: fin.quarterEnd });
  }
  if (rows.length === 0) return null;
  const missing =
    line === null
      ? fin?.source === "ncua"
        ? `NCUA reports no ${name} income line; this is all fee income.`
        : `${subjectPossessive(research)} filing has no ${name} income line; this is all deposit service charges.`
      : undefined;
  const actionTitle = line
    ? fin?.latestTtm
      ? `${subjectPossessive(research)} filing shows ${formatDollarsInWords(line.annualIncome)} a year in ${name} income, ${Math.round((line.annualIncome / fin.latestTtm) * 100)}% of all service charges.`
      : `${subjectPossessive(research)} filing shows ${formatDollarsInWords(line.annualIncome)} a year in ${name} income.`
    : `${subjectPossessive(research)} ${fin!.source === "ncua" ? "fee income" : "service charges"} came to ${formatDollarsInWords(fin!.latestTtm!)} in the year to ${longDate(fin!.quarterEnd)}.`;
  return {
    key: "money",
    actionTitle,
    exhibit: { kind: "money_at_stake", title: `What the ${name} fee is worth to ${subjectName(research)}`, rows, sources, note: missing },
  };
}

function trendPiece(research: FeeResearch): Piece | null {
  const fin = research.institutionFinancials;
  if (!fin || fin.quarters.length < 2) return null;
  const series = [{ label: research.institutionName, points: [...fin.quarters].reverse().map((q) => ({ date: q.quarterEnd, value: q.amount })) }];
  if (fin.peerMedian && fin.peerMedian.quarters.length >= 2) {
    series.push({ label: `Median, ${fin.peerMedian.label}`, points: [...fin.peerMedian.quarters].reverse().map((q) => ({ date: q.quarterEnd, value: q.amount })) });
  }
  const what = fin.source === "ncua" ? "fee income" : "service charge income";
  const actionTitle =
    fin.yoyPct != null
      ? `${subjectPossessive(research)} ${what} is ${fin.yoyPct >= 0 ? "up" : "down"} ${Math.abs(fin.yoyPct).toFixed(1)}% on the year to ${longDate(fin.quarterEnd)}.`
      : `${subjectPossessive(research)} ${what} over the last ${count(fin.quarters.length)} quarters, against similar filers.`;
  return {
    key: "trend",
    actionTitle,
    exhibit: { kind: "trend", title: `${subjectPossessive(research)} ${what} by quarter`, unit: "dollars", series, sources: [fin.sourceRef, ...(fin.peerMedian ? [fin.peerMedian.sourceRef] : [])] },
  };
}

// ─── Storyline ───────────────────────────────────────────────────────────────

export function storylineKind(research: FeeResearch, intent: StoryIntent): StorylineKind {
  if (segmentLed(research)) return "segment";
  if ((intent.tested ?? []).length > 0) return "price_test";
  if (intent.wantsDecision) return "board_decision";
  if (intent.structure) return "structure";
  if (intent.focus === "trend") return "trend";
  return "position";
}

const ORDER: Record<StorylineKind, string[]> = {
  position: ["position", "lineup", "rate", "local", "archetype", "structure", "money", "changes"],
  segment: ["segment", "archetype", "structure", "changes", "position", "rate", "money"],
  price_test: ["position", "money", "lineup", "rate", "archetype", "local", "changes"],
  board_decision: ["position", "money", "lineup", "rate", "archetype", "changes", "local", "structure"],
  structure: ["structure", "lineup", "archetype", "position", "rate", "local", "changes"],
  trend: ["trend", "money", "changes", "position", "rate", "local"],
};

function pieces(research: FeeResearch, name: string): Record<string, () => Piece | null> {
  return {
    position: () => positionPiece(research, name),
    segment: () => segmentPiece(research, name),
    largest: () => largestPiece(research, name),
    local: () => localPiece(research, name),
    archetype: () => archetypePiece(research, name),
    structure: () => structurePiece(research),
    lineup: () => lineupPiece(research),
    changes: () => changePiece(research, name),
    money: () => moneyPiece(research, name),
    trend: () => trendPiece(research),
    rate: () => ratePiece(research, name),
  };
}

function keyFigures(research: FeeResearch, name: string): KeyFigure[] {
  const out: KeyFigure[] = [];
  const own = research.ownRows[0];
  const rates = ratesOf(research);
  const rate = ownRate(research);
  if (research.current === null && rates && rate) {
    out.push({ value: formatRatePercent(rate.ratePercent), label: `${subjectPossessive(research)} ${name} rate`, source: ownRateSource(rates, rate, research) });
    if (rates.national.median !== null) {
      out.push({ value: formatRatePercent(rates.national.median), label: "National median rate", source: rates.source, n: rates.national.n });
    }
  }
  if (research.current !== null) {
    out.push({
      value: money(research.current),
      label: `${subjectPossessive(research)} ${name} fee`,
      source: { label: `${subjectPossessive(research)} published fee schedule`, table: "published_fee_catalog", url: own?.documentUrl ?? own?.sourceUrl ?? undefined, asOf: own?.publishedAt?.slice(0, 10) ?? null },
    });
  }
  const seg = research.segment;
  if (seg && seg.problem === null && seg.band) {
    out.push({ value: money(seg.band.median), label: `Median, ${shortSegmentLabel(seg.segment)}`, source: seg.source, n: seg.band.n });
  } else if (research.band && research.band.n >= MIN_PEERS_FOR_POSITION) {
    out.push({ value: money(research.band.median), label: "Peer median", source: feeSource(research), n: research.band.n });
  }
  const position =
    seg && seg.problem === null ? seg.ownPosition : research.current !== null ? pricePosition(research.current, research.peers.map((p) => p.amount)) : null;
  if (position !== null && research.current !== null) {
    out.push({ value: ordinal(position), label: seg && seg.problem === null ? `${subjectPossessive(research)} percentile in the segment` : `${subjectPossessive(research)} percentile among peers`, source: seg && seg.problem === null ? seg.source : feeSource(research), n: seg && seg.problem === null ? seg.band?.n ?? seg.members.length : research.band?.n });
  }
  const line = research.revenueLine;
  const fin = research.institutionFinancials;
  if (line) {
    out.push({ value: formatDollarsInWords(line.annualIncome), label: `${capitalize(name)} income a year, filed`, source: { ...line.source, asOf: line.quarterEnd } });
  } else if (fin?.latestTtm != null) {
    out.push({ value: formatDollarsInWords(fin.latestTtm), label: "Service charges, last four quarters", source: { ...fin.sourceRef, asOf: fin.quarterEnd } });
  }
  return out.slice(0, 4);
}

function complication(research: FeeResearch, name: string): Fact[] {
  const out: Fact[] = [];
  const events = recentEvents(research);
  const state = stateName(research);
  if (events.length > 0 && state) {
    const cuts = events.filter((e) => (e.to as number) < (e.from as number)).length;
    out.push({
      text: `${count(events.length)} ${events.length === 1 ? "institution" : "institutions"} in ${state} changed ${article(name)} ${name} fee in the last ${CHANGE_WINDOW_DAYS} days, ${count(cuts)} of them downward.`,
      source: { label: "Fee changes seen on published schedules", table: "fee_change_records", asOf: events[0].date },
    });
  }
  const fin = research.institutionFinancials;
  if (fin?.yoyPct != null && Math.abs(fin.yoyPct) >= 5) {
    out.push({
      text: `${subjectPossessive(research)} ${fin.source === "ncua" ? "fee income" : "service charge income"} is ${fin.yoyPct >= 0 ? "up" : "down"} ${Math.abs(fin.yoyPct).toFixed(1)}% on the year to ${longDate(fin.quarterEnd)}.`,
      source: { ...fin.sourceRef, asOf: fin.quarterEnd },
    });
  }
  if (out.length < 2) {
    const news = research.regulation.find((r) => r.source.table === "reg_articles");
    if (news) out.push(news);
  }
  return out.slice(0, 2);
}

function financeLens(research: FeeResearch, answer: HamiltonAnswer, intent: StoryIntent): Fact[] {
  const money = answer.claims.filter((c) => c.source.table === "institution_financial_records" || /call report|5300|filing/i.test(c.source.label));
  const rules = research.regulation.filter((r) => r.source.table !== "reg_articles");
  // A regulation question names who regulates the bank, then its fee complaints against peers', then the rules.
  if (intent.regulation) {
    const regulator = rules.filter((r) => r.source.table === "institution_sources");
    const complaints = rules.filter((r) => r.source.table === "institution_complaint_records" && r.sampleSize !== undefined);
    const others = rules.filter((r) => !regulator.includes(r) && r.source.table !== "institution_complaint_records");
    return [...regulator, ...complaints, ...others.slice(0, 2), ...money.slice(0, 1)].slice(0, 4);
  }
  return [...money.slice(0, 4), ...rules.slice(0, 2)].slice(0, 4);
}

/** The group a customer would compare the bank against: the segment asked about, the local market, or peers. */
function customerGroup(research: FeeResearch): { label: string; members: { name: string; amount: number }[]; source: SourceRef } | null {
  const seg = research.segment;
  if (seg && seg.problem === null && seg.members.length > 0) {
    return { label: shortSegmentLabel(seg.segment), members: seg.members.map((m) => ({ name: m.institutionName, amount: m.amount })), source: seg.source };
  }
  const local = research.localCompetitors ?? [];
  if (local.length > 0) {
    return {
      label: "local competitors",
      members: local.map((p) => ({ name: p.institutionName, amount: p.amount })),
      source: research.localMarket?.source ?? feeSource(research),
    };
  }
  if (research.peers.length >= MIN_PEERS_FOR_POSITION) {
    return { label: "peers", members: research.peers.map((p) => ({ name: p.institutionName, amount: p.amount })), source: feeSource(research) };
  }
  return null;
}

export { plainName };

function names(list: { name: string }[], max = 3): string {
  const shown = list.slice(0, max).map((m) => m.name);
  const more = list.length - shown.length;
  if (more > 0) return `${shown.join(", ")} and ${count(more)} more`;
  return shown.length <= 2 ? shown.join(" and ") : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

/**
 * What the exhibits mean for positioning, messaging and competitive response. Each line
 * reads the figures for a product or marketing reader rather than restating an exhibit,
 * and none says what to charge.
 */
/** Where the bank's rate sits against the national middle half, as a customer comparing terms would see it. */
function rateLens(research: FeeResearch): Fact | null {
  const rates = ratesOf(research);
  const own = ownRate(research);
  if (!rates || !own) return null;
  const { n, p25, p75 } = rates.national;
  if (p25 === null || p75 === null) return null;
  const at = `At ${formatRatePercent(own.ratePercent)}, ${subjectName(research)} ${research.subjectName ? "sits" : "sit"}`;
  const half = `the middle half of ${count(n)} institutions (${formatRatePercent(p25)} to ${formatRatePercent(p75)})`;
  const text =
    own.ratePercent > p75
      ? `${at} above ${half}; competitors can claim a lower rate.`
      : own.ratePercent < p25
        ? `${at} below ${half}, a cost point ${subjectName(research)} can make to customers.`
        : `${at} inside ${half}, so on rate alone ${subjectName(research)} ${research.subjectName ? "blends" : "blend"} in.`;
  return { text, source: rates.source, sampleSize: n };
}

function marketLens(research: FeeResearch, name: string): Fact[] {
  const out: Fact[] = [];
  const current = research.current;
  const group = customerGroup(research);
  const rate = rateLens(research);
  if (rate) out.push(rate);

  // Positioning: what a customer comparing side by side would see, by name.
  if (group && current !== null) {
    const cheaper = group.members.filter((m) => m.amount < current).sort((a, b) => a.amount - b.amount);
    const dearer = group.members.filter((m) => m.amount > current);
    const n = group.members.length;
    if (cheaper.length === 0) {
      // Neutral: who is higher, by name, never whether that helps or hurts.
      const highest = [...dearer].sort((a, b) => b.amount - a.amount)[0];
      out.push({
        text: highest
          ? namedWithin(
              `None of the ${count(n)} ${group.label} charge less than ${subjectPossessive(research, false)} ${money(current)}; the highest is ${plainName(highest.name)} (${money(highest.amount)}).`,
              `None of the ${count(n)} ${group.label} charge less than ${subjectPossessive(research, false)} ${money(current)}; the highest charges ${money(highest.amount)}.`,
            )
          : `All ${count(n)} ${group.label} charge the same ${money(current)} ${subjectName(research)} ${research.subjectName ? "does" : "do"}.`,
        source: group.source,
        sampleSize: n,
      });
    } else {
      out.push({
        text: namedWithin(
          `${count(cheaper.length)} of ${count(n)} ${group.label} charge less than ${subjectPossessive(research, false)} ${money(current)}; the lowest is ${plainName(cheaper[0].name)} (${money(cheaper[0].amount)}).`,
          `${count(cheaper.length)} of ${count(n)} ${group.label} charge less than ${subjectPossessive(research, false)} ${money(current)}; the lowest charges ${money(cheaper[0].amount)}.`,
        ),
        source: group.source,
        sampleSize: n,
      });
      if (dearer.length === 0) {
        out.push({
          text: `No one in that group charges more than ${subjectPossessive(research, false)} ${money(current)}.`,
          source: group.source,
          sampleSize: n,
        });
      }
    }
  }

  // Messaging: the price contrast customers meet, from the pricing groups.
  if (group && current !== null && (research.feeCategory === "overdraft" || research.feeCategory === "nsf")) {
    const free = group.members.filter((m) => m.amount === 0);
    const own = archetypeOf(current);
    if (free.length > 0 && own !== "zero_od") {
      out.push({
        text: `${count(free.length)} of them ${free.length === 1 ? "publishes" : "publish"} a $0 ${name} fee (${free.length === 1 ? plainName(free[0].name) : `including ${plainName(free[0].name)}`}), the claim ${subjectPossessive(research, false)} ${money(current)} faces.`,
        source: group.source,
        sampleSize: group.members.length,
      });
    }
  }

  // Structure: how the lower-cost alternative is priced, not only the fee itself.
  const set = research.structure;
  if (set) {
    const others = set.rows.filter((r) => !r.own);
    const ownRow = set.rows.find((r) => r.own);
    const withTransfer = others.filter((r) => r.values.od_protection_transfer !== undefined);
    if (others.length >= MIN_PEERS_FOR_POSITION && withTransfer.length > 0) {
      const ownTransfer = ownRow?.values.od_protection_transfer;
      const transfers = withTransfer.map((r) => r.values.od_protection_transfer).sort((a, b) => a - b);
      const typical = transfers[Math.floor(transfers.length / 2)];
      out.push({
        text:
          ownTransfer !== undefined
            ? `${subjectPossessive(research)} ${money(ownTransfer)} transfer fee is a lower-cost path for customers; ${count(withTransfer.length)} of ${count(others.length)} in the group price one, typically ${money(typical)}.`
            : `${count(withTransfer.length)} of ${count(others.length)} in the group price a transfer from savings, typically ${money(typical)}; ${subjectPossessive(research, false)} schedule in the index shows none.`,
        source: { ...set.source, asOf: set.source.asOf ?? research.provenance.dataAsOf.fees ?? null },
        sampleSize: others.length,
      });
    }
  }

  // Competitive response: which way the market is moving, and who moved last.
  const events = recentEvents(research);
  const state = stateName(research);
  if (events.length > 0 && state) {
    const cuts = events.filter((e) => (e.to as number) < (e.from as number)).length;
    const rises = events.length - cuts;
    const plural = (n: number, one: string, many: string) => `${count(n)} ${n === 1 ? one : many}`;
    const last = events[0];
    out.push({
      text: `In ${state}, ${plural(cuts, "decrease", "decreases")} and ${plural(rises, "increase", "increases")} in ${CHANGE_WINDOW_DAYS} days; latest ${plainName(last.institutionName)}, ${money(last.from as number)} to ${money(last.to as number)} on ${shortDate(last.date)}.`,
      source: { label: "Fee changes seen on published schedules", table: "fee_change_records", asOf: last.date },
      sampleSize: events.length,
    });
  }
  return out.slice(0, 5);
}

function sampleOf(exhibit: Exhibit): number | undefined {
  switch (exhibit.kind) {
    case "competitor_range":
      return exhibit.items.length;
    case "segment_table":
      return exhibit.members.length;
    case "archetype_map":
      return exhibit.archetypes.reduce((s, a) => s + a.count, 0);
    case "structure_matrix":
      return exhibit.rows.filter((r) => !r.own).length;
    default:
      return undefined;
  }
}

/** Where a price would sit, and what the filed income line implies at the same item count. */
function priceConsequences(research: FeeResearch, name: string, price: number): Fact[] {
  const out: Fact[] = [];
  const amounts = research.peers.map((p) => p.amount);
  const position = pricePosition(price, amounts);
  if (position !== null && research.band) {
    out.push({
      text:
        position === 0
          ? `At ${money(price)} no peer of ${count(research.band.n)} would charge less.`
          : `At ${money(price)} ${subjectName(research)} would sit at the ${ordinal(position)} percentile of ${count(research.band.n)} peers.`,
      source: feeSource(research),
      sampleSize: research.band.n,
    });
  }
  if (price === 0 && amounts.length > 0) {
    const zero = amounts.filter((a) => a === 0).length;
    out.push({
      text: zero === 0 ? `None of ${count(amounts.length)} peers publishes a $0 ${name} fee today.` : `${count(zero)} of ${count(amounts.length)} peers publish a $0 ${name} fee today.`,
      source: feeSource(research),
      sampleSize: amounts.length,
    });
  }
  const line = research.revenueLine;
  // A filed line that also holds another fee's income (overdraft with NSF) can't be scaled by this fee's price alone.
  if (line && research.current && !line.combinedWith) {
    const estimate = (line.annualIncome * price) / research.current;
    out.push({
      text: `At today's item count, ${name} income would be about ${formatDollarsInWords(estimate)} a year, against ${formatDollarsInWords(line.annualIncome)} filed.`,
      source: { ...line.source, asOf: line.quarterEnd },
    });
  }
  return out;
}

function options(research: FeeResearch, kind: StorylineKind, intent: StoryIntent, name: string): StoryOption[] | undefined {
  if (kind !== "price_test" && kind !== "board_decision") return undefined;
  if (research.current === null) return undefined;
  const prices: { label: string; price: number }[] = [{ label: `Hold at ${money(research.current)}`, price: research.current }];
  const tested = intent.tested ?? [];
  if (tested.length > 0) {
    for (const t of tested) if (t !== research.current) prices.push({ label: t === 0 ? `Remove the ${name} fee` : `Test ${money(t)}`, price: t });
  } else if (research.band && research.band.n >= MIN_PEERS_FOR_POSITION) {
    if (research.band.median !== research.current) prices.push({ label: `Peer median, ${money(research.band.median)}`, price: research.band.median });
    if (research.current !== 0) prices.push({ label: `Remove the ${name} fee`, price: 0 });
  }
  const out = prices.map((p) => ({ label: p.label, price: p.price, consequences: priceConsequences(research, name, p.price) })).filter((o) => o.consequences.length > 0);
  return out.length > 1 ? out : undefined;
}

function watch(research: FeeResearch, name: string): Fact[] {
  const out: Fact[] = [];
  if (research.current !== null && research.band && research.band.n >= MIN_PEERS_FOR_POSITION) {
    const close = research.peers.filter((p) => p.amount !== research.current && Math.abs(p.amount - research.current!) <= CLOSE_PRICE).length;
    if (close > 0) {
      out.push({
        text: `${count(close)} peers price within ${money(CLOSE_PRICE)} of ${subjectPossessive(research, false)} ${money(research.current)}; a move by any of them shifts ${subjectPossessive(research, false)} percentile.`,
        source: feeSource(research),
        sampleSize: research.band.n,
      });
    }
  }
  if (!research.revenueLine) {
    out.push({
      text: `${subjectPossessive(research)} yearly count of ${name} items would put a dollar range on each price.`,
      source: { label: "Figures you give Hamilton", asOf: research.provenance.generatedAt.slice(0, 10) },
    });
  }
  const news = research.regulation.filter((r) => r.source.table === "reg_articles").slice(0, 1);
  return [...out, ...news].slice(0, 3);
}

export function buildStoryline(research: FeeResearch, answer: HamiltonAnswer, intent: StoryIntent = {}): Storyline | null {
  const name = proseFeeName(research.feeCategory);
  const kind = storylineKind(research, intent);
  const builders = pieces(research, name);
  const chosen: Piece[] = [];
  for (const key of ORDER[kind]) {
    if (chosen.length >= MAX_STORY_EXHIBITS) break;
    const piece = builders[key]?.();
    if (piece) chosen.push(piece);
  }
  if (chosen.length === 0) return null;
  const exhibits: StoryExhibit[] = chosen.map((p, i) => ({
    id: `${kind}-${p.key}`,
    number: i + 1,
    actionTitle: p.actionTitle,
    exhibit: p.exhibit,
    ...(p.takeaway ? { takeaway: p.takeaway } : {}),
  }));
  // Each line appears once: a lens or watch line that repeats the situation is dropped.
  // The situation adds to the governing thought: a claim restating one of its dollar figures is left out.
  const headlineFigures = new Set(answer.headline.match(/\$[\d,.]+\d/g) ?? []);
  const situation = answer.claims
    .filter((c) => c.source.label !== `${subjectPossessive(research)} published fee schedule`)
    .filter((c) => !(c.text.match(/\$[\d,.]+\d/g) ?? []).some((f) => headlineFigures.has(f)))
    .slice(0, 2);
  for (const e of exhibits) {
    if (e.takeaway && situation.some((f) => f.text === e.takeaway!.text)) delete e.takeaway;
  }
  const said = new Set([
    answer.headline,
    ...situation.map((f) => f.text),
    ...exhibits.flatMap((e) => [e.actionTitle, e.takeaway?.text ?? ""]),
  ]);
  const fresh = (facts: Fact[]) =>
    facts.filter((f) => {
      if (said.has(f.text)) return false;
      said.add(f.text);
      return true;
    });
  const complicationFacts = fresh(complication(research, name));
  return {
    kind,
    governingThought: answer.headline,
    // The bank's own fee is the first key figure, so the situation opens with the market.
    situation,
    complication: complicationFacts,
    keyFigures: keyFigures(research, name),
    exhibits,
    lenses: { finance: fresh(financeLens(research, answer, intent)), market: fresh(marketLens(research, name)) },
    defaultView: kind === "price_test" || kind === "board_decision" ? "finance" : "market",
    options: options(research, kind, intent, name),
    watch: fresh(watch(research, name)),
  };
}
