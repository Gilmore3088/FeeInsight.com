/**
 * Every `pipeline_feedback` kind and the code that reads it (#2062). A kind nobody reads teaches no
 * agent: on 2026-10-16 1,422 "wrong" rows had been recorded that nothing consumed. `FeedbackKind`
 * (`feedback.ts`) is this registry's keys, so a writer that records a kind not listed here fails
 * the type check in CI; listing it means saying who reads it.
 *
 * Each kind is one of:
 * - `readers`: the files whose code reads its rows to act or learn (an agent's lessons, a re-read
 *   queue, a restore). `readStages` / `unreadChecks` narrow that when only some rows are read: a
 *   row at another stage, or from one of those checks, is unread.
 * - `unread`: no agent reads it yet. Its rows are the debt the morning brief counts every day
 *   (`unreadFeedbackSummary`); the reason names the agent that should learn from them.
 * - `record`: a weight-0 record by design (an audit trail, a rollback value, a cursor), read by
 *   its writer or an admin page, not a lesson for any agent.
 *
 * The takedown sync writes each takedown twice, at extract and at verify (`feedback-sync.ts`); its
 * restore detection reads only the extract row. So a kind the sync is the only reader of is read
 * only at extract, and its verify row is unread; it is also read only on the sync's own key
 * (`readKey`), so another writer's row of that kind is unread too. A kind written outside this list (the sync's
 * open-ended fallback, `takedownKind`, or hand-run SQL) is counted as unread by the brief, except
 * the sync's extract rows.
 */

import { readLessonsLive } from "@/lib/agents/knox/read-lessons-switch";

type Reader = {
  readers: readonly string[];
  /** Only rows about these stages are read. */
  readStages?: readonly string[];
  /** Rows from these checks are not read. */
  unreadChecks?: readonly string[];
  /** Rows from these checks are read at any stage, `readStages` aside. A check name matches on
   * its part before the first ":", as the readers match it. */
  anyStageChecks?: readonly string[];
  /** Rows whose `evidence.cause` is one of these are not read: a person's hold or correction names
   * its cause (#2057), and some causes have no reader yet. */
  unreadCauses?: readonly string[];
  /** At these stages only rows from these checks and reporters are read (the stage must also be
   * in `readStages`); any other row there is unread. A check name matches whole. */
  stageOnly?: readonly StageOnly[];
  /** Per reader file, the rows it reads when narrower than the kind's rule (#2066): only rows about
   * these stages, or only rows from these checks (matched on the part before the first ":"). A
   * reader not listed here reads every row the kind's rule reads. `feedbackRowReaders` applies it,
   * so a row counts as routed to an agent only when that agent's own reader reads it. */
  readerScopes?: Readonly<Record<string, ReaderScope>>;
  /** Only rows whose `dedupe_key` matches this SQL LIKE pattern are read. A kind the takedown sync's
   * restore detection is the only reader of uses `TAKEDOWN_SYNC_EXTRACT_KEY`: that query selects rows
   * by the sync's own key, not by kind and stage, so another writer's row of the same kind is unread. */
  readKey?: string;
  note?: string;
};
type ReaderScope = { stages?: readonly string[]; checks?: readonly string[] };
type StageOnly = { stage: string; checks: readonly string[]; reportedBy: readonly string[] };
type Unread = { unread: string };
type RecordOnly = { record: string };
export type FeedbackKindEntry = Reader | Unread | RecordOnly;

const KNOX_LESSONS = "src/lib/agents/knox/lessons.ts";
/** Knox's read lessons (#2062): a check's fix to one document's read, read back at that document's next extract. */
const KNOX_READ_LESSONS = "src/lib/agents/knox/read-lessons.ts";
const READ_LESSONS_SWITCH_NOTE = "It acts only with KNOX_READ_LESSONS_LIVE on.";
/**
 * Knox's read lessons act only with their switch on, so their kinds count as read only then: off, the
 * brief keeps showing the rows as unread debt (each extract step counts the reads they would change,
 * `read_lesson_matches`), as the planted error loop keeps the duplicate's read gap until then.
 */
function readLesson(reader: Reader, unread: string): Reader | Unread {
  return readLessonsLive() ? reader : { unread: `${unread} Knox's read lessons (read-lessons.ts) read it once KNOX_READ_LESSONS_LIVE is on; off, each extract step only counts the reads they would change.` };
}
const LABEL_QUEUE = "src/lib/agents/knox/label-queue.ts";
const RELEASE_REVIEW = "src/lib/agents/darwin/release-review.ts";
const FEEDBACK_SYNC = "src/lib/agents/learning/feedback-sync.ts";
/**
 * The takedown sync's extract row (`hamilton.takedown:pub:<id>:extract`, or `...:at:<ms>:extract` for a
 * later cycle), as a SQL LIKE pattern: the rows its restore detection reads (`feedback-sync.ts`).
 */
export const TAKEDOWN_SYNC_EXTRACT_KEY = "hamilton.takedown:pub:%:extract";
/** Pure: does a value match a SQL LIKE pattern (`%` and `_`, no escapes)? */
export function likeMatches(pattern: string, value: string | null | undefined): boolean {
  const body = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, "[\\s\\S]*").replace(/_/g, "[\\s\\S]");
  return new RegExp(`^${body}$`).test(value ?? "");
}
const MAGELLAN_DISCOVERY = "src/lib/agents/magellan/discovery.ts";
const MAGELLAN_LINK_READERS = [
  "src/lib/agents/magellan/platform-learning.ts",
  "src/lib/agents/magellan/batch-review.ts",
  "src/lib/agents/magellan/page-classifier.ts",
] as const;
const ROSETTA_READ = "src/lib/agents/rosetta/read.ts";
const ROSETTA_READ_LESSONS = [ROSETTA_READ, "src/lib/agents/rosetta/paid-read.ts"] as const;
const ROSETTA_BATCH_READERS = [...ROSETTA_READ_LESSONS, "src/lib/agents/goal-scorecard.ts"] as const;
/** Fee-level verdicts recorded by Darwin's verify that only Magellan's batch review counts. */
const DARWIN_VERIFY = "darwin.verify";
/** Deming's extract-stage audit checks whose misses Knox does not learn from (`knox/lessons.ts` v5 reads only the category guard's). */
const KNOX_UNREAD_AUDIT_CHECKS = ["hamilton.source_check", "hamilton.product_page_conflict", "deming.not_a_fee_line", "deming.name_quality"] as const;
/** Darwin's reader of a person's holds and corrections filed against verify (#2057). */
const DARWIN_VERIFY_MISSES = "src/lib/agents/darwin/verify-misses.ts";
/** What Darwin's reader reads at verify: a person's own hold and correction rows (verify-misses.ts). */
const DARWIN_VERIFY_HAND_ROWS = [{ stage: "verify", checks: ["admin.fee_hold", "admin.fee_correction"], reportedBy: ["human"] }] as const;
/** The takedown sync's copy of a hand correction's takedown (its reason starts "admin_correction:"). */
const TAKEDOWN_SYNC_CORRECTION = "hamilton.admin_correction";
/** The stage of the takedown sync's row that its restore detection reads. */
const EXTRACT = ["extract"] as const;
/**
 * A kind the takedown sync's restore detection is its only reader of (#2062): read at extract, and
 * only on the sync's own key. Another writer's row of the kind (a hand takedown, an eval verdict,
 * Darwin's verify) is unread without being listed, so a new writer cannot pass as read.
 */
const SYNC_ONLY = { readers: [FEEDBACK_SYNC], readStages: EXTRACT, readKey: TAKEDOWN_SYNC_EXTRACT_KEY } as const;
/** Reader scopes by stage (#2066): Magellan reads discover rows, Rosetta read rows, Knox extract rows, Darwin verify rows. */
const AT_DISCOVER = { stages: ["discover"] } as const;
const AT_READ = { stages: ["read"] } as const;
const AT_EXTRACT = { stages: EXTRACT } as const;
const AT_VERIFY = { stages: ["verify"] } as const;
/** The checks whose wrong_category and off_taxonomy rows Darwin's release review reads at any stage (release-review.ts). */
const RELEASE_REVIEW_CATEGORY_CHECKS = ["hamilton.category_guard", "hamilton.category_outside_taxonomy"] as const;
/** The confirmed takedowns Knox's takedown lessons and Magellan's link yield read (`KNOX_READ_CHECKS`, `READ_WRONG_CHECKS`). */
const CONFIRMED_READ_CHECKS = ["hamilton.source_check", "hamilton.limit_guard", "hamilton.business_schedule"] as const;
/**
 * What Knox's read lessons read (read-lessons.ts, only with KNOX_READ_LESSONS_LIVE on; the test pins
 * these to its exported lists): frequency fixes from the fill and Darwin's hourly check at extract, the
 * fill's frequency holds, the collapse's and hand duplicate takedowns at extract, and Knox's own held
 * recheck promotions.
 */
const READ_LESSON_FREQUENCY_CHECKS = ["hamilton.frequency_fill", "darwin.hourly_frequency_check"] as const;
const READ_LESSON_DUPLICATE_CHECKS = ["hamilton.duplicate_collapse", "hamilton.hand_takedown", "hamilton.cut_name_duplicate"] as const;
const READ_LESSON_FREQUENCY_SCOPE = { [KNOX_READ_LESSONS]: { stages: EXTRACT, checks: READ_LESSON_FREQUENCY_CHECKS } } as const;
/** Each person's hold or correction goes to the reader of the stage it names (#2057, #2059). */
const HAND_ROW_SCOPES = {
  [MAGELLAN_DISCOVERY]: AT_DISCOVER, [ROSETTA_READ]: AT_READ, [KNOX_LESSONS]: AT_EXTRACT, [LABEL_QUEUE]: AT_EXTRACT, [DARWIN_VERIFY_MISSES]: AT_VERIFY,
} as const;

export const FEEDBACK_KINDS = {
  // Fee level.
  wrong_category: { readers: [KNOX_LESSONS, LABEL_QUEUE, RELEASE_REVIEW], readStages: EXTRACT, anyStageChecks: RELEASE_REVIEW_CATEGORY_CHECKS, unreadChecks: ["hamilton.account_type_hold"], readerScopes: { [KNOX_LESSONS]: AT_EXTRACT, [LABEL_QUEUE]: AT_EXTRACT, [RELEASE_REVIEW]: { checks: RELEASE_REVIEW_CATEGORY_CHECKS } }, note: "Knox's lessons read extract rows; release review reads the category guard's and the taxonomy check's rows at any stage (release-review.ts); the account-type hold files its live takedowns at publish (its releases are account_type_hold_released, #1680)." },
  wrong_amount: { ...SYNC_ONLY, unreadChecks: [DARWIN_VERIFY, "hamilton.hand_takedown", "hamilton.eval_verdict", "hamilton.hand_amount_correction"], note: "Only the takedown sync's restore detection reads it; Knox learns no amount lesson (#2067)." },
  not_a_fee: { ...SYNC_ONLY, unreadChecks: [DARWIN_VERIFY, "hamilton.hand_takedown", "hamilton.eval_verdict"] },
  threshold: SYNC_ONLY,
  priced_per_amount: SYNC_ONLY,
  discontinued_account: { ...SYNC_ONLY, note: "#2070: a fee priced for an account the bank no longer offers. Knox learns the class from the shared check itself (`discontinuedRow`, rules v113), not from these rows; no Knox file reads takedown rows by kind yet (#2062)." },
  not_on_schedule: { readStages: EXTRACT, readers: ["src/lib/agents/darwin/release-held.ts", FEEDBACK_SYNC], unreadChecks: [DARWIN_VERIFY, "hamilton.product_page", "hamilton.hand_takedown"] },
  unreproduced: SYNC_ONLY,
  outside_range: { ...SYNC_ONLY, unreadChecks: [DARWIN_VERIFY] },
  off_taxonomy: { readers: [FEEDBACK_SYNC, RELEASE_REVIEW], readStages: EXTRACT, anyStageChecks: RELEASE_REVIEW_CATEGORY_CHECKS, unreadChecks: [DARWIN_VERIFY], readerScopes: { [FEEDBACK_SYNC]: AT_EXTRACT, [RELEASE_REVIEW]: { checks: RELEASE_REVIEW_CATEGORY_CHECKS } } },
  duplicate: readLessonsLive() ? { readStages: EXTRACT, readers: [FEEDBACK_SYNC, KNOX_READ_LESSONS], readerScopes: { [KNOX_READ_LESSONS]: { stages: EXTRACT, checks: READ_LESSON_DUPLICATE_CHECKS } }, note: `The takedown sync's restore detection reads its extract rows. Knox's read lessons read a duplicate still down whose kept twin is on the same document at the same amount under another name (one printed fee read twice), and hold that read when the text also reads the kept name. A collapse across documents or of the same name is not Knox's error: the collapse and Magellan's current copy own it. ${READ_LESSONS_SWITCH_NOTE}` }
    : { ...SYNC_ONLY, unreadChecks: ["hamilton.hand_takedown", "hamilton.cut_name_duplicate"], note: "Only the takedown sync's restore detection reads it until KNOX_READ_LESSONS_LIVE is on (read-lessons.ts)." },
  refreshed: SYNC_ONLY,
  answer_key: { readers: ["src/lib/agents/darwin/category-model.ts", KNOX_LESSONS, LABEL_QUEUE] },
  restored_after_takedown: { readers: [KNOX_LESSONS, LABEL_QUEUE, "src/lib/agents/knox/calibration.ts", RELEASE_REVIEW] },
  darwin_verified: { readers: [KNOX_LESSONS, LABEL_QUEUE, "src/lib/agents/magellan/batch-review.ts"] },
  missing_lineage: { readers: [RELEASE_REVIEW], unreadChecks: [DARWIN_VERIFY, "hamilton.source_link", "hamilton.source_link_drift"], note: "Darwin's release review reads only the restore rows." },
  wrong_payer: readLesson({ readers: [KNOX_READ_LESSONS], readStages: EXTRACT, note: `Hamilton's eval verdicts (and the merchant-payer rule) record it; Knox holds the same name and amount on that document while the fee is still down for it. ${READ_LESSONS_SWITCH_NOTE}` }, "Hamilton's eval verdicts record it."),
  stated_on_later_look: { unread: "Darwin's held release records it with no fee id; Knox should learn from fees stated on a later look." },
  review_wrong: { readers: ["src/lib/agents/darwin/verdict-score.ts"] },
  stale_price: { readers: [MAGELLAN_DISCOVERY], note: "Hamilton's cross-page conflict records it. Magellan's freshness search reads it: when the older document is the link's own current page, the link is searched for the newer one (#2062). A row on a companion or an old copy says nothing against the link and changes nothing." },
  schedule_conflict: { readers: [MAGELLAN_DISCOVERY], note: "Hamilton's product-page conflict records it. Magellan's upgrade search reads it: when the product page is the link's own current page, the link is searched for the schedule (#2062). A row on a companion page changes nothing." },
  non_customer_price: { unread: "Hamilton's eval verdict flag; Knox should learn to skip prices that are not the customer's." },
  wire_shared_line: { unread: "Hamilton's eval verdict flag; Knox should learn to split a shared wire line." },

  // Records (weight 0) of what an agent changed.
  audience_relabeled: { record: "Darwin's audience relabel keeps the old value for a rollback (audience-relabel.ts)." },
  audience_hand_fixed: { record: "Hamilton's hand audience fix keeps the old value for a rollback." },
  business_schedule_restored: { record: "A business-schedule takedown brought back; release review leaves it out on purpose." },
  account_type_hold_released: { record: "A guard-refused row the account type hold put back to verified, held (#1680); not a category verdict; release review leaves it out by name (`RESTORE_RECORD_KINDS`)." },
  category_fold: { record: "Hamilton's taxonomy fold logs each fee it moved." },
  name_account_added: { record: "Hamilton's account names log each name it added." },
  name_account_removed: { record: "Hamilton's account names log each name set back because its heading was no account, a breadcrumb or menu (account-names.ts v4, #1917)." },
  rule_revised: { record: "Hamilton's eval verdicts log a revised rule." },
  lineup_corrected: { record: "Knox's lineup correction logs each fee it moved." },
  ancillary_owner_corrected: { record: "Knox's ancillary product recovery logs each live fee's NULL product it filled, old and new values (ancillary-owner-correct.ts, #1911)." },
  account_subject_corrected: { record: "Knox's account subject recovery logs each live monthly or minimum balance fee's NULL product it filled from its own sentence's subject, old and new values (account-subject-correct.ts, #1912)." },
  knox_reread_resolved: { record: "Knox settles each re-read request per rules version (reread-feedback.ts); Darwin's reread category re-check reads the `other_category` ones (reread-category-check.ts, #1513)." },
  live_name_refreshed: { record: "Hamilton's live name refresh logs each live fee it renamed to its re-read's repaired name, with the old name, for a rollback (live-name-refresh.ts, #1912)." },
  reread_category_refiled: { record: "Darwin's reread category re-check logs each live fee it re-filed, with the old category and name, for a rollback (reread-category-check.ts, #1513)." },
  od_transfer_refiled: { record: "Darwin's overdraft transfer re-check logs each live overdraft fee it re-filed as the overdraft protection transfer its own line reads, with the old category and name, for a rollback (od-transfer-refile-check.ts, Hamilton proof run Oct 30). Knox v141 reads the transfer on new reads, so no lesson is taught." },
  own_unit_refiled: { record: "Darwin's own-unit re-check logs each live flat fee it re-filed to the page, document, image, statement or part-hour unit its own line prices it by, with the old frequency, for a rollback (own-unit-check.ts, #2248). Knox v139 reads the unit on new reads, so no lesson is taught." },
  account_owner_refiled: { record: "Darwin's account-owner re-check logs each live monthly or minimum balance fee it re-filed under the numbered account printed nearer its line, with the old account and name, for a rollback (account-owner-check.ts, inst 608). Knox v141 reads numbered headings on new reads, so no lesson is taught." },
  batch_error_rate: { record: "One row per Knox or Rosetta batch: a cursor and the goal scorecard's error rate." },
  account_type_hold: { record: "Legacy takedown rows; the sync skips this kind now (feedback-sync.ts)." },
  error_fix_closed: { record: "Deming's error loop: a named error re-checked after its fix and gone (error-fixes.ts, #2058)." },
  error_fix_still_wrong: { record: "Deming's error loop: a named error still wrong after its re-run (error-fixes.ts, #2058)." },
  error_class: { record: "Deming's error classes: one row per class of confirmed errors, updated each day it is seen, with its counts and a GitHub-ready record (error-classes.ts, #2063)." },

  // Frequency and held fees.
  frequency_filled: readLesson({ readers: [KNOX_READ_LESSONS], readStages: EXTRACT, readerScopes: READ_LESSON_FREQUENCY_SCOPE, note: `Darwin's hourly check and Hamilton's frequency fill record it; Knox writes the same name and amount on that document with the check's frequency when it reads the old one again, while the live fee still has the check's. ${READ_LESSONS_SWITCH_NOTE}` }, "Darwin's hourly check and Hamilton's frequency fill record it."),
  frequency_corrected: readLesson({ readers: [KNOX_READ_LESSONS], readStages: EXTRACT, readerScopes: READ_LESSON_FREQUENCY_SCOPE, note: `As frequency_filled. ${READ_LESSONS_SWITCH_NOTE}` }, "Darwin's hourly check and Hamilton's frequency fill record it."),
  frequency_cleared: readLesson({ readers: [KNOX_READ_LESSONS], readStages: EXTRACT, readerScopes: READ_LESSON_FREQUENCY_SCOPE, note: `As frequency_filled, the check's frequency being none. ${READ_LESSONS_SWITCH_NOTE}` }, "Hamilton's frequency fill records it."),
  frequency_held: readLesson({ readers: [KNOX_READ_LESSONS], readStages: EXTRACT, readerScopes: { [KNOX_READ_LESSONS]: { checks: ["hamilton.frequency_fill"] } }, note: `Hamilton's frequency fill took the fee down for a period its price cannot have; Knox holds a read that gives that period again while the fee is still down. ${READ_LESSONS_SWITCH_NOTE}` }, "Hamilton's frequency fill records it."),
  promoted_from_held: readLesson({ readers: [KNOX_READ_LESSONS], readerScopes: { [KNOX_READ_LESSONS]: { checks: ["knox.held_recheck"] } }, note: `Knox's held recheck records it; when Darwin verified the promoted line and its fee is live, Knox's full read files the same held name and amount on that document under the verified category instead of holding it again. ${READ_LESSONS_SWITCH_NOTE}` }, "Knox's held recheck records it."),
  held_no_category: { unread: "Knox's held recheck records it; Knox's lessons should read it." },
  set_aside_no_category: { unread: "Knox's held recheck records it; Knox's lessons should read it." },
  range_band_set_aside: { unread: "Knox's range band records it; Knox's lessons should read it." },
  promotion_withdrawn: { unread: "Knox's promotion recheck records it; Knox's lessons should read it." },
  batch_miss: { unread: "Knox's batch review records it; Knox's lessons should read it." },

  // Re-reads and renames.
  knox_reread_requested: { readers: ["src/lib/agents/knox/reread-feedback.ts"] },
  name_retidied: { readers: ["src/lib/agents/knox/name-retidy.ts", "src/lib/agents/hamilton/eval-verdicts.ts"] },
  name_label: { readers: [KNOX_LESSONS, LABEL_QUEUE, "src/lib/agents/knox/held-recheck.ts"] },

  // Second look (one row per fee and check, plus the appended audit trail).
  takedown_pending: { readers: ["src/lib/agents/deming/fresh-audit.ts", "src/lib/agents/magellan/fetch.ts", "src/lib/agents/state-lane-scheduler.ts", "src/lib/agents/hamilton/second-look.ts"] },
  takedown_confirmed: { readers: ["src/lib/agents/knox/takedown-lessons.ts", "src/lib/agents/knox/audience-lessons.ts", "src/lib/agents/deming/regression.ts", "src/lib/agents/magellan/outcomes.ts"], readerScopes: { "src/lib/agents/knox/takedown-lessons.ts": { checks: CONFIRMED_READ_CHECKS }, "src/lib/agents/knox/audience-lessons.ts": { checks: ["hamilton.business_schedule"] }, "src/lib/agents/magellan/outcomes.ts": { checks: CONFIRMED_READ_CHECKS } }, note: "Knox's takedown lessons act on the limit guard's (with its witness); its audience lessons read the business-schedule check's as the document's business fees (#2062, behind KNOX_AUDIENCE_LESSONS_LIVE)." },
  takedown_cleared: { readers: ["src/lib/agents/deming/fresh-audit.ts", "src/lib/agents/hamilton/second-look.ts"] },
  flag_recorded: { readers: ["src/lib/agents/hamilton/second-look.ts"] },
  flag_confirmed: { readers: [FEEDBACK_SYNC] },
  flag_cleared: { record: "The second look's appended audit trail of a cleared flag." },

  // Daily audit and operator actions.
  audit_miss: { readers: [MAGELLAN_DISCOVERY, KNOX_LESSONS, LABEL_QUEUE], readStages: ["discover", "extract"], unreadChecks: KNOX_UNREAD_AUDIT_CHECKS, readerScopes: { [MAGELLAN_DISCOVERY]: AT_DISCOVER, [KNOX_LESSONS]: AT_EXTRACT, [LABEL_QUEUE]: AT_EXTRACT }, note: "Magellan's stale-link search reads the document misses; Knox's lessons and label queue read the category guard's misses at extract as category verdicts (v5). Amount, product-page and perk misses teach Knox nothing yet (#2055, #2067); a bad name is acted on through its knox_reread_requested twin, not this row. Deming files no miss at verify (missOwner), so Darwin hears of none." },
  admin_hold: { readers: [MAGELLAN_DISCOVERY, ROSETTA_READ, KNOX_LESSONS, LABEL_QUEUE, DARWIN_VERIFY_MISSES], readStages: ["discover", "read", "extract", "verify"], unreadCauses: ["wrong_amount"], stageOnly: DARWIN_VERIFY_HAND_ROWS, readerScopes: HAND_ROW_SCOPES, note: "A wrong-document hold goes to Magellan, a lost text to Rosetta's next reader version (#2059), a wrong category to Knox's lessons and label queue (v5), a verify miss to Darwin's lessons and missed tally (#2057); an amount hold teaches no agent yet (#2067)." },
  admin_release: { readers: [MAGELLAN_DISCOVERY, RELEASE_REVIEW, DARWIN_VERIFY_MISSES] },
  admin_correction: { readers: [MAGELLAN_DISCOVERY, ROSETTA_READ, KNOX_LESSONS, LABEL_QUEUE, DARWIN_VERIFY_MISSES], readStages: ["discover", "read", "extract", "verify"], stageOnly: DARWIN_VERIFY_HAND_ROWS, unreadChecks: [TAKEDOWN_SYNC_CORRECTION], readerScopes: HAND_ROW_SCOPES, note: "Knox's lessons read an extract correction as a verdict on its category, old and new (v5); Darwin reads a person's verify-stage corrections (#2057). The takedown sync's copies (check hamilton.admin_correction, at extract and verify) mirror the hand row, which names its own stage, and no agent reads them." },
  admin_correction_reversed: { readers: [MAGELLAN_DISCOVERY, RELEASE_REVIEW] },

  // Rosetta's reads.
  no_fees_found: { readers: ROSETTA_BATCH_READERS },
  short_text: { readers: ROSETTA_BATCH_READERS },
  missed_fee_page: { readers: ROSETTA_BATCH_READERS },
  unresolved_fee_page: { readers: ROSETTA_BATCH_READERS },
  unread: { readers: ROSETTA_BATCH_READERS },
  text_lost_fees: { readers: ROSETTA_READ_LESSONS },
  text_held_up: { readers: [ROSETTA_READ] },
  untraced_lines: { readers: [ROSETTA_READ], readStages: ["read"], note: "Knox reports a text whose held lines its rules failed to trace under 3+ rules versions (knox/untraced-read-error.ts, #1102); Rosetta reads the document again at its next reader version, like a lost-text hold (#2059)." },

  // Magellan's links.
  produced_live_fees: { readers: MAGELLAN_LINK_READERS },
  thin_link: { readers: MAGELLAN_LINK_READERS },
  dead_link: { readers: MAGELLAN_LINK_READERS },
  business_schedule: { readers: MAGELLAN_LINK_READERS },
  confirmed_wrong_fees: { readers: [...MAGELLAN_LINK_READERS, MAGELLAN_DISCOVERY] },
  wrong_document: { readers: MAGELLAN_LINK_READERS, unreadChecks: ["hamilton.other_bank_document", "hamilton.unconfirmed_document_host", "hamilton.article_page", "hamilton.business_schedule", "hamilton.hand_takedown"], note: "Magellan reads its own link-yield rows; Hamilton's wrong-document takedowns (hand takedowns too, #1677) reach it only as audit misses." },
  batch_review: { readers: ["src/lib/agents/magellan/batch-review.ts"] },
  search_miss: { readers: ["src/lib/agents/magellan/search-misses.ts", MAGELLAN_DISCOVERY], note: "The bank's next search runs the specialists its last miss on the same website ran with nothing to show after the others (search-misses.ts, #2062)." },
  missed_second_schedule: { readers: ["src/lib/agents/magellan/missed-schedules.ts"], readStages: ["discover"], note: "#2070: a document known to price the bank's fees (the answer key's) that Magellan never stored. Deming's answer-key replay records it; the companion finder reads it and searches the bank first, in rescue mode too, checking the missed address before anything else (missed-schedules.ts, second-document.ts)." },

  // Marketing.
  campaign_result: { readers: ["src/lib/agents/marketing/monthly.ts"] },
  market_snapshot: { readers: ["src/lib/agents/marketing/monthly.ts"] },
  campaign_plan: { readers: ["src/lib/agents/marketing/monthly.ts"] },
  skipped_by_james: { readers: ["src/lib/agents/growth/lessons.ts", "src/lib/agents/growth/draper.ts"] },

  // Written by hand-run SQL outside src (2026-10-10 audience repair, Pinnacle correction).
  audience_scope_backfill: { record: "Hand SQL audience repair of 2026-10-10 (scripts/fee-audience-data-repair.sql)." },
  audience_screen_false_positive: { record: "Hand SQL audience repair of 2026-10-10." },
  confirmed_data_error: { record: "Hand SQL audience repairs (2026-10-10, Pinnacle)." },
  insufficient_evidence_quarantine: { record: "Hand SQL audience repair of 2026-10-10." },
} as const satisfies Record<string, FeedbackKindEntry>;

export type RegisteredFeedbackKind = keyof typeof FEEDBACK_KINDS;

export const REGISTERED_FEEDBACK_KINDS = Object.keys(FEEDBACK_KINDS) as RegisteredFeedbackKind[];

function entry(kind: string): FeedbackKindEntry | undefined {
  return (FEEDBACK_KINDS as Record<string, FeedbackKindEntry>)[kind];
}

/** Pure: is this row read by any agent? Unregistered kinds are unread, records are not debt. */
export function feedbackRowRead(row: { kind: string; about_stage: string; check_name: string | null; dedupe_key?: string | null; reported_by?: string | null; cause?: string | null }): boolean {
  const known = entry(row.kind);
  if (!known) return likeMatches(TAKEDOWN_SYNC_EXTRACT_KEY, row.dedupe_key);
  if ("record" in known) return true;
  if ("unread" in known) return false;
  if (known.unreadChecks && row.check_name != null && known.unreadChecks.includes(row.check_name)) return false;
  if (known.unreadCauses && row.cause != null && known.unreadCauses.includes(row.cause)) return false;
  if (known.readKey && !likeMatches(known.readKey, row.dedupe_key)) return false;
  const check = row.check_name?.split(":")[0];
  if (known.anyStageChecks && check != null && known.anyStageChecks.includes(check)) return true;
  if (known.readStages && !known.readStages.includes(row.about_stage)) return false;
  const only = known.stageOnly?.find((item) => item.stage === row.about_stage);
  if (only) return row.check_name != null && only.checks.includes(row.check_name) && row.reported_by != null && only.reportedBy.includes(row.reported_by);
  return true;
}

/**
 * Pure: the reader files that read this row (#2066). Empty when no agent reads it; a record reads as
 * no reader, since it teaches nobody. A reader with a `readerScopes` entry reads only rows at its
 * stages or from its checks, so a row is routed to an agent only when that agent's own reader for
 * the row's stage or check reads it, not when any reader of the kind exists.
 */
export function feedbackRowReaders(row: Parameters<typeof feedbackRowRead>[0]): string[] {
  const known = entry(row.kind);
  if (!known) return feedbackRowRead(row) ? [FEEDBACK_SYNC] : [];
  if (!("readers" in known) || !feedbackRowRead(row)) return [];
  const check = row.check_name?.split(":")[0] ?? null;
  return known.readers.filter((file) => {
    const scope = known.readerScopes?.[file];
    if (!scope) return true;
    if (scope.stages && !scope.stages.includes(row.about_stage)) return false;
    if (scope.checks && (check == null || !scope.checks.includes(check))) return false;
    return true;
  });
}

/** SQL-side split of the same rule, for the brief's count: kinds read whole, and the rest. */
export function unreadFeedbackPredicate() {
  const unreadKinds: string[] = [];
  const partial: Array<{ kind: string; stages: string[] | null; checks: string[]; anyStageChecks: string[]; causes: string[]; readKey: string | null }> = [];
  /** Per kind and stage, the only checks and reporters read there (`stageOnly`). */
  const stageOnly: Array<{ kind: string; stage: string; checks: string[]; reportedBy: string[] }> = [];
  const records: string[] = [];
  const read: string[] = [];
  for (const [kind, value] of Object.entries(FEEDBACK_KINDS) as Array<[string, FeedbackKindEntry]>) {
    if ("readers" in value) for (const item of value.stageOnly ?? []) stageOnly.push({ kind, stage: item.stage, checks: [...item.checks], reportedBy: [...item.reportedBy] });
    if ("record" in value) records.push(kind);
    else if ("unread" in value) unreadKinds.push(kind);
    else if (value.readStages || value.unreadChecks || value.unreadCauses || value.stageOnly || value.readKey) partial.push({ kind, stages: value.readStages ? [...value.readStages] : null, checks: value.unreadChecks ? [...value.unreadChecks] : [], anyStageChecks: value.anyStageChecks ? [...value.anyStageChecks] : [], causes: value.unreadCauses ? [...value.unreadCauses] : [], readKey: value.readKey ?? null });
    else read.push(kind);
  }
  return { unreadKinds, partial, stageOnly, registered: [...records, ...unreadKinds, ...read, ...partial.map((item) => item.kind)] };
}

/** Days of rows the brief looks back over, and how old a row must be to count as unread. */
export const UNREAD_FEEDBACK_WINDOW_DAYS = 30;
export const UNREAD_FEEDBACK_MIN_AGE_HOURS = 48;
