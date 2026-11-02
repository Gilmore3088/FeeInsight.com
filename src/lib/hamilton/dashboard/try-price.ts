/**
 * Try a price dashboard (Nov 2026 redesign): the pure helpers behind the interactive screen. Where a
 * proposed price lands in a comparison group, the dot plot's stacks, the slider's range and the
 * fee income arithmetic on the bank's own typed figures. No React and no server imports, so the
 * page builds the data on the server and the client recomputes the same figures as the slider moves.
 *
 * Hamilton's median rule (James, 2026-10-25) holds here too: a percentile, median or middle half
 * needs 10 institutions (5 in the local market); a thinner group shows its spread and says too few.
 */
import { midRankPercentile, SAME_PRICE_TOLERANCE } from "@/lib/percentile";
import { feePosition, type FeePosition } from "@/components/hamilton/dashboard/format";

/** One comparison group as the screen shows it: a market layer's published prices, the bank left out. */
export interface TryPriceGroup {
  key: string;
  /** "Florida", "Peer group", "Your market", "National". */
  label: string;
  /** Who is in it, one line. */
  scope: string;
  n: number;
  /** Institutions a median needs here. */
  minPeers: number;
  thin: boolean;
  /** One value per institution, lowest first. */
  amounts: number[];
  p25: number | null;
  median: number | null;
  p75: number | null;
  /**
   * The institutions in the group, by id, when the layer lists every one of them (members at
   * least n); null when it does not, so the dot plot cannot tell which institutions are peers.
   */
  memberIds: number[] | null;
}

export interface PricePlacement {
  n: number;
  more: number;
  same: number;
  less: number;
  /** Mid-rank percentile (#2048), whole number; null when the group is too thin for one. */
  percentile: number | null;
  /** Against the group's middle half; `too_few` below the median minimum. */
  position: FeePosition;
  min: number | null;
  max: number | null;
}

/** Where a price lands in a group: how many charge more, the same and less, and its percentile. */
export function placePrice(group: Pick<TryPriceGroup, "amounts" | "thin" | "p25" | "p75">, price: number): PricePlacement {
  let more = 0;
  let same = 0;
  let less = 0;
  for (const a of group.amounts) {
    if (Math.abs(a - price) <= SAME_PRICE_TOLERANCE) same++;
    else if (a > price) more++;
    else less++;
  }
  const n = group.amounts.length;
  return {
    n,
    more,
    same,
    less,
    percentile: group.thin ? null : midRankPercentile(price, group.amounts),
    position: group.thin ? "too_few" : feePosition(price, group),
    min: n ? Math.min(...group.amounts) : null,
    max: n ? Math.max(...group.amounts) : null,
  };
}

/** "1st", "22nd", "63rd", "11th". */
export function ordinal(n: number): string {
  const m = n % 100;
  if (m >= 11 && m <= 13) return `${n}th`;
  const e = n % 10;
  return `${n}${e === 1 ? "st" : e === 2 ? "nd" : e === 3 ? "rd" : "th"}`;
}

/** A round top for the price axis: whole dollars under $5, then steps of 5, 10 and 50. */
export function niceCeil(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 5;
  if (value <= 5) return Math.ceil(value);
  if (value <= 20) return Math.ceil(value / 5) * 5;
  if (value <= 100) return Math.ceil(value / 10) * 10;
  return Math.ceil(value / 50) * 50;
}

function q95(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((s.length - 1) * 0.95))];
}

/**
 * The slider's range: from $0 to a round figure above today's price, the price being tested and
 * nearly every group's prices (the top 5% of a large group, often one-off outliers, can sit off the
 * scale at its right edge). The step is 5 cents under $10, else 50 cents.
 */
export function sliderRange(groups: readonly Pick<TryPriceGroup, "amounts">[], current: number | null, proposed: number): { max: number; step: number } {
  const top = Math.max(current ?? 0, proposed, ...groups.map((g) => q95(g.amounts)));
  const max = niceCeil(top * 1.15);
  return { max, step: max <= 10 ? 0.05 : 0.5 };
}

export interface DotColumn {
  /** Left edge of the column as a share of the axis, 0 to 100. */
  x: number;
  /** Dots to draw, each `perDot` institutions; `peers` of them are the bank's peer group. */
  dots: number;
  peers: number;
  /** Institutions in the column. */
  count: number;
}

export interface DotPlot {
  columns: DotColumn[];
  /** Institutions each dot stands for: 1 for a small group. */
  perDot: number;
  /** The tallest stack, in dots. */
  tallest: number;
  /** Institutions priced above the axis, drawn at its right edge. */
  offScale: number;
}

/**
 * The dot plot's stacks: prices binned into `bins` columns across $0 to `max`, one dot per
 * institution up to `maxStack` dots high, after which each dot stands for several institutions.
 * `peerAmounts` colour as many dots in each column as peers sit there. They must be the prices of
 * peers that are members of this group (`peerDotAmounts`): a price alone says nothing about who
 * charges it, so a peer elsewhere would otherwise darken a member's dot that merely shares it.
 */
export function dotPlot(amounts: readonly number[], max: number, peerAmounts: readonly number[] = [], bins = 60, maxStack = 14): DotPlot {
  const width = max / bins;
  const binOf = (v: number) => Math.max(0, Math.min(bins - 1, Math.floor(v / width + 1e-9)));
  const counts = new Map<number, number>();
  const peerCounts = new Map<number, number>();
  let offScale = 0;
  for (const a of amounts) {
    if (a > max) offScale++;
    const b = binOf(a);
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  // A peer counts in a column only up to that column's institutions.
  for (const a of peerAmounts) {
    const b = binOf(a);
    if ((peerCounts.get(b) ?? 0) < (counts.get(b) ?? 0)) peerCounts.set(b, (peerCounts.get(b) ?? 0) + 1);
  }
  const biggest = Math.max(0, ...counts.values());
  const perDot = Math.max(1, Math.ceil(biggest / maxStack));
  const columns = [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([b, count]) => {
      const peers = peerCounts.get(b) ?? 0;
      return { x: ((b + 0.5) / bins) * 100, count, dots: Math.ceil(count / perDot), peers: Math.min(Math.ceil(count / perDot), Math.ceil(peers / perDot)) };
    });
  return { columns, perDot, tallest: Math.max(0, ...columns.map((c) => c.dots)), offScale };
}

/** The peer group as the dot plot reads it: each listed peer's id and price, and every counted price. */
export interface PeerDotInput {
  members: readonly { id: number; amount: number }[];
  amounts: readonly number[];
}

/**
 * The prices of the peers that are members of the group shown, for the dot plot to colour; null
 * when the plot shows no peer dots (and so no legend entry for them). On the peer group itself
 * every dot is a peer, so none is singled out. Nationally every peer is a member, so all their
 * prices count. Elsewhere a peer counts only when the group lists it by id; without a complete
 * list, membership cannot be checked and no dot is coloured.
 */
export function peerDotAmounts(group: Pick<TryPriceGroup, "key" | "memberIds">, peers: PeerDotInput | null): number[] | null {
  if (!peers || group.key === "peers") return null;
  if (group.key === "national") return peers.amounts.length > 0 ? [...peers.amounts] : null;
  if (!group.memberIds || peers.members.length === 0) return null;
  const ids = new Set(group.memberIds);
  const inGroup = peers.members.filter((m) => ids.has(m.id)).map((m) => m.amount);
  return inGroup.length > 0 ? inGroup : null;
}

/** A typed yearly count ("14,500"): a whole number above zero, else null. */
export function parseItems(text: string): number | null {
  const t = text.replace(/[,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Math.round(Number(t));
  return n > 0 ? n : null;
}

/** A typed waived share in percent ("12" or "12%"), as 0 to 1; empty means none. */
export function parseWaiver(text: string): number | null {
  const t = text.trim().replace(/%$/, "");
  if (t === "") return null;
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return n >= 0 && n <= 100 ? n / 100 : null;
}

/**
 * The yearly change in fee income from the bank's own figures: change per item, times items
 * charged a year, times the share not waived. Arithmetic before any change in customer behaviour,
 * never a prediction. Null without a yearly count.
 */
export function yearlyChange(current: number | null, proposed: number, items: number | null, waiver: number | null): number | null {
  if (items == null || items <= 0) return null;
  const share = waiver == null ? 1 : 1 - Math.min(Math.max(waiver, 0), 1);
  return Math.round((proposed - (current ?? 0)) * items * share);
}

/**
 * The opening price: a saved scenario's, a checked one, the first price the reader typed that
 * differs from today, else today's (so the screen opens at "no change"), else $0.
 */
export function openingPrice(input: { saved: number | null; checked: number | null; typed: readonly number[]; current: number | null }): number {
  if (input.saved != null && Number.isFinite(input.saved)) return input.saved;
  if (input.checked != null && Number.isFinite(input.checked)) return input.checked;
  return input.typed.find((p) => p !== input.current) ?? input.current ?? 0;
}

/** What `tryPriceGroups` and `peerStrip` read of a market layer (LayerSummary). */
export interface LayerInput {
  key: string;
  label: string;
  scope: string;
  n: number;
  minPeers: number;
  thin: boolean;
  amounts: number[];
  p25: number | null;
  median: number | null;
  p75: number | null;
  members?: readonly MemberInput[];
}

/** What `peerStrip` reads of one institution (PeerValue). */
export interface MemberInput {
  institutionId: number;
  institutionName: string;
  amount: number;
  several?: { low: number; high: number } | null;
}

/** The layers with any published price, nearest first, as the screen's comparison groups. */
export function tryPriceGroups(layers: readonly LayerInput[]): TryPriceGroup[] {
  return layers
    .filter((l) => l.amounts.length > 0)
    .map((l) => ({
      key: l.key,
      label: l.label,
      scope: l.scope,
      n: l.n,
      minPeers: l.minPeers,
      thin: l.thin,
      amounts: [...l.amounts].sort((a, b) => a - b),
      p25: l.thin ? null : l.p25,
      median: l.thin ? null : l.median,
      p75: l.thin ? null : l.p75,
      memberIds: l.members && l.members.length > 0 && l.members.length >= l.n ? l.members.map((m) => m.institutionId) : null,
    }));
}

/**
 * The group the screen opens on: the state when it has a median (the market a community bank
 * prices against), else the peer group, else the first group with a median, else the first group.
 */
export function openingGroup(groups: readonly Pick<TryPriceGroup, "key" | "thin">[]): string | null {
  for (const key of ["state", "peers"]) if (groups.some((g) => g.key === key && !g.thin)) return key;
  return groups.find((g) => !g.thin)?.key ?? groups[0]?.key ?? null;
}

export interface PeerTile {
  id: number;
  name: string;
  /** The value counted for the institution; for several fees, their median. */
  amount: number;
  /** The price as stated: "$35", or a range when the schedule states several fees. */
  label: string;
}

/** Most tiles the strip shows; a bigger peer group is summed up in the readouts and the chart. */
export const PEER_STRIP_MAX = 12;

/**
 * The peers' prices strip: the peer group when it is the bank's own saved group or small enough to
 * show whole, else the bank's local competitors (largest market deposits first). Never names an
 * institution the site never names. Null when neither can be listed.
 */
export function peerStrip(input: {
  peers: Pick<LayerInput, "members"> | null;
  peersSaved: boolean;
  local: readonly MemberInput[] | null;
  never: (name: string) => boolean;
  money: (n: number) => string;
}): { title: string; tiles: PeerTile[]; more: number } | null {
  const tile = (m: MemberInput): PeerTile => ({
    id: m.institutionId,
    name: m.institutionName,
    amount: m.amount,
    label: m.several ? `${input.money(m.several.low)} to ${input.money(m.several.high)}` : input.money(m.amount),
  });
  const listed = (members: readonly MemberInput[]) => members.filter((m) => !input.never(m.institutionName));
  const peerMembers = input.peers?.members ?? [];
  if (peerMembers.length > 0 && (input.peersSaved || peerMembers.length <= PEER_STRIP_MAX)) {
    const shown = listed(peerMembers).sort((a, b) => a.amount - b.amount || a.institutionName.localeCompare(b.institutionName));
    return { title: input.peersSaved ? "Your saved peers" : "Your peer group", tiles: shown.slice(0, PEER_STRIP_MAX).map(tile), more: Math.max(0, shown.length - PEER_STRIP_MAX) };
  }
  if (input.local && input.local.length > 0) {
    const shown = listed(input.local);
    return { title: "Your local competitors", tiles: shown.slice(0, 8).map(tile), more: Math.max(0, shown.length - 8) };
  }
  return null;
}
