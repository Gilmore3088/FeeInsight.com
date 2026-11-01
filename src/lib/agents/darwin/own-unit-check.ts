import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { inSavepoint } from "@/lib/agents/savepoint";
import { excerptOf } from "@/lib/agents/hamilton/frequency-fill";
import { ownFeeUnit } from "@/lib/custom-report/own-fee-unit";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { notAdminCorrectedSql } from "@/lib/fee-correction-guard";
import { printsAmount } from "@/lib/fee-evidence";
import { frequencySpellingSql, PER_EVENT_SPELLINGS, settledFrequency } from "@/lib/fee-frequency";
import { specialUnitOnPriceLine, type SpecialUnitFrequency } from "@/lib/fee-unit";

type SqlTag = typeof sql;

/**
 * Darwin's live re-check of flat fees whose own line prices them by the page, document, image,
 * statement or part of an hour (#2248; decision 2026-10-15, "Darwin re-checks every live fee
 * against today's rules"). Knox v139 (#2804) reads such a unit at extraction (`ownFeeUnit`,
 * `specialUnitOnPriceLine`), but only for new reads. Fees published before stay `per_item`:
 * "*Photocopy (per page) | $1.00" and "Copies | $0.25 per page" are live as flat charges, so the
 * category medians (`fee-stats`, `specialUnitSql`) pool a per-page price with flat ones. Nothing
 * else moves them: Hamilton's frequency fill keeps a special unit only when one is already stored
 * (`settledFrequency`), and Darwin's verify reads only new raw rows.
 *
 * Each Darwin verify step reads the next `OWN_UNIT_CHECK_BATCH` live flat fees (amount_kind flat,
 * stored per event: per_item, per_transaction, per_occurrence, one_time or each; never one a
 * person corrected) whose stored line names a page, document, image, statement or part-hour unit, after a cursor kept on the run ledger (the `darwin.own_unit_check` event's
 * `next_after_id`, 0 once a pass reaches the end). An institution-scoped run leaves the cursor
 * alone. Each fee is judged by `ownUnitVerdict`, one of:
 * - `refile`: Knox's own-unit reader (`ownFeeUnit`) proves the unit on the fee's own stored line
 *   (Knox's `excerpt="..."`) with the fee's own name, price and category; the document's current
 *   text still traces the fee (`checkFeeAgainstSource`, the one shared accuracy check); every
 *   current line that traces it (`currentLines`: the whole text's trace and each line printing the
 *   price on which the fee traces) itself states the same unit cleanly; and Hamilton's fill keeps
 *   the unit on the stored line (`settledFrequency` returns it), so the next publish does not set
 *   it back.
 * - kept as they are, reported only: `hourly` (the hourly re-check's job), `no_text` (no completed
 *   text for the document), `untraced` (the document no longer traces the fee at its price),
 *   `unit_conflict` (a current line names a unit but not cleanly the same one: another unit, two
 *   prices, conflicting units, a per-event basis after the price), `unit_unstated` (a current line
 *   states no unit) and `fill_unstable`.
 *
 * Price, name, category and liveness never change: nothing is taken down. With
 * `OWN_UNIT_REFILE_LIVE` false (the default) or in a dry run, nothing is written to any fee; a
 * switched-off step records only its counts (the `darwin.own_unit_check` event). Switched on, the live
 * row and its verified row (when it holds the same frequency) take the unit, guarded on the old
 * value; each change is logged to `pipeline_feedback` (kind `own_unit_refiled`, evidence `from` and
 * `to`, so it is reversed by setting the frequency back to `from`) and a `darwin.own_unit_refiled`
 * run event lists the batch. Raw rows are not touched.
 *
 * Dry run, prod read-only 2026-10-30: see `docs/project/findings/2026-10-30-own-unit-live-refile.md`.
 */
export const OWN_UNIT_CHECK = "darwin.own_unit_check";
export const OWN_UNIT_CHECK_VERSION = 1;
/** The switch, off: on, `refile` fees take their own line's unit; off, a step only counts them. */
export const OWN_UNIT_REFILE_LIVE = false;
export const OWN_UNIT_REFILED_KIND = "own_unit_refiled";
export const OWN_UNIT_REFILED_EVENT = "darwin.own_unit_refiled";
/** Candidate live fees read per step (1,776 in all on Oct 30). */
export const OWN_UNIT_CHECK_BATCH = 2_000;
export const OWN_UNIT_CHECK_SAMPLES = 20;

export type OwnUnitOutcome = "refile" | "hourly" | "no_text" | "untraced" | "unit_conflict" | "unit_unstated" | "fill_unstable";

export interface OwnUnitRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  institution_id: number | string;
  source_document_id: number | string | null;
  fee_name: string | null;
  amount: number | string | null;
  canonical_fee_key: string;
  frequency: string | null;
  /** Knox's stored conditions or extraction note, with its `excerpt="..."`. */
  conditions: string | null;
}

export interface OwnUnitVerdict {
  feePublishedId: number;
  feeVerifiedId: number | null;
  institutionId: number;
  sourceDocumentId: number | null;
  feeName: string;
  amount: number;
  canonicalFeeKey: string;
  from: string | null;
  outcome: OwnUnitOutcome;
  unit: SpecialUnitFrequency;
  /** The stored line the unit is read on. */
  sourceLine: string;
  /** The document line the shared source check traced, when it ran. */
  tracedLine?: string;
}

export interface OwnUnitFindings {
  checked: number;
  /** Fees whose stored line proves a unit (every outcome). */
  proven: number;
  outcomes: Partial<Record<OwnUnitOutcome, number>>;
  /** `refile` fees by category and by unit. */
  refileByCategory: Record<string, number>;
  refileByUnit: Record<string, number>;
  samples: OwnUnitVerdict[];
  keptSamples: OwnUnitVerdict[];
}

export interface OwnUnitResult extends OwnUnitFindings {
  live: boolean;
  dryRun: boolean;
  afterId: number | null;
  nextAfterId: number | null;
  /** Live fees re-filed in this step (switch on, not a dry run). */
  refiled: number[];
}

function num(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Pure: what the re-check does with one live flat fee, or null when its own stored line proves no
 * unit. `text` is the newest completed text of the fee's document (undefined: not loaded yet,
 * null: none). See the module note.
 */
export function ownUnitVerdict(row: OwnUnitRow, text: string | null | undefined): OwnUnitVerdict | null {
  const amount = num(row.amount);
  const line = excerptOf(row.conditions);
  const name = (row.fee_name ?? "").trim();
  if (amount == null || !line || !name) return null;
  const own = ownFeeUnit(line, name, amount, row.canonical_fee_key);
  if (!own) return null;
  const base = {
    feePublishedId: Number(row.fee_published_id),
    feeVerifiedId: num(row.fee_verified_id),
    institutionId: Number(row.institution_id),
    sourceDocumentId: num(row.source_document_id),
    feeName: name,
    amount,
    canonicalFeeKey: row.canonical_fee_key,
    from: row.frequency ?? null,
    unit: own.frequency,
    sourceLine: own.sourceLine.slice(0, 300),
  };
  const verdict = (outcome: OwnUnitOutcome, tracedLine?: string): OwnUnitVerdict =>
    ({ ...base, outcome, ...(tracedLine ? { tracedLine: tracedLine.slice(0, 300) } : {}) });
  if (own.frequency === "hourly") return verdict("hourly");
  // A unit the fill would not keep on this line would flip back on the next publish step.
  if (settledFrequency(line, amount, own.frequency, row.canonical_fee_key, { hourly: false }) !== own.frequency) return verdict("fill_unstable");
  if (!text) return verdict("no_text");
  const traced = checkFeeAgainstSource(text, name, amount, ".", row.canonical_fee_key);
  if (!traced.ok) return verdict("untraced");
  // Every current line that traces the fee must itself state the same unit, cleanly: one price, no
  // conflicting units, no per-event basis after the price. A row that names a unit some other way
  // is a conflict; one that names none no longer prices the fee by the unit.
  for (const current of currentLines(text, traced.sourceLine, name, amount, row.canonical_fee_key)) {
    const rows = ownRows(current, name, amount);
    // A flattened schedule prints many fees on one physical line: read the fee's own row on it. A
    // line that does not print the name as written is read whole.
    for (const own_row of rows.length > 0 ? rows : [current]) {
      const stated = ownFeeUnit(own_row, name, amount, row.canonical_fee_key)?.frequency
        ?? specialUnitOnPriceLine(own_row, amount);
      if (stated === own.frequency) continue;
      return verdict(namesUnit(own_row, name) ? "unit_conflict" : "unit_unstated", own_row);
    }
  }
  return verdict("refile", traced.sourceLine);
}

/** A page, document, image, statement or time word outside the fee's own name. */
const UNIT_WORD = /\b(?:pages?|documents?|images?|statements?|hours?|hrs?|minutes?|mins?|half[- ]hour|quarter[- ]hour)\b/i;
function namesUnit(line: string, name: string): boolean {
  const lower = name.toLowerCase();
  const index = lower ? line.toLowerCase().indexOf(lower) : -1;
  return UNIT_WORD.test(index < 0 ? line : line.slice(0, index) + line.slice(index + lower.length));
}

const MONEY = /\$\s*(\d[\d,]*(?:\.\d{1,2})?|\.\d{1,2})(?![\d.])/g;
/** The next table cell or bullet: where a fee's own row ends on a line that prints several. */
const NEXT_CELL = /\s\|\s|\s[•●▪‣]\s/;
/** A cell that states the price's basis: "Per Page", "each page", "/document". */
const BASIS_CELL = /^\(?\s*(?:per|each|every)\b|^\//i;

/**
 * The fee's own rows on one current line: from each place the line prints the fee's name, through
 * the first price after it when that price is the fee's, and on to the next cell. Text in the same
 * cell after the price (a second price, another unit, "per request") stays in the row, so it is read.
 */
export function ownRows(line: string, name: string, amount: number): string[] {
  const squashed = squash(line);
  const lower = squashed.toLowerCase();
  const wanted = squash(name).toLowerCase();
  const rows: string[] = [];
  if (!wanted) return rows;
  for (let at = lower.indexOf(wanted); at >= 0; at = lower.indexOf(wanted, at + 1)) {
    const rest = squashed.slice(at);
    const price = new RegExp(MONEY.source).exec(rest.slice(wanted.length));
    if (!price || Number(price[1].replace(/,/g, "")) !== amount) continue;
    const priceEnd = wanted.length + price.index + price[0].length;
    // The price's own basis may sit in the next cell ("Photocopy | $0.20 | Per Page"): a cell that
    // opens with "per", "each", "every" or "/" stays in the row; any other cell ends it.
    let tail = rest.slice(priceEnd);
    let kept = "";
    for (let cut = NEXT_CELL.exec(tail); cut; cut = NEXT_CELL.exec(tail)) {
      const next = tail.slice(cut.index + cut[0].length);
      if (!BASIS_CELL.test(next)) {
        tail = tail.slice(0, cut.index);
        break;
      }
      kept += tail.slice(0, cut.index + cut[0].length);
      tail = next;
    }
    rows.push((rest.slice(0, priceEnd) + kept + tail).trim());
  }
  return rows;
}

/**
 * Every line of the current text the shared source check traces the fee to: the whole text's own
 * trace, and each line that prints the fee's name and price on which the fee traces by itself (read
 * with the line before it, for a label above its price). Two rows of the same fee are both read.
 */
export function currentLines(text: string, tracedLine: string, name: string, amount: number, key: string): string[] {
  const lines = text.split(/\r?\n/);
  const wanted = squash(name).toLowerCase();
  const found = new Map<string, string>([[squash(tracedLine), tracedLine]]);
  for (let index = 0; index < lines.length; index++) {
    if (!printsAmount(lines[index], amount) || !squash(lines[index]).toLowerCase().includes(wanted)) continue;
    for (const window of [lines[index], index > 0 ? `${lines[index - 1]}\n${lines[index]}` : null]) {
      if (!window) continue;
      const traced = checkFeeAgainstSource(window, name, amount, ".", key);
      if (traced.ok) {
        found.set(squash(traced.sourceLine), traced.sourceLine);
        break;
      }
    }
  }
  return [...found.values()];
}

function squash(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

/** Pure: the verdicts for rows whose stored line proves a unit, counted by outcome, category and unit. */
export function findOwnUnitFees(rows: OwnUnitRow[], texts: Map<number, string>): OwnUnitFindings & { verdicts: OwnUnitVerdict[] } {
  const verdicts: OwnUnitVerdict[] = [];
  const outcomes: Partial<Record<OwnUnitOutcome, number>> = {};
  const refileByCategory: Record<string, number> = {};
  const refileByUnit: Record<string, number> = {};
  for (const row of [...rows].sort((a, b) => Number(a.fee_published_id) - Number(b.fee_published_id))) {
    const documentId = num(row.source_document_id);
    const verdict = ownUnitVerdict(row, documentId == null ? null : texts.get(documentId) ?? null);
    if (!verdict) continue;
    verdicts.push(verdict);
    outcomes[verdict.outcome] = (outcomes[verdict.outcome] ?? 0) + 1;
    if (verdict.outcome === "refile") {
      refileByCategory[verdict.canonicalFeeKey] = (refileByCategory[verdict.canonicalFeeKey] ?? 0) + 1;
      refileByUnit[verdict.unit] = (refileByUnit[verdict.unit] ?? 0) + 1;
    }
  }
  return {
    checked: rows.length,
    proven: verdicts.length,
    outcomes,
    refileByCategory,
    refileByUnit,
    samples: verdicts.filter((verdict) => verdict.outcome === "refile").slice(0, OWN_UNIT_CHECK_SAMPLES),
    keptSamples: verdicts.filter((verdict) => verdict.outcome !== "refile").slice(0, OWN_UNIT_CHECK_SAMPLES),
    verdicts,
  };
}

function withoutVerdicts(found: OwnUnitFindings & { verdicts: OwnUnitVerdict[] }): OwnUnitFindings {
  const { verdicts: _verdicts, ...findings } = found;
  void _verdicts;
  return findings;
}

/**
 * Pure: the `pipeline_feedback` row a re-filed fee is logged with (its old frequency kept for a
 * rollback). A record (weight 0): Knox v139 already reads the unit on new reads.
 */
export function ownUnitFeedbackRow(verdict: OwnUnitVerdict, runId: number | null): FeedbackRow {
  return {
    aboutStage: "extract",
    signal: "wrong",
    kind: OWN_UNIT_REFILED_KIND,
    reportedBy: "darwin",
    checkName: OWN_UNIT_CHECK,
    aboutVersion: OWN_UNIT_CHECK_VERSION,
    institutionId: verdict.institutionId,
    sourceDocumentId: verdict.sourceDocumentId,
    feeVerifiedId: verdict.feeVerifiedId,
    feePublishedId: verdict.feePublishedId,
    canonicalFeeKey: verdict.canonicalFeeKey,
    amount: verdict.amount,
    weight: 0,
    evidence: { from: verdict.from, to: verdict.unit, fee_name: verdict.feeName, source_line: verdict.sourceLine, traced_line: verdict.tracedLine ?? null },
    runId,
    dedupeKey: `${OWN_UNIT_CHECK}:v${OWN_UNIT_CHECK_VERSION}:${verdict.feePublishedId}:${verdict.from ?? "none"}:${verdict.unit}`,
  };
}

/** Postgres pre-filter: a stored line that names a page, document, image, statement or part-hour unit. */
const UNIT_WORDING = String.raw`excerpt=.*((per|each|every)\s+|/\s*|\(\s*)(pages?|documents?|images?|statements?|half|1/2|quarter|minutes?|mins?|15|30|thirty|fifteen)`;
const PER_EVENT_SQL = `ARRAY[${PER_EVENT_SPELLINGS.map((spelling) => `'${spelling}'`).join(", ")}]::text[]`;

/** The candidate live fees, in id order; `$1` the cursor, `$2` an institution (0 for all), `$3` the limit. */
export const OWN_UNIT_ROWS_SQL = `
  SELECT fp.fee_published_id, fp.lineage_ref AS fee_verified_id, fp.institution_id, fr.source_document_id,
         fp.fee_name, fp.amount, fp.canonical_fee_key, fp.frequency,
         COALESCE(fr.extraction_note, fr.conditions) AS conditions
    FROM published_fee_records fp
    JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
    JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
   WHERE fp.rolled_back_at IS NULL
     AND fp.quarantined_at IS NULL
     AND fp.amount_kind = 'flat'
     AND fp.amount IS NOT NULL
     AND ${frequencySpellingSql("fp.frequency")} = ANY(${PER_EVENT_SQL})
     AND ${notAdminCorrectedSql("fp")}
     AND COALESCE(fr.extraction_note, fr.conditions) ~* '${UNIT_WORDING}'
     AND fp.fee_published_id > $1
     AND ($2::bigint = 0 OR fp.institution_id = $2::bigint)
   ORDER BY fp.fee_published_id
   LIMIT $3::int`;

/** Newest completed text per document, read only for fees whose stored line already proves a unit. */
async function textsFor(db: SqlTag, rows: OwnUnitRow[]): Promise<Map<number, string>> {
  // Only a fee whose stored line proves a unit the fill keeps waits on its document's text.
  const proven = rows.filter((row) => ownUnitVerdict(row, undefined)?.outcome === "no_text");
  const documentIds = [...new Set(proven.map((row) => num(row.source_document_id)).filter((id): id is number => id != null))];
  const texts = new Map<number, string>();
  if (documentIds.length === 0) return texts;
  const found = await inSavepoint(db, (scope) => scope.unsafe<Array<{ source_document_id: number | string; normalized_text: string | null }>>(
    `SELECT DISTINCT ON (source_document_id) source_document_id, normalized_text
       FROM agent_source_texts
      WHERE source_document_id = ANY($1::bigint[])
        AND status = 'completed'
        AND normalized_text IS NOT NULL
      ORDER BY source_document_id, id DESC`,
    [documentIds],
  ));
  for (const text of found) {
    if (typeof text.normalized_text === "string") texts.set(Number(text.source_document_id), text.normalized_text);
  }
  return texts;
}

async function readCursor(db: SqlTag): Promise<number> {
  const [row] = await inSavepoint(db, (scope) => scope<{ next_after_id: string | null }[]>`
    SELECT detail->>'next_after_id' AS next_after_id
      FROM agent_run_events
     WHERE event_type = ${OWN_UNIT_CHECK}
       AND detail->>'next_after_id' IS NOT NULL
     ORDER BY created_at DESC, id DESC
     LIMIT 1
  `);
  return num(row?.next_after_id ?? null) ?? 0;
}

function emptyFindings(): OwnUnitFindings {
  return withoutVerdicts(findOwnUnitFees([], new Map()));
}

/**
 * One step's share of the live re-check (see the module note). Never throws: a failed read reports
 * nothing checked, and a failed write leaves the fees as they were.
 */
export async function recheckOwnUnits(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean; limit?: number },
): Promise<OwnUnitResult> {
  const live = options.live ?? OWN_UNIT_REFILE_LIVE;
  const limit = Math.max(1, Math.min(options.limit ?? OWN_UNIT_CHECK_BATCH, 20_000));
  const scoped = options.institutionId != null;
  const result: OwnUnitResult = { live, dryRun: options.dryRun, ...emptyFindings(), afterId: null, nextAfterId: null, refiled: [] };
  let found: OwnUnitFindings & { verdicts: OwnUnitVerdict[] };
  try {
    const afterId = scoped ? 0 : await readCursor(db);
    const rows = await inSavepoint(db, (scope) => scope.unsafe<OwnUnitRow[]>(OWN_UNIT_ROWS_SQL, [afterId, options.institutionId ?? 0, limit]));
    if (!scoped) {
      result.afterId = afterId;
      result.nextAfterId = rows.length < limit ? 0 : Number(rows[rows.length - 1].fee_published_id);
    }
    found = findOwnUnitFees(rows, await textsFor(db, rows));
  } catch (error) {
    console.warn("[darwin] own unit check read failed", error instanceof Error ? error.message : error);
    return result;
  }
  Object.assign(result, withoutVerdicts(found));
  const refiles = found.verdicts.filter((verdict) => verdict.outcome === "refile");

  if (live && !options.dryRun && refiles.length > 0) {
    try {
      result.refiled = await inSavepoint(db, async (scope) => {
        const updated = await scope<{ fee_published_id: number | string }[]>`
          UPDATE published_fee_records fp
             SET frequency = v.unit
            FROM unnest(${refiles.map((fee) => fee.feePublishedId)}::bigint[], ${refiles.map((fee) => fee.from)}::text[],
                        ${refiles.map((fee) => fee.unit)}::text[], ${refiles.map((fee) => fee.amount)}::numeric[])
                 AS v(fee_published_id, from_frequency, unit, amount)
           WHERE fp.fee_published_id = v.fee_published_id
             AND fp.frequency IS NOT DISTINCT FROM v.from_frequency
             AND fp.amount = v.amount
             AND fp.rolled_back_at IS NULL
             AND fp.quarantined_at IS NULL
          RETURNING fp.fee_published_id
        `;
        const ids = new Set(updated.map((row) => Number(row.fee_published_id)));
        const verified = refiles.filter((fee) => ids.has(fee.feePublishedId) && fee.feeVerifiedId != null);
        if (verified.length > 0) {
          await scope`
            UPDATE verified_fee_observations fv
               SET frequency = v.unit
              FROM unnest(${verified.map((fee) => fee.feeVerifiedId as number)}::bigint[], ${verified.map((fee) => fee.from)}::text[],
                          ${verified.map((fee) => fee.unit)}::text[])
                   AS v(fee_verified_id, from_frequency, unit)
             WHERE fv.fee_verified_id = v.fee_verified_id
               AND fv.frequency IS NOT DISTINCT FROM v.from_frequency
          `;
        }
        return refiles.filter((fee) => ids.has(fee.feePublishedId)).map((fee) => fee.feePublishedId);
      });
    } catch (error) {
      console.error("[darwin] own unit refile failed", error instanceof Error ? error.message : error);
      result.refiled = [];
    }
    if (result.refiled.length > 0) {
      const done = new Set(result.refiled);
      const written = refiles.filter((fee) => done.has(fee.feePublishedId));
      try {
        await inSavepoint(db, (scope) => recordFeedback(scope, written.map((fee) => ownUnitFeedbackRow(fee, options.runId))));
      } catch (error) {
        console.error("[darwin] own unit feedback failed", error instanceof Error ? error.message : error);
      }
      try {
        await inSavepoint(db, (scope) => scope`
          INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
          VALUES (
            ${options.runId}, ${options.stepId ?? null}, ${OWN_UNIT_REFILED_EVENT}, 'completed',
            ${`Re-filed ${result.refiled.length} live flat fee(s) to the unit their own line prices them by; price unchanged, old values kept in pipeline_feedback`},
            ${JSON.stringify({
              version: OWN_UNIT_CHECK_VERSION,
              refiled: result.refiled.length,
              by_unit: countBy(written, (fee) => fee.unit),
              by_category: countBy(written, (fee) => fee.canonicalFeeKey),
              samples: written.slice(0, OWN_UNIT_CHECK_SAMPLES).map(verdictDetail),
            })}::jsonb
          )
        `);
      } catch (error) {
        console.error("[darwin] own unit refile event failed", error instanceof Error ? error.message : error);
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
          ${options.runId}, ${options.stepId ?? null}, ${OWN_UNIT_CHECK}, 'completed',
          ${`Read ${result.checked} live flat fee(s) with a unit word on their line: ${result.proven} priced by their own line's unit, ${result.outcomes.refile ?? 0} to re-file; ${live ? `${result.refiled.length} re-filed` : "switch off, nothing written"}`},
          ${JSON.stringify(ownUnitDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[darwin] own unit check event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, item) => {
    counts[key(item)] = (counts[key(item)] ?? 0) + 1;
    return counts;
  }, {});
}

function verdictDetail(verdict: OwnUnitVerdict) {
  return {
    fee_published_id: verdict.feePublishedId,
    institution_id: verdict.institutionId,
    fee_name: verdict.feeName,
    amount: verdict.amount,
    canonical_fee_key: verdict.canonicalFeeKey,
    from: verdict.from,
    unit: verdict.unit,
    outcome: verdict.outcome,
    source_line: verdict.sourceLine,
    ...(verdict.tracedLine ? { traced_line: verdict.tracedLine } : {}),
  };
}

/** The findings as ledger detail. */
export function ownUnitFindingsDetail(found: OwnUnitFindings) {
  return {
    checked: found.checked,
    proven: found.proven,
    outcomes: found.outcomes,
    would_refile: found.outcomes.refile ?? 0,
    refile_by_category: found.refileByCategory,
    refile_by_unit: found.refileByUnit,
    samples_refile: found.samples.map(verdictDetail),
    samples_kept: found.keptSamples.map(verdictDetail),
  };
}

/** The step detail (and ledger event detail) for one step's share. */
export function ownUnitDetail(result: OwnUnitResult) {
  return {
    check: OWN_UNIT_CHECK,
    version: OWN_UNIT_CHECK_VERSION,
    switch_live: result.live,
    dry_run: result.dryRun,
    batch: OWN_UNIT_CHECK_BATCH,
    after_id: result.afterId,
    next_after_id: result.nextAfterId,
    ...ownUnitFindingsDetail(result),
    refiled: result.refiled.length,
  };
}

/**
 * The dry-run count over the whole live table in one read (nothing written, no cursor), for the
 * count James sees before the switch goes on. Run it with the verify step's `own_unit_full_count` param.
 */
export async function countOwnUnitFees(db: SqlTag): Promise<OwnUnitFindings | null> {
  try {
    const rows = await inSavepoint(db, (scope) => scope.unsafe<OwnUnitRow[]>(OWN_UNIT_ROWS_SQL, [0, 0, 1_000_000]));
    return withoutVerdicts(findOwnUnitFees(rows, await textsFor(db, rows)));
  } catch (error) {
    console.warn("[darwin] own unit full count failed", error instanceof Error ? error.message : error);
    return null;
  }
}
