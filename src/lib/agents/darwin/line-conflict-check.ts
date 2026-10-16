import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import { excerptOf } from "@/lib/agents/hamilton/frequency-fill";
import { frequencyClass } from "@/lib/agents/hamilton/exact-duplicate";
import { CATEGORY_GUARD_RULES, checkFeeCategory, refileCategory } from "@/lib/fee-category-guard";
import { frequencyFamily, frequencyFromLine, PERIOD_FEE_KEYS } from "@/lib/fee-frequency";
import { loadCategoryModel, scoreCategories, type CategoryModel } from "./category-model";

type SqlTag = typeof sql;

/**
 * Darwin's live re-check of one printed line live twice (#1440; decision 2026-10-15, "Darwin
 * re-checks every live fee against today's rules"). James's catalog review (Oct 15) found 114 groups
 * of live fees sharing institution, name, amount and source address, two rows each: 98 the same line
 * filed under two categories (1st Summit's "Prepaid Card" $5 as document reproduction and gift card
 * purchase), 16 the same category with two frequencies that disagree (Abound's safe deposit boxes,
 * per item from doc 14200 and annual from doc 23312). The exact collapse
 * (`hamilton/duplicate-collapse.ts`) partitions by category and leaves conflicting frequency classes
 * apart on purpose, and the publish-time refusal (`hamilton/exact-duplicate.ts`) uses the same key,
 * so neither reaches them.
 *
 * A line is the live rows of one institution with the same name (case and outer spaces ignored),
 * amount, rate, variant and source address. A line with two categories, or one category and two
 * stated frequency classes (per item, per occurrence, per transaction and one-time are one class;
 * a blank or "other" matches any), is a conflict. One reading is kept and the others are retired
 * (`lineConflictVerdict`):
 * - `category` conflicts, in order:
 *   1. `refile`: the shared category guard re-files one row's category to another category of the
 *      line (`refileCategory`), and that category stays put under its own name.
 *   2. `guard`: the guard refuses the name under every category but one (`checkFeeCategory`; a
 *      category with no guard rule neither passes nor fails).
 *   3. `model`: Darwin's category model (`category-model.ts`, trained on the live catalog and the
 *      answer key) gives one of the line's categories at least `LINE_MODEL_MIN` (0.95) and disputes
 *      every other (at most `LINE_MODEL_OTHER_MAX`, its 0.05 dispute threshold). Never between the
 *      unsettled lending categories alone (`UNSETTLED_LENDING_KEYS`).
 *   Otherwise the line is `undecided` and stays as it is.
 * - `frequency` conflicts: the frequency the line states for the fee's own price
 *   (`frequencyFromLine` on the schedule line Knox read, `excerpt=` in its conditions). Rows of that
 *   class (or blank) are kept; the others are retired. No line, a line that states no frequency or
 *   one no row carries, a line with a rate on it, or a per-item reading of a period category
 *   (`PERIOD_FEE_KEYS`) is `undecided`.
 * Kept apart (reported, never retired):
 * - `audiences`: two rows state different audiences (personal and business, say); the page may
 *   print the line once in each schedule.
 * - `joint_line`: the name joins two fees outside its notes ("Money order/Cashier check fee",
 *   "Overdraft Fee or NSF Fee"; a `/`, `&`, "and" or "or" between them) and the guard has a rule for every category on
 *   the line and accepts the name under each. The bank charges that price for both.
 *
 * Each Darwin verify step reads every conflicting line in one grouped read (a few hundred rows; an
 * institution-scoped run reads that institution's). While `LINE_CONFLICT_TAKEDOWN_LIVE` is false, or
 * in a dry run, the step only reports what it would retire. Switched on, each retired row goes
 * through the shared 12-hour second look (check `darwin.line_conflict`) and is archived on its
 * second failure: rolled back with `one line, two reads: kept #<id> (<basis>)`, its verified row
 * rejected with the `one_line_two_reads` flag so publish does not bring it back, never deleted, and
 * a `darwin.line_conflict_takedown` event lists them. Rows that pass clear a pending flag.
 */
export const LINE_CONFLICT_CHECK = "darwin.line_conflict";
export const LINE_CONFLICT_CHECK_VERSION = 1;
/**
 * Default-off switch. It turns on by PR after James has seen the dry-run count over every live
 * line (`lineConflictCountSql` for the conflicts, the verify step's detail for the verdicts).
 */
export const LINE_CONFLICT_TAKEDOWN_LIVE = false;
export const LINE_CONFLICT_FLAG = "one_line_two_reads";
export const LINE_CONFLICT_REASON_PREFIX = "one line, two reads: kept #";
/** The model's floor for the category it keeps, and its ceiling for the next best on the line. */
export const LINE_MODEL_MIN = 0.95;
/** The model's own dispute threshold (`CATEGORY_DISPUTE_THRESHOLD`): it disputes every category it retires. */
export const LINE_MODEL_OTHER_MAX = 0.05;
/**
 * Lending categories whose borders the taxonomy has not settled: its aliases file a loan modification
 * and a loan extension under loan origination and a skip-a-pay under late payment, while the fold
 * files a mortgage modification under other lending fee. The model, trained on the live catalog,
 * leans to other lending fee for all of them ("Mortgage loan application fee", "Loan Processing
 * Fee"), so it never decides between these; a line filed only under them stays `undecided` unless
 * the guard decides.
 */
export const UNSETTLED_LENDING_KEYS: ReadonlySet<string> = new Set(["loan_origination", "other_lending_fee", "late_payment"]);
export const LINE_CONFLICT_SAMPLES = 25;

export type LineConflictKind = "category" | "frequency";
export type LineConflictBasis = "refile" | "guard" | "model" | "line";
export type LineConflictExempt = "audiences" | "joint_line" | "undecided";

export interface LineConflictRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  institution_id: number | string;
  fee_name: string | null;
  amount: number | string | null;
  rate_percent: number | string | null;
  variant_type: string | null;
  source_url: string | null;
  canonical_fee_key: string;
  frequency: string | null;
  fee_audience: string | null;
  published_at: string | Date | null;
  source_document_id: number | string | null;
  /** The raw row's extraction note or conditions, which end with Knox's `excerpt=`. */
  conditions: string | null;
}

export interface LineConflictVerdict {
  kind: LineConflictKind;
  institutionId: number;
  feeName: string;
  amount: number | null;
  categories: string[];
  frequencies: Array<string | null>;
  rows: number[];
  /** Set when a reading is kept and the others retired. */
  basis?: LineConflictBasis;
  /** The category (or frequency class) kept. */
  keptReading?: string;
  keptFeePublishedId?: number;
  retired: LineConflictRetire[];
  exempt?: LineConflictExempt;
  /** The model's probability for each category on the line, when it was asked. */
  model?: Record<string, number>;
}

export interface LineConflictRetire {
  feePublishedId: number;
  feeVerifiedId: number | null;
  institutionId: number;
  canonicalFeeKey: string;
  amount: number | null;
  sourceDocumentId: number | null;
  frequency: string | null;
  keptFeePublishedId: number;
  basis: LineConflictBasis;
  /** The rolled-back reason the archive writes. */
  reason: string;
}

export interface LineConflictFindings {
  lines: number;
  rows: number;
  byKind: Record<LineConflictKind, number>;
  /** Lines with a kept reading, by how it was chosen. */
  byBasis: Record<LineConflictBasis, number>;
  byExempt: Record<LineConflictExempt, number>;
  /** Live rows that would be retired. */
  wouldRetire: number;
  samples: LineConflictVerdict[];
  exemptSamples: LineConflictVerdict[];
}

export interface LineConflictResult extends LineConflictFindings {
  live: boolean;
  dryRun: boolean;
  modelLoaded: boolean;
  flagged: number;
  waiting: number;
  cleared: number;
  takenDown: number[];
}

function num(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function lineKey(row: LineConflictRow): string {
  return [
    row.institution_id,
    (row.fee_name ?? "").trim().toLowerCase(),
    num(row.amount)?.toFixed(2) ?? "",
    num(row.rate_percent)?.toString() ?? "",
    row.variant_type ?? "",
    row.source_url ?? "",
  ].join("|");
}

/**
 * Two fees joined in one name: "Money order/Cashier check", "Overdraft Fee or NSF Fee", "Overdrafts &
 * NSF". Read outside the name's notes: "Stop Payment on Money Order (lost or stolen only)" is one fee.
 */
const JOINER = /\s*\/\s*|\s+&\s+|\s+(?:and|or)\s+/i;
function joinsTwoFees(name: string): boolean {
  return JOINER.test(name.replace(/\([^()]*(?:\)|$)/g, " "));
}
/** A rate on the line ("5% of the monthly payment or $35.00"): its period words belong to the rate. */
const RATE_ON_LINE = /\d\s?%/;

function guarded(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(CATEGORY_GUARD_RULES, key);
}

/** Copy kept among rows of the kept reading: states its audience, then its frequency, then newest. */
function bestRow(rows: LineConflictRow[]): LineConflictRow {
  const rank = (row: LineConflictRow) => ((row.fee_audience ?? "unknown") === "unknown" ? 2 : 0) + (row.frequency == null ? 1 : 0);
  return [...rows].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      new Date(b.published_at ?? 0).getTime() - new Date(a.published_at ?? 0).getTime() ||
      Number(b.fee_published_id) - Number(a.fee_published_id),
  )[0];
}

function stated(audience: string | null): string | null {
  return audience == null || audience === "unknown" ? null : audience;
}

/**
 * Pure: the verdict for one line's live rows, or null when they do not conflict (one category and
 * no two stated frequency classes). `model` may be null; the `model` step is then skipped.
 */
export function lineConflictVerdict(rows: LineConflictRow[], model: CategoryModel | null): LineConflictVerdict | null {
  if (rows.length < 2) return null;
  const categories = [...new Set(rows.map((row) => row.canonical_fee_key))].sort();
  const classes = new Set(rows.map((row) => frequencyClass(row.frequency)).filter((value): value is string => value != null));
  const kind: LineConflictKind | null = categories.length > 1 ? "category" : classes.size > 1 ? "frequency" : null;
  if (!kind) return null;
  const name = rows[0].fee_name ?? "";
  const amount = num(rows[0].amount);
  const verdict: LineConflictVerdict = {
    kind,
    institutionId: Number(rows[0].institution_id),
    feeName: name,
    amount,
    categories,
    frequencies: rows.map((row) => row.frequency),
    rows: rows.map((row) => Number(row.fee_published_id)),
    retired: [],
  };
  const audiences = new Set(rows.map((row) => stated(row.fee_audience)).filter(Boolean));
  if (audiences.size > 1) return { ...verdict, exempt: "audiences" };

  let keep: ((row: LineConflictRow) => boolean) | null = null;
  let basis: LineConflictBasis | null = null;
  let keptReading: string | null = null;

  if (kind === "category") {
    const context = { amount };
    const ok = new Map(categories.map((key) => [key, checkFeeCategory(key, name, context).ok]));
    if (joinsTwoFees(name) && categories.every((key) => guarded(key) && ok.get(key))) return { ...verdict, exempt: "joint_line" };
    // 1. The guard re-files one category of the line into another, which stays put.
    const refiledTo = new Set(
      categories.map((key) => refileCategory(key, name)).filter((to, index) => to != null && to !== categories[index] && categories.includes(to)),
    );
    const settled = [...refiledTo].filter((to) => refileCategory(to, name) === to);
    if (settled.length === 1) {
      basis = "refile";
      keptReading = settled[0];
    }
    // 2. The guard refuses the name under every category but one.
    if (!basis) {
      const failing = categories.filter((key) => guarded(key) && !ok.get(key));
      const standing = categories.filter((key) => !failing.includes(key));
      if (failing.length > 0 && standing.length === 1) {
        basis = "guard";
        keptReading = standing[0];
      }
    }
    // 3. Darwin's category model prefers one category of the line clearly.
    if (model) {
      const scores = scoreCategories(model, name);
      verdict.model = Object.fromEntries(categories.map((key) => [key, Math.round((scores.get(key) ?? 0) * 1000) / 1000]));
      if (!basis && !categories.every((key) => UNSETTLED_LENDING_KEYS.has(key))) {
        const ranked = [...categories].sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0));
        const [top, next] = ranked.map((key) => scores.get(key) ?? 0);
        if (top >= LINE_MODEL_MIN && next <= LINE_MODEL_OTHER_MAX) {
          basis = "model";
          keptReading = ranked[0];
        }
      }
    }
    if (basis && keptReading) {
      const kept = keptReading;
      keep = (row) => row.canonical_fee_key === kept;
    }
  } else {
    // The frequency the schedule line states for the fee's own price, read from each row's excerpt.
    // A per-item reading never replaces a period on a period category ("Monthly Paper Statements /
    // $2.00 Each" is charged each statement), as in `settledFrequency`.
    const periodCategory = PERIOD_FEE_KEYS.has(categories[0]);
    const readings = new Set(
      rows
        .map((row) => excerptOf(row.conditions))
        .map((line) => (line && !RATE_ON_LINE.test(line) ? frequencyFromLine(line, num(rows[0].amount)) : null))
        .filter((reading) => !(periodCategory && frequencyFamily(reading) === "per_item"))
        .map((reading) => frequencyClass(reading))
        .filter((value): value is string => value != null),
    );
    if (readings.size === 1) {
      const reading = [...readings][0];
      if (rows.some((row) => frequencyClass(row.frequency) === reading)) {
        basis = "line";
        keptReading = reading;
        keep = (row) => {
          const own = frequencyClass(row.frequency);
          return own == null || own === reading;
        };
      }
    }
  }

  if (!keep || !basis || !keptReading) return { ...verdict, exempt: "undecided" };
  const keptRows = rows.filter(keep);
  const kept = bestRow(keptRows.filter((row) => row.frequency != null).length > 0 ? keptRows.filter((row) => row.frequency != null) : keptRows);
  const keptId = Number(kept.fee_published_id);
  const chosen = basis;
  return {
    ...verdict,
    basis,
    keptReading,
    keptFeePublishedId: keptId,
    retired: rows
      .filter((row) => !keep!(row))
      .map((row) => ({
        feePublishedId: Number(row.fee_published_id),
        feeVerifiedId: num(row.fee_verified_id),
        institutionId: Number(row.institution_id),
        canonicalFeeKey: row.canonical_fee_key,
        amount: num(row.amount),
        sourceDocumentId: num(row.source_document_id),
        frequency: row.frequency,
        keptFeePublishedId: keptId,
        basis: chosen,
        reason: `${LINE_CONFLICT_REASON_PREFIX}${keptId} (${kind}, ${chosen}: ${keptReading})`,
      })),
  };
}

/** Pure: every conflicting line among `rows`, counted by kind, basis and exemption. */
export function findLineConflicts(
  rows: LineConflictRow[],
  model: CategoryModel | null,
): LineConflictFindings & { verdicts: LineConflictVerdict[] } {
  const groups = new Map<string, LineConflictRow[]>();
  for (const row of [...rows].sort((a, b) => Number(a.fee_published_id) - Number(b.fee_published_id))) {
    const key = lineKey(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const byKind: Record<LineConflictKind, number> = { category: 0, frequency: 0 };
  const byBasis: Record<LineConflictBasis, number> = { refile: 0, guard: 0, model: 0, line: 0 };
  const byExempt: Record<LineConflictExempt, number> = { audiences: 0, joint_line: 0, undecided: 0 };
  const verdicts: LineConflictVerdict[] = [];
  let conflictRows = 0;
  for (const group of groups.values()) {
    const verdict = lineConflictVerdict(group, model);
    if (!verdict) continue;
    verdicts.push(verdict);
    conflictRows += group.length;
    byKind[verdict.kind] += 1;
    if (verdict.basis) byBasis[verdict.basis] += 1;
    if (verdict.exempt) byExempt[verdict.exempt] += 1;
  }
  const retiring = verdicts.filter((verdict) => verdict.retired.length > 0);
  return {
    lines: verdicts.length,
    rows: conflictRows,
    byKind,
    byBasis,
    byExempt,
    wouldRetire: retiring.reduce((sum, verdict) => sum + verdict.retired.length, 0),
    samples: retiring.slice(0, LINE_CONFLICT_SAMPLES),
    exemptSamples: verdicts.filter((verdict) => verdict.exempt).slice(0, LINE_CONFLICT_SAMPLES),
    verdicts,
  };
}

function findingsOnly(found: LineConflictFindings & { verdicts: LineConflictVerdict[] }): LineConflictFindings {
  const { verdicts: _verdicts, ...findings } = found;
  void _verdicts;
  return findings;
}

/**
 * The live rows of every conflicting line, in one grouped read: dollar or rate fees of one
 * institution sharing name, amount, rate, variant and source address under two or more categories
 * or two or more frequencies. Shared by the step and `lineConflictCountSql`.
 */
function conflictLinesSql(institutionFilter: string): string {
  return `WITH live AS (
  SELECT fp.*
    FROM published_fee_records fp
   WHERE fp.rolled_back_at IS NULL
     AND fp.quarantined_at IS NULL
     AND fp.canonical_fee_key IS NOT NULL
     ${institutionFilter}
), lines AS (
  SELECT institution_id, lower(btrim(fee_name)) AS name, amount, rate_percent,
         COALESCE(variant_type, '') AS variant, source_url
    FROM live
   GROUP BY 1, 2, 3, 4, 5, 6
  HAVING count(*) > 1
     AND (count(DISTINCT canonical_fee_key) > 1 OR count(DISTINCT frequency) > 1)
)`;
}

const LINE_ROWS_SELECT = `
SELECT live.fee_published_id, live.lineage_ref AS fee_verified_id, live.institution_id, live.fee_name,
       live.amount, live.rate_percent, live.variant_type, live.source_url, live.canonical_fee_key,
       live.frequency, live.fee_audience, live.published_at, fr.source_document_id,
       COALESCE(fr.extraction_note, fr.conditions) AS conditions
  FROM live
  JOIN lines ON lines.institution_id = live.institution_id
            AND lines.name = lower(btrim(live.fee_name))
            AND lines.amount IS NOT DISTINCT FROM live.amount
            AND lines.rate_percent IS NOT DISTINCT FROM live.rate_percent
            AND lines.variant = COALESCE(live.variant_type, '')
            AND lines.source_url IS NOT DISTINCT FROM live.source_url
  LEFT JOIN verified_fee_observations fv ON fv.fee_verified_id = live.lineage_ref
  LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
 ORDER BY live.fee_published_id`;

/**
 * One step's re-check (see the module note). Never throws: a failed read reports nothing, and a
 * failed write leaves the fees as they were.
 */
export async function recheckLineConflicts(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean; now?: Date; model?: CategoryModel | null },
): Promise<LineConflictResult> {
  const live = options.live ?? LINE_CONFLICT_TAKEDOWN_LIVE;
  const result: LineConflictResult = {
    live,
    dryRun: options.dryRun,
    modelLoaded: false,
    ...findingsOnly(findLineConflicts([], null)),
    flagged: 0,
    waiting: 0,
    cleared: 0,
    takenDown: [],
  };
  let rows: LineConflictRow[];
  try {
    const params: number[] = [];
    let filter = "";
    if (options.institutionId != null) {
      params.push(options.institutionId);
      filter = "AND fp.institution_id = $1";
    }
    rows = await inSavepoint(db, (scope) => scope.unsafe<LineConflictRow[]>(`${conflictLinesSql(filter)}${LINE_ROWS_SELECT}`, params));
  } catch (error) {
    console.warn("[darwin] line conflict check read failed", error instanceof Error ? error.message : error);
    return result;
  }
  let model: CategoryModel | null = options.model ?? null;
  if (options.model === undefined && rows.length > 0) {
    model = await inSavepoint(db, (scope) => loadCategoryModel(scope)).catch((error) => {
      console.warn("[darwin] line conflict check could not load the category model", error instanceof Error ? error.message : error);
      return null;
    });
  }
  result.modelLoaded = model != null;
  const found = findLineConflicts(rows, model);
  Object.assign(result, findingsOnly(found));

  const failing = found.verdicts.flatMap((verdict) => verdict.retired);
  const failingIds = new Set(failing.map((fee) => fee.feePublishedId));
  const passing = found.verdicts.flatMap((verdict) => verdict.rows).filter((id) => !failingIds.has(id));
  if (live && !options.dryRun && (failing.length > 0 || passing.length > 0)) {
    const look = await secondLook(db, {
      check: LINE_CONFLICT_CHECK, runId: options.runId, failing, passing, dryRun: false, now: options.now,
    });
    result.flagged = look.flagged;
    result.waiting = look.waiting;
    result.cleared = look.cleared;
    if (look.confirmed.length > 0) {
      result.takenDown = await archive(db, options.runId, look.confirmed);
      if (result.takenDown.length > 0) await recordTakedownEvent(db, options, look.confirmed, result.takenDown);
    }
  }

  if (!options.dryRun) {
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${options.stepId ?? null}, ${LINE_CONFLICT_CHECK}, 'completed',
          ${`Read ${result.lines} live line(s) read twice (${result.byKind.category} under two categories, ${result.byKind.frequency} with two frequencies): ${result.wouldRetire} row(s) would be retired; ${result.byExempt.undecided} undecided, ${result.byExempt.joint_line} joint line(s), ${result.byExempt.audiences} with two audiences kept; ${live ? `${result.flagged} flagged, ${result.takenDown.length} archived` : "switch off, nothing written"}`},
          ${JSON.stringify(lineConflictDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[darwin] line conflict check event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

/** Archive confirmed rows: rolled back with the reason, the verified row rejected with the flag. Never deleted. */
async function archive(db: SqlTag, runId: number, fees: LineConflictRetire[]): Promise<number[]> {
  try {
    const closed = await inSavepoint(db, async (scope) => {
      // The kept row must still be live, or the line would have no reading left.
      const updated = await scope<{ fee_published_id: number | string }[]>`
        UPDATE published_fee_records fp
           SET rolled_back_at = NOW(),
               rolled_back_by_batch_id = ${`darwin-line-conflict-${runId}`},
               rolled_back_reason = v.reason
          FROM unnest(${fees.map((fee) => fee.feePublishedId)}::bigint[], ${fees.map((fee) => fee.keptFeePublishedId)}::bigint[], ${fees.map((fee) => fee.reason)}::text[])
               AS v(fee_published_id, kept_id, reason)
          JOIN published_fee_records kept ON kept.fee_published_id = v.kept_id AND kept.rolled_back_at IS NULL
         WHERE fp.fee_published_id = v.fee_published_id
           AND fp.rolled_back_at IS NULL
        RETURNING fp.fee_published_id
      `;
      const ids = new Set(updated.map((row) => Number(row.fee_published_id)));
      const verified = fees.filter((fee) => ids.has(fee.feePublishedId) && fee.feeVerifiedId != null);
      if (verified.length > 0) {
        await scope`
          UPDATE verified_fee_observations fv
             SET review_status = 'rejected',
                 outlier_flags = CASE
                   WHEN fv.outlier_flags ? ${LINE_CONFLICT_FLAG} THEN fv.outlier_flags
                   ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${LINE_CONFLICT_FLAG}::text)
                 END
           WHERE fv.fee_verified_id = ANY(${verified.map((fee) => fee.feeVerifiedId as number)}::bigint[])
             AND fv.review_status IN ('verified', 'approved')
        `;
      }
      return fees.filter((fee) => ids.has(fee.feePublishedId)).map((fee) => fee.feePublishedId);
    });
    if (closed.length > 0) invalidatePublicReadCache();
    return closed;
  } catch (error) {
    console.error("[darwin] line conflict takedown failed", error instanceof Error ? error.message : error);
    return [];
  }
}

async function recordTakedownEvent(
  db: SqlTag,
  options: { runId: number; stepId?: number | null },
  confirmed: LineConflictRetire[],
  takenDown: number[],
): Promise<void> {
  const done = new Set(takenDown);
  const archived = confirmed.filter((fee) => done.has(fee.feePublishedId));
  try {
    await inSavepoint(db, (scope) => scope`
      INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
      VALUES (
        ${options.runId}, ${options.stepId ?? null}, 'darwin.line_conflict_takedown', 'completed',
        ${`Archived ${archived.length} live fee(s) that read a printed line a second way, on their second look`},
        ${JSON.stringify({
          version: LINE_CONFLICT_CHECK_VERSION,
          taken_down: archived.length,
          by_basis: archived.reduce<Record<string, number>>((counts, fee) => {
            counts[fee.basis] = (counts[fee.basis] ?? 0) + 1;
            return counts;
          }, {}),
          samples: archived.slice(0, 50),
        })}::jsonb
      )
    `);
  } catch (error) {
    console.error("[darwin] line conflict takedown event failed", error instanceof Error ? error.message : error);
  }
}

function verdictDetail(verdict: LineConflictVerdict) {
  return {
    kind: verdict.kind,
    institution_id: verdict.institutionId,
    fee_name: verdict.feeName,
    amount: verdict.amount,
    categories: verdict.categories,
    frequencies: verdict.frequencies,
    rows: verdict.rows,
    ...(verdict.basis ? { basis: verdict.basis, kept: verdict.keptReading, kept_fee_published_id: verdict.keptFeePublishedId } : {}),
    ...(verdict.exempt ? { exempt: verdict.exempt } : {}),
    retired: verdict.retired.map((fee) => fee.feePublishedId),
    ...(verdict.model ? { model: verdict.model } : {}),
  };
}

/** The step detail (and ledger event detail). */
export function lineConflictDetail(result: LineConflictResult) {
  return {
    check: LINE_CONFLICT_CHECK,
    version: LINE_CONFLICT_CHECK_VERSION,
    switch_live: result.live,
    dry_run: result.dryRun,
    model_loaded: result.modelLoaded,
    lines: result.lines,
    rows: result.rows,
    by_kind: result.byKind,
    by_basis: result.byBasis,
    by_exempt: result.byExempt,
    would_retire: result.wouldRetire,
    flagged: result.flagged,
    waiting: result.waiting,
    cleared: result.cleared,
    taken_down: result.takenDown.length,
    samples: result.samples.map(verdictDetail),
    samples_exempt: result.exemptSamples.map(verdictDetail),
  };
}

/**
 * Read-only SQL for someone with prod access: the conflicting lines and their live rows by kind
 * (category or frequency), and the total. The verdicts need the guard and the model, so they come from
 * the verify step's detail (`line_conflict_check`).
 */
export function lineConflictCountSql(): string {
  return `${conflictLinesSql("")}, rows AS (${LINE_ROWS_SELECT}
)
SELECT kind, count(*) AS lines, sum(n) AS rows
  FROM (
    SELECT CASE WHEN count(DISTINCT canonical_fee_key) > 1 THEN 'category' ELSE 'frequency' END AS kind, count(*) AS n
      FROM rows
     GROUP BY institution_id, lower(btrim(fee_name)), amount, rate_percent, COALESCE(variant_type, ''), source_url
  ) per_line
 GROUP BY ROLLUP (kind)
 ORDER BY kind;`;
}
