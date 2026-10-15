import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { LIVE_FRAGMENT_REGEXES, liveFragmentName, type LiveFragmentPattern } from "@/lib/agents/knox/name-retidy";

type SqlTag = typeof sql;

/**
 * Darwin's live re-check of fee names (#1443, #1436; decision 2026-10-15, "Darwin re-checks every
 * live fee against today's rules"). Publish holds a cut-off name before it goes live
 * (`publishNameHold`, `cutoff_name`), but fees that went live before that hold existed were never
 * read again: institution 5314's "or take advantage of both options to reduce your monthly fee to"
 * is live at $0, the waived price of its $7.95 monthly charge. `cutoff_name` itself is too blunt
 * for live rows (1,571 live matches, about half real fees), so this pass applies its narrow live
 * twin, `liveFragmentName`, to the live catalog name (`published_fee_records.fee_name`, not the
 * verified name: most rows where the two differ were already repaired in the catalog).
 *
 * Each Darwin verify step reads the next `LIVE_FRAGMENT_BATCH` live fees after a cursor kept on the
 * run ledger (the `darwin.live_fragment_check` event's `next_after_id`), wrapping to the start when
 * it reaches the end, so the whole live table is read again every pass. An institution-scoped run
 * reads that institution's live fees instead and leaves the cursor alone. While
 * `FRAGMENT_NAME_TAKEDOWN_LIVE` is false, or in a dry run, it only reports what it would take down.
 * When on, a matching fee is archived (rolled back with `fragment name: <pattern>`, never deleted),
 * its verified row is rejected with the same flag so publish does not bring it back, and an
 * `agent_run_events` row records the takedown. Many fragments carry the wrong amount (a minimum, a
 * waived price, a $0 online copy), so the fee comes down rather than being renamed.
 */
export const LIVE_FRAGMENT_CHECK = "darwin.live_fragment_check";
/**
 * Default-off takedown switch. It turns on by PR after the dry run over the whole live table
 * (`countLiveFragmentNames`, or a full pass of step reports) has been shown to James by pattern.
 */
export const FRAGMENT_NAME_TAKEDOWN_LIVE = false;
/** Live fees read per step. A name-only regex read, so a large share; the live table takes about (live fees / 2,000) steps a pass. */
export const LIVE_FRAGMENT_BATCH = 2_000;
export const LIVE_FRAGMENT_SAMPLES = 20;
export const LIVE_FRAGMENT_REASON_PREFIX = "fragment name: ";
/** The verified row's flag when its live fee comes down. */
export const LIVE_FRAGMENT_FLAG_PREFIX = "darwin_live_fragment";

export interface LiveFragmentRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  institution_id: number | string;
  fee_name: string | null;
  amount: number | string | null;
}

export interface LiveFragmentSample {
  feePublishedId: number;
  feeVerifiedId: number | null;
  institutionId: number;
  feeName: string;
  amount: number | null;
  pattern: LiveFragmentPattern;
}

export interface LiveFragmentFindings {
  checked: number;
  matched: number;
  byPattern: Record<LiveFragmentPattern, number>;
  samples: LiveFragmentSample[];
}

export interface LiveFragmentResult extends LiveFragmentFindings {
  live: boolean;
  dryRun: boolean;
  /** The cursor this step started after (0 at the start of a pass; null when institution-scoped). */
  afterId: number | null;
  /** Where the next step starts; 0 when this step reached the end of the live table. */
  nextAfterId: number | null;
  /** Live fees archived in this step (switch on, not a dry run). */
  takenDown: number[];
}

function num(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Pure: the live rows whose catalog name is a fragment, counted by pattern, with every match kept. */
export function findLiveFragments(rows: LiveFragmentRow[]): LiveFragmentFindings & { matches: LiveFragmentSample[] } {
  const byPattern: Record<LiveFragmentPattern, number> = { plus: 0, trailing_range: 0, sentence_end: 0, pronoun: 0 };
  const matches: LiveFragmentSample[] = [];
  for (const row of rows) {
    const pattern = liveFragmentName(row.fee_name);
    if (!pattern) continue;
    byPattern[pattern] += 1;
    matches.push({
      feePublishedId: Number(row.fee_published_id),
      feeVerifiedId: num(row.fee_verified_id),
      institutionId: Number(row.institution_id),
      feeName: row.fee_name ?? "",
      amount: num(row.amount),
      pattern,
    });
  }
  return { checked: rows.length, matched: matches.length, byPattern, samples: matches.slice(0, LIVE_FRAGMENT_SAMPLES), matches };
}

/** The reason a live fee comes down with, in `rolled_back_reason`. */
export function liveFragmentReason(pattern: LiveFragmentPattern): string {
  return `${LIVE_FRAGMENT_REASON_PREFIX}${pattern}`;
}

async function readCursor(db: SqlTag): Promise<number> {
  const [row] = await inSavepoint(db, (scope) => scope<{ next_after_id: string | null }[]>`
    SELECT detail->>'next_after_id' AS next_after_id
      FROM agent_run_events
     WHERE event_type = ${LIVE_FRAGMENT_CHECK}
     ORDER BY created_at DESC, id DESC
     LIMIT 1
  `);
  return num(row?.next_after_id ?? null) ?? 0;
}

/**
 * One step's share of the live re-check (see the module note). Never throws: a failed read
 * reports nothing checked, and a failed takedown leaves the fees live.
 */
export async function recheckLiveFragmentNames(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean; limit?: number },
): Promise<LiveFragmentResult> {
  const live = options.live ?? FRAGMENT_NAME_TAKEDOWN_LIVE;
  const limit = Math.max(1, Math.min(options.limit ?? LIVE_FRAGMENT_BATCH, 20_000));
  const scoped = options.institutionId != null;
  const result: LiveFragmentResult = {
    live, dryRun: options.dryRun, checked: 0, matched: 0, byPattern: { plus: 0, trailing_range: 0, sentence_end: 0, pronoun: 0 },
    samples: [], afterId: null, nextAfterId: null, takenDown: [],
  };
  let rows: LiveFragmentRow[];
  try {
    const afterId = scoped ? 0 : await readCursor(db);
    rows = await inSavepoint(db, (scope) => scope<LiveFragmentRow[]>`
      SELECT fp.fee_published_id, fp.lineage_ref AS fee_verified_id, fp.institution_id, fp.fee_name, fp.amount
        FROM published_fee_records fp
       WHERE fp.rolled_back_at IS NULL
         AND fp.quarantined_at IS NULL
         AND fp.fee_published_id > ${afterId}
         AND (${!scoped} OR fp.institution_id = ${options.institutionId ?? 0})
       ORDER BY fp.fee_published_id
       LIMIT ${limit}::int
    `);
    if (!scoped) {
      result.afterId = afterId;
      // A short batch reached the end of the live table: the next step starts the pass again.
      result.nextAfterId = rows.length < limit ? 0 : Number(rows[rows.length - 1].fee_published_id);
    }
  } catch (error) {
    console.warn("[darwin] live fragment check read failed", error instanceof Error ? error.message : error);
    return result;
  }

  const found = findLiveFragments(rows);
  Object.assign(result, { checked: found.checked, matched: found.matched, byPattern: found.byPattern, samples: found.samples });

  if (live && !options.dryRun && found.matches.length > 0) {
    try {
      result.takenDown = await inSavepoint(db, async (scope) => {
        const updated = await scope<{ fee_published_id: number | string }[]>`
          UPDATE published_fee_records fp
             SET rolled_back_at = NOW(),
                 rolled_back_by_batch_id = ${`darwin-live-fragment-${options.runId}`},
                 rolled_back_reason = v.reason
            FROM unnest(${found.matches.map((fee) => fee.feePublishedId)}::bigint[], ${found.matches.map((fee) => liveFragmentReason(fee.pattern))}::text[])
                 AS v(fee_published_id, reason)
           WHERE fp.fee_published_id = v.fee_published_id
             AND fp.rolled_back_at IS NULL
          RETURNING fp.fee_published_id
        `;
        const ids = new Set(updated.map((row) => Number(row.fee_published_id)));
        const verified = found.matches.filter((fee) => ids.has(fee.feePublishedId) && fee.feeVerifiedId != null);
        if (verified.length > 0) {
          await scope`
            UPDATE verified_fee_observations fv
               SET review_status = 'rejected',
                   outlier_flags = CASE
                     WHEN fv.outlier_flags ? v.flag THEN fv.outlier_flags
                     ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(v.flag)
                   END
              FROM unnest(${verified.map((fee) => fee.feeVerifiedId as number)}::bigint[], ${verified.map((fee) => `${LIVE_FRAGMENT_FLAG_PREFIX}:${fee.pattern}`)}::text[])
                   AS v(fee_verified_id, flag)
             WHERE fv.fee_verified_id = v.fee_verified_id
               AND fv.review_status IN ('verified', 'approved')
          `;
        }
        return found.matches.filter((fee) => ids.has(fee.feePublishedId)).map((fee) => fee.feePublishedId);
      });
    } catch (error) {
      console.error("[darwin] live fragment takedown failed", error instanceof Error ? error.message : error);
      result.takenDown = [];
    }
    if (result.takenDown.length > 0) {
      invalidatePublicReadCache();
      const down = new Set(result.takenDown);
      try {
        await inSavepoint(db, (scope) => scope`
          INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
          VALUES (
            ${options.runId}, ${options.stepId ?? null}, 'darwin.live_fragment_name_taken_down', 'completed',
            ${`Archived ${result.takenDown.length} live fee(s) whose name is a sentence fragment`},
            ${JSON.stringify({
              batch_id: `darwin-live-fragment-${options.runId}`,
              taken_down: result.takenDown.length,
              by_pattern: found.matches.filter((fee) => down.has(fee.feePublishedId)).reduce<Record<string, number>>((counts, fee) => {
                counts[fee.pattern] = (counts[fee.pattern] ?? 0) + 1;
                return counts;
              }, {}),
              samples: found.matches.filter((fee) => down.has(fee.feePublishedId)).slice(0, LIVE_FRAGMENT_SAMPLES),
            })}::jsonb
          )
        `);
      } catch (error) {
        console.error("[darwin] live fragment takedown event failed", error instanceof Error ? error.message : error);
      }
    }
  }

  // The step's report, which also carries the cursor for the next step. A dry run writes nothing.
  if (!options.dryRun) {
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${options.stepId ?? null}, ${LIVE_FRAGMENT_CHECK}, 'completed',
          ${`Read ${result.checked} live fee name(s): ${result.matched} fragment(s), ${live ? `${result.takenDown.length} archived` : "switch off, none archived"}`},
          ${JSON.stringify(liveFragmentDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[darwin] live fragment check event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

/** The step detail (and ledger event detail) for one step's share. */
export function liveFragmentDetail(result: LiveFragmentResult) {
  return {
    check: LIVE_FRAGMENT_CHECK,
    takedown_live: result.live,
    dry_run: result.dryRun,
    batch: LIVE_FRAGMENT_BATCH,
    after_id: result.afterId,
    next_after_id: result.nextAfterId,
    checked: result.checked,
    would_take_down: result.matched,
    taken_down: result.takenDown.length,
    by_pattern: result.byPattern,
    samples: result.samples.map((fee) => ({
      fee_published_id: fee.feePublishedId,
      institution_id: fee.institutionId,
      fee_name: fee.feeName,
      amount: fee.amount,
      pattern: fee.pattern,
    })),
  };
}

/** A JS regex as a Postgres ARE literal: `\b` is a backspace there, `\y` the word boundary. */
function postgresPattern(re: RegExp): string {
  return re.source.replace(/\\b/g, "\\y").replace(/'/g, "''");
}

/**
 * The same count as one read-only SQL statement, for someone with prod access (#1443). Built from
 * `LIVE_FRAGMENT_REGEXES`, so it stays in step with `liveFragmentName`; Postgres's word boundary
 * reads non-ASCII letters as word characters, which JS does not, so a name with accented letters
 * next to a matched word can count differently. The trailing range's optional leading separators
 * (`[\s\-–—|:,]*`) never change whether it matches, so the SQL leaves them out.
 */
export function liveFragmentCountSql(): string {
  const re = LIVE_FRAGMENT_REGEXES;
  return `WITH live AS (
  SELECT fee_published_id, institution_id, amount,
         btrim(regexp_replace(COALESCE(fee_name, ''), '\\s+', ' ', 'g')) AS name
    FROM published_fee_records
   WHERE rolled_back_at IS NULL AND quarantined_at IS NULL
), tagged AS (
  SELECT *, CASE
    WHEN name ~ '${postgresPattern(re.plus)}' AND regexp_replace(name, '^\\++\\s*', '') !~* '${postgresPattern(re.plus_fee_noun)}' THEN 'plus'
    WHEN name ~* '${postgresPattern(new RegExp(re.trailing_range.source.replace(/^\[[^\]]*\]\*/, "")))}' THEN 'trailing_range'
    WHEN name ~* '${postgresPattern(re.sentence_end)}' OR name ~ '${postgresPattern(re.sentence_end_article)}' THEN 'sentence_end'
    WHEN name ~* '${postgresPattern(re.pronoun)}' THEN 'pronoun'
  END AS pattern
  FROM live
)
SELECT COALESCE(pattern, 'all patterns') AS pattern, count(*) AS would_take_down
  FROM tagged
 WHERE pattern IS NOT NULL
 GROUP BY ROLLUP (pattern)
 ORDER BY pattern;`;
}

/**
 * The dry-run count over the whole live table in one read (every live fee's id and name; no
 * cursor, nothing written). For the count James sees before the switch goes on, when a pass of
 * step batches would take many steps. Run it with the Darwin verify step's `fragment_full_count`
 * param.
 */
export async function countLiveFragmentNames(db: SqlTag): Promise<LiveFragmentFindings | null> {
  try {
    const rows = await inSavepoint(db, (scope) => scope<LiveFragmentRow[]>`
      SELECT fp.fee_published_id, fp.lineage_ref AS fee_verified_id, fp.institution_id, fp.fee_name, fp.amount
        FROM published_fee_records fp
       WHERE fp.rolled_back_at IS NULL
         AND fp.quarantined_at IS NULL
       ORDER BY fp.fee_published_id
    `);
    const { checked, matched, byPattern, samples } = findLiveFragments(rows);
    return { checked, matched, byPattern, samples };
  } catch (error) {
    console.warn("[darwin] live fragment full count failed", error instanceof Error ? error.message : error);
    return null;
  }
}
