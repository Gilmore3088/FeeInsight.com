import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import { recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { runFreeSpecialists } from "@/lib/agents/knox/specialists";
import { passesDarwinChecks } from "@/lib/agents/knox/layout";
import { KNOX_REREAD_RESOLVED_KIND, lineKey, readsOnLine } from "@/lib/agents/knox/reread-feedback";
import type { ExtractedFeeCandidate } from "@/lib/agents/knox/rules";
import { repeatsScheduleLine } from "@/lib/agents/darwin/product-page-repeat-check";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { checkFeeCategory, refileCategory } from "@/lib/fee-category-guard";
import { foldContext } from "@/lib/fee-fold";

type SqlTag = typeof sql;

/**
 * Darwin's live re-check of fees whose own line Knox now reads under another category (#1513;
 * decision 2026-10-15, "Darwin re-checks every live fee against today's rules"). Local 804 FCU's
 * "For ATM and Debit Card transactions ONLY, when funds are available in your savings, there will
 * be a" $1 (live 128668) is the "$1 Overdraft Transfer Fee" its sentence ends on, live as a
 * non-network ATM fee; First Interstate's "You will be assessed a" $10 (85754) is its "$10 Excess
 * Withdrawal Fee", live as account research; Ripco's "... a fee will be assessed on each share. |
 * 3x10x21” per year" $30 (35970) is the 3x10x21 safe deposit box, live as a dormant account fee.
 *
 * Why the existing steps let them through: Darwin's live fragment check asks Knox to re-read such a
 * line (`knox_reread_requested`), and Knox's re-read pass (`knox/reread-feedback.ts`) reads it
 * right with today's rules, but settles a read under another category as `other_category`,
 * unresolved and "left for Darwin". No Darwin step read those rows. A full re-read of the bank does
 * not fix it either: the new read is a new raw row under the new category, which supersedes no
 * live fee (Hamilton supersedes a fee only by a new price in its own category), so the misfiled
 * row stays live. #2677 expected 128668 to move "on its next read"; Knox re-read its line at rules
 * v124 and it is still live under atm_non_network.
 *
 * A live fee is judged only when Knox's re-read settled its request `other_category` and the fee
 * still carries the fragment name that request was about. Its document's newest completed text is
 * read again with today's free team (`runFreeSpecialists`, rules only: no provider call). Then:
 * - `refile`: exactly one proper read (name and category, as Darwin's verify files it with
 *   `refileCategory`) on the fee's line at its price, in another category; no read on that line at
 *   that price keeps the live category; the category guard and Darwin's amount checks accept the
 *   name (`passesDarwinChecks`); and `checkFeeAgainstSource` traces the name at that price in the
 *   text. The live fee is re-filed in place under that name and category.
 * - `twin`: the same, but another live fee of the bank already has that category and price under a
 *   name that names the same item (`repeatsScheduleLine`). The misfiled fee is a second copy of a
 *   line already shown, so it comes down (`reread_category_twin: live fee #<twin>`).
 * - Kept as they are: `convention_pending` (the move is between overdraft and NSF, the paid-NSF
 *   convention #1513 leaves to James: Library of Congress FCU's 60485, an item paid under its
 *   Member Privilege program that the bank calls "our standard NSF fee"), `split_read` (a read on
 *   the line keeps the live category), `ambiguous` (two or more proper reads), `refused` (the guard,
 *   the amount checks or the source trace refuse the new read), `not_found` and `no_text`.
 *
 * Shadow first (CLAUDE.md standing rule): with `REREAD_CATEGORY_RECHECK_LIVE` false, or in a dry
 * run, the step only reports. Switched on, a `refile` or `twin` goes through the shared 12-hour
 * second look (check `darwin.reread_category`) and is acted on at its second failure: a re-file
 * logs the old name and category in `pipeline_feedback` (kind `reread_category_refiled`) and is
 * guarded on both; a takedown is rolled back with its reason while the twin is still live, its
 * verified row rejected with the `darwin_reread_category` flag, never deleted.
 *
 * Dry run, prod read-only, 2026-10-26: see docs/project/findings/2026-10-26-reread-other-category-unread.md.
 */
export const REREAD_CATEGORY_CHECK = "darwin.reread_category";
export const REREAD_CATEGORY_CHECK_VERSION = 1;
/** The switch, off: on re-files or takes down matches after the second look; off only reports. */
export const REREAD_CATEGORY_RECHECK_LIVE = false;
/** Live fees read per step (a dozen today; the cap is a guard). */
export const REREAD_CATEGORY_LIMIT = 500;
export const REREAD_CATEGORY_SAMPLES = 20;
export const REREAD_CATEGORY_FLAG = "darwin_reread_category";
export const REREAD_CATEGORY_TWIN_REASON = "reread_category_twin";
export const REREAD_CATEGORY_REFILED_KIND = "reread_category_refiled";
/** Moves the paid-NSF convention decides (#1513): never made by this check. */
const CONVENTION_PENDING = new Set(["nsf>overdraft", "overdraft>nsf"]);

export type RereadCategoryOutcome = "refile" | "twin" | "convention_pending" | "split_read" | "ambiguous" | "refused" | "not_found" | "no_text" | "stale";

export interface RereadCategorySameAmount {
  fee_published_id: number | string;
  fee_name: string | null;
  canonical_fee_key: string | null;
}

export interface RereadCategoryRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  institution_id: number | string;
  fee_name: string | null;
  amount: number | string | null;
  canonical_fee_key: string;
  source_document_id: number | string | null;
  /** The fragment Knox's re-read request was about (`evidence.fragment_name`). */
  fragment_name: string | null;
  document_text_id: number | string | null;
  normalized_text: string | null;
  /** The bank's other live fees at this amount. */
  same_amount: RereadCategorySameAmount[] | string | null;
}

export interface RereadCategoryVerdict {
  feePublishedId: number;
  feeVerifiedId: number | null;
  institutionId: number;
  sourceDocumentId: number | null;
  amount: number | null;
  canonicalFeeKey: string;
  feeName: string;
  outcome: RereadCategoryOutcome;
  newKey?: string;
  newName?: string;
  twinFeePublishedId?: number;
  refusedBy?: string;
  sourceLine?: string;
  readNames?: string[];
  /** The second look's reason. */
  reason: string;
}

export interface RereadCategoryFindings {
  checked: number;
  outcomes: Partial<Record<RereadCategoryOutcome, number>>;
  /** Refiles and takedowns this check would make. */
  matched: number;
  samples: RereadCategoryVerdict[];
}

export interface RereadCategoryResult extends RereadCategoryFindings {
  live: boolean;
  dryRun: boolean;
  flagged: number;
  waiting: number;
  cleared: number;
  refiled: number[];
  takenDown: number[];
}

const num = (value: number | string | null | undefined): number | null => {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function parseSameAmount(value: RereadCategoryRow["same_amount"]): RereadCategorySameAmount[] {
  if (value == null) return [];
  return typeof value === "string" ? (JSON.parse(value) as RereadCategorySameAmount[]) : value;
}

/** The category Darwin's verify files a read under (as Hamilton's rules re-check reads it). */
function filedKey(candidate: ExtractedFeeCandidate, text: string): string {
  return refileCategory(candidate.canonicalHint, candidate.feeName, foldContext(text, candidate.feeName, candidate.amount)) ?? candidate.canonicalHint;
}

/**
 * Pure: the verdict on one live fee. `candidates` is today's free read of `row.normalized_text`
 * (the caller reads each text once).
 */
export function judgeRereadCategory(row: RereadCategoryRow, candidates: ExtractedFeeCandidate[]): RereadCategoryVerdict {
  const amount = num(row.amount);
  const base = {
    feePublishedId: Number(row.fee_published_id),
    feeVerifiedId: num(row.fee_verified_id),
    institutionId: Number(row.institution_id),
    sourceDocumentId: num(row.source_document_id),
    amount,
    canonicalFeeKey: row.canonical_fee_key,
    feeName: row.fee_name ?? "",
  };
  const verdict = (outcome: RereadCategoryOutcome, extra: Partial<RereadCategoryVerdict> = {}): RereadCategoryVerdict => ({
    ...base,
    outcome,
    ...extra,
    reason: extra.reason ?? `${REREAD_CATEGORY_CHECK}: ${outcome}`,
  });
  // The request was about this name: a fee renamed since is another check's to judge.
  if (lineKey(row.fee_name) !== lineKey(row.fragment_name)) return verdict("stale");
  const text = row.normalized_text;
  if (!text || !text.trim() || amount == null) return verdict("no_text");
  const reads = readsOnLine(row.fragment_name, amount, candidates);
  if (!reads || reads.onLine.length === 0) return verdict("not_found");
  const readNames = [...new Set(reads.onLine.map((candidate) => candidate.feeName))].slice(0, 5);
  // Any read on the line that keeps the live category: today's rules disagree with themselves.
  if (reads.onLine.some((candidate) => candidate.canonicalHint === row.canonical_fee_key || filedKey(candidate, text) === row.canonical_fee_key)) {
    return verdict("split_read", { readNames });
  }
  const others = new Map<string, { key: string; candidate: ExtractedFeeCandidate }>();
  for (const candidate of reads.proper) {
    const key = filedKey(candidate, text);
    others.set(`${key}|${lineKey(candidate.feeName)}`, { key, candidate });
  }
  if (others.size === 0) return verdict("not_found", { readNames });
  if (others.size > 1) return verdict("ambiguous", { readNames });
  const [{ key: newKey, candidate }] = [...others.values()];
  const newName = candidate.feeName.replace(/\s+/g, " ").trim();
  const move = { newKey, newName, readNames };
  if (CONVENTION_PENDING.has(`${row.canonical_fee_key}>${newKey}`)) return verdict("convention_pending", move);
  if (!checkFeeCategory(newKey, newName).ok) return verdict("refused", { ...move, refusedBy: "category_guard" });
  if (!passesDarwinChecks(newKey, newName, amount)) return verdict("refused", { ...move, refusedBy: "amount_checks" });
  const traced = checkFeeAgainstSource(text, newName, amount, ".", newKey);
  if (!traced.ok) return verdict("refused", { ...move, refusedBy: `source_check:${"reason" in traced ? String(traced.reason) : "untraced"}` });
  const sourceLine = "sourceLine" in traced && typeof traced.sourceLine === "string" ? traced.sourceLine : undefined;
  const twin = parseSameAmount(row.same_amount)
    .filter((fee) => fee.canonical_fee_key === newKey && String(fee.fee_published_id) !== String(row.fee_published_id))
    .sort((a, b) => Number(a.fee_published_id) - Number(b.fee_published_id))
    .find((fee) => lineKey(fee.fee_name) === lineKey(newName) || repeatsScheduleLine(fee.fee_name, newName));
  if (twin) {
    const twinId = Number(twin.fee_published_id);
    return verdict("twin", { ...move, sourceLine, twinFeePublishedId: twinId, reason: `${REREAD_CATEGORY_TWIN_REASON}: live fee #${twinId}` });
  }
  return verdict("refile", { ...move, sourceLine, reason: `${REREAD_CATEGORY_CHECK}: ${row.canonical_fee_key} -> ${newKey}` });
}

/** Pure: every row's verdict, each text read once by today's free team. */
export function findRereadCategoryMoves(rows: RereadCategoryRow[], read: (text: string) => ExtractedFeeCandidate[] = (text) => runFreeSpecialists(text).candidates): RereadCategoryFindings & { verdicts: RereadCategoryVerdict[] } {
  const reads = new Map<string, ExtractedFeeCandidate[]>();
  const verdicts = [...rows]
    .sort((a, b) => Number(a.fee_published_id) - Number(b.fee_published_id))
    .map((row) => {
      const text = row.normalized_text ?? "";
      const key = String(row.document_text_id ?? text);
      if (text.trim() && !reads.has(key)) reads.set(key, read(text));
      return judgeRereadCategory(row, reads.get(key) ?? []);
    });
  const outcomes: Partial<Record<RereadCategoryOutcome, number>> = {};
  for (const verdict of verdicts) outcomes[verdict.outcome] = (outcomes[verdict.outcome] ?? 0) + 1;
  const acting = verdicts.filter((verdict) => verdict.outcome === "refile" || verdict.outcome === "twin");
  return { checked: rows.length, outcomes, matched: acting.length, samples: verdicts.slice(0, REREAD_CATEGORY_SAMPLES), verdicts };
}

/**
 * Read-only: every live fee whose Knox re-read request settled `other_category`, with its
 * document's newest completed text and the bank's other live fees at its amount. The step's own
 * read; run it in a read-only transaction for the dry-run count. `$1` an institution id or null,
 * `$2` the row cap.
 */
export const REREAD_CATEGORY_ROWS_SQL = `
    WITH settled AS (
      SELECT DISTINCT ON (res.fee_published_id) res.fee_published_id, res.evidence->>'fragment_name' AS fragment_name
        FROM pipeline_feedback res
       WHERE res.kind = '${KNOX_REREAD_RESOLVED_KIND}'
         AND res.evidence->>'outcome' = 'other_category'
         AND res.fee_published_id IS NOT NULL
         AND ($1::bigint IS NULL OR res.institution_id = $1::bigint)
       ORDER BY res.fee_published_id, res.id DESC
    )
    SELECT fp.fee_published_id, fp.lineage_ref AS fee_verified_id, fp.institution_id, fp.fee_name, fp.amount,
           fp.canonical_fee_key, fr.source_document_id, s.fragment_name, adt.id AS document_text_id, adt.normalized_text,
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object('fee_published_id', o.fee_published_id, 'fee_name', o.fee_name,
                                                 'canonical_fee_key', o.canonical_fee_key) ORDER BY o.fee_published_id)
               FROM published_fee_records o
              WHERE o.institution_id = fp.institution_id
                AND o.fee_published_id <> fp.fee_published_id
                AND o.rolled_back_at IS NULL
                AND o.quarantined_at IS NULL
                AND o.amount = fp.amount
                AND o.amount_kind IS DISTINCT FROM 'percent'
           ), '[]'::jsonb) AS same_amount
      FROM settled s
      JOIN published_fee_records fp ON fp.fee_published_id = s.fee_published_id
      JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
      JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
      LEFT JOIN LATERAL (
        SELECT t.id, t.normalized_text FROM agent_source_texts t
         WHERE t.source_document_id = fr.source_document_id
           AND t.institution_id = fp.institution_id
           AND t.status = 'completed'
           AND t.normalized_text IS NOT NULL
         ORDER BY t.id DESC
         LIMIT 1
      ) adt ON TRUE
     WHERE fp.rolled_back_at IS NULL
       AND fp.quarantined_at IS NULL
       AND fp.amount IS NOT NULL
       AND fp.amount_kind IS DISTINCT FROM 'percent'
     ORDER BY fp.fee_published_id
     LIMIT $2::int`;

export function rereadCategoryRows(db: SqlTag, options: { institutionId?: number; limit?: number } = {}): Promise<RereadCategoryRow[]> {
  const limit = Math.max(1, Math.min(options.limit ?? REREAD_CATEGORY_LIMIT, 5_000));
  return db.unsafe<RereadCategoryRow[]>(REREAD_CATEGORY_ROWS_SQL, [options.institutionId ?? null, limit]);
}

/**
 * One verify step's re-check (see the module note). Never throws: a failed read reports nothing
 * checked, and a failed write leaves the fees as they were.
 */
export async function recheckRereadCategories(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean; limit?: number; now?: Date },
): Promise<RereadCategoryResult> {
  const live = options.live ?? REREAD_CATEGORY_RECHECK_LIVE;
  const result: RereadCategoryResult = {
    live, dryRun: options.dryRun, checked: 0, outcomes: {}, matched: 0, samples: [], flagged: 0, waiting: 0, cleared: 0, refiled: [], takenDown: [],
  };
  let rows: RereadCategoryRow[];
  try {
    rows = await inSavepoint(db, (scope) => rereadCategoryRows(scope, { institutionId: options.institutionId, limit: options.limit }));
  } catch (error) {
    console.warn("[darwin] reread category check read failed", error instanceof Error ? error.message : error);
    return result;
  }
  // Nothing settled other_category for a live fee: no read, no event.
  if (rows.length === 0) return result;
  const found = findRereadCategoryMoves(rows);
  Object.assign(result, { checked: found.checked, outcomes: found.outcomes, matched: found.matched, samples: found.samples });

  if (live && !options.dryRun) {
    const failing = found.verdicts.filter((verdict) => verdict.outcome === "refile" || verdict.outcome === "twin");
    const passing = found.verdicts.filter((verdict) => verdict.outcome !== "refile" && verdict.outcome !== "twin").map((verdict) => verdict.feePublishedId);
    const look = await secondLook(db, { check: REREAD_CATEGORY_CHECK, runId: options.runId, failing, passing, dryRun: false, now: options.now });
    result.flagged = look.flagged;
    result.waiting = look.waiting;
    result.cleared = look.cleared;
    if (look.confirmed.length > 0) {
      const stepId = options.stepId ?? null;
      result.refiled = await refile(db, options.runId, stepId, look.confirmed.filter((verdict) => verdict.outcome === "refile"));
      result.takenDown = await archiveRereadCategoryTwins(db, options.runId, stepId, twinsToArchive(look.confirmed));
      if (result.refiled.length + result.takenDown.length > 0) invalidatePublicReadCache();
    }
  }

  if (!options.dryRun) {
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${options.stepId ?? null}, ${REREAD_CATEGORY_CHECK}, 'completed',
          ${rereadCategoryMessage(result)},
          ${JSON.stringify(rereadCategoryDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[darwin] reread category check event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

/**
 * Pure: the confirmed twins that may come down this pass. A twin that this pass also re-files or
 * takes down is no proof the line stays shown (a re-filed twin may leave the category; two fees
 * that are each other's twin would both come down), so such a fee waits for a later pass.
 */
export function twinsToArchive(confirmed: RereadCategoryVerdict[]): RereadCategoryVerdict[] {
  const moving = new Set(confirmed.filter((verdict) => verdict.outcome === "refile" || verdict.outcome === "twin").map((verdict) => verdict.feePublishedId));
  return confirmed.filter((verdict) => verdict.outcome === "twin" && verdict.twinFeePublishedId != null && !moving.has(verdict.twinFeePublishedId));
}

/** Re-file confirmed fees in place, guarded on the old category and name; the old values logged first. */
async function refile(db: SqlTag, runId: number, stepId: number | null, verdicts: RereadCategoryVerdict[]): Promise<number[]> {
  if (verdicts.length === 0) return [];
  try {
    return await inSavepoint(db, async (scope) => {
      const updated = await scope<{ fee_published_id: number | string }[]>`
        UPDATE published_fee_records fp
           SET canonical_fee_key = v.to_key, fee_name = v.new_name
          FROM unnest(${verdicts.map((verdict) => verdict.feePublishedId)}::bigint[], ${verdicts.map((verdict) => verdict.canonicalFeeKey)}::text[],
                      ${verdicts.map((verdict) => verdict.newKey as string)}::text[], ${verdicts.map((verdict) => verdict.feeName)}::text[],
                      ${verdicts.map((verdict) => verdict.newName as string)}::text[])
               AS v(fee_published_id, from_key, to_key, old_name, new_name)
         WHERE fp.fee_published_id = v.fee_published_id
           AND fp.canonical_fee_key = v.from_key
           AND fp.fee_name = v.old_name
           AND fp.rolled_back_at IS NULL
        RETURNING fp.fee_published_id
      `;
      const done = new Set(updated.map((row) => Number(row.fee_published_id)));
      const applied = verdicts.filter((verdict) => done.has(verdict.feePublishedId));
      const withVerified = applied.filter((verdict) => verdict.feeVerifiedId != null);
      if (withVerified.length > 0) {
        await scope`
          UPDATE verified_fee_observations fv
             SET canonical_fee_key = v.to_key
            FROM unnest(${withVerified.map((verdict) => verdict.feeVerifiedId as number)}::bigint[], ${withVerified.map((verdict) => verdict.canonicalFeeKey)}::text[],
                        ${withVerified.map((verdict) => verdict.newKey as string)}::text[]) AS v(fee_verified_id, from_key, to_key)
           WHERE fv.fee_verified_id = v.fee_verified_id
             AND fv.canonical_fee_key = v.from_key
        `;
      }
      if (applied.length > 0) await recordFeedback(scope, applied.map((verdict) => refiledRow(verdict, runId)));
      if (applied.length > 0) {
        await scope`
          INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
          VALUES (
            ${runId}, ${stepId}, ${`${REREAD_CATEGORY_CHECK}_refile`}, 'completed',
            ${`Re-filed ${applied.length} live fee(s) under the category Knox's re-read of their own line reads, on their second look`},
            ${JSON.stringify({ version: REREAD_CATEGORY_CHECK_VERSION, refiled: applied.map(sampleDetail) })}::jsonb
          )
        `;
      }
      return applied.map((verdict) => verdict.feePublishedId);
    });
  } catch (error) {
    console.error("[darwin] reread category re-file failed", error instanceof Error ? error.message : error);
    return [];
  }
}

function refiledRow(verdict: RereadCategoryVerdict, runId: number): FeedbackRow {
  return {
    aboutStage: "extract",
    aboutStrategy: REREAD_CATEGORY_CHECK,
    aboutVersion: REREAD_CATEGORY_CHECK_VERSION,
    // Knox filed the line by the words before its price: a wrong read, corrected from its own line.
    signal: "wrong",
    kind: REREAD_CATEGORY_REFILED_KIND,
    reportedBy: "darwin",
    checkName: REREAD_CATEGORY_CHECK,
    institutionId: verdict.institutionId,
    sourceDocumentId: verdict.sourceDocumentId,
    feeVerifiedId: verdict.feeVerifiedId,
    feePublishedId: verdict.feePublishedId,
    canonicalFeeKey: verdict.newKey,
    amount: verdict.amount,
    weight: 0,
    evidence: { from: verdict.canonicalFeeKey, to: verdict.newKey, old_name: verdict.feeName, new_name: verdict.newName, source_line: verdict.sourceLine ?? null },
    runId,
    dedupeKey: `${REREAD_CATEGORY_CHECK}:pub:${verdict.feePublishedId}:${verdict.newKey}`,
  };
}

/** Take down confirmed twins while the twin is still live; the verified row rejected with the flag. Never deleted. */
export async function archiveRereadCategoryTwins(db: SqlTag, runId: number, stepId: number | null, verdicts: RereadCategoryVerdict[]): Promise<number[]> {
  if (verdicts.length === 0) return [];
  const ids = verdicts.map((verdict) => verdict.feePublishedId);
  try {
    return await inSavepoint(db, async (scope) => {
      // The twin must still show the line: live, unquarantined, under the new category at this
      // amount, and not itself one of the fees this statement takes down.
      const updated = await scope<{ fee_published_id: number | string }[]>`
        UPDATE published_fee_records fp
           SET rolled_back_at = NOW(),
               rolled_back_by_batch_id = ${`darwin-reread-category-${runId}`},
               rolled_back_reason = v.reason
          FROM unnest(${ids}::bigint[], ${verdicts.map((verdict) => verdict.twinFeePublishedId as number)}::bigint[],
                      ${verdicts.map((verdict) => verdict.reason)}::text[], ${verdicts.map((verdict) => verdict.canonicalFeeKey)}::text[],
                      ${verdicts.map((verdict) => verdict.newKey as string)}::text[])
               AS v(fee_published_id, twin_id, reason, from_key, to_key)
         WHERE fp.fee_published_id = v.fee_published_id
           AND fp.canonical_fee_key = v.from_key
           AND fp.rolled_back_at IS NULL
           AND v.twin_id <> ALL(${ids}::bigint[])
           AND EXISTS (
             SELECT 1 FROM published_fee_records twin
              WHERE twin.fee_published_id = v.twin_id
                AND twin.rolled_back_at IS NULL
                AND twin.quarantined_at IS NULL
                AND twin.canonical_fee_key = v.to_key
                AND twin.amount = fp.amount
           )
        RETURNING fp.fee_published_id
      `;
      const done = new Set(updated.map((row) => Number(row.fee_published_id)));
      const applied = verdicts.filter((verdict) => done.has(verdict.feePublishedId));
      const verified = applied.filter((verdict) => verdict.feeVerifiedId != null);
      if (verified.length > 0) {
        await scope`
          UPDATE verified_fee_observations fv
             SET review_status = 'rejected',
                 outlier_flags = CASE
                   WHEN fv.outlier_flags ? ${REREAD_CATEGORY_FLAG} THEN fv.outlier_flags
                   ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${REREAD_CATEGORY_FLAG}::text)
                 END
           WHERE fv.fee_verified_id = ANY(${verified.map((verdict) => verdict.feeVerifiedId as number)}::bigint[])
             AND fv.review_status IN ('verified', 'approved')
        `;
      }
      if (applied.length > 0) {
        await scope`
          INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
          VALUES (
            ${runId}, ${stepId}, ${`${REREAD_CATEGORY_CHECK}_takedown`}, 'completed',
            ${`Archived ${applied.length} live fee(s) whose own line Knox now reads as a fee already live under its right category, on their second look`},
            ${JSON.stringify({ version: REREAD_CATEGORY_CHECK_VERSION, taken_down: applied.map(sampleDetail) })}::jsonb
          )
        `;
      }
      return applied.map((verdict) => verdict.feePublishedId);
    });
  } catch (error) {
    console.error("[darwin] reread category takedown failed", error instanceof Error ? error.message : error);
    return [];
  }
}

function sampleDetail(verdict: RereadCategoryVerdict) {
  return {
    fee_published_id: verdict.feePublishedId,
    institution_id: verdict.institutionId,
    source_document_id: verdict.sourceDocumentId,
    amount: verdict.amount,
    outcome: verdict.outcome,
    from_key: verdict.canonicalFeeKey,
    old_name: verdict.feeName,
    ...(verdict.newKey ? { to_key: verdict.newKey, new_name: verdict.newName } : {}),
    ...(verdict.twinFeePublishedId ? { twin_fee_published_id: verdict.twinFeePublishedId } : {}),
    ...(verdict.refusedBy ? { refused_by: verdict.refusedBy } : {}),
    ...(verdict.readNames ? { read_names: verdict.readNames } : {}),
  };
}

export function rereadCategoryMessage(result: RereadCategoryResult): string {
  const outcomes = Object.entries(result.outcomes).map(([outcome, count]) => `${count} ${outcome.replace(/_/g, " ")}`).join(", ") || "none";
  const action = result.live && !result.dryRun
    ? `${result.flagged} flagged, ${result.refiled.length} re-filed, ${result.takenDown.length} archived`
    : `${result.dryRun ? "dry run" : "switch off"}, nothing written`;
  return `Read ${result.checked} live fee(s) whose own line Knox's re-read files under another category (${outcomes}): ${result.matched} would move; ${action}`;
}

/** The step's detail for the run ledger. */
export function rereadCategoryDetail(result: RereadCategoryResult) {
  return {
    check: REREAD_CATEGORY_CHECK,
    version: REREAD_CATEGORY_CHECK_VERSION,
    switch_live: result.live,
    dry_run: result.dryRun,
    checked: result.checked,
    outcomes: result.outcomes,
    matched: result.matched,
    flagged: result.flagged,
    waiting: result.waiting,
    cleared: result.cleared,
    refiled: result.refiled,
    taken_down: result.takenDown,
    samples: result.samples.map(sampleDetail),
  };
}
