import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { recordAttempt } from "@/lib/agents/learning/attempts";
import { feedbackSchemaReady, recordFeedback } from "@/lib/agents/learning/feedback";
import { traceLiveFee, type InstitutionText, type LiveFeeRow } from "@/lib/agents/hamilton/source-check";
import { excerptOf } from "@/lib/agents/hamilton/frequency-fill";
import { checkFeeCategory } from "@/lib/fee-category-guard";
import { capsCasedName } from "@/lib/agents/knox/name-retidy";
import { accountHeading, accountHeadingForExcerpt, GENERIC_ACCOUNT_FEE_NAME, withAccountName } from "@/lib/fee-account-heading";

type SqlTag = typeof sql;

/**
 * A live fee named only "Monthly Service Fee" takes the account heading printed above it in its
 * own stored schedule ("Chase Total Checking Monthly Service Fee"). Chase showed five live
 * "Monthly Service Fee" rows ($4.95 to $35) with nothing to tell them apart; on Oct 8, 695 of
 * 1,237 live generic monthly names shared their bank's name with another row.
 *
 * Same bar as Knox's name retidy: the new name must pass the category guard, must not match
 * another live row of the bank at the same price and category, and must still trace in the
 * schedule when the old name did. Each rename is a `name_account_added` row in
 * `pipeline_feedback` holding the old name, the new name and the heading, so it is reversed by
 * setting `fee_name` back; the raw and verified rows keep the name Knox read.
 *
 * v2 (#1810): when no heading sits above the fee, the account Knox's lineup read recorded on the
 * raw row (`product_name`) names it instead, if it reads as a heading, is printed in the fee's
 * own schedule, and no other generic fee of that schedule carries the same account. Over 1,137
 * v1 runs, 5,883 of 7,332 generic names found no heading; on Oct 17, 518 of 1,763 live generic
 * names had such an account, 229 of them among the 859 that shared their bank's name.
 */
export const ACCOUNT_NAME_STRATEGY = { strategy: "hamilton.account_names", version: 2 } as const;
export const ACCOUNT_NAME_KIND = "name_account_added";
export const ACCOUNT_NAME_INSTITUTION_LIMIT = 40;

/** Postgres twin of `GENERIC_ACCOUNT_FEE_NAME`, so the due query finds the same names. */
const GENERIC_NAME_SQL = String.raw`^\s*(monthly\s+)?(service|maintenance|account maintenance)\s+(fee|charge)s?\s*\*?\s*:?\s*$|^\s*monthly\s+(fee|charge)\s*\*?\s*:?\s*$|^\s*minimum\s+balance\s+(fee|charge)\s*\*?\s*:?\s*$`;
const ACCOUNT_FEE_KEYS = ["monthly_maintenance", "minimum_balance"];

export type AccountNameSkip = "no_heading" | "would_not_trace" | "category_guard" | "same_name_live";

export interface AccountRename {
  feePublishedId: number;
  institutionId: number;
  sourceDocumentId: number | null;
  canonicalFeeKey: string;
  amount: number | null;
  oldName: string;
  newName: string;
  heading: string;
  /** Where the account came from: the heading above the fee, or Knox's recorded account (v2). */
  headingFrom: "above" | "product";
}

export interface AccountNamePlan {
  renames: AccountRename[];
  skipped: Record<AccountNameSkip, number>;
}

export type AccountNameFee = LiveFeeRow & { conditions: string | null; product_name?: string | null };

/** Page furniture a lineup can mistake for an account ("Account Login", "Restart Checking Account Today"). */
const PRODUCT_FURNITURE = /\b(login|log in|sign in|today|steps?|view|next|my|add|open|online|includes)\b|\baccountopen\b/i;
/** An account's name ends in the kind of account ("Fresh Start Checking", "Refresh Checking (Second Chance)"). */
const ENDS_IN_ACCOUNT = /\b(checking|savings|account|club|certificate|market|draft|cd|ira)(?:\s*\([^)]*\))?$/i;

const plain = (value: string) => value.replace(/[®™℠*]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/** Knox's recorded account for a fee, when it reads as a heading and is printed in `text`. */
export function productHeading(productName: string | null | undefined, text: string | null | undefined): string | null {
  if (!productName || !text || PRODUCT_FURNITURE.test(productName)) return null;
  // "CNB GOLD CHECKING" reads "CNB Gold Checking", as Knox's tidy cases a live name (v22).
  const heading = accountHeading(capsCasedName(productName) ?? productName);
  // "Account Online", "Foundation Checking includes", "External Account Transfers": a lineup's
  // stray line, not an account.
  if (!heading || /^account\b/i.test(heading) || !ENDS_IN_ACCOUNT.test(heading) || /(^|\s)[a-z]/.test(heading)) return null;
  // A word printed twice is two lines run together ("Free Checking Free Checking", "Current Account New Account").
  const words = heading.toLowerCase().split(/\s+/);
  if (new Set(words).size !== words.length) return null;
  return plain(text).includes(plain(heading)) ? heading : null;
}

/** Pure: which generic live names take their account heading. */
export function planAccountNames(fees: AccountNameFee[], texts: InstitutionText[], liveFees: LiveFeeRow[] = fees): AccountNamePlan {
  const skipped: Record<AccountNameSkip, number> = { no_heading: 0, would_not_trace: 0, category_guard: 0, same_name_live: 0 };
  const renames: AccountRename[] = [];
  const lineKey = (fee: Pick<LiveFeeRow, "institution_id" | "canonical_fee_key" | "amount">, name: string) =>
    `${Number(fee.institution_id)}|${fee.canonical_fee_key}|${fee.amount == null ? "" : Number(fee.amount).toFixed(2)}|${name.trim().toLowerCase()}`;
  const taken = new Set(liveFees.map((fee) => lineKey(fee, fee.fee_name)));
  const generic = fees.filter((fee) => ACCOUNT_FEE_KEYS.includes(fee.canonical_fee_key) && GENERIC_ACCOUNT_FEE_NAME.test(fee.fee_name));
  // One recorded account on two generic fees of one schedule is a lineup that spread one account
  // across a comparison table's columns: it names neither.
  const productKey = (fee: AccountNameFee) => `${fee.source_document_id ?? ""}|${(fee.product_name ?? "").trim().toLowerCase()}`;
  const productCounts = new Map<string, number>();
  for (const fee of generic) if (fee.product_name) productCounts.set(productKey(fee), (productCounts.get(productKey(fee)) ?? 0) + 1);
  for (const fee of generic) {
    const own = texts.find((text) => fee.source_document_id != null && Number(text.source_document_id) === Number(fee.source_document_id));
    const above = accountHeadingForExcerpt(own?.normalized_text, excerptOf(fee.conditions));
    const product = above || productCounts.get(productKey(fee)) !== 1 ? null : productHeading(fee.product_name, own?.normalized_text);
    const heading = above ?? product;
    if (!heading) {
      skipped.no_heading += 1;
      continue;
    }
    const newName = withAccountName(fee.fee_name, heading);
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
      heading,
      headingFrom: above ? "above" : "product",
    });
  }
  return { renames, skipped };
}

export interface AccountNameResult extends AccountNamePlan {
  dryRun: boolean;
  institutionsChecked: number;
  genericFees: number;
}

const EMPTY: AccountNameResult = {
  dryRun: false,
  institutionsChecked: 0,
  genericFees: 0,
  renames: [],
  skipped: { no_heading: 0, would_not_trace: 0, category_guard: 0, same_name_live: 0 },
};

/** An institution is looked at again when a newer live fee appears or the strategy changes. */
export function accountNameFingerprint(maxLiveFeeId: number | string): string {
  return `v${ACCOUNT_NAME_STRATEGY.version}:${maxLiveFeeId}`;
}

/** Gives generic live monthly-fee names their account, a batch of institutions per publish step. */
export async function nameLiveFeesByAccount(
  db: SqlTag,
  options: { runId: number; dryRun: boolean; institutionId?: number; institutionLimit?: number },
): Promise<AccountNameResult> {
  const limit = options.institutionLimit ?? ACCOUNT_NAME_INSTITUTION_LIMIT;
  let fingerprints: Map<number, string>;
  let liveFees: AccountNameFee[];
  let texts: Array<InstitutionText & { institution_id: number | string }>;
  try {
    if (!(await inSavepoint(db, (scope) => feedbackSchemaReady(scope)))) return { ...EMPTY, dryRun: options.dryRun };
    const due = await inSavepoint(db, (scope) => scope<{ institution_id: number | string; max_fee_id: number | string }[]>`
      SELECT live.institution_id, live.max_fee_id
        FROM (
          SELECT fp.institution_id, MAX(fp.fee_published_id) AS max_fee_id,
                 bool_or(fp.canonical_fee_key = ANY(${ACCOUNT_FEE_KEYS}::text[]) AND fp.fee_name ~* ${GENERIC_NAME_SQL}) AS generic
            FROM published_fee_records fp
           WHERE fp.rolled_back_at IS NULL
             AND (${options.institutionId ?? null}::bigint IS NULL OR fp.institution_id = ${options.institutionId ?? null}::bigint)
           GROUP BY fp.institution_id
        ) live
       WHERE live.generic
         AND NOT EXISTS (
           SELECT 1 FROM pipeline_attempts pa
            WHERE pa.stage = 'publish'
              AND pa.strategy = ${ACCOUNT_NAME_STRATEGY.strategy}
              AND pa.institution_id = live.institution_id
              AND pa.input_fingerprint = 'v' || ${ACCOUNT_NAME_STRATEGY.version}::text || ':' || live.max_fee_id::text
         )
       ORDER BY live.institution_id
       LIMIT ${limit}
    `);
    if (due.length === 0) return { ...EMPTY, dryRun: options.dryRun };
    fingerprints = new Map(due.map((row) => [Number(row.institution_id), accountNameFingerprint(row.max_fee_id)]));
    const ids = [...fingerprints.keys()];
    liveFees = await inSavepoint(db, (scope) => scope<AccountNameFee[]>`
      SELECT fp.fee_published_id, fp.lineage_ref, fv.fee_raw_id, fp.institution_id, fr.source, fr.source_document_id,
             fp.canonical_fee_key, fp.fee_name, fp.amount, fp.amount_kind, fp.rate_percent, COALESCE(fr.extraction_note, fr.conditions) AS conditions,
             fr.product_name
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
    // A failed rename must never block publishing.
    console.error("nameLiveFeesByAccount select failed:", error);
    return { ...EMPTY, dryRun: options.dryRun };
  }

  const result: AccountNameResult = { ...EMPTY, dryRun: options.dryRun, institutionsChecked: fingerprints.size, renames: [], skipped: { ...EMPTY.skipped } };
  const perInstitution = new Map<number, { generic: number; renamed: number }>();
  for (const institutionId of fingerprints.keys()) {
    const fees = liveFees.filter((fee) => Number(fee.institution_id) === institutionId);
    const generic = fees.filter((fee) => ACCOUNT_FEE_KEYS.includes(fee.canonical_fee_key) && GENERIC_ACCOUNT_FEE_NAME.test(fee.fee_name));
    const plan = planAccountNames(generic, texts.filter((text) => Number(text.institution_id) === institutionId), fees);
    result.genericFees += generic.length;
    result.renames.push(...plan.renames);
    for (const [key, count] of Object.entries(plan.skipped)) result.skipped[key as AccountNameSkip] += count;
    perInstitution.set(institutionId, { generic: generic.length, renamed: plan.renames.length });
  }
  if (options.dryRun) return result;

  try {
    await inSavepoint(db, async (scope) => {
      if (result.renames.length > 0) {
        await recordFeedback(
          scope,
          result.renames.map((rename) => ({
            aboutStage: "publish",
            aboutStrategy: ACCOUNT_NAME_STRATEGY.strategy,
            aboutVersion: ACCOUNT_NAME_STRATEGY.version,
            signal: "right",
            kind: ACCOUNT_NAME_KIND,
            reportedBy: "gutenberg",
            checkName: ACCOUNT_NAME_STRATEGY.strategy,
            institutionId: rename.institutionId,
            sourceDocumentId: rename.sourceDocumentId,
            feePublishedId: rename.feePublishedId,
            canonicalFeeKey: rename.canonicalFeeKey,
            amount: rename.amount,
            // A rename is housekeeping, not a judgement on the read: it carries no weight in lessons.
            weight: 0,
            evidence: { old_name: rename.oldName, new_name: rename.newName, heading: rename.heading, heading_from: rename.headingFrom },
            runId: options.runId,
            dedupeKey: `${ACCOUNT_NAME_STRATEGY.strategy}:pub:${rename.feePublishedId}`,
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
          strategy: ACCOUNT_NAME_STRATEGY.strategy,
          version: ACCOUNT_NAME_STRATEGY.version,
          fingerprint: fingerprints.get(institutionId)!,
          outcome: counts.renamed > 0 ? "ok" : "unchanged",
          yieldCount: counts.renamed,
          costMicrousd: 0,
          runId: options.runId,
          foldIntoPlaybook: false,
          detail: { generic_names: counts.generic, renamed: counts.renamed },
        });
      }
      await scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${ACCOUNT_NAME_STRATEGY.strategy}, 'completed',
          ${`Named ${result.renames.length} of ${result.genericFees} generic live monthly fee name(s) by their account at ${result.institutionsChecked} institution(s); old names kept in pipeline_feedback`},
          ${JSON.stringify({
            version: ACCOUNT_NAME_STRATEGY.version,
            institutions_checked: result.institutionsChecked,
            generic_names: result.genericFees,
            renamed: result.renames.length,
            skipped: result.skipped,
            samples: result.renames.slice(0, 20).map((rename) => ({
              fee_published_id: rename.feePublishedId,
              old_name: rename.oldName,
              new_name: rename.newName,
            })),
          })}::jsonb
        )
      `;
    });
  } catch (error) {
    console.error("nameLiveFeesByAccount write failed:", error);
    return { ...result, renames: [] };
  }
  if (result.renames.length > 0) invalidatePublicReadCache();
  return result;
}
