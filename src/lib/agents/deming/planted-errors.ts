import { FEEDBACK_KINDS, feedbackRowReaders, type FeedbackKindEntry } from "@/lib/agents/learning/feedback-kinds";
import type { FeedbackRow, FeedbackStage } from "@/lib/agents/learning/feedback";
import { takedownFeedback, takedownSynced } from "@/lib/agents/learning/feedback-sync";
import { takedownCheck } from "@/lib/agents/learning/feedback";
import { CONFIRMED_KIND, secondLookDedupeKey } from "@/lib/agents/hamilton/second-look";
import { LIMIT_GUARD_CHECK, limitGuardReason, limitGuardVerdict } from "@/lib/agents/hamilton/limit-guard";
import { audienceLessonsLive } from "@/lib/agents/knox/audience-lessons";
import { readLessonsLive } from "@/lib/agents/knox/read-lessons";
import { BUSINESS_FOOTNOTE_REASON, BUSINESS_SCHEDULE_CHECK, footnoteMarksBusiness } from "@/lib/agents/hamilton/business-schedule";
import { DUPLICATE_COLLAPSE_REASON_PREFIX, NEAR_NAME_COLLAPSE_REASON_SUFFIX, nearNameRepeats, type NearNameRow } from "@/lib/agents/hamilton/duplicate-collapse";
import { nextReaderRung, PRIMARY_READERS, survivalFeedback, type SurvivalRow } from "@/lib/agents/rosetta/text-survival";
import { checkFeeCategory } from "@/lib/fee-category-guard";
import { SOURCE_CHECK_REASON, traceLiveFee, type InstitutionText } from "@/lib/agents/hamilton/source-check";
import { auditFeedback } from "./audit-misses";
import { errorFixProblems, judgeErrorFix, type ErrorFixFee } from "./error-fixes";
import { scoreFreshAudit, type FreshAuditFee } from "./fresh-audit";
import { judgeBank, type KeyFee } from "./knox-misses";
import { findHourlyFees, hourlyFeedbackRow, hourlyVerdict, HOURLY_CHECK, HOURLY_FREQUENCY_LIVE, HOURLY_LINE_LIVE } from "@/lib/agents/darwin/hourly-frequency-check";
import { FREQUENCY_FILL_CHECK } from "@/lib/agents/hamilton/frequency-fill";
import { BOX_SIZE_NAME, boxTableAnnualHeader, settledFrequency } from "@/lib/fee-frequency";
import { legacyAddress, legacyOpening } from "@/lib/agents/magellan/legacy-page";
import { MISSED_SCHEDULE_CHECK, missedScheduleFeedback, scheduleMissed } from "@/lib/agents/magellan/missed-schedules";

/**
 * The error loop, planted end to end (#2065). James asked "how do we know that we're not missing
 * any gaps right now?": reading the code cannot tell, so each error class the pipeline makes is
 * planted here as a fixture and walked through the loop with the real code at every link:
 *
 * 1. detected: the check that runs on live fees today flags the planted fee;
 * 2. recorded: the rows that check writes to `pipeline_feedback` name the stage that caused it;
 * 3. read: one of those rows is read (`feedbackRowRead`) by a file of the owning agent that is a
 *    registered reader of its kind (`FEEDBACK_KINDS`, #2062) and picks it out in the code that acts
 *    on it (`picksOut` is that code, not a mention elsewhere in the file);
 * 4. rerun: a fix to the owning step reaches the bank again (for an extract fix, an entry in
 *    `error-fixes.json` may name the check, #2058; for lost text, Rosetta's next reader);
 * 5. fixed: the daily re-check that would close the error judges the corrected fee right, and
 *    still judges the planted fee wrong.
 *
 * A link the loop does not have yet is listed in `KNOWN_GAPS` with the issue that owns it, so the
 * test is the gap count: an unlisted broken link fails CI, and so does a listed gap that now holds
 * (take its line out). A new error class gets a planted case here. Pure, no database.
 */

export const LOOP_LINKS = ["detected", "recorded", "read", "rerun", "fixed"] as const;
export type LoopLink = (typeof LOOP_LINKS)[number];
export type LoopOwner = "magellan" | "rosetta" | "knox" | "darwin";

export interface PlantedRecord {
  kind: string;
  aboutStage: FeedbackStage;
  checkName: string | null;
  dedupeKey?: string | null;
  /** The cause a person's hold or correction names (`evidence.cause`, #2057); some causes are unread. */
  cause?: string | null;
}

export interface PlantedError {
  key: string;
  label: string;
  owner: LoopOwner;
  /** The stage whose mistake it is. */
  stage: FeedbackStage;
  /** The real check on the planted fee: its reason, or null when it misses it. */
  detect: () => string | null;
  /** The rows the real code writes for that detection. */
  record: (reason: string) => PlantedRecord[];
  /** The owner's file that acts on those rows, and the name in it that picks them out. */
  reader: { file: string; picksOut: string } | null;
  /** True when a fix to the owning step reaches the bank again (`source` reads a repository file). Null: no such path. */
  rerun: ((source: (file: string) => string | null) => boolean) | null;
  /** The daily re-check on the planted fee and on the corrected one. Null: no such re-check. */
  recheck: { planted: () => boolean; corrected: () => boolean } | null;
}

const rows = (built: FeedbackRow[]): PlantedRecord[] =>
  built.map((row) => ({
    kind: String(row.kind), aboutStage: row.aboutStage, checkName: row.checkName ?? null, dedupeKey: row.dedupeKey ?? null,
    cause: typeof row.evidence?.cause === "string" ? row.evidence.cause : null,
  }));

// One bank, one schedule, one day, for every planted fee.
const INSTITUTION = 990001;
const DOCUMENT = 990010;
const ERROR_AT = "2026-10-20T00:00:00Z";
const RERUN_AT = "2026-10-22T00:00:00Z";
const SCHEDULE_URL = "https://bank.example/disclosures/fee-schedule.pdf";

function liveFee(id: number, fields: Partial<FreshAuditFee>): ErrorFixFee {
  return {
    fee_id: id, fee_published_id: id, lineage_ref: id, fee_raw_id: id, institution_id: INSTITUTION, source: "knox",
    source_document_id: DOCUMENT, document_url: SCHEDULE_URL, canonical_fee_key: "overdraft", fee_name: "Overdraft Fee",
    amount: 35, amount_kind: null, rate_percent: null, reread_at: RERUN_AT, published_at: RERUN_AT, ...fields,
  };
}

function texts(text: string): InstitutionText[] {
  return [{ source_document_id: DOCUMENT, normalized_text: text }];
}

/** Hamilton's takedown of a fee for `reason`, as the takedown sync reads it back: none for a reason it skips. */
function takedown(id: number, reason: string, fee: { canonical_fee_key: string; fee_name: string; amount: number }): FeedbackRow[] {
  if (!takedownSynced(reason)) return [];
  return takedownFeedback({
    fee_published_id: id, institution_id: INSTITUTION, source_document_id: DOCUMENT, source_url: SCHEDULE_URL, fee_raw_id: id,
    fee_verified_id: id, source: "knox", outlier_flags: [], rolled_back_reason: reason, verify_attempt_id: null, verify_version: null, ...fee,
  } as Parameters<typeof takedownFeedback>[0], null);
}

/** The second look's confirmed row for a check's takedown (`second-look.ts`). */
function confirmed(check: string, id: number): PlantedRecord {
  return { kind: CONFIRMED_KIND, aboutStage: "publish", checkName: check, dedupeKey: secondLookDedupeKey(check, id) };
}

/** Can an `error-fixes.json` entry name rows of this check at this stage (#2058)? */
function errorFixCanName(stage: FeedbackStage, check: string): boolean {
  return errorFixProblems([{ pr: 1, stage: stage as "extract", merged_on: "2026-10-21", knox_version: 1, checks: [check] }]).length === 0;
}

/** The error loop's re-check of a named error against the fee the re-run extracted (#2058). */
function errorFixJudges(fee: ErrorFixFee, text: string, check: string): "now_matches" | "still_wrong" | "unknown" | "not_reproduced" {
  const judgement = judgeErrorFix(
    { fee_published_id: 1, canonical_fee_key: fee.canonical_fee_key, created_at: ERROR_AT, source_document_id: DOCUMENT, document_replaced: false },
    [fee],
    texts(text),
  );
  return judgement.verdict === "still_wrong" && judgement.check !== check ? "unknown" : judgement.verdict;
}

// The wrong category: a home-equity line's stop payment read as the account's stop-payment fee.
const CATEGORY_TEXT = "Fee Schedule\nStop payment of Home Equity Line checks $25.00\nStop Payment Fee $30.00";
const CATEGORY_PLANTED = liveFee(901, { canonical_fee_key: "stop_payment", fee_name: "Stop payment of Home Equity Line checks", amount: 25 });
const CATEGORY_CORRECTED = liveFee(902, { canonical_fee_key: "stop_payment", fee_name: "Stop Payment Fee", amount: 30 });

// A limit read as a fee: a daily transfer limit published as a price.
const LIMIT_PLANTED = { canonical_fee_key: "zelle_transfer", fee_name: "Zelle daily transfer limit", amount: 2500, conditions: null };
const LIMIT_CORRECTED = { canonical_fee_key: "zelle_transfer", fee_name: "Zelle Transfer Fee", amount: 0, conditions: null };

// The wrong audience: a business-only fee (its footnote says so) published as a consumer fee.
const AUDIENCE_TEXT = [
  "Fee Schedule",
  "Overdraft - Insufficient Funds / Uncollected2 $40.00",
  "Redeposit/Return Item Charge $10.00",
  "2 Created by check, in-person withdrawal, ATM withdrawal, or other electronic",
  "means. Only applicable to business accounts.",
].join("\n");

// A duplicate: one printed line published twice under near names.
const DUPLICATE_TEXT = "Fee Schedule\nStop Payment ...... $35.00\nOverdraft Fee $35.00";
const nearRow = (id: number, name: string): NearNameRow => ({
  fee_published_id: id, institution_id: INSTITUTION, source_document_id: DOCUMENT, canonical_fee_key: "stop_payment", variant_type: null,
  amount: 35, fee_name: name, frequency: null, fee_audience: null, published_at: "2026-10-19T00:00:00Z",
});
const duplicateCollapses = (rowsLive: NearNameRow[]) => nearNameRepeats(rowsLive, new Map([[String(DOCUMENT), DUPLICATE_TEXT]])).collapses;

// Lost text: a web page whose reader dropped most of the fees Knox had read from it.
const survival = (live: number, lost: number, reader: string): SurvivalRow => ({
  text_id: 1, source_document_id: DOCUMENT, institution_id: INSTITUTION, source_url: "https://bank.example/fees", text_hash: `h-${reader}`,
  reader, live, lost, other_down: 0, reasons: null,
});

// A missed fee: a fee on the bank's schedule that Knox's read of the page leaves out.
const KEY_FEE: KeyFee = {
  feeId: 1, institutionId: INSTITUTION, documentUrl: SCHEDULE_URL, documentType: "text_pdf", canonicalKey: "wire_domestic_outgoing",
  amount: 25, amountKind: "fixed", sourceLine: "Outgoing wire $25.00",
};
const keyText = (text: string) => ({ textId: 1, sourceDocumentId: DOCUMENT, textHash: "h", text });

// A discontinued account's fee: a row the schedule keeps for accounts the bank no longer opens (#2070).
const DISCONTINUED_TEXT = "Fee Schedule\nBasic Checking Monthly Service Charge | $3.00\nMonthly Service Charge (80 Suffix) daily balance below $500 | $5.00 (this account no longer offered)";
const DISCONTINUED_PLANTED = liveFee(951, { canonical_fee_key: "monthly_maintenance", fee_name: "Monthly Service Charge (80 Suffix)", amount: 5 });
const DISCONTINUED_CORRECTED = liveFee(952, { canonical_fee_key: "monthly_maintenance", fee_name: "Basic Checking Monthly Service Charge", amount: 3 });
const sourceCheckReason = (fee: ErrorFixFee, text: string = DISCONTINUED_TEXT): string | null => {
  const verdict = traceLiveFee(fee, texts(text));
  return verdict.kind === "untraceable" ? `${SOURCE_CHECK_REASON}:${verdict.reason}` : null;
};

// A legacy accounts page stored as a fee page (#2070): every fee on it is a discontinued account's.
const LEGACY_PAGE_URL = "https://bank.example/disclosures/accounts-no-longer-offered.pdf";
const LEGACY_PAGE_TEXT = "Accounts No Longer Offered\nGold Checking\nMonthly Fee | $15.00\nPaper Statement | $3.00";
const LEGACY_PAGE_PLANTED = liveFee(961, { canonical_fee_key: "monthly_maintenance", fee_name: "Monthly Fee", amount: 15, document_url: LEGACY_PAGE_URL });
const CURRENT_PAGE_TEXT = "Fee Schedule\nEssential Checking\nMonthly Fee | $6.00\nPaper Statement | $3.00";
const LEGACY_PAGE_CORRECTED = liveFee(962, { canonical_fee_key: "monthly_maintenance", fee_name: "Monthly Fee", amount: 6 });

// A second schedule Magellan missed: the answer key's document for the bank, never stored (#2070).
const MISSED_SCHEDULE_URL = "https://bank.example/disclosures/overdraft-fee-disclosure.pdf";
const missedScheduleRow = () => missedScheduleFeedback({ institutionId: INSTITUTION, documentUrl: MISSED_SCHEDULE_URL, documentType: "pdf", categories: ["overdraft"], evidenceFeeIds: [971] });

// The weekly live check's misses that no loop caught (#2066, W43): every check that runs on live fees
// passes these fees. Each fee and line is copied from a W43 miss (its fee id in the comment).
interface WeeklyMiss { fee: ErrorFixFee; text: string; line: string; frequency: string | null }

/**
 * Every check that runs on live fees today, on one weekly-check miss: Deming's daily audit (the shared
 * source check, the category guard, the evidence, perk and name checks), Hamilton's frequency fill
 * (the fee's own line, and a box table's annual header) and Darwin's hourly re-check. The first check
 * that flags it, or null when none does: a gap, not a pass.
 */
function liveChecksFlag({ fee, text, line, frequency }: WeeklyMiss): string | null {
  const audit = scoreFreshAudit([fee], new Map([[INSTITUTION, texts(text)]])).misses[0]?.check;
  if (audit) return audit;
  const amount = Number(fee.amount);
  const settled = settledFrequency(line, amount, frequency, fee.canonical_fee_key);
  if ((settled ?? null) !== frequency) return FREQUENCY_FILL_CHECK;
  if (frequency == null && BOX_SIZE_NAME.test(fee.fee_name) && boxTableAnnualHeader(text, line, amount) === "annual") return FREQUENCY_FILL_CHECK;
  const hourly = hourlyVerdict(fee.fee_name, fee.canonical_fee_key, frequency, line, amount);
  if (hourly?.action === "set" && HOURLY_FREQUENCY_LIVE && (hourly.basis === "name" || HOURLY_LINE_LIVE)) return HOURLY_CHECK;
  return null;
}

// Hourly shown flat (W43: 42 of the 56 caught-but-not-routed misses): Darwin's hourly re-check sets
// the frequency, but its frequency_filled row is a kind no Knox file reads, so Knox reads the next
// bank's "/hour" the same way. W43, fee 107927 "Account research fee" $25: its stored excerpt, verbatim;
// Darwin's hourly check filled it from blank (its frequency_filled row).
const HOURLY_LINE = "Account research fee................................... $25.00 per hour, $25.00 minimum Online Bill Payment check copy mailed to merchant .............................. $5.00";
const HOURLY: WeeklyMiss = {
  fee: liveFee(961, { canonical_fee_key: "account_research", fee_name: "Account research fee", amount: 25 }),
  text: `Fee Schedule\n${HOURLY_LINE}`, line: HOURLY_LINE, frequency: null,
};
const hourlyRows = () => findHourlyFees([{
  fee_published_id: 961, fee_verified_id: 961, institution_id: INSTITUTION, fee_name: HOURLY.fee.fee_name, amount: 25,
  canonical_fee_key: "account_research", frequency: null, source_line: HOURLY_LINE,
}]).matches.filter((match) => match.action === "set").map((match) => hourlyFeedbackRow(match, null));

// An annual rent shown flat (W43, fee 66241 "10 x 10" $150): the "Annual Rental" heading sits more than
// 12 lines above the row, past the box-table header's look-back, so the fill leaves it blank.
const BOX_SIZES = ["2 x 5: $40.00", "3 x 5: $40.00", "4 x 5: $50.00", "5 x 5: $60.00", "3 x 10: $70.00", "4 x 10: $80.00", "5 x 10: $90.00", "6 x 10: $95.00", "7 x 10: $100.00", "10 x 10: $150.00"];
const ANNUAL: WeeklyMiss = {
  fee: liveFee(962, { canonical_fee_key: "safe_deposit_box", fee_name: "10 x 10", amount: 150 }),
  text: ["Fee Schedule", "", "Safe Deposit Box Annual Rental", "", ...BOX_SIZES.flatMap((size) => [size, ""]), "Statement Services"].join("\n"),
  line: "10 x 10: $150.00", frequency: null,
};

// A price ladder shown as one flat price (W43, fee 142980): three tiers on one row, published as the first.
const TIER_LINE = "Credit/Debit/ATM Card Replacement Rush (2 Business Days) Rush (Overnight) | $25 $35 $50";
const TIER: WeeklyMiss = {
  fee: liveFee(963, { canonical_fee_key: "rush_card", fee_name: "Credit/Debit/ATM Card Replacement Rush (2 Business Days) Rush (Overnight)", amount: 25 }),
  text: `Fee Schedule\nCheck Copy | $5\n${TIER_LINE}\nForeign Item | Cost as Incurred`, line: TIER_LINE, frequency: null,
};

// A garbled name (W43, fee 49726 "2.00 Inactive Checking and Money Mark"): two columns read across, so
// the name opens on the price and is cut mid-word. (W43's "Courtesy Pay N/A" is not planted: the name
// check flags it today, but the daily audit reads only a sample, so it never reached that fee.)
// The text is the document's two-column lines; the line is the fee's stored excerpt, verbatim.
const NAME_LINE = "Excessive Withdrawal Fee (Savings Accts only; 4 free per month then fee each time) 2.00 Inactive Checking and Money Market Account (monthly after 6 months no activity) $2.00";
const GARBLED_NAME: WeeklyMiss = {
  fee: liveFee(964, { canonical_fee_key: "dormant_account", fee_name: "2.00 Inactive Checking and Money Mark", amount: 2 }),
  text: ["Checking, Money Market and Savings Accounts",
    "Excessive Withdrawal Fee (Savings Accts only; 4 free per | 2.00 Inactive Checking and Money Market Account (monthly $2.00",
    "month then fee each time) | after 6 months no activity)",
    "NSF, Courtesy Pay, ACH Returned Item, Loan Payment | $35.00 Re-Deposit Returned Item (each item) $10.00"].join("\n"),
  line: NAME_LINE, frequency: "monthly",
};

// A wrong category the guard passes (W43: 5 of the 23 with a fee id, e.g. fee 124105): a safe deposit
// box's late charge filed as a loan's late payment fee; its name alone reads as a late payment.
const LATE_LINE = "Late Payment Fee | $15.00";
const BOX_LATE: WeeklyMiss = {
  fee: liveFee(965, { canonical_fee_key: "late_payment", fee_name: "Late Payment Fee", amount: 15 }),
  text: ["Table data for Schedule of Fees - Safe Deposit Boxes/Annual Fee 08-10-2020", "", "Type (Description) | Amount | Alert Me", "",
    "3\" x 5\" | $50.00", "", "10\" x 10\" | $175.00", "", LATE_LINE, "", "Lost Key | $50.00", "", "Box Drilling | $250.00"].join("\n"),
  line: LATE_LINE, frequency: null,
};

/** A weekly-check miss no check flags: nothing is detected, so no link past it can hold. */
function unflagged(key: string, label: string, miss: WeeklyMiss): PlantedError {
  return {
    key, label, owner: "knox", stage: "extract",
    detect: () => liveChecksFlag(miss),
    // No check flags it, so no row is written.
    record: () => [],
    reader: null,
    rerun: null,
    recheck: null,
  };
}

export const PLANTED_ERRORS: PlantedError[] = [
  {
    key: "wrong_document",
    label: "a fee read from the wrong document (an article, not the schedule)",
    owner: "magellan",
    stage: "discover",
    detect: () => scoreFreshAudit([liveFee(911, { document_url: "https://bank.example/blog/what-is-overdraft" })], new Map([[INSTITUTION, texts("Overdraft Fee $35.00")]])).misses[0]?.check ?? null,
    record: () => rows(auditFeedback(
      scoreFreshAudit([liveFee(911, { document_url: "https://bank.example/blog/what-is-overdraft" })], new Map([[INSTITUTION, texts("Overdraft Fee $35.00")]])).misses,
      "2026-10-20", null,
    )),
    reader: { file: "src/lib/agents/magellan/discovery.ts", picksOut: "WHERE f.kind = ${AUDIT_FEEDBACK_KIND}" },
    // The reader is the re-run: Magellan's stale-link search reads the discover miss and searches
    // the bank's link again (#2558).
    rerun: (source) => Boolean(source("src/lib/agents/magellan/discovery.ts")?.includes("WHERE f.kind = ${AUDIT_FEEDBACK_KIND}")),
    recheck: null,
  },
  {
    key: "lost_text",
    label: "fees lost when a page was read into text",
    owner: "rosetta",
    stage: "read",
    detect: () => (survivalFeedback(survival(2, 8, PRIMARY_READERS.html), null)?.kind === "text_lost_fees" ? "text_lost_fees" : null),
    record: () => rows([survivalFeedback(survival(2, 8, PRIMARY_READERS.html), null)!]),
    reader: { file: "src/lib/agents/rosetta/read.ts", picksOut: "TEXT_SURVIVAL_CHECK" },
    // The next read of the page uses the next reader up, not the one that lost the fees.
    rerun: () => nextReaderRung("html", { lastReader: PRIMARY_READERS.html, lastTextLost: true }) != null,
    recheck: {
      planted: () => survivalFeedback(survival(2, 8, PRIMARY_READERS.html), null)?.kind === "text_lost_fees",
      corrected: () => survivalFeedback(survival(10, 0, nextReaderRung("html", { lastReader: PRIMARY_READERS.html, lastTextLost: true })!), null)?.kind === "text_held_up",
    },
  },
  {
    key: "limit_as_fee",
    label: "a transaction limit read as a fee",
    owner: "knox",
    stage: "extract",
    detect: () => { const verdict = limitGuardVerdict(LIMIT_PLANTED); return verdict ? limitGuardReason(verdict) : null; },
    record: (reason) => [...rows(takedown(921, reason, LIMIT_PLANTED)), confirmed(LIMIT_GUARD_CHECK, 921)],
    // Knox's takedown lessons act on the limit guard's confirmed takedowns and skip every other producer.
    reader: { file: "src/lib/agents/knox/takedown-lessons.ts", picksOut: `row.check_name!=="${LIMIT_GUARD_CHECK}"` },
    // The error loop matches rows by the check name they carry; the sync files a limit takedown under the
    // guard's own check (#2062), which the daily re-check does not re-run yet.
    rerun: () => errorFixCanName("extract", takedownCheck(limitGuardReason(limitGuardVerdict(LIMIT_PLANTED)!))),
    recheck: { planted: () => limitGuardVerdict(LIMIT_PLANTED) != null, corrected: () => limitGuardVerdict(LIMIT_CORRECTED) == null },
  },
  {
    key: "wrong_category",
    label: "a fee filed under the wrong category",
    owner: "knox",
    stage: "extract",
    detect: () => { const verdict = checkFeeCategory(CATEGORY_PLANTED.canonical_fee_key, CATEGORY_PLANTED.fee_name); return verdict.ok ? null : `category_guard:${verdict.code}: ${verdict.reason}`; },
    record: (reason) => rows(takedown(901, reason, { canonical_fee_key: "stop_payment", fee_name: CATEGORY_PLANTED.fee_name, amount: 25 })),
    // Read at extract; a lesson forms once the same name is also seen right at enough banks (`lessonsFrom`).
    reader: { file: "src/lib/agents/knox/lessons.ts", picksOut: "f.kind IN ('wrong_category'" },
    rerun: () => errorFixCanName("extract", "hamilton.category_guard"),
    recheck: {
      planted: () => errorFixJudges(CATEGORY_PLANTED, CATEGORY_TEXT, "hamilton.category_guard") === "still_wrong",
      corrected: () => errorFixJudges(CATEGORY_CORRECTED, CATEGORY_TEXT, "hamilton.category_guard") === "now_matches",
    },
  },
  {
    key: "wrong_audience",
    label: "a business-only fee published as a consumer fee",
    owner: "knox",
    stage: "extract",
    detect: () => (footnoteMarksBusiness(AUDIENCE_TEXT, "Overdraft - Insufficient Funds / Uncollected") ? BUSINESS_FOOTNOTE_REASON : null),
    record: (reason) => [...rows(takedown(931, reason, { canonical_fee_key: "nsf", fee_name: "Overdraft - Insufficient Funds / Uncollected", amount: 40 })), confirmed(BUSINESS_SCHEDULE_CHECK, 931)],
    // Knox's audience lessons read the business schedule's confirmed takedowns as the document's business
    // fees (#2062), but act on them only with KNOX_AUDIENCE_LESSONS_LIVE on: off, nothing reads them.
    reader: audienceLessonsLive() ? { file: "src/lib/agents/knox/audience-lessons.ts", picksOut: "f.check_name = ${BUSINESS_SCHEDULE_CHECK}" } : null,
    rerun: () => errorFixCanName("extract", BUSINESS_SCHEDULE_CHECK),
    recheck: null,
  },
  {
    key: "duplicate",
    label: "one printed fee published twice",
    owner: "knox",
    stage: "extract",
    detect: () => {
      const [collapse] = duplicateCollapses([nearRow(941, "Stop Payment"), nearRow(942, "Stop Payment ......")]);
      return collapse ? `${DUPLICATE_COLLAPSE_REASON_PREFIX}${collapse.keptFeePublishedId}${NEAR_NAME_COLLAPSE_REASON_SUFFIX}` : null;
    },
    // The page prints the dotted name at the price, so the bare one comes down.
    record: (reason) => rows(takedown(941, reason, { canonical_fee_key: "stop_payment", fee_name: "Stop Payment", amount: 35 })),
    // Knox's read lessons hold a same-document duplicate's read when the text reads its kept name too
    // (#2062), but act only with KNOX_READ_LESSONS_LIVE on: off, nothing reads them.
    reader: readLessonsLive() ? { file: "src/lib/agents/knox/read-lessons.ts", picksOut: "f.kind = 'duplicate'" } : null,
    rerun: null,
    recheck: null,
  },
  {
    key: "discontinued_account",
    label: "a fee priced for an account the bank no longer offers",
    owner: "knox",
    stage: "extract",
    detect: () => sourceCheckReason(DISCONTINUED_PLANTED),
    record: (reason) => rows(takedown(951, reason, { canonical_fee_key: "monthly_maintenance", fee_name: DISCONTINUED_PLANTED.fee_name, amount: 5 })),
    // Knox learns the class from the shared check (rules v113); no Knox file reads its takedown rows.
    reader: null,
    rerun: () => errorFixCanName("extract", "hamilton.source_check"),
    recheck: {
      planted: () => errorFixJudges(DISCONTINUED_PLANTED, DISCONTINUED_TEXT, "hamilton.source_check") === "still_wrong",
      corrected: () => errorFixJudges(DISCONTINUED_CORRECTED, DISCONTINUED_TEXT, "hamilton.source_check") === "now_matches",
    },
  },
  {
    key: "legacy_page",
    label: "a fee read from a legacy or discontinued accounts page",
    owner: "magellan",
    stage: "discover",
    // The shared check refuses the fee under the page's own title (`discontinuedRow`); Magellan now refuses
    // such a page before it is stored (`legacy-page.ts`), but a page stored before is not reviewed again.
    detect: () => sourceCheckReason(LEGACY_PAGE_PLANTED, LEGACY_PAGE_TEXT),
    record: (reason) => rows(takedown(961, reason, { canonical_fee_key: "monthly_maintenance", fee_name: "Monthly Fee", amount: 15 })),
    reader: null,
    rerun: null,
    recheck: {
      planted: () => legacyOpening(LEGACY_PAGE_TEXT) && legacyAddress(LEGACY_PAGE_URL) && errorFixJudges(LEGACY_PAGE_PLANTED, LEGACY_PAGE_TEXT, "hamilton.source_check") === "still_wrong",
      corrected: () => !legacyOpening(CURRENT_PAGE_TEXT) && !legacyAddress(SCHEDULE_URL) && errorFixJudges(LEGACY_PAGE_CORRECTED, CURRENT_PAGE_TEXT, "hamilton.source_check") === "now_matches",
    },
  },
  {
    key: "missed_second_schedule",
    label: "a second fee schedule Magellan never stored",
    owner: "magellan",
    stage: "discover",
    // Deming's answer-key replay finds the key's document is not among the bank's stored ones.
    detect: () => (scheduleMissed(MISSED_SCHEDULE_URL, [SCHEDULE_URL]) ? MISSED_SCHEDULE_CHECK : null),
    record: () => rows([missedScheduleRow()]),
    reader: { file: "src/lib/agents/magellan/missed-schedules.ts", picksOut: "WHERE f.kind = ${MISSED_SECOND_SCHEDULE_KIND}" },
    // The reader is the re-run: the companion finder searches the bank first, past its monthly recheck,
    // in discovery and in rescue mode, and checks the missed address before anything else.
    rerun: (source) => Boolean(
      source("src/lib/agents/magellan/second-document.ts")?.includes("missedIds: [...missed.urls.keys()]")
      && source("src/lib/agents/magellan/second-document.ts")?.includes("for (const url of row.missed_urls ?? [])")
      && source("src/lib/agents/magellan/discovery.ts")?.includes("missedOnly: !wantSecondDocuments"),
    ),
    // The replay judges the bank again each day: the row stays wanted only while the address is unstored.
    recheck: {
      planted: () => scheduleMissed(MISSED_SCHEDULE_URL, [SCHEDULE_URL]),
      corrected: () => !scheduleMissed(MISSED_SCHEDULE_URL, [SCHEDULE_URL, "https://www.bank.example/disclosures/overdraft-fee-disclosure.pdf/"]),
    },
  },
  {
    key: "missed_fee",
    label: "a fee on the schedule that Knox did not read",
    owner: "knox",
    stage: "extract",
    detect: () => (judgeBank([KEY_FEE], keyText("Fee Schedule\nStop Payment Fee | $30.00"))[0].verdict === "missed" ? "missed" : null),
    // Recorded only as a Deming test case (`eval_cases`), not as a row any agent's lessons read.
    record: () => [],
    reader: null,
    rerun: null,
    // Deming's daily replay of Knox's answer-key misses judges the fee again on the current text.
    recheck: {
      planted: () => judgeBank([KEY_FEE], keyText("Fee Schedule\nStop Payment Fee | $30.00"))[0].verdict === "missed",
      corrected: () => judgeBank([KEY_FEE], keyText("Fee Schedule\nStop Payment Fee | $30.00\nOutgoing wire | $25.00"))[0].verdict === "read",
    },
  },
  {
    key: "amount_hourly_flat",
    label: "an hourly price shown as a flat charge",
    owner: "knox",
    stage: "extract",
    detect: () => liveChecksFlag(HOURLY),
    record: () => rows(hourlyRows()),
    // Knox's read lessons read Darwin's frequency_filled row at extract and write the hour at the
    // document's next read, but only with KNOX_READ_LESSONS_LIVE on; off, no Knox file reads it (#2062).
    reader: readLessonsLive() ? { file: "src/lib/agents/knox/read-lessons.ts", picksOut: "WHERE f.kind IN ('frequency_filled', 'frequency_corrected', 'frequency_cleared')" } : null,
    rerun: null,
    // Darwin's hourly re-check runs on every verify: it still sets the planted fee, and leaves it once hourly.
    recheck: {
      planted: () => hourlyVerdict(HOURLY.fee.fee_name, "account_research", null, HOURLY_LINE, 25)?.action === "set",
      corrected: () => hourlyVerdict(HOURLY.fee.fee_name, "account_research", "hourly", HOURLY_LINE, 25) == null,
    },
  },
  unflagged("amount_annual_flat", "an annual rent shown as a flat charge", ANNUAL),
  unflagged("amount_tier_flat", "a price ladder shown as its first price", TIER),
  unflagged("garbled_name", "a name glued to another column's words", GARBLED_NAME),
  unflagged("category_unflagged", "a wrong category the category guard passes", BOX_LATE),
];

/**
 * The links each planted class does not have yet, with the issue that owns each one. A gap is a
 * known debt, not a pass: the test fails when a link listed here starts to hold, so the list only
 * shrinks.
 */
export const KNOWN_GAPS: Record<string, Partial<Record<LoopLink, number>>> = {
  // Magellan re-searches the link (#2558), but nothing re-checks that the new document fixed the fee.
  wrong_document: { fixed: 2058 },
  // The error loop names only checks its daily re-check re-runs; the limit guard is not one.
  limit_as_fee: { rerun: 2058 },
  // Knox's audience lessons read the business-schedule second look (#2062), but only once
  // KNOX_AUDIENCE_LESSONS_LIVE is on, so the read gap stays until then. That row names publish: the
  // takedown sync skips business-schedule reasons (a whole business document is Magellan's lesson), so
  // a business-only footnote on a mixed schedule leaves no row naming extract.
  wrong_audience: { recorded: 2062, ...(audienceLessonsLive() ? {} : { read: 2062 }), rerun: 2058, fixed: 2058 },
  // Knox's read lessons read a same-document duplicate (#2062), but only once KNOX_READ_LESSONS_LIVE is
  // on, so the read gap stays until then.
  duplicate: { ...(readLessonsLive() ? {} : { read: 2062 }), rerun: 2058, fixed: 2058 },
  // #2070: the takedown sync records a discontinued account's takedown as its own kind, but only its
  // restore detection reads it; Knox learns the class from the shared check, not from the rows.
  discontinued_account: { read: 2062 },
  // #2070: Magellan refuses a legacy page before it is stored, but a page stored before is not reviewed
  // again, and the takedown of its fees names Knox's read (extract), not the document; so no Magellan
  // reader learns from it yet.
  legacy_page: { recorded: 2070, read: 2070, rerun: 2070 },
  // A missed fee is a Deming test case, not a feedback row, so Knox never learns from it.
  missed_fee: { recorded: 2062, read: 2062, rerun: 2058 },
  // #2066 (W43 weekly check): Darwin's hourly re-check fixes the fee, but its frequency_filled row has
  // a Knox reader only with KNOX_READ_LESSONS_LIVE on, and no error fix re-runs extraction on it.
  amount_hourly_flat: { ...(readLessonsLive() ? {} : { read: 2062 }), rerun: 2067 },
  // #2066 (W43: 122 wrong amounts no check caught): the price is on the line, so the source check
  // passes it; only its basis (a year, a ladder) is lost. Amount classes are #2067's.
  amount_annual_flat: { detected: 2067, recorded: 2067, read: 2067, rerun: 2067, fixed: 2067 },
  amount_tier_flat: { detected: 2067, recorded: 2067, read: 2067, rerun: 2067, fixed: 2067 },
  // #2066 (W43: 22 garbled names no check caught): the name quality check reads glyphs and cut
  // sentences, not another column's words glued to the label.
  garbled_name: { detected: 2066, recorded: 2066, read: 2066, rerun: 2066, fixed: 2066 },
  // #2066 (W43: 34 wrong categories the guard did not flag): the guard is a keyword check on the
  // name, and the name alone is a fine late payment fee; category lessons are #2068's.
  category_unflagged: { detected: 2068, recorded: 2068, read: 2068, rerun: 2068, fixed: 2068 },
};

function kindEntry(kind: string): FeedbackKindEntry | undefined {
  return (FEEDBACK_KINDS as Record<string, FeedbackKindEntry>)[kind];
}

export interface LoopWalk {
  key: string;
  links: Record<LoopLink, boolean>;
  /** Why each link failed, in words. */
  why: Partial<Record<LoopLink, string>>;
}

/** Walks one planted class through the loop. `source` reads a repository file's text. */
export function walkLoop(planted: PlantedError, source: (file: string) => string | null): LoopWalk {
  const why: LoopWalk["why"] = {};
  const fail = (link: LoopLink, reason: string) => { why[link] = reason; return false; };

  const reason = planted.detect();
  const detected = reason != null || fail("detected", "the check passed the planted fee");
  const recorded_rows = reason == null ? [] : planted.record(reason);
  const recorded = recorded_rows.some((row) => row.aboutStage === planted.stage)
    || fail("recorded", recorded_rows.length === 0 ? "no feedback row is written" : `rows name ${[...new Set(recorded_rows.map((row) => row.aboutStage))].join(", ")}, not ${planted.stage}`);

  let read = false;
  if (!planted.reader) fail("read", `no ${planted.owner} file reads it`);
  else {
    const text = source(planted.reader.file);
    const reader = planted.reader;
    // The reader must read the row itself, at its stage and from its check (#2066), not only be a
    // registered reader of the kind.
    const readRow = recorded_rows.find((row) => kindEntry(row.kind) != null
      && feedbackRowReaders({ kind: row.kind, about_stage: row.aboutStage, check_name: row.checkName, dedupe_key: row.dedupeKey, cause: row.cause }).includes(reader.file));
    if (!reader.file.startsWith(`src/lib/agents/${planted.owner}/`)) fail("read", `${reader.file} is not ${planted.owner}'s`);
    else if (!readRow) fail("read", `${reader.file} is not a registered reader of a row this check writes`);
    else if (text == null || !text.includes(reader.picksOut)) fail("read", `${reader.file} never names ${reader.picksOut}`);
    else read = true;
  }

  const rerun = planted.rerun ? planted.rerun(source) || fail("rerun", "a fix to the step never reaches the bank again") : fail("rerun", "no re-run path");
  const fixed = planted.recheck
    ? (planted.recheck.planted() && planted.recheck.corrected()) || fail("fixed", "the re-check cannot tell the corrected fee from the planted one")
    : fail("fixed", "no daily re-check judges it gone");

  return { key: planted.key, links: { detected, recorded, read, rerun, fixed }, why };
}
