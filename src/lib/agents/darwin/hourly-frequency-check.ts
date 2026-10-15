import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { inSavepoint } from "@/lib/agents/savepoint";
import {
  frequencyFamily,
  HOURLY_EXEMPT_KEYS,
  HOURLY_FREQUENCY,
  HOURLY_WORDING,
  PARTIAL_HOUR_WORDING,
} from "@/lib/fee-frequency";

type SqlTag = typeof sql;

/**
 * Darwin's live re-check of hourly fees (#1456; decision 2026-10-15, "Darwin re-checks every live
 * fee against today's rules"). About 802 live fees say in their name that they are priced by the
 * hour ("Research: Labor Per Hour" $40, "Subpoena Fee - Per Hour (Minimum One Hour Charge)" $25,
 * "Coin Counting (per hour)" $10), but no hourly frequency existed: 796 had none, 5 were `per_item`
 * and 1 `per_occurrence`, so a report read "$40" as a flat charge. Knox does not read hourly at
 * extraction yet (that rides the next Knox rules bump); this pass sets it on live fees, new ones
 * included, since it re-reads the live table every pass.
 *
 * The live catalog name (`published_fee_records.fee_name`) decides, one of (`hourlyVerdict`):
 * - `set`: the name prices the fee by the hour (`HOURLY_WORDING`: "per hour", "per hr", "/hr",
 *   "$25 an hour", "hourly", "(hour)") and its frequency is blank or a per-item one (`per_item`,
 *   `per_occurrence`, `per_transaction`, `one_time`): it becomes `hourly`.
 * - `exempt`, reported only and never written:
 *   - `partial_hour`: a price per part of an hour ("per 15 min", "per half hour", "per minute").
 *   - `category`: a category never charged by the hour (`HOURLY_EXEMPT_KEYS`; "Monthly Fee: (per
 *     hour)" filed as monthly maintenance needs a person, not a new frequency).
 *   - `period_word`: the name also states a period ("Monthly research per hour").
 *   - `stated_period`: the fee already carries a period (monthly, annual, quarterly, daily).
 * "24 hour", "within 48 hours", "after hours", "hours of operation" and "1 hour photo" carry no
 * per-hour basis and never match. A fee already `hourly` is not read again.
 *
 * Each Darwin verify step reads the next `HOURLY_CHECK_BATCH` live flat fees after a cursor kept on
 * the run ledger (the `darwin.hourly_frequency_check` event's `next_after_id`, 0 once a pass reaches
 * the end). An institution-scoped run reads that institution's live fees and leaves the cursor
 * alone. While `HOURLY_FREQUENCY_LIVE` is false, or in a dry run, nothing is written but the step's
 * report. Switched on, the live row and its verified row (when it holds the same frequency) take
 * `hourly`, each change is logged to `pipeline_feedback` (check `darwin.hourly_frequency_check`,
 * evidence `from` and `to`, so it is reversed by setting the frequency back to `from`), and a
 * `darwin.hourly_frequency_set` run event records the batch. Hamilton's frequency fill keeps an
 * `hourly` frequency (`settledFrequency`), so a later publish does not undo it.
 */
export const HOURLY_CHECK = "darwin.hourly_frequency_check";
export const HOURLY_CHECK_VERSION = 1;
/**
 * Default-off switch. It turns on by PR after the dry-run count over the whole live table
 * (`hourlyCountSql`, or the verify step's `hourly_full_count` param) has been shown to James.
 */
export const HOURLY_FREQUENCY_LIVE = false;
/** Live fees read per step; a name-only regex read. */
export const HOURLY_CHECK_BATCH = 2_000;
export const HOURLY_CHECK_SAMPLES = 20;
/** A period in the name besides the hour: the fee's basis is not clear from the name alone. */
export const HOURLY_PERIOD_WORD = /\b(?:monthly|per\s+month|annual(?:ly)?|yearly|per\s+year|quarterly|per\s+quarter|daily|per\s+day|weekly|per\s+week)\b/i;

export type HourlyAction = "set" | "exempt";
export type HourlyExemptReason = "partial_hour" | "category" | "period_word" | "stated_period";

export interface HourlyRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  institution_id: number | string;
  fee_name: string | null;
  amount: number | string | null;
  canonical_fee_key: string | null;
  frequency: string | null;
}

export interface HourlyMatch {
  feePublishedId: number;
  feeVerifiedId: number | null;
  institutionId: number;
  feeName: string;
  amount: number | null;
  canonicalFeeKey: string | null;
  from: string | null;
  action: HourlyAction;
  exemptReason?: HourlyExemptReason;
}

export interface HourlyFindings {
  checked: number;
  matched: number;
  wouldSet: number;
  exempt: number;
  exemptByReason: Record<HourlyExemptReason, number>;
  /** `set` matches by their current frequency ("none" for a blank). */
  wouldSetByFrequency: Record<string, number>;
  setSamples: HourlyMatch[];
  exemptSamples: HourlyMatch[];
}

export interface HourlyResult extends HourlyFindings {
  live: boolean;
  dryRun: boolean;
  afterId: number | null;
  nextAfterId: number | null;
  /** Live fees set to hourly in this step (switch on, not a dry run). */
  set: number[];
}

function num(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Pure: what the re-check does with one live fee, or null when its name names no hourly basis or
 * it is already hourly. See the module note.
 */
export function hourlyVerdict(
  name: string | null | undefined,
  canonicalFeeKey: string | null | undefined,
  frequency: string | null | undefined,
): { action: HourlyAction; exemptReason?: HourlyExemptReason } | null {
  const text = (name ?? "").replace(/\s+/g, " ").trim();
  if (!text || frequency === HOURLY_FREQUENCY) return null;
  const partial = PARTIAL_HOUR_WORDING.test(text);
  if (!partial && !HOURLY_WORDING.test(text)) return null;
  if (partial) return { action: "exempt", exemptReason: "partial_hour" };
  if (canonicalFeeKey != null && HOURLY_EXEMPT_KEYS.has(canonicalFeeKey)) return { action: "exempt", exemptReason: "category" };
  if (HOURLY_PERIOD_WORD.test(text)) return { action: "exempt", exemptReason: "period_word" };
  if (frequency != null && frequencyFamily(frequency) !== "per_item") return { action: "exempt", exemptReason: "stated_period" };
  return { action: "set" };
}

/** Pure: the live rows that name an hourly basis, counted by action and reason, with every match kept. */
export function findHourlyFees(rows: HourlyRow[]): HourlyFindings & { matches: HourlyMatch[] } {
  const exemptByReason: Record<HourlyExemptReason, number> = { partial_hour: 0, category: 0, period_word: 0, stated_period: 0 };
  const wouldSetByFrequency: Record<string, number> = {};
  const matches: HourlyMatch[] = [];
  for (const row of [...rows].sort((a, b) => Number(a.fee_published_id) - Number(b.fee_published_id))) {
    const verdict = hourlyVerdict(row.fee_name, row.canonical_fee_key, row.frequency);
    if (!verdict) continue;
    if (verdict.exemptReason) exemptByReason[verdict.exemptReason] += 1;
    if (verdict.action === "set") {
      const from = row.frequency ?? "none";
      wouldSetByFrequency[from] = (wouldSetByFrequency[from] ?? 0) + 1;
    }
    matches.push({
      feePublishedId: Number(row.fee_published_id),
      feeVerifiedId: num(row.fee_verified_id),
      institutionId: Number(row.institution_id),
      feeName: row.fee_name ?? "",
      amount: num(row.amount),
      canonicalFeeKey: row.canonical_fee_key ?? null,
      from: row.frequency ?? null,
      action: verdict.action,
      ...(verdict.exemptReason ? { exemptReason: verdict.exemptReason } : {}),
    });
  }
  const sets = matches.filter((fee) => fee.action === "set");
  const exempts = matches.filter((fee) => fee.action === "exempt");
  return {
    checked: rows.length,
    matched: matches.length,
    wouldSet: sets.length,
    exempt: exempts.length,
    exemptByReason,
    wouldSetByFrequency,
    setSamples: sets.slice(0, HOURLY_CHECK_SAMPLES),
    exemptSamples: exempts.slice(0, HOURLY_CHECK_SAMPLES),
    matches,
  };
}

function withoutMatches(found: HourlyFindings & { matches: HourlyMatch[] }): HourlyFindings {
  const { matches: _matches, ...findings } = found;
  void _matches;
  return findings;
}

async function readCursor(db: SqlTag): Promise<number> {
  const [row] = await inSavepoint(db, (scope) => scope<{ next_after_id: string | null }[]>`
    SELECT detail->>'next_after_id' AS next_after_id
      FROM agent_run_events
     WHERE event_type = ${HOURLY_CHECK}
       AND detail->>'next_after_id' IS NOT NULL
     ORDER BY created_at DESC, id DESC
     LIMIT 1
  `);
  return num(row?.next_after_id ?? null) ?? 0;
}

/**
 * One step's share of the live re-check (see the module note). Never throws: a failed read reports
 * nothing checked, and a failed write leaves the fees as they were.
 */
export async function recheckHourlyFrequencies(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean; limit?: number },
): Promise<HourlyResult> {
  const live = options.live ?? HOURLY_FREQUENCY_LIVE;
  const limit = Math.max(1, Math.min(options.limit ?? HOURLY_CHECK_BATCH, 20_000));
  const scoped = options.institutionId != null;
  const result: HourlyResult = { live, dryRun: options.dryRun, ...withoutMatches(findHourlyFees([])), afterId: null, nextAfterId: null, set: [] };
  let rows: HourlyRow[];
  try {
    const afterId = scoped ? 0 : await readCursor(db);
    rows = await inSavepoint(db, (scope) => scope<HourlyRow[]>`
      SELECT fp.fee_published_id, fp.lineage_ref AS fee_verified_id, fp.institution_id, fp.fee_name, fp.amount,
             fp.canonical_fee_key, fp.frequency
        FROM published_fee_records fp
       WHERE fp.rolled_back_at IS NULL
         AND fp.quarantined_at IS NULL
         AND fp.amount_kind = 'flat'
         AND fp.fee_published_id > ${afterId}
         AND (${!scoped} OR fp.institution_id = ${options.institutionId ?? 0})
       ORDER BY fp.fee_published_id
       LIMIT ${limit}::int
    `);
    if (!scoped) {
      result.afterId = afterId;
      result.nextAfterId = rows.length < limit ? 0 : Number(rows[rows.length - 1].fee_published_id);
    }
  } catch (error) {
    console.warn("[darwin] hourly frequency check read failed", error instanceof Error ? error.message : error);
    return result;
  }

  const found = findHourlyFees(rows);
  Object.assign(result, withoutMatches(found));
  const sets = found.matches.filter((fee) => fee.action === "set");

  if (live && !options.dryRun && sets.length > 0) {
    try {
      result.set = await inSavepoint(db, async (scope) => {
        const updated = await scope<{ fee_published_id: number | string }[]>`
          UPDATE published_fee_records fp
             SET frequency = ${HOURLY_FREQUENCY}
            FROM unnest(${sets.map((fee) => fee.feePublishedId)}::bigint[], ${sets.map((fee) => fee.from)}::text[])
                 AS v(fee_published_id, from_frequency)
           WHERE fp.fee_published_id = v.fee_published_id
             AND fp.frequency IS NOT DISTINCT FROM v.from_frequency
             AND fp.rolled_back_at IS NULL
             AND fp.quarantined_at IS NULL
          RETURNING fp.fee_published_id
        `;
        const ids = new Set(updated.map((row) => Number(row.fee_published_id)));
        const verified = sets.filter((fee) => ids.has(fee.feePublishedId) && fee.feeVerifiedId != null);
        if (verified.length > 0) {
          await scope`
            UPDATE verified_fee_observations fv
               SET frequency = ${HOURLY_FREQUENCY}
              FROM unnest(${verified.map((fee) => fee.feeVerifiedId as number)}::bigint[], ${verified.map((fee) => fee.from)}::text[])
                   AS v(fee_verified_id, from_frequency)
             WHERE fv.fee_verified_id = v.fee_verified_id
               AND fv.frequency IS NOT DISTINCT FROM v.from_frequency
          `;
        }
        return sets.filter((fee) => ids.has(fee.feePublishedId)).map((fee) => fee.feePublishedId);
      });
    } catch (error) {
      console.error("[darwin] hourly frequency write failed", error instanceof Error ? error.message : error);
      result.set = [];
    }
    if (result.set.length > 0) {
      const done = new Set(result.set);
      const written = sets.filter((fee) => done.has(fee.feePublishedId));
      const lessons: FeedbackRow[] = written.map((fee) => ({
        aboutStage: "extract",
        signal: "wrong",
        kind: fee.from == null ? "frequency_filled" : "frequency_corrected",
        reportedBy: "darwin",
        checkName: HOURLY_CHECK,
        aboutVersion: HOURLY_CHECK_VERSION,
        institutionId: fee.institutionId,
        feeVerifiedId: fee.feeVerifiedId,
        feePublishedId: fee.feePublishedId,
        canonicalFeeKey: fee.canonicalFeeKey,
        amount: fee.amount,
        evidence: { from: fee.from, to: HOURLY_FREQUENCY, fee_name: fee.feeName },
        runId: options.runId,
        dedupeKey: `${HOURLY_CHECK}:v${HOURLY_CHECK_VERSION}:${fee.feePublishedId}:${fee.from ?? "none"}`,
      }));
      try {
        await inSavepoint(db, (scope) => recordFeedback(scope, lessons));
      } catch (error) {
        console.error("[darwin] hourly frequency feedback failed", error instanceof Error ? error.message : error);
      }
      try {
        await inSavepoint(db, (scope) => scope`
          INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
          VALUES (
            ${options.runId}, ${options.stepId ?? null}, 'darwin.hourly_frequency_set', 'completed',
            ${`Set ${result.set.length} live fee(s) priced by the hour to the hourly frequency; old values kept in pipeline_feedback`},
            ${JSON.stringify({
              version: HOURLY_CHECK_VERSION,
              set: result.set.length,
              by_from: written.reduce<Record<string, number>>((counts, fee) => {
                counts[fee.from ?? "none"] = (counts[fee.from ?? "none"] ?? 0) + 1;
                return counts;
              }, {}),
              samples: written.slice(0, HOURLY_CHECK_SAMPLES).map(sampleDetail),
            })}::jsonb
          )
        `);
      } catch (error) {
        console.error("[darwin] hourly frequency event failed", error instanceof Error ? error.message : error);
      }
      invalidatePublicReadCache();
    }
  }

  // The step's report, which also carries the cursor for the next step. A dry run writes nothing.
  if (!options.dryRun) {
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${options.stepId ?? null}, ${HOURLY_CHECK}, 'completed',
          ${`Read ${result.checked} live fee name(s): ${result.matched} name an hourly basis, ${result.wouldSet} would be set hourly, ${result.exempt} exempt; ${live ? `${result.set.length} set` : "switch off, nothing written"}`},
          ${JSON.stringify(hourlyDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[darwin] hourly frequency check event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

function sampleDetail(fee: HourlyMatch) {
  return {
    fee_published_id: fee.feePublishedId,
    institution_id: fee.institutionId,
    fee_name: fee.feeName,
    amount: fee.amount,
    canonical_fee_key: fee.canonicalFeeKey,
    from: fee.from,
    action: fee.action,
    ...(fee.exemptReason ? { exempt_reason: fee.exemptReason } : {}),
  };
}

/** The findings as ledger detail. */
export function hourlyFindingsDetail(found: HourlyFindings) {
  return {
    checked: found.checked,
    matched: found.matched,
    would_set: found.wouldSet,
    exempt: found.exempt,
    exempt_by_reason: found.exemptByReason,
    would_set_by_frequency: found.wouldSetByFrequency,
    samples_set: found.setSamples.map(sampleDetail),
    samples_exempt: found.exemptSamples.map(sampleDetail),
  };
}

/** The step detail (and ledger event detail) for one step's share. */
export function hourlyDetail(result: HourlyResult) {
  return {
    check: HOURLY_CHECK,
    version: HOURLY_CHECK_VERSION,
    switch_live: result.live,
    dry_run: result.dryRun,
    batch: HOURLY_CHECK_BATCH,
    after_id: result.afterId,
    next_after_id: result.nextAfterId,
    ...hourlyFindingsDetail(result),
    set: result.set.length,
  };
}

/**
 * The dry-run count over the whole live table in one read (nothing written, no cursor), for the
 * count James sees before the switch goes on. Run it with the verify step's `hourly_full_count` param.
 */
export async function countHourlyFees(db: SqlTag): Promise<HourlyFindings | null> {
  try {
    const rows = await inSavepoint(db, (scope) => scope<HourlyRow[]>`
      SELECT fp.fee_published_id, fp.lineage_ref AS fee_verified_id, fp.institution_id, fp.fee_name, fp.amount,
             fp.canonical_fee_key, fp.frequency
        FROM published_fee_records fp
       WHERE fp.rolled_back_at IS NULL
         AND fp.quarantined_at IS NULL
         AND fp.amount_kind = 'flat'
         AND fp.fee_name ~* '(hour|hr|min)'
       ORDER BY fp.fee_published_id
    `);
    return withoutMatches(findHourlyFees(rows));
  } catch (error) {
    console.warn("[darwin] hourly frequency full count failed", error instanceof Error ? error.message : error);
    return null;
  }
}

/** A JS regex as a Postgres ARE literal: `\b` is a backspace there, `\y` the word boundary. */
function postgresPattern(re: RegExp): string {
  return re.source.replace(/\\b/g, "\\y").replace(/'/g, "''");
}

/**
 * The `CASE` that mirrors `hourlyVerdict` over the columns `name`, `canonical_fee_key` and
 * `frequency`: 'set', an exempt reason, or NULL for no hourly basis.
 */
function hourlyVerdictSql(): string {
  const exemptKeys = [...HOURLY_EXEMPT_KEYS].map((key) => `'${key}'`).join(", ");
  return `CASE
    WHEN frequency IS NOT DISTINCT FROM '${HOURLY_FREQUENCY}' THEN NULL
    WHEN name ~* '${postgresPattern(PARTIAL_HOUR_WORDING)}' THEN 'partial_hour'
    WHEN name !~* '${postgresPattern(HOURLY_WORDING)}' THEN NULL
    WHEN canonical_fee_key IN (${exemptKeys}) THEN 'category'
    WHEN name ~* '${postgresPattern(HOURLY_PERIOD_WORD)}' THEN 'period_word'
    WHEN frequency IS NOT NULL AND frequency NOT IN ('per_item', 'per_transaction', 'per_occurrence', 'one_time') THEN 'stated_period'
    ELSE 'set'
  END`;
}

function liveHourlySql(): string {
  return `WITH live AS (
  SELECT fee_published_id, institution_id, canonical_fee_key, amount, frequency, fee_name,
         btrim(regexp_replace(COALESCE(fee_name, ''), '\\s+', ' ', 'g')) AS name
    FROM published_fee_records
   WHERE rolled_back_at IS NULL AND quarantined_at IS NULL AND amount_kind = 'flat'
), judged AS (
  SELECT *, ${hourlyVerdictSql()} AS reason
    FROM live
)`;
}

/**
 * The same count as one read-only SQL statement, for someone with prod access (#1456): live flat
 * fees whose name names an hourly basis, by action ('set' or 'exempt'), reason and current
 * frequency ('none' for a blank). Built from the same regexes as `hourlyVerdict`. Known difference:
 * Postgres's word boundary reads non-ASCII letters as word characters, which JS does not.
 */
export function hourlyCountSql(): string {
  return `${liveHourlySql()}
SELECT COALESCE(action, 'all actions') AS action, COALESCE(reason, 'all reasons') AS reason,
       COALESCE(current_frequency, 'all frequencies') AS current_frequency, count(*) AS fees
  FROM (
    SELECT CASE WHEN reason = 'set' THEN 'set' ELSE 'exempt' END AS action, reason,
           COALESCE(frequency, 'none') AS current_frequency
      FROM judged
     WHERE reason IS NOT NULL
  ) counted
 GROUP BY GROUPING SETS ((action, reason, current_frequency), (action, reason), (action), ())
 ORDER BY 1, 2, 3;`;
}

/** Read-only: `limit` random live fees the switch would set to hourly, with their current frequency. */
export function hourlySamplesSql(limit = 40): string {
  const rows = Math.max(1, Math.min(Math.trunc(limit), 500));
  return `${liveHourlySql()}
SELECT fee_published_id AS id, institution_id, fee_name AS name, amount, canonical_fee_key,
       COALESCE(frequency, 'none') AS current_frequency
  FROM judged
 WHERE reason = 'set'
 ORDER BY random()
 LIMIT ${rows};`;
}
