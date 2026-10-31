import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { inSavepoint } from "@/lib/agents/savepoint";
import { excerptOf } from "@/lib/agents/hamilton/frequency-fill";
import { notAdminCorrectedSql } from "@/lib/fee-correction-guard";
import {
  frequencyFamily,
  frequencySpellingSql,
  INHERENTLY_PERIODIC_KEYS,
  maintenanceMonthlyFill,
  PER_EVENT_SPELLINGS,
  settledFrequency,
} from "@/lib/fee-frequency";
import { maintenancePerItem } from "./verify";

type SqlTag = typeof sql;

/**
 * Darwin's live re-check of monthly maintenance fees stored per item (Oct 30; decision 2026-10-15,
 * "Darwin re-checks every live fee against today's rules"). A maintenance fee is charged per month or
 * statement cycle, but 17 live ones were per item or per transaction: Knox passed its own per-item
 * reading of the line to `settledFrequency` as the stated frequency, and the rule kept a stated
 * frequency on a period category whatever it was ("A service charge of $3.00 will be charged each
 * calendar month" read "each" as per item). Knox v142 and `settledFrequency` no longer keep a per-item
 * frequency on monthly maintenance, and Darwin's verify holds a maintenance fee whose own line prices
 * it per item (`maintenance_per_item`), but only for new reads; the live fees stay as published.
 *
 * Each Darwin verify step reads every live monthly maintenance fee stored per event (per_item,
 * per_transaction, per_occurrence, one_time or each; never one a person corrected; no cursor, a few
 * dozen rows at most) and judges it on its own stored line (Knox's `excerpt="..."`) by
 * `maintenanceFrequencyVerdict`:
 * - `hold`: the line or name prices it per item (`ownLinePricesPerItem`: "$16 each", "$1.00 per
 *   withdrawal after 6", "$35 per overdraft", "$2 Item Fee Service Charge"). It is not the account's
 *   monthly fee, so it comes down: the live row is rolled back with the reason and its verified row
 *   rejected with `MAINTENANCE_PER_ITEM_FLAG`.
 * - `refile`: today's rules read a period on the line (`settledFrequency`, then Hamilton's monthly
 *   maintenance fill `maintenanceMonthlyFill`): "each calendar month" is monthly, "each calendar
 *   quarter" quarterly. The live row (and its verified row when it holds the same frequency) takes it.
 * - `clear`: the line states no period. The per-item default comes off and the frequency is blank,
 *   as Knox and the fill now leave it.
 *
 * Price, name and category never change. With `MAINTENANCE_FREQUENCY_ACTS` false (the default) or in
 * a dry run nothing is written to any fee; the step records only its counts (the
 * `darwin.maintenance_frequency_check` event). Switched on, each change is logged to
 * `pipeline_feedback` (kind `maintenance_frequency_rechecked`, evidence `action`, `from` and `to`, so
 * a refile is reversed by setting the frequency back to `from` and a hold by clearing the rollback).
 *
 * Dry run, prod read-only 2026-10-30: see `docs/project/findings/2026-10-30-maintenance-fee-per-item.md`.
 */
export const MAINTENANCE_FREQUENCY_CHECK = "darwin.maintenance_frequency_check";
export const MAINTENANCE_FREQUENCY_CHECK_VERSION = 1;
/** The switch, off: on, `hold` fees come down and `refile`/`clear` fees take today's frequency. */
export const MAINTENANCE_FREQUENCY_ACTS = false;
export const MAINTENANCE_FREQUENCY_KIND = "maintenance_frequency_rechecked";
export const MAINTENANCE_FREQUENCY_EVENT = "darwin.maintenance_frequency_rechecked";
export const MAINTENANCE_PER_ITEM_FLAG = "darwin_maintenance_per_item";
/** The rollback reason a `hold` takedown writes; its prefix files it under this check (`TAKEDOWN_REASON_CHECKS`). */
export const MAINTENANCE_PER_ITEM_REASON = `${MAINTENANCE_PER_ITEM_FLAG}: its own line prices it per item, not per month`;
export const MAINTENANCE_FREQUENCY_SAMPLES = 20;

export type MaintenanceFrequencyOutcome = "hold" | "refile" | "clear";

export interface MaintenanceFrequencyRow {
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

export interface MaintenanceFrequencyVerdict {
  feePublishedId: number;
  feeVerifiedId: number | null;
  institutionId: number;
  sourceDocumentId: number | null;
  feeName: string;
  amount: number | null;
  canonicalFeeKey: string;
  from: string | null;
  /** The frequency today's rules give (`refile`), else null. */
  to: string | null;
  outcome: MaintenanceFrequencyOutcome;
  sourceLine: string | null;
}

export interface MaintenanceFrequencyResult {
  live: boolean;
  dryRun: boolean;
  checked: number;
  outcomes: Partial<Record<MaintenanceFrequencyOutcome, number>>;
  /** `refile` fees by the frequency they take. */
  refileTo: Record<string, number>;
  samples: MaintenanceFrequencyVerdict[];
  /** Live fees changed or taken down in this step (switch on, not a dry run). */
  changed: number[];
  heldDown: number[];
}

function num(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Pure: what the re-check does with one live maintenance fee stored per event, or null when it is not
 * one (another category, or a frequency that is not per event). See the module note.
 */
export function maintenanceFrequencyVerdict(row: MaintenanceFrequencyRow): MaintenanceFrequencyVerdict | null {
  if (!INHERENTLY_PERIODIC_KEYS.has(row.canonical_fee_key) || frequencyFamily(row.frequency) !== "per_item") return null;
  const amount = num(row.amount);
  const line = excerptOf(row.conditions);
  const base = {
    feePublishedId: Number(row.fee_published_id),
    feeVerifiedId: num(row.fee_verified_id),
    institutionId: Number(row.institution_id),
    sourceDocumentId: num(row.source_document_id),
    feeName: (row.fee_name ?? "").trim(),
    amount,
    canonicalFeeKey: row.canonical_fee_key,
    from: row.frequency,
    sourceLine: line ? line.slice(0, 300) : null,
  };
  if (maintenancePerItem(row.canonical_fee_key, row.fee_name, amount, line)) return { ...base, to: null, outcome: "hold" };
  const settled = amount == null ? null : settledFrequency(line, amount, row.frequency, row.canonical_fee_key, { hourly: false });
  const to = settled ?? maintenanceMonthlyFill(row.canonical_fee_key, null, line, amount, row.fee_name);
  return to ? { ...base, to, outcome: "refile" } : { ...base, to: null, outcome: "clear" };
}

/** Pure: the verdicts for the rows, counted by outcome and target frequency. */
export function findMaintenanceFrequencies(rows: MaintenanceFrequencyRow[]): Omit<MaintenanceFrequencyResult, "live" | "dryRun" | "changed" | "heldDown"> & { verdicts: MaintenanceFrequencyVerdict[] } {
  const verdicts = [...rows]
    .sort((a, b) => Number(a.fee_published_id) - Number(b.fee_published_id))
    .map(maintenanceFrequencyVerdict)
    .filter((verdict): verdict is MaintenanceFrequencyVerdict => verdict != null);
  const outcomes: Partial<Record<MaintenanceFrequencyOutcome, number>> = {};
  const refileTo: Record<string, number> = {};
  for (const verdict of verdicts) {
    outcomes[verdict.outcome] = (outcomes[verdict.outcome] ?? 0) + 1;
    if (verdict.outcome === "refile" && verdict.to) refileTo[verdict.to] = (refileTo[verdict.to] ?? 0) + 1;
  }
  return { checked: rows.length, outcomes, refileTo, samples: verdicts.slice(0, MAINTENANCE_FREQUENCY_SAMPLES), verdicts };
}

/** Pure: the `pipeline_feedback` record a change is logged with (old value kept for a rollback). */
export function maintenanceFrequencyFeedbackRow(verdict: MaintenanceFrequencyVerdict, runId: number | null): FeedbackRow {
  return {
    aboutStage: "extract",
    signal: "wrong",
    kind: MAINTENANCE_FREQUENCY_KIND,
    reportedBy: "darwin",
    checkName: MAINTENANCE_FREQUENCY_CHECK,
    aboutVersion: MAINTENANCE_FREQUENCY_CHECK_VERSION,
    institutionId: verdict.institutionId,
    sourceDocumentId: verdict.sourceDocumentId,
    feeVerifiedId: verdict.feeVerifiedId,
    feePublishedId: verdict.feePublishedId,
    canonicalFeeKey: verdict.canonicalFeeKey,
    amount: verdict.amount,
    weight: 0,
    evidence: { action: verdict.outcome, from: verdict.from, to: verdict.to, fee_name: verdict.feeName, source_line: verdict.sourceLine },
    runId,
    dedupeKey: `${MAINTENANCE_FREQUENCY_CHECK}:v${MAINTENANCE_FREQUENCY_CHECK_VERSION}:${verdict.feePublishedId}:${verdict.outcome}:${verdict.from ?? "none"}:${verdict.to ?? "none"}`,
  };
}

const PER_EVENT_SQL = `ARRAY[${PER_EVENT_SPELLINGS.map((spelling) => `'${spelling}'`).join(", ")}]::text[]`;
const PERIODIC_SQL = `ARRAY[${[...INHERENTLY_PERIODIC_KEYS].map((key) => `'${key}'`).join(", ")}]::text[]`;

/** Every live monthly maintenance fee stored per event; `$1` an institution (0 for all). */
export const MAINTENANCE_FREQUENCY_ROWS_SQL = `
  SELECT fp.fee_published_id, fp.lineage_ref AS fee_verified_id, fp.institution_id, fr.source_document_id,
         fp.fee_name, fp.amount, fp.canonical_fee_key, fp.frequency,
         COALESCE(fr.extraction_note, fr.conditions) AS conditions
    FROM published_fee_records fp
    JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
    JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
   WHERE fp.rolled_back_at IS NULL
     AND fp.quarantined_at IS NULL
     AND fp.canonical_fee_key = ANY(${PERIODIC_SQL})
     AND ${frequencySpellingSql("fp.frequency")} = ANY(${PER_EVENT_SQL})
     AND ${notAdminCorrectedSql("fp")}
     AND ($1::bigint = 0 OR fp.institution_id = $1::bigint)
   ORDER BY fp.fee_published_id`;

/**
 * One verify step's re-check (see the module note). Never throws: a failed read reports nothing
 * checked, and a failed write leaves the fees as they were.
 */
export async function recheckMaintenanceFrequencies(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean },
): Promise<MaintenanceFrequencyResult> {
  const live = options.live ?? MAINTENANCE_FREQUENCY_ACTS;
  const result: MaintenanceFrequencyResult = { live, dryRun: options.dryRun, checked: 0, outcomes: {}, refileTo: {}, samples: [], changed: [], heldDown: [] };
  let verdicts: MaintenanceFrequencyVerdict[];
  try {
    const rows = await inSavepoint(db, (scope) => scope.unsafe<MaintenanceFrequencyRow[]>(MAINTENANCE_FREQUENCY_ROWS_SQL, [options.institutionId ?? 0]));
    const found = findMaintenanceFrequencies(rows);
    verdicts = found.verdicts;
    Object.assign(result, { checked: found.checked, outcomes: found.outcomes, refileTo: found.refileTo, samples: found.samples });
  } catch (error) {
    console.warn("[darwin] maintenance frequency check read failed", error instanceof Error ? error.message : error);
    return result;
  }

  if (live && !options.dryRun && verdicts.length > 0) {
    const holds = verdicts.filter((verdict) => verdict.outcome === "hold");
    const refiles = verdicts.filter((verdict) => verdict.outcome !== "hold");
    try {
      result.heldDown = holds.length === 0 ? [] : await inSavepoint(db, async (scope) => {
        const updated = await scope<{ fee_published_id: number | string }[]>`
          UPDATE published_fee_records fp
             SET rolled_back_at = NOW(),
                 rolled_back_by_batch_id = ${`darwin-maintenance-frequency-${options.runId}`},
                 rolled_back_reason = ${MAINTENANCE_PER_ITEM_REASON}
           WHERE fp.fee_published_id = ANY(${holds.map((fee) => fee.feePublishedId)}::bigint[])
             AND fp.rolled_back_at IS NULL
             AND fp.quarantined_at IS NULL
          RETURNING fp.fee_published_id
        `;
        const ids = new Set(updated.map((row) => Number(row.fee_published_id)));
        const verified = holds.filter((fee) => ids.has(fee.feePublishedId) && fee.feeVerifiedId != null).map((fee) => fee.feeVerifiedId as number);
        if (verified.length > 0) {
          await scope`
            UPDATE verified_fee_observations fv
               SET review_status = 'rejected',
                   outlier_flags = CASE
                     WHEN fv.outlier_flags ? ${MAINTENANCE_PER_ITEM_FLAG} THEN fv.outlier_flags
                     ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${MAINTENANCE_PER_ITEM_FLAG}::text)
                   END
             WHERE fv.fee_verified_id = ANY(${verified}::bigint[])
               AND fv.review_status IN ('verified', 'approved')
          `;
        }
        return holds.filter((fee) => ids.has(fee.feePublishedId)).map((fee) => fee.feePublishedId);
      });
    } catch (error) {
      console.error("[darwin] maintenance per-item takedown failed", error instanceof Error ? error.message : error);
      result.heldDown = [];
    }
    try {
      result.changed = refiles.length === 0 ? [] : await inSavepoint(db, async (scope) => {
        const updated = await scope<{ fee_published_id: number | string }[]>`
          UPDATE published_fee_records fp
             SET frequency = v.to_frequency
            FROM unnest(${refiles.map((fee) => fee.feePublishedId)}::bigint[], ${refiles.map((fee) => fee.from)}::text[],
                        ${refiles.map((fee) => fee.to)}::text[])
                 AS v(fee_published_id, from_frequency, to_frequency)
           WHERE fp.fee_published_id = v.fee_published_id
             AND fp.frequency IS NOT DISTINCT FROM v.from_frequency
             AND fp.rolled_back_at IS NULL
             AND fp.quarantined_at IS NULL
          RETURNING fp.fee_published_id
        `;
        const ids = new Set(updated.map((row) => Number(row.fee_published_id)));
        const verified = refiles.filter((fee) => ids.has(fee.feePublishedId) && fee.feeVerifiedId != null);
        if (verified.length > 0) {
          await scope`
            UPDATE verified_fee_observations fv
               SET frequency = v.to_frequency
              FROM unnest(${verified.map((fee) => fee.feeVerifiedId as number)}::bigint[], ${verified.map((fee) => fee.from)}::text[],
                          ${verified.map((fee) => fee.to)}::text[])
                   AS v(fee_verified_id, from_frequency, to_frequency)
             WHERE fv.fee_verified_id = v.fee_verified_id
               AND fv.frequency IS NOT DISTINCT FROM v.from_frequency
          `;
        }
        return refiles.filter((fee) => ids.has(fee.feePublishedId)).map((fee) => fee.feePublishedId);
      });
    } catch (error) {
      console.error("[darwin] maintenance frequency refile failed", error instanceof Error ? error.message : error);
      result.changed = [];
    }
    const done = new Set([...result.heldDown, ...result.changed]);
    const written = verdicts.filter((verdict) => done.has(verdict.feePublishedId));
    if (written.length > 0) {
      try {
        await inSavepoint(db, (scope) => recordFeedback(scope, written.map((fee) => maintenanceFrequencyFeedbackRow(fee, options.runId))));
      } catch (error) {
        console.error("[darwin] maintenance frequency feedback failed", error instanceof Error ? error.message : error);
      }
      try {
        await inSavepoint(db, (scope) => scope`
          INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
          VALUES (
            ${options.runId}, ${options.stepId ?? null}, ${MAINTENANCE_FREQUENCY_EVENT}, 'completed',
            ${`Took down ${result.heldDown.length} live maintenance fee(s) priced per item by their own line; set ${result.changed.length} per-item maintenance fee(s) to their line's period or blank; old values kept in pipeline_feedback`},
            ${JSON.stringify({ version: MAINTENANCE_FREQUENCY_CHECK_VERSION, held_down: result.heldDown.length, changed: result.changed.length, samples: written.slice(0, MAINTENANCE_FREQUENCY_SAMPLES).map(verdictDetail) })}::jsonb
          )
        `);
      } catch (error) {
        console.error("[darwin] maintenance frequency event failed", error instanceof Error ? error.message : error);
      }
      invalidatePublicReadCache();
    }
  }

  if (!options.dryRun) {
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${options.stepId ?? null}, ${MAINTENANCE_FREQUENCY_CHECK}, 'completed',
          ${`Read ${result.checked} live maintenance fee(s) stored per item: ${result.outcomes.hold ?? 0} priced per item by their own line, ${result.outcomes.refile ?? 0} to their line's period, ${result.outcomes.clear ?? 0} to blank; ${live ? `${result.heldDown.length} taken down, ${result.changed.length} changed` : "switch off, nothing written"}`},
          ${JSON.stringify(maintenanceFrequencyDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[darwin] maintenance frequency check event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

function verdictDetail(verdict: MaintenanceFrequencyVerdict) {
  return {
    fee_published_id: verdict.feePublishedId,
    institution_id: verdict.institutionId,
    fee_name: verdict.feeName,
    amount: verdict.amount,
    from: verdict.from,
    to: verdict.to,
    outcome: verdict.outcome,
    source_line: verdict.sourceLine,
  };
}

/** The step detail (and ledger event detail). */
export function maintenanceFrequencyDetail(result: MaintenanceFrequencyResult) {
  return {
    check: MAINTENANCE_FREQUENCY_CHECK,
    version: MAINTENANCE_FREQUENCY_CHECK_VERSION,
    switch_live: result.live,
    dry_run: result.dryRun,
    checked: result.checked,
    outcomes: result.outcomes,
    refile_to: result.refileTo,
    samples: result.samples.map(verdictDetail),
    held_down: result.heldDown.length,
    changed: result.changed.length,
  };
}
