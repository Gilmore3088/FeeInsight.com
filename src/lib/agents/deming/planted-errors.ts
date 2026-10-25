import { FEEDBACK_KINDS, feedbackRowRead, type FeedbackKindEntry } from "@/lib/agents/learning/feedback-kinds";
import type { FeedbackRow, FeedbackStage } from "@/lib/agents/learning/feedback";
import { takedownFeedback } from "@/lib/agents/learning/feedback-sync";
import { CONFIRMED_KIND, secondLookDedupeKey } from "@/lib/agents/hamilton/second-look";
import { LIMIT_GUARD_CHECK, limitGuardReason, limitGuardVerdict } from "@/lib/agents/hamilton/limit-guard";
import { BUSINESS_FOOTNOTE_REASON, BUSINESS_SCHEDULE_CHECK, footnoteMarksBusiness } from "@/lib/agents/hamilton/business-schedule";
import { DUPLICATE_COLLAPSE_REASON_PREFIX, NEAR_NAME_COLLAPSE_REASON_SUFFIX, nearNameRepeats, type NearNameRow } from "@/lib/agents/hamilton/duplicate-collapse";
import { nextReaderRung, PRIMARY_READERS, survivalFeedback, type SurvivalRow } from "@/lib/agents/rosetta/text-survival";
import { checkFeeCategory } from "@/lib/fee-category-guard";
import type { InstitutionText } from "@/lib/agents/hamilton/source-check";
import { auditFeedback } from "./audit-misses";
import { errorFixProblems, judgeErrorFix, type ErrorFixFee } from "./error-fixes";
import { scoreFreshAudit, type FreshAuditFee } from "./fresh-audit";
import { judgeBank, type KeyFee } from "./knox-misses";

/**
 * The error loop, planted end to end (#2065). James asked "how do we know that we're not missing
 * any gaps right now?": reading the code cannot tell, so each error class the pipeline makes is
 * planted here as a fixture and walked through the loop with the real code at every link:
 *
 * 1. detected: the check that runs on live fees today flags the planted fee;
 * 2. recorded: the rows that check writes to `pipeline_feedback` name the stage that caused it;
 * 3. read: one of those rows is read (`feedbackRowRead`) by a file of the owning agent that is a
 *    registered reader of its kind (`FEEDBACK_KINDS`, #2062) and picks it out by name;
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
  /** True when a fix to the owning step reaches the bank again. Null: no such path. */
  rerun: (() => boolean) | null;
  /** The daily re-check on the planted fee and on the corrected one. Null: no such re-check. */
  recheck: { planted: () => boolean; corrected: () => boolean } | null;
}

const rows = (built: FeedbackRow[]): PlantedRecord[] =>
  built.map((row) => ({ kind: String(row.kind), aboutStage: row.aboutStage, checkName: row.checkName ?? null, dedupeKey: row.dedupeKey ?? null }));

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
    amount: 35, amount_kind: null, rate_percent: null, raw_created_at: RERUN_AT, ...fields,
  };
}

function texts(text: string): InstitutionText[] {
  return [{ source_document_id: DOCUMENT, normalized_text: text }];
}

/** Hamilton's takedown of a fee for `reason`, as the takedown sync reads it back. */
function takedown(id: number, reason: string, fee: { canonical_fee_key: string; fee_name: string; amount: number }) {
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
    reader: { file: "src/lib/agents/magellan/discovery.ts", picksOut: "AUDIT_FEEDBACK_KIND" },
    rerun: null,
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
    reader: { file: "src/lib/agents/knox/takedown-lessons.ts", picksOut: LIMIT_GUARD_CHECK },
    rerun: () => errorFixCanName("extract", LIMIT_GUARD_CHECK),
    recheck: { planted: () => limitGuardVerdict(LIMIT_PLANTED) != null, corrected: () => limitGuardVerdict(LIMIT_CORRECTED) == null },
  },
  {
    key: "wrong_category",
    label: "a fee filed under the wrong category",
    owner: "knox",
    stage: "extract",
    detect: () => { const verdict = checkFeeCategory(CATEGORY_PLANTED.canonical_fee_key, CATEGORY_PLANTED.fee_name); return verdict.ok ? null : `category_guard:${verdict.code}: ${verdict.reason}`; },
    record: (reason) => rows(takedown(901, reason, { canonical_fee_key: "stop_payment", fee_name: CATEGORY_PLANTED.fee_name, amount: 25 })),
    reader: { file: "src/lib/agents/knox/lessons.ts", picksOut: "wrong_category" },
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
    reader: { file: "src/lib/agents/knox/takedown-lessons.ts", picksOut: BUSINESS_SCHEDULE_CHECK },
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
    reader: null,
    rerun: null,
    recheck: null,
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
];

/**
 * The links each planted class does not have yet, with the issue that owns each one. A gap is a
 * known debt, not a pass: the test fails when a link listed here starts to hold, so the list only
 * shrinks.
 */
export const KNOWN_GAPS: Record<string, Partial<Record<LoopLink, number>>> = {
  // Magellan re-searches the link (#2558), but nothing re-checks that the new document fixed the fee.
  wrong_document: { rerun: 2058, fixed: 2058 },
  // The error loop names only checks its daily re-check re-runs; the limit guard is not one.
  limit_as_fee: { rerun: 2058 },
  wrong_audience: { rerun: 2058, fixed: 2058 },
  // Duplicates teach Knox nothing: only the takedown sync's restore detection reads them.
  duplicate: { read: 2062, rerun: 2058, fixed: 2058 },
  // A missed fee is a Deming test case, not a feedback row, so Knox never learns from it.
  missed_fee: { recorded: 2062, read: 2062, rerun: 2058 },
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
    const readRow = recorded_rows.find((row) => {
      const entry = kindEntry(row.kind);
      return entry != null && "readers" in entry && entry.readers.includes(reader.file)
        && feedbackRowRead({ kind: row.kind, about_stage: row.aboutStage, check_name: row.checkName, dedupe_key: row.dedupeKey });
    });
    if (!reader.file.startsWith(`src/lib/agents/${planted.owner}/`)) fail("read", `${reader.file} is not ${planted.owner}'s`);
    else if (!readRow) fail("read", `${reader.file} is not a registered reader of a row this check writes`);
    else if (text == null || !text.includes(reader.picksOut)) fail("read", `${reader.file} never names ${reader.picksOut}`);
    else read = true;
  }

  const rerun = planted.rerun ? planted.rerun() || fail("rerun", "a fix to the step never reaches the bank again") : fail("rerun", "no re-run path");
  const fixed = planted.recheck
    ? (planted.recheck.planted() && planted.recheck.corrected()) || fail("fixed", "the re-check cannot tell the corrected fee from the planted one")
    : fail("fixed", "no daily re-check judges it gone");

  return { key: planted.key, links: { detected, recorded, read, rerun, fixed }, why };
}
