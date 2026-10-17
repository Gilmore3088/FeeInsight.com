/**
 * The pricing committee packet: one quarterly document for a bank's pricing committee. Pure and
 * deterministic; the loader (committee-packet-data.ts) reads the data and this file only arranges it.
 *
 * Sections, each an exhibit with its source:
 * 1. Every watched fee against the bank's peers: the bank's comparison value, the peers' middle 50%
 *    and median (always "median of N peers"), where the bank's value sits and the named peers just
 *    below and above it.
 * 2. Each peer's published value for every watched fee.
 * 3. What moved since last quarter: the stored quarterly copies compared, and peer fee changes the
 *    peers' own schedules bear out.
 * 4. The filed deposit service charge income trend.
 * 5. Rules, bills and enforcement actions where Hamilton holds a source for them.
 * 6. Price and yield: each peer's published fee beside its filed fee income.
 * 7. Position check: one proposed fee placed among the peers, when the reader entered one.
 *
 * Every figure carries a numbered footnote naming its source document or filing and its date.
 * Hamilton is neutral here: the packet describes positions and moves and never recommends a fee.
 */
import { getDisplayName } from "@/lib/fee-taxonomy";
import { readerAsOf } from "./board-brief";
import { plainFeeName } from "./briefing-observations";
import { directionalTitle } from "./workspace/names";
import type { QuarterlyChanges } from "./briefing-snapshots";
import { checkPosition, namedPeers, type PositionCheck, type PositionPeer } from "./position-check";
import { quarterLabel } from "./workspace/briefing-diff";
import { MIN_PEERS_FOR_POSITION } from "./workspace/scenario";
import type { Fact, InstitutionFinancials, PeerValue } from "./workspace/types";
import type { ReportExhibit, ReportSummaryResponse } from "./types";

/** Watched fees in one packet; a longer list stays readable on one printed page per exhibit. */
export const MAX_PACKET_FEES = 10;
/** Peers listed by name in the peer table; the medians use every peer. */
export const MAX_PACKET_PEER_ROWS = 30;
/** Peer fee changes listed. */
export const MAX_PACKET_CHANGES = 25;
/** Rule, bill and enforcement lines listed. */
export const MAX_PACKET_RULES = 8;

export const NONE_FOUND = "None found";
export const NOT_PUBLISHED = "Not found in published schedules";
const NOT_FILED = "Not found in filings";

export interface PacketOwnRow {
  amount: number | null;
  sourceDocumentId: number | null;
  documentUrl: string | null;
  publishedAt: string | null;
}

export interface PacketFeeInput {
  feeCategory: string;
  /** The bank's comparison value (the engine's one value per institution); null when not published. */
  current: number | null;
  /** The peer group this fee was compared with (widened per fee when the first group is thin). */
  peerLabel: string;
  /** The peers' comparison values, the bank left out, with the catalog rows behind each. */
  peers: PeerValue[];
  /** The bank's own live rows for the fee, for its footnote and range. */
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
  /** Quarterly service charge income per $10,000 of assets. */
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
  /** The fee the price-and-yield exhibit reads; the first watched fee when not given. */
  yieldFee?: string | null;
  /** A proposed fee the reader entered, placed among that fee's peers. */
  proposed?: { feeCategory: string; amount: number } | null;
}

export interface PacketFootnote {
  n: number;
  label: string;
  detail: string;
  url: string | null;
}

export interface PacketKeyFigure {
  value: string;
  label: string;
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
  keyFigures: PacketKeyFigure[];
  exhibits: PacketExhibit[];
  positionCheck: { feeCategory: string; feeName: string; peerLabel: string; check: PositionCheck } | null;
  priceYield: PriceYield | null;
  footnotes: PacketFootnote[];
  method: string[];
}

export type PacketExhibitId = Extract<
  ReportExhibit["id"],
  "peer_range" | "peer_fee_matrix" | "competitor_moves" | "fee_income_trend" | "regulatory" | "price_and_yield" | "position_check"
>;

export interface PacketExhibit extends Omit<ReportExhibit, "id"> {
  id: PacketExhibitId;
  /** Said once when the exhibit has no rows. */
  empty: string | null;
  /** The kinds of source behind the exhibit, for its source line ("published fee schedules"). */
  source: string;
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

/** A placement that starts a cell or sentence: "At the 60th percentile of 5 peers". */
export function capitalize(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

const SCHEDULES = "published fee schedules";
const FILINGS = "FDIC call reports and NCUA 5300 reports";

function span(lo: number, hi: number): string {
  return Math.abs(lo - hi) < 0.005 ? packetMoney(lo) : `${packetMoney(lo)} to ${packetMoney(hi)}`;
}

function quantile(sorted: readonly number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return Math.round((sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)) * 100) / 100;
}

function refs(numbers: readonly number[]): string {
  const unique = [...new Set(numbers)].sort((a, b) => a - b);
  return unique.length ? `[${unique.join(", ")}]` : "";
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

  list(): PacketFootnote[] {
    return this.order.map((key, i) => {
      const schedule = this.schedules.get(key);
      if (schedule) {
        const docs = [...schedule.documentIds].sort((a, b) => a - b);
        const published = dateSpan(schedule.dates);
        return {
          n: i + 1,
          label: `${schedule.name}, published fee schedule`,
          detail: [
            docs.length ? `${docs.length === 1 ? "document" : "documents"} ${docs.join(", ")}` : "document not recorded",
            published ? `published ${published}` : "publish date not recorded",
          ].join(" · "),
          url: schedule.urls[0] ?? null,
        };
      }
      return { n: i + 1, ...(this.fixed.get(key) as Omit<PacketFootnote, "n">) };
    });
  }
}

// ─── Sections ────────────────────────────────────────────────────────────────

/** The fee's name as the Research and Try a price screens write it ("Overdraft", not "Overdraft (OD)"). */
export function packetFeeName(category: string): string {
  return directionalTitle(category) ?? plainFeeName(getDisplayName(category));
}
const feeName = packetFeeName;

function asPositionPeers(peers: readonly PeerValue[]): PositionPeer[] {
  return peers.map((p) => ({ institutionId: p.institutionId, name: p.institutionName, amount: p.amount, publishedAt: p.publishedAt, documentUrl: p.documentUrls[0] ?? null }));
}

/** "Capital City Bank $36 [4]": the neighbours on one side, each with its footnote. */
function neighbourCell(side: PositionCheck["below"], notes: Footnotes, byId: Map<number, PeerValue>): string {
  if (!side) return NONE_FOUND;
  const marks = side.peers.map((p) => {
    const peer = byId.get(p.institutionId);
    return peer ? notes.schedule(peer.institutionId, peer.institutionName, peer.sourceDocumentIds, peer.documentUrls, [peer.publishedAt]) : null;
  }).filter((n): n is number => n !== null);
  return `${packetMoney(side.amount)}: ${namedPeers(side.peers)} ${refs(marks)}`.trim();
}

function ownCell(fee: PacketFeeInput, notes: Footnotes, input: CommitteePacketInput): string {
  if (fee.current === null) return NOT_PUBLISHED;
  const rows = fee.ownRows.filter((r) => r.amount !== null);
  const n = notes.schedule(
    input.institutionId,
    input.institutionName,
    rows.map((r) => r.sourceDocumentId).filter((d): d is number => d !== null),
    rows.map((r) => r.documentUrl),
    rows.map((r) => r.publishedAt),
  );
  const amounts = rows.map((r) => r.amount as number);
  const lo = amounts.length ? Math.min(...amounts) : fee.current;
  const hi = amounts.length ? Math.max(...amounts) : fee.current;
  // Several published amounts make one comparison value; the range is shown beside it.
  const range = amounts.length > 1 && Math.abs(lo - hi) >= 0.005 ? ` (comparison value; ${amounts.length} published amounts, ${span(lo, hi)})` : "";
  return `${packetMoney(fee.current)}${range} [${n}]`;
}

/** The group most fees were compared with: the Settings group when set, else the commonest label. */
function mainPeerGroup(input: CommitteePacketInput): string {
  if (input.peerSetLabel) return input.peerSetLabel;
  const counts = new Map<string, number>();
  for (const f of input.fees) counts.set(f.peerLabel, (counts.get(f.peerLabel) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Default peer group";
}

function positionsExhibit(input: CommitteePacketInput, notes: Footnotes): PacketExhibit {
  const group = mainPeerGroup(input);
  const rows = input.fees.map((fee) => {
    const sorted = fee.peers.map((p) => p.amount).sort((a, b) => a - b);
    const n = sorted.length;
    const peerNote = n
      ? notes.source(`peers:${fee.feeCategory}`, {
          label: `${feeName(fee.feeCategory)}: ${n} ${n === 1 ? "peer's" : "peers'"} published fee schedules (${fee.peerLabel})`,
          detail: `published ${dateSpan(fee.peers.map((p) => p.publishedAt)) ?? "on dates not recorded"} · each peer's own schedule is footnoted in Exhibit 2`,
          url: null,
        })
      : null;
    const enough = n >= MIN_PEERS_FOR_POSITION;
    const band = enough ? `${span(quantile(sorted, 0.25), quantile(sorted, 0.75))} ${refs([peerNote as number])}` : n ? `Too few peers (${n})` : NONE_FOUND;
    const median = enough ? `${packetMoney(quantile(sorted, 0.5))}, median of ${n} peers ${refs([peerNote as number])}` : n ? `Too few peers (${n})` : NONE_FOUND;
    let place = fee.current === null ? NOT_PUBLISHED : NONE_FOUND;
    let nearest = NONE_FOUND;
    if (fee.current !== null && n) {
      const check = checkPosition(fee.current, asPositionPeers(fee.peers));
      const byId = new Map(fee.peers.map((p) => [p.institutionId, p]));
      place = `${capitalize(check.placement)}; ${check.less} charge less, ${check.same} about the same, ${check.more} more`;
      nearest = `Below: ${neighbourCell(check.below, notes, byId)} · Above: ${neighbourCell(check.above, notes, byId)}`;
    }
    // A fee that widened to another group says so in its own row.
    const name = fee.peerLabel === group ? feeName(fee.feeCategory) : `${feeName(fee.feeCategory)} (compared with ${fee.peerLabel})`;
    return [name, ownCell(fee, notes, input), band, median, place, nearest];
  });
  return {
    id: "peer_range",
    title: `${input.institutionName}'s watched fees against its peers`,
    subtitle: input.feeListSource === "watchlist"
      ? `The fees saved on your watchlist, compared with ${group}.`
      : `Watched fees: None found, so the packet shows the institution's own published fees (up to ${MAX_PACKET_FEES}), compared with ${group}.`,
    columns: ["Fee", input.institutionName, "Peers' middle 50%", "Peer median", "Where it sits", "Nearest peers"],
    rows,
    note: "One comparison value per institution: the median of its published amounts for the fee, or the highest tier for overdraft. The middle 50% and median are worked out from the peers' values; no institution necessarily charges them.",
    empty: rows.length ? null : NONE_FOUND,
    source: SCHEDULES,
  };
}

function matrixExhibit(input: CommitteePacketInput, notes: Footnotes): PacketExhibit {
  const peers = new Map<number, { name: string; values: Map<string, PeerValue> }>();
  for (const fee of input.fees) {
    for (const p of fee.peers) {
      const entry = peers.get(p.institutionId) ?? { name: p.institutionName, values: new Map() };
      entry.values.set(fee.feeCategory, p);
      peers.set(p.institutionId, entry);
    }
  }
  const ranked = [...peers.entries()].sort((a, b) => b[1].values.size - a[1].values.size || a[1].name.localeCompare(b[1].name));
  const shown = ranked.slice(0, MAX_PACKET_PEER_ROWS);
  const ownNote = input.fees.some((f) => f.current !== null)
    ? notes.schedule(input.institutionId, input.institutionName, [], [], [])
    : null;
  const ownRow = [
    input.institutionName,
    ...input.fees.map((f) => (f.current === null ? NOT_PUBLISHED : packetMoney(f.current))),
    ownNote ? refs([ownNote]) : NONE_FOUND,
  ];
  const rows = shown.map(([id, entry]) => {
    const values = [...entry.values.values()];
    const n = notes.schedule(id, entry.name, values.flatMap((v) => v.sourceDocumentIds), values.flatMap((v) => v.documentUrls), values.map((v) => v.publishedAt));
    return [entry.name, ...input.fees.map((f) => {
      const v = entry.values.get(f.feeCategory);
      return v ? packetMoney(v.amount) : NOT_PUBLISHED;
    }), refs([n])];
  });
  return {
    id: "peer_fee_matrix",
    title: "Each peer's published fees",
    subtitle: ranked.length > shown.length
      ? `${shown.length} of ${ranked.length} peers, those publishing the most of these fees first. Every peer counts in the medians.`
      : `${ranked.length} ${ranked.length === 1 ? "peer" : "peers"}, those publishing the most of these fees first.`,
    columns: ["Institution", ...input.fees.map((f) => feeName(f.feeCategory)), "Source"],
    rows: ranked.length ? [ownRow, ...rows] : [],
    note: "\"Not found in published schedules\" means the fee is not on that institution's published schedule in the index. It is never read as $0.",
    empty: ranked.length ? null : NONE_FOUND,
    source: SCHEDULES,
  };
}

function movesExhibit(input: CommitteePacketInput, notes: Footnotes): PacketExhibit {
  const rows: string[][] = [];
  const q = input.quarterly;
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
    for (const change of q.diff.changes) {
      rows.push(["Quarterly copies compared", change.feeCategory ? feeName(change.feeCategory) : "Fee income", change.text, `${quarterLabel(q.diff.fromQuarter)} to ${quarterLabel(q.diff.toQuarter)}`, refs([from, to])]);
    }
  }
  const watched = new Set(input.fees.map((f) => f.feeCategory));
  const peerIds = new Set(input.fees.flatMap((f) => f.peers.map((p) => p.institutionId)));
  const changes = input.changes
    .filter((c) => peerIds.has(c.institutionId) && watched.has(c.feeCategory) && Math.abs(c.oldAmount - c.newAmount) >= 0.005)
    .sort((a, b) => b.changedAt.localeCompare(a.changedAt))
    .slice(0, MAX_PACKET_CHANGES);
  for (const c of changes) {
    const n = notes.source(`change:${c.institutionId}:${c.scheduleUrl ?? c.changedAt}`, {
      label: `${c.institutionName}, published fee schedule`,
      detail: `change seen ${readerAsOf(c.changedAt.slice(0, 10))}; the earlier and later copies of the schedule both bear it out`,
      url: c.scheduleUrl,
    });
    const direction = c.newAmount > c.oldAmount ? "higher" : "lower";
    rows.push([c.institutionName, feeName(c.feeCategory), `${packetMoney(c.oldAmount)} to ${packetMoney(c.newAmount)} (${packetMoney(Math.round(Math.abs(c.newAmount - c.oldAmount) * 100) / 100)} ${direction})`, readerAsOf(c.changedAt.slice(0, 10)), refs([n])]);
  }
  const firstOnly = q?.kind === "first"
    ? `Hamilton stored its first quarterly copy for ${input.institutionName} in ${quarterLabel(q.quarter)}; the quarter-on-quarter comparison starts with the next copy.`
    : q === null
      ? "Stored quarterly copies for this institution: None found."
      : null;
  return {
    id: "competitor_moves",
    title: "What moved since last quarter",
    subtitle: `Peer fee changes seen since ${readerAsOf(input.changesSince)}${q?.kind === "diff" ? `, and the stored ${quarterLabel(q.diff.fromQuarter)} and ${quarterLabel(q.diff.toQuarter)} copies compared` : ""}.`,
    columns: ["Institution or comparison", "Fee", "Change", "When", "Source"],
    rows,
    note: [firstOnly, "A peer's change is listed only when its own schedule bears it out, and only for the fees and peers in this packet."].filter(Boolean).join(" "),
    empty: rows.length ? null : NONE_FOUND,
    source: q?.kind === "diff" ? `Hamilton's stored quarterly copies and ${SCHEDULES}` : SCHEDULES,
  };
}

function incomeExhibit(input: CommitteePacketInput, notes: Footnotes): PacketExhibit {
  const f = input.financials;
  if (!f) {
    return { id: "fee_income_trend", title: "Filed fee income", subtitle: "Deposit service charge income from the institution's own filings.", columns: ["Quarter ending", input.institutionName], rows: [], note: null, empty: NOT_FILED, source: FILINGS };
  }
  const own = notes.source(`filing:${input.institutionId}`, {
    label: `${input.institutionName}, ${f.label}`,
    detail: `quarters ending ${dateSpan(f.quarters.map((q) => q.quarterEnd)) ?? readerAsOf(f.quarterEnd)}`,
    url: null,
  });
  const peer = f.peerMedian
    ? notes.source(`filing-peers:${f.peerMedian.label}`, {
        label: f.peerMedian.sourceRef.label,
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
      p && peer ? `${filedDollars(p.amount)}, median of ${p.institutions.toLocaleString("en-US")} filers [${peer}]` : NOT_FILED,
    ];
  });
  const ttm = f.latestTtm !== null
    ? `Four quarters to ${readerAsOf(f.quarterEnd)}: ${filedDollars(f.latestTtm)}${f.yoyPct !== null ? `, ${Math.abs(f.yoyPct).toFixed(1)}% ${f.yoyPct >= 0 ? "higher" : "lower"} than the four before` : ""} [${own}].`
    : `Fewer than four quarters on file to ${readerAsOf(f.quarterEnd)}.`;
  return {
    id: "fee_income_trend",
    title: "Filed fee income, quarter by quarter",
    subtitle: ttm,
    columns: ["Quarter ending", input.institutionName, f.peerMedian ? f.peerMedian.label : "Filers of the same charter and size"],
    rows,
    note: "Deposit service charge income for the whole institution as filed, each quarter on its own; not the income from any one fee.",
    empty: rows.length ? null : NOT_FILED,
    source: FILINGS,
  };
}

function rulesExhibit(input: CommitteePacketInput, notes: Footnotes): PacketExhibit {
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
  return {
    id: "regulatory",
    title: "New rules, bills and enforcement actions",
    subtitle: "Federal rules on these fees, the state's fee bills and consumer-law enforcement actions, as each agency or legislature published them.",
    columns: ["Item", "Date", "Source"],
    rows,
    note: "Listed, not interpreted. Only items whose topics bear on the fees in this packet appear.",
    empty: rows.length ? null : NONE_FOUND,
    source: "the Federal Register, state legislatures via Open States, and federal and state enforcement action lists",
  };
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  return quantile([...values].sort((a, b) => a - b), 0.5);
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
    if (p.fee > medianFee + 0.005 && p.incomePer10kAssets < medianIncome) return { ...p, reading: "fee_high_income_low" };
    if (p.fee < medianFee - 0.005 && p.incomePer10kAssets > medianIncome) return { ...p, reading: "fee_low_income_high" };
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

/** The price-and-yield exhibit's main limitation; the screen shows it before the chart. */
export const PRICE_YIELD_LIMIT = "Income is the whole institution's deposit service charge income, not this fee's.";

export const READING_TEXT: Record<NonNullable<PriceYieldPoint["reading"]>, string> = {
  fee_high_income_low: "Fee above the peer median, income below it",
  fee_low_income_high: "Fee below the peer median, income above it",
};

function priceYieldExhibit(input: CommitteePacketInput, py: PriceYield | null, notes: Footnotes): PacketExhibit {
  const fee = input.fees.find((f) => f.feeCategory === py?.feeCategory);
  const rows = (py?.points ?? []).map((p) => {
    const peer = fee?.peers.find((v) => v.institutionId === p.institutionId);
    const feeNote = p.own
      ? notes.schedule(input.institutionId, input.institutionName, [], [], [])
      : peer ? notes.schedule(peer.institutionId, peer.institutionName, peer.sourceDocumentIds, peer.documentUrls, [peer.publishedAt]) : null;
    const row = input.income.find((r) => r.institutionId === p.institutionId);
    const filing = notes.source(`income:${py?.quarter}`, {
      label: "FDIC call reports and NCUA 5300 reports, deposit service charge income and total assets",
      detail: `quarter ending ${readerAsOf(py?.quarter ?? "")}; NCUA year-to-date income less the prior quarter`,
      url: null,
    });
    return [
      p.name,
      `${packetMoney(p.fee)}${feeNote ? ` [${feeNote}]` : ""}`,
      row?.serviceChargeIncomeThousands != null ? `${filedDollars(row.serviceChargeIncomeThousands * 1000)} [${filing}]` : NOT_FILED,
      `${packetMoney(p.incomePer10kAssets)} [${filing}]`,
      p.reading ? READING_TEXT[p.reading] : "",
    ];
  });
  const medians = py && py.medianFee !== null && py.medianIncome !== null
    ? `Peer medians: fee ${packetMoney(py.medianFee)} and income ${packetMoney(py.medianIncome)} per $10,000 of assets, each the median of ${py.peersCompared} peers (${py.peerLabel}).`
    : py
      ? `Too few peers with both figures for medians (${py.peersCompared}).`
      : null;
  return {
    id: "price_and_yield",
    title: py ? `${py.feeName}: published fee beside filed fee income` : "Published fee beside filed fee income",
    subtitle: py ? `Filings for the quarter ending ${readerAsOf(py.quarter)}. ${medians}` : "Peers with both a published fee and a filing: None found.",
    columns: ["Institution", py ? py.feeName : "Fee", "Service charge income, quarter", "Income per $10,000 of assets", "Against the peer medians"],
    rows,
    note: `${PRICE_YIELD_LIMIT} Income per $10,000 of assets puts institutions of different sizes on one scale. Peers filing for another quarter are left out.`,
    empty: rows.length ? null : NONE_FOUND,
    source: `${SCHEDULES} and FDIC/NCUA filings`,
  };
}

function positionExhibit(input: CommitteePacketInput, notes: Footnotes): { exhibit: PacketExhibit; check: CommitteePacket["positionCheck"] } | null {
  const proposed = input.proposed;
  if (!proposed) return null;
  const fee = input.fees.find((f) => f.feeCategory === proposed.feeCategory);
  if (!fee) return null;
  const check = checkPosition(proposed.amount, asPositionPeers(fee.peers));
  const byId = new Map(fee.peers.map((p) => [p.institutionId, p]));
  // Exhibit 1 already numbered this fee's peer schedules; the same footnote is reused.
  const peerNote = fee.peers.length ? notes.source(`peers:${fee.feeCategory}`, { label: `${feeName(fee.feeCategory)}: peers' published fee schedules`, detail: "", url: null }) : null;
  const mark = peerNote ? ` [${peerNote}]` : "";
  const rows = [
    ["Proposed fee", packetMoney(check.proposed)],
    ["Peers compared", `${check.n}${mark}`],
    ["Where it would sit", capitalize(check.placement)],
    ["Peers charging less, about the same, more", `${check.less}, ${check.same}, ${check.more}`],
    ["Nearest peer below", neighbourCell(check.below, notes, byId)],
    ["Nearest peer above", neighbourCell(check.above, notes, byId)],
    ...(fee.current !== null ? [["Today's comparison value", ownCell(fee, notes, input)]] : []),
  ];
  return {
    exhibit: {
      id: "position_check",
      title: `Position check: ${packetMoney(check.proposed)} for ${feeName(fee.feeCategory).toLowerCase()}`,
      subtitle: `Against ${fee.peerLabel}.`,
      columns: ["Measure", "Value"],
      rows,
      note: "Places an entered price among the peers' published values; it says nothing about whether to charge it.",
      empty: null,
      source: SCHEDULES,
    },
    check: { feeCategory: fee.feeCategory, feeName: feeName(fee.feeCategory), peerLabel: fee.peerLabel, check },
  };
}

// ─── The packet ──────────────────────────────────────────────────────────────

export function buildCommitteePacket(input: CommitteePacketInput): CommitteePacket {
  const notes = new Footnotes();
  const quarter = quarterOf(input.generatedAt);
  const positions = positionsExhibit(input, notes);
  const matrix = matrixExhibit(input, notes);
  const moves = movesExhibit(input, notes);
  const income = incomeExhibit(input, notes);
  const rules = rulesExhibit(input, notes);
  const py = priceAndYield(input);
  const pyExhibit = priceYieldExhibit(input, py, notes);
  const position = positionExhibit(input, notes);
  const peerIds = new Set(input.fees.flatMap((f) => f.peers.map((p) => p.institutionId)));
  const published = input.fees.filter((f) => f.current !== null).length;
  const placed = input.fees.filter((f) => f.current !== null && f.peers.length >= MIN_PEERS_FOR_POSITION);
  const sortedOf = (f: PacketFeeInput) => f.peers.map((p) => p.amount).sort((a, b) => a - b);
  const above = placed.filter((f) => (f.current as number) > quantile(sortedOf(f), 0.75) + 0.005).length;
  const below = placed.filter((f) => (f.current as number) < quantile(sortedOf(f), 0.25) - 0.005).length;
  const moveRows = moves.rows.length;
  const keyFigures: PacketKeyFigure[] = [
    { value: `${published} of ${input.fees.length}`, label: "watched fees on the institution's published schedule" },
    { value: peerIds.size.toLocaleString("en-US"), label: "peers compared across these fees" },
    ...(placed.length ? [{ value: `${above} above · ${below} below`, label: `watched fees outside the peers' middle 50% (${placed.length} with enough peers)` }] : []),
    { value: moveRows ? String(moveRows) : NONE_FOUND, label: `moves since ${readerAsOf(input.changesSince)}` },
  ];
  const peerGroupLabel = input.peerSetLabel ?? input.fees[0]?.peerLabel ?? "Default peer group";
  return {
    title: `Pricing committee packet: ${input.institutionName}, ${quarterLabel(quarter)}`,
    institutionId: input.institutionId,
    institutionName: input.institutionName,
    generatedAt: input.generatedAt,
    quarter,
    peerGroupLabel,
    feeCategories: input.fees.map((f) => f.feeCategory),
    keyFigures,
    exhibits: [positions, matrix, moves, income, rules, pyExhibit, ...(position ? [position.exhibit] : [])],
    positionCheck: position?.check ?? null,
    priceYield: py,
    footnotes: notes.list(),
    method: [
      input.peerSetLabel
        ? `Peers: the group set in Settings, ${input.peerSetLabel}. A fee that fewer than ${MIN_PEERS_FOR_POSITION} of them publish is compared with a wider group, named in Exhibit 1.`
        : `Peers: the narrowest default group (state, charter, size and district, then wider) where at least ${MIN_PEERS_FOR_POSITION} other institutions publish each fee, named in Exhibit 1.`,
      "One comparison value per institution: the median of its published amounts for the fee, or the highest tier for overdraft. Fees stated as a rate are not in these tables.",
      "Fees are live published fees, each verified against the institution's own schedule; read on the date at the top.",
      `A percentile needs at least ${MIN_PEERS_FOR_POSITION} peers. "Where it sits" counts the peers charging less, about the same and more.`,
      "Fee income comes from FDIC call reports and NCUA 5300 reports as filed; NCUA year-to-date figures are split into quarters.",
      "Rules, bills and enforcement actions are listed as published, not interpreted.",
    ],
  };
}

/** The packet as a saved-report shape, so the existing PDF document prints it. Lists findings, never actions. */
export function committeePacketReport(packet: CommitteePacket): ReportSummaryResponse {
  const headline = `${packet.institutionName}'s watched fees against its peers, what moved since last quarter, its filed fee income and new rules, read ${readerAsOf(packet.generatedAt)}.`;
  const figures = packet.keyFigures.map((f) => `${f.value}: ${f.label}.`);
  return {
    title: packet.title,
    boardBrief: { sourceResearchHref: `/pro/reports/committee?instId=${packet.institutionId}`, teamNote: "", includeEvidence: true },
    answer: { headline, decisions: [] },
    executiveSummary: [headline, ...figures],
    snapshot: [],
    strategicRationale: [figures.join(" "), ...packet.method].join("\n\n"),
    tradeoffs: [],
    recommendation: "Figures are read live on the date above and are not saved. Each number carries a footnote; the numbered sources are listed below. Where Hamilton finds no data, the cell says \"None found\" or \"Not found in published schedules\", never $0.",
    implementationNotes: [`Peer group: ${packet.peerGroupLabel}.`],
    exhibits: packet.exhibits.map((e) => ({
      id: e.id,
      title: e.title,
      subtitle: e.subtitle,
      columns: e.columns,
      rows: e.rows.length ? e.rows : [[e.empty ?? NONE_FOUND, ...e.columns.slice(1).map(() => "")]],
      note: [e.note, `Source: ${e.source}, read ${readerAsOf(packet.generatedAt)}.`].filter(Boolean).join(" "),
    })),
    sources: packet.footnotes.map((f) => ({ label: `[${f.n}] ${f.label}`, detail: f.detail, url: f.url })),
    exportControls: { pdfEnabled: true, shareEnabled: false },
  };
}
