import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import {
  LIVE_FRAGMENT_REGEXES,
  gluedSentenceHead,
  liveFragmentName,
  liveFragmentShape,
  writeLiveRenames,
  type LiveFragmentPattern,
  type RetidyRename,
} from "@/lib/agents/knox/name-retidy";
import { checkFeeCategory } from "@/lib/fee-category-guard";

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
 *
 * Switch-on prerequisites (#1443, after a hand sample of 100 `pronoun` rows found about 77
 * fragments, 15 real fees with a sentence glued on and 8 real names), each match takes one action
 * (`liveFragmentVerdict`):
 * - `exempt` `parenthetical`: a pronoun only inside a parenthetical ("Stop Payment (per item, if
 *   you request it)") is no fragment (`liveFragmentName` returns null; the shape is still counted).
 * - `rename`: a `pronoun` or `sentence_end` name that opens with a real fee name and has a sentence
 *   glued on ("Overdraft Fee You will be charged when ...") keeps the fee under that name
 *   (`gluedSentenceHead`), when its amount is above $0, the name has no waiver or discount wording
 *   and the category guard still accepts the name. The rename goes through Knox's live rename path
 *   (`writeLiveRenames`: a `pipeline_feedback` `name_retidied` row with the old name, checked as
 *   `darwin.live_fragment_check`, then the guarded `fee_name` update), skipped when another live fee
 *   of the bank already has that name at the same price and category.
 * - `trailing_range` comes down only when the name has waiver or discount wording or the amount is
 *   $0 (the waived price); otherwise it is `exempt` `trailing_range_priced`, reported only.
 * - Everything else is a `takedown`, as before.
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
/**
 * The strategy a rename's `pipeline_feedback` row is about (#1443). v1: the parenthetical
 * exemption, the glued-sentence rename and the priced trailing range left live.
 */
export const LIVE_FRAGMENT_STRATEGY = { strategy: LIVE_FRAGMENT_CHECK, version: 1 } as const;
/** Waiver or discount wording: a name that says the price is waived or cut is a waived price, never renamed. */
export const LIVE_FRAGMENT_WAIVE_WORDING = /\b(?:waiv(?:e|ed|er|ers|es|ing)|discount(?:s|ed)?|rebates?|reduc(?:e|ed|es|tion)|avoid(?:ed|s)?|no charge)\b/i;

export type LiveFragmentAction = "takedown" | "rename" | "exempt";
export type LiveFragmentExemptReason = "parenthetical" | "trailing_range_priced";

export interface LiveFragmentRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  institution_id: number | string;
  fee_name: string | null;
  amount: number | string | null;
  canonical_fee_key?: string | null;
}

export interface LiveFragmentSample {
  feePublishedId: number;
  feeVerifiedId: number | null;
  institutionId: number;
  feeName: string;
  amount: number | null;
  canonicalFeeKey: string | null;
  pattern: LiveFragmentPattern;
  action: LiveFragmentAction;
  /** `rename`: the fee name the fragment opens with. */
  renameTo?: string;
  /** `exempt`: why the fee stays live under its name. */
  exemptReason?: LiveFragmentExemptReason;
}

type PatternCounts = Record<LiveFragmentPattern, number>;
const emptyPatterns = (): PatternCounts => ({ plus: 0, trailing_range: 0, sentence_end: 0, pronoun: 0 });
const emptyByAction = (): Record<LiveFragmentAction, PatternCounts> => ({ takedown: emptyPatterns(), rename: emptyPatterns(), exempt: emptyPatterns() });
const emptySamples = (): Record<LiveFragmentAction, LiveFragmentSample[]> => ({ takedown: [], rename: [], exempt: [] });

export interface LiveFragmentFindings {
  checked: number;
  /** Names carrying a live fragment shape, whatever the action. */
  matched: number;
  /** Matches that would come down (`takedown`). */
  wouldTakeDown: number;
  /** Matches that would keep their fee under a cleaned name (`rename`). */
  wouldRename: number;
  /** Matches that stay live under their name (`exempt`). */
  exempt: number;
  exemptByReason: Record<LiveFragmentExemptReason, number>;
  byPattern: PatternCounts;
  byAction: Record<LiveFragmentAction, PatternCounts>;
  /** Up to `LIVE_FRAGMENT_SAMPLES` of each action. */
  samplesByAction: Record<LiveFragmentAction, LiveFragmentSample[]>;
  /** Up to `LIVE_FRAGMENT_SAMPLES` of every match, in id order. */
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
  /** Live fees renamed in this step (switch on, not a dry run). */
  renamed: number[];
  /** Rename candidates left as they are: another live fee of the bank already has the name at that price and category. */
  renameSkipped: number;
}

function num(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Pure (#1443): what the re-check does with one live name, or null when the name carries no live
 * fragment shape. See the module note for the rules.
 */
export function liveFragmentVerdict(
  name: string | null | undefined,
  amount: number | null,
  canonicalFeeKey: string | null = null,
): { pattern: LiveFragmentPattern; action: LiveFragmentAction; renameTo?: string; exemptReason?: LiveFragmentExemptReason } | null {
  const pattern = liveFragmentShape(name);
  if (!pattern) return null;
  if (!liveFragmentName(name)) return { pattern, action: "exempt", exemptReason: "parenthetical" };
  const current = (name ?? "").replace(/\s+/g, " ").trim();
  const waived = LIVE_FRAGMENT_WAIVE_WORDING.test(current);
  if (pattern === "trailing_range") {
    return waived || amount === 0 ? { pattern, action: "takedown" } : { pattern, action: "exempt", exemptReason: "trailing_range_priced" };
  }
  if (pattern === "pronoun" || pattern === "sentence_end") {
    const head = gluedSentenceHead(current);
    if (head && amount != null && amount > 0 && !waived && liveFragmentName(head) == null) {
      // Knox's rename bar: a name the category guard accepted must still be accepted once cleaned.
      const guardOk = canonicalFeeKey == null || !checkFeeCategory(canonicalFeeKey, current).ok || checkFeeCategory(canonicalFeeKey, head).ok;
      if (guardOk) return { pattern, action: "rename", renameTo: head };
    }
  }
  return { pattern, action: "takedown" };
}

/** Pure: the live rows whose catalog name is a fragment, counted by pattern and action, with every match kept. */
export function findLiveFragments(rows: LiveFragmentRow[]): LiveFragmentFindings & { matches: LiveFragmentSample[] } {
  const byPattern = emptyPatterns();
  const byAction = emptyByAction();
  const samplesByAction = emptySamples();
  const exemptByReason: Record<LiveFragmentExemptReason, number> = { parenthetical: 0, trailing_range_priced: 0 };
  const matches: LiveFragmentSample[] = [];
  for (const row of rows) {
    const amount = num(row.amount);
    const canonicalFeeKey = row.canonical_fee_key ?? null;
    const verdict = liveFragmentVerdict(row.fee_name, amount, canonicalFeeKey);
    if (!verdict) continue;
    byPattern[verdict.pattern] += 1;
    byAction[verdict.action][verdict.pattern] += 1;
    if (verdict.exemptReason) exemptByReason[verdict.exemptReason] += 1;
    const sample: LiveFragmentSample = {
      feePublishedId: Number(row.fee_published_id),
      feeVerifiedId: num(row.fee_verified_id),
      institutionId: Number(row.institution_id),
      feeName: row.fee_name ?? "",
      amount,
      canonicalFeeKey,
      pattern: verdict.pattern,
      action: verdict.action,
      ...(verdict.renameTo ? { renameTo: verdict.renameTo } : {}),
      ...(verdict.exemptReason ? { exemptReason: verdict.exemptReason } : {}),
    };
    matches.push(sample);
    if (samplesByAction[verdict.action].length < LIVE_FRAGMENT_SAMPLES) samplesByAction[verdict.action].push(sample);
  }
  const count = (action: LiveFragmentAction) => matches.filter((fee) => fee.action === action).length;
  return {
    checked: rows.length,
    matched: matches.length,
    wouldTakeDown: count("takedown"),
    wouldRename: count("rename"),
    exempt: count("exempt"),
    exemptByReason,
    byPattern,
    byAction,
    samplesByAction,
    samples: matches.slice(0, LIVE_FRAGMENT_SAMPLES),
    matches,
  };
}

/** The findings without every match (the ledger keeps samples only). */
function withoutMatches(found: LiveFragmentFindings & { matches: LiveFragmentSample[] }): LiveFragmentFindings {
  const { checked, matched, wouldTakeDown, wouldRename, exempt, exemptByReason, byPattern, byAction, samplesByAction, samples } = found;
  return { checked, matched, wouldTakeDown, wouldRename, exempt, exemptByReason, byPattern, byAction, samplesByAction, samples };
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
       AND detail->>'next_after_id' IS NOT NULL
     ORDER BY created_at DESC, id DESC
     LIMIT 1
  `);
  return num(row?.next_after_id ?? null) ?? 0;
}

/** Live fees the rename would give a name another live fee of the bank already has at the same price and category. */
function renameKey(institutionId: number, canonicalFeeKey: string | null, amount: number | null, name: string): string {
  return `${institutionId}|${canonicalFeeKey ?? ""}|${amount == null ? "" : amount.toFixed(2)}|${name.trim().toLowerCase()}`;
}

/**
 * Pure: the rename candidates that may be written, dropping any whose new name another live fee of
 * the bank (`taken`, keys from `renameKey`) or an earlier candidate already has at the same price
 * and category (the duplicate collapse would close one of them).
 */
export function writableRenames(candidates: LiveFragmentSample[], taken: Set<string>): { renames: RetidyRename[]; skipped: number } {
  const seen = new Set(taken);
  const renames: RetidyRename[] = [];
  let skipped = 0;
  for (const fee of candidates) {
    if (fee.action !== "rename" || !fee.renameTo) continue;
    const key = renameKey(fee.institutionId, fee.canonicalFeeKey, fee.amount, fee.renameTo);
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    renames.push({
      feePublishedId: fee.feePublishedId,
      institutionId: fee.institutionId,
      sourceDocumentId: null,
      canonicalFeeKey: fee.canonicalFeeKey ?? "",
      amount: fee.amount,
      oldName: fee.feeName,
      newName: fee.renameTo,
    });
  }
  return { renames, skipped };
}

/**
 * One step's share of the live re-check (see the module note). Never throws: a failed read
 * reports nothing checked, and a failed takedown or rename leaves the fees as they were.
 */
export async function recheckLiveFragmentNames(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean; limit?: number },
): Promise<LiveFragmentResult> {
  const live = options.live ?? FRAGMENT_NAME_TAKEDOWN_LIVE;
  const limit = Math.max(1, Math.min(options.limit ?? LIVE_FRAGMENT_BATCH, 20_000));
  const scoped = options.institutionId != null;
  const result: LiveFragmentResult = {
    live,
    dryRun: options.dryRun,
    ...withoutMatches(findLiveFragments([])),
    afterId: null,
    nextAfterId: null,
    takenDown: [],
    renamed: [],
    renameSkipped: 0,
  };
  let rows: LiveFragmentRow[];
  try {
    const afterId = scoped ? 0 : await readCursor(db);
    rows = await inSavepoint(db, (scope) => scope<LiveFragmentRow[]>`
      SELECT fp.fee_published_id, fp.lineage_ref AS fee_verified_id, fp.institution_id, fp.fee_name, fp.amount, fp.canonical_fee_key
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

  const all = findLiveFragments(rows);
  const { matches } = all;
  Object.assign(result, withoutMatches(all));
  const takedowns = matches.filter((fee) => fee.action === "takedown");
  const renameCandidates = matches.filter((fee) => fee.action === "rename");

  if (live && !options.dryRun && takedowns.length > 0) {
    try {
      result.takenDown = await inSavepoint(db, async (scope) => {
        const updated = await scope<{ fee_published_id: number | string }[]>`
          UPDATE published_fee_records fp
             SET rolled_back_at = NOW(),
                 rolled_back_by_batch_id = ${`darwin-live-fragment-${options.runId}`},
                 rolled_back_reason = v.reason
            FROM unnest(${takedowns.map((fee) => fee.feePublishedId)}::bigint[], ${takedowns.map((fee) => liveFragmentReason(fee.pattern))}::text[])
                 AS v(fee_published_id, reason)
           WHERE fp.fee_published_id = v.fee_published_id
             AND fp.rolled_back_at IS NULL
          RETURNING fp.fee_published_id
        `;
        const ids = new Set(updated.map((row) => Number(row.fee_published_id)));
        const verified = takedowns.filter((fee) => ids.has(fee.feePublishedId) && fee.feeVerifiedId != null);
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
        return takedowns.filter((fee) => ids.has(fee.feePublishedId)).map((fee) => fee.feePublishedId);
      });
    } catch (error) {
      console.error("[darwin] live fragment takedown failed", error instanceof Error ? error.message : error);
      result.takenDown = [];
    }
    if (result.takenDown.length > 0) {
      const down = new Set(result.takenDown);
      const archived = takedowns.filter((fee) => down.has(fee.feePublishedId));
      try {
        await inSavepoint(db, (scope) => scope`
          INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
          VALUES (
            ${options.runId}, ${options.stepId ?? null}, 'darwin.live_fragment_name_taken_down', 'completed',
            ${`Archived ${result.takenDown.length} live fee(s) whose name is a sentence fragment`},
            ${JSON.stringify({
              batch_id: `darwin-live-fragment-${options.runId}`,
              taken_down: result.takenDown.length,
              by_pattern: archived.reduce<Record<string, number>>((counts, fee) => {
                counts[fee.pattern] = (counts[fee.pattern] ?? 0) + 1;
                return counts;
              }, {}),
              samples: archived.slice(0, LIVE_FRAGMENT_SAMPLES).map(sampleDetail),
            })}::jsonb
          )
        `);
      } catch (error) {
        console.error("[darwin] live fragment takedown event failed", error instanceof Error ? error.message : error);
      }
    }
  }

  if (live && !options.dryRun && renameCandidates.length > 0) {
    try {
      const renames = await inSavepoint(db, async (scope) => {
        const institutions = [...new Set(renameCandidates.map((fee) => fee.institutionId))];
        const names = [...new Set(renameCandidates.map((fee) => (fee.renameTo ?? "").toLowerCase()))];
        const existing = await scope<{ institution_id: number | string; canonical_fee_key: string | null; amount: number | string | null; fee_name: string }[]>`
          SELECT fp.institution_id, fp.canonical_fee_key, fp.amount, fp.fee_name
            FROM published_fee_records fp
           WHERE fp.rolled_back_at IS NULL
             AND fp.institution_id = ANY(${institutions}::bigint[])
             AND lower(btrim(fp.fee_name)) = ANY(${names}::text[])
        `;
        const taken = new Set(existing.map((row) => renameKey(Number(row.institution_id), row.canonical_fee_key, num(row.amount), row.fee_name)));
        const plan = writableRenames(renameCandidates, taken);
        result.renameSkipped = plan.skipped;
        // Knox's live rename path: the old name logged in pipeline_feedback, then the guarded update.
        await writeLiveRenames(scope, plan.renames, {
          strategy: LIVE_FRAGMENT_STRATEGY.strategy,
          version: LIVE_FRAGMENT_STRATEGY.version,
          reportedBy: "darwin",
          runId: options.runId,
        });
        return plan.renames;
      });
      result.renamed = renames.map((rename) => rename.feePublishedId);
      if (renames.length > 0) {
        await inSavepoint(db, (scope) => scope`
          INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
          VALUES (
            ${options.runId}, ${options.stepId ?? null}, 'darwin.live_fragment_name_renamed', 'completed',
            ${`Renamed ${renames.length} live fee(s) whose name had a sentence glued on; old names kept in pipeline_feedback`},
            ${JSON.stringify({
              version: LIVE_FRAGMENT_STRATEGY.version,
              renamed: renames.length,
              skipped_same_name_live: result.renameSkipped,
              samples: renames.slice(0, LIVE_FRAGMENT_SAMPLES).map((rename) => ({
                fee_published_id: rename.feePublishedId,
                institution_id: rename.institutionId,
                old_name: rename.oldName,
                new_name: rename.newName,
                amount: rename.amount,
              })),
            })}::jsonb
          )
        `);
      }
    } catch (error) {
      console.error("[darwin] live fragment rename failed", error instanceof Error ? error.message : error);
      result.renamed = [];
    }
  }
  if (result.takenDown.length > 0 || result.renamed.length > 0) invalidatePublicReadCache();

  // The step's report, which also carries the cursor for the next step. A dry run writes nothing.
  if (!options.dryRun) {
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${options.stepId ?? null}, ${LIVE_FRAGMENT_CHECK}, 'completed',
          ${`Read ${result.checked} live fee name(s): ${result.matched} fragment shape(s), ${result.wouldTakeDown} takedown, ${result.wouldRename} rename, ${result.exempt} exempt; ${live ? `${result.takenDown.length} archived, ${result.renamed.length} renamed` : "switch off, nothing written"}`},
          ${JSON.stringify(liveFragmentDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[darwin] live fragment check event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

function sampleDetail(fee: LiveFragmentSample) {
  return {
    fee_published_id: fee.feePublishedId,
    institution_id: fee.institutionId,
    fee_name: fee.feeName,
    amount: fee.amount,
    pattern: fee.pattern,
    action: fee.action,
    ...(fee.renameTo ? { rename_to: fee.renameTo } : {}),
    ...(fee.exemptReason ? { exempt_reason: fee.exemptReason } : {}),
  };
}

/** The findings as ledger detail, split by action (takedown / rename / exempt) with samples of each. */
export function liveFragmentFindingsDetail(found: LiveFragmentFindings) {
  return {
    checked: found.checked,
    matched: found.matched,
    would_take_down: found.wouldTakeDown,
    would_rename: found.wouldRename,
    exempt: found.exempt,
    exempt_by_reason: found.exemptByReason,
    by_pattern: found.byPattern,
    by_action: found.byAction,
    samples_by_action: {
      takedown: found.samplesByAction.takedown.map(sampleDetail),
      rename: found.samplesByAction.rename.map(sampleDetail),
      exempt: found.samplesByAction.exempt.map(sampleDetail),
    },
  };
}

/** The step detail (and ledger event detail) for one step's share. */
export function liveFragmentDetail(result: LiveFragmentResult) {
  return {
    check: LIVE_FRAGMENT_CHECK,
    version: LIVE_FRAGMENT_STRATEGY.version,
    takedown_live: result.live,
    dry_run: result.dryRun,
    batch: LIVE_FRAGMENT_BATCH,
    after_id: result.afterId,
    next_after_id: result.nextAfterId,
    ...liveFragmentFindingsDetail(result),
    taken_down: result.takenDown.length,
    renamed: result.renamed.length,
    rename_skipped_same_name_live: result.renameSkipped,
  };
}

/** A JS regex as a Postgres ARE literal: `\b` is a backspace there, `\y` the word boundary. */
function postgresPattern(re: RegExp): string {
  return re.source.replace(/\\b/g, "\\y").replace(/'/g, "''");
}

/**
 * The same count as one read-only SQL statement, for someone with prod access (#1443), by action
 * (takedown / rename / exempt) and pattern. Built from `LIVE_FRAGMENT_REGEXES` and
 * `LIVE_FRAGMENT_WAIVE_WORDING`, so it stays in step with `liveFragmentVerdict`, with two known
 * differences: Postgres's word boundary reads non-ASCII letters as word characters, which JS does
 * not, so a name with accented letters next to a matched word can count differently; and the SQL
 * does not run the category guard on a rename (a cleaned name the guard would refuse comes down in
 * the step but counts as a rename here; the step's ledger is the exact count). The trailing
 * range's optional leading separators (`[\s\-–—|:,]*`) never change whether it matches, so the SQL
 * leaves them out.
 */
export function liveFragmentCountSql(): string {
  const re = LIVE_FRAGMENT_REGEXES;
  const waive = postgresPattern(LIVE_FRAGMENT_WAIVE_WORDING);
  const bars = re.glued_head_bars.map((bar) => `head !~* '${postgresPattern(bar)}'`).join(" AND ");
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
  END AS pattern,
  btrim(regexp_replace(regexp_replace(name, '${postgresPattern(re.parenthetical)}', ' ', 'g'), '\\s+', ' ', 'g')) AS outside,
  substring(name from '${postgresPattern(re.glued_sentence)}') AS head
  FROM live
), acted AS (
  SELECT pattern, CASE
    WHEN pattern = 'pronoun' AND outside !~* '${postgresPattern(re.pronoun)}' THEN 'exempt'
    WHEN pattern = 'trailing_range' THEN CASE WHEN name ~* '${waive}' OR COALESCE(amount, -1) = 0 THEN 'takedown' ELSE 'exempt' END
    WHEN pattern IN ('pronoun', 'sentence_end') AND head IS NOT NULL AND COALESCE(amount, 0) > 0 AND name !~* '${waive}'
         AND array_length(regexp_split_to_array(head, ' '), 1) <= ${re.glued_head_max_words} AND ${bars} THEN 'rename'
    ELSE 'takedown'
  END AS action
  FROM tagged
 WHERE pattern IS NOT NULL
)
SELECT COALESCE(action, 'all actions') AS action, COALESCE(pattern, 'all patterns') AS pattern, count(*) AS fees
  FROM acted
 GROUP BY GROUPING SETS ((action, pattern), (action), ())
 ORDER BY action NULLS LAST, pattern NULLS LAST;`;
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
      SELECT fp.fee_published_id, fp.lineage_ref AS fee_verified_id, fp.institution_id, fp.fee_name, fp.amount, fp.canonical_fee_key
        FROM published_fee_records fp
       WHERE fp.rolled_back_at IS NULL
         AND fp.quarantined_at IS NULL
       ORDER BY fp.fee_published_id
    `);
    return withoutMatches(findLiveFragments(rows));
  } catch (error) {
    console.warn("[darwin] live fragment full count failed", error instanceof Error ? error.message : error);
    return null;
  }
}
