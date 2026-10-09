import { sql } from "@/lib/data-store/connection";
import { learningSchemaReady, recordAttempt } from "@/lib/agents/learning/attempts";
import type { AttemptOutcome } from "@/lib/agents/learning/outcomes";
import { normalizeStateCode } from "@/lib/agents/state-lane-memory";
import {
  emptyPaidPassResult,
  PAID_PASS_MODELS,
  paidModelCall,
  paidResponseJson,
  type PaidMessageCreator,
  type PaidPassResult,
  type PaidStepOptions,
} from "@/lib/agents/paid-pass";
import { feedbackSchemaReady } from "@/lib/agents/learning/feedback";
import { inSavepoint } from "@/lib/agents/savepoint";
import { checkFeeCategory, neighbourCategories, refileCategory } from "@/lib/fee-category-guard";
import { PER_ITEM_WORDING, PERIODIC_WORDING, wordsAfterPrice } from "@/lib/fee-frequency";
import { CANONICAL_KEY_MAP, DISPLAY_NAMES } from "@/lib/fee-taxonomy";

import {
  DARWIN_RELEASE_ACTS,
  DARWIN_RELEASE_STRATEGY,
  releaseHeldFee,
  scheduleContext,
  type HeldFeeRow,
} from "./release-held";
import { isCutoffName } from "@/lib/agents/knox/name-retidy";

import { loadReviewMisses } from "./verdict-score";
import { loadSourceTexts, rawFeeFingerprint } from "./verify";

type SqlTag = typeof sql;

/**
 * The last gate before a held fee is released (release-held.ts): Claude reads each fee
 * the free checks would release beside the line of the bank's schedule it came from, and
 * says whether it is a price the bank charges, whether it belongs in the category it was
 * filed under, and whether the amount is the price (not a cap, limit, threshold or a
 * misread number). Only a fee that passes all three is released.
 *
 * Runs in Darwin's `verify-paid` provider step, before the layer 3 adjudicator, with
 * every call budget-checked and cost-logged under Darwin's own policy (`agent:darwin`).
 * With DARWIN_RELEASE_ACTS off it records verdicts only.
 */
// Version 5 (2026-10-07): a hand check of 20 v4 verdicts found 3 wrong releases: a stop
// payment's removal filed as a stop payment, an expedited cashier's check filed at the
// cashier's check price, and "Cost plus $8" read as an $8 price. The prompt now names all three.
// Version 6 (2026-10-07): a hand check of 20 v5 passes found two overdraft-protection transfers
// ("Overdraft Protection Fee $5", "Service Overdraft Fee | Transfer from Savings to Checking")
// passed as overdraft, and a sentence fragment passed as a fee name. Each item now lists the
// categories its own category's fees are most often re-filed to, and a fee whose name and line
// re-file it there by the category guard's own rules (`refileCategory`) never passes.
// Version 7 (2026-10-07): a hand check of 20 v6 passes found 17 right. "Smart Safe Deposit
// Correction Notice" (a business cash device) passed as safe deposit box rent, a box price read
// with its footnote marker ("$651" among $85 and $100 boxes) passed, and a bare "overdrafts | $5.00"
// from jumbled rows passed. The prompt now names all three.
// Version 11 (2026-10-08): releases on (James, "Turn on", 02:16 UTC). Same prompt and checks as
// v10; the bump has every held fee judged again with release on, since v10's 1,305 passes were
// recorded as verdicts only and a fee is reviewed once per version.
// Version 10 (2026-10-07): a hand check of 20 v9 passes found "Overnight Fee (Business Bill Pay)"
// passed as bill pay, the fourth premium-service miss since v5. A fee whose own name says it is the
// faster version of a service now never passes outside a premium category (`premiumServiceMisfiled`).
// Version 12 (2026-10-08): a hand check of 20 released v11 fees found "Monthly Fee $50.00" above
// "Night Deposit Bag $10.00" released as the account's monthly fee and a $5 "Returned check fee"
// released as NSF. A fee now stays held when today's category guard rejects its name, when a bare
// "Monthly Fee" sits among a business service's rows, or when a plain returned check or item under
// $10 is filed as NSF (`releaseHoldReason`).
// Version 13 (2026-10-08): a hand check of 20 released v12 fees found "/hr incl. reproduction"
// (Legal Process Compliance $20/hr) released as document reproduction, and "account research fee
// may apply)" (a $5 draft copy). A name cut from the middle of a line, starting with "/" or ending
// in an unopened ")", now stays held (`name_fragment`).
// Version 14 (2026-10-08): a hand check of 20 released v13 fees found a merchant's fee for a
// member's NSF check released as NSF, a $5 "Overdraft Protection Fee" beside a $25 Courtesy Pay
// fee released as overdraft, and an early-closure fee read as "$251 | 1" ($25, footnote 1). Those
// now stay held (`charged_to_merchant`, `small_overdraft_protection`, `footnote_in_price`).
// Version 15 (2026-10-08): James set the bar as the complete record, frequency included. "Excess
// activity charge - $5.00 each after 6" was released as monthly; a fee whose frequency says the
// opposite of its schedule line now stays held (`frequency_contradicts_line`).
// Version 16 (2026-10-08): the first 200-fee complete-record eval found frequency blank on 48% of
// live fees although the line said "each" or "per month", and 25 of 31 bad names were dot leaders,
// footnotes, bullet text, table headers or two-column glue. A released fee now takes its frequency
// from the words after its own price when they point one way (`frequencyFromLine`), and those name
// shapes stay held (`name_fragment`).
// Version 17 (2026-10-09): the eval's re-score left 25 wrong names, and Accuracy sent two more
// ("Inactive fee: This account may be subject to an Inactive fee of", "Charge Return Statement or
// Dormant Account Monthly Fee (...) | F"): names cut from a sentence or a table. A name with a
// cut-off shape (a list bullet "+", a glued column header, a sentence ending at its own price, a
// condition clause, a dangling "up to" / "per"; Knox's `isCutoffName`) now stays held
// (`name_fragment`); Knox's retidy v6 gives the live ones their tidy name.
export const DARWIN_RELEASE_REVIEW_STRATEGY = {
  strategy: "verify.release_review",
  version: 17,
} as const;
export const RELEASE_REVIEW_FEES_PER_CALL = 25;
const MAX_OUTPUT_TOKENS = 4_000;
const TRANSIENT_OUTCOMES = ["timeout", "network_error", "http_429", "http_5xx", "budget_blocked"];
const STOP_ERRORS = new Set(["ProviderBudgetBlockedError", "EmergencyStopActiveError", "ProviderCircuitOpenError"]);

export interface ReleaseReviewCandidate {
  row: HeldFeeRow;
  sourceLine: string;
  /** The rows around the line in the stored schedule (release-held `scheduleContext`). */
  sourceContext?: string | null;
}

export interface ReleaseReviewVerdict {
  isFee: boolean;
  categoryFits: boolean;
  amountIsPrice: boolean;
  reason: string | null;
}

export function reviewPasses(verdict: ReleaseReviewVerdict | undefined): boolean {
  return Boolean(verdict?.isFee && verdict.categoryFits && verdict.amountIsPrice);
}

/**
 * The category the guard's own re-file rules move a fee to when read with its schedule line
 * ("Service Overdraft Fee | Transfer from Savings to Checking: $5.00" is an overdraft-protection
 * transfer), or null when the line keeps it where it was filed.
 */
export function lineRefilesTo({ row, sourceLine }: ReleaseReviewCandidate): string | null {
  const key = row.held_canonical_fee_key;
  const refiled = refileCategory(key, `${row.fee_name ?? ""} ${sourceLine}`);
  return refiled && refiled !== key ? refiled : null;
}

/** Categories that are themselves the faster version of a service. */
const PREMIUM_CATEGORIES = new Set(["rush_card"]);
const PREMIUM_SERVICE = /\b(expedit\w*|rush|overnight|emergency|same[- ]day|next[- ]day|second[- ]day)\b/i;

/**
 * A faster or premium version of a service ("Overnight Fee (Business Bill Pay)") filed under the
 * service's own category. The prompt has said so since v5 and the model still passed them, so the
 * fee's own name now decides: such a fee stays held.
 */
export function premiumServiceMisfiled({ row }: Pick<ReleaseReviewCandidate, "row">): boolean {
  const key = row.held_canonical_fee_key;
  return !PREMIUM_CATEGORIES.has(key) && PREMIUM_SERVICE.test(row.fee_name ?? "");
}

const BARE_MONTHLY_NAME = /^\s*(monthly\s+)?(service\s+)?(fee|charge)\s*$/i;
const BUSINESS_SERVICE_ROWS = /(night deposit|deposit bag|lockbox|remote deposit|scanner|positive pay)/i;
const PLAIN_RETURNED_ITEM = /^\s*return(ed)?\s+(check|item)s?(\s+(fee|charge)s?)?\s*$/i;
/** NSF fees run $25-$35; a plain "Returned check fee" far below that is often a deposited check coming back. */
const SMALL_NSF_AMOUNT = 10;
/**
 * A name cut from the middle of a line ("/hr incl. reproduction", "account research fee may apply)"),
 * or text that is not a name: dot leaders or a footnote mark glued on ("Replacement ………", "00/item
 * Counter Checks"), a sentence or bullet fragment ("charge for each one-time debit", "Fees: o A
 * Minimum Balance Fee", "(for each overdraft item"), or a table header kept ("Garnishment / Levy: Fee").
 */
const NAME_FRAGMENT = /^\s*\/|^[^(]*\)\s*$|[.…]{3,}|(\.\s){3,}|^\s*\d+\s*\/|^\s*\(|^\s*[Ff]ees?:\s|\bo\s[A-Z]|:\s*[Ff]ee\s*$/;
/** A name that starts lowercase is a sentence cut from its line, unless it is a product spelled that way. */
const SENTENCE_START = /^\s*[a-z]/;
const LOWERCASE_PRODUCT_NAME = /^\s*e-?(statement|banking|bill)/i;

export function nameIsFragment(name: string): boolean {
  if (NAME_FRAGMENT.test(name) || isCutoffName(name)) return true;
  return SENTENCE_START.test(name) && !LOWERCASE_PRODUCT_NAME.test(name);
}

/** A fee the merchant or payee pays ("Merchant presenting NSF check from member"), not the member. */
const CHARGED_TO_MERCHANT = /\bmerchants?\b/i;
const MEMBER_OVERDRAFT_CATEGORIES = new Set(["nsf", "overdraft"]);
/**
 * "Overdraft Protection Fee $5" beside "Courtesy Pay Fee $25" is the transfer from a linked
 * account; overdraft fees run $25-$35. A name that also says the item is paid stays an overdraft.
 */
const OVERDRAFT_PROTECTION_NAME = /overdraft protection/i;
const PAID_ITEM_NAME = /(courtesy|paid|opt[- ]?in|privilege|bounce|presentment|honou?r)/i;
const SMALL_OVERDRAFT_AMOUNT = 15;
/**
 * A footnote mark printed onto the price: "$7.501" (a third decimal) on the page, or "$251 | 1"
 * where the mark after the price repeats the price's last digit ($25, footnote 1).
 */
const THIRD_DECIMAL_PRICE = /\$\d+\.\d{3}\b/;
const MARK_REPEATS_LAST_DIGIT = /\$\d*(\d)\s*\|\s*\1\b/;
const LAST_DIGIT_ONE_PRICE = /^\d+1$/;

const PERIODIC_FREQUENCIES = new Set(["monthly", "annual", "quarterly"]);
const PER_ITEM_FREQUENCIES = new Set(["per_item", "per_transaction", "per_occurrence"]);
/**
 * The fee's frequency says the opposite of its schedule line: "$5.00 each after 6" filed as
 * monthly, or "$5.00 per month" filed per item. The words after the fee's own price decide, so
 * "6 withdrawals included per month; ... $5.00 each" reads as each. Wording both ways stays undecided.
 */
export function frequencyContradictsLine(frequency: string | null | undefined, sourceLine: string, amount: number | null = null): boolean {
  if (!frequency || !sourceLine) return false;
  const words = wordsAfterPrice(sourceLine, amount);
  const perItem = PER_ITEM_WORDING.test(words);
  const periodic = PERIODIC_WORDING.test(words);
  if (perItem === periodic) return false;
  if (PERIODIC_FREQUENCIES.has(frequency)) return perItem;
  if (PER_ITEM_FREQUENCIES.has(frequency)) return periodic;
  return false;
}

/**
 * The frequency the fee's own line states after its price, when the wording points one way:
 * "$5.00 each" is per_item, "$5.00 per month" monthly. Null when the line says nothing or both.
 */
export function frequencyFromLine(sourceLine: string, amount: number | null): string | null {
  if (!sourceLine) return null;
  const words = wordsAfterPrice(sourceLine, amount);
  const perItem = PER_ITEM_WORDING.test(words);
  const periodic = PERIODIC_WORDING.test(words);
  if (perItem === periodic) return null;
  if (perItem) return "per_item";
  if (/\b(per quarter|quarterly)\b/i.test(words)) return "quarterly";
  if (/\b(per year|annual(ly)?|\/\s?(yr|year)|a year)\b/i.test(words)) return "annual";
  return "monthly";
}

export type ReleaseHoldReason =
  | "category_guard"
  | "business_service_monthly"
  | "small_returned_item"
  | "name_fragment"
  | "charged_to_merchant"
  | "small_overdraft_protection"
  | "footnote_in_price"
  | "frequency_contradicts_line";

/** True when the price was likely read with a footnote mark printed onto its last digit. */
export function footnoteInPrice(amount: number | null, sourceLine: string, sourceContext: string | null | undefined): boolean {
  if (THIRD_DECIMAL_PRICE.test(sourceLine) || MARK_REPEATS_LAST_DIGIT.test(sourceLine)) return true;
  // A page that prints marks onto its prices ("$7.501") makes any whole price ending in 1 suspect.
  return (
    amount != null &&
    Number.isInteger(amount) &&
    LAST_DIGIT_ONE_PRICE.test(String(amount)) &&
    THIRD_DECIMAL_PRICE.test(sourceContext ?? "")
  );
}

/**
 * Why a fee the model passed still stays held, or null. Each is a miss a hand check found after the
 * prompt already named it, so the fee's own name, amount and rows now decide.
 */
export function releaseHoldReason({
  row,
  sourceLine,
  sourceContext,
}: Pick<ReleaseReviewCandidate, "row" | "sourceContext"> & { sourceLine?: string }): ReleaseHoldReason | null {
  const key = row.held_canonical_fee_key;
  const name = row.fee_name ?? "";
  if (!checkFeeCategory(key, name, row).ok) return "category_guard";
  if (nameIsFragment(name)) return "name_fragment";
  const price = row.amount == null ? null : Number(row.amount);
  if (MEMBER_OVERDRAFT_CATEGORIES.has(key) && CHARGED_TO_MERCHANT.test(name)) return "charged_to_merchant";
  if (
    key === "overdraft" &&
    OVERDRAFT_PROTECTION_NAME.test(name) &&
    !PAID_ITEM_NAME.test(name) &&
    price != null &&
    price < SMALL_OVERDRAFT_AMOUNT
  ) {
    return "small_overdraft_protection";
  }
  if (footnoteInPrice(price, sourceLine ?? "", sourceContext)) return "footnote_in_price";
  if (frequencyContradictsLine(row.frequency, sourceLine ?? "", price)) return "frequency_contradicts_line";
  if (key === "monthly_maintenance" && BARE_MONTHLY_NAME.test(name) && BUSINESS_SERVICE_ROWS.test(sourceContext ?? "")) {
    return "business_service_monthly";
  }
  if (key === "nsf" && PLAIN_RETURNED_ITEM.test(name) && price != null && price < SMALL_NSF_AMOUNT) {
    return "small_returned_item";
  }
  return null;
}

/** Names the taxonomy files under each category, so "fits" is judged by this index's own rules. */
const ALIASES_BY_KEY: ReadonlyMap<string, string[]> = (() => {
  const byKey = new Map<string, string[]>();
  for (const [alias, key] of Object.entries(CANONICAL_KEY_MAP)) {
    if (alias === key) continue;
    const list = byKey.get(key) ?? [];
    if (list.length < 12) list.push(alias.replace(/_/g, " "));
    byKey.set(key, list);
  }
  return byKey;
})();

/** A past judgement on a fee in the same category, read from the shared learning store. */
export interface ReviewLesson {
  filedAs: string;
  feeName: string;
  amount: number | null;
  scheduleLine: string | null;
  found: string;
}

/** Wrong fees and mistaken takedowns per category in each prompt. */
export const REVIEW_LESSONS_WRONG_PER_KEY = 3;
export const REVIEW_LESSONS_RESTORED_PER_KEY = 2;

/** What each judgement in `pipeline_feedback` means, in the words the prompt uses. */
const LESSON_FOUND: Readonly<Record<string, string>> = {
  wrong_category: "wrong: filed under the wrong category",
  off_taxonomy: "wrong: not a fee this index tracks",
  restored: "right: a check took it down by mistake; it is a real price in this category",
};

/**
 * The recent lessons the rest of the pipeline has written about fees in these categories:
 * live fees Hamilton's category checks took down as filed in the wrong category (not undone
 * since), and fees a takedown got wrong that a later check restored. Every such takedown and
 * restore becomes an example the next review reads, so the review learns from the
 * pipeline's own outcomes, not only from rules written into this prompt.
 *
 * Only judgements that hold up are lessons. The source check's amount judgements
 * (`wrong_amount`, `threshold`) are left out: of 20 random ones from the 24 hours to
 * 2026-10-07 02:50 UTC, read against the full page, 4 were real prices it should have kept
 * ("Wire Transfer Outgoing $20.00"; PR 341 fixes those) and 3 more could not be read, and a
 * wrong lesson would teach the review to hold real fees. Empty when the store is missing or
 * cannot be read.
 */
export async function loadReviewLessons(db: SqlTag, keys: string[]): Promise<ReviewLesson[]> {
  const unique = [...new Set(keys.filter(Boolean))];
  if (unique.length === 0) return [];
  try {
    if (!(await inSavepoint(db, (scope) => feedbackSchemaReady(scope)))) return [];
    const rows = await inSavepoint(db, (scope) => scope<{
      canonical_fee_key: string;
      fee_name: string | null;
      amount: number | string | null;
      excerpt: string | null;
      kind: string;
    }[]>`
      WITH judged AS (
        SELECT DISTINCT ON (fv.fee_verified_id, lesson.kind)
               fv.canonical_fee_key, fv.fee_name, fv.amount, fv.fee_raw_id, lesson.kind, lesson.created_at
          FROM (
            SELECT pf.fee_verified_id, pf.kind, pf.created_at
              FROM pipeline_feedback pf
             WHERE pf.signal = 'wrong'
               AND pf.kind IN ('wrong_category', 'off_taxonomy')
               AND split_part(pf.check_name, ':', 1) IN ('hamilton.category_guard', 'hamilton.category_outside_taxonomy')
               AND pf.fee_verified_id IS NOT NULL
               AND NOT EXISTS (
                 SELECT 1 FROM pipeline_feedback back
                  WHERE back.signal = 'restored' AND back.fee_published_id = pf.fee_published_id
               )
            UNION ALL
            SELECT fp.lineage_ref, 'restored', pf.created_at
              FROM pipeline_feedback pf
              JOIN published_fee_records fp ON fp.fee_published_id = pf.fee_published_id
             WHERE pf.signal = 'restored'
               AND fp.rolled_back_at IS NULL
          ) lesson
          JOIN verified_fee_observations fv ON fv.fee_verified_id = lesson.fee_verified_id
         WHERE fv.canonical_fee_key = ANY(${unique}::text[])
         ORDER BY fv.fee_verified_id, lesson.kind, lesson.created_at DESC
      ), ranked AS (
        SELECT judged.*,
               row_number() OVER (
                 PARTITION BY canonical_fee_key, (kind = 'restored')
                 ORDER BY created_at DESC
               ) AS rank
          FROM judged
      )
      SELECT ranked.canonical_fee_key, ranked.fee_name, ranked.amount, ranked.kind,
             substring(fr.conditions FROM 'excerpt="(.*)"') AS excerpt
        FROM ranked
        LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id = ranked.fee_raw_id
       WHERE ranked.rank <= CASE WHEN ranked.kind = 'restored'
                                 THEN ${REVIEW_LESSONS_RESTORED_PER_KEY}::int
                                 ELSE ${REVIEW_LESSONS_WRONG_PER_KEY}::int END
       ORDER BY ranked.canonical_fee_key, ranked.kind
    `);
    return rows.map((row) => ({
      filedAs: row.canonical_fee_key,
      feeName: String(row.fee_name ?? "").slice(0, 120),
      amount: row.amount == null ? null : Number(row.amount),
      scheduleLine: row.excerpt ? row.excerpt.slice(0, 200) : null,
      found: LESSON_FOUND[row.kind] ?? `wrong: ${row.kind}`,
    }));
  } catch (error) {
    console.warn("[darwin] release review lessons unavailable", error instanceof Error ? error.message : error);
    return [];
  }
}

/** The lessons for the categories in one batch. */
export function lessonsFor(batch: ReleaseReviewCandidate[], lessons: ReviewLesson[]): ReviewLesson[] {
  const keys = new Set(batch.map(({ row }) => row.held_canonical_fee_key));
  return lessons.filter((lesson) => keys.has(lesson.filedAs));
}

export function releaseReviewPrompt(candidates: ReleaseReviewCandidate[], lessons: ReviewLesson[] = []): string {
  const items = candidates.map(({ row, sourceLine, sourceContext }) => ({
    id: Number(row.fee_raw_id),
    fee_name: row.fee_name,
    amount: row.amount == null ? null : Number(row.amount),
    filed_as: `${row.held_canonical_fee_key} (${DISPLAY_NAMES[row.held_canonical_fee_key] ?? row.held_canonical_fee_key})`,
    filed_as_includes: ALIASES_BY_KEY.get(row.held_canonical_fee_key) ?? [],
    ...(neighbourCategories(row.held_canonical_fee_key).length > 0
      ? {
          not_these: neighbourCategories(row.held_canonical_fee_key).map((key) => ({
            category: `${key} (${DISPLAY_NAMES[key] ?? key})`,
            includes: ALIASES_BY_KEY.get(key) ?? [],
          })),
        }
      : {}),
    schedule_line: sourceLine.slice(0, 300),
    ...(sourceContext ? { schedule_rows_around: sourceContext } : {}),
  }));
  return [
    "You check fees read from bank and credit union fee schedules before they are published.",
    "Each item has the fee as it was read, the category it was filed under, and the line of the bank's schedule it came from.",
    "For each item decide, from the schedule line:",
    "- is_fee: true only if the line names a price the institution charges a customer.",
    "  False for balance requirements, minimum deposits, limits, rates, reimbursements or garbled text,",
    "  and when `fee_name` is not a fee's name but a sentence fragment (\"meet the following requirements: A service charge of\").",
    "- category_fits: true only if this fee is what `filed_as` means in this index; `filed_as_includes` lists fee names it files there.",
    "  A fee named for something else (an official check filed as NSF, an overdraft-protection transfer filed as overdraft) does not fit,",
    "  nor a different service that shares a word with the category (a \"Smart Safe\" cash-deposit device is not a safe deposit box).",
    "  A monthly charge for one service (online wires, bill pay) is not the account's monthly maintenance fee,",
    "  and a fee for returning or re-clearing a check the customer deposited is not NSF.",
    "  Undoing a service (removing or releasing a stop payment) and a faster or premium version of it",
    "  (expedited, rush, emergency or overnight) do not fit the service's own category.",
    "  `not_these` lists neighbouring categories fees filed here often belong to; a fee that is one of those does not fit.",
    "- amount_is_price: true only if `amount` is the price the line charges for this fee.",
    "  False for a cap or maximum (\"5% of amount owed, $100 maximum\"), a threshold, another fee's price,",
    "  only part of the price (\"Cost plus $8\" or \"$5 plus postage\" is not an $8 or $5 price),",
    "  or a number misread from spaced or broken text (\"$ 5 5 . 0 0\" is $55), including a footnote marker read",
    "  as a digit (\"$651\" in a list of $85, $100 and $120 boxes is $65 with footnote 1).",
    "  Also false for a price the line marks as waived outright (\"$2.95 (FEE WAIVED)\"); a price waived",
    "  only under a condition (\"waived with a $500 balance\") is still the price.",
    "  When one row runs two fee names together with two prices, the prices go with the names in order",
    "  (\"Debit Card Replacement Rush Order | $10 $75\" is a $10 replacement and a $75 rush order).",
    "When an item has `schedule_rows_around` (the rows above and below its line), use them: a price that",
    "belongs to the next row, another column or another account is not this fee's price. When the rows",
    "are jumbled text rather than a fee table and do not show what the fee is (a bare \"overdrafts | $5.00\"), is_fee is false.",
    "Return only JSON: {\"verdicts\": [{\"id\", \"is_fee\", \"category_fits\", \"amount_is_price\", \"reason\"}]} with one entry per item and a reason of at most 12 words.",
    ...(lessons.length > 0
      ? [
          "",
          "Lessons: fees in these categories this index's later checks judged. Judge items like them the same way.",
          JSON.stringify(lessons.map((lesson) => ({
            filed_as: lesson.filedAs,
            fee_name: lesson.feeName,
            amount: lesson.amount,
            schedule_line: lesson.scheduleLine,
            found: lesson.found,
          }))),
        ]
      : []),
    "",
    "Items:",
    JSON.stringify(items),
  ].join("\n");
}

/** Pure: verdicts by fee id. A missing or non-true field reads as false. */
export function parseReleaseReviews(parsed: unknown): Map<number, ReleaseReviewVerdict> {
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { verdicts?: unknown })?.verdicts)
      ? (parsed as { verdicts: unknown[] }).verdicts
      : [];
  const verdicts = new Map<number, ReleaseReviewVerdict>();
  for (const entry of list) {
    const row = entry as Record<string, unknown>;
    const id = Number(row?.id);
    if (!Number.isFinite(id)) continue;
    verdicts.set(id, {
      isFee: row.is_fee === true,
      categoryFits: row.category_fits === true,
      amountIsPrice: row.amount_is_price === true,
      reason: typeof row.reason === "string" ? row.reason.slice(0, 160) : null,
    });
  }
  return verdicts;
}

type CandidateRow = HeldFeeRow & { source_line: string; source_context: string | null };

async function selectReviewCandidates(db: SqlTag, limit: number, stateCode?: string): Promise<ReleaseReviewCandidate[]> {
  const params: Array<string | number> = [
    limit,
    DARWIN_RELEASE_STRATEGY.strategy,
    DARWIN_RELEASE_STRATEGY.version,
    DARWIN_RELEASE_REVIEW_STRATEGY.strategy,
    DARWIN_RELEASE_REVIEW_STRATEGY.version,
  ];
  const state = normalizeStateCode(stateCode);
  const stateFilter = state ? `AND upper(btrim(inst.state_code)) = $${params.push(state)}` : "";
  const rows = await db.unsafe<CandidateRow[]>(
    `
      SELECT fr.fee_raw_id,
             fr.institution_id,
             fr.source_url,
             fr.document_r2_key,
             fr.extraction_confidence,
             fr.fee_name,
             fr.amount,
             fr.frequency,
             fr.outlier_flags,
             fr.conditions,
             inst.institution_name,
             fr.source_document_id,
             upper(btrim(inst.state_code)) AS state_code,
             rel.detail->>'held_reason' AS held_reason,
             rel.detail->>'canonical_fee_key' AS held_canonical_fee_key,
             rel.detail->>'source_line' AS source_line,
             rel.detail->>'source_context' AS source_context
        FROM pipeline_attempts rel
        JOIN raw_fee_observations fr ON fr.fee_raw_id = substring(rel.input_fingerprint from 5)::bigint
        JOIN institution_sources inst ON inst.id = fr.institution_id
       WHERE rel.stage = 'verify'
         AND rel.strategy = $2
         AND rel.strategy_version = $3
         AND rel.detail->>'verdict' = 'review'
         AND rel.detail->>'source_line' IS NOT NULL
         ${stateFilter}
         AND NOT EXISTS (
           SELECT 1 FROM pipeline_attempts done
            WHERE done.input_fingerprint = rel.input_fingerprint
              AND done.strategy = $4
              AND done.strategy_version = $5
              AND done.outcome NOT IN (${TRANSIENT_OUTCOMES.map((outcome) => `'${outcome}'`).join(", ")})
         )
         AND NOT EXISTS (SELECT 1 FROM verified_fee_observations fv WHERE fv.fee_raw_id = fr.fee_raw_id)
       ORDER BY rel.created_at ASC, fr.fee_raw_id ASC
       LIMIT $1
    `,
    params,
  );
  return (rows ?? []).map(({ source_line, source_context, ...row }) => ({
    row: row as HeldFeeRow,
    sourceLine: source_line,
    sourceContext: source_context,
  }));
}

function failureOutcome(error: unknown): AttemptOutcome {
  const status = Number((error as { status?: unknown })?.status);
  if (status === 429) return "http_429";
  if (status >= 500) return "http_5xx";
  if (Number.isFinite(status) && status > 0) return "http_other";
  return /abort|timed? ?out|timeout/i.test(error instanceof Error ? error.message : String(error)) ? "timeout" : "network_error";
}

function isStopError(error: unknown): boolean {
  return error instanceof Error && STOP_ERRORS.has(error.name);
}

export interface ReleaseReviewResult extends PaidPassResult {
  calls: number;
  /** Lessons from the learning store put in the prompts. */
  lessons: number;
  passed: number;
  released: number;
}

/** Review up to `calls` batches of release candidates; release the ones that pass when acting. */
export async function runDarwinReleaseReview(
  options: PaidStepOptions & { create?: PaidMessageCreator; calls: number; acts?: boolean },
): Promise<ReleaseReviewResult> {
  const db = options.db ?? sql;
  const dryRun = Boolean(options.dryRun);
  const result: ReleaseReviewResult = { ...emptyPaidPassResult(dryRun), calls: 0, lessons: 0, passed: 0, released: 0 };
  if (options.calls <= 0 || !(await learningSchemaReady(db))) return result;

  const limit = options.calls * RELEASE_REVIEW_FEES_PER_CALL;
  const candidates = await selectReviewCandidates(db, limit, options.stateCode);
  // A lane whose state has few held fees left fills the rest with the oldest held fees from any
  // state, so the wait does not depend on when each state's lane next comes round.
  if (options.stateCode && candidates.length < limit) {
    const taken = new Set(candidates.map(({ row }) => Number(row.fee_raw_id)));
    const others = await selectReviewCandidates(db, limit);
    candidates.push(...others.filter(({ row }) => !taken.has(Number(row.fee_raw_id))).slice(0, limit - candidates.length));
  }
  result.selected = candidates.length;
  if (dryRun) {
    result.results = candidates.slice(0, 50).map(({ row }) => ({
      fee_raw_id: Number(row.fee_raw_id),
      canonical_fee_key: row.held_canonical_fee_key,
      review: "would_review",
    }));
    return result;
  }

  const acts = options.acts ?? DARWIN_RELEASE_ACTS;
  const model = PAID_PASS_MODELS.verify();
  // Fees judged before the release step stored their schedule's surrounding rows read them now.
  const missing = candidates.filter((candidate) => !candidate.sourceContext && candidate.row.source_document_id != null);
  if (missing.length > 0) {
    const texts = await loadSourceTexts(db, [...new Set(missing.map(({ row }) => Number(row.source_document_id)))]);
    for (const candidate of missing) {
      candidate.sourceContext = scheduleContext(texts.get(Number(candidate.row.source_document_id)), candidate.sourceLine);
    }
  }
  const heldKeys = candidates.map(({ row }) => row.held_canonical_fee_key);
  // The pipeline's own outcomes, then this review's misses against the answer keys (verdict-score.ts).
  const lessons = [
    ...(await loadReviewLessons(db, heldKeys)),
    ...(await loadReviewMisses(db, "verify.release_review", heldKeys)).map((miss) => ({
      filedAs: miss.filedAs ?? "",
      feeName: miss.feeName,
      amount: miss.amount,
      scheduleLine: miss.keyLine,
      found: `wrong: this review said ${miss.said}; the hand-keyed schedule says ${miss.keySays.join(" or ") || "no fee at this amount"}`,
    })),
  ];
  result.lessons = lessons.length;
  for (let start = 0; start < candidates.length; start += RELEASE_REVIEW_FEES_PER_CALL) {
    const batch = candidates.slice(start, start + RELEASE_REVIEW_FEES_PER_CALL);
    const batchLessons = lessonsFor(batch, lessons);
    const startedAt = Date.now();
    const common = ({ row }: ReleaseReviewCandidate) => ({
      institutionId: Number(row.institution_id),
      sourceDocumentId: row.source_document_id == null ? null : Number(row.source_document_id),
      stage: "verify" as const,
      strategy: DARWIN_RELEASE_REVIEW_STRATEGY.strategy,
      version: DARWIN_RELEASE_REVIEW_STRATEGY.version,
      fingerprint: rawFeeFingerprint(Number(row.fee_raw_id)),
      runId: options.runId,
      stepId: options.stepId ?? null,
      foldIntoPlaybook: false,
    });
    let call: Awaited<ReturnType<typeof paidModelCall>>;
    try {
      call = await paidModelCall({
        agent: "darwin",
        operation: "release_review",
        runId: options.runId,
        params: {
          model,
          max_tokens: MAX_OUTPUT_TOKENS,
          messages: [{ role: "user", content: releaseReviewPrompt(batch, batchLessons) }],
        },
        create: options.create,
        metadata: { fee_raw_ids: batch.map(({ row }) => Number(row.fee_raw_id)) },
      });
    } catch (error) {
      if (isStopError(error)) {
        result.budgetStopped = true;
        result.budgetReason = error instanceof Error ? error.message : String(error);
        break;
      }
      result.calls += 1;
      const outcome = failureOutcome(error);
      const message = error instanceof Error ? error.message.slice(0, 200) : String(error);
      for (const candidate of batch) {
        result.processed += 1;
        result.failed += 1;
        await recordAttempt(db, {
          ...common(candidate),
          outcome,
          yieldCount: 0,
          costMicrousd: 0,
          durationMs: Date.now() - startedAt,
          detail: { fee_raw_id: Number(candidate.row.fee_raw_id), model, error: message },
        });
      }
      continue;
    }

    result.calls += 1;
    result.costMicrousd += call.costMicrousd;
    const verdicts = parseReleaseReviews(paidResponseJson(call.message));
    const share = Math.floor(call.costMicrousd / batch.length);
    for (const candidate of batch) {
      const feeRawId = Number(candidate.row.fee_raw_id);
      result.processed += 1;
      const verdict = verdicts.get(feeRawId);
      if (!verdict) {
        result.failed += 1;
        await recordAttempt(db, {
          ...common(candidate),
          outcome: "parse_error",
          yieldCount: 0,
          costMicrousd: share,
          durationMs: Date.now() - startedAt,
          detail: { fee_raw_id: feeRawId, model },
        });
        continue;
      }
      result.succeeded += 1;
      const refilesTo = lineRefilesTo(candidate);
      const premium = premiumServiceMisfiled(candidate);
      const holdReason = releaseHoldReason(candidate);
      const passes = reviewPasses(verdict) && refilesTo == null && !premium && holdReason == null;
      if (passes) result.passed += 1;
      // A blank frequency takes what the line says after the price; a stated one is kept (or held above).
      const price = candidate.row.amount == null ? null : Number(candidate.row.amount);
      const lineFrequency = candidate.row.frequency ? null : frequencyFromLine(candidate.sourceLine, price);
      let feeVerifiedId: number | null = null;
      if (passes && acts) {
        const row = lineFrequency ? { ...candidate.row, frequency: lineFrequency } : candidate.row;
        feeVerifiedId = (await releaseHeldFee(db, { runId: options.runId, row, sourceLine: candidate.sourceLine })).feeVerifiedId;
        if (feeVerifiedId != null) result.released += 1;
      }
      await recordAttempt(db, {
        ...common(candidate),
        outcome: passes ? "ok" : "rejected",
        yieldCount: feeVerifiedId != null ? 1 : 0,
        costMicrousd: share,
        durationMs: Date.now() - startedAt,
        detail: {
          fee_raw_id: feeRawId,
          fee_name: candidate.row.fee_name,
          canonical_fee_key: candidate.row.held_canonical_fee_key,
          amount: candidate.row.amount == null ? null : Number(candidate.row.amount),
          held_reason: candidate.row.held_reason,
          source_line: candidate.sourceLine.slice(0, 300),
          source_context: candidate.sourceContext ?? null,
          refiles_to: refilesTo,
          premium_service: premium,
          hold_reason: holdReason,
          frequency_filled: lineFrequency,
          is_fee: verdict.isFee,
          category_fits: verdict.categoryFits,
          amount_is_price: verdict.amountIsPrice,
          passes,
          reason: verdict.reason,
          lessons: batchLessons.length,
          fee_verified_id: feeVerifiedId,
          acted: acts,
          model,
        },
      });
      if (result.results.length < 50) {
        result.results.push({ fee_raw_id: feeRawId, passes, reason: verdict.reason });
      }
    }
  }
  return result;
}
