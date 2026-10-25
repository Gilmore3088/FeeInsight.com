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
 * only at extract, and its verify row is unread. A kind written outside this list (the sync's
 * open-ended fallback, `takedownKind`, or hand-run SQL) is counted as unread by the brief, except
 * the sync's extract rows.
 */

type Reader = {
  readers: readonly string[];
  /** Only rows about these stages are read. */
  readStages?: readonly string[];
  /** Rows from these checks are not read. */
  unreadChecks?: readonly string[];
  /** Rows from these checks are read at any stage, `readStages` aside. A check name matches on
   * its part before the first ":", as the readers match it. */
  anyStageChecks?: readonly string[];
  note?: string;
};
type Unread = { unread: string };
type RecordOnly = { record: string };
export type FeedbackKindEntry = Reader | Unread | RecordOnly;

const KNOX_LESSONS = "src/lib/agents/knox/lessons.ts";
const LABEL_QUEUE = "src/lib/agents/knox/label-queue.ts";
const RELEASE_REVIEW = "src/lib/agents/darwin/release-review.ts";
const FEEDBACK_SYNC = "src/lib/agents/learning/feedback-sync.ts";
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
/** The stage of the takedown sync's row that its restore detection reads. */
const EXTRACT = ["extract"] as const;

export const FEEDBACK_KINDS = {
  // Fee level.
  wrong_category: { readers: [KNOX_LESSONS, LABEL_QUEUE, RELEASE_REVIEW], readStages: EXTRACT, anyStageChecks: ["hamilton.category_guard"], unreadChecks: ["hamilton.account_type_hold"], note: "Knox's lessons read extract rows; release review reads the category guard's rows at any stage; the account-type hold files at publish." },
  wrong_amount: { readStages: EXTRACT, readers: [FEEDBACK_SYNC], unreadChecks: [DARWIN_VERIFY, "hamilton.hand_takedown", "hamilton.eval_verdict", "hamilton.hand_amount_correction"], note: "Only the takedown sync's restore detection reads it; Knox learns no amount lesson (#2067)." },
  not_a_fee: { readStages: EXTRACT, readers: [FEEDBACK_SYNC], unreadChecks: [DARWIN_VERIFY, "hamilton.hand_takedown", "hamilton.eval_verdict"] },
  threshold: { readStages: EXTRACT, readers: [FEEDBACK_SYNC] },
  priced_per_amount: { readStages: EXTRACT, readers: [FEEDBACK_SYNC] },
  discontinued_account: { readStages: EXTRACT, readers: [FEEDBACK_SYNC], note: "#2070: a fee priced for an account the bank no longer offers. Knox learns the class from the shared check itself (`discontinuedRow`, rules v107), not from these rows; no Knox file reads takedown rows by kind yet (#2062)." },
  not_on_schedule: { readStages: EXTRACT, readers: ["src/lib/agents/darwin/release-held.ts", FEEDBACK_SYNC], unreadChecks: [DARWIN_VERIFY, "hamilton.product_page", "hamilton.hand_takedown"] },
  unreproduced: { readStages: EXTRACT, readers: [FEEDBACK_SYNC] },
  outside_range: { readStages: EXTRACT, readers: [FEEDBACK_SYNC], unreadChecks: [DARWIN_VERIFY] },
  off_taxonomy: { readers: [FEEDBACK_SYNC, RELEASE_REVIEW], readStages: EXTRACT, anyStageChecks: ["hamilton.category_outside_taxonomy"], unreadChecks: [DARWIN_VERIFY] },
  duplicate: { readStages: EXTRACT, readers: [FEEDBACK_SYNC], unreadChecks: ["hamilton.hand_takedown", "hamilton.cut_name_duplicate"] },
  refreshed: { readStages: EXTRACT, readers: [FEEDBACK_SYNC] },
  answer_key: { readers: ["src/lib/agents/darwin/category-model.ts", KNOX_LESSONS, LABEL_QUEUE] },
  restored_after_takedown: { readers: [KNOX_LESSONS, LABEL_QUEUE, "src/lib/agents/knox/calibration.ts", RELEASE_REVIEW] },
  darwin_verified: { readers: [KNOX_LESSONS, LABEL_QUEUE, "src/lib/agents/magellan/batch-review.ts"] },
  missing_lineage: { readers: [RELEASE_REVIEW], unreadChecks: [DARWIN_VERIFY, "hamilton.source_link", "hamilton.source_link_drift"], note: "Darwin's release review reads only the restore rows." },
  wrong_payer: { unread: "Hamilton's eval verdicts record it; Knox should learn the payer from it." },
  stated_on_later_look: { unread: "Darwin's held release records it with no fee id; Knox should learn from fees stated on a later look." },
  review_wrong: { readers: ["src/lib/agents/darwin/verdict-score.ts"] },
  stale_price: { unread: "Hamilton's cross-page conflict records it; Magellan should learn which page is out of date." },
  schedule_conflict: { unread: "Hamilton's product-page conflict records it; Magellan should learn which page wins." },
  non_customer_price: { unread: "Hamilton's eval verdict flag; Knox should learn to skip prices that are not the customer's." },
  wire_shared_line: { unread: "Hamilton's eval verdict flag; Knox should learn to split a shared wire line." },

  // Records (weight 0) of what an agent changed.
  audience_relabeled: { record: "Darwin's audience relabel keeps the old value for a rollback (audience-relabel.ts)." },
  audience_hand_fixed: { record: "Hamilton's hand audience fix keeps the old value for a rollback." },
  business_schedule_restored: { record: "A business-schedule takedown brought back; release review leaves it out on purpose." },
  category_fold: { record: "Hamilton's taxonomy fold logs each fee it moved." },
  name_account_added: { record: "Hamilton's account names log each name it added." },
  rule_revised: { record: "Hamilton's eval verdicts log a revised rule." },
  lineup_corrected: { record: "Knox's lineup correction logs each fee it moved." },
  knox_reread_resolved: { record: "Knox settles each re-read request per rules version (reread-feedback.ts)." },
  batch_error_rate: { record: "One row per Knox or Rosetta batch: a cursor and the goal scorecard's error rate." },
  account_type_hold: { record: "Legacy takedown rows; the sync skips this kind now (feedback-sync.ts)." },
  error_fix_closed: { record: "Deming's error loop: a named error re-checked after its fix and gone (error-fixes.ts, #2058)." },
  error_fix_still_wrong: { record: "Deming's error loop: a named error still wrong after its re-run (error-fixes.ts, #2058)." },
  error_class: { record: "Deming's error classes: one row per class of confirmed errors, updated each day it is seen, with its counts and a GitHub-ready record (error-classes.ts, #2063)." },

  // Frequency and held fees.
  frequency_filled: { unread: "Darwin's hourly check and Hamilton's frequency fill record it; Knox should learn the frequency." },
  frequency_corrected: { unread: "Darwin's hourly check and Hamilton's frequency fill record it; Knox should learn the frequency." },
  frequency_cleared: { unread: "Hamilton's frequency fill records it; Knox should learn the frequency." },
  frequency_held: { unread: "Hamilton's frequency fill records it; Knox should learn the frequency." },
  promoted_from_held: { unread: "Knox's held recheck records it; Knox's lessons should read it." },
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
  takedown_confirmed: { readers: ["src/lib/agents/knox/takedown-lessons.ts", "src/lib/agents/deming/regression.ts", "src/lib/agents/magellan/outcomes.ts"] },
  takedown_cleared: { readers: ["src/lib/agents/deming/fresh-audit.ts", "src/lib/agents/hamilton/second-look.ts"] },
  flag_recorded: { readers: ["src/lib/agents/hamilton/second-look.ts"] },
  flag_confirmed: { readers: [FEEDBACK_SYNC] },
  flag_cleared: { record: "The second look's appended audit trail of a cleared flag." },

  // Daily audit and operator actions.
  audit_miss: { readers: [MAGELLAN_DISCOVERY], readStages: ["discover"], note: "Magellan's stale-link search reads the document misses; extract misses teach Knox nothing yet." },
  admin_hold: { readers: [MAGELLAN_DISCOVERY, ROSETTA_READ], readStages: ["discover", "read"], note: "A wrong-document hold goes to Magellan, a lost text to Rosetta's next reader version (#2059); other causes are read by no agent yet." },
  admin_release: { readers: [MAGELLAN_DISCOVERY, RELEASE_REVIEW] },
  admin_correction: { readers: [MAGELLAN_DISCOVERY, ROSETTA_READ], readStages: ["discover", "read"] },
  admin_correction_reversed: { readers: [MAGELLAN_DISCOVERY, RELEASE_REVIEW] },

  // Rosetta's reads.
  no_fees_found: { readers: ROSETTA_BATCH_READERS },
  short_text: { readers: ROSETTA_BATCH_READERS },
  missed_fee_page: { readers: ROSETTA_BATCH_READERS },
  unresolved_fee_page: { readers: ROSETTA_BATCH_READERS },
  unread: { readers: ROSETTA_BATCH_READERS },
  text_lost_fees: { readers: ROSETTA_READ_LESSONS },
  text_held_up: { readers: [ROSETTA_READ] },

  // Magellan's links.
  produced_live_fees: { readers: MAGELLAN_LINK_READERS },
  thin_link: { readers: MAGELLAN_LINK_READERS },
  dead_link: { readers: MAGELLAN_LINK_READERS },
  business_schedule: { readers: MAGELLAN_LINK_READERS },
  confirmed_wrong_fees: { readers: [...MAGELLAN_LINK_READERS, MAGELLAN_DISCOVERY] },
  wrong_document: { readers: MAGELLAN_LINK_READERS, unreadChecks: ["hamilton.other_bank_document", "hamilton.unconfirmed_document_host", "hamilton.article_page", "hamilton.business_schedule"], note: "Magellan reads its own link-yield rows; Hamilton's wrong-document takedowns reach it only as audit misses." },
  batch_review: { readers: ["src/lib/agents/magellan/batch-review.ts"] },
  search_miss: { unread: "Magellan's search misses are recorded but its finders do not read them." },

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
export function feedbackRowRead(row: { kind: string; about_stage: string; check_name: string | null; dedupe_key?: string | null }): boolean {
  const known = entry(row.kind);
  if (!known) return /^hamilton\.takedown:pub:.*:extract$/.test(row.dedupe_key ?? "");
  if ("record" in known) return true;
  if ("unread" in known) return false;
  if (known.unreadChecks && row.check_name != null && known.unreadChecks.includes(row.check_name)) return false;
  const check = row.check_name?.split(":")[0];
  if (known.anyStageChecks && check != null && known.anyStageChecks.includes(check)) return true;
  if (known.readStages && !known.readStages.includes(row.about_stage)) return false;
  return true;
}

/** SQL-side split of the same rule, for the brief's count: kinds read whole, and the rest. */
export function unreadFeedbackPredicate() {
  const unreadKinds: string[] = [];
  const partial: Array<{ kind: string; stages: string[] | null; checks: string[]; anyStageChecks: string[] }> = [];
  const records: string[] = [];
  const read: string[] = [];
  for (const [kind, value] of Object.entries(FEEDBACK_KINDS) as Array<[string, FeedbackKindEntry]>) {
    if ("record" in value) records.push(kind);
    else if ("unread" in value) unreadKinds.push(kind);
    else if (value.readStages || value.unreadChecks) partial.push({ kind, stages: value.readStages ? [...value.readStages] : null, checks: value.unreadChecks ? [...value.unreadChecks] : [], anyStageChecks: value.anyStageChecks ? [...value.anyStageChecks] : [] });
    else read.push(kind);
  }
  return { unreadKinds, partial, registered: [...records, ...unreadKinds, ...read, ...partial.map((item) => item.kind)] };
}

/** Days of rows the brief looks back over, and how old a row must be to count as unread. */
export const UNREAD_FEEDBACK_WINDOW_DAYS = 30;
export const UNREAD_FEEDBACK_MIN_AGE_HOURS = 48;
