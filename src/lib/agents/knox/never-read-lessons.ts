import type { sql } from "@/lib/data-store/connection";
import { PAID_FIND_REPEAT_MIN_BANKS } from "@/lib/agents/knox/paid-find-misses";

type SqlTag = typeof sql;

/**
 * The lesson pathway for Knox's never-read fees (blind second reader, James 2026-11-07,
 * `second-reader.ts`). A confirmed miss is a fee the blind reader found and traced to its own
 * source line with `checkFeeAgainstSource`, which today's free Knox team reads nothing for. Each
 * is recorded as one `never_read` row in `pipeline_feedback` (check `knox.second_reader`, about
 * Knox's free extract strategy), the shared store Knox's other lessons are read from.
 *
 * This module reads those rows back and groups them into lesson drafts: one per text layout and
 * line shape (`layoutSignature`), with the banks, categories and example lines behind it, and
 * `repeats` once the miss is seen at PAID_FIND_REPEAT_MIN_BANKS banks or more, the paid pass's own
 * bar for choosing the next free rule (`paid-find-misses.ts`). A draft is a proposal, never an edit:
 * role lessons are reviewed code (`role-lessons.ts`), so the builder who writes the free rule for a
 * draft's line shape adds its lesson there in the same PR, citing the feedback rows. Nothing here
 * changes a read, a fee or a source file. Read-only.
 */

export const NEVER_READ_LESSONS_VERSION = 1;
const MAX_EXAMPLES = 5;
const EXAMPLE_CHARS = 160;

/** One confirmed miss, as the second reader records it. */
export interface NeverReadMiss {
  institutionId: number;
  layout: string;
  lineShape: string;
  canonicalKey: string;
  sourceLine: string;
}

export interface NeverReadLessonDraft {
  layout: string;
  lineShape: string;
  banks: number;
  misses: number;
  /** Seen at two banks or more: a free rule for this shape is the next to write. */
  repeats: boolean;
  institutionIds: number[];
  canonicalKeys: Record<string, number>;
  examples: string[];
  /** The draft lesson, in the role-lesson voice; a builder edits it before it goes in role-lessons.ts. */
  draft: string;
}

/** Misses grouped by layout and line shape, most banks first. Pure. */
export function neverReadLessonDrafts(misses: readonly NeverReadMiss[], minBanks = PAID_FIND_REPEAT_MIN_BANKS): NeverReadLessonDraft[] {
  const groups = new Map<string, { layout: string; lineShape: string; banks: Set<number>; misses: number; keys: Record<string, number>; examples: string[] }>();
  for (const miss of misses) {
    const id = `${miss.layout}|${miss.lineShape}`;
    const group = groups.get(id) ?? { layout: miss.layout, lineShape: miss.lineShape, banks: new Set<number>(), misses: 0, keys: {}, examples: [] };
    group.banks.add(miss.institutionId);
    group.misses += 1;
    group.keys[miss.canonicalKey] = (group.keys[miss.canonicalKey] ?? 0) + 1;
    if (group.examples.length < MAX_EXAMPLES) group.examples.push(miss.sourceLine.slice(0, EXAMPLE_CHARS));
    groups.set(id, group);
  }
  return [...groups.values()]
    .map((group) => {
      const keys = Object.entries(group.keys).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      return {
        layout: group.layout,
        lineShape: group.lineShape,
        banks: group.banks.size,
        misses: group.misses,
        repeats: group.banks.size >= minBanks,
        institutionIds: [...group.banks].sort((a, b) => a - b),
        canonicalKeys: Object.fromEntries(keys),
        examples: group.examples,
        draft:
          `Read every priced ${group.lineShape} line in a ${group.layout} text: the blind second reader found ${group.misses} ` +
          `fee${group.misses === 1 ? "" : "s"} at ${group.banks.size} bank${group.banks.size === 1 ? "" : "s"} stated on such lines ` +
          `(mostly ${keys.slice(0, 3).map(([key]) => key).join(", ")}) that Knox never read.`,
      };
    })
    .sort((a, b) => b.banks - a.banks || b.misses - a.misses || `${a.layout}|${a.lineShape}`.localeCompare(`${b.layout}|${b.lineShape}`));
}

export function neverReadLessonsMessage(drafts: readonly NeverReadLessonDraft[]): string {
  const misses = drafts.reduce((sum, draft) => sum + draft.misses, 0);
  const repeated = drafts.filter((draft) => draft.repeats).length;
  const top = drafts[0];
  return (
    `Knox never read ${misses} fee${misses === 1 ? "" : "s"} the blind second reader traced, in ${drafts.length} line shape${drafts.length === 1 ? "" : "s"} ` +
    `(${repeated} at two banks or more).` +
    (top ? ` Most common: ${top.lineShape} lines in ${top.layout} texts at ${top.banks} bank${top.banks === 1 ? "" : "s"}.` : "")
  );
}

/** The recorded never-read rows, read back as misses. Read-only. */
export async function loadNeverReadMisses(db: SqlTag, options: { batchId?: string } = {}): Promise<NeverReadMiss[]> {
  const rows = await db`
    SELECT institution_id, canonical_fee_key, evidence
      FROM pipeline_feedback
     WHERE kind = 'never_read'
       AND check_name = 'knox.second_reader'
       AND signal = 'missed'
       AND (${options.batchId ?? null}::text IS NULL OR evidence->>'batch_id' = ${options.batchId ?? null})
     ORDER BY id
  `;
  return rows.map((row) => {
    const evidence = (row.evidence ?? {}) as Record<string, unknown>;
    return {
      institutionId: Number(row.institution_id),
      layout: String(evidence.layout ?? "unknown"),
      lineShape: String(evidence.line_shape ?? "unknown"),
      canonicalKey: String(row.canonical_fee_key ?? ""),
      sourceLine: String(evidence.source_line ?? ""),
    };
  });
}

/** Every recorded never-read, as lesson drafts. Read-only. */
export async function loadNeverReadLessonDrafts(db: SqlTag, options: { batchId?: string } = {}): Promise<NeverReadLessonDraft[]> {
  return neverReadLessonDrafts(await loadNeverReadMisses(db, options));
}
