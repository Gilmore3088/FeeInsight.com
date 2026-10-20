/**
 * The public peer explorer's shapes and pure math (institution page, #peers): one peer set, read
 * once on the server, then drawn three ways (Landscape, Locations, Fee matrix) around one shared
 * selection. Nothing here reads the database; src/lib/data-store/peer-explorer.ts fills the set.
 */
import { displayCity, formatFeeAmount } from "@/lib/format";
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
  /** The account's own short name from the fee's name ("Carefree Checking"), when it names one. */
  account?: string | null;
  conditions: string | null;
}

export interface ExplorerFee {
  /** The statistics contract's one value: the middle of its prices (overdraft: the highest). */
  amount: number;
  /** Every price behind the value, only when there is more than one. */
  prices?: ExplorerPrice[];
  /** The bank's own schedule the value was read from, and when its newest row joined the index (ISO date). */
  source?: { url: string | null; published: string | null };
}

export interface ExplorerInstitution {
  id: number;
  name: string;
  /** Total assets in dollars (FDIC and NCUA, as institution_sources holds them); null when unknown. */
  assets: number | null;
  city: string | null;
  state: string | null;
  /** "bank" or "credit_union" (institution_sources.charter_type); a home metro set holds both. */
  charter?: string | null;
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
  /** Each fee's peer median, present only when enough peers publish it. Always the whole set's. */
  medians: Partial<Record<ExplorerFeeKey, ExplorerMedian>>;
  /** The newest date any fee behind the set's figures joined the index (YYYY-MM-DD), whole set included. */
  asOf?: string | null;
  /**
   * Present only when the set has more peers than the page draws (PEER_EXPLORER_MAX_SHOWN): the
   * whole set's counts, computed on the server. `peers` then holds the closest in assets.
   */
  whole?: ExplorerWholeSet;
  /**
   * For a metro set: the metro's name and, per city inside it, the institutions with a branch
   * there (branch records, the same ones that define the metro). Absent for other sets.
   */
  market?: {
    name: string;
    cities: { city: string; state: string; ids: number[] }[];
    /** Branches in the metro and, for banks, deposits there (whole dollars), by institution id. */
    presence?: Record<number, { branches: number; deposits: number | null }>;
    /** Every institution's deposits in the metro (FDIC Summary of Deposits), for a local share. */
    totalDeposits?: number;
  };
}

/** The whole set behind a capped explorer set: every count and median on the page uses it. */
export interface ExplorerWholeSet {
  /** Peers in the set (the subject left out). */
  peers: number;
  /** Peers publishing each fee. */
  publish: Partial<Record<ExplorerFeeKey, number>>;
  /** Headquarters states of the peers, for "spread over N states". */
  states: string[];
  /** Smallest and largest total assets among the peers, in dollars. */
  assets: { min: number; max: number } | null;
  /** The peers' charters ("bank", "credit_union"), present when the peers carry them. */
  charters?: string[];
}

/** At most this many peers reach the page; a larger set ships its closest in assets. */
export const PEER_EXPLORER_MAX_SHOWN = 50;

/**
 * Caps a set at `max` peers, the closest in total assets to the subject (ties and unknown assets by
 * id), and keeps the whole set's counts beside them. Medians were computed before the cap, so they
 * stay the whole set's. A set at or under the cap comes back unchanged.
 */
export function capPeerExplorerSet(set: PeerExplorerSet, max = PEER_EXPLORER_MAX_SHOWN): PeerExplorerSet {
  if (set.peers.length <= max) return set;
  const own = set.subject.assets;
  const distance = (inst: ExplorerInstitution) => (inst.assets === null ? Infinity : own === null ? -inst.assets : Math.abs(inst.assets - own));
  const shown = [...set.peers].sort((a, b) => distance(a) - distance(b) || a.id - b.id).slice(0, max);
  const publish: Partial<Record<ExplorerFeeKey, number>> = {};
  for (const key of EXPLORER_FEE_KEYS) publish[key] = set.peers.filter((peer) => peer.fees[key] !== undefined).length;
  const assets = set.peers.map((peer) => peer.assets).filter((v): v is number => v !== null && v > 0);
  const charters = charterKinds(set.peers);
  return {
    ...set,
    peers: shown,
    whole: {
      peers: set.peers.length,
      publish,
      states: [...new Set(set.peers.map((peer) => peer.state).filter((state): state is string => !!state))].sort(),
      assets: assets.length > 0 ? { min: Math.min(...assets), max: Math.max(...assets) } : null,
      ...(charters.length > 0 ? { charters } : {}),
    },
  };
}

/** "Showing the 50 closest in assets of 1,204 peers; medians use all 1,204." Null for an uncapped set. */
export function shownLine(set: PeerExplorerSet): string | null {
  if (!set.whole) return null;
  const total = set.whole.peers.toLocaleString("en-US");
  return `Showing the ${set.peers.length} closest in assets of ${total} peers; medians use all ${total}.`;
}

/** Peers publishing a fee across the whole set. */
export function publishingPeers(set: PeerExplorerSet, key: ExplorerFeeKey): number {
  return set.whole ? (set.whole.publish[key] ?? 0) : set.peers.filter((peer) => peer.fees[key] !== undefined).length;
}

function charterKinds(peers: ExplorerInstitution[]): string[] {
  return [...new Set(peers.map((peer) => peer.charter).filter((charter): charter is string => !!charter))].sort();
}

/** The peers' charters, the whole set's when capped; the subject's own when the peers carry none. */
function peerCharters(set: PeerExplorerSet): string[] {
  const kinds = set.whole?.charters ?? charterKinds(set.peers);
  return kinds.length > 0 ? kinds : set.charterType ? [set.charterType] : [];
}

function peerStates(set: PeerExplorerSet): string[] {
  return set.whole ? set.whole.states : [...new Set(set.peers.map((peer) => peer.state).filter((state): state is string => !!state))];
}

function peerAssetRange(set: PeerExplorerSet): { min: number; max: number } | null {
  if (set.whole) return set.whole.assets;
  const assets = set.peers.map((peer) => peer.assets).filter((v): v is number => v !== null && v > 0);
  return assets.length > 0 ? { min: Math.min(...assets), max: Math.max(...assets) } : null;
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
  return { selected: set.whole?.peers ?? set.peers.length, publish: publishingPeers(set, key) };
}

/**
 * Within this share of the median a fee is "about the same" as it: the site's one rule, as on the
 * state and district pages and the institution overview. Further than that is above or below.
 */
export const ABOUT_SAME_SHARE = 0.01;

/** The rule in words, shown once near each place the phrase is used. */
export const ABOUT_SAME_RULE = "About the same: within 1% of the median.";

/** True when a value is within 1% of the median (a zero median needs the value to be within 1 cent). */
export function aboutSameAsMedian(value: number, median: number): boolean {
  const gap = Math.abs(value - median);
  return median > 0 ? gap <= median * ABOUT_SAME_SHARE : gap < 0.005;
}

export type MatrixBand = "below" | "same" | "above" | "none";

/** A matrix cell's band against its column's peer median; "none" when the fee or the median is missing. */
export function matrixBand(value: number | undefined, median: number | undefined): MatrixBand {
  if (value === undefined || median === undefined) return "none";
  if (aboutSameAsMedian(value, median)) return "same";
  return value > median ? "above" : "below";
}

/**
 * "$1.55 below the peer median", or within 1% "About the same as the peer median: within 1% ($0.03 below)",
 * the matrix's own rule, so the panel and the matrix never classify one fee two ways.
 */
export function gapText(value: number, median: number): { direction: "below" | "above" | "same"; text: string } {
  const gap = value - median;
  if (aboutSameAsMedian(value, median)) {
    const detail = Math.abs(gap) < 0.005 ? "the same price" : `${money(Math.abs(gap))} ${gap > 0 ? "above" : "below"}`;
    return { direction: "same", text: `About the same as the peer median: within 1% (${detail})` };
  }
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

/** Words that follow a comparison price everywhere it appears: it stands in for several prices. */
export const PROXY_NOTE = "not a fee anyone is charged";

/**
 * True when a value is a constructed comparison price: built from two or more prices and equal to
 * none of them (the middle of an even count). The middle of an odd count, or overdraft's highest,
 * is one of the institution's own prices, so it is charged.
 */
export function isComparisonProxy(fee: ExplorerFee | undefined): boolean {
  const prices = fee?.prices ?? [];
  if (prices.length < 2 || !fee) return false;
  return prices.every((price) => Math.abs(price.amount - fee.amount) >= 0.005);
}

/**
 * The words for a value built from several prices. The account prices lead; this value is only the
 * comparison price the statistics contract counts: the middle of them, or for overdraft the highest.
 * A constructed one (equal to none of the prices) always says it is not charged. Null for a single price.
 */
export function comparisonLabel(key: ExplorerFeeKey, fee: ExplorerFee | undefined): string | null {
  const count = fee?.prices?.length ?? 0;
  if (count < 2) return null;
  const base = key === "overdraft" ? `Comparison price: highest of ${count} prices` : `Comparison price: middle of ${count} account prices`;
  return isComparisonProxy(fee) ? `${base}, ${PROXY_NOTE}` : base;
}

/** The short chart label for a value built from several prices: "comparison price, not charged to anyone". */
export function comparisonTag(key: ExplorerFeeKey, fee: ExplorerFee | undefined): string | null {
  if ((fee?.prices?.length ?? 0) < 2) return null;
  if (isComparisonProxy(fee)) return "comparison price, not charged to anyone";
  return key === "overdraft" ? "comparison price, its highest" : "comparison price, its middle price";
}

/** "+2.4%" / "-12%" / "0%": a value's difference from the median as a share of the median. */
export function signedPercent(value: number, median: number): string | null {
  if (median <= 0) return null;
  const pct = ((value - median) / median) * 100;
  if (Math.abs(pct) < 0.05) return "0%";
  const abs = Math.abs(pct);
  return `${pct > 0 ? "+" : "-"}${abs < 10 ? +abs.toFixed(1) : Math.round(abs)}%`;
}

const CHARTER_WORDS: Record<string, string> = { bank: "Banks", credit_union: "Credit unions" };

/**
 * Why these institutions belong, in plain words from the set itself: their charter, the range of
 * their total assets, and where they are headquartered.
 */
export function whyThesePeers(set: PeerExplorerSet, key?: string): string[] {
  const parts: string[] = [];
  const charters = peerCharters(set);
  const kind = charters.length === 1 ? CHARTER_WORDS[charters[0]] : null;
  if (charters.length > 1) parts.push("Banks and credit unions");
  else if (kind) parts.push(`${kind} only`);
  const range = peerAssetRange(set);
  if (range) {
    const low = assetsLabel(range.min);
    const high = assetsLabel(range.max);
    const words = low === high ? `${low}` : `${low} to ${high}`;
    // An asset-band set is titled by its band; the chip gives the peers' actual range inside it.
    parts.push(key === "size" ? `Actual range: ${words}` : `${words} in assets`);
  }
  const states = peerStates(set);
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
 * The set grouped by place. A metro set groups by the cities inside the metro where each
 * institution has a branch, so one institution can sit in several cities. Otherwise by
 * headquarters: by city when the whole set sits in one state, else by state. The subject's
 * group comes first, then the larger groups.
 */
export function locationGroups(set: PeerExplorerSet): { by: "branch" | "city" | "state"; groups: LocationGroup[] } {
  const everyone = [set.subject, ...set.peers];
  const byId = new Map(everyone.map((inst) => [inst.id, inst]));
  const sortGroups = (list: LocationGroup[]) => {
    for (const group of list) group.members.sort((a, b) => (b.assets ?? 0) - (a.assets ?? 0));
    const hasSubject = (g: LocationGroup) => (g.members.some((m) => m.id === set.subject.id) ? 1 : 0);
    return list.sort((a, b) => hasSubject(b) - hasSubject(a) || b.members.length - a.members.length || a.name.localeCompare(b.name));
  };
  const branchGroups = (set.market?.cities ?? [])
    .map((place) => ({
      key: `${place.city.toLowerCase()}|${place.state}`,
      name: `${displayCity(place.city)}, ${place.state}`,
      members: [...new Set(place.ids)].map((id) => byId.get(id)).filter((inst): inst is ExplorerInstitution => inst !== undefined),
    }))
    .filter((group) => group.members.length > 0);
  if (branchGroups.length > 0) return { by: "branch", groups: sortGroups(branchGroups) };
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
  return { by, groups: sortGroups([...groups.values()]) };
}

/**
 * Locations circle sizes in pixels: a fee at the median gets `min`, the set's largest dollar gap
 * gets `max`; a fee the institution does not publish is a smaller hollow marker (`empty`).
 */
export const LOCATION_RADIUS = { min: 5, max: 18, empty: 4 } as const;

/** A circle's radius for a dollar gap: area grows with the gap above the smallest circle. */
export function gapRadius(gap: number, maxGap: number): number {
  const { min, max } = LOCATION_RADIUS;
  if (maxGap <= 0 || gap <= 0) return min;
  return Math.sqrt(min * min + (max * max - min * min) * Math.min(1, gap / maxGap));
}

export type LocationMarker =
  | { kind: "gap"; band: "above" | "below" | "same"; gap: number; r: number }
  | { kind: "no-median"; r: number }
  | { kind: "not-published"; r: number };

/** The largest dollar gap to the median among the institutions on the page, 0 without a median. */
function largestGap(set: PeerExplorerSet, fee: ExplorerFeeKey): number {
  const median = set.medians[fee]?.median;
  if (median === undefined) return 0;
  const gaps = [set.subject, ...set.peers].map((inst) => inst.fees[fee]?.amount).filter((v): v is number => v !== undefined).map((v) => Math.abs(v - median));
  return Math.max(0, ...gaps);
}

/**
 * One institution's Locations marker for a fee (James, 2026-10-20; tracker #1811): sized by its
 * dollar gap to the peer median, coloured by side (the shared above/below pair; within 1% is
 * about the same), hollow and small when it does not publish the fee, one neutral size when the
 * set has too few publishing peers for a median.
 */
export function locationMarker(set: PeerExplorerSet, fee: ExplorerFeeKey, inst: ExplorerInstitution): LocationMarker {
  return locationMarkers(set, fee)(inst);
}

/** Every marker of one view, scaled to the set's largest gap, which is found once, not per marker. */
export function locationMarkers(set: PeerExplorerSet, fee: ExplorerFeeKey): (inst: ExplorerInstitution) => LocationMarker {
  const median = set.medians[fee]?.median;
  const maxGap = largestGap(set, fee);
  return (inst) => {
    const value = inst.fees[fee]?.amount;
    if (value === undefined) return { kind: "not-published", r: LOCATION_RADIUS.empty };
    if (median === undefined) return { kind: "no-median", r: LOCATION_RADIUS.min };
    const band = matrixBand(value, median) as "above" | "below" | "same";
    const gap = Math.round((value - median) * 100) / 100;
    return { kind: "gap", band, gap, r: gapRadius(Math.abs(gap), maxGap) };
  };
}

/** The size legend: the largest gap on the page and half of it, in dollars. Empty with no gap to show. */
export function locationGapLegend(set: PeerExplorerSet, fee: ExplorerFeeKey): { gap: number; r: number; label: string }[] {
  const max = Math.round(largestGap(set, fee) * 100) / 100;
  if (max < 0.01) return [];
  const half = Math.round((max / 2) * 100) / 100;
  return [
    { gap: max, r: gapRadius(max, max), label: money(max) },
    ...(half >= 0.01 && half < max ? [{ gap: half, r: gapRadius(half, max), label: money(half) }] : []),
  ];
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

/** Fired when the explorer's fee or view changes; its detail is { fee, view }. */
export const PEER_EXPLORER_STATE_EVENT = "peer-explorer-state";

/**
 * A peer-set link carrying the explorer's current fee and view (?pfee=, ?pview=), so choosing
 * another set keeps them. The fee is always written: the default fee can differ between sets. The
 * selected peer is left out: it may not be in the new set.
 */
export function carryExplorerState(href: string, state: { fee: string; view: string }): string {
  const target = new URL(href, "https://fee.invalid");
  target.searchParams.set("pfee", state.fee);
  if (state.view === "distribution") target.searchParams.delete("pview");
  else target.searchParams.set("pview", state.view);
  return `${target.pathname}${target.search}${target.hash}`;
}

/** The views a visitor switches between. */
export const EXPLORER_VIEWS = ["distribution", "landscape", "locations", "matrix"] as const;
export type ExplorerView = (typeof EXPLORER_VIEWS)[number];

export function isExplorerView(value: unknown): value is ExplorerView {
  return typeof value === "string" && (EXPLORER_VIEWS as readonly string[]).includes(value);
}

/**
 * The Hamilton peer-set page with this set filled in: the subject (instId), the peers by id when
 * Hamilton can hold them (a saved set takes at most MAX_CHOSEN_PEERS), and the set's name.
 * Hamilton routes a visitor who is not signed in itself.
 */
export function hamiltonPeerSetHref(subjectId: number, peerIds: number[], name: string, fee?: ExplorerFeeKey, asOf?: string | null): string {
  const params = new URLSearchParams({ instId: String(subjectId) });
  const ids = [...new Set(peerIds)].filter((id) => Number.isSafeInteger(id) && id > 0);
  if (ids.length > 0 && ids.length <= MAX_CHOSEN_PEERS) params.set("peers", ids.join(","));
  if (name) params.set("name", name);
  if (fee) params.set("fee", fee);
  if (asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf)) params.set("asof", asOf);
  return `/pro/settings?${params.toString()}#peer-sets`;
}

/** What each peer set is for: comparing published prices, or the local market a bank competes in. */
export const PEER_SET_PURPOSE_GROUP: Record<string, "Pricing peers" | "Market competitors"> = {
  nearest: "Pricing peers",
  size: "Pricing peers",
  regulator: "Pricing peers",
  state: "Pricing peers",
  district: "Pricing peers",
  metro: "Market competitors",
  metro_banks: "Market competitors",
};

/**
 * The home metro's banks-only view (?peers=metro_banks). It is not a chip of its own: it is a
 * toggle inside the Home metro chip, and the page never opens on it by default.
 */
export const BANKS_ONLY_METRO_KEY = "metro_banks";

/** A set offered only as a filter on another set's chip, keyed by that chip. */
const PEER_SET_VARIANT_OF: Record<string, string> = { [BANKS_ONLY_METRO_KEY]: "metro" };

export function isPeerSetVariant(key: string): boolean {
  return key in PEER_SET_VARIANT_OF;
}

/** The chip a set is shown under: its own, or the set it filters. */
export function peerSetChipKey(key: string): string {
  return PEER_SET_VARIANT_OF[key] ?? key;
}

/** The home metro set, with or without its credit unions. */
export function isHomeMetroKey(key: string): boolean {
  return peerSetChipKey(key) === "metro";
}

/**
 * Whether the home metro set holds a credit union, read from the two views' counts: the
 * banks-only view is the same set without credit unions, so equal counts mean none. With no
 * banks-only view offered (no bank there publishes fees), every member is a credit union.
 */
export function homeMetroHasCreditUnions(options: { key: string; count?: number }[]): boolean {
  const all = options.find((option) => option.key === "metro");
  if (!all) return false;
  const banks = options.find((option) => option.key === BANKS_ONLY_METRO_KEY);
  return !banks || banks.count !== all.count;
}

/** How the home metro set finds its members: banks by branch, credit unions by city. */
export const HOME_METRO_NOTE =
  "Banks are counted by their branches in the metro (FDIC Summary of Deposits). Credit unions report no deposits by branch, so a credit union is counted when it has a branch in one of the metro's cities (NCUA branch file).";

/**
 * One line on what the chosen set is for, with its geography made explicit: "Banks of similar
 * size, for comparing published prices. Not local competitors: they're spread over 15 states."
 */
export function purposeLine(key: string, set: PeerExplorerSet): string {
  const kind = set.charterType === "credit_union" ? "Credit unions" : "Banks";
  const states = peerStates(set);
  const spread =
    states.length > 1
      ? ` Not local competitors: they're spread over ${states.length} states.`
      : states.length === 1
        ? ` All are headquartered in ${STATE_NAMES[states[0]] ?? states[0]}.`
        : "";
  switch (key) {
    case "metro":
    case BANKS_ONLY_METRO_KEY:
      return `${key === "metro" && set.peers.some((peer) => peer.charter === "credit_union") ? "Banks and credit unions" : "Banks"} with branches in the ${set.market?.name ? `${set.market.name} ` : "home "}metro: the local competitors for deposits and customers. They range from ${assetRangeWords(set)} in assets, so compare prices here, not size.`;
    case "nearest":
      return `${kind} of similar size, for comparing published prices.${spread}`;
    case "size":
      return `${kind} in the same asset-size band that publish fees, for comparing published prices.${spread} A pricing set: it is not the financial cohort under Financial performance, which is drawn from Call Report filings in the band.`;
    case "regulator":
      return `${kind} with the same ${set.charterType === "credit_union" ? "charter" : "primary regulator"}, for comparing published prices.${spread}`;
    case "state":
    case "district":
      return `${kind} headquartered in the same ${key === "state" ? "state" : "Fed district"}, for comparing published prices.`;
    default:
      return `${kind} for comparing published prices.${spread}`;
  }
}

function assetRangeWords(set: PeerExplorerSet): string {
  const range = peerAssetRange(set);
  if (!range) return "unknown";
  return `${assetsLabel(range.min)} to ${assetsLabel(range.max)}`;
}

/**
 * The one line above the matrix: where the subject sits across the compared fees and its largest
 * dollar gap. Only fees with both a value and a peer median count.
 */
export function matrixSummary(set: PeerExplorerSet): string {
  const compared = EXPLORER_FEE_KEYS.flatMap((key) => {
    const own = set.subject.fees[key]?.amount;
    const median = set.medians[key]?.median;
    return own === undefined || median === undefined ? [] : [{ key, gap: own - median, band: matrixBand(own, median) }];
  });
  const name = set.subject.name;
  if (compared.length === 0) return `${name} has no fee here with enough peers publishing it for a median.`;
  const above = compared.filter((c) => c.band === "above").length;
  const below = compared.filter((c) => c.band === "below").length;
  const same = compared.length - above - below;
  const of = `${compared.length} compared ${compared.length === 1 ? "fee" : "fees"}`;
  const largest = [...compared].sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))[0];
  const gap = Math.abs(largest.gap) < 0.005 ? "" : ` Largest gap: ${EXPLORER_FEE_LABELS[largest.key]}, ${signedMoney(largest.gap)}.`;
  return `Of ${of}, ${name} is above the peer median on ${above}, below on ${below} and about the same on ${same}.${gap}`;
}

/** "+$0.4B", "-$120M", "Same": an institution's total assets against the subject's. */
export function assetDifference(assets: number | null, subjectAssets: number | null): string {
  if (assets === null || subjectAssets === null) return "Not on record";
  const gap = assets - subjectAssets;
  if (Math.abs(gap) < 5e5) return "Same";
  return `${gap > 0 ? "+" : "-"}${assetsLabel(Math.abs(gap))}`;
}

/** "+$1.20" / "-$0.50" / "$0": a fee's dollar difference from the peer median. */
export function signedMoney(gap: number): string {
  if (Math.abs(gap) < 0.005) return "$0";
  return `${gap > 0 ? "+" : "-"}${money(Math.abs(gap))}`;
}

/** The share of the cohort's values below this one, counting ties as half (0 to 1). */
export function percentileRank(value: number, values: number[]): number {
  if (values.length === 0) return 0.5;
  let below = 0;
  let same = 0;
  for (const v of values) {
    if (Math.abs(v - value) < 0.005) same += 1;
    else if (v < value) below += 1;
  }
  return (below + same / 2) / values.length;
}

/**
 * A matrix cell's shading: its band against the median (the 1% rule) and how far into the
 * cohort's tail it sits by percentile, 1 (toward the middle) to 3 (the far end).
 */
export function cellShade(value: number | undefined, values: number[], median: number | undefined): { band: MatrixBand; step: 0 | 1 | 2 | 3 } {
  const band = matrixBand(value, median);
  if (band === "none" || band === "same" || value === undefined) return { band, step: 0 };
  const distance = Math.abs(percentileRank(value, values) - 0.5);
  return { band, step: distance >= 0.4 ? 3 : distance >= 0.25 ? 2 : 1 };
}

export interface Distribution {
  /** The values drawn to scale. */
  shown: number[];
  /** Values far outside the rest (beyond three interquartile ranges), drawn past an axis break when not included. */
  outliers: number[];
}

/**
 * Splits a fee's values into those drawn to scale and far outliers. Outliers are only split off
 * when not included and with at least five values; nothing is ever dropped, the caller draws them
 * past an axis break with their amounts.
 */
export function splitOutliers(values: number[], include: boolean): Distribution {
  const sorted = [...values].sort((a, b) => a - b);
  if (include || sorted.length < 5) return { shown: sorted, outliers: [] };
  const q = (p: number) => {
    const idx = p * (sorted.length - 1);
    const lo = Math.floor(idx);
    return sorted[lo] + (idx - lo) * (sorted[Math.ceil(idx)] - sorted[lo]);
  };
  const iqr = Math.max(q(0.75) - q(0.25), 0.01);
  const high = q(0.75) + 3 * iqr;
  const low = q(0.25) - 3 * iqr;
  return { shown: sorted.filter((v) => v >= low && v <= high), outliers: sorted.filter((v) => v < low || v > high) };
}

export type MatrixSortKey = "name" | "state" | "assets" | ExplorerFeeKey;

/**
 * The matrix rows, the subject always first, the rest sorted by name, state, total assets, or a
 * fee's dollar difference from its peer median (institutions without the fee last).
 */
export function sortMatrixRows(set: PeerExplorerSet, key: MatrixSortKey, direction: "asc" | "desc"): ExplorerInstitution[] {
  const sign = direction === "asc" ? 1 : -1;
  const byName = (a: ExplorerInstitution, b: ExplorerInstitution) => a.name.localeCompare(b.name);
  const peers = [...set.peers].sort((a, b) => {
    if (key === "name") return sign * byName(a, b);
    if (key === "state") return sign * (a.state ?? "").localeCompare(b.state ?? "") || byName(a, b);
    if (key === "assets") {
      if (a.assets === null || b.assets === null) return (a.assets === null ? 1 : 0) - (b.assets === null ? 1 : 0) || byName(a, b);
      return sign * (a.assets - b.assets) || byName(a, b);
    }
    const va = a.fees[key]?.amount;
    const vb = b.fees[key]?.amount;
    if (va === undefined || vb === undefined) return (va === undefined ? 1 : 0) - (vb === undefined ? 1 : 0) || byName(a, b);
    return sign * (va - vb) || byName(a, b);
  });
  return [set.subject, ...peers];
}

/** Landscape's horizontal measures; the metro ones only exist for a metro set. */
export type LandscapeAxis = "assets" | "branches" | "share";

export const LANDSCAPE_AXIS_LABELS: Record<LandscapeAxis, string> = {
  assets: "Total assets",
  branches: "Branches in the metro",
  share: "Share of metro deposits",
};

/** The axes a set can offer: assets always; branches and deposit share when the metro's branch records are there. */
export function landscapeAxes(set: PeerExplorerSet): LandscapeAxis[] {
  const presence = set.market?.presence;
  if (!presence || Object.keys(presence).length === 0) return ["assets"];
  const hasShare = (set.market?.totalDeposits ?? 0) > 0 && Object.values(presence).some((p) => p.deposits !== null);
  return hasShare ? ["assets", "branches", "share"] : ["assets", "branches"];
}

/** An institution's position on a Landscape axis, or null when it has none on record. */
export function landscapeValue(set: PeerExplorerSet, inst: ExplorerInstitution, axis: LandscapeAxis): number | null {
  if (axis === "assets") return inst.assets;
  const presence = set.market?.presence?.[inst.id];
  if (!presence) return null;
  if (axis === "branches") return presence.branches;
  const total = set.market?.totalDeposits ?? 0;
  return presence.deposits !== null && total > 0 ? presence.deposits / total : null;
}

const COUNT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

function listWords(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Who the set's peers are, in the snapshot's words: "similar-sized banks", "local competitors". */
export function snapshotPeersNoun(key: string, set: PeerExplorerSet): string {
  const kind = set.charterType === "credit_union" ? "credit unions" : "banks";
  switch (key) {
    case "nearest":
    case "size":
      return `similar-sized ${kind}`;
    case "metro":
      return "local competitors";
    case BANKS_ONLY_METRO_KEY:
      return "local banks";
    case "state":
      return set.subject.state ? `${kind} in ${STATE_NAMES[set.subject.state] ?? set.subject.state}` : `${kind} in its state`;
    case "district":
      return `${kind} in its Fed district`;
    case "regulator":
      return set.charterType === "credit_union" ? "credit unions with the same charter" : "banks with the same primary regulator";
    default:
      return `peer ${kind}`;
  }
}

export interface PeerSnapshot {
  /** One plain conclusion: broadly aligned (within 1%), or above or below with the dollar and percent gap. */
  headline: string;
  /** The facts behind it, one sentence each: the compared value against the median, the account prices, the proxy note. */
  facts: string[];
  caveat: string;
}

/** The caveat under every snapshot: what published prices leave out. */
export const SNAPSHOT_CAVEAT = "This describes published pricing only. Account mix, waivers and actual fee revenue are not represented.";

/** "2.4%", "12%": a gap's share of the median, for the snapshot's headline. */
function percentWords(gap: number, median: number): string {
  const pct = Math.abs(gap / median) * 100;
  return `${pct < 10 ? +pct.toFixed(1) : Math.round(pct)}%`;
}

/**
 * The interpretation panel above the views: one sentence on where the institution's published
 * price sits against the chosen set's median, the facts behind it, and the caveat. Fixed templates
 * on live values and the 1% rule (within it, "broadly aligned"); never a recommendation or a cause.
 */
export function peerSnapshot(set: PeerExplorerSet, key: string, fee: ExplorerFeeKey): PeerSnapshot {
  const label = EXPLORER_FEE_LABELS[fee];
  const lower = label.replace(/^[A-Z][a-z]/, (m) => m.toLowerCase());
  const aFee = `${/^[aeiou]/i.test(lower) ? "an" : "a"} ${lower} fee`;
  const noun = snapshotPeersNoun(key, set);
  const own = set.subject.fees[fee];
  const median = set.medians[fee];
  const publishing = publishingPeers(set, fee);
  const peersWord = (n: number) => `${n.toLocaleString("en-US")} publishing ${n === 1 ? "peer" : "peers"}`;
  if (!own) {
    return {
      headline: `${set.subject.name} does not publish ${aFee} in the index.`,
      facts: [median ? `The peer median is ${money(median.median)} among ${peersWord(median.peers)}.` : `${capitalize(peersWord(publishing))}, too few for a median.`],
      caveat: SNAPSHOT_CAVEAT,
    };
  }
  const prices = own.prices ?? [];
  const several = prices.length >= 2;
  const count = COUNT_WORDS[prices.length] ?? String(prices.length);
  const which = fee === "overdraft" ? "the highest" : "the middle";
  const kindWord = fee === "monthly_maintenance" ? "checking " : "";
  // The value compared: "Compared at $8.45, the middle of its two prices", or the one published price.
  const compared = several ? `Compared at ${money(own.amount)}, ${which} of its ${count} prices` : `Its published price is ${money(own.amount)}`;
  const priceLine = several ? `Its ${count} ${kindWord}prices are ${listWords(prices.map((p) => money(p.amount)))}.` : null;
  const proxyLine = isComparisonProxy(own) ? `${money(own.amount)} is a comparison price, ${PROXY_NOTE}.` : null;
  const extra = [priceLine, proxyLine].filter((line): line is string => line !== null);
  if (!median) {
    return {
      headline: `Too few ${noun} publish ${aFee} for a median.`,
      facts: [`${compared}; ${peersWord(publishing)}.`, ...extra],
      caveat: SNAPSHOT_CAVEAT,
    };
  }
  const gap = own.amount - median.median;
  const headline = aboutSameAsMedian(own.amount, median.median)
    ? `${label} is broadly aligned with ${noun}: within 1% of their median.`
    : `${label} is ${money(Math.abs(gap))} (${percentWords(gap, median.median)}) ${gap > 0 ? "above" : "below"} the median of ${noun}.`;
  return {
    headline,
    facts: [`${compared}, against a peer median of ${money(median.median)} among ${peersWord(median.peers)}.`, ...extra],
    caveat: SNAPSHOT_CAVEAT,
  };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export interface RosterPricingRow {
  id: number;
  name: string;
  subject: boolean;
  /** The value compared (null when not published). */
  amount: number | null;
  /** True when the amount is a constructed comparison price, not one anyone is charged. */
  proxy: boolean;
  /** The institution's own prices behind the value, when it has more than one. */
  prices: number[];
  /** Difference from the peer median in dollars and as a share, and its band; null without both values. */
  gap: { dollars: string; percent: string | null; band: MatrixBand } | null;
  source: { url: string | null; published: string | null } | null;
}

/**
 * The roster's Pricing view: for the same institutions in the same order as its coverage view (the
 * subject, then the peers by name), the selected fee's value, its difference from the peer median
 * and the schedule it was read from.
 */
export function rosterPricing(set: PeerExplorerSet, fee: ExplorerFeeKey): RosterPricingRow[] {
  const median = set.medians[fee]?.median;
  return rosterOrder(set).map((inst) => {
    const own = inst.fees[fee];
    return {
      id: inst.id,
      name: inst.name,
      subject: inst.id === set.subject.id,
      amount: own ? own.amount : null,
      proxy: isComparisonProxy(own),
      prices: (own?.prices?.length ?? 0) >= 2 ? own!.prices!.map((p) => p.amount) : [],
      gap:
        own && median !== undefined
          ? { dollars: signedMoney(own.amount - median), percent: signedPercent(own.amount, median), band: matrixBand(own.amount, median) }
          : null,
      source: own?.source ?? null,
    };
  });
}

/** The roster's one order, shared by its coverage and pricing views: the subject, then the peers by name. */
export function rosterOrder(set: PeerExplorerSet): ExplorerInstitution[] {
  return [set.subject, ...[...set.peers].sort((a, b) => a.name.localeCompare(b.name))];
}

/**
 * The hand-off preview: the set a visitor brings to Hamilton, in plain words. Hamilton opens for
 * the institution; these rows say what to bring, never that the link loads them.
 */
export function briefingSet(set: PeerExplorerSet, setName: string, fee: ExplorerFeeKey, scope: string): { label: string; value: string }[] {
  const total = set.whole?.peers ?? set.peers.length;
  const names = set.peers.slice(0, 6).map((peer) => peer.name);
  const rest = total - names.length;
  return [
    { label: "Peer set", value: setName },
    {
      label: "Peers",
      value: `${total.toLocaleString("en-US")}: ${listWords(names.concat(rest > 0 ? [`${rest.toLocaleString("en-US")} more, listed on this page`] : []))}`,
    },
    { label: "Fee", value: EXPLORER_FEE_LABELS[fee] },
    { label: "Comparison", value: scope },
    { label: "Data as of", value: set.asOf ? formatIsoDate(set.asOf) : "Not on record" },
  ];
}

/** "Oct 17, 2026" from an ISO date. */
export function formatIsoDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
