/**
 * The public peer explorer's shapes and pure math (institution page, #peers): one peer set, read
 * once on the server, then drawn three ways (Landscape, Locations, Fee matrix) around one shared
 * selection. Nothing here reads the database; src/lib/data-store/peer-explorer.ts fills the set.
 */
import { formatFeeAmount } from "@/lib/format";
import { MAX_CHOSEN_PEERS } from "@/lib/peer-set-dimensions";
import { STATE_NAMES } from "@/lib/us-states";

/** The fees the explorer compares, in the matrix's column order. */
export const EXPLORER_FEE_KEYS = [
  "monthly_maintenance",
  "atm_non_network",
  "wire_domestic_outgoing",
  "wire_intl_outgoing",
  "overdraft",
] as const;
export type ExplorerFeeKey = (typeof EXPLORER_FEE_KEYS)[number];

export const EXPLORER_FEE_LABELS: Record<ExplorerFeeKey, string> = {
  monthly_maintenance: "Monthly maintenance",
  atm_non_network: "Out-of-network ATM",
  wire_domestic_outgoing: "Domestic wire",
  wire_intl_outgoing: "International wire",
  overdraft: "Overdraft",
};

/** The matrix's narrow column heads. */
export const EXPLORER_FEE_SHORT: Record<ExplorerFeeKey, string> = {
  monthly_maintenance: "Maintenance",
  atm_non_network: "ATM",
  wire_domestic_outgoing: "Domestic wire",
  wire_intl_outgoing: "Intl. wire",
  overdraft: "Overdraft",
};

export function isExplorerFeeKey(value: unknown): value is ExplorerFeeKey {
  return typeof value === "string" && (EXPLORER_FEE_KEYS as readonly string[]).includes(value);
}

/** One published price behind a value: its amount, the name the schedule gives it, and its conditions. */
export interface ExplorerPrice {
  amount: number;
  name: string | null;
  conditions: string | null;
}

export interface ExplorerFee {
  /** The statistics contract's one value: the middle of its prices (overdraft: the highest). */
  amount: number;
  /** Every price behind the value, only when there is more than one. */
  prices?: ExplorerPrice[];
}

export interface ExplorerInstitution {
  id: number;
  name: string;
  /** Total assets in dollars (FDIC and NCUA, as institution_sources holds them); null when unknown. */
  assets: number | null;
  city: string | null;
  state: string | null;
  fees: Partial<Record<ExplorerFeeKey, ExplorerFee>>;
}

export interface ExplorerMedian {
  median: number;
  /** Peers publishing the fee (the subject left out). */
  peers: number;
}

export interface PeerExplorerSet {
  subject: ExplorerInstitution;
  /** The set's other institutions, closest in assets first is not assumed: callers sort. */
  peers: ExplorerInstitution[];
  charterType: string | null;
  /** Each fee's peer median, present only when enough peers publish it. */
  medians: Partial<Record<ExplorerFeeKey, ExplorerMedian>>;
}

export const money = (n: number) => formatFeeAmount(n) ?? `$${n.toFixed(2)}`;

/** "$4.4B", "$812M": total assets for a label. */
export function assetsLabel(dollars: number | null): string | null {
  if (dollars === null || !Number.isFinite(dollars) || dollars <= 0) return null;
  if (dollars >= 1e12) return `$${+(dollars / 1e12).toFixed(1)}T`;
  if (dollars >= 1e9) return `$${+(dollars / 1e9).toFixed(1)}B`;
  if (dollars >= 1e6) return `$${Math.round(dollars / 1e6)}M`;
  return `$${Math.round(dollars / 1e3)}K`;
}

/** How many institutions are in the set and how many of them publish one fee. */
export function feeCoverage(set: PeerExplorerSet, key: ExplorerFeeKey): { selected: number; publish: number } {
  return { selected: set.peers.length, publish: set.peers.filter((peer) => peer.fees[key] !== undefined).length };
}

/** Within this share of the median a matrix cell reads as near it. */
export const NEAR_MEDIAN_SHARE = 0.1;

export type MatrixBand = "below" | "near" | "above" | "none";

/** A matrix cell's band against its column's peer median; "none" when the fee or the median is missing. */
export function matrixBand(value: number | undefined, median: number | undefined): MatrixBand {
  if (value === undefined || median === undefined) return "none";
  const gap = value - median;
  const share = median > 0 ? Math.abs(gap) / median : Math.abs(gap);
  if (share <= NEAR_MEDIAN_SHARE) return "near";
  return gap > 0 ? "above" : "below";
}

/** "$1.55 below the peer median" / "Matches the peer median". Within half a cent is the same. */
export function gapText(value: number, median: number): { direction: "below" | "above" | "same"; text: string } {
  const gap = value - median;
  if (Math.abs(gap) < 0.005) return { direction: "same", text: "Matches the peer median" };
  return gap > 0
    ? { direction: "above", text: `${money(gap)} above the peer median` }
    : { direction: "below", text: `${money(-gap)} below the peer median` };
}

export interface FeeFinding {
  kind: "lower" | "same" | "higher";
  label: string;
  ids: number[];
}

/**
 * Where the selected institution's fee sits among the other publishing institutions of the set
 * (the subject counts as a peer when another institution is selected): who charges less, the
 * same and more. Each finding names the peers behind it so a click can highlight them.
 */
export function feeFindings(set: PeerExplorerSet, key: ExplorerFeeKey, selectedId: number): FeeFinding[] {
  const everyone = [set.subject, ...set.peers];
  const selected = everyone.find((inst) => inst.id === selectedId);
  const own = selected?.fees[key]?.amount;
  if (own === undefined) return [];
  const lower: number[] = [];
  const same: number[] = [];
  const higher: number[] = [];
  for (const inst of everyone) {
    if (inst.id === selectedId) continue;
    const value = inst.fees[key]?.amount;
    if (value === undefined) continue;
    if (Math.abs(value - own) < 0.005) same.push(inst.id);
    else if (value < own) lower.push(inst.id);
    else higher.push(inst.id);
  }
  const who = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "peer charges" : "peers charge"}`;
  return [
    { kind: "lower" as const, label: `${who(lower.length)} less`, ids: lower },
    { kind: "same" as const, label: `${who(same.length)} the same`, ids: same },
    { kind: "higher" as const, label: `${who(higher.length)} more`, ids: higher },
  ]
    .filter((finding) => finding.ids.length > 0);
}

/**
 * The words for a value built from several prices: the middle of them, or the highest for
 * overdraft, as the statistics contract counts it. Null for a single price.
 */
export function pricesSummary(key: ExplorerFeeKey, fee: ExplorerFee | undefined): string | null {
  const count = fee?.prices?.length ?? 0;
  if (count < 2) return null;
  return key === "overdraft" ? `The highest of ${count} prices` : `The middle of ${count} prices`;
}

const CHARTER_WORDS: Record<string, string> = { bank: "Banks", credit_union: "Credit unions" };

/**
 * Why these institutions belong, in plain words from the set itself: their charter, the range of
 * their total assets, and where they are headquartered.
 */
export function whyThesePeers(set: PeerExplorerSet): string[] {
  const parts: string[] = [];
  const kind = set.charterType ? CHARTER_WORDS[set.charterType] : null;
  if (kind) parts.push(`${kind} only`);
  const assets = set.peers.map((peer) => peer.assets).filter((value): value is number => value !== null && value > 0);
  if (assets.length > 0) {
    const low = assetsLabel(Math.min(...assets));
    const high = assetsLabel(Math.max(...assets));
    parts.push(low === high ? `${low} in assets` : `${low} to ${high} in assets`);
  }
  const states = [...new Set(set.peers.map((peer) => peer.state).filter((state): state is string => !!state))];
  if (states.length === 1) parts.push(`Headquartered in ${STATE_NAMES[states[0]] ?? states[0]}`);
  else if (states.length > 1) parts.push(`Headquartered in ${states.length} states`);
  return parts;
}

/** "25 peers selected · 21 publish this fee". */
export function coverageLine(set: PeerExplorerSet, key: ExplorerFeeKey): string {
  const { selected, publish } = feeCoverage(set, key);
  return `${selected.toLocaleString("en-US")} ${selected === 1 ? "peer" : "peers"} selected · ${publish.toLocaleString("en-US")} ${publish === 1 ? "publishes" : "publish"} this fee`;
}

export interface LocationGroup {
  key: string;
  name: string;
  members: ExplorerInstitution[];
}

/**
 * The set grouped by where each institution is headquartered: by city when the whole set sits in
 * one state, otherwise by state. The subject's group comes first, then the larger groups.
 */
export function locationGroups(set: PeerExplorerSet): { by: "city" | "state"; groups: LocationGroup[] } {
  const everyone = [set.subject, ...set.peers];
  const states = new Set(everyone.map((inst) => inst.state ?? ""));
  const by = states.size <= 1 ? "city" : "state";
  const groups = new Map<string, LocationGroup>();
  for (const inst of everyone) {
    const key = by === "city" ? `${(inst.city ?? "").toLowerCase()}|${inst.state ?? ""}` : inst.state ?? "";
    const name = by === "city"
      ? inst.city ? `${inst.city}${inst.state ? `, ${inst.state}` : ""}` : "City not on record"
      : inst.state ? STATE_NAMES[inst.state] ?? inst.state : "State not on record";
    const group = groups.get(key) ?? { key, name, members: [] };
    group.members.push(inst);
    groups.set(key, group);
  }
  const list = [...groups.values()];
  for (const group of list) group.members.sort((a, b) => (b.assets ?? 0) - (a.assets ?? 0));
  list.sort((a, b) => {
    const subjectA = a.members.some((m) => m.id === set.subject.id) ? 1 : 0;
    const subjectB = b.members.some((m) => m.id === set.subject.id) ? 1 : 0;
    return subjectB - subjectA || b.members.length - a.members.length || a.name.localeCompare(b.name);
  });
  return { by, groups: list };
}

/** A circle's radius for total assets: area follows assets, between the given bounds. */
export function assetRadius(assets: number | null, maxAssets: number, minR = 5, maxR = 22): number {
  if (!assets || assets <= 0 || maxAssets <= 0) return minR;
  return Math.max(minR, maxR * Math.sqrt(assets / maxAssets));
}

/** The set's institutions for the matrix: the subject first, then the peers by total assets, largest first. */
export function matrixRows(set: PeerExplorerSet): ExplorerInstitution[] {
  return [set.subject, ...[...set.peers].sort((a, b) => (b.assets ?? -1) - (a.assets ?? -1) || a.name.localeCompare(b.name))];
}

export interface AxisScale {
  kind: "linear" | "log";
  min: number;
  max: number;
  ticks: number[];
}

const NICE_STEPS = [1, 2, 2.5, 5, 10];

function niceStep(span: number, count: number): number {
  const raw = span / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(raw));
  return (NICE_STEPS.find((step) => step * power >= raw) ?? 10) * power;
}

/** A clean linear axis from zero (fees) or from the data (assets), with about `count` ticks. */
export function linearScale(values: number[], count = 4, fromZero = true): AxisScale {
  const finite = values.filter((v) => Number.isFinite(v));
  const top = finite.length ? Math.max(...finite) : 1;
  const bottom = fromZero ? 0 : finite.length ? Math.min(...finite) : 0;
  const step = niceStep(top - bottom || top || 1, count);
  const min = fromZero ? 0 : Math.floor(bottom / step) * step;
  const max = Math.max(step, Math.ceil(top / step) * step);
  const ticks: number[] = [];
  for (let t = min; t <= max + step / 2; t += step) ticks.push(+t.toFixed(6));
  return { kind: "linear", min, max, ticks };
}

/**
 * The assets axis: linear while the set spans less than tenfold, otherwise logarithmic with ticks
 * at 1, 2 and 5 of each power of ten, so a $40M credit union and a $4B one both have room.
 */
export function assetScale(values: number[]): AxisScale {
  const positive = values.filter((v) => Number.isFinite(v) && v > 0);
  if (positive.length === 0) return { kind: "linear", min: 0, max: 1, ticks: [0, 1] };
  const low = Math.min(...positive);
  const high = Math.max(...positive);
  if (high / low < 10) {
    const step = niceStep(high - low || high, 4);
    const min = Math.max(0, Math.floor(low / step) * step);
    const max = Math.max(min + step, Math.ceil(high / step) * step);
    const ticks: number[] = [];
    for (let t = min; t <= max + step / 2; t += step) ticks.push(t);
    return { kind: "linear", min, max, ticks };
  }
  const min = 10 ** Math.floor(Math.log10(low));
  const max = 10 ** Math.ceil(Math.log10(high));
  const ticks: number[] = [];
  for (let p = min; p <= max; p *= 10) for (const m of [1, 2, 5]) if (p * m >= min && p * m <= max) ticks.push(p * m);
  return { kind: "log", min, max, ticks: ticks.length > 7 ? ticks.filter((t) => String(t).startsWith("1")) : ticks };
}

/** Where a value sits on a scale, 0 to 1. */
export function scalePosition(scale: AxisScale, value: number): number {
  if (scale.kind === "log") {
    const v = Math.max(value, scale.min);
    return (Math.log10(v) - Math.log10(scale.min)) / (Math.log10(scale.max) - Math.log10(scale.min) || 1);
  }
  return (value - scale.min) / (scale.max - scale.min || 1);
}

/** The views a visitor switches between. */
export const EXPLORER_VIEWS = ["landscape", "locations", "matrix"] as const;
export type ExplorerView = (typeof EXPLORER_VIEWS)[number];

export function isExplorerView(value: unknown): value is ExplorerView {
  return typeof value === "string" && (EXPLORER_VIEWS as readonly string[]).includes(value);
}

/**
 * The Hamilton peer-set page with this set filled in: the subject (instId), the peers by id when
 * Hamilton can hold them (a saved set takes at most MAX_CHOSEN_PEERS), and the set's name.
 * Hamilton routes a visitor who is not signed in itself.
 */
export function hamiltonPeerSetHref(subjectId: number, peerIds: number[], name: string): string {
  const params = new URLSearchParams({ instId: String(subjectId) });
  const ids = [...new Set(peerIds)].filter((id) => Number.isSafeInteger(id) && id > 0);
  if (ids.length > 0 && ids.length <= MAX_CHOSEN_PEERS) params.set("peers", ids.join(","));
  if (name) params.set("name", name);
  return `/pro/settings?${params.toString()}#peer-sets`;
}
