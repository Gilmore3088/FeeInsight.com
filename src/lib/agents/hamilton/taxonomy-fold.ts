import { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { passesDarwinChecks } from "@/lib/agents/knox/layout";
import { feedbackSchemaReady, recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import { RULES_RECHECK_CHECK } from "@/lib/agents/hamilton/rules-recheck";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { checkFeeCategory } from "@/lib/fee-category-guard";
import {
  FOLD_RULES_VERSION,
  RESEARCH_SPLIT_KEYS,
  RESEARCH_SPLIT_LIVE,
  RESEARCH_SPLIT_PREVIEW,
  RESEARCH_SPLIT_SQL_PATTERN,
  RETIRED_CATEGORIES,
  RETIRED_CATEGORY_KEYS,
  SPLIT_CATEGORIES,
  foldContext,
  foldRetiredCategory,
  researchSplitTarget,
  splitLiveCategory,
  subordinationRefileHeld,
  type SplitCategory,
} from "@/lib/fee-fold";

type SqlTag = typeof sql;

/**
 * Hamilton's top-50 fold (James, Oct 8 2026). Every live fee, and every verified fee not yet
 * published, under one of the fifteen retired categories is re-filed under one of the 50 by
 * its own wording and, for a bare name, the schedule section above it (`fee-fold.ts`). A fee
 * moves only when the new category's guard and price range accept it. A fee with no home
 * among the 50 is taken down only after a second look, with its reason; nothing is deleted.
 * Each move is logged in `pipeline_feedback` (kind `category_fold`, check
 * `hamilton.taxonomy_fold`), and verified rows keep their old key in classification history.
 */
export const TAXONOMY_FOLD_CHECK = "hamilton.taxonomy_fold";
export const TAXONOMY_FOLD_KIND = "category_fold";
export const TAXONOMY_FOLD_REASON_PREFIX = "taxonomy_fold:";
/** Fees folded per publish step; the fifteen categories held about 1,000 live fees on Oct 8. */
export const TAXONOMY_FOLD_LIMIT = 2_000;
/**
 * Whether a live fee with no home is archived once its second look confirms it. James saw the
 * list of 248 (Oct 8 15:42 UTC: "drop them -- the 248"), so they are archived: rolled back and
 * logged, never deleted.
 */
export const TAXONOMY_FOLD_ARCHIVE_NO_HOME = true;
const WRITE_CHUNK = 500;

interface FoldRow {
  fee_published_id: number | string | null;
  fee_verified_id: number | string;
  institution_id: number | string;
  source_document_id: number | string | null;
  canonical_fee_key: string;
  fee_name: string | null;
  amount: number | string | null;
}

export interface FoldMove {
  feePublishedId: number | null;
  feeVerifiedId: number;
  institutionId: number;
  sourceDocumentId: number | null;
  from: string;
  to: string;
  rule: string;
  feeName: string;
  amount: number | null;
}

export interface FoldNoHome {
  feePublishedId: number;
  feeVerifiedId: number;
  institutionId: number;
  sourceDocumentId: number | null;
  canonicalFeeKey: string;
  feeName: string;
  amount: number | null;
  reason: string;
}

export interface FoldPlan {
  moves: FoldMove[];
  /** Live fees with no home among the 50 (second look before any takedown). */
  noHome: FoldNoHome[];
  /** Verified, unpublished fees with no home: left as they are, never published. */
  unplacedVerified: number;
}

function amountOf(value: number | string | null): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Retired keys with a rule that reads the schedule section, so a bare name needs the text. */
const CONTEXT_KEYS = new Set(
  Object.entries(RETIRED_CATEGORIES)
    .filter(([, retired]) => retired.rules.some((rule) => rule.context))
    .map(([key]) => key),
);

/** True when the fee's name alone does not place it but its section might. Pure. */
export function needsContext(key: string, feeName: string | null): boolean {
  return CONTEXT_KEYS.has(key) && foldRetiredCategory(key, feeName)?.to == null;
}

/**
 * Where each fee goes. `texts` holds the newest stored text of each source document a bare
 * name needs. Pure.
 */
export function planFold(rows: FoldRow[], texts: Map<number, string>): FoldPlan {
  const plan: FoldPlan = { moves: [], noHome: [], unplacedVerified: 0 };
  for (const row of rows) {
    const name = row.fee_name ?? "";
    const documentId = row.source_document_id == null ? null : Number(row.source_document_id);
    const text = documentId == null ? null : texts.get(documentId) ?? null;
    const context = needsContext(row.canonical_fee_key, name) ? foldContext(text, name, amountOf(row.amount)) : null;
    const split = splitLiveCategory(row.canonical_fee_key, name);
    const fold = foldRetiredCategory(row.canonical_fee_key, name, context) ?? split;
    if (!fold) continue;
    // A subordination fee its bank's line does not support stays where it is (#1370 review).
    if (subordinationRefileHeld(row.canonical_fee_key, fold.to, Number(row.fee_verified_id))) continue;
    const amount = amountOf(row.amount);
    const accepted = fold.to != null && passesDarwinChecks(fold.to, name, amount ?? 0);
    // A split fee its new type does not accept stays live where it is.
    if (split && !accepted) continue;
    if (fold.to && accepted) {
      plan.moves.push({
        feePublishedId: row.fee_published_id == null ? null : Number(row.fee_published_id),
        feeVerifiedId: Number(row.fee_verified_id),
        institutionId: Number(row.institution_id),
        sourceDocumentId: documentId,
        from: row.canonical_fee_key,
        to: fold.to,
        rule: fold.rule,
        feeName: name,
        amount,
      });
      continue;
    }
    if (row.fee_published_id == null) {
      plan.unplacedVerified += 1;
      continue;
    }
    plan.noHome.push({
      feePublishedId: Number(row.fee_published_id),
      feeVerifiedId: Number(row.fee_verified_id),
      institutionId: Number(row.institution_id),
      sourceDocumentId: documentId,
      canonicalFeeKey: row.canonical_fee_key,
      feeName: name,
      amount,
      reason: fold.to
        ? `no_home: ${fold.rule} places it under ${fold.to}, whose guard or price range does not accept it`
        : `no_home: ${fold.rule} finds no home among the top 50`,
    });
  }
  return plan;
}

/**
 * Rows each step's research split dry run reads, so the preview stays cheap while the switch is off
 * (about 2,300 live fees matched its names on Oct 15). The exact count over every row is on request,
 * with the publish step's `research_split_full_count` param, as Darwin's `fragment_full_count`.
 */
export const RESEARCH_SPLIT_PREVIEW_LIMIT = 2_000;
const PREVIEW_SAMPLE_PER_ROUTE = 10;

export interface ResearchSplitSample {
  feePublishedId: number | null;
  feeVerifiedId: number;
  institutionId: number;
  from: string;
  to: string;
  feeName: string;
  amount: number | null;
}

/**
 * What turning `RESEARCH_SPLIT_LIVE` on would do, from a dry run of the switched split table. A fee
 * whose name the split places but whose new type's guard or price range refuses it stays research.
 */
export interface ResearchSplitPreview {
  switchName: "RESEARCH_SPLIT_LIVE";
  live: boolean;
  /** Rows read: up to `RESEARCH_SPLIT_PREVIEW_LIMIT`, or every row on a full count. */
  scanned: number;
  /** True when the read was a full count, with no row limit. */
  fullCount: boolean;
  /** True when the read hit its row limit, so the counts are a lower bound. */
  capped: boolean;
  /** Live and verified-only fees the switch would move. */
  wouldMove: number;
  wouldMoveLive: number;
  /** By `<from>-><to>`. */
  byRoute: Record<string, number>;
  /** Placed by name but refused by the new type's guard or price range, so they would stay. */
  refused: number;
  refusedByRoute: Record<string, number>;
  /** Up to ten moves per route, and up to ten refusals per route. */
  sample: ResearchSplitSample[];
  refusedSample: ResearchSplitSample[];
}

/** The research split's dry run over account research rows. Pure. */
export function previewResearchSplit(
  rows: FoldRow[],
  table: Readonly<Record<string, SplitCategory>> = RESEARCH_SPLIT_PREVIEW,
): Omit<ResearchSplitPreview, "live" | "switchName" | "fullCount" | "capped"> {
  const preview: Omit<ResearchSplitPreview, "live" | "switchName" | "fullCount" | "capped"> = {
    scanned: rows.length,
    wouldMove: 0,
    wouldMoveLive: 0,
    byRoute: {},
    refused: 0,
    refusedByRoute: {},
    sample: [],
    refusedSample: [],
  };
  for (const row of rows) {
    const name = row.fee_name ?? "";
    const split = splitLiveCategory(row.canonical_fee_key, name, table);
    if (!split?.to || !RESEARCH_SPLIT_KEYS.has(split.to)) continue;
    const amount = amountOf(row.amount);
    const route = `${row.canonical_fee_key}->${split.to}`;
    const entry: ResearchSplitSample = {
      feePublishedId: row.fee_published_id == null ? null : Number(row.fee_published_id),
      feeVerifiedId: Number(row.fee_verified_id),
      institutionId: Number(row.institution_id),
      from: row.canonical_fee_key,
      to: split.to,
      feeName: name,
      amount,
    };
    if (passesDarwinChecks(split.to, name, amount ?? 0)) {
      preview.wouldMove += 1;
      if (entry.feePublishedId != null) preview.wouldMoveLive += 1;
      preview.byRoute[route] = (preview.byRoute[route] ?? 0) + 1;
      if (preview.byRoute[route] <= PREVIEW_SAMPLE_PER_ROUTE) preview.sample.push(entry);
    } else {
      preview.refused += 1;
      preview.refusedByRoute[route] = (preview.refusedByRoute[route] ?? 0) + 1;
      if (preview.refusedByRoute[route] <= PREVIEW_SAMPLE_PER_ROUTE) preview.refusedSample.push(entry);
    }
  }
  return preview;
}

/** Live fees, and verified fees not yet published, under account research whose name the research split might move. */
async function selectResearchSplitRows(db: SqlTag, institutionId: number | undefined, limit: number | null): Promise<FoldRow[]> {
  return db<FoldRow[]>`
    SELECT * FROM (
      SELECT fp.fee_published_id, fp.lineage_ref AS fee_verified_id, fp.institution_id,
             NULL::bigint AS source_document_id, fp.canonical_fee_key, fp.fee_name, fp.amount
        FROM published_fee_records fp
       WHERE fp.rolled_back_at IS NULL
         AND fp.canonical_fee_key = 'account_research'
         AND fp.fee_name ~* ${RESEARCH_SPLIT_SQL_PATTERN}
         AND (${institutionId ?? null}::bigint IS NULL OR fp.institution_id = ${institutionId ?? null}::bigint)
      UNION ALL
      SELECT NULL, fv.fee_verified_id, fv.institution_id, NULL::bigint, fv.canonical_fee_key, fv.fee_name, fv.amount
        FROM verified_fee_observations fv
       WHERE fv.canonical_fee_key = 'account_research'
         AND fv.fee_name ~* ${RESEARCH_SPLIT_SQL_PATTERN}
         AND fv.review_status IN ('verified', 'approved')
         AND (${institutionId ?? null}::bigint IS NULL OR fv.institution_id = ${institutionId ?? null}::bigint)
         AND NOT EXISTS (
           SELECT 1 FROM published_fee_records fp
            WHERE fp.lineage_ref = fv.fee_verified_id AND fp.rolled_back_at IS NULL
         )
    ) research
    ORDER BY fee_published_id NULLS LAST, fee_verified_id
    LIMIT ${limit}
  `;
}

async function selectRetiredRows(db: SqlTag, institutionId?: number): Promise<FoldRow[]> {
  const keys = [...RETIRED_CATEGORY_KEYS];
  const splitKeys = Object.keys(SPLIT_CATEGORIES);
  const splitPatterns = splitKeys.map((key) => SPLIT_CATEGORIES[key].sqlPattern);
  return db<FoldRow[]>`
    SELECT * FROM (
      SELECT fp.fee_published_id, fp.lineage_ref AS fee_verified_id, fp.institution_id,
             fr.source_document_id, fp.canonical_fee_key, fp.fee_name, fp.amount
        FROM published_fee_records fp
        LEFT JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE fp.rolled_back_at IS NULL
         AND (fp.canonical_fee_key = ANY(${keys}::text[])
              OR EXISTS (SELECT 1 FROM unnest(${splitKeys}::text[], ${splitPatterns}::text[]) AS s(k, l)
                          WHERE fp.canonical_fee_key = s.k AND fp.fee_name ~* s.l))
         AND (${institutionId ?? null}::bigint IS NULL OR fp.institution_id = ${institutionId ?? null}::bigint)
      UNION ALL
      SELECT NULL, fv.fee_verified_id, fv.institution_id, fr.source_document_id, fv.canonical_fee_key,
             fv.fee_name, fv.amount
        FROM verified_fee_observations fv
        LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE (fv.canonical_fee_key = ANY(${keys}::text[])
              OR EXISTS (SELECT 1 FROM unnest(${splitKeys}::text[], ${splitPatterns}::text[]) AS s(k, l)
                          WHERE fv.canonical_fee_key = s.k AND fv.fee_name ~* s.l))
         AND fv.review_status IN ('verified', 'approved')
         AND (${institutionId ?? null}::bigint IS NULL OR fv.institution_id = ${institutionId ?? null}::bigint)
         AND NOT EXISTS (
           SELECT 1 FROM published_fee_records fp
            WHERE fp.lineage_ref = fv.fee_verified_id AND fp.rolled_back_at IS NULL
         )
    ) retired
    ORDER BY fee_published_id NULLS LAST, fee_verified_id
    LIMIT ${TAXONOMY_FOLD_LIMIT}
  `;
}

async function loadTexts(db: SqlTag, documentIds: number[]): Promise<Map<number, string>> {
  if (documentIds.length === 0) return new Map();
  const rows = await db<{ source_document_id: number | string; normalized_text: string }[]>`
    SELECT DISTINCT ON (source_document_id) source_document_id, normalized_text
      FROM agent_source_texts
     WHERE source_document_id = ANY(${documentIds}::bigint[])
       AND normalized_text IS NOT NULL
     ORDER BY source_document_id, created_at DESC
  `;
  return new Map(rows.map((row) => [Number(row.source_document_id), row.normalized_text]));
}

async function applyMoves(db: SqlTag, moves: FoldMove[]): Promise<{ published: number; verified: number }> {
  let published = 0;
  let verified = 0;
  for (let start = 0; start < moves.length; start += WRITE_CHUNK) {
    const chunk = moves.slice(start, start + WRITE_CHUNK);
    const live = chunk.filter((move) => move.feePublishedId != null);
    if (live.length > 0) {
      const updated = await db`
        UPDATE published_fee_records fp
           SET canonical_fee_key = v.to_key
          FROM unnest(${live.map((move) => move.feePublishedId!)}::bigint[], ${live.map((move) => move.from)}::text[],
                      ${live.map((move) => move.to)}::text[]) AS v(fee_published_id, from_key, to_key)
         WHERE fp.fee_published_id = v.fee_published_id
           AND fp.canonical_fee_key = v.from_key
           AND fp.rolled_back_at IS NULL
        RETURNING fp.fee_published_id
      `;
      published += updated.length;
    }
    const updated = await db`
      UPDATE verified_fee_observations fv
         SET canonical_fee_key = v.to_key
        FROM unnest(${chunk.map((move) => move.feeVerifiedId)}::bigint[], ${chunk.map((move) => move.from)}::text[],
                    ${chunk.map((move) => move.to)}::text[]) AS v(fee_verified_id, from_key, to_key)
       WHERE fv.fee_verified_id = v.fee_verified_id
         AND fv.canonical_fee_key = v.from_key
      RETURNING fv.fee_verified_id
    `;
    verified += updated.length;
  }
  return { published, verified };
}

function moveFeedback(move: FoldMove, runId: number): FeedbackRow {
  return {
    aboutStage: "publish",
    aboutStrategy: TAXONOMY_FOLD_CHECK,
    aboutVersion: FOLD_RULES_VERSION,
    // A fold is a taxonomy decision, not a judgement of Knox's read.
    signal: "right",
    kind: TAXONOMY_FOLD_KIND,
    reportedBy: "gutenberg",
    checkName: TAXONOMY_FOLD_CHECK,
    institutionId: move.institutionId,
    sourceDocumentId: move.sourceDocumentId,
    feeVerifiedId: move.feeVerifiedId,
    feePublishedId: move.feePublishedId,
    canonicalFeeKey: move.to,
    amount: move.amount,
    weight: 0,
    evidence: { from: move.from, to: move.to, rule: move.rule, fee_name: move.feeName },
    runId,
    // Keyed by the target too: a fee folded twice (other lending in v14, legal process at v16)
    // keeps both moves on the ledger instead of the second overwriting the first.
    dedupeKey: `${TAXONOMY_FOLD_CHECK}:ver:${move.feeVerifiedId}:${move.to}`,
  };
}

/**
 * Live fees Knox filed under the wrong one of the 50 because it read a neighbouring cell as the
 * name (Data inventory's retidy v15 left them for review, Oct 9). Each is re-filed in place under
 * the page's own name for that line, with the old name and category logged; none is taken down.
 * An entry whose `to` equals its `from` only renames the fee.
 * Every name and price below traces to the stored schedule (`checkFeeAgainstSource`, 10/10).
 */
export interface HandRefile {
  feePublishedId: number;
  from: string;
  amount: number;
  to: string;
  name: string;
  /**
   * The bad name the fee still carries. When set, the fee is also fixed if another check has
   * already moved it under `to` with that name (96164: the guard's own hand re-file moves it to
   * atm_non_network without renaming it). A rename in place (`from` == `to`) with an `oldName`
   * runs only while the live name is still exactly that, so it runs once and never replaces a
   * better name a later read or retidy gave the fee (#1459 review).
   */
  oldName?: string;
  why: string;
}

export const HAND_REFILES: readonly HandRefile[] = [
  { feePublishedId: 40729, from: "garnishment_levy", amount: 38, to: "wire_intl_incoming", name: "International Outgoing/Incoming",
    why: "inst 3210, doc 1009: Wire Transfer lines end \"International Outgoing/Incoming ... $38.00\"" },
  { feePublishedId: 46537, from: "early_closure", amount: 15, to: "wire_domestic_incoming", name: "Wire Transfer Domestic (Incoming)",
    why: "inst 7676, doc 16437: \"Wire Transfer / Domestic (Incoming) | $15.00\"" },
  { feePublishedId: 46538, from: "early_closure", amount: 25, to: "wire_domestic_outgoing", name: "Wire Transfer Domestic (Outgoing)",
    why: "inst 7676, doc 16437: \"Domestic (Outgoing) | $25.00\" under Wire Transfer" },
  { feePublishedId: 54418, from: "bill_pay", amount: 30, to: "nsf", name: "NSF/Returned Item Fee",
    why: "inst 7280, doc 6912: \"NSF/Returned Item Fee | (Per Presentment ...) | $30.00\"" },
  { feePublishedId: 54427, from: "monthly_maintenance", amount: 5, to: "paper_statement", name: "Paper Statement",
    why: "inst 7280, doc 6912: \"Paper Statement | (Monthly Fee. Over 55 Free) | $5.00\"" },
  { feePublishedId: 76451, from: "monthly_maintenance", amount: 5, to: "minimum_balance", name: "Base Share balance below $25.00 (Monthly Fee)",
    why: "inst 7318, doc 23139: \"Base Share balance below $25.00 (Monthly Fee) | $5.00\"" },
  { feePublishedId: 92253, from: "account_research", amount: 5, to: "check_image",
    name: "Copy of historical check clearing, official check or money order, per item (max 4 checks, 5+ Account research fee, min 1 hour)",
    why: "inst 7622, doc 2468: \"Copy of historical check clearing, official check or money order, per item ... $5.00\"" },
  { feePublishedId: 98520, from: "garnishment_levy", amount: 20, to: "wire_domestic_outgoing", name: "Wire Transfer Fee",
    why: "inst 5075, doc 12163: \"Wire Transfer Fee | $20.00\" (international and incoming are separate lines)" },
  { feePublishedId: 98696, from: "bill_pay", amount: 10, to: "cashiers_check", name: "Cashier's Check Member Fee",
    why: "inst 8138, doc 12676: \"Cashier's Check (set up in Bill Pay only) / Member Fee | $10.00 per check\"" },
  { feePublishedId: 104858, from: "account_research", amount: 10, to: "monthly_maintenance", name: "Cashback Checking Plus Account Monthly service charge",
    why: "inst 7025, doc 2148: \"Cashback Checking Plus Account | $10.00 /month\"" },
  // Data inventory's live "to avoid" names (Oct 9): the right price under the wrong type.
  { feePublishedId: 56804, from: "monthly_maintenance", amount: 5, to: "paper_statement", name: "Monthly Service Fee per paper statement",
    why: "inst 2210, doc 17169: \"To avoid a Monthly Service Fee of $5 per paper statement, you must enroll for E-Statements\"" },
  { feePublishedId: 79217, from: "check_cashing", amount: 6, to: "collection_item", name: "Canadian/Foreign Check Handling Charge",
    why: "inst 51, doc 19813: the next column's \"Canadian/Foreign Check Handling Charge | $6.00 per item\"" },
  // Live names that start mid-sentence (Agentic OS's adversarial sample, Oct 9).
  { feePublishedId: 28554, from: "atm_non_network", amount: 2, to: "account_research", name: "No contents (e.g. check) included in the ATM",
    why: "inst 7913, doc 2195: an empty ATM deposit envelope, \"No contents (e.g. check) included in the ATM | $2/envelope\", an ATM adjustment" },
  { feePublishedId: 37068, from: "safe_deposit_box", amount: 25, to: "account_research", name: "research fee",
    why: "inst 6999, doc 7866: footnote \"Up to 5 copies, then $25/hr research fee\"" },
  { feePublishedId: 44516, from: "minimum_balance", amount: 25, to: researchSplitTarget("excess_withdrawal"), name: "Excessive transaction fee",
    why: "inst 161, doc 9080: \"Excessive transaction fee is $25/transaction\", an excess withdrawal fee" },
  { feePublishedId: 91458, from: "atm_non_network", amount: 5, to: "monthly_maintenance", name: "monthly maintenance fee",
    why: "inst 1349, doc 24074: \"*unlimited 1st National ATM access / $5.00 monthly maintenance fee\"" },
  { feePublishedId: 95142, from: "money_order", amount: 10, to: "account_research", name: "Money Order Research Fee",
    why: "inst 8581, doc 16111: \"Money Order Research Fee - $10.00/money order\" (Deming audit, run 3516)" },
  // UAT's retidy v16 scoring (Oct 9): the right price under the wrong type.
  { feePublishedId: 58050, from: "monthly_maintenance", amount: 2, to: "dormant_account", name: "Inactive account monthly fee",
    why: "inst 849, doc 17455: \"Inactive Account (no activity for 365 days, balances under $50) - monthly fee | $2.00\"" },
  { feePublishedId: 59464, from: "money_order", amount: 10, to: "stop_payment", name: "Stop Payment - Money Order",
    why: "inst 1604, doc 735: under \"Stop Payment Fee:\", \"o Money Order | $10.00\"" },
  // UAT's paid report snapshot (Oct 9): card re-issues filed as ATM fees.
  { feePublishedId: 46752, from: "atm_non_network", amount: 4, to: "card_replacement", name: "Debit/ATM Card Reissuance",
    why: "inst 6371, doc 3645: \"Debit/ATM Card Reissuance | $4.00 each\"" },
  { feePublishedId: 16698, from: "atm_non_network", amount: 10, to: "card_replacement", name: "ATM/Check Card Re-issuance",
    why: "inst 338, doc 14541: \"ATM/Check Card Re-issuance | $10 /each\" (a card replacement, not an ATM use fee)" },
  // Broken-figure names (PR 961 dry read, Oct 9): Knox kept a neighbouring cell or a mis-encoded
  // figure in the name. Each re-read against its stored text; the price is right.
  { feePublishedId: 53034, from: "check_image", amount: 1, to: "counter_check", name: "Counter Draft (check) (limit 8per month)",
    why: "inst 8511, doc 13054: \"Counter Draft (check) (limit 8per month) ... $1.00 each\"; \"Statement Copies\" was the line above" },
  { feePublishedId: 56385, from: "monthly_maintenance", amount: 2, to: "night_deposit", name: "Night Depository Service Monthly Fee (earnings credit available)",
    why: "inst 1445, doc 17118: under \"NIGHT DEPOSITORY SERVICE\", \"Monthly Fee (earnings credit available) | $2.00\"" },
  // Renames in place: the price and category are right, the name carries a broken figure.
  // 21141 and 77918 are returned mail (#1398): renamed in place under account research while
  // `RESEARCH_SPLIT_LIVE` is off, renamed and moved to returned mail once it is on.
  { feePublishedId: 21141, from: "account_research", amount: 5, to: researchSplitTarget("returned_mail"), name: "Returned Statement Fee",
    why: "inst 8138, doc 12676: \"Returned Statement Fee $5.00 per statement\"; the mailed statement fee before it was glued on" },
  { feePublishedId: 77918, from: "account_research", amount: 5, to: researchSplitTarget("returned_mail"), name: "Return Mail Fee (no forwarding)",
    why: "inst 8511, doc 13054: \"Return Mail Fee (no forwarding) ... $5.00\"" },
  { feePublishedId: 97560, from: "nsf", amount: 30, to: "nsf", name: "Non-Sufficient Funds",
    why: "inst 6272, doc 8005: \"Non-Sufficient Funds ... $30/item\"; the ATM line before it was glued on" },
  { feePublishedId: 98064, from: "dormant_account", amount: 5, to: "dormant_account", name: "Inactive Account",
    why: "inst 8511, doc 13054: \"Inactive Account (after [months unreadable] of inactivity) ... $5.00/month\"" },  // UAT, Oct 9: real fees carrying a sentence fragment as their name, each under a pending
  // takedown from another check. Named from their own line; the next check that reads them clears it.
  { feePublishedId: 96164, from: "monthly_maintenance", amount: 2.5, to: "atm_non_network",
    name: "Non-Westamerica ATM withdrawal (balance requirement not met)",
    oldName: "balance requirement to avoid the monthly service charge is met. Otherwise, a fee of",
    why: "Westamerica (250), doc 17065: \"Non-Westamerica ATM Withdrawals: ... Otherwise, a fee of $2.50 per posted withdrawal\"" },
  { feePublishedId: 61848, from: "minimum_balance", amount: 2, to: "minimum_balance",
    name: "Minimum balance fee (minimum daily balance of $5)",
    oldName: "in your account to avoid a minimum balance fee of",
    why: "inst 6026, doc 18314: \"You must maintain a minimum daily balance of $5 in your account to avoid a minimum balance fee of $2\"" },
  { feePublishedId: 98747, from: "monthly_maintenance", amount: 15, to: "monthly_maintenance",
    name: "Service charge (balance falls below $1,000.00)",
    oldName: "Minimum balance to avoid imposition of fees - A service charge fee of",
    why: "inst 2094, doc 22814: \"If your balance falls below $1,000.00 on any day ... we will impose a service charge fee of $15.00\"" },
  // UAT, Oct 9: returned-check fees filed as nsf beside the schedule's own NSF line, which the
  // guard's schedule_contradicts check takes down. A returned check is a deposited item return.
  { feePublishedId: 107960, from: "nsf", amount: 25, to: "deposited_item_return", name: "Return Check Fee",
    why: "inst 7815, doc 18733: \"Return Check Fee | $25.00\" (NSF Deposit Fee $30 is its own line)" },
  { feePublishedId: 108035, from: "nsf", amount: 25, to: "deposited_item_return", name: "Returned Item",
    why: "inst 5883, doc 19408: \"Returned Item | $25.00 Per Item\" below \"NSF | $25.00 Per Item\"" },
  { feePublishedId: 108132, from: "nsf", amount: 30, to: "deposited_item_return", name: "Returned Check",
    why: "inst 5902, doc 21925: \"Returned Check | $30.00 | each\"" },
  // UAT's 13:41 sample (Oct 9): a box rental's late fee filed as a loan late fee.
  { feePublishedId: 92156, from: "late_payment", amount: 10, to: "safe_deposit_box",
    name: "Safe Deposit Box Late Payment Fee - if payment is not made within 60 days of due date",
    why: "inst 1638, doc 22021: under \"Safe Deposit Boxes\", \"Late Payment Fee - if payment is not made within 60 days of due date, late fee will apply | $10.00\"" },
  // #1299 (James approved, Oct 14): names that open on a price's cut cents ("00 ", "00/item "); the
  // price and category are right. Each is renamed in place to its line's own words. A rename that
  // matches a live twin (same bank, category and price) makes the two exact repeats, and the duplicate
  // collapse closes one (`duplicate of #<kept id>`). 49175 and 29166 also carry a wrong amount (#1310).
  { feePublishedId: 49593, from: "wire_domestic_outgoing", amount: 25, to: "wire_domestic_outgoing", name: "Wire transfers – outgoing Domestic – U S dollar",
    why: "inst 303, doc 8040: \"Wire transfers – outgoing / Domestic – U S dollar | $25 00\"" },
  { feePublishedId: 49594, from: "wire_domestic_incoming", amount: 25, to: "wire_domestic_incoming", name: "Wire transfers – incoming Domestic – U S dollar",
    why: "inst 303, doc 8040: \"Wire transfers – incoming / Domestic – U S dollar | $25 00\"" },
  { feePublishedId: 49597, from: "dormant_account", amount: 4, to: "dormant_account", name: "Inactive accounts (monthly after three months with no activity)",
    why: "inst 303, doc 8040: \"Inactive accounts (monthly after three months with no activity) $4 00\"" },
  { feePublishedId: 49607, from: "safe_deposit_box", amount: 75, to: "safe_deposit_box", name: "Lost key fee",
    why: "inst 303, doc 8040: \"Lost key fee | $75 00\"" },
  { feePublishedId: 49608, from: "safe_deposit_box", amount: 10, to: "safe_deposit_box", name: "Safe Deposit Box late payment fee",
    why: "inst 303, doc 8040: \"Safe Deposit Box late payment fee | $10 00\"" },
  { feePublishedId: 49622, from: "deposited_item_return", amount: 35, to: "deposited_item_return", name: "Deposited items returned Checks written by accountholder",
    why: "inst 303, doc 8040: \"Deposited items returned / Checks written by accountholder | $35 00\"" },
  { feePublishedId: 97433, from: "account_research", amount: 25, to: "account_research", name: "Account reconciliation/research, per hour",
    why: "inst 303, doc 8040: \"Account reconciliation/research, per hour | $25 00\"" },
  { feePublishedId: 97442, from: "nsf", amount: 35, to: "nsf", name: "Returned Item charge",
    why: "inst 303, doc 8040: \"Returned Item charge | $35 00\"" },
  { feePublishedId: 42051, from: "nsf", amount: 29, to: "nsf", name: "Non-Sufficient Funds",
    why: "inst 6636, doc 6817: \"Non-Sufficient Funds ... $29\"; \"00/hour\" is the research fee's unit on the line before" },
  { feePublishedId: 14289, from: "dormant_account", amount: 10, to: "dormant_account", name: "Inactive Share Account Fee No activity for 12 months",
    why: "inst 6636, doc 12872: \"Inactive Share Account Fee3\" over \"No activity fo r 12 months ……… $10. 00/m onth\"; the 3 is a footnote mark" },
  { feePublishedId: 49173, from: "early_closure", amount: 25, to: "early_closure", name: "Early Checking Account Closure Fee 2 Within first 6 months",
    why: "inst 6636, doc 12872: \"Early Checking Account Closure Fee 2 Within first 6 months ... $25\"" },
  { feePublishedId: 29160, from: "nsf", amount: 25, to: "nsf", name: "Non-Sufficient Funds",
    why: "inst 7517, doc 13851: \"Non-Sufficient Funds $25\"" },
  { feePublishedId: 29161, from: "overdraft", amount: 25, to: "overdraft", name: "Courtesy Pay",
    why: "inst 7517, doc 13851: \"Courtesy Pay $25\"" },
  { feePublishedId: 29164, from: "wire_domestic_incoming", amount: 10, to: "wire_domestic_incoming", name: "Wire Transfer – Incoming",
    why: "inst 7517, doc 13851: \"Wire Transfer – Incoming $10\"; \"/wire\" is the price's unit" },
  { feePublishedId: 29172, from: "stop_payment", amount: 22, to: "stop_payment", name: "Stop Payment",
    why: "inst 7517, doc 13851: \"Stop Payment $22\"" },
  { feePublishedId: 29175, from: "ira_termination", amount: 25, to: "ira_termination", name: "IRA Closing",
    why: "inst 7517, doc 13851: \"IRA Closing $25\"" },
  { feePublishedId: 29176, from: "garnishment_levy", amount: 35, to: "garnishment_levy", name: "Levy or Garnishment",
    why: "inst 7517, doc 13851: \"Levy or Garnishment $35\"" },
  { feePublishedId: 91980, from: "dormant_account", amount: 10, to: "dormant_account", name: "Inactivity Fee after 12 months",
    why: "inst 7517, doc 13851: \"Inactivity Fee after 12 months $10\"" },
  { feePublishedId: 92004, from: "collection_item", amount: 25, to: "collection_item", name: "Foreign Check Dep – Int’l Collections",
    why: "inst 7517, doc 13851: \"Foreign Check Dep – Int’l Collections $25\"" },
  { feePublishedId: 24188, from: "nsf", amount: 35, to: "nsf", name: "Nonsufficient funds",
    why: "inst 8629, doc 6231: \"Nonsufficient funds | $35 00\"; \"00 per month\" is the dormant fee's price before it; doc 13904 prints the same line (46888)" },
  { feePublishedId: 24189, from: "od_protection_transfer", amount: 3, to: "od_protection_transfer", name: "Overdraft protection transfer",
    why: "inst 8629, doc 6231: \"Overdraft protection transfer | $3 00\"" },
  { feePublishedId: 46888, from: "nsf", amount: 35, to: "nsf", name: "Nonsufficient funds",
    why: "inst 8629, doc 13904: \"Nonsufficient funds $35\"; the same line as 24188 on doc 6231, so the duplicate collapse keeps one" },
  { feePublishedId: 88268, from: "wire_intl_outgoing", amount: 25, to: "wire_intl_outgoing", name: "Wire message (non-domestic)",
    why: "inst 8629, doc 6231: \"Wire message (non-domestic) | $25 00\"; \"00/hr\" is the research fee's unit before it" },
  { feePublishedId: 49603, from: "cashiers_check", amount: 5, to: "cashiers_check", name: "Official check",
    why: "inst 303, doc 8040: \"Official check, each | $5 00\"; 10238 is the same fee live under this name, so the duplicate collapse keeps one" },
  { feePublishedId: 62577, from: "early_closure", amount: 25, to: "early_closure", name: "Account closing fee",
    why: "inst 303, doc 8040: \"Account closing fee | $25 00\"; 9647 is the same fee live under this name, so the duplicate collapse keeps one" },
  { feePublishedId: 29162, from: "wire_domestic_outgoing", amount: 20, to: "wire_domestic_outgoing", name: "Wire Transfer – Outgoing Domestic",
    why: "inst 7517, doc 13851: \"Wire Transfer – Outgoing Domestic $20\"; 141769 is the same fee live under this name, so the duplicate collapse keeps one" },
  { feePublishedId: 91820, from: "counter_check", amount: 10, to: "counter_check", name: "Counter Checks (per book of 8)",
    why: "inst 7517, doc 13851: \"Counter Checks (per book of 8) $10\"; 141768 is the same fee live under this name, so the duplicate collapse keeps one" },
  { feePublishedId: 91981, from: "check_image", amount: 2, to: "check_image", name: "Copy of Draft",
    why: "inst 7517, doc 13851: \"Copy of Draft $2\"; 141770 is the same fee live under this name, so the duplicate collapse keeps one" },
  // #1304 (James approved, Oct 14): a courtesy pay (paid overdraft) row filed by its payment-channel cell.
  { feePublishedId: 88513, from: "bill_pay", amount: 32, to: "overdraft", name: "Courtesy Pay (Paid NSF) Check/ACH/Bill Pay Payment",
    why: "inst 5057, doc 6200: \"Courtesy Pay (Paid NSF) Check/ACH/Bill Pay Payment | $32.00/item\"; Knox named the fee by the cell after the row heading, so \"Bill Pay\" filed it as bill pay (the bank's $32 Account Guardian line, 105896, is a separate overdraft fee)" },
  // #1196 (James approved, Oct 15, comment 6193649019 group 2): names that open on a row number, a
  // footnote or the cell before; the price and category are right. Each is renamed in place to its
  // line's own words. 131129 and 70319 keep their category; whether it is right is a separate question.
  { feePublishedId: 99578, from: "paper_statement", amount: 2, to: "paper_statement", name: "Mailed statement service charge",
    oldName: "13 Account will default to a mailed statement and a monthly",
    why: "inst 162, doc 33566: \"13 Account will default to a mailed statement and a monthly $2 mailed statement service charge will be charged ... per statement cycle\"; 13 is the footnote" },
  { feePublishedId: 97539, from: "safe_deposit_box", amount: 30, to: "safe_deposit_box", name: "Key Replacement",
    oldName: "12 consecutive months of: Key Replacement",
    why: "inst 223, doc 22645: \"(12 consecutive months of | Key Replacement | $30.00 each\"; the first cell is the row above" },
  { feePublishedId: 65410, from: "cashiers_check", amount: 5, to: "cashiers_check", name: "Official Bank Check",
    oldName: "36 months, 48 months, 60 months: Official Bank Check",
    why: "inst 390, doc 19295: \"36 months, 48 months, 60 months | Official Bank Check $5.00 per item\"; the first cell is a CD term column" },
  { feePublishedId: 65411, from: "stop_payment", amount: 25, to: "stop_payment", name: "Money Order Stop Payment",
    oldName: "18 Month Variable Rate IRA CD: Money Order Stop Payment",
    why: "inst 390, doc 19295: \"18 Month Variable Rate IRA CD | Money Order Stop Payment $25.00 per item\"" },
  { feePublishedId: 53490, from: "dormant_account", amount: 5, to: "dormant_account", name: "Inactive Account",
    oldName: "11 Inactive Account Inactive Account",
    why: "inst 472, doc 14163: \"11 Inactive Account Inactive Account: $5.00\"; 11 is a row number and the name is printed twice" },
  { feePublishedId: 68521, from: "check_image", amount: 3, to: "check_image", name: "Draft Photocopies",
    oldName: "12 posted and settled debit card transactions: Draft Photocopies",
    why: "inst 4610, doc 2442: \"12 posted and settled debit card transactions | • Draft Photocopies......$ 3.00 / Check\"" },
  { feePublishedId: 88066, from: "account_verification", amount: 10, to: "account_verification", name: "Verification of Deposit",
    oldName: "16 Verification of Deposit",
    why: "inst 4613, doc 20748: \"16 Verification of Deposit ...... $10.00\"; 16 is the row number" },
  { feePublishedId: 88067, from: "garnishment_levy", amount: 75, to: "garnishment_levy", name: "Processing Levies, Garnishments, Attachments, and other Legal Liens",
    oldName: "17 Processing Levies, Garnishments, Attachments, and other Legal Liens",
    why: "inst 4613, doc 20748: \"17 Processing Levies, Garnishments, Attachments, and other Legal Liens – Each....... $75.00\"" },
  { feePublishedId: 88068, from: "counter_check", amount: 0, to: "counter_check", name: "Starter/Temporary Checks – 2 Pages",
    oldName: "18 Starter/Temporary Checks – 2 Pages",
    why: "inst 4613, doc 20748: \"18 Starter/Temporary Checks – 2 Pages at No Charge\"" },
  { feePublishedId: 57548, from: "money_order", amount: 1.7, to: "money_order", name: "Money Order Fee for First Step Accounts",
    oldName: "12 Money Order Fee for First Step Accounts",
    why: "inst 5113, doc 2232: \"12 Money Order Fee for First Step Accounts $1.70.\"" },
  { feePublishedId: 108912, from: "dormant_account", amount: 12, to: "dormant_account", name: "Dormant Account (after first 12 months)",
    oldName: "31 Days of Interest: Dormant Account (after first 12 months)",
    why: "inst 7697, doc 24596: \"or Less | 31 Days of Interest | Dormant Account (after first 12 months) | $12.00/year\"" },
  { feePublishedId: 131129, from: "atm_non_network", amount: 2, to: "atm_non_network", name: "ATM Transactions at DFCU ATM (Local ATM)",
    oldName: "15 free ATM transactions per month and 15 free balance inquiries per month; then",
    why: "inst 5100, doc 28876: \"ATM Transactions at DFCU ATM (Local ATM) | 15 free ATM transactions per month ... then $2.00/transaction\"; category kept as filed, its question is on #1196" },
  { feePublishedId: 70319, from: "dormant_account", amount: 2.95, to: "dormant_account", name: "VISA Gift Card Inactivity Fee",
    oldName: "12 Months of Inactivity",
    why: "inst 986, doc 20361: \"VISA Gift Card – Inactivity Fee after 12 Months of Inactivity $2.95/month\"; category kept as filed, its question is on #1196" },
  // #1512, #1513 (James approved, Oct 16 03:37 UTC, roadmap item 3.8): two schedule lines joined
  // into one name, or one line under the wrong category. Each price is right for the line named
  // here, read from the row's own stored text; the eighth joined row (142965) comes down instead
  // (hand-takedowns.ts). Undo: rename or re-file back to `oldName` under `from`; the run event and
  // `pipeline_feedback` row keep both.
  { feePublishedId: 139453, from: "rush_card", amount: 10, to: "card_replacement", name: "Credit or debit card replacement fee",
    oldName: "Credit or debit card replacement fee Rush Order Fee",
    why: "#1512, inst 6228, doc 30968: \"Card Replacement / Credit or debit card replacement fee Rush Order Fee / $10 per card; $45 per card\"; $10 is the replacement, the rush order is $45" },
  { feePublishedId: 61871, from: "bill_pay", amount: 2.99, to: "bill_pay", name: "Bill Pay Gift Check",
    oldName: "Returned Wire Fee Varies Bill Pay Gift Check ………………………………",
    why: "#1512, inst 6940, doc 18323: \"Returned Wire Fee Varies Bill Pay Gift Check ……… $2.99\"; the returned wire fee \"Varies\", the $2.99 is the gift check" },
  { feePublishedId: 73876, from: "safe_deposit_box", amount: 10, to: "safe_deposit_box", name: "Key Deposit Fee",
    oldName: "Change of Lock Fee: Current locksmith charges Drilling of Box Fee: Current locksmith charges Key Deposit Fee",
    why: "#1512, inst 8567, doc 13490: \"• Change of Lock Fee: Current locksmith charges • Drilling of Box Fee: Current locksmith charges • Key Deposit Fee: $10.00\"; only the key deposit is $10" },
  { feePublishedId: 14294, from: "monthly_maintenance", amount: 5, to: "monthly_maintenance", name: "Renew Spend Account: Monthly Service Charge",
    oldName: "Renew Spend Account Monthly Service Charge ………………………..…………… Student Spend Account Monthly Service Charge …………………………………….",
    why: "#1512, inst 6636, doc 12872: \"Renew Spend Account* | …\" then \"Monthly Service Charge ……… $5.00\"; the Student Spend line below is $0.00 (live as 99385)" },
  { feePublishedId: 70046, from: "monthly_maintenance", amount: 12, to: "monthly_maintenance", name: "Fresh Start Checking: Monthly maintenance fee with Direct Deposit",
    oldName: "Fresh Start Checking: Monthly maintenance fee with Direct Deposit. Monthly maintenance fee w/o Direct Deposit",
    why: "#1512, inst 7006, doc 27023: \"Fresh Start Checking* | Monthly maintenance fee with Direct Deposit. Monthly maintenance fee w/o Direct Deposit | $12.00/mo $15.00/mo\"; $12 is with direct deposit" },
  { feePublishedId: 139131, from: "ira_termination", amount: 5, to: "ira_termination", name: "IRA Closure Fee",
    oldName: "IRA Closure Fee IRA Minimum Balance Fee",
    why: "#1512, inst 4554, doc 30829: \"IRA Closure Fee IRA Minimum Balance Fee8 | $5.00 $4.00/month\"; the closure is $5, the minimum balance fee $4/month" },
  { feePublishedId: 43277, from: "account_research", amount: 15, to: researchSplitTarget("returned_mail"), name: "Undeliverable Mail",
    oldName: "Undeliverable Mail ……...………………………….......……....…",
    why: "#1513, inst 2657, doc 916: \"Undeliverable Mail ……… $15 | Account Reconciliation ……… $35 / One-time fee upon return of 2nd undeliverable item\"; returned mail, renamed under account research while the #1398 split is off" },
  { feePublishedId: 63055, from: "wire_domestic_outgoing", amount: 35, to: "wire_intl_outgoing", name: "Wire Trans. (Intern. Outgoing)",
    oldName: "Wire Trans. (Intern. Outgoing) ………",
    why: "#1513, inst 5653, doc 18876: \"Wire Trans. (Intern. Outgoing) ………...$35.00 per Wire\", an international wire; the domestic one is \"Wire Trans. (Dom. Outgoing) …$18.00 per Wire\" (live as 63054)" },
  // #1655 (read-only, Oct 16): two Navy Federal home equity line fees filed as deposit fees, so they
  // showed in the consumer overdraft guide. Each price is right; both are loan fees, so they move to
  // other lending (the 50 have no returned-loan-payment type). Both keep their printed names, so neither
  // carries an `oldName`. Undo: re-file back under `from`; the run event and `pipeline_feedback` row keep both.
  { feePublishedId: 122342, from: "nsf", amount: 29, to: "other_lending_fee", name: "Home Equity Line Check returned (due to non-sufficient funds)",
    why: "#1655, inst 4956, doc 26712: under \"Equity Loan\", \"Home Equity Line Check returned (due to non-sufficient funds) | $29.00\"; a home equity line fee, not a deposit NSF (checking's own NSF line is \"No charge\", live as 122347)" },
  { feePublishedId: 122343, from: "monthly_maintenance", amount: 25, to: "other_lending_fee", name: "Tax Service Charge",
    why: "#1655, inst 4956, doc 26712: under \"Equity Loan\", \"Tax Service Charge | $25.00\"; a home equity loan fee, not a monthly maintenance fee" },
  // #1659 (read-only, Oct 16): U.S. Bank's $4.95 row named no account; the page prints it under
  // "Safe Debit account". Renamed in place once (`oldName`); price and category are right.
  { feePublishedId: 102970, from: "monthly_maintenance", amount: 4.95, to: "monthly_maintenance", name: "Safe Debit account Monthly Maintenance Fee",
    oldName: "Monthly Maintenance Fee with no minimum balance requirement",
    why: "#1659, inst 5, doc 23628: \"Safe Debit account2\" / \"$4.95 Monthly Maintenance Fee with no minimum balance requirement\"" },
];

interface HandRow {
  fee_published_id: number | string;
  fee_verified_id: number | string;
  institution_id: number | string;
  source_document_id: number | string | null;
  canonical_fee_key: string;
  fee_name: string | null;
  amount: number | string | null;
}

export interface HandMove {
  refile: HandRefile;
  feeVerifiedId: number;
  institutionId: number;
  sourceDocumentId: number | null;
  oldName: string;
  /** The category the fee is under now: `from`, or `to` when another check already moved it. */
  currentKey: string;
}

/**
 * The hand re-files that still apply: the fee is live, still under its old category at its
 * listed price, and the new category accepts the new name. Pure.
 */
export function planHandRefiles(
  rows: HandRow[],
  refiles: readonly HandRefile[] = HAND_REFILES,
): HandMove[] {
  const moves: HandMove[] = [];
  for (const row of rows) {
    const refile = refiles.find((entry) => entry.feePublishedId === Number(row.fee_published_id));
    const amount = amountOf(row.amount);
    if (!refile || amount == null || Math.abs(amount - refile.amount) >= 0.005) continue;
    const movedUnfixed = refile.oldName != null && row.canonical_fee_key === refile.to && (row.fee_name ?? "") === refile.oldName;
    if (row.canonical_fee_key !== refile.from && !movedUnfixed) continue;
    // A rename in place (from == to) is done once the live name reads as listed, and, when the
    // entry names the old name, never touches a fee whose name has changed since.
    if (refile.from === refile.to && (row.fee_name ?? "").trim() === refile.name) continue;
    if (refile.from === refile.to && refile.oldName != null && (row.fee_name ?? "") !== refile.oldName) continue;
    if (!passesDarwinChecks(refile.to, refile.name, amount)) continue;
    moves.push({
      refile,
      feeVerifiedId: Number(row.fee_verified_id),
      institutionId: Number(row.institution_id),
      sourceDocumentId: row.source_document_id == null ? null : Number(row.source_document_id),
      oldName: row.fee_name ?? "",
      currentKey: row.canonical_fee_key,
    });
  }
  return moves;
}

/**
 * Hand-fixed fees that still carry the rules re-check's pending takedown from before their
 * rename (61848, 98747, Oct 9): the re-check reads a document only now and then, so its own
 * clear can come after the archive is due. A fee here passes the same test the re-check's second
 * look applies (its name and price trace in its own text, and the category guard accepts the
 * name), so the same second look clears it. A fee not yet fixed, or one that fails, is left alone.
 */
export function handFixedPassing(rows: HandRow[], texts: Map<number, string>, refiles: readonly HandRefile[] = HAND_REFILES): number[] {
  const passing: number[] = [];
  for (const row of rows) {
    const refile = refiles.find((entry) => entry.feePublishedId === Number(row.fee_published_id));
    const amount = amountOf(row.amount);
    if (!refile || amount == null || row.canonical_fee_key !== refile.to || (row.fee_name ?? "").trim() !== refile.name) continue;
    const text = row.source_document_id == null ? undefined : texts.get(Number(row.source_document_id));
    if (!text) continue;
    const traced = checkFeeAgainstSource(text, refile.name, amount, ".", refile.to);
    if ((traced.ok || traced.reason === "tiered_fee") && checkFeeCategory(refile.to, refile.name).ok) passing.push(refile.feePublishedId);
  }
  return passing;
}

async function selectHandRows(db: SqlTag, institutionId?: number): Promise<HandRow[]> {
  return db<HandRow[]>`
    SELECT fp.fee_published_id, fp.lineage_ref AS fee_verified_id, fp.institution_id, fr.source_document_id,
           fp.canonical_fee_key, fp.fee_name, fp.amount
      FROM published_fee_records fp
      LEFT JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
      LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
     WHERE fp.fee_published_id = ANY(${HAND_REFILES.map((refile) => refile.feePublishedId)}::bigint[])
       AND fp.rolled_back_at IS NULL
       AND (${institutionId ?? null}::bigint IS NULL OR fp.institution_id = ${institutionId ?? null}::bigint)
  `;
}

async function applyHandMoves(db: SqlTag, moves: HandMove[], runId: number): Promise<number> {
  if (moves.length === 0) return 0;
  const updated = await db<{ fee_published_id: number | string }[]>`
    UPDATE published_fee_records fp
       SET canonical_fee_key = v.to_key, fee_name = v.new_name
      FROM unnest(${moves.map((move) => move.refile.feePublishedId)}::bigint[], ${moves.map((move) => move.currentKey)}::text[],
                  ${moves.map((move) => move.refile.to)}::text[], ${moves.map((move) => move.refile.name)}::text[])
           AS v(fee_published_id, from_key, to_key, new_name)
     WHERE fp.fee_published_id = v.fee_published_id
       AND fp.canonical_fee_key = v.from_key
       AND fp.rolled_back_at IS NULL
    RETURNING fp.fee_published_id
  `;
  const done = new Set(updated.map((row) => Number(row.fee_published_id)));
  const applied = moves.filter((move) => done.has(move.refile.feePublishedId));
  if (applied.length === 0) return 0;
  await db`
    UPDATE verified_fee_observations fv
       SET canonical_fee_key = v.to_key
      FROM unnest(${applied.map((move) => move.feeVerifiedId)}::bigint[], ${applied.map((move) => move.currentKey)}::text[],
                  ${applied.map((move) => move.refile.to)}::text[]) AS v(fee_verified_id, from_key, to_key)
     WHERE fv.fee_verified_id = v.fee_verified_id
       AND fv.canonical_fee_key = v.from_key
  `;
  if (await feedbackSchemaReady(db)) await recordFeedback(db, applied.map((move) => handFeedback(move, runId)));
  // One event per run that names every row moved and its after-state (#1196).
  await db`
    INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
    VALUES (
      ${runId}, ${`${TAXONOMY_FOLD_CHECK}.hand_refile`}, 'completed',
      ${`Re-filed or renamed ${applied.length} live fee(s) by hand (HAND_REFILES)`},
      ${JSON.stringify({
        refiled: applied.map((move) => ({
          fee_published_id: move.refile.feePublishedId,
          from_key: move.currentKey,
          to_key: move.refile.to,
          amount: move.refile.amount,
          old_name: move.oldName,
          new_name: move.refile.name,
        })),
      })}::jsonb
    )
  `;
  return applied.length;
}

function handFeedback(move: HandMove, runId: number): FeedbackRow {
  const { refile } = move;
  return {
    aboutStage: "publish",
    aboutStrategy: TAXONOMY_FOLD_CHECK,
    aboutVersion: FOLD_RULES_VERSION,
    // Knox read a neighbouring cell as the name: a wrong read, logged with the page's own line.
    signal: "wrong",
    kind: TAXONOMY_FOLD_KIND,
    reportedBy: "gutenberg",
    checkName: TAXONOMY_FOLD_CHECK,
    institutionId: move.institutionId,
    sourceDocumentId: move.sourceDocumentId,
    feeVerifiedId: move.feeVerifiedId,
    feePublishedId: refile.feePublishedId,
    canonicalFeeKey: refile.to,
    amount: refile.amount,
    weight: 0,
    evidence: { from: move.currentKey, to: refile.to, rule: "hand_refile", old_name: move.oldName, new_name: refile.name, why: refile.why },
    runId,
    dedupeKey: `${TAXONOMY_FOLD_CHECK}:hand:pub:${refile.feePublishedId}`,
  };
}

async function rollBackNoHome(db: SqlTag, batchId: string, fees: FoldNoHome[]): Promise<number> {
  let rolledBack = 0;
  for (let start = 0; start < fees.length; start += WRITE_CHUNK) {
    const chunk = fees.slice(start, start + WRITE_CHUNK);
    const updated = await db`
      UPDATE published_fee_records fp
         SET rolled_back_at = NOW(),
             rolled_back_by_batch_id = ${batchId},
             rolled_back_reason = v.reason
        FROM unnest(${chunk.map((fee) => fee.feePublishedId)}::bigint[],
                    ${chunk.map((fee) => `${TAXONOMY_FOLD_REASON_PREFIX}${fee.reason}`)}::text[]) AS v(fee_published_id, reason)
       WHERE fp.fee_published_id = v.fee_published_id
         AND fp.rolled_back_at IS NULL
      RETURNING fp.fee_published_id
    `;
    rolledBack += updated.length;
  }
  return rolledBack;
}

export interface TaxonomyFoldResult {
  scanned: number;
  /** Fees re-filed (live and verified-only), by retired key and destination. */
  moved: number;
  movedLive: number;
  byRoute: Record<string, number>;
  /** Live fees with no home: first look logged this run, still live. */
  noHomeFlagged: number;
  noHomeWaiting: number;
  /** Live fees with no home taken down after their second look. */
  noHomeRolledBack: number;
  /** Past their second look but kept live while `TAXONOMY_FOLD_ARCHIVE_NO_HOME` is off. */
  noHomeHeld: number;
  unplacedVerified: number;
  feedbackRows: number;
  /** Live fees re-filed by hand (`HAND_REFILES`); a dry run counts those it would move. */
  handRefiled: number;
  /** Hand-fixed fees whose rules re-check pending takedown was cleared (`handFixedPassing`). */
  handFlagsCleared: number;
  dryRun: boolean;
  rulesVersion: number;
  /** A sample of the takedowns, for the step's detail. */
  noHomeSample: Array<Pick<FoldNoHome, "feePublishedId" | "canonicalFeeKey" | "feeName" | "amount" | "reason">>;
  /**
   * While `RESEARCH_SPLIT_LIVE` is off: what turning it on would move out of account research,
   * by route with samples (a dry run; nothing written). Null once it is on or when the read fails.
   */
  pendingResearchSplit: ResearchSplitPreview | null;
}

/** Runs the fold. A dry run reports what it would move and take down and writes nothing. */
export async function foldRetiredCategories(
  db: SqlTag,
  options: { runId: number; dryRun: boolean; institutionId?: number; researchSplitFullCount?: boolean },
): Promise<TaxonomyFoldResult> {
  const base: TaxonomyFoldResult = {
    scanned: 0,
    moved: 0,
    movedLive: 0,
    byRoute: {},
    noHomeFlagged: 0,
    noHomeWaiting: 0,
    noHomeRolledBack: 0,
    noHomeHeld: 0,
    unplacedVerified: 0,
    feedbackRows: 0,
    handRefiled: 0,
    handFlagsCleared: 0,
    dryRun: options.dryRun,
    rulesVersion: FOLD_RULES_VERSION,
    noHomeSample: [],
    pendingResearchSplit: null,
  };
  let handMoves: HandMove[] = [];
  try {
    const handRows = await inSavepoint(db, (scope) => selectHandRows(scope, options.institutionId));
    handMoves = planHandRefiles(handRows);
  } catch (error) {
    console.error("taxonomy fold hand re-file read failed:", error);
  }
  // The research split's dry run, every step while its switch is off (#1398), capped at
  // RESEARCH_SPLIT_PREVIEW_LIMIT rows unless the step asks for the full count. Read only.
  if (!RESEARCH_SPLIT_LIVE) {
    try {
      const fullCount = options.researchSplitFullCount === true;
      const limit = fullCount ? null : RESEARCH_SPLIT_PREVIEW_LIMIT;
      const researchRows = await inSavepoint(db, (scope) => selectResearchSplitRows(scope, options.institutionId, limit));
      base.pendingResearchSplit = {
        switchName: "RESEARCH_SPLIT_LIVE",
        live: false,
        fullCount,
        capped: limit != null && researchRows.length >= limit,
        ...previewResearchSplit(researchRows),
      };
    } catch (error) {
      console.error("taxonomy fold research split preview failed:", error);
    }
  }
  if (options.dryRun) base.handRefiled = handMoves.length;
  else if (handMoves.length > 0) {
    base.handRefiled = await inSavepoint(db, (scope) => applyHandMoves(scope, handMoves, options.runId));
    if (base.handRefiled > 0) invalidatePublicReadCache();
  }
  try {
    const handRows = await inSavepoint(db, (scope) => selectHandRows(scope, options.institutionId));
    const handDocuments = [...new Set(handRows.filter((row) => row.source_document_id != null).map((row) => Number(row.source_document_id)))];
    const passing = handFixedPassing(handRows, await inSavepoint(db, (scope) => loadTexts(scope, handDocuments)));
    if (passing.length > 0) {
      const look = await secondLook(db, { check: RULES_RECHECK_CHECK, runId: options.runId, failing: [], passing, dryRun: options.dryRun });
      base.handFlagsCleared = look.cleared;
      if (look.cleared > 0 && !options.dryRun) invalidatePublicReadCache();
    }
  } catch (error) {
    console.error("taxonomy fold hand flag clear failed:", error);
  }
  let rows: FoldRow[];
  let texts: Map<number, string>;
  try {
    rows = await inSavepoint(db, (scope) => selectRetiredRows(scope, options.institutionId));
    const documents = [
      ...new Set(
        rows
          .filter((row) => row.source_document_id != null && needsContext(row.canonical_fee_key, row.fee_name))
          .map((row) => Number(row.source_document_id)),
      ),
    ];
    texts = await inSavepoint(db, (scope) => loadTexts(scope, documents));
  } catch (error) {
    console.error("taxonomy fold read failed:", error);
    return base;
  }
  if (rows.length === 0) return base;

  const plan = planFold(rows, texts);
  const byRoute: Record<string, number> = {};
  for (const move of plan.moves) byRoute[`${move.from}->${move.to}`] = (byRoute[`${move.from}->${move.to}`] ?? 0) + 1;
  for (const fee of plan.noHome) byRoute[`${fee.canonicalFeeKey}->none`] = (byRoute[`${fee.canonicalFeeKey}->none`] ?? 0) + 1;

  const look = await secondLook(db, {
    check: TAXONOMY_FOLD_CHECK,
    runId: options.runId,
    failing: plan.noHome,
    dryRun: options.dryRun,
  });
  const result: TaxonomyFoldResult = {
    ...base,
    scanned: rows.length,
    moved: plan.moves.length,
    movedLive: plan.moves.filter((move) => move.feePublishedId != null).length,
    byRoute,
    noHomeFlagged: look.flagged,
    noHomeWaiting: look.waiting,
    unplacedVerified: plan.unplacedVerified,
    noHomeSample: plan.noHome.slice(0, 25).map(({ feePublishedId, canonicalFeeKey, feeName, amount, reason }) => ({
      feePublishedId,
      canonicalFeeKey,
      feeName,
      amount,
      reason,
    })),
  };
  if (!TAXONOMY_FOLD_ARCHIVE_NO_HOME) result.noHomeHeld = look.confirmed.length;
  if (options.dryRun) {
    result.noHomeRolledBack = TAXONOMY_FOLD_ARCHIVE_NO_HOME ? look.confirmed.length : 0;
    return result;
  }

  const applied = await inSavepoint(db, (scope) => applyMoves(scope, plan.moves));
  result.movedLive = applied.published;
  if (plan.moves.length > 0 && (await feedbackSchemaReady(db))) {
    result.feedbackRows = await inSavepoint(db, (scope) =>
      recordFeedback(scope, plan.moves.map((move) => moveFeedback(move, options.runId))),
    );
  }
  if (TAXONOMY_FOLD_ARCHIVE_NO_HOME) {
    result.noHomeRolledBack = await inSavepoint(db, (scope) =>
      rollBackNoHome(scope, `taxonomy-fold-run-${options.runId}`, look.confirmed),
    );
  }
  if (applied.published > 0 || result.noHomeRolledBack > 0) invalidatePublicReadCache();
  return result;
}
