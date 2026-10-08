import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { recordAttempt } from "@/lib/agents/learning/attempts";
import { feedbackSchemaReady, recordFeedback } from "@/lib/agents/learning/feedback";
import { tidyFeeName } from "@/lib/agents/knox/layout";
import { stripFootnoteMarks } from "@/lib/agents/knox/rules";
import { traceLiveFee, type InstitutionText, type LiveFeeRow } from "@/lib/agents/hamilton/source-check";
import { checkFeeCategory } from "@/lib/fee-category-guard";

type SqlTag = typeof sql;

/**
 * A better name for a live fee whose stored name ran on: cells joined with "|" from a table
 * row, the previous row's unit or price ("/Month | Stop Payment"), or the words that led into
 * the price ("Replacement card fee of"). Knox's `tidyFeeName` fixes new reads since v17/v29;
 * this applies the same tidy to names stored before, with a stricter bar because the name is
 * already live: the new name must still name a fee, still pass the category guard, and not end
 * on a verb ("Dormant accounts will incur"). Returns null when the name should stay as it is.
 */
const VERB_END =
  /\b(?:is|are|was|were|be|will|shall|may|can|incur|incurs|receive|receives|charges|charged|imposed|assessed|apply|applies|pay|pays|cost|costs|maintain|exceed|exceeds|lesser|greater|up|than|least|over|under|varies)$/i;
const FEE_NOUN =
  /\b(?:fees?|charges?|service|transfers?|wires?|checks?|cards?|statements?|overdrafts?|nsf|payments?|box|boxes|orders?|deposits?|withdrawals?|cop(?:y|ies)|research|items?|atms?|accounts?|drafts?|stop|fax|notary|photocopy|printing|coins?|money|cashier'?s?|official|bill|replacement|closing|closure|inactivity|inactive|dormant|maintenance|balance|garnishments?|levy|levies|subpoenas?|returned|returns?|counter|temporary|starter|rush|express|expedited|delivery|ach|zelle|p2p|transactions?|reissue|key|drilling)\b/i;
const MAX_WORDS = 12;
/** A cell that qualifies a price ("Per quarter (inactive ...)", "each request"), not a name. */
const QUALIFIER_START = /^(?:per|each|a|an|the|\/|for|if|when|plus|includes?)\b/i;
/** A cell naming the unit a price is charged by, not the fee. */
const UNIT_TAIL =
  /^(?:(?:each|per)\b.*|monthly|month|hour|items?|checks?|cards?|account|wire|request|occurrence|transaction|key lost|\d.*)$/i;
/** A name that is the condition for a fee, not the fee ("None with e-Statement enrollment, otherwise", "To avoid a ... charge"). */
const NOT_A_NAME = /^(?:none|free|no|n\/a|(?:to\s+)?avoid)\b|\botherwise$/i;
/** Two sentences run together ("drafts and a. Garnishment"). */
const SENTENCE_BREAK = /[a-z]\.\s+[A-Z]/;

/** The tidy name a live fee should show, or null to keep its name. */
export function retidiedFeeName(name: string, canonicalKey: string): string | null {
  const tidy = fullyTidiedName(name, canonicalKey);
  if (tidy) return tidy;
  // v3: only a footnote number to drop. The words stay as they were read, so the run-on
  // limits don't apply ("Overdraft Protection Transfer Fee4 (from Line of Credit ...)").
  const current = name.trim();
  const unfooted = stripFootnoteMarks(current);
  if (!unfooted || unfooted === current) return null;
  if (checkFeeCategory(canonicalKey, current).ok && !checkFeeCategory(canonicalKey, unfooted).ok) return null;
  return unfooted;
}

function fullyTidiedName(name: string, canonicalKey: string): string | null {
  const current = name.trim();
  let tidy = tidyFeeName(current);
  // Joined cells: the cell nearest the price is the fee when it names one on its own
  // ("RESEARCH | Incoming Wire Transfer Fee" is the wire fee, not research).
  if (current.includes("|")) {
    let cells = tidy.split(": ").map((cell) => cell.trim()).filter(Boolean);
    // A unit cell after the name is the price's qualifier ("Stop Payment | Item",
    // "Garnishment | each presentment", "Temporary Checks | 4 checks").
    while (cells.length > 1 && UNIT_TAIL.test(cells[cells.length - 1]) && cells[cells.length - 1].split(/\s+/).length <= 3) {
      cells = cells.slice(0, -1);
    }
    tidy = cells.join(": ");
    const last = cells[cells.length - 1] ?? "";
    if (
      cells.length > 1 &&
      last.split(/\s+/).length >= 2 &&
      !QUALIFIER_START.test(last) &&
      FEE_NOUN.test(last) &&
      checkFeeCategory(canonicalKey, last).ok
    ) {
      tidy = last;
    }
  }
  tidy = tidy.replace(/^(?:[\s\-–—•*:;,.]+|\(\d+\)\s*)+/u, "").trim();
  if (!tidy || tidy === current) return null;
  if (NOT_A_NAME.test(tidy)) return null;
  if (QUALIFIER_START.test(tidy) && !/^(?:a|an|the)\b/i.test(tidy)) return null;
  // A sentence about the customer ("I must maintain a minimum balance") is not a fee's name.
  if (/^(?:i|we|you|my|our|your)\b/i.test(tidy)) return null;
  if (tidy.includes("|") || SENTENCE_BREAK.test(tidy) || VERB_END.test(tidy) || /\b(?:prices vary|varies)\b/i.test(tidy)) return null;
  if (!FEE_NOUN.test(tidy) || tidy.split(/\s+/).length > MAX_WORDS) return null;
  if (checkFeeCategory(canonicalKey, current).ok && !checkFeeCategory(canonicalKey, tidy).ok) return null;
  return tidy;
}

/**
 * v2: a footnote number glued to the name ("Check Cashing Fee1") is messy too.
 * v3: a long name loses its footnote number even when the full tidy would leave it as is.
 */
export const NAME_RETIDY_STRATEGY = { strategy: "knox.name_retidy", version: 3 } as const;
export const NAME_RETIDY_KIND = "name_retidied";
/** Institutions per publish step: about 760 hold a messy live name, so a few hours clears them. */
export const NAME_RETIDY_INSTITUTION_LIMIT = 40;

export type RetidySkip = "no_better_name" | "would_not_trace" | "category_guard" | "same_name_live";

export interface RetidyRename {
  feePublishedId: number;
  institutionId: number;
  sourceDocumentId: number | null;
  canonicalFeeKey: string;
  amount: number | null;
  oldName: string;
  newName: string;
}

export interface RetidyPlan {
  renames: RetidyRename[];
  skipped: Record<RetidySkip, number>;
}

/**
 * Pure: which live fees take their tidy name. A rename never makes a live fee easier to take
 * down: when the old name traces in the fee's own stored schedule, the new one must too
 * (the source check and the rules re-check both read `fee_name`), the category guard must
 * still accept it, and no other live fee of the bank may already carry the new name at the
 * same price and category (the duplicate collapse would close one of them).
 */
export function planRetidy(fees: LiveFeeRow[], texts: InstitutionText[], liveFees: LiveFeeRow[] = fees): RetidyPlan {
  const skipped: Record<RetidySkip, number> = { no_better_name: 0, would_not_trace: 0, category_guard: 0, same_name_live: 0 };
  const renames: RetidyRename[] = [];
  const lineKey = (fee: Pick<LiveFeeRow, "institution_id" | "canonical_fee_key" | "amount">, name: string) =>
    `${Number(fee.institution_id)}|${fee.canonical_fee_key}|${fee.amount == null ? "" : Number(fee.amount).toFixed(2)}|${name.trim().toLowerCase()}`;
  const taken = new Set(liveFees.map((fee) => lineKey(fee, fee.fee_name)));
  for (const fee of fees) {
    const newName = retidiedFeeName(fee.fee_name, fee.canonical_fee_key);
    if (!newName) {
      skipped.no_better_name += 1;
      continue;
    }
    if (checkFeeCategory(fee.canonical_fee_key, fee.fee_name).ok && !checkFeeCategory(fee.canonical_fee_key, newName).ok) {
      skipped.category_guard += 1;
      continue;
    }
    if (taken.has(lineKey(fee, newName))) {
      skipped.same_name_live += 1;
      continue;
    }
    const before = traceLiveFee(fee, texts);
    const after = traceLiveFee({ ...fee, fee_name: newName }, texts);
    if (before.kind !== "untraceable" && after.kind === "untraceable") {
      skipped.would_not_trace += 1;
      continue;
    }
    taken.add(lineKey(fee, newName));
    renames.push({
      feePublishedId: Number(fee.fee_published_id),
      institutionId: Number(fee.institution_id),
      sourceDocumentId: fee.source_document_id == null ? null : Number(fee.source_document_id),
      canonicalFeeKey: fee.canonical_fee_key,
      amount: fee.amount == null ? null : Number(fee.amount),
      oldName: fee.fee_name,
      newName,
    });
  }
  return { renames, skipped };
}

export interface RetidyResult extends RetidyPlan {
  dryRun: boolean;
  institutionsChecked: number;
  messyFees: number;
}

const EMPTY: RetidyResult = {
  dryRun: false,
  institutionsChecked: 0,
  messyFees: 0,
  renames: [],
  skipped: { no_better_name: 0, would_not_trace: 0, category_guard: 0, same_name_live: 0 },
};

/** An institution is looked at again when a newer live fee appears or the strategy changes. */
export function retidyFingerprint(maxLiveFeeId: number | string): string {
  return `v${NAME_RETIDY_STRATEGY.version}:${maxLiveFeeId}`;
}

/**
 * Gives live fees with run-on names their tidy name, a batch of institutions per publish
 * step. The old name is never lost: each rename is a `name_retidied` row in
 * `pipeline_feedback` holding the old and new names (dedupe key per live row), and the raw
 * and verified rows keep the name Knox read.
 */
export async function retidyLiveFeeNames(
  db: SqlTag,
  options: { runId: number; dryRun: boolean; institutionId?: number; institutionLimit?: number },
): Promise<RetidyResult> {
  const limit = options.institutionLimit ?? NAME_RETIDY_INSTITUTION_LIMIT;
  let fingerprints: Map<number, string>;
  let liveFees: LiveFeeRow[];
  let texts: Array<InstitutionText & { institution_id: number | string }>;
  try {
    if (!(await inSavepoint(db, (scope) => feedbackSchemaReady(scope)))) return { ...EMPTY, dryRun: options.dryRun };
    const due = await inSavepoint(db, (scope) => scope<{ institution_id: number | string; max_fee_id: number | string }[]>`
      SELECT live.institution_id, live.max_fee_id
        FROM (
          SELECT fp.institution_id, MAX(fp.fee_published_id) AS max_fee_id,
                 -- The same test as isMessyName: joined cells, a dangling lead-in word, a run-on, a footnote number.
                 bool_or(
                   fp.fee_name LIKE '%|%'
                   OR fp.fee_name ~* '[[:space:]](of|for|at|is|to|and|or|with|by|a|an|the)$'
                   OR length(fp.fee_name) > 80
                   OR fp.fee_name ~ ${FOOTNOTE_SQL}
                 ) AS messy
            FROM published_fee_records fp
           WHERE fp.rolled_back_at IS NULL
             AND (${options.institutionId ?? null}::bigint IS NULL OR fp.institution_id = ${options.institutionId ?? null}::bigint)
           GROUP BY fp.institution_id
        ) live
       WHERE live.messy
         AND NOT EXISTS (
           SELECT 1 FROM pipeline_attempts pa
            WHERE pa.stage = 'publish'
              AND pa.strategy = ${NAME_RETIDY_STRATEGY.strategy}
              AND pa.institution_id = live.institution_id
              AND pa.input_fingerprint = 'v' || ${NAME_RETIDY_STRATEGY.version}::text || ':' || live.max_fee_id::text
         )
       ORDER BY live.institution_id
       LIMIT ${limit}
    `);
    if (due.length === 0) return { ...EMPTY, dryRun: options.dryRun };
    fingerprints = new Map(due.map((row) => [Number(row.institution_id), retidyFingerprint(row.max_fee_id)]));
    const ids = [...fingerprints.keys()];
    liveFees = await inSavepoint(db, (scope) => scope<LiveFeeRow[]>`
      SELECT fp.fee_published_id, fp.lineage_ref, fv.fee_raw_id, fp.institution_id, fr.source, fr.source_document_id,
             fp.canonical_fee_key, fp.fee_name, fp.amount, fp.amount_kind, fp.rate_percent
        FROM published_fee_records fp
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE fp.rolled_back_at IS NULL
         AND fp.institution_id = ANY(${ids}::bigint[])
    `);
    texts = await inSavepoint(db, (scope) => scope<Array<InstitutionText & { institution_id: number | string }>>`
      SELECT DISTINCT ON (source_document_id) institution_id, source_document_id, normalized_text
        FROM agent_source_texts
       WHERE institution_id = ANY(${ids}::bigint[])
         AND status = 'completed'
         AND normalized_text IS NOT NULL
       ORDER BY source_document_id, id DESC
    `);
  } catch (error) {
    // A failed tidy must never block publishing.
    console.error("retidyLiveFeeNames select failed:", error);
    return { ...EMPTY, dryRun: options.dryRun };
  }

  const result: RetidyResult = { ...EMPTY, dryRun: options.dryRun, institutionsChecked: fingerprints.size, renames: [], skipped: { ...EMPTY.skipped } };
  const perInstitution = new Map<number, { messy: number; renamed: number }>();
  for (const institutionId of fingerprints.keys()) {
    const fees = liveFees.filter((fee) => Number(fee.institution_id) === institutionId);
    const messy = fees.filter((fee) => isMessyName(fee.fee_name));
    const plan = planRetidy(messy, texts.filter((text) => Number(text.institution_id) === institutionId), fees);
    result.messyFees += messy.length;
    result.renames.push(...plan.renames);
    for (const [key, count] of Object.entries(plan.skipped)) result.skipped[key as RetidySkip] += count;
    perInstitution.set(institutionId, { messy: messy.length, renamed: plan.renames.length });
  }
  if (options.dryRun) return result;

  try {
    await inSavepoint(db, async (scope) => {
      if (result.renames.length > 0) {
        await recordFeedback(
          scope,
          result.renames.map((rename) => ({
            aboutStage: "publish",
            aboutStrategy: NAME_RETIDY_STRATEGY.strategy,
            aboutVersion: NAME_RETIDY_STRATEGY.version,
            signal: "right",
            kind: NAME_RETIDY_KIND,
            reportedBy: "knox",
            checkName: NAME_RETIDY_STRATEGY.strategy,
            institutionId: rename.institutionId,
            sourceDocumentId: rename.sourceDocumentId,
            feePublishedId: rename.feePublishedId,
            canonicalFeeKey: rename.canonicalFeeKey,
            amount: rename.amount,
            // A rename is housekeeping, not a judgement on the read: it carries no weight in lessons.
            weight: 0,
            evidence: { old_name: rename.oldName, new_name: rename.newName },
            runId: options.runId,
            dedupeKey: `${NAME_RETIDY_STRATEGY.strategy}:pub:${rename.feePublishedId}`,
          })),
        );
        await scope`
          UPDATE published_fee_records fp
             SET fee_name = rename.new_name
            FROM unnest(
                   ${result.renames.map((rename) => rename.feePublishedId)}::bigint[],
                   ${result.renames.map((rename) => rename.oldName)}::text[],
                   ${result.renames.map((rename) => rename.newName)}::text[]
                 ) AS rename(fee_published_id, old_name, new_name)
           WHERE fp.fee_published_id = rename.fee_published_id
             AND fp.rolled_back_at IS NULL
             AND fp.fee_name = rename.old_name
        `;
      }
      for (const [institutionId, counts] of perInstitution) {
        await recordAttempt(scope, {
          institutionId,
          sourceDocumentId: null,
          stage: "publish",
          strategy: NAME_RETIDY_STRATEGY.strategy,
          version: NAME_RETIDY_STRATEGY.version,
          fingerprint: fingerprints.get(institutionId)!,
          outcome: counts.renamed > 0 ? "ok" : "unchanged",
          yieldCount: counts.renamed,
          costMicrousd: 0,
          runId: options.runId,
          foldIntoPlaybook: false,
          detail: { messy_names: counts.messy, renamed: counts.renamed },
        });
      }
      await scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${NAME_RETIDY_STRATEGY.strategy}, 'completed',
          ${`Tidied ${result.renames.length} live fee name(s) of ${result.messyFees} run-on name(s) at ${result.institutionsChecked} institution(s); old names kept in pipeline_feedback`},
          ${JSON.stringify({
            version: NAME_RETIDY_STRATEGY.version,
            institutions_checked: result.institutionsChecked,
            messy_names: result.messyFees,
            renamed: result.renames.length,
            skipped: result.skipped,
            samples: result.renames.slice(0, 20).map((rename) => ({
              fee_published_id: rename.feePublishedId,
              canonical_fee_key: rename.canonicalFeeKey,
              old_name: rename.oldName,
              new_name: rename.newName,
            })),
          })}::jsonb
        )
      `;
    });
  } catch (error) {
    console.error("retidyLiveFeeNames write failed:", error);
    return { ...result, renames: [] };
  }
  if (result.renames.length > 0) invalidatePublicReadCache();
  return result;
}

/** The live names this step looks at: joined cells, a dangling lead-in word, a run-on, or a footnote number. */
export function isMessyName(name: string): boolean {
  return (
    name.includes("|") ||
    /\s(?:of|for|at|is|to|and|or|with|by|a|an|the)$/i.test(name) ||
    name.length > 80 ||
    stripFootnoteMarks(name) !== name.trim()
  );
}

/** Postgres twin of `stripFootnoteMarks`'s match, so the due query finds the same names. */
const FOOTNOTE_SQL = "([A-Za-z][a-z]{2}|\\))[0-9]{1,2}(,[0-9]{1,2})*(\\s*\\(|\\s*$)";
