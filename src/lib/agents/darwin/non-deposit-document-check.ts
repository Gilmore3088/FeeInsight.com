import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import { LENDING_CATEGORIES } from "@/lib/agents/knox/held-recheck";
import {
  documentHostLabelSql,
  documentPathSegmentsSql,
  nonDepositDocumentKind,
  nonDepositKindSql,
  ratePageDocument,
  ratePageSql,
  type NonDepositDocumentKind,
} from "@/lib/non-deposit-document";

type SqlTag = typeof sql;

/**
 * Darwin's live re-check of fees read from documents that are not deposit fee schedules (#1442;
 * decision 2026-10-15, "Darwin re-checks every live fee against today's rules"). James's catalog
 * review (Oct 15, prod read-only, URL heuristics) found live rows from brokerage and wealth pages
 * (33 rows on 5 addresses: Northern Trust wealth, U.S. Bank self-directed investing "Research"
 * $20) and from loan, card, HELOC, mortgage and rate pages (386 rows on 85 addresses: Bank of
 * Greene `/current-rates/` "Appraisal $400"). Those counts are the issue's, not this rule's; the
 * rule's own count is `nonDepositCountSql`.
 *
 * The rule is the shared classifier `nonDepositDocumentKind` (`@/lib/non-deposit-document`, also
 * Magellan's companion filter), read on the address of the stored document each live fee came
 * from (the same join as `document-owner.ts`: `published_fee_records.lineage_ref` ->
 * `verified_fee_observations` -> `raw_fee_observations.source_document_id` -> `source_documents`).
 * It is conservative: a path segment must name the page as a loan, rate, card, mortgage, HELOC,
 * brokerage, investing or wealth page, a deposit word anywhere wins, and business and commercial
 * documents are out of scope (kept on purpose; fee-stats drops them from medians).
 *
 * Only lending-category fees on a matched document come down (`LENDING_CATEGORIES`, Knox's list:
 * late payment, loan origination, appraisal, vehicle title, other lending fee, cash advance). The
 * taxonomy has no brokerage category, so every other key is a deposit one, and a deposit-category
 * fee stays live wherever it was read: the prod read-only check of the first version (Oct 15)
 * found 12 of 47 matched documents were "current rates" or "loan rates" pages holding a credit
 * union's whole deposit schedule, and real HELOC, card and brokerage pages also list stop payment,
 * wire, NSF and returned-check fees under their deposit categories. Such fees are counted as
 * `keptDepositCategory` and pass.
 *
 * v2 (#1518, the v1 dry run): three rules, each its own reason and count.
 * - `lending_category` (v1): a lending-category fee on a loan or brokerage document. On a rate page
 *   (a "loan" document named only as "current rates" or "rate sheet", `ratePageDocument`), which
 *   often holds the whole deposit schedule, it also needs lending wording in its name: Siouxland's
 *   `/current-rates` "Late Fee" $5 (late_payment) sits among the safe deposit box lines and stays
 *   live (`keptGenericOnRatePage`), while "Application fee", "Credit Report fee" and "Standard
 *   processing fee" there come down (`hasRatePageLendingWording`).
 * - `lending_wording_on_loan_document`: a deposit-category fee on a loan, HELOC, card or rate
 *   document whose name carries clear lending wording (`hasLendingWording`, a closed allowlist:
 *   "Mortgage processing and research fee" filed as account_research, "Late Payment - Return
 *   Check" as nsf, "Cash Advance ATM" as atm_non_network, a $250 subordination as legal_process).
 *   A bare "loan" is not lending wording ("Loan payment by phone", "transfer to pay a loan" can be
 *   the deposit side's fees), and deposit-side wording in the name (safe deposit, checking,
 *   savings, overdraft, transfer, phone) keeps the fee live. Same switch as v1.
 * - `brokerage_document`: a deposit-category fee on a brokerage, wealth or investing document
 *   (U.S. Bank's brokerage pages: wire, "Research", returned check, stop payment, overnight check,
 *   IRA fees). The taxonomy has no brokerage category, so whether these come down is James's call:
 *   they are counted on their own and come down only when `BROKERAGE_DOCUMENT_TAKEDOWN_LIVE` is
 *   also on (off by default, even with the main switch on); until then they pass.
 *
 * Each Darwin verify step reads the next `NON_DEPOSIT_BATCH` live fees after a cursor kept on the
 * run ledger (the `darwin.non_deposit_document` event's `next_after_id`, 0 once a pass reaches the
 * end). An institution-scoped run reads that institution's live fees and leaves the cursor alone.
 *
 * Shadow first (CLAUDE.md standing rule): while `NON_DEPOSIT_DOCUMENT_TAKEDOWN_LIVE` is false, or in
 * a dry run, the step only reports what it would take down (by kind, with samples). Switched on, a
 * matching fee goes through the shared 12-hour second look (check `darwin.non_deposit_document`)
 * and is archived on its second failure: rolled back with `non_deposit_document: <kind> #<doc>`,
 * its verified row rejected with the `non_deposit_document` flag, never deleted, and a
 * `darwin.non_deposit_document_takedown` event lists them. Fees that pass clear a pending flag.
 */
export const NON_DEPOSIT_CHECK = "darwin.non_deposit_document";
export const NON_DEPOSIT_CHECK_VERSION = 2;
/**
 * Default-off switch. It turns on by PR after the dry-run count over the whole live table
 * (`nonDepositCountSql`, or the verify step's `non_deposit_full_count` param) and a sample
 * (`nonDepositSamplesSql`) have been shown to James.
 */
export const NON_DEPOSIT_DOCUMENT_TAKEDOWN_LIVE = false;
/**
 * Default-off sub-switch for the `brokerage_document` rule (deposit-category fees on brokerage,
 * wealth and investing documents, #1518). It acts only with `NON_DEPOSIT_DOCUMENT_TAKEDOWN_LIVE`
 * and stays off when that one goes on, so James can say yes to one without the other.
 */
export const BROKERAGE_DOCUMENT_TAKEDOWN_LIVE = false;
export const NON_DEPOSIT_REASON = "non_deposit_document";
/** The rules a matched fee comes down under (each its own reason prefix and count). */
export type NonDepositRule = "lending_category" | "lending_wording_on_loan_document" | "brokerage_document";
export const LENDING_WORDING_REASON = "lending_wording_on_loan_document";
export const BROKERAGE_DOCUMENT_REASON = "brokerage_document";
export const NON_DEPOSIT_FLAG = "non_deposit_document";
/** Live fees read per step; an address-only read. */
export const NON_DEPOSIT_BATCH = 2_000;
export const NON_DEPOSIT_SAMPLES = 20;

/**
 * Lending wording in a fee's name (#1518): a closed, conservative allowlist, matched on the name
 * cut to lower-case words padded with a space (`lendingWordingText`). Written once for JS and
 * Postgres (no `\b`, no lookaround). Each entry names a loan, card-credit or mortgage service and
 * no deposit one: mortgage, HELOC, home equity, cash advance, late payment, payoff (or "pay off"),
 * appraisal, closing cost, escrow, subordination, origination only as "loan", "mortgage" or
 * "HELOC origination" ("ACH origination" and "wire origination" are deposit services), and "loan"
 * only as "loan late", "loan application", "loan processing", "loan modification", "loan
 * extension" or "loan documentation". A bare "loan" is left out on purpose: "Loan payment by
 * phone", "Loan coupon book" and "transfer to pay a loan" are on many deposit schedules. A bare
 * "late fee" is left out: a safe deposit box has one too.
 */
export const LENDING_WORDING = " (?:mortgages?|helocs?|home equity|cash advances?|late payments?|pay ?offs?|appraisals?|closing costs?|(?:loan|mortgage|heloc) originations?|escrows?|subordinations?|loan (?:late|applications?|processing|modifications?|extensions?|documentation|docs?)) ";
/**
 * Deposit-side wording that keeps a name with lending wording live (review of v2, #1518): a safe
 * deposit box ("box rent late payment", "SDB late payment"), a deposit account or certificate
 * ("share certificate early payoff", "early payoff of CD", "club account late payment"), a debit
 * card ("debit card cash advance"), ACH, wire, coin ("coin appraisal"), an overdraft, a transfer,
 * and a payment channel: "by phone", or a "mortgage/loan/HELOC/home equity payment" phrase
 * ("Mortgage payment at teller", "Mortgage payment (ACH)"), which can be the deposit side's fee
 * for making the payment. When unsure, the fee stays.
 */
export const DEPOSIT_SIDE_WORDING = " (?:safe deposit|box(?:es)?|sdb|checking|savings|shares?|certificates?|cds?|club|coin|debit|ach|wires?|overdrafts?|transfers?|phone|telephone|(?:mortgages?|loans?|helocs?|home equity) payments?) ";
/**
 * Extra lending wording for a lending-category fee on a rate page only (prod dry run of v2,
 * #1518): Independent Bank "Standard processing fee" $175, Bank of Greene "Application fee" $100
 * and "Credit Report fee" $113.20 are loan fees on rate pages. Never used for a deposit-category fee.
 */
export const RATE_PAGE_LENDING_WORDING = " (?:applications?|credit reports?|processing) ";
const LENDING_WORDING_RE = new RegExp(LENDING_WORDING);
const DEPOSIT_SIDE_WORDING_RE = new RegExp(DEPOSIT_SIDE_WORDING);
const RATE_PAGE_LENDING_WORDING_RE = new RegExp(RATE_PAGE_LENDING_WORDING);

/** A fee name as lower-case words padded with one space: every run of non-letters and non-digits (ASCII) one space. */
export function lendingWordingText(name: string | null | undefined): string {
  return ` ${(name ?? "").replace(/[^A-Za-z0-9]+/g, " ").toLowerCase().trim()} `;
}

/** Pure: the name carries lending wording (`LENDING_WORDING`) and no deposit-side wording (`DEPOSIT_SIDE_WORDING`). */
export function hasLendingWording(name: string | null | undefined): boolean {
  const text = lendingWordingText(name);
  return LENDING_WORDING_RE.test(text) && !DEPOSIT_SIDE_WORDING_RE.test(text);
}

/**
 * Pure: a lending-category fee on a rate page comes down only when this holds: lending wording or
 * the rate-page extras (`RATE_PAGE_LENDING_WORDING`: application, credit report, processing), and
 * no deposit-side wording. Siouxland's safe deposit "Late Fee" $5 has neither and stays live.
 */
export function hasRatePageLendingWording(name: string | null | undefined): boolean {
  const text = lendingWordingText(name);
  return (LENDING_WORDING_RE.test(text) || RATE_PAGE_LENDING_WORDING_RE.test(text)) && !DEPOSIT_SIDE_WORDING_RE.test(text);
}

/** What the check does with one fee on a matched document: a rule it comes down under, or why it stays. */
export type NonDepositVerdict = NonDepositRule | "kept_deposit_category" | "kept_generic_on_rate_page";

/**
 * Pure: the verdict for one fee on a document of `kind` (see the module note). `ratePage` is
 * `ratePageDocument(url)`.
 */
export function nonDepositVerdict(kind: NonDepositDocumentKind, ratePage: boolean, canonicalFeeKey: string | null | undefined, feeName: string | null | undefined): NonDepositVerdict {
  const lending = isLendingCategory(canonicalFeeKey);
  if (kind === "brokerage") return lending ? "lending_category" : "brokerage_document";
  if (lending) return ratePage && !hasRatePageLendingWording(feeName) ? "kept_generic_on_rate_page" : "lending_category";
  return hasLendingWording(feeName) ? "lending_wording_on_loan_document" : "kept_deposit_category";
}

export interface NonDepositRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  institution_id: number | string;
  fee_name: string | null;
  amount: number | string | null;
  canonical_fee_key: string | null;
  source_document_id: number | string | null;
  document_url: string | null;
}

export interface NonDepositMatch {
  feePublishedId: number;
  feeVerifiedId: number | null;
  institutionId: number;
  feeName: string;
  amount: number | null;
  canonicalFeeKey: string | null;
  sourceDocumentId: number;
  documentUrl: string;
  kind: NonDepositDocumentKind;
  ratePage: boolean;
  verdict: NonDepositVerdict;
  reason: string;
}

export interface NonDepositFindings {
  checked: number;
  /** Fees whose stored document address was found. */
  withDocument: number;
  /** Fees on a matched document, any category. */
  onMatchedDocument: number;
  /** Of those, deposit-category fees with no lending wording on a loan document, which stay live. */
  keptDepositCategory: number;
  /** Of those, lending-category fees with no lending wording on a rate page, which stay live (#1518). */
  keptGenericOnRatePage: number;
  /**
   * Of those, the fees the main switch takes down (or, in shadow, would): `lending_category` and
   * `lending_wording_on_loan_document`.
   */
  matched: number;
  byKind: Record<NonDepositDocumentKind, number>;
  /** Every rule's count; `brokerage_document` is not in `matched` and needs its own sub-switch. */
  byRule: Record<NonDepositRule, number>;
  /** Deposit-category fees on brokerage documents (`brokerage_document`), counted on their own. */
  brokerageDocument: number;
  /** Distinct documents and institutions among the matches (the main switch's). */
  documents: number;
  institutions: number;
  samples: NonDepositMatch[];
  /** Samples of the `lending_wording_on_loan_document` matches (also among `samples`' rule). */
  lendingWordingSamples: NonDepositMatch[];
  brokerageDocumentSamples: NonDepositMatch[];
  keptSamples: NonDepositMatch[];
}

export interface NonDepositResult extends NonDepositFindings {
  live: boolean;
  /** `BROKERAGE_DOCUMENT_TAKEDOWN_LIVE` (acts only with `live`). */
  brokerageLive: boolean;
  dryRun: boolean;
  afterId: number | null;
  nextAfterId: number | null;
  /** Switch on: first looks logged, fees still waiting for their second look, pending flags cleared. */
  flagged: number;
  waiting: number;
  cleared: number;
  /** Live fees archived in this step (switch on, not a dry run). */
  takenDown: number[];
}

function num(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** A lending category (Knox's `LENDING_CATEGORIES`): the only fees this check takes down. */
export function isLendingCategory(key: string | null | undefined): boolean {
  return key != null && LENDING_CATEGORIES.has(key);
}

/**
 * Pure: the live rows whose document is a brokerage/wealth or loan/rate page, with a verdict for
 * each (`nonDepositVerdict`), counted by kind and rule. `matches` are the main switch's,
 * `brokerageMatches` the `brokerage_document` sub-switch's, and `passing` every other documented
 * fee (the caller adds `brokerageMatches` to it while the sub-switch is off).
 */
export function findNonDepositFees(rows: NonDepositRow[]): NonDepositFindings & { matches: NonDepositMatch[]; brokerageMatches: NonDepositMatch[]; passing: number[] } {
  const byKind: Record<NonDepositDocumentKind, number> = { brokerage: 0, loan: 0 };
  const byRule: Record<NonDepositRule, number> = { lending_category: 0, lending_wording_on_loan_document: 0, brokerage_document: 0 };
  const matches: NonDepositMatch[] = [];
  const brokerageMatches: NonDepositMatch[] = [];
  const kept: NonDepositMatch[] = [];
  const passing: number[] = [];
  let withDocument = 0;
  let keptDepositCategory = 0;
  let keptGenericOnRatePage = 0;
  for (const row of [...rows].sort((a, b) => Number(a.fee_published_id) - Number(b.fee_published_id))) {
    const documentId = num(row.source_document_id);
    const url = (row.document_url ?? "").trim();
    if (documentId == null || !url) continue;
    withDocument += 1;
    const kind = nonDepositDocumentKind(url);
    if (!kind) {
      passing.push(Number(row.fee_published_id));
      continue;
    }
    const ratePage = kind === "loan" && ratePageDocument(url);
    const verdict = nonDepositVerdict(kind, ratePage, row.canonical_fee_key, row.fee_name);
    const prefix = verdict === "lending_category" ? NON_DEPOSIT_REASON : verdict;
    const match: NonDepositMatch = {
      feePublishedId: Number(row.fee_published_id),
      feeVerifiedId: num(row.fee_verified_id),
      institutionId: Number(row.institution_id),
      feeName: row.fee_name ?? "",
      amount: num(row.amount),
      canonicalFeeKey: row.canonical_fee_key ?? null,
      sourceDocumentId: documentId,
      documentUrl: url,
      kind,
      ratePage,
      verdict,
      reason: `${prefix}: ${kind} #${documentId}`,
    };
    if (verdict === "kept_deposit_category" || verdict === "kept_generic_on_rate_page") {
      if (verdict === "kept_deposit_category") keptDepositCategory += 1;
      else keptGenericOnRatePage += 1;
      kept.push(match);
      passing.push(match.feePublishedId);
      continue;
    }
    byRule[verdict] += 1;
    if (verdict === "brokerage_document") {
      brokerageMatches.push(match);
      continue;
    }
    byKind[kind] += 1;
    matches.push(match);
  }
  return {
    checked: rows.length,
    withDocument,
    onMatchedDocument: matches.length + brokerageMatches.length + kept.length,
    keptDepositCategory,
    keptGenericOnRatePage,
    matched: matches.length,
    byKind,
    byRule,
    brokerageDocument: brokerageMatches.length,
    documents: new Set(matches.map((fee) => fee.sourceDocumentId)).size,
    institutions: new Set(matches.map((fee) => fee.institutionId)).size,
    samples: matches.slice(0, NON_DEPOSIT_SAMPLES),
    lendingWordingSamples: matches.filter((fee) => fee.verdict === "lending_wording_on_loan_document").slice(0, NON_DEPOSIT_SAMPLES),
    brokerageDocumentSamples: brokerageMatches.slice(0, NON_DEPOSIT_SAMPLES),
    keptSamples: kept.slice(0, NON_DEPOSIT_SAMPLES),
    matches,
    brokerageMatches,
    passing,
  };
}

function findingsOnly(found: ReturnType<typeof findNonDepositFees>): NonDepositFindings {
  const { matches: _matches, brokerageMatches: _brokerage, passing: _passing, ...findings } = found;
  void _matches;
  void _brokerage;
  void _passing;
  return findings;
}

async function readCursor(db: SqlTag): Promise<number> {
  const [row] = await inSavepoint(db, (scope) => scope<{ next_after_id: string | null }[]>`
    SELECT detail->>'next_after_id' AS next_after_id
      FROM agent_run_events
     WHERE event_type = ${NON_DEPOSIT_CHECK}
       AND detail->>'next_after_id' IS NOT NULL
     ORDER BY created_at DESC, id DESC
     LIMIT 1
  `);
  return num(row?.next_after_id ?? null) ?? 0;
}

/**
 * One step's share of the live re-check (see the module note). Never throws: a failed read reports
 * nothing checked, and a failed write leaves the fees as they were.
 */
export async function recheckNonDepositDocuments(
  db: SqlTag,
  options: {
    runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean; brokerageLive?: boolean; limit?: number; now?: Date;
  },
): Promise<NonDepositResult> {
  const live = options.live ?? NON_DEPOSIT_DOCUMENT_TAKEDOWN_LIVE;
  const brokerageLive = options.brokerageLive ?? BROKERAGE_DOCUMENT_TAKEDOWN_LIVE;
  const limit = Math.max(1, Math.min(options.limit ?? NON_DEPOSIT_BATCH, 20_000));
  const scoped = options.institutionId != null;
  const result: NonDepositResult = {
    live, brokerageLive, dryRun: options.dryRun, ...findingsOnly(findNonDepositFees([])), afterId: null, nextAfterId: null,
    flagged: 0, waiting: 0, cleared: 0, takenDown: [],
  };
  let rows: NonDepositRow[];
  try {
    const afterId = scoped ? 0 : await readCursor(db);
    // The document-owner join; LEFT JOINs so the cursor walks every live fee, documented or not.
    rows = await inSavepoint(db, (scope) => scope<NonDepositRow[]>`
      SELECT fp.fee_published_id, fv.fee_verified_id, fp.institution_id, fp.fee_name, fp.amount,
             fp.canonical_fee_key, fr.source_document_id, btrim(sd.document_url) AS document_url
        FROM published_fee_records fp
        LEFT JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
        LEFT JOIN source_documents sd ON sd.id = fr.source_document_id
       WHERE fp.rolled_back_at IS NULL
         AND fp.quarantined_at IS NULL
         AND fp.fee_published_id > ${afterId}
         AND (${!scoped} OR fp.institution_id = ${options.institutionId ?? 0})
       ORDER BY fp.fee_published_id
       LIMIT ${limit}::int
    `);
    if (!scoped) {
      result.afterId = afterId;
      result.nextAfterId = rows.length < limit ? 0 : Number(rows[rows.length - 1].fee_published_id);
    }
  } catch (error) {
    console.warn("[darwin] non-deposit document check read failed", error instanceof Error ? error.message : error);
    return result;
  }

  const found = findNonDepositFees(rows);
  Object.assign(result, findingsOnly(found));

  // The brokerage_document rule acts only with its own sub-switch; until then those fees pass.
  const failing = brokerageLive
    ? [...found.matches, ...found.brokerageMatches].sort((a, b) => a.feePublishedId - b.feePublishedId)
    : found.matches;
  const passing = brokerageLive ? found.passing : [...found.passing, ...found.brokerageMatches.map((fee) => fee.feePublishedId)];
  if (live && !options.dryRun && (failing.length > 0 || passing.length > 0)) {
    const look = await secondLook(db, {
      check: NON_DEPOSIT_CHECK, runId: options.runId, failing, passing, dryRun: false, now: options.now,
    });
    result.flagged = look.flagged;
    result.waiting = look.waiting;
    result.cleared = look.cleared;
    if (look.confirmed.length > 0) {
      result.takenDown = await archive(db, options.runId, look.confirmed);
      if (result.takenDown.length > 0) await recordTakedownEvent(db, options, look.confirmed, result.takenDown);
    }
  }

  // The step's report, which also carries the cursor for the next step. A dry run writes nothing.
  if (!options.dryRun) {
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${options.stepId ?? null}, ${NON_DEPOSIT_CHECK}, 'completed',
          ${`Read ${result.checked} live fee(s) (${result.withDocument} with a stored document): ${result.onMatchedDocument} came from a non-deposit document; ${result.matched} fee(s) would come down (${result.byRule.lending_category} lending category, ${result.byRule.lending_wording_on_loan_document} lending wording on a loan document; ${result.byKind.brokerage} brokerage or wealth, ${result.byKind.loan} loan, card or rate), ${result.brokerageDocument} deposit-category fee(s) on brokerage documents (${live && brokerageLive ? "sub-switch on" : "sub-switch off, they stay"}), ${result.keptDepositCategory} deposit-category and ${result.keptGenericOnRatePage} generic rate-page fee(s) stay; ${live ? `${result.flagged} flagged, ${result.takenDown.length} archived` : "switch off, would take down, nothing written"}`},
          ${JSON.stringify(nonDepositDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[darwin] non-deposit document check event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

/** Archive confirmed fees: rolled back with the reason, the verified row rejected with the flag. Never deleted. */
async function archive(db: SqlTag, runId: number, fees: NonDepositMatch[]): Promise<number[]> {
  try {
    const closed = await inSavepoint(db, async (scope) => {
      const updated = await scope<{ fee_published_id: number | string }[]>`
        UPDATE published_fee_records fp
           SET rolled_back_at = NOW(),
               rolled_back_by_batch_id = ${`darwin-non-deposit-${runId}`},
               rolled_back_reason = v.reason
          FROM unnest(${fees.map((fee) => fee.feePublishedId)}::bigint[], ${fees.map((fee) => fee.reason)}::text[])
               AS v(fee_published_id, reason)
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
                   WHEN fv.outlier_flags ? ${NON_DEPOSIT_FLAG} THEN fv.outlier_flags
                   ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${NON_DEPOSIT_FLAG}::text)
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
    console.error("[darwin] non-deposit document takedown failed", error instanceof Error ? error.message : error);
    return [];
  }
}

async function recordTakedownEvent(
  db: SqlTag,
  options: { runId: number; stepId?: number | null },
  confirmed: NonDepositMatch[],
  takenDown: number[],
): Promise<void> {
  const done = new Set(takenDown);
  const archived = confirmed.filter((fee) => done.has(fee.feePublishedId));
  try {
    await inSavepoint(db, (scope) => scope`
      INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
      VALUES (
        ${options.runId}, ${options.stepId ?? null}, 'darwin.non_deposit_document_takedown', 'completed',
        ${`Archived ${archived.length} live fee(s) read from brokerage, wealth, loan, card or rate documents on their second look`},
        ${JSON.stringify({
          version: NON_DEPOSIT_CHECK_VERSION,
          taken_down: archived.length,
          by_kind: archived.reduce<Record<string, number>>((counts, fee) => {
            counts[fee.kind] = (counts[fee.kind] ?? 0) + 1;
            return counts;
          }, {}),
          by_rule: archived.reduce<Record<string, number>>((counts, fee) => {
            counts[fee.verdict] = (counts[fee.verdict] ?? 0) + 1;
            return counts;
          }, {}),
          samples: archived.slice(0, 50).map(sampleDetail),
        })}::jsonb
      )
    `);
  } catch (error) {
    console.error("[darwin] non-deposit document takedown event failed", error instanceof Error ? error.message : error);
  }
}

function sampleDetail(fee: NonDepositMatch) {
  return {
    fee_published_id: fee.feePublishedId,
    institution_id: fee.institutionId,
    fee_name: fee.feeName,
    amount: fee.amount,
    canonical_fee_key: fee.canonicalFeeKey,
    source_document_id: fee.sourceDocumentId,
    document_url: fee.documentUrl,
    kind: fee.kind,
    rate_page: fee.ratePage,
    rule: fee.verdict,
  };
}

/** The findings as ledger detail. */
export function nonDepositFindingsDetail(found: NonDepositFindings) {
  return {
    checked: found.checked,
    with_document: found.withDocument,
    on_matched_document: found.onMatchedDocument,
    kept_deposit_category: found.keptDepositCategory,
    kept_generic_on_rate_page: found.keptGenericOnRatePage,
    would_take_down: found.matched,
    by_kind: found.byKind,
    by_rule: found.byRule,
    brokerage_document: found.brokerageDocument,
    documents: found.documents,
    institutions: found.institutions,
    samples: found.samples.map(sampleDetail),
    samples_lending_wording: found.lendingWordingSamples.map(sampleDetail),
    samples_brokerage_document: found.brokerageDocumentSamples.map(sampleDetail),
    samples_kept: found.keptSamples.map(sampleDetail),
  };
}

/** The step detail (and ledger event detail) for one step's share. */
export function nonDepositDetail(result: NonDepositResult) {
  return {
    check: NON_DEPOSIT_CHECK,
    version: NON_DEPOSIT_CHECK_VERSION,
    switch_live: result.live,
    brokerage_switch_live: result.brokerageLive,
    dry_run: result.dryRun,
    batch: NON_DEPOSIT_BATCH,
    after_id: result.afterId,
    next_after_id: result.nextAfterId,
    ...nonDepositFindingsDetail(result),
    flagged: result.flagged,
    waiting: result.waiting,
    cleared: result.cleared,
    taken_down: result.takenDown.length,
  };
}

/**
 * The dry-run count over the whole live table in one read (nothing written, no cursor), for the
 * count James sees before the switch goes on. Run it with the verify step's `non_deposit_full_count`
 * param. Reads one row per (document, fee) and classifies in JS, as the step does.
 */
export async function countNonDepositFees(db: SqlTag): Promise<NonDepositFindings | null> {
  try {
    const rows = await inSavepoint(db, (scope) => scope<NonDepositRow[]>`
      SELECT fp.fee_published_id, fv.fee_verified_id, fp.institution_id, fp.fee_name, fp.amount,
             fp.canonical_fee_key, fr.source_document_id, btrim(sd.document_url) AS document_url
        FROM published_fee_records fp
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
        JOIN source_documents sd ON sd.id = fr.source_document_id
       WHERE fp.rolled_back_at IS NULL
         AND fp.quarantined_at IS NULL
         AND btrim(COALESCE(sd.document_url, '')) <> ''
       ORDER BY fp.fee_published_id
    `);
    return findingsOnly(findNonDepositFees(rows));
  } catch (error) {
    console.warn("[darwin] non-deposit document full count failed", error instanceof Error ? error.message : error);
    return null;
  }
}

/** A pattern as a Postgres string literal (quotes doubled). */
function pgLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Postgres: `column` as `lendingWordingText` (ASCII letters and digits, lower case, space-padded words). */
function lendingWordingTextSql(column: string): string {
  return `(' ' || btrim(lower(regexp_replace(COALESCE(${column}, ''), '[^A-Za-z0-9]+', ' ', 'g'))) || ' ')`;
}

/** Postgres: `hasLendingWording(column)`. */
function lendingWordingSql(column: string): string {
  const text = lendingWordingTextSql(column);
  return `(${text} ~ ${pgLiteral(LENDING_WORDING)} AND ${text} !~ ${pgLiteral(DEPOSIT_SIDE_WORDING)})`;
}

/** Postgres: `hasRatePageLendingWording(column)`. */
function ratePageLendingWordingSql(column: string): string {
  const text = lendingWordingTextSql(column);
  return `((${text} ~ ${pgLiteral(LENDING_WORDING)} OR ${text} ~ ${pgLiteral(RATE_PAGE_LENDING_WORDING)}) AND ${text} !~ ${pgLiteral(DEPOSIT_SIDE_WORDING)})`;
}

/** Postgres: is `column` a lending category (`isLendingCategory`)? */
function lendingSql(column: string): string {
  return `COALESCE(${column} IN (${[...LENDING_CATEGORIES].sort().map((key) => `'${key}'`).join(", ")}), false)`;
}

/**
 * Live fees on a brokerage/wealth or loan/card/rate document with their verdict (`v.verdict`, the
 * Postgres mirror of `nonDepositVerdict`; the kind is `nonDepositKindSql` on the address alone),
 * plus `live`, every live fee with a stored document. Read-only.
 */
function liveNonDepositSql(): string {
  return `WITH live AS (
  SELECT fp.fee_published_id, fp.institution_id, fp.fee_name, fp.amount, fp.canonical_fee_key,
         fr.source_document_id, btrim(sd.document_url) AS document_url
    FROM published_fee_records fp
    JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
    JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
    JOIN source_documents sd ON sd.id = fr.source_document_id
   WHERE fp.rolled_back_at IS NULL AND fp.quarantined_at IS NULL AND btrim(COALESCE(sd.document_url, '')) <> ''
), documents AS MATERIALIZED (
  SELECT source_document_id, document_url,
         ${documentPathSegmentsSql("document_url")} AS path,
         ${documentHostLabelSql("document_url")} AS host
    FROM (SELECT DISTINCT source_document_id, document_url FROM live) d
), kinds AS (
  SELECT source_document_id, document_url, path, ${nonDepositKindSql("path", "host")} AS kind
    FROM documents
), judged AS MATERIALIZED (
  SELECT source_document_id, document_url, path, kind, ${ratePageSql("path", "kind")} AS rate_page
    FROM kinds
   WHERE kind IS NOT NULL
), verdicts AS (
  SELECT l.fee_published_id, l.institution_id, l.fee_name, l.amount, l.canonical_fee_key, l.source_document_id,
         j.document_url, j.path, j.kind, j.rate_page,
         CASE
           WHEN j.kind = 'brokerage' AND ${lendingSql("l.canonical_fee_key")} THEN 'lending_category'
           WHEN j.kind = 'brokerage' THEN 'brokerage_document'
           WHEN ${lendingSql("l.canonical_fee_key")} AND j.rate_page AND NOT ${ratePageLendingWordingSql("l.fee_name")} THEN 'kept_generic_on_rate_page'
           WHEN ${lendingSql("l.canonical_fee_key")} THEN 'lending_category'
           WHEN ${lendingWordingSql("l.fee_name")} THEN 'lending_wording_on_loan_document'
           ELSE 'kept_deposit_category'
         END AS verdict
    FROM live l
    JOIN judged j ON j.source_document_id = l.source_document_id
)`;
}

/** The main switch's rules (`matched`); `brokerage_document` has its own sub-switch. */
const MAIN_RULES = "v.verdict IN ('lending_category', 'lending_wording_on_loan_document')";

/**
 * The same count as one read-only SQL statement, for someone with prod access (#1442, #1518): by
 * kind, the live fees on brokerage/wealth or loan/card/rate documents, the ones the main switch
 * would take down (by rule, with their documents and institutions), the deposit-category fees on
 * brokerage documents (`brokerage_document`, its own sub-switch), the ones that stay (deposit
 * category with no lending wording; generic lending fees on a rate page), the matched documents,
 * and every live fee with a document as the base.
 */
export function nonDepositCountSql(): string {
  return `${liveNonDepositSql()}
SELECT COALESCE(v.kind, 'all kinds') AS kind,
       count(*) AS fees_on_matched_documents,
       count(*) FILTER (WHERE ${MAIN_RULES}) AS would_take_down,
       count(*) FILTER (WHERE v.verdict = 'lending_category') AS lending_category,
       count(*) FILTER (WHERE v.verdict = 'lending_wording_on_loan_document') AS lending_wording_on_loan_document,
       count(*) FILTER (WHERE v.verdict = 'brokerage_document') AS brokerage_document,
       count(*) FILTER (WHERE v.verdict = 'kept_deposit_category') AS kept_deposit_category,
       count(*) FILTER (WHERE v.verdict = 'kept_generic_on_rate_page') AS kept_generic_on_rate_page,
       count(DISTINCT v.source_document_id) FILTER (WHERE ${MAIN_RULES}) AS takedown_documents,
       count(DISTINCT v.institution_id) FILTER (WHERE ${MAIN_RULES}) AS takedown_institutions,
       count(DISTINCT v.source_document_id) FILTER (WHERE v.verdict = 'brokerage_document') AS brokerage_document_documents,
       count(DISTINCT v.source_document_id) AS matched_documents,
       (SELECT count(*) FROM live) AS live_fees_with_document
  FROM verdicts v
 GROUP BY ROLLUP (v.kind)
 ORDER BY 1;`;
}

/**
 * Read-only: the matched documents, most fees that would come down first (`limit` of them), with
 * their kind, rate-page flag, normalised path, institutions, the counts by verdict, and up to five
 * fee names with amount and category each, of what comes down, of `brokerage_document` and of
 * what stays.
 */
export function nonDepositSamplesSql(limit = 60): string {
  const rows = Math.max(1, Math.min(Math.trunc(limit), 500));
  const fee = "v.fee_name || ' $' || COALESCE(v.amount::text, '?') || ' [' || COALESCE(v.canonical_fee_key, '?') || ']'";
  return `${liveNonDepositSql()}
SELECT v.kind, v.source_document_id, v.document_url, v.path, v.rate_page,
       count(*) FILTER (WHERE ${MAIN_RULES}) AS would_take_down,
       count(*) FILTER (WHERE v.verdict = 'lending_wording_on_loan_document') AS lending_wording_on_loan_document,
       count(*) FILTER (WHERE v.verdict = 'brokerage_document') AS brokerage_document,
       count(*) FILTER (WHERE v.verdict LIKE 'kept%') AS kept,
       array_agg(DISTINCT v.institution_id) AS institution_ids,
       (array_agg(${fee} ORDER BY v.fee_published_id) FILTER (WHERE ${MAIN_RULES}))[1:5] AS sample_take_down,
       (array_agg(${fee} ORDER BY v.fee_published_id) FILTER (WHERE v.verdict = 'brokerage_document'))[1:5] AS sample_brokerage_document,
       (array_agg(${fee} ORDER BY v.fee_published_id) FILTER (WHERE v.verdict LIKE 'kept%'))[1:5] AS sample_kept
  FROM verdicts v
 GROUP BY v.kind, v.source_document_id, v.document_url, v.path, v.rate_page
 ORDER BY 6 DESC, count(*) DESC, v.source_document_id
 LIMIT ${rows};`;
}

/**
 * Read-only: every live fee on a matched document with its verdict, one row per fee (for the
 * per-fee dry run and the JS/Postgres parity check). `verdicts` limits it to those verdicts and
 * `perVerdict` keeps the first that many fees of each.
 */
export function nonDepositFeeVerdictsSql(options: { verdicts?: NonDepositVerdict[]; perVerdict?: number } = {}): string {
  const allowed = new Set<NonDepositVerdict>(["lending_category", "lending_wording_on_loan_document", "brokerage_document", "kept_deposit_category", "kept_generic_on_rate_page"]);
  const verdicts = (options.verdicts ?? []).filter((verdict) => allowed.has(verdict));
  const filter = verdicts.length > 0 ? `\n WHERE v.verdict IN (${verdicts.map((verdict) => `'${verdict}'`).join(", ")})` : "";
  const per = options.perVerdict == null ? null : Math.max(1, Math.min(Math.trunc(options.perVerdict), 1_000));
  return `${liveNonDepositSql()}
SELECT verdict, fee_published_id, institution_id, fee_name, amount, canonical_fee_key, source_document_id, document_url, kind, rate_page
  FROM (
    SELECT v.*, row_number() OVER (PARTITION BY v.verdict ORDER BY v.fee_published_id) AS n
      FROM verdicts v${filter}
  ) ranked${per == null ? "" : `\n WHERE n <= ${per}`}
 ORDER BY verdict, fee_published_id;`;
}
