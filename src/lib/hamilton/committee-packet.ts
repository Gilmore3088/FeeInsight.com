/**
 * The pricing committee packet: one quarterly document for a bank's pricing committee. Pure and
 * deterministic; the loader (committee-packet-data.ts) reads the data and this file only arranges it.
 *
 * A two-page executive briefing, then an optional evidence appendix:
 * 1. Executive brief (page one): one evidence-backed conclusion; up to three benchmark differences
 *    selected for review, each with its dollar gap, coverage and every limitation that applies, and
 *    the decision they bear on; the comparisons to resolve before relying on them; and the recommended
 *    next step (investigate, resolve, or retain and monitor) with its rationale. assessFees selects the
 *    largest like-for-like differences by percentage gap from the peers' median, with no category
 *    weight. That shows unusual prices, not business importance: volumes and waivers are not in the
 *    data, so the brief says the impact is unknown and leaves the institution's priorities to it.
 * 2. Supporting exhibits (page two): every fee against the peers, and fee income per $10,000 of assets.
 * 3. Evidence appendix: the full position table, the peer fee changes the peers' own schedules bear
 *    out, the filed income trend, the normalized comparison with its denominator, the peer matrix,
 *    nearest peers, the bank's published amounts, rules, the price-and-yield table, the method and
 *    the numbered sources. The tables back the brief and are never its identity.
 *
 * An analysis with no data is one line under "Not available in this packet", never an empty table.
 * Missing history is never shown as stability: "no change" appears only when two stored quarterly
 * copies were compared. Hamilton is neutral here: the packet describes positions and asks
 * questions; it never recommends a fee.
 */
import { getDisplayName } from "@/lib/fee-taxonomy";
import { readerAsOf } from "./board-brief";
import { plainFeeName } from "./briefing-observations";
import { directionalTitle } from "./workspace/names";
import type { QuarterlyChanges } from "./briefing-snapshots";
import { checkPosition, namedPeers, type PositionCheck, type PositionPeer } from "./position-check";
import { quarterLabel } from "./workspace/briefing-diff";
import { MIN_PEERS_FOR_POSITION, placeAmong } from "./workspace/scenario";
import type { Fact, InstitutionFinancials, PeerValue } from "./workspace/types";

/** Fees in one packet; a longer list stays readable on one printed page. */
export const MAX_PACKET_FEES = 10;
/** Peers listed by name in the appendix matrix; the medians use every peer. */
export const MAX_PACKET_PEER_ROWS = 30;
/** Peer fee changes listed. */
export const MAX_PACKET_CHANGES = 25;
/** Rule, bill and enforcement lines listed. */
export const MAX_PACKET_RULES = 8;
/** Findings in the executive brief. */
export const MAX_PACKET_FINDINGS = 3;
/** The bank's own published rows listed in the appendix. */
export const MAX_PACKET_PRODUCT_ROWS = 40;

export const NOT_PUBLISHED = "Not found in published schedules";
/** The same, in a matrix cell; the matrix note spells it out. */
export const NOT_FOUND = "Not found";
const NOT_FILED = "Not found in filings";
/** A cell with no figure because too few peers publish the fee; the table's note says so. */
export const NOT_PLACED = "–";

export interface PacketOwnRow {
  amount: number | null;
  sourceDocumentId: number | null;
  documentUrl: string | null;
  publishedAt: string | null;
  /** The fee's name as the schedule prints it. */
  feeName?: string | null;
  /** How it is charged, as recorded ("per_item", "monthly"); null when the schedule does not say. */
  frequency?: string | null;
  conditions?: string | null;
}

export interface PacketFeeInput {
  feeCategory: string;
  /** The bank's comparison value (the engine's one value per institution); null when not published. */
  current: number | null;
  /** The peer group this fee was compared with (widened per fee when the first group is thin). */
  peerLabel: string;
  /** The peers' comparison values, the bank left out, with the catalog rows behind each. */
  peers: PeerValue[];
  /** The bank's own live rows for the fee, for its footnote, range and product details. */
  ownRows: PacketOwnRow[];
}

export interface PacketChange {
  institutionId: number;
  institutionName: string;
  feeCategory: string;
  oldAmount: number;
  newAmount: number;
  /** ISO date the change was seen. */
  changedAt: string;
  scheduleUrl: string | null;
}

/** One filer's latest quarter, as `getFeeRevenueData` reads it (thousands of dollars). */
export interface PacketIncomeRow {
  institutionId: number;
  institutionName: string;
  reportDate: string | null;
  source: string | null;
  serviceChargeIncomeThousands: number | null;
  /** Total assets in the same filing, thousands of dollars; the normalized measure's denominator. */
  totalAssetsThousands?: number | null;
  /** The quarter's service charge income per $10,000 of total assets. */
  incomePer10kAssets: number | null;
}

export interface CommitteePacketInput {
  institutionId: number;
  institutionName: string;
  /** When the packet was read (ISO). */
  generatedAt: string;
  /** The peer group from Settings, when the bank set one. */
  peerSetLabel: string | null;
  /** Where the fee list came from. */
  feeListSource: "watchlist" | "published";
  fees: PacketFeeInput[];
  quarterly: QuarterlyChanges | null;
  /** ISO date peer changes are read from. */
  changesSince: string;
  changes: PacketChange[];
  financials: InstitutionFinancials | null;
  rules: Fact[];
  /** Latest-quarter filings for the bank and its peers; rows for other institutions are ignored. */
  income: PacketIncomeRow[];
  /** The fee the price-and-yield table reads; the first fee when not given. */
  yieldFee?: string | null;
}

export interface PacketFootnote {
  n: number;
  label: string;
  detail: string;
  url: string | null;
}

export type PacketTableId =
  | "position"
  | "peer_changes"
  | "income_trend"
  | "normalized_income"
  | "peer_fee_matrix"
  | "nearest_peers"
  | "product_details"
  | "regulatory"
  | "price_and_yield";

/** One table of the packet. Cells are plain text; "[3]" marks a footnote. */
export interface PacketTable {
  id: PacketTableId;
  title: string;
  subtitle: string | null;
  columns: string[];
  rows: string[][];
  note: string | null;
  /** The kinds of source behind the table, for its source line ("published fee schedules"). */
  source: string;
  /** The first row is the research institution's own. */
  ownFirst: boolean;
}

/** A benchmark difference selected for review: the position, its numbers, what it could bear on, its limits. */
export interface PacketFinding {
  feeCategory: string;
  fee: string;
  /** The position in one sentence: "Outgoing domestic wire, at $30, is above all 9 peers." */
  statement: string;
  /** The dollar gap, the middle 50% and coverage, with footnote marks. */
  evidence: string;
  /** Every limitation that applies, printed beside the finding; empty when none. */
  caveats: string[];
}

/** A difference the brief cannot rely on yet: several published amounts or a widened peer group. */
export interface PacketUnresolved {
  feeCategory: string;
  fee: string;
  /** "$4, below all 10 peers". */
  position: string;
  caveats: string[];
}

/** What the committee could do next and why. Never a price change for its own sake. */
export interface PacketNextStep {
  kind: "investigate" | "resolve" | "retain";
  feeCategory: string | null;
  action: string;
  rationale: string;
}

/** One fee as a row of the position chart: the peers' spread, middle 50% and median, and the bank's value. */
export interface PacketFeeBar {
  feeCategory: string;
  name: string;
  /** The bank's comparison value; null when it does not publish the fee or states no single price. */
  current: number | null;
  /** "$15 to $35": the bank's published amounts when it lists the fee with no single price; else null. */
  ownRange: string | null;
  /** Null below MIN_PEERS_FOR_POSITION peers publishing. */
  median: number | null;
  q1: number | null;
  q3: number | null;
  /** The lowest and highest peer values, for the chart's scale; null with no peer publishing. */
  low: number | null;
  high: number | null;
  /** Peers publishing the fee. */
  peers: number;
  band: "above" | "within" | "below" | null;
  /** The wider group the fee was compared with, when it differs from the packet's group. */
  comparedWith: string | null;
  /** Footnote marks for the bank's value and the peers' schedules: "[1, 4]", or "". */
  marks: string;
}

/** The counts behind the packet's key figures. */
export interface PacketGlance {
  fees: number;
  /** Fees the bank publishes. */
  published: number;
  /** Fees with enough peers publishing to place the bank's value. */
  placed: number;
  above: number;
  within: number;
  below: number;
}

/** Filed quarterly income for the trend chart, oldest quarter first, in dollars. */
export interface PacketIncomeSeries {
  quarters: string[];
  own: number[];
  /** The same-charter, same-size median per quarter; null where none was filed. */
  peer: (number | null)[];
  peerLabel: string | null;
}

export interface NormalizedIncome {
  quarter: string;
  /** The bank's own quarter, per $10,000 of total assets; null when it has no such filing. */
  own: number | null;
  ownIncomeThousands: number | null;
  ownAssetsThousands: number | null;
  /** Peers in this packet filing for the same quarter. */
  peersCompared: number;
  median: number | null;
  q1: number | null;
  q3: number | null;
  /** "above all 5 peers", "at the 60th percentile". Null below MIN_PEERS_FOR_POSITION peers. */
  placement: string | null;
  /** The denominator, said in full. */
  definition: string;
}

export interface PriceYieldPoint {
  institutionId: number;
  name: string;
  own: boolean;
  fee: number;
  incomePer10kAssets: number;
  reading: "fee_high_income_low" | "fee_low_income_high" | null;
}

export interface PriceYield {
  feeCategory: string;
  feeName: string;
  quarter: string;
  points: PriceYieldPoint[];
  /** Medians of the compared peers (the bank left out); null below MIN_PEERS_FOR_POSITION. */
  medianFee: number | null;
  medianIncome: number | null;
  peersCompared: number;
  /** The peer group the fee was compared with. */
  peerLabel: string;
}

export interface CommitteePacket {
  title: string;
  institutionId: number;
  institutionName: string;
  generatedAt: string;
  quarter: string;
  peerGroupLabel: string;
  /** The fees in the packet, in its order. */
  feeCategories: string[];
  /** "Fees in this packet: ..." */
  feeListNote: string;
  glance: PacketGlance;
  brief: {
    /** The main conclusion: one sentence, with footnote marks. */
    conclusion: string;
    /** Up to three like-for-like benchmark differences, largest percentage gap first. */
    findings: PacketFinding[];
    /** Differences outside the middle 50% whose comparison is in doubt; kept out of the findings. */
    unresolved: PacketUnresolved[];
    /** What the selected differences bear on, and that their business impact is unknown; null with no findings. */
    impact: string | null;
    nextStep: PacketNextStep | null;
    limitations: string[];
  };
  /** One line per analysis this packet could not include, and why. */
  unavailable: string[];
  position: {
    table: PacketTable;
    changes: PacketTable | null;
    /** "Stored Q3 and Q4 copies compared: ..." when two copies were compared and nothing moved. */
    comparedNote: string | null;
    /** Exhibit 1 as a chart, one row per fee in the packet's order. */
    bars: PacketFeeBar[];
  };
  financial: {
    trend: PacketTable | null;
    trendSummary: string | null;
    series: PacketIncomeSeries | null;
    normalized: NormalizedIncome | null;
    normalizedTable: PacketTable | null;
    /** The one sentence that says what the normalized figure is not. */
    context: string;
  };
  appendix: PacketTable[];
  priceYield: PriceYield | null;
  footnotes: PacketFootnote[];
  method: string[];
}

// ─── Formatting ──────────────────────────────────────────────────────────────

/** A fee: "$35", "$2.50". */
export function packetMoney(value: number): string {
  return Number.isInteger(value)
    ? `$${value.toLocaleString("en-US")}`
    : `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Filed income in dollars, in words: "$8.8 million", "$450,000". */
export function filedDollars(dollars: number): string {
  const abs = Math.abs(dollars);
  if (abs >= 1_000_000_000) return `$${(dollars / 1_000_000_000).toFixed(2)} billion`;
  if (abs >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)} million`;
  return `$${Math.round(dollars).toLocaleString("en-US")}`;
}

/** A placement that starts a cell or sentence: "At the 60th percentile". */
export function capitalize(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

const SCHEDULES = "published fee schedules";
const FILINGS = "FDIC call reports and NCUA 5300 reports";
const SAME = 0.005;

/** A per-$10,000 figure, always to the cent: "$6.10", "$4.00". */
export function per10k(value: number): string {
  return `$${value.toFixed(2)}`;
}

function span(lo: number, hi: number): string {
  return Math.abs(lo - hi) < SAME ? packetMoney(lo) : `${packetMoney(lo)} to ${packetMoney(hi)}`;
}

function quantile(sorted: readonly number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return Math.round((sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)) * 100) / 100;
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  return quantile([...values].sort((a, b) => a - b), 0.5);
}

function refs(numbers: readonly (number | null)[]): string {
  const unique = [...new Set(numbers.filter((n): n is number => n !== null))].sort((a, b) => a - b);
  return unique.length ? `[${unique.join(", ")}]` : "";
}

/** "a, b and c". */
function listOf(items: readonly string[]): string {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function dateSpan(dates: readonly (string | null | undefined)[]): string | null {
  const days = dates.filter((d): d is string => !!d).map((d) => d.slice(0, 10)).sort();
  if (!days.length) return null;
  const first = readerAsOf(days[0]);
  const last = readerAsOf(days[days.length - 1]);
  return first === last ? first : `${first} to ${last}`;
}

/** "2026-Q4" for an ISO date. */
export function quarterOf(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

/** The first day of the quarter before the one `iso` falls in: the window "since last quarter". */
export function previousQuarterStart(iso: string): string {
  const d = new Date(iso);
  const q = Math.floor(d.getUTCMonth() / 3);
  const start = new Date(Date.UTC(d.getUTCFullYear(), (q - 1) * 3, 1));
  return start.toISOString().slice(0, 10);
}

/** "per_item" -> "Per item"; unknown stays "Not stated". */
function chargedAs(frequency: string | null | undefined): string {
  if (!frequency || frequency === "unknown") return "Not stated";
  return capitalize(frequency.replace(/_/g, " "));
}

// ─── Footnotes ───────────────────────────────────────────────────────────────

interface InstitutionSource {
  name: string;
  documentIds: Set<number>;
  urls: string[];
  dates: string[];
}

/** Numbers each source on first use; an institution's schedule gathers every document it cites. */
class Footnotes {
  private order: string[] = [];
  private fixed = new Map<string, Omit<PacketFootnote, "n">>();
  private schedules = new Map<string, InstitutionSource>();

  private number(key: string): number {
    let i = this.order.indexOf(key);
    if (i === -1) {
      this.order.push(key);
      i = this.order.length - 1;
    }
    return i + 1;
  }

  /** A source with a fixed label: a filing, a stored copy, a rule's own page. */
  source(key: string, note: Omit<PacketFootnote, "n">): number {
    if (!this.fixed.has(key)) this.fixed.set(key, note);
    return this.number(key);
  }

  /** An institution's published fee schedule; repeated calls add documents and dates. */
  schedule(institutionId: number, name: string, documentIds: readonly number[], urls: readonly (string | null)[], dates: readonly (string | null)[]): number {
    const key = `schedule:${institutionId}`;
    const entry = this.schedules.get(key) ?? { name, documentIds: new Set<number>(), urls: [], dates: [] };
    for (const id of documentIds) entry.documentIds.add(id);
    for (const url of urls) if (url && !entry.urls.includes(url)) entry.urls.push(url);
    for (const date of dates) if (date) entry.dates.push(date);
    this.schedules.set(key, entry);
    return this.number(key);
  }

  peerSchedule(peer: PeerValue): number {
    return this.schedule(peer.institutionId, peer.institutionName, peer.sourceDocumentIds, peer.documentUrls, [peer.publishedAt]);
  }

  list(): PacketFootnote[] {
    return this.order.map((key, i) => {
      const schedule = this.schedules.get(key);
      if (schedule) {
        // Internal document ids stay out of the reader's text; the link is the reference.
        const published = dateSpan(schedule.dates);
        return {
          n: i + 1,
          label: `${schedule.name}, published fee schedule`,
          detail: published ? `published ${published}` : "publish date not recorded",
          url: schedule.urls[0] ?? null,
        };
      }
      return { n: i + 1, ...(this.fixed.get(key) as Omit<PacketFootnote, "n">) };
    });
  }
}

// ─── Each fee against its peers ──────────────────────────────────────────────

/** The fee's name as the Research and Try a price screens write it ("Overdraft", not "Overdraft (OD)"). */
export function packetFeeName(category: string): string {
  return directionalTitle(category) ?? plainFeeName(getDisplayName(category));
}
const feeName = packetFeeName;

function asPositionPeers(peers: readonly PeerValue[]): PositionPeer[] {
  return peers.map((p) => ({ institutionId: p.institutionId, name: p.institutionName, amount: p.amount, publishedAt: p.publishedAt, documentUrl: p.documentUrls[0] ?? null }));
}

type Band = "above" | "within" | "below";

interface FeeRead {
  fee: PacketFeeInput;
  name: string;
  /** Peers publishing the fee. */
  n: number;
  /** Distinct peers in this packet compared with the same group, the coverage denominator. */
  groupTotal: number;
  q1: number | null;
  med: number | null;
  q3: number | null;
  band: Band | null;
  check: PositionCheck | null;
  /** The bank's own published amounts for the fee. */
  amounts: number[];
  ownMark: number | null;
  peerMark: number | null;
  widened: boolean;
}

/** The group most fees were compared with: the Settings group when set, else the commonest label. */
function mainPeerGroup(input: CommitteePacketInput): string {
  if (input.peerSetLabel) return input.peerSetLabel;
  const counts = new Map<string, number>();
  for (const f of input.fees) counts.set(f.peerLabel, (counts.get(f.peerLabel) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Default peer group";
}

function readFees(input: CommitteePacketInput, notes: Footnotes, group: string): FeeRead[] {
  const groups = new Map<string, Set<number>>();
  for (const f of input.fees) {
    const ids = groups.get(f.peerLabel) ?? new Set<number>();
    for (const p of f.peers) ids.add(p.institutionId);
    groups.set(f.peerLabel, ids);
  }
  return input.fees.map((fee) => {
    const sorted = fee.peers.map((p) => p.amount).sort((a, b) => a - b);
    const n = sorted.length;
    const enough = n >= MIN_PEERS_FOR_POSITION;
    const rows = fee.ownRows.filter((r) => r.amount !== null);
    // A fee listed at several amounts has no comparison value but is still on the schedule: cite it.
    const ownMark = fee.current === null && rows.length === 0
      ? null
      : notes.schedule(
          input.institutionId,
          input.institutionName,
          rows.map((r) => r.sourceDocumentId).filter((d): d is number => d !== null),
          rows.map((r) => r.documentUrl),
          rows.map((r) => r.publishedAt),
        );
    // The peers' schedules are cited only beside a median; a thin fee's peers are in Appendix A.
    const peerMark = enough
      ? notes.source(`peers:${fee.feeCategory}`, {
          label: `${feeName(fee.feeCategory)}: ${n} ${n === 1 ? "peer's" : "peers'"} published fee schedules (${fee.peerLabel})`,
          detail: `published ${dateSpan(fee.peers.map((p) => p.publishedAt)) ?? "on dates not recorded"} · each peer's own schedule is numbered in Appendix A`,
          url: null,
        })
      : null;
    const q1 = enough ? quantile(sorted, 0.25) : null;
    const med = enough ? quantile(sorted, 0.5) : null;
    const q3 = enough ? quantile(sorted, 0.75) : null;
    const check = fee.current !== null && n ? checkPosition(fee.current, asPositionPeers(fee.peers)) : null;
    const band: Band | null = fee.current === null || q1 === null || q3 === null
      ? null
      : fee.current > q3 + SAME ? "above" : fee.current < q1 - SAME ? "below" : "within";
    return {
      fee,
      name: feeName(fee.feeCategory),
      n,
      groupTotal: groups.get(fee.peerLabel)?.size ?? n,
      q1,
      med,
      q3,
      band,
      check,
      amounts: rows.map((r) => r.amount as number),
      ownMark,
      peerMark,
      widened: fee.peerLabel !== group,
    };
  });
}

/** The bank lists the fee, but at several amounts and with no single price to compare (#1930). */
function noSinglePrice(r: FeeRead): boolean {
  return r.fee.current === null && r.amounts.length > 0;
}

/** The bank lists the fee, at one price or several. */
function publishes(r: FeeRead): boolean {
  return r.fee.current !== null || r.amounts.length > 0;
}

/** "$15 to $35": the bank's published amounts for a fee with no single price. */
function ownRangeOf(amounts: number[]): string {
  const lo = Math.min(...amounts);
  const hi = Math.max(...amounts);
  return Math.abs(lo - hi) < SAME ? packetMoney(lo) : span(lo, hi);
}

/** The plain statement for a fee listed with no single price, sourced to Appendix C. */
function unpricedNote(r: FeeRead, institutionName: string): string {
  const k = r.amounts.length;
  return `${institutionName}'s schedule lists ${inText(r.name)} at ${k} ${k === 1 ? "amount" : "amounts"}, ${ownRangeOf(r.amounts)} (Appendix C). With no single price, it is not placed against the peers.`;
}

/**
 * "$32", or "$32 (2 published amounts, $15 to $32)" when the schedule lists several; "$15 to $35
 * (3 published amounts, no single price)" when it lists several and states no single price.
 */
function ownValue(r: FeeRead): string {
  if (noSinglePrice(r)) {
    const k = r.amounts.length;
    return `${ownRangeOf(r.amounts)} (${k} published ${k === 1 ? "amount" : "amounts"}, no single price)`;
  }
  if (r.fee.current === null) return NOT_PUBLISHED;
  const lo = r.amounts.length ? Math.min(...r.amounts) : r.fee.current;
  const hi = r.amounts.length ? Math.max(...r.amounts) : r.fee.current;
  const range = r.amounts.length > 1 && Math.abs(lo - hi) >= SAME ? ` (${r.amounts.length} published amounts, ${span(lo, hi)})` : "";
  return `${packetMoney(r.fee.current)}${range}`;
}

const BAND_TEXT: Record<Band, string> = { above: "Above the middle 50%", within: "Within the middle 50%", below: "Below the middle 50%" };

function positionCell(r: FeeRead): string {
  if (noSinglePrice(r)) return "Not placed: no single price";
  if (!r.band || !r.check || r.check.percentile === null) return "Not placed";
  return `${BAND_TEXT[r.band]}; ${placeAmong(r.check.percentile, r.n, true)}`;
}

function positionTable(input: CommitteePacketInput, reads: FeeRead[], group: string, feeListNote: string): PacketTable {
  const rows = reads.map((r) => [
    r.widened ? `${r.name} (compared with ${r.fee.peerLabel})` : r.name,
    publishes(r) ? `${ownValue(r)} ${refs([r.ownMark])}` : NOT_PUBLISHED,
    r.med === null ? NOT_PLACED : `${packetMoney(r.med)} (${r.n} peers) ${refs([r.peerMark])}`,
    r.q1 === null || r.q3 === null ? NOT_PLACED : span(r.q1, r.q3),
    positionCell(r),
    `${r.n} of ${r.groupTotal} peers publish`,
  ]);
  return {
    id: "position",
    title: `${input.institutionName}'s fees against ${group}`,
    subtitle: feeListNote,
    columns: ["Fee", input.institutionName, "Peer median (N)", "Peers' middle 50%", "Position", "Coverage"],
    rows,
    note: `Overdraft is compared at its highest tier. For any other fee, a peer that publishes several amounts is compared at the median of those amounts; ${input.institutionName}'s own fee at several amounts is shown as a range and not placed. The median and middle 50% are worked out from the peers' values; no institution necessarily charges them. "${NOT_PLACED}": fewer than ${MIN_PEERS_FOR_POSITION} peers publish the fee, so no median or middle 50% is given. Coverage counts the peers in this packet compared with the same group. Nearest peers by name are in Appendix B.`,
    source: SCHEDULES,
    ownFirst: false,
  };
}

// ─── Executive brief ─────────────────────────────────────────────────────────

/** "NSF / returned item": lower case for running text, acronyms kept. */
export function inText(name: string): string {
  return name.split(" ").map((w) => (/^[A-Z]{2,}$/.test(w) ? w : w.toLowerCase())).join(" ");
}

/** Fewer peers than this and one peer's change can move the median; said beside the finding. */
const THIN_PEERS = 8;

function severalAmounts(r: FeeRead): boolean {
  return r.amounts.length > 1 && Math.abs(Math.min(...r.amounts) - Math.max(...r.amounts)) >= SAME;
}

/** A comparison in doubt: the bank's amount or the peer group is not like for like. */
function questionable(r: FeeRead): boolean {
  return severalAmounts(r) || r.widened;
}

/** Where the fee sits, in words: "above all 9 peers", "at the 85th percentile of 10 peers, above the middle 50%". */
function whereItSits(r: FeeRead): string {
  const p = r.check?.percentile ?? null;
  const at = p === null ? "" : placeAmong(p, r.n);
  if (p === 0 || p === 100) return at;
  const side = r.band === "above" ? "above the middle 50%" : r.band === "below" ? "below the middle 50%" : (p ?? 50) >= 50 ? "in the upper half of the middle 50%" : "in the lower half of the middle 50%";
  return `${at}, ${side}`;
}

/** Every limitation on a fee's comparison, in the order a reader should weigh them. */
function caveatsOf(r: FeeRead, group: string): string[] {
  return [
    ...(severalAmounts(r) ? [`The schedule lists ${r.amounts.length} amounts (${span(Math.min(...r.amounts), Math.max(...r.amounts))}); the comparison uses ${packetMoney(r.fee.current as number)}; another product's amount would change the position.`] : []),
    ...(r.widened ? [`Compared with ${r.fee.peerLabel}, because fewer than ${MIN_PEERS_FOR_POSITION} of ${group} publish it.`] : []),
    ...(r.n < THIN_PEERS ? [`Only ${r.n} peers publish it, so one peer's change can move the median.`] : []),
  ];
}

/** "$6 (25%) above the peer median of $24". */
function gapToMedian(r: FeeRead): string {
  const current = r.fee.current as number;
  const med = r.med as number;
  const d = current - med;
  if (Math.abs(d) < SAME) return `at the peer median of ${packetMoney(med)}`;
  const pct = med > 0 ? ` (${Math.round((Math.abs(d) / med) * 100)}%)` : "";
  return `${packetMoney(Math.round(Math.abs(d) * 100) / 100)}${pct} ${d > 0 ? "above" : "below"} the peer median of ${packetMoney(med)}`;
}

/** The gap as a share of the median: the ranking measure, the same for every fee. */
function gapShare(r: FeeRead): number {
  return Math.abs((r.fee.current as number) - (r.med as number)) / Math.max(r.med as number, 0.01);
}

function findingOf(r: FeeRead, group: string): PacketFinding {
  const lower = inText(r.name);
  return {
    feeCategory: r.fee.feeCategory,
    fee: r.name,
    statement: `${capitalize(lower)}, at ${packetMoney(r.fee.current as number)}, is ${whereItSits(r)}.`,
    evidence: `${capitalize(gapToMedian(r))}; middle 50% ${span(r.q1 as number, r.q3 as number)}; ${r.n} of ${r.groupTotal} peers publish it ${refs([r.ownMark, r.peerMark])}`.trim(),
    caveats: caveatsOf(r, group),
  };
}

function investigate(r: FeeRead): PacketNextStep {
  const lower = inText(r.name);
  const amount = packetMoney(r.fee.current as number);
  return r.band === "above"
    ? {
        kind: "investigate",
        feeCategory: r.fee.feeCategory,
        action: `Before the committee weighs the price, compare the ${lower} terms (eligible accounts, waivers, caps) with the nearest peers in Appendix B.`,
        rationale: "Different terms may explain the gap. If the terms match, the committee can decide whether to keep the current price; nothing here requires a change.",
      }
    : {
        kind: "investigate",
        feeCategory: r.fee.feeCategory,
        action: `Check whether the ${amount} ${lower} fee reflects a waiver, a product tier or an out-of-date schedule before the committee weighs the price.`,
        rationale: "If the terms match the peers', the committee can decide whether to keep the current price; nothing here requires a change.",
      };
}

/**
 * The brief. Benchmark differences are the like-for-like fees outside the peers' middle 50%, largest
 * percentage gap first; fees whose comparison is in doubt are listed apart until resolved. The next
 * step follows the evidence: investigate the largest difference, resolve a doubtful one, or, when no
 * comparable fee sits outside the middle 50%, retain the current policy and monitor.
 */
function assessFees(reads: FeeRead[], input: CommitteePacketInput, group: string): Pick<CommitteePacket["brief"], "conclusion" | "findings" | "unresolved" | "impact" | "nextStep"> {
  const placed = reads.filter((r) => r.band !== null && r.check?.percentile !== null && r.check?.percentile !== undefined);
  if (!placed.length) {
    const published = reads.filter(publishes).length;
    return {
      conclusion: `${input.institutionName} publishes ${published} of the ${reads.length} fees in this packet, but none has ${MIN_PEERS_FOR_POSITION} or more peers in ${group} publishing it, so no benchmark difference can be assessed yet.`,
      findings: [],
      unresolved: [],
      impact: null,
      nextStep: null,
    };
  }
  const byGap = (a: FeeRead, b: FeeRead) => gapShare(b) - gapShare(a) || Math.abs((b.fee.current as number) - (b.med as number)) - Math.abs((a.fee.current as number) - (a.med as number));
  const outside = placed.filter((r) => r.band !== "within").sort(byGap);
  const comparable = outside.filter((r) => !questionable(r));
  const doubtful = outside.filter(questionable);
  const selected = comparable.slice(0, MAX_PACKET_FINDINGS);
  const unresolved = doubtful.map((r) => ({
    feeCategory: r.fee.feeCategory,
    fee: capitalize(inText(r.name)),
    position: `${packetMoney(r.fee.current as number)}, ${whereItSits(r)}`,
    caveats: caveatsOf(r, group),
  }));
  const placedCount = `${placed.length} ${placed.length === 1 ? "fee" : "fees"} compared`;
  const doubtNote = (also: string) => (doubtful.length ? ` ${capitalize(listOf(doubtful.map((r) => inText(r.name))))} ${also}${doubtful.length === 1 ? "sits" : "sit"} outside it, but the comparison needs resolving first.` : "");
  if (!selected.length) {
    const retain = !doubtful.length;
    const within = retain ? (placed.length === 1 ? "the one fee compared sits" : `all ${placedCount} sit`) : "every fee that compares like for like sits";
    return {
      conclusion: `On a like-for-like basis, ${within} within the peers' middle 50%.${doubtNote("")}`,
      findings: [],
      unresolved,
      impact: null,
      nextStep: retain
        ? {
            kind: "retain",
            feeCategory: null,
            action: "Retain the current fee policy and monitor these positions at the next review.",
            rationale: `Every fee compared sits within the peers' middle 50%, so the benchmark gives no reason to revisit a price.`,
          }
        : {
            kind: "resolve",
            feeCategory: doubtful[0].fee.feeCategory,
            action: `Resolve the ${inText(doubtful[0].name)} comparison before the committee relies on it: ${caveatsOf(doubtful[0], group)[0].charAt(0).toLowerCase()}${caveatsOf(doubtful[0], group)[0].slice(1)}`,
            rationale: "Every other fee compared sits within the peers' middle 50%; this is the only difference left to check.",
          },
    };
  }
  const top = selected[0];
  return {
    conclusion: `On a like-for-like basis, ${comparable.length} of the ${placedCount} ${comparable.length === 1 ? "sits" : "sit"} outside the peers' middle 50%. The largest benchmark difference selected for review is ${inText(top.name)}: ${packetMoney(top.fee.current as number)}, ${gapToMedian(top)} ${refs([top.ownMark, top.peerMark])}.`.replace(/ \.(?= |$)/, "."),
    findings: selected.map((r) => findingOf(r, group)),
    unresolved,
    impact: "Each bears on whether the fee is kept or revisited at the next review. Business impact is unknown: the brief does not show how often each fee is charged or waived.",
    nextStep: investigate(top),
  };
}

// ─── What moved ──────────────────────────────────────────────────────────────

function movesTable(input: CommitteePacketInput, notes: Footnotes): { table: PacketTable | null; comparedNote: string | null; unavailable: string[] } {
  const rows: string[][] = [];
  const unavailable: string[] = [];
  const q = input.quarterly;
  let compared: string | null = null;
  let comparedNote: string | null = null;
  if (q?.kind === "diff") {
    const from = notes.source(`snapshot:${q.diff.fromQuarter}`, {
      label: `Hamilton's stored quarterly briefing for ${input.institutionName}, ${quarterLabel(q.diff.fromQuarter)}`,
      detail: `saved ${readerAsOf(q.diff.fromGeneratedAt)} · peers ${q.diff.fromPeerLabel}`,
      url: null,
    });
    const to = notes.source(`snapshot:${q.diff.toQuarter}`, {
      label: `Hamilton's stored quarterly briefing for ${input.institutionName}, ${quarterLabel(q.diff.toQuarter)}`,
      detail: `saved ${readerAsOf(q.diff.toGeneratedAt)} · peers ${q.diff.toPeerLabel}`,
      url: null,
    });
    compared = `${quarterLabel(q.diff.fromQuarter)} and ${quarterLabel(q.diff.toQuarter)}`;
    for (const change of q.diff.changes) {
      rows.push(["Stored quarterly copies", change.feeCategory ? feeName(change.feeCategory) : "Fee income", change.text, `${quarterLabel(q.diff.fromQuarter)} to ${quarterLabel(q.diff.toQuarter)}`, refs([from, to])]);
    }
    // Two copies were compared and nothing moved: that is a result, and it is said as one.
    if (!q.diff.changes.length) comparedNote = `Stored ${compared} quarterly copies compared: no change recorded between them in ${input.institutionName}'s fees, its peer medians or its filed income ${refs([from, to])}.`;
  } else if (q?.kind === "first") {
    unavailable.push(`Quarter-on-quarter changes: Hamilton has one stored copy (${quarterLabel(q.quarter)}); the comparison starts next quarter.`);
  } else {
    unavailable.push(`Quarter-on-quarter changes: Hamilton holds no stored quarterly copy for ${input.institutionName} yet; the comparison starts once two exist.`);
  }
  const inPacket = new Set(input.fees.map((f) => f.feeCategory));
  const peerIds = new Set(input.fees.flatMap((f) => f.peers.map((p) => p.institutionId)));
  const changes = input.changes
    .filter((c) => peerIds.has(c.institutionId) && inPacket.has(c.feeCategory) && Math.abs(c.oldAmount - c.newAmount) >= SAME)
    .sort((a, b) => b.changedAt.localeCompare(a.changedAt))
    .slice(0, MAX_PACKET_CHANGES);
  for (const c of changes) {
    const n = notes.source(`change:${c.institutionId}:${c.scheduleUrl ?? c.changedAt}`, {
      label: `${c.institutionName}, published fee schedule, earlier and later copies`,
      detail: `change seen ${readerAsOf(c.changedAt.slice(0, 10))}; both copies bear it out`,
      url: c.scheduleUrl,
    });
    const direction = c.newAmount > c.oldAmount ? "higher" : "lower";
    rows.push([c.institutionName, feeName(c.feeCategory), `${packetMoney(c.oldAmount)} to ${packetMoney(c.newAmount)} (${packetMoney(Math.round(Math.abs(c.newAmount - c.oldAmount) * 100) / 100)} ${direction})`, readerAsOf(c.changedAt.slice(0, 10)), refs([n])]);
  }
  if (!changes.length) {
    unavailable.push(`Peer fee changes since ${readerAsOf(input.changesSince)}: Hamilton holds no confirmed change for these fees and peers. A peer whose schedule has been read only once has nothing to compare, so this is not evidence that peer fees held steady.`);
  }
  const table: PacketTable | null = rows.length
    ? {
        id: "peer_changes",
        title: `What moved since ${readerAsOf(input.changesSince)}`,
        subtitle: compared ? `Peer fee changes, and the stored ${compared} quarterly copies compared.` : "Peer fee changes that the peers' own schedules bear out.",
        columns: ["Institution or comparison", "Fee", "Change", "When", "Source"],
        rows,
        note: "A peer's change is listed only when its own earlier and later schedules both bear it out, and only for the fees and peers in this packet.",
        source: compared ? `Hamilton's stored quarterly copies and ${SCHEDULES}` : SCHEDULES,
        ownFirst: false,
      }
    : null;
  return { table, comparedNote, unavailable };
}

// ─── Financial context ───────────────────────────────────────────────────────

function trendTable(input: CommitteePacketInput, notes: Footnotes): { table: PacketTable | null; summary: string | null } {
  const f = input.financials;
  if (!f || !f.quarters.length) return { table: null, summary: null };
  const own = notes.source(`filing:${input.institutionId}`, {
    label: `${input.institutionName}, ${f.label}`,
    detail: `quarters ending ${dateSpan(f.quarters.map((q) => q.quarterEnd)) ?? readerAsOf(f.quarterEnd)}`,
    url: null,
  });
  const peer = f.peerMedian
    ? notes.source(`filing-peers:${f.peerMedian.label}`, {
        label: f.peerMedian.sourceRef.label.replace(f.peerMedian.label, `${f.peerMedian.label.charAt(0).toLowerCase()}${f.peerMedian.label.slice(1)}`),
        detail: `quarters ending ${dateSpan(f.peerMedian.quarters.map((q) => q.quarterEnd)) ?? "dates not recorded"}`,
        url: null,
      })
    : null;
  const peerBy = new Map((f.peerMedian?.quarters ?? []).map((q) => [q.quarterEnd, q]));
  const rows = f.quarters.map((q) => {
    const p = peerBy.get(q.quarterEnd);
    return [
      readerAsOf(q.quarterEnd),
      `${filedDollars(q.amount)} [${own}]`,
      p && peer ? `${filedDollars(p.amount)} (median of ${p.institutions.toLocaleString("en-US")} filers) [${peer}]` : NOT_FILED,
    ];
  });
  const summary = f.latestTtm !== null
    ? `Four quarters to ${readerAsOf(f.quarterEnd)}: ${filedDollars(f.latestTtm)}${f.yoyPct !== null ? `, ${Math.abs(f.yoyPct).toFixed(1)}% ${f.yoyPct >= 0 ? "higher" : "lower"} than the four before` : ""} [${own}].`
    : `Fewer than four quarters on file to ${readerAsOf(f.quarterEnd)}, so no four-quarter total is given.`;
  return {
    summary,
    table: {
      id: "income_trend",
      title: "Filed deposit service charge income, quarter by quarter",
      subtitle: f.peerMedian ? `Against the median of ${f.peerMedian.label.charAt(0).toLowerCase()}${f.peerMedian.label.slice(1)} (same charter and size), each quarter on its own.` : "Each quarter on its own.",
      columns: ["Quarter ending", input.institutionName, f.peerMedian ? `Median, ${f.peerMedian.label}` : "Same charter and size"],
      rows,
      note: "Whole-institution income as filed, in dollars; not the income from any one fee. Raw dollars across a size band are context only: a larger filer earns more without charging more.",
      source: FILINGS,
      ownFirst: false,
    },
  };
}

const NORMALIZED_CONTEXT = "This is context, not a measure of pricing effectiveness, customer burden or revenue opportunity: total assets are not deposit accounts, and the income covers every deposit service charge, not any one fee.";

function normalizedIncome(input: CommitteePacketInput, notes: Footnotes): { value: NormalizedIncome | null; table: PacketTable | null; mark: number | null } {
  const income = new Map(input.income.map((r) => [r.institutionId, r]));
  const own = income.get(input.institutionId);
  const peerIds = new Set(input.fees.flatMap((f) => f.peers.map((p) => p.institutionId)));
  peerIds.delete(input.institutionId);
  // The bank's own quarter, else the quarter most of its peers last filed.
  const counts = new Map<string, number>();
  for (const id of peerIds) {
    const d = income.get(id)?.reportDate;
    if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const quarter = own?.reportDate ?? [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]?.[0] ?? null;
  if (!quarter) return { value: null, table: null, mark: null };
  const peers = [...peerIds]
    .map((id) => income.get(id))
    .filter((r): r is PacketIncomeRow => !!r && r.reportDate === quarter && r.incomePer10kAssets !== null)
    .map((r) => r.incomePer10kAssets as number)
    .sort((a, b) => a - b);
  const enough = peers.length >= MIN_PEERS_FOR_POSITION;
  const ownValue = own && own.reportDate === quarter ? own.incomePer10kAssets : null;
  const definition = `Deposit service charge income for the quarter ending ${readerAsOf(quarter)}, divided by total assets in the same filing, times 10,000. Denominator: total assets as filed, not deposits. Peers: the institutions in this packet that filed for the same quarter.`;
  const value: NormalizedIncome = {
    quarter,
    own: ownValue,
    ownIncomeThousands: own?.serviceChargeIncomeThousands ?? null,
    ownAssetsThousands: own?.totalAssetsThousands ?? null,
    peersCompared: peers.length,
    median: enough ? quantile(peers, 0.5) : null,
    q1: enough ? quantile(peers, 0.25) : null,
    q3: enough ? quantile(peers, 0.75) : null,
    placement: enough && ownValue !== null ? checkPosition(ownValue, peers.map((amount, i) => ({ institutionId: i, name: String(i), amount }))).placement : null,
    definition,
  };
  if (ownValue === null || !enough) return { value, table: null, mark: null };
  const mark = notes.source(`income:${quarter}`, {
    label: "FDIC call reports and NCUA 5300 reports, deposit service charge income and total assets",
    detail: `quarter ending ${readerAsOf(quarter)}; NCUA year-to-date income less the prior quarter`,
    url: null,
  });
  const rows = [
    [input.institutionName, `${per10k(ownValue)} [${mark}]`],
    ...(value.ownIncomeThousands !== null ? [["Its service charge income, quarter", `${filedDollars(value.ownIncomeThousands * 1000)} [${mark}]`]] : []),
    ...(value.ownAssetsThousands ? [["Its total assets (the denominator)", `${filedDollars(value.ownAssetsThousands * 1000)} [${mark}]`]] : []),
    [`Peer median (${peers.length} peers)`, `${per10k(value.median as number)} [${mark}]`],
    ["Peers' middle 50%", `${per10k(value.q1 as number)} to ${per10k(value.q3 as number)} [${mark}]`],
    ["Position", capitalize(value.placement ?? "Not placed")],
  ];
  return {
    value,
    mark,
    table: {
      id: "normalized_income",
      title: "Service charge income per $10,000 of total assets",
      subtitle: definition,
      columns: ["Measure", `Quarter ending ${readerAsOf(quarter)}`],
      rows,
      // The context sentence is shown once, before the table (financial.context).
      note: null,
      source: FILINGS,
      ownFirst: true,
    },
  };
}

// ─── Appendix ────────────────────────────────────────────────────────────────

function matrixTable(input: CommitteePacketInput, reads: FeeRead[], notes: Footnotes): PacketTable | null {
  const peers = new Map<number, { name: string; values: Map<string, PeerValue> }>();
  for (const fee of input.fees) {
    for (const p of fee.peers) {
      const entry = peers.get(p.institutionId) ?? { name: p.institutionName, values: new Map() };
      entry.values.set(fee.feeCategory, p);
      peers.set(p.institutionId, entry);
    }
  }
  if (!peers.size) return null;
  const ranked = [...peers.entries()].sort((a, b) => b[1].values.size - a[1].values.size || a[1].name.localeCompare(b[1].name));
  const shown = ranked.slice(0, MAX_PACKET_PEER_ROWS);
  const ownMarks = reads.map((r) => r.ownMark);
  const ownRow = [
    input.institutionName,
    ...reads.map((r) => (noSinglePrice(r) ? ownRangeOf(r.amounts) : r.fee.current === null ? NOT_FOUND : packetMoney(r.fee.current))),
    refs(ownMarks) || NOT_FOUND,
  ];
  const rows = shown.map(([id, entry]) => {
    const values = [...entry.values.values()];
    const n = notes.schedule(id, entry.name, values.flatMap((v) => v.sourceDocumentIds), values.flatMap((v) => v.documentUrls), values.map((v) => v.publishedAt));
    return [entry.name, ...input.fees.map((f) => {
      const v = entry.values.get(f.feeCategory);
      return v ? packetMoney(v.amount) : NOT_FOUND;
    }), refs([n])];
  });
  return {
    id: "peer_fee_matrix",
    title: "Each peer's published fees",
    subtitle: ranked.length > shown.length
      ? `${shown.length} of ${ranked.length} peers, those publishing the most of these fees first. Every peer counts in the medians.`
      : `${ranked.length} ${ranked.length === 1 ? "peer" : "peers"}, those publishing the most of these fees first; ${input.institutionName} first.`,
    columns: ["Institution", ...input.fees.map((f) => feeName(f.feeCategory)), "Source"],
    rows: [ownRow, ...rows],
    note: `"${NOT_FOUND}": the fee is not found in that institution's published schedule in the index. It is never read as $0.${reads.some(noSinglePrice) ? ` A range in ${input.institutionName}'s row means its schedule lists several amounts for the fee, so the fee is not placed.` : ""}`,
    source: SCHEDULES,
    ownFirst: true,
  };
}

/** "$30: Example Savings Bank [4]": the neighbours on one side, each with its footnote. */
function neighbourCell(side: PositionCheck["below"], notes: Footnotes, byId: Map<number, PeerValue>, empty: string): string {
  if (!side) return empty;
  const marks = side.peers.map((p) => {
    const peer = byId.get(p.institutionId);
    return peer ? notes.peerSchedule(peer) : null;
  });
  return `${packetMoney(side.amount)}: ${namedPeers(side.peers)} ${refs(marks)}`.trim();
}

function nearestTable(input: CommitteePacketInput, reads: FeeRead[], notes: Footnotes): PacketTable | null {
  const placed = reads.filter((r) => r.check);
  if (!placed.length) return null;
  const rows = placed.map((r) => {
    const check = r.check as PositionCheck;
    const byId = new Map(r.fee.peers.map((p) => [p.institutionId, p]));
    return [
      r.name,
      `${packetMoney(r.fee.current as number)} ${refs([r.ownMark])}`,
      neighbourCell(check.below, notes, byId, "No peer publishes less"),
      neighbourCell(check.above, notes, byId, "No peer publishes more"),
      `${check.less} lower, ${check.same} the same, ${check.more} higher`,
    ];
  });
  return {
    id: "nearest_peers",
    title: "Nearest peers on each side",
    subtitle: `"This institution" is ${input.institutionName}. The peers whose published value sits just below and just above it, by name.`,
    columns: ["Fee", "This institution", "Nearest below", "Nearest above", "Peers' amounts"],
    rows,
    note: "Named peers are those at the nearest published amount on each side; further peers at that amount are counted.",
    source: SCHEDULES,
    ownFirst: false,
  };
}

function productTable(input: CommitteePacketInput, reads: FeeRead[]): PacketTable | null {
  const rows: string[][] = [];
  // The schedule's own wording when every row carries it; otherwise the index's display names.
  const listed = reads.flatMap((r) => r.fee.ownRows.filter((row) => row.amount !== null));
  const ownWording = listed.length > 0 && listed.every((row) => row.feeName?.trim());
  for (const r of reads) {
    for (const row of r.fee.ownRows) {
      if (row.amount === null || rows.length >= MAX_PACKET_PRODUCT_ROWS) continue;
      rows.push([
        r.name,
        ownWording ? (row.feeName as string).trim() : capitalize(inText(r.name)),
        packetMoney(row.amount),
        chargedAs(row.frequency),
        row.conditions?.trim() || "None stated",
        refs([r.ownMark]),
      ]);
    }
  }
  if (!rows.length) return null;
  return {
    id: "product_details",
    title: "Published amounts behind each fee",
    subtitle: `Every live row on ${input.institutionName}'s published schedule behind the comparison value.`,
    columns: ["Fee", ownWording ? "Name on the schedule" : "Listed in the index as", "Amount", "Charged", "Conditions", "Source"],
    rows,
    note: "Overdraft is compared at its highest tier. Any other fee listed here at several amounts has one row per amount and is not placed against the peers.",
    source: SCHEDULES,
    ownFirst: false,
  };
}

function rulesTable(input: CommitteePacketInput, notes: Footnotes): PacketTable | null {
  const seen = new Set<string>();
  const rows: string[][] = [];
  for (const fact of input.rules) {
    if (seen.has(fact.text) || rows.length >= MAX_PACKET_RULES) continue;
    seen.add(fact.text);
    const n = notes.source(`rule:${fact.source.url ?? fact.text}`, {
      label: fact.source.label,
      detail: fact.source.asOf ? `dated ${readerAsOf(fact.source.asOf)}` : "date not recorded",
      url: fact.source.url ?? null,
    });
    rows.push([fact.text, fact.source.asOf ? readerAsOf(fact.source.asOf) : "Not recorded", refs([n])]);
  }
  if (!rows.length) return null;
  return {
    id: "regulatory",
    title: "Rules, bills and enforcement actions",
    subtitle: "Federal rules on these fees, the state's fee bills and consumer-law enforcement actions, as each agency or legislature published them.",
    columns: ["Item", "Date", "Source"],
    rows,
    note: "Listed, not interpreted. Only items whose topics bear on the fees in this packet appear.",
    source: "the Federal Register, state legislatures via Open States, and federal and state enforcement action lists",
    ownFirst: false,
  };
}

/** Each peer's published fee beside its filed fee income, in one filing quarter. */
export function priceAndYield(input: CommitteePacketInput): PriceYield | null {
  const fee = input.fees.find((f) => f.feeCategory === input.yieldFee) ?? input.fees[0];
  if (!fee) return null;
  const income = new Map(input.income.map((r) => [r.institutionId, r]));
  const own = income.get(input.institutionId);
  // One quarter only: the bank's own, else the quarter most of its peers last filed.
  const counts = new Map<string, number>();
  for (const p of fee.peers) {
    const d = income.get(p.institutionId)?.reportDate;
    if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const quarter = own?.reportDate ?? [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]?.[0] ?? null;
  if (!quarter) return null;
  const point = (id: number, name: string, amount: number, isOwn: boolean): PriceYieldPoint | null => {
    const row = income.get(id);
    if (!row || row.reportDate !== quarter || row.incomePer10kAssets === null) return null;
    return { institutionId: id, name, own: isOwn, fee: amount, incomePer10kAssets: row.incomePer10kAssets, reading: null };
  };
  const peers = fee.peers.map((p) => point(p.institutionId, p.institutionName, p.amount, false)).filter((p): p is PriceYieldPoint => p !== null);
  const self = fee.current !== null ? point(input.institutionId, input.institutionName, fee.current, true) : null;
  const enough = peers.length >= MIN_PEERS_FOR_POSITION;
  const medianFee = enough ? median(peers.map((p) => p.fee)) : null;
  const medianIncome = enough ? median(peers.map((p) => p.incomePer10kAssets)) : null;
  const read = (p: PriceYieldPoint): PriceYieldPoint => {
    if (medianFee === null || medianIncome === null) return p;
    if (p.fee > medianFee + SAME && p.incomePer10kAssets < medianIncome) return { ...p, reading: "fee_high_income_low" };
    if (p.fee < medianFee - SAME && p.incomePer10kAssets > medianIncome) return { ...p, reading: "fee_low_income_high" };
    return p;
  };
  return {
    feeCategory: fee.feeCategory,
    feeName: feeName(fee.feeCategory),
    quarter,
    points: [...(self ? [read(self)] : []), ...peers.map(read).sort((a, b) => b.fee - a.fee || a.name.localeCompare(b.name))],
    medianFee,
    medianIncome,
    peersCompared: peers.length,
    peerLabel: fee.peerLabel,
  };
}

/** The price-and-yield table's main limitation; the screen shows it before the chart. */
export const PRICE_YIELD_LIMIT = "Income is the whole institution's deposit service charge income, not this fee's.";

export const READING_TEXT: Record<NonNullable<PriceYieldPoint["reading"]>, string> = {
  fee_high_income_low: "Fee above the peer median, income below it",
  fee_low_income_high: "Fee below the peer median, income above it",
};

function priceYieldTable(input: CommitteePacketInput, py: PriceYield | null, notes: Footnotes): PacketTable | null {
  if (!py || py.points.length < 2) return null;
  const fee = input.fees.find((f) => f.feeCategory === py.feeCategory);
  const filing = notes.source(`income:${py.quarter}`, {
    label: "FDIC call reports and NCUA 5300 reports, deposit service charge income and total assets",
    detail: `quarter ending ${readerAsOf(py.quarter)}; NCUA year-to-date income less the prior quarter`,
    url: null,
  });
  const rows = py.points.map((p) => {
    const peer = fee?.peers.find((v) => v.institutionId === p.institutionId);
    const feeNote = p.own
      ? notes.schedule(input.institutionId, input.institutionName, [], [], [])
      : peer ? notes.peerSchedule(peer) : null;
    const row = input.income.find((r) => r.institutionId === p.institutionId);
    return [
      p.name,
      `${packetMoney(p.fee)}${feeNote ? ` [${feeNote}]` : ""}`,
      row?.serviceChargeIncomeThousands != null ? `${filedDollars(row.serviceChargeIncomeThousands * 1000)} [${filing}]` : NOT_FILED,
      `${per10k(p.incomePer10kAssets)} [${filing}]`,
      p.reading ? READING_TEXT[p.reading] : "",
    ];
  });
  const medians = py.medianFee !== null && py.medianIncome !== null
    ? `Peer medians: fee ${packetMoney(py.medianFee)} and income ${per10k(py.medianIncome)} per $10,000 of total assets, each the median of ${py.peersCompared} peers (${py.peerLabel}).`
    : `Fewer than ${MIN_PEERS_FOR_POSITION} peers have both figures (${py.peersCompared}), so no medians are given.`;
  return {
    id: "price_and_yield",
    title: `${py.feeName}: published fee beside filed fee income`,
    subtitle: `Filings for the quarter ending ${readerAsOf(py.quarter)}. ${medians}`,
    columns: ["Institution", py.feeName, "Service charge income, quarter", "Income per $10,000 of total assets", "Against the peer medians"],
    rows,
    note: `${PRICE_YIELD_LIMIT} Peers filing for another quarter are left out. The pairing describes where institutions sit; it does not show that one fee drives income.`,
    source: `${SCHEDULES} and FDIC/NCUA filings`,
    ownFirst: py.points[0]?.own ?? false,
  };
}

// ─── The packet ──────────────────────────────────────────────────────────────

export function buildCommitteePacket(input: CommitteePacketInput): CommitteePacket {
  const notes = new Footnotes();
  const quarter = quarterOf(input.generatedAt);
  const group = mainPeerGroup(input);
  const feeListNote = input.feeListSource === "watchlist"
    ? "Fees in this packet: the fees saved on your watchlist."
    : `Fees in this packet: the institution's published fees, overdraft and NSF first (up to ${MAX_PACKET_FEES}).`;

  // Reading order sets the footnote numbers: competitive position, financial context, appendix.
  const reads = readFees(input, notes, group);
  const position = positionTable(input, reads, group, feeListNote);
  const moves = movesTable(input, notes);
  const trend = trendTable(input, notes);
  const normalized = normalizedIncome(input, notes);
  const matrix = matrixTable(input, reads, notes);
  const nearest = nearestTable(input, reads, notes);
  const products = productTable(input, reads);
  const rules = rulesTable(input, notes);
  const py = priceAndYield(input);
  const pyTable = priceYieldTable(input, py, notes);

  // Executive brief.
  const placed = reads.filter((r) => r.band !== null);
  const inside = placed.filter((r) => r.band === "within");
  const assessment = assessFees(reads, input, group);

  const thin = reads.filter((r) => r.fee.current !== null && r.n < MIN_PEERS_FOR_POSITION);
  const missing = reads.filter((r) => !publishes(r));
  const unpriced = reads.filter(noSinglePrice);
  const widened = reads.filter((r) => r.widened);
  const several = reads.filter((r) => r.fee.current !== null && severalAmounts(r));
  const q = input.quarterly;
  const limitations = [
    ...(thin.length ? [`Coverage: fewer than ${MIN_PEERS_FOR_POSITION} peers publish ${listOf(thin.map((r) => inText(r.name)))}, so ${thin.length === 1 ? "it is" : "they are"} not placed.`] : []),
    ...(missing.length ? [`Coverage: ${listOf(missing.map((r) => inText(r.name)))} ${missing.length === 1 ? "is" : "are"} not on ${input.institutionName}'s published schedule in the index.`] : []),
    ...(widened.length ? [`Peer group: ${listOf(widened.map((r) => inText(r.name)))} ${widened.length === 1 ? "was" : "were"} compared with a wider group, named in its row, because fewer than ${MIN_PEERS_FOR_POSITION} of ${group} publish ${widened.length === 1 ? "it" : "them"}.`] : []),
    q?.kind === "diff"
      ? `History: two stored quarterly copies (${quarterLabel(q.diff.fromQuarter)} and ${quarterLabel(q.diff.toQuarter)}); earlier quarters are not compared.`
      : `History: ${q?.kind === "first" ? "one stored quarterly copy" : "no stored quarterly copy"}, so this packet shows positions today and no quarter-on-quarter movement.`,
    `Comparability: each institution counts once per fee; product tiers, waivers and conditions differ between schedules and are not matched${several.length ? `. ${capitalize(listOf(several.map((r) => inText(r.name))))} ${several.length === 1 ? "has" : "have"} several published amounts at ${input.institutionName} (Appendix C)` : ""}.${unpriced.map((r) => ` ${unpricedNote(r, input.institutionName)}`).join("")} Fees stated as a rate are left out.`,
    ...(input.financials || normalized.value ? ["Income: filed income is the whole institution's deposit service charge income; it does not show the income from any one fee."] : []),
  ];

  const unavailable = [
    ...moves.unavailable,
    ...(trend.table ? [] : [`Filed fee income trend: no FDIC call report or NCUA 5300 service charge income on file for ${input.institutionName}.`]),
    ...(normalized.table
      ? []
      : [!normalized.value
          ? "Service charge income per $10,000 of total assets: no filing on file for this institution or its peers in this packet."
          : normalized.value.own === null
            ? `Service charge income per $10,000 of total assets: ${input.institutionName} has no filing with both figures for the quarter ending ${readerAsOf(normalized.value.quarter)}.`
            : `Service charge income per $10,000 of total assets: ${normalized.value.peersCompared} of this packet's peers filed for the quarter ending ${readerAsOf(normalized.value.quarter)}; a peer comparison needs ${MIN_PEERS_FOR_POSITION}.`]),
    ...(rules ? [] : ["Rules, bills and enforcement actions: none on file that bear on these fees."]),
    ...(matrix ? [] : ["Peer fee matrix: no peer in the group publishes any of these fees."]),
    ...(pyTable ? [] : ["Published fee beside filed income: fewer than two institutions have both a published fee and a filing for the same quarter."]),
  ];

  const bars: PacketFeeBar[] = reads.map((r) => {
    const values = r.fee.peers.map((p) => p.amount);
    return {
      feeCategory: r.fee.feeCategory,
      name: r.name,
      current: r.fee.current,
      ownRange: noSinglePrice(r) ? ownRangeOf(r.amounts) : null,
      median: r.med,
      q1: r.q1,
      q3: r.q3,
      low: values.length ? Math.min(...values) : null,
      high: values.length ? Math.max(...values) : null,
      peers: r.n,
      band: r.band,
      comparedWith: r.widened ? r.fee.peerLabel : null,
      marks: refs([r.ownMark, r.peerMark]),
    };
  });
  const f = input.financials;
  const series: PacketIncomeSeries | null = f && f.quarters.length > 1
    ? (() => {
        const oldestFirst = [...f.quarters].reverse();
        const peerBy = new Map((f.peerMedian?.quarters ?? []).map((q) => [q.quarterEnd, q.amount]));
        return {
          quarters: oldestFirst.map((q) => quarterOf(q.quarterEnd)),
          own: oldestFirst.map((q) => q.amount),
          peer: oldestFirst.map((q) => peerBy.get(q.quarterEnd) ?? null),
          peerLabel: f.peerMedian?.label ?? null,
        };
      })()
    : null;

  const appendix = [matrix, nearest, products, rules, pyTable].filter((t): t is PacketTable => t !== null);
  return {
    title: `Pricing committee brief: ${input.institutionName}, ${quarterLabel(quarter)}`,
    institutionId: input.institutionId,
    institutionName: input.institutionName,
    generatedAt: input.generatedAt,
    quarter,
    peerGroupLabel: input.peerSetLabel ?? input.fees[0]?.peerLabel ?? "Default peer group",
    feeCategories: input.fees.map((f) => f.feeCategory),
    feeListNote,
    glance: {
      fees: reads.length,
      published: reads.filter(publishes).length,
      placed: placed.length,
      above: placed.filter((r) => r.band === "above").length,
      within: inside.length,
      below: placed.filter((r) => r.band === "below").length,
    },
    brief: { ...assessment, limitations },
    unavailable,
    position: { table: position, changes: moves.table, comparedNote: moves.comparedNote, bars },
    financial: {
      trend: trend.table,
      trendSummary: trend.summary,
      series,
      normalized: normalized.value,
      normalizedTable: normalized.table,
      context: NORMALIZED_CONTEXT,
    },
    appendix,
    priceYield: py,
    footnotes: notes.list(),
    method: [
      input.peerSetLabel
        ? `Peers: the group set in Settings, ${input.peerSetLabel}. A fee that fewer than ${MIN_PEERS_FOR_POSITION} of them publish is compared with a wider group, named in its row.`
        : `Peers: the narrowest default group (state, charter, size and district, then wider) where at least ${MIN_PEERS_FOR_POSITION} other institutions publish each fee, named in its row when it differs.`,
      `Overdraft is compared at its highest tier. For any other fee, a peer that publishes several amounts is compared at the median of those amounts; ${input.institutionName}'s own fee at several amounts is shown as a range and not placed. Fees stated as a rate are not in these tables.`,
      "Fees are live published fees, each verified against the institution's own schedule; read on the date at the top.",
      `A median, middle 50% or percentile needs at least ${MIN_PEERS_FOR_POSITION} peers. The middle 50% runs from the 25th to the 75th percentile of the peers' values.`,
      "Benchmark differences selected for review are the fees outside the peers' middle 50% that compare like for like (one published amount, the packet's own peer group), largest percentage gap from the median first. No fee type is weighted above another. The ranking shows unusual prices, not business importance: that depends on how often a fee is charged and waived, which the index does not hold, so the institution sets its own priorities.",
      "A comparison in doubt (several published amounts, or a wider peer group) is listed apart from the findings until it is resolved.",
      "The next step follows the evidence: investigate a difference, resolve a doubtful comparison, or retain the current policy and monitor. It never calls for a price change because a fee differs from the median.",
      "Fee income comes from FDIC call reports and NCUA 5300 reports as filed; NCUA year-to-date figures are split into quarters. Income per $10,000 of total assets divides the quarter's deposit service charge income by total assets in the same filing.",
      "Rules, bills and enforcement actions are listed as published, not interpreted.",
    ],
  };
}

// ─── Labels shared by the screen and the PDF ─────────────────────────────────

/** Fixed appendix letters, so a reference ("Appendix C") holds whichever tables are present. */
export const APPENDIX_LETTER: Partial<Record<PacketTableId, string>> = {
  peer_fee_matrix: "A",
  nearest_peers: "B",
  product_details: "C",
  regulatory: "D",
  price_and_yield: "E",
};

export interface LabelledTable {
  /** "Exhibit 2", "Appendix A". */
  label: string;
  /** The element id the screen gives it. */
  anchor: string;
  table: PacketTable;
}

/**
 * The packet's tables by section. Exhibits are numbered in the brief's reading order: the two on
 * page two (each fee, then income per $10,000 of assets) come first, then peer changes and the trend.
 */
export function packetSections(packet: CommitteePacket): { position: LabelledTable[]; financial: LabelledTable[]; appendix: LabelledTable[] } {
  const order = [packet.position.table, packet.financial.normalizedTable, packet.position.changes, packet.financial.trend].filter((t): t is PacketTable => t !== null);
  const exhibit = (table: PacketTable | null): LabelledTable[] => (table ? [{ label: `Exhibit ${order.indexOf(table) + 1}`, anchor: `exhibit-${table.id}`, table }] : []);
  return {
    position: [...exhibit(packet.position.table), ...exhibit(packet.position.changes)],
    financial: [...exhibit(packet.financial.trend), ...exhibit(packet.financial.normalizedTable)],
    appendix: packet.appendix.map((table) => ({ label: `Appendix ${APPENDIX_LETTER[table.id] ?? ""}`.trim(), anchor: `appendix-${table.id}`, table })),
  };
}

/** Every footnote number a text cites. */
export function footnoteMarks(text: string): number[] {
  return [...text.matchAll(/\[(\d+(?:, \d+)*)\]/g)].flatMap((m) => m[1].split(", ").map(Number));
}
