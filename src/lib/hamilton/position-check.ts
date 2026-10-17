/**
 * Position check: where one proposed fee would sit among a bank's peers. Pure and client-safe.
 *
 * It reports the percentile, how many peers charge less, the same or more, and the named peers
 * just below and just above the price, each with the published amount Hamilton holds for them.
 * It never says whether the price is a good one: the reader brings the price, Hamilton places it.
 */
import { MIN_PEERS_FOR_POSITION, placeAmong, pricePosition } from "./workspace/scenario";

/** Two amounts within half a cent are the same price. */
const SAME = 0.005;
/** Named peers shown on each side; the rest are counted. */
export const POSITION_NEIGHBOURS = 3;

export interface PositionPeer {
  institutionId: number;
  name: string;
  /** The peer's comparison value for the fee (one per institution). */
  amount: number;
  publishedAt?: string | null;
  documentUrl?: string | null;
}

export interface PositionNeighbours {
  /** The nearest published amount on this side of the proposed price. */
  amount: number;
  /** Every peer at that amount, by name. */
  peers: PositionPeer[];
}

export interface PositionCheck {
  proposed: number;
  /** Peers compared (the bank itself is never among them). */
  n: number;
  less: number;
  same: number;
  more: number;
  /** Mid-rank percentile; null below MIN_PEERS_FOR_POSITION peers. */
  percentile: number | null;
  /** "at the 62nd percentile of 14 peers", or why there is none. */
  placement: string;
  below: PositionNeighbours | null;
  above: PositionNeighbours | null;
  /** Peers charging exactly the proposed price. */
  atPrice: PositionPeer[];
}

/** A typed price: "$35", "35.00", "2.5". Null for anything else, a negative or an absurd figure. */
export function parseProposedFee(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const text = raw.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 && value <= 10_000 ? value : null;
}

function byName(a: PositionPeer, b: PositionPeer): number {
  return a.name.localeCompare(b.name);
}

export function checkPosition(proposed: number, peers: readonly PositionPeer[]): PositionCheck {
  const amounts = peers.map((p) => p.amount);
  let less = 0;
  let same = 0;
  let more = 0;
  for (const a of amounts) {
    if (Math.abs(a - proposed) <= SAME) same++;
    else if (a < proposed) less++;
    else more++;
  }
  const n = peers.length;
  const percentile = pricePosition(proposed, amounts);
  const placement = percentile === null
    ? n === 0
      ? "No peer publishes this fee"
      : `Too few peers for a percentile (${n} publish this fee; Hamilton needs ${MIN_PEERS_FOR_POSITION})`
    : placeAmong(percentile, n);
  const lower = peers.filter((p) => p.amount < proposed - SAME);
  const higher = peers.filter((p) => p.amount > proposed + SAME);
  const nearestBelow = lower.length ? Math.max(...lower.map((p) => p.amount)) : null;
  const nearestAbove = higher.length ? Math.min(...higher.map((p) => p.amount)) : null;
  return {
    proposed,
    n,
    less,
    same,
    more,
    percentile,
    placement,
    below: nearestBelow === null ? null : { amount: nearestBelow, peers: lower.filter((p) => Math.abs(p.amount - nearestBelow) <= SAME).sort(byName) },
    above: nearestAbove === null ? null : { amount: nearestAbove, peers: higher.filter((p) => Math.abs(p.amount - nearestAbove) <= SAME).sort(byName) },
    atPrice: peers.filter((p) => Math.abs(p.amount - proposed) <= SAME).sort(byName),
  };
}

/** "Capital City Bank, M&T Bank and 2 others": the first few names, the rest counted. */
export function namedPeers(peers: readonly PositionPeer[], limit = POSITION_NEIGHBOURS): string {
  if (peers.length === 0) return "None found";
  const shown = peers.slice(0, limit).map((p) => p.name);
  const rest = peers.length - shown.length;
  if (rest > 0) return `${shown.join(", ")} and ${rest} ${rest === 1 ? "other" : "others"}`;
  return shown.length <= 2 ? shown.join(" and ") : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}
