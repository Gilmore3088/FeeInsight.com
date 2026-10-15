import type { LinePosition } from "@/lib/custom-report/analysis";

/**
 * Pure shapes and helpers behind the /for-institutions workspace exhibits. No server import,
 * so the client exhibits (competitor board, price tester) share them with the page.
 */

/** No median, middle half or rank from fewer institutions than this (the site's thin rule). */
export const MIN_MEDIAN_INSTITUTIONS = 5;

export interface BoardPeer {
  id: number;
  name: string;
  amount: number;
}

export interface BoardLine {
  key: string;
  label: string;
  /** The subject institution's own published fee. */
  own: number;
  /** The words of its own schedule that state the fee, when they pass the shared source check. */
  quote: string | null;
  readOn: string | null;
  /** Every local competitor that publishes this fee, lowest first. */
  peers: BoardPeer[];
  median: number;
  p25: number;
  p75: number;
  position: LinePosition;
}

export interface CompetitorBoard {
  institutionName: string;
  /** "Tallahassee, FL area (3 counties)" */
  marketLabel: string | null;
  /** Local competitors with verified fees, as the report counts them. */
  competitorsWithData: number;
  lines: BoardLine[];
}

/** "Wells Fargo Bank, National Association" reads "Wells Fargo Bank, N.A." in a tight exhibit. */
export function shortInstitutionName(name: string): string {
  return name.replace(/,?\s+National Association$/i, ", N.A.").trim();
}

/** Competitors charging strictly less than `price`. */
export function chargingLess(peers: BoardPeer[], price: number): number {
  return peers.filter((peer) => peer.amount < price).length;
}

/** The ranked list: up to `size` institutions around the subject, the subject included. */
export function rankWindow(
  line: Pick<BoardLine, "peers" | "own">,
  subject: string,
  size = 7,
): (BoardPeer & { self: boolean })[] {
  const rows = [
    ...line.peers.map((peer) => ({ ...peer, self: false })),
    { id: -1, name: subject, amount: line.own, self: true },
  ].sort((a, b) => a.amount - b.amount || Number(a.self) - Number(b.self) || a.name.localeCompare(b.name));
  const at = rows.findIndex((row) => row.self);
  const half = Math.floor(size / 2);
  const start = Math.max(0, Math.min(at - half, rows.length - size));
  return rows.slice(start, start + size);
}

/** A clean axis top above every figure on a line (and a price being tried). */
export function lineAxisMax(line: Pick<BoardLine, "peers" | "own">, extra = 0): number {
  const max = Math.max(line.own, extra, ...line.peers.map((peer) => peer.amount));
  if (max <= 10) return 10;
  const step = max <= 50 ? 10 : 25;
  return Math.ceil(max / step) * step;
}

/** Equal amounts stack: each figure's row in its column of dots, 0 at the axis. */
export function stackDots(amounts: number[]): number[] {
  const seen = new Map<number, number>();
  return amounts.map((amount) => {
    const key = Math.round(amount * 100);
    const level = seen.get(key) ?? 0;
    seen.set(key, level + 1);
    return level;
  });
}

/** One money format on every marketing exhibit, always with cents (`money` in landing-shared). */
export function feeMoney(value: number): string {
  return `$${value.toFixed(2)}`;
}

/** The sample report's position words (`POSITION_LABEL` in market-report/report-body), client-safe. */
export const POSITION_TEXT: Record<LinePosition, string> = {
  above_market: "Above local range",
  in_market: "Inside local range",
  below_market: "Below local range",
  free: "Free",
};
