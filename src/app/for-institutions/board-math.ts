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
  /** The line both exhibits open on: the finding (see `leadLineKey`). */
  leadKey: string;
  /** The newest day a schedule behind these lines was read (YYYY-MM-DD), or null. */
  readOn: string | null;
}

/**
 * The line to open on: of the lines outside the local middle half, the one furthest from the
 * local median (relative to it); with none outside, the first line. A finding, not a tie.
 */
export function leadLineKey(lines: Pick<BoardLine, "key" | "own" | "median" | "position">[]): string | null {
  // Relative to the median, so every score is in the same unit; a median of $0 or less (most
  // competitors charge nothing) ranks with the free lines, as the furthest out.
  const gap = (line: Pick<BoardLine, "own" | "median">) =>
    line.median > 0 ? Math.abs(line.own - line.median) / line.median : Number.POSITIVE_INFINITY;
  const outside = lines.filter((line) => line.position !== "in_market");
  const lead = [...outside].sort((a, b) => (gap(a) === gap(b) ? 0 : gap(b) > gap(a) ? 1 : -1))[0] ?? lines[0];
  return lead?.key ?? null;
}

/** The latest of a set of YYYY-MM-DD read dates, or null. */
export function latestReadOn(dates: (string | null | undefined)[]): string | null {
  const valid = dates.filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d));
  return valid.length ? valid.map((d) => d.slice(0, 10)).sort().at(-1)! : null;
}

/** "2026-10-03" as "Oct 3, 2026"; anything else is null. */
export function readOnLabel(iso: string | null): string | null {
  const match = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
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
  // A tenth of headroom, so the highest fee never sits on the chart's edge.
  const max = Math.max(line.own, extra, ...line.peers.map((peer) => peer.amount)) * 1.1;
  if (max <= 10) return 10;
  const step = max <= 50 ? 10 : 25;
  return Math.ceil(max / step) * step;
}

/**
 * The axis labels for a line: $0, a round middle and the top. The middle is half the top,
 * rounded down to whole $5 (whole $1 on a $10 axis), so it never reads "$62.50".
 */
export function axisTicks(top: number): number[] {
  const unit = top > 10 ? 5 : 1;
  const middle = Math.floor(top / 2 / unit) * unit;
  return middle > 0 && middle < top ? [0, middle, top] : [0, top];
}

/**
 * A fee line's name as the exhibits show it. Only a trailing abbreviation in capitals goes
 * ("Overdraft (OD)" reads "Overdraft"); a qualifier in words says what the figure covers and
 * stays ("Monthly maintenance (entry checking)", "Overdraft (per item)").
 */
export function lineName(label: string): string {
  return label.replace(/\s*\([A-Z][A-Z0-9/&.]*\)$/, "");
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
