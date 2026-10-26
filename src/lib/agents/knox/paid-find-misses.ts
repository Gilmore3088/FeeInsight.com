import type { ExtractedFeeCandidate, HeldFeeCandidate } from "@/lib/agents/knox/rules";
import { layoutSignature } from "@/lib/agents/knox/layout-signature";
import { lessonFamily } from "@/lib/agents/knox/lessons";

/**
 * What each paid find was to the free team (#1101). The paid pass (`paid-extract.ts`) buys a
 * model read of a text the free team (rules + specialists) read thin, and keeps every fee the
 * model grounds in the text. Until v1 nothing said why the free team had not read that fee, so
 * the same layout at the next bank cost another call and no rule was ever chosen from the finds.
 *
 * After each paid read, Knox runs today's free team on the same text once more (deterministic, no
 * provider call; the paid pass selects only texts the current free version already read) and files
 * each grounded paid fee as one of:
 * - `free_read`: the free team reads the same fee (same price, same category, the same line or
 *   name). The call bought nothing new for it.
 * - `free_other_category`: the free team reads the same line at the same price under another
 *   category. Knox's category lessons (`lessons.ts`) and label queue (`label-queue.ts`) already
 *   learn this once Darwin judges the two rows, which both carry the bank's own name.
 * - `free_held`: the free team holds the line (unclassified, untraced, a range ...): it saw the
 *   fee but did not file it. The held shape is recorded; held names reach the label queue and the
 *   held re-check (`held-recheck.ts`).
 * - `free_missed`: the free team reads nothing at that price on that line. This is the class no
 *   existing lesson learns: it needs a rule for the line's shape. Its line shape (the source
 *   line's `layoutSignature`, e.g. `sentences`, `plain`, `table`) is recorded beside the text's
 *   layout, the page's host and the bank's website platform.
 *
 * The per-text summary rides the paid attempt's detail (`free_misses`), and the step writes one
 * `knox.paid_find_misses` event with the run's totals and the misses that repeat at two banks or
 * more under one layout and line shape, which is what the next free rule is chosen from. Nothing
 * here writes a fee, holds one or changes a read. Pure.
 */

export const KNOX_PAID_FIND_MISS_VERSION = 1;

export type PaidFindMissKind = "free_read" | "free_other_category" | "free_held" | "free_missed";
export const PAID_FIND_MISS_KINDS: readonly PaidFindMissKind[] = ["free_read", "free_other_category", "free_held", "free_missed"];

/** A miss repeats once it is seen at this many banks under one layout and line shape. */
export const PAID_FIND_REPEAT_MIN_BANKS = 2;
const MAX_EXAMPLES = 5;
const EXAMPLE_CHARS = 160;

/** The parts of a grounded paid fee (`AcceptedPaidFee`) the classifier reads. */
export interface PaidFind {
  feeName: string;
  canonicalKey: string;
  amount: number;
  sourceLine: string;
}

export interface FreeTeamRead {
  candidates: readonly ExtractedFeeCandidate[];
  held: readonly HeldFeeCandidate[];
}

export interface PaidFindMiss {
  kind: PaidFindMissKind;
  /** The source line's shape: how its price sits (`layoutSignature`'s first part). */
  lineShape: string;
  /** `free_other_category`: the category the free team filed the line under. */
  freeCategory?: string;
  /** `free_held`: the shape the free team held the line as. */
  heldShape?: string;
}

function comparable(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9$.]+/g, " ").replace(/\s+/g, " ").trim();
}

function sameAmount(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
}

/** The source line's shape, without the length half: one line is never "long" on its own terms. */
export function paidFindLineShape(sourceLine: string): string {
  return layoutSignature(sourceLine).signature.split("/")[0];
}

/**
 * The free read is of the paid find's line: one's line or excerpt holds the other's, or the two
 * names share their words (`lessonFamily`: plural, fee and joining words dropped), at least two
 * words when both names have two.
 */
export function sameLineRead(find: PaidFind, free: { feeName: string; excerpt: string }): boolean {
  const line = comparable(find.sourceLine);
  const excerpt = comparable(free.excerpt);
  if (line.length >= 8 && excerpt.length >= 8 && (excerpt.includes(line) || line.includes(excerpt))) return true;
  const paidWords = new Set(lessonFamily(find.feeName).split(" ").filter(Boolean));
  const freeWords = lessonFamily(free.feeName).split(" ").filter(Boolean);
  if (paidWords.size === 0 || freeWords.length === 0) return false;
  const shared = freeWords.filter((word) => paidWords.has(word)).length;
  return shared >= Math.min(2, paidWords.size, freeWords.length);
}

function heldAtAmount(held: HeldFeeCandidate, amount: number): boolean {
  if (held.amount == null) return held.amountMax == null;
  if (held.amountMax != null) return amount >= held.amount - 0.005 && amount <= held.amountMax + 0.005;
  return sameAmount(held.amount, amount);
}

/** What one grounded paid fee was to the free team. */
export function classifyPaidFind(find: PaidFind, free: FreeTeamRead): PaidFindMiss {
  const lineShape = paidFindLineShape(find.sourceLine);
  const reads = free.candidates.filter((read) => sameAmount(read.amount, find.amount) && sameLineRead(find, read));
  if (reads.some((read) => read.canonicalHint === find.canonicalKey)) return { kind: "free_read", lineShape };
  if (reads.length > 0) return { kind: "free_other_category", lineShape, freeCategory: reads[0].canonicalHint };
  const held = free.held.find((row) => heldAtAmount(row, find.amount) && sameLineRead(find, row));
  if (held) return { kind: "free_held", lineShape, heldShape: held.shape };
  return { kind: "free_missed", lineShape };
}

export interface PaidFindMissSummary {
  version: number;
  /** The whole text's layout (`layoutSignature`), as the free reader's attempt records it. */
  layout: string;
  /** The page's host, `www.` dropped. */
  host: string | null;
  /** The bank's website platform (`institution_source_profiles.platform`, else `cms_platform`). */
  platform: string | null;
  paid_finds: number;
  by_kind: Record<PaidFindMissKind, number>;
  /** `free_missed` finds by their line's shape. */
  missed_line_shapes: Record<string, number>;
  /** `free_held` finds by the shape the free team held them as. */
  held_shapes: Record<string, number>;
  /** `free_other_category` finds, `free->paid`. */
  other_categories: Record<string, number>;
  /** A few missed source lines, so a rule can be written from them. */
  missed_examples: string[];
}

/** The page's host, lowercased, `www.` dropped; null when the address does not parse. */
export function pageHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

function bump(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

/** One text's paid finds, filed against today's free read of the same text. */
export function summarizePaidFindMisses(input: {
  text: string;
  sourceUrl: string | null;
  platform: string | null;
  finds: readonly PaidFind[];
  free: FreeTeamRead;
}): { summary: PaidFindMissSummary; misses: PaidFindMiss[] } {
  const misses = input.finds.map((find) => classifyPaidFind(find, input.free));
  const summary: PaidFindMissSummary = {
    version: KNOX_PAID_FIND_MISS_VERSION,
    layout: layoutSignature(input.text).signature,
    host: pageHost(input.sourceUrl),
    platform: input.platform?.trim().toLowerCase() || null,
    paid_finds: misses.length,
    by_kind: { free_read: 0, free_other_category: 0, free_held: 0, free_missed: 0 },
    missed_line_shapes: {},
    held_shapes: {},
    other_categories: {},
    missed_examples: [],
  };
  misses.forEach((miss, index) => {
    summary.by_kind[miss.kind] += 1;
    if (miss.kind === "free_missed") {
      bump(summary.missed_line_shapes, miss.lineShape);
      if (summary.missed_examples.length < MAX_EXAMPLES) summary.missed_examples.push(input.finds[index].sourceLine.slice(0, EXAMPLE_CHARS));
    } else if (miss.kind === "free_held" && miss.heldShape) {
      bump(summary.held_shapes, miss.heldShape);
    } else if (miss.kind === "free_other_category" && miss.freeCategory) {
      bump(summary.other_categories, `${miss.freeCategory}->${input.finds[index].canonicalKey}`);
    }
  });
  return { summary, misses };
}

export interface RepeatedPaidFindMiss {
  layout: string;
  lineShape: string;
  /** Banks the miss was seen at. */
  banks: number;
  finds: number;
  hosts: string[];
  platforms: string[];
  examples: string[];
}

/**
 * `free_missed` finds grouped by the text's layout and the line's shape, kept when seen at
 * `minBanks` banks or more, most banks first: the free rules' next layouts to learn.
 */
export function repeatedPaidFindMisses(
  texts: ReadonlyArray<{ institutionId: number; summary: PaidFindMissSummary }>,
  minBanks = PAID_FIND_REPEAT_MIN_BANKS,
): RepeatedPaidFindMiss[] {
  const groups = new Map<string, { layout: string; lineShape: string; banks: Set<number>; finds: number; hosts: Set<string>; platforms: Set<string>; examples: string[] }>();
  for (const { institutionId, summary } of texts) {
    for (const [lineShape, count] of Object.entries(summary.missed_line_shapes)) {
      const key = `${summary.layout}|${lineShape}`;
      const group = groups.get(key) ?? { layout: summary.layout, lineShape, banks: new Set(), finds: 0, hosts: new Set(), platforms: new Set(), examples: [] };
      group.banks.add(institutionId);
      group.finds += count;
      if (summary.host) group.hosts.add(summary.host);
      if (summary.platform) group.platforms.add(summary.platform);
      for (const example of summary.missed_examples) {
        if (group.examples.length < MAX_EXAMPLES && paidFindLineShape(example) === lineShape) group.examples.push(example);
      }
      groups.set(key, group);
    }
  }
  return [...groups.values()]
    .filter((group) => group.banks.size >= minBanks)
    .map((group) => ({
      layout: group.layout,
      lineShape: group.lineShape,
      banks: group.banks.size,
      finds: group.finds,
      hosts: [...group.hosts].sort(),
      platforms: [...group.platforms].sort(),
      examples: group.examples,
    }))
    .sort((a, b) => b.banks - a.banks || b.finds - a.finds || `${a.layout}|${a.lineShape}`.localeCompare(`${b.layout}|${b.lineShape}`));
}

/** The step event's message: what the run's paid finds were to the free team. */
export function paidFindMissMessage(totals: Record<PaidFindMissKind, number>, repeated: readonly RepeatedPaidFindMiss[]): string {
  const finds = PAID_FIND_MISS_KINDS.reduce((sum, kind) => sum + totals[kind], 0);
  const top = repeated[0];
  return (
    `Knox's paid pass kept ${finds} fee${finds === 1 ? "" : "s"}: the free team already read ${totals.free_read}, ` +
    `read ${totals.free_other_category} under another category, held ${totals.free_held} and missed ${totals.free_missed}.` +
    (top ? ` Most repeated miss: ${top.lineShape} lines in ${top.layout} texts at ${top.banks} banks.` : "")
  );
}
