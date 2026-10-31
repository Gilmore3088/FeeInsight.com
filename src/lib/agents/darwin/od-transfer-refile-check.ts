import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import { recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { runFreeSpecialists } from "@/lib/agents/knox/specialists";
import { storedLine } from "@/lib/agents/darwin/rate-floor-check";
import { checkFeeCategory, refileCategory } from "@/lib/fee-category-guard";

type SqlTag = typeof sql;

/**
 * Darwin's live re-check of overdraft fees whose own line is the transfer that covers an overdraft
 * (Hamilton proof run, Oct 30; decision 2026-10-15, "Darwin re-checks every live fee against today's
 * rules"). Flagstar (institution 33) has "Linked Account (Deposit Overdraft (OD) Protection)
 * transaction fee | No charge" live twice as an overdraft fee at $0 (83142, 159833), beside its $10
 * overdraft charge: "(OD)" between the words hid "overdraft protection" from Knox's transfer patterns.
 * Notre Dame FCU's "Overdraft | $5.00/Transfer" and Acadian FCU's "Overdraft Fee | $10.00/Transfer"
 * are live as overdraft fees too: the rules filed the name and never read the per-transfer unit. Knox
 * v143 reads both (`OVERDRAFT_ABBREVIATION_PROTECTION`, `overdraftPricedPerTransfer`), but only on new
 * reads, and Hamilton's rules re-check keeps the old ones live ("disputed": name and price still
 * trace), so nothing else moves them.
 *
 * Each verify step reads every live overdraft fee whose stored line (Knox's `excerpt="..."`) says
 * transfer, sweep or protection (the SQL pre-filter), and reads that line again with today's free
 * Knox team (`runFreeSpecialists`, rules only, no provider call). `odTransferVerdict`:
 * - `refile`: a read on the line at the fee's own price is filed (as Darwin's verify files it,
 *   `refileCategory`) as an overdraft protection transfer, no read at that price stays overdraft, and
 *   the category guard accepts the name under the transfer. The live fee is re-filed in place, under
 *   the read's name when the guard accepts it (the old name otherwise), price unchanged.
 * - kept, reported only: `still_overdraft` (a read at that price is still the overdraft fee),
 *   `per_item` (the line prices it per item or presentment, the paid-overdraft fee's unit: "Overdraft
 *   Protection / $30.00 per item", which today's bare-name rule reads as a transfer),
 *   `not_read` (no read at that price), `refused` (the guard refuses the name under the transfer).
 *
 * Shadow first (CLAUDE.md standing rule): with `OD_TRANSFER_REFILE_LIVE` false (the default), or in a
 * dry run, the step only reports. Switched on, a `refile` goes through the shared 12-hour second look
 * (check `darwin.od_transfer_refile`) and is acted on at its second failure: the live row and its
 * verified row take the transfer category, guarded on the old category and name, the old values
 * logged to `pipeline_feedback` (kind `od_transfer_refiled`) and a `darwin.od_transfer_refiled` event.
 * Nothing is taken down.
 *
 * Dry run, prod read-only, 2026-10-30: see
 * docs/project/findings/2026-10-30-no-fee-sentence-and-od-transfer-unit.md.
 */
export const OD_TRANSFER_REFILE_CHECK = "darwin.od_transfer_refile";
export const OD_TRANSFER_REFILE_CHECK_VERSION = 1;
/** The switch, off: on re-files matches after the second look; off only reports. */
export const OD_TRANSFER_REFILE_LIVE = false;
export const OD_TRANSFER_REFILED_KIND = "od_transfer_refiled";
export const OD_TRANSFER_TARGET = "od_protection_transfer";
export const OD_TRANSFER_LIMIT = 2_000;
export const OD_TRANSFER_SAMPLES = 20;

export type OdTransferOutcome = "refile" | "still_overdraft" | "per_item" | "not_read" | "refused";

export interface OdTransferRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  institution_id: number | string;
  fee_name: string | null;
  amount: number | string | null;
  canonical_fee_key: string;
  source_line: string | null;
}

export interface OdTransferVerdict {
  feePublishedId: number;
  feeVerifiedId: number | null;
  institutionId: number;
  feeName: string;
  amount: number;
  canonicalFeeKey: string;
  outcome: OdTransferOutcome;
  newName?: string;
  sourceLine: string;
  reason: string;
}

export interface OdTransferFindings {
  checked: number;
  outcomes: Partial<Record<OdTransferOutcome, number>>;
  matched: number;
  institutions: number;
  samples: OdTransferVerdict[];
  keptSamples: OdTransferVerdict[];
}

export interface OdTransferResult extends OdTransferFindings {
  live: boolean;
  dryRun: boolean;
  scoped: boolean;
  flagged: number;
  waiting: number;
  refiled: number[];
}

function num(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const sameAmount = (a: number, b: number) => Math.abs(a - b) < 0.005;
/** A price charged per item, presentment or occurrence: the paid-overdraft fee's unit, never a transfer's. */
const PER_ITEM_AFTER = /^\s*(?:\/\s*|per\s+|each\s+|for\s+each\s+)(?:paid\s+)?(?:items?|presentments?|occurrences?|checks?)\b/i;
const MONEY = /\$\s*(\d[\d,]*(?:\.\d{1,2})?|\.\d{1,2})/g;
const words = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Whether the line prints the fee's price followed by a per-item unit. */
function pricedPerItem(line: string, amount: number): boolean {
  for (const match of line.matchAll(MONEY)) {
    if (!sameAmount(Number(match[1].replace(/,/g, "")), amount)) continue;
    if (PER_ITEM_AFTER.test(line.slice((match.index ?? 0) + match[0].length))) return true;
  }
  return false;
}

/** Pure: what today's Knox reads on a live overdraft fee's own stored line, at its price. */
export function odTransferVerdict(row: OdTransferRow): OdTransferVerdict | null {
  const amount = num(row.amount);
  const line = storedLine(row.source_line);
  const name = (row.fee_name ?? "").trim();
  if (amount == null || !line || !name) return null;
  const result = runFreeSpecialists(line);
  const reads = [
    ...result.candidates.map((read) => ({ name: read.feeName, amount: read.amount, hint: read.canonicalHint })),
    ...result.held.filter((read) => read.shape === "zero" && read.canonicalHint).map((read) => ({ name: read.feeName, amount: 0, hint: read.canonicalHint as string })),
  ].filter((read) => sameAmount(read.amount, amount))
    .map((read) => ({ ...read, filed: refileCategory(read.hint, read.name) ?? read.hint }));
  const base = {
    feePublishedId: Number(row.fee_published_id),
    feeVerifiedId: num(row.fee_verified_id),
    institutionId: Number(row.institution_id),
    feeName: name,
    amount,
    canonicalFeeKey: row.canonical_fee_key,
    sourceLine: line.slice(0, 300),
  };
  const transfer = reads.find((read) => read.filed === OD_TRANSFER_TARGET);
  if (!transfer) return { ...base, outcome: "not_read", reason: "no read at this price on its own line is the transfer" };
  if (reads.some((read) => read.filed === row.canonical_fee_key)) {
    return { ...base, outcome: "still_overdraft", reason: `a read at this price is still ${row.canonical_fee_key}` };
  }
  // "Overdraft Protection / $30.00 per item" is the paid-overdraft program, whatever its bare name reads as.
  if (pricedPerItem(line, amount)) return { ...base, outcome: "per_item", reason: "its own line prices it per item: the paid-overdraft fee" };
  // The read's name replaces a cut one ("Rediline Overdraft Loan"); one that differs only by marks stays.
  const renamed = words(transfer.name) !== words(name) && checkFeeCategory(OD_TRANSFER_TARGET, transfer.name).ok;
  const newName = renamed ? transfer.name : name;
  if (!checkFeeCategory(OD_TRANSFER_TARGET, newName).ok) return { ...base, outcome: "refused", reason: "the category guard refuses the name as a transfer" };
  return { ...base, outcome: "refile", newName, reason: `od_transfer_refile: its own line reads "${transfer.name}" as the overdraft protection transfer` };
}

/** Pure: the verdicts for the rows the read selected, counted by outcome. */
export function findOdTransfers(rows: OdTransferRow[]): OdTransferFindings & { matches: OdTransferVerdict[] } {
  const verdicts: OdTransferVerdict[] = [];
  const seen = new Set<number>();
  for (const row of [...rows].sort((a, b) => Number(a.fee_published_id) - Number(b.fee_published_id))) {
    const feeId = Number(row.fee_published_id);
    if (seen.has(feeId)) continue;
    seen.add(feeId);
    const verdict = odTransferVerdict(row);
    if (verdict) verdicts.push(verdict);
  }
  const outcomes: Partial<Record<OdTransferOutcome, number>> = {};
  for (const verdict of verdicts) outcomes[verdict.outcome] = (outcomes[verdict.outcome] ?? 0) + 1;
  const matches = verdicts.filter((verdict) => verdict.outcome === "refile");
  return {
    checked: seen.size,
    outcomes,
    matched: matches.length,
    institutions: new Set(matches.map((fee) => fee.institutionId)).size,
    samples: matches.slice(0, OD_TRANSFER_SAMPLES),
    keptSamples: verdicts.filter((verdict) => verdict.outcome !== "refile" && verdict.outcome !== "not_read").slice(0, OD_TRANSFER_SAMPLES),
    matches,
  };
}

/** Postgres pre-filter on Knox's stored note: the line says transfer, sweep or protection. */
export const OD_TRANSFER_PREFILTER = String.raw`excerpt=.*(transfer|sweep|protection)`;

/** Read-only: every live overdraft fee whose stored line passes the pre-filter. */
export function odTransferRowsSql(db: SqlTag, options: { institutionId?: number; limit?: number } = {}) {
  const scoped = options.institutionId != null;
  const limit = Math.max(1, Math.min(options.limit ?? OD_TRANSFER_LIMIT, 10_000));
  return db<OdTransferRow[]>`
    SELECT fp.fee_published_id, fp.lineage_ref AS fee_verified_id, fp.institution_id, fp.fee_name, fp.amount,
           fp.canonical_fee_key, fr.extraction_note AS source_line
      FROM published_fee_records fp
      JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
      JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
     WHERE fp.rolled_back_at IS NULL
       AND fp.quarantined_at IS NULL
       AND fp.amount_kind = 'flat'
       AND fp.amount IS NOT NULL
       AND fp.canonical_fee_key = 'overdraft'
       AND fr.extraction_note ~* ${OD_TRANSFER_PREFILTER}
       AND (${!scoped} OR fp.institution_id = ${options.institutionId ?? 0})
     ORDER BY fp.fee_published_id
     LIMIT ${limit}::int
  `;
}

/** Pure: the `pipeline_feedback` row a re-filed fee is logged with (its old category and name kept). */
export function odTransferFeedbackRow(verdict: OdTransferVerdict, runId: number | null): FeedbackRow {
  return {
    aboutStage: "extract",
    signal: "wrong",
    kind: OD_TRANSFER_REFILED_KIND,
    reportedBy: "darwin",
    checkName: OD_TRANSFER_REFILE_CHECK,
    aboutVersion: OD_TRANSFER_REFILE_CHECK_VERSION,
    institutionId: verdict.institutionId,
    sourceDocumentId: null,
    feeVerifiedId: verdict.feeVerifiedId,
    feePublishedId: verdict.feePublishedId,
    canonicalFeeKey: verdict.canonicalFeeKey,
    amount: verdict.amount,
    weight: 0,
    evidence: { from: verdict.canonicalFeeKey, to: OD_TRANSFER_TARGET, from_name: verdict.feeName, to_name: verdict.newName ?? verdict.feeName, source_line: verdict.sourceLine },
    runId,
    dedupeKey: `${OD_TRANSFER_REFILE_CHECK}:v${OD_TRANSFER_REFILE_CHECK_VERSION}:${verdict.feePublishedId}:${verdict.canonicalFeeKey}:${OD_TRANSFER_TARGET}`,
  };
}

/**
 * One step's re-check (see the module note). Never throws: a failed read reports nothing, and a
 * failed write leaves the fees as they were.
 */
export async function recheckOdTransfers(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean; limit?: number; now?: Date },
): Promise<OdTransferResult> {
  const live = options.live ?? OD_TRANSFER_REFILE_LIVE;
  const result: OdTransferResult = {
    live, dryRun: options.dryRun, scoped: options.institutionId != null,
    checked: 0, outcomes: {}, matched: 0, institutions: 0, samples: [], keptSamples: [], flagged: 0, waiting: 0, refiled: [],
  };

  let rows: OdTransferRow[];
  try {
    rows = await inSavepoint(db, (scope) => odTransferRowsSql(scope, { institutionId: options.institutionId, limit: options.limit }));
  } catch (error) {
    console.warn("[darwin] overdraft transfer check read failed", error instanceof Error ? error.message : error);
    return result;
  }
  const { matches, ...findings } = findOdTransfers(rows);
  Object.assign(result, findings);

  if (live && !options.dryRun && matches.length > 0) {
    const look = await secondLook(db, {
      check: OD_TRANSFER_REFILE_CHECK, runId: options.runId, failing: matches, passing: [], dryRun: false, now: options.now,
    });
    result.flagged = look.flagged;
    result.waiting = look.waiting;
    if (look.confirmed.length > 0) result.refiled = await refile(db, options, look.confirmed);
  }

  if (!options.dryRun && result.checked > 0) {
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${options.stepId ?? null}, ${OD_TRANSFER_REFILE_CHECK}, 'completed',
          ${`Read ${result.checked} live overdraft fee(s) whose line says transfer, sweep or protection: ${result.matched} at ${result.institutions} institution(s) are the overdraft protection transfer; ${live ? `${result.flagged} flagged, ${result.refiled.length} re-filed` : "switch off, would re-file, nothing written"}`},
          ${JSON.stringify(odTransferDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[darwin] overdraft transfer check event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

/** Re-file confirmed fees in place, guarded on the old category and name. Never takes a fee down. */
async function refile(db: SqlTag, options: { runId: number; stepId?: number | null }, fees: OdTransferVerdict[]): Promise<number[]> {
  try {
    const done = await inSavepoint(db, async (scope) => {
      const updated = await scope<{ fee_published_id: number | string }[]>`
        UPDATE published_fee_records fp
           SET canonical_fee_key = ${OD_TRANSFER_TARGET}, fee_name = v.new_name
          FROM unnest(${fees.map((fee) => fee.feePublishedId)}::bigint[], ${fees.map((fee) => fee.canonicalFeeKey)}::text[],
                      ${fees.map((fee) => fee.feeName)}::text[], ${fees.map((fee) => fee.newName ?? fee.feeName)}::text[])
               AS v(fee_published_id, from_key, old_name, new_name)
         WHERE fp.fee_published_id = v.fee_published_id
           AND fp.canonical_fee_key = v.from_key
           AND fp.fee_name = v.old_name
           AND fp.rolled_back_at IS NULL
        RETURNING fp.fee_published_id
      `;
      const ids = new Set(updated.map((row) => Number(row.fee_published_id)));
      const applied = fees.filter((fee) => ids.has(fee.feePublishedId));
      const withVerified = applied.filter((fee) => fee.feeVerifiedId != null);
      if (withVerified.length > 0) {
        await scope`
          UPDATE verified_fee_observations fv
             SET canonical_fee_key = ${OD_TRANSFER_TARGET}
            FROM unnest(${withVerified.map((fee) => fee.feeVerifiedId as number)}::bigint[], ${withVerified.map((fee) => fee.canonicalFeeKey)}::text[])
                 AS v(fee_verified_id, from_key)
           WHERE fv.fee_verified_id = v.fee_verified_id
             AND fv.canonical_fee_key = v.from_key
        `;
      }
      if (applied.length > 0) {
        await recordFeedback(scope, applied.map((fee) => odTransferFeedbackRow(fee, options.runId)));
        await scope`
          INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
          VALUES (
            ${options.runId}, ${options.stepId ?? null}, 'darwin.od_transfer_refiled', 'completed',
            ${`Re-filed ${applied.length} live overdraft fee(s) as the overdraft protection transfer their own line reads, on their second look; price unchanged, old values kept in pipeline_feedback`},
            ${JSON.stringify({ version: OD_TRANSFER_REFILE_CHECK_VERSION, refiled: applied.length, samples: applied.slice(0, 50).map(sampleDetail) })}::jsonb
          )
        `;
      }
      return applied.map((fee) => fee.feePublishedId);
    });
    if (done.length > 0) invalidatePublicReadCache();
    return done;
  } catch (error) {
    console.error("[darwin] overdraft transfer re-file failed", error instanceof Error ? error.message : error);
    return [];
  }
}

function sampleDetail(fee: OdTransferVerdict) {
  return {
    fee_published_id: fee.feePublishedId,
    institution_id: fee.institutionId,
    fee_name: fee.feeName,
    new_name: fee.newName ?? null,
    amount: fee.amount,
    canonical_fee_key: fee.canonicalFeeKey,
    outcome: fee.outcome,
    source_line: fee.sourceLine,
    reason: fee.reason,
  };
}

/** The step's detail for the run ledger. */
export function odTransferDetail(result: OdTransferResult) {
  return {
    check: OD_TRANSFER_REFILE_CHECK,
    version: OD_TRANSFER_REFILE_CHECK_VERSION,
    switch_live: result.live,
    dry_run: result.dryRun,
    scoped: result.scoped,
    checked: result.checked,
    outcomes: result.outcomes,
    matched: result.matched,
    institutions: result.institutions,
    flagged: result.flagged,
    waiting: result.waiting,
    refiled: result.refiled,
    samples: result.samples.map(sampleDetail),
    samples_kept: result.keptSamples.map(sampleDetail),
  };
}
