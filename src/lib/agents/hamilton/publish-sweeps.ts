import type { sql } from "@/lib/data-store/connection";
import { runHamiltonCategoryGuard } from "@/lib/agents/hamilton/category-guard";
import { collapseNearNameDuplicates, collapsePublishedDuplicates } from "@/lib/agents/hamilton/duplicate-collapse";
import { collapsePageCopies } from "@/lib/agents/hamilton/page-copy-collapse";
import { retireClosedInstitutionFees } from "@/lib/agents/hamilton/closed-institution";
import { fillFrequenciesInPublish } from "@/lib/agents/hamilton/frequency-fill";
import { fillSourceLinks, repairLinkDrift } from "@/lib/agents/hamilton/source-link";
import { restoreFeesNowInTaxonomy, rollBackOffTaxonomyFees } from "@/lib/agents/hamilton/off-taxonomy-rollback";
import { foldRetiredCategories } from "@/lib/agents/hamilton/taxonomy-fold";
import { rollBackLimitsPublishedAsFees } from "@/lib/agents/hamilton/limit-guard";
import { retireBusinessScheduleFees } from "@/lib/agents/hamilton/business-schedule";
import { retireSameLineDuplicates } from "@/lib/agents/hamilton/same-line-duplicates";
import { retireOtherBankDocumentFees } from "@/lib/agents/hamilton/other-bank-document";
import { retireEvalVerdictFees } from "@/lib/agents/hamilton/eval-verdicts";
import { applyHandAmountCorrections } from "@/lib/agents/hamilton/hand-amount-corrections";
import { applyCutNameDuplicates } from "@/lib/agents/hamilton/cut-name-duplicates";
import { applyAccountTypeHold } from "@/lib/agents/hamilton/account-type-hold";
import { applyHandAudienceFixes, applyHandTakedowns } from "@/lib/agents/hamilton/hand-takedowns";
import { retireArticlePageFees } from "@/lib/agents/hamilton/article-page";
import { retireProductPageFees } from "@/lib/agents/hamilton/product-page";
import { retireProductPageConflicts } from "@/lib/agents/hamilton/product-page-conflict";
import { retireCrossPageConflicts } from "@/lib/agents/hamilton/cross-page-conflict";
import { recheckUncheckedRestores } from "@/lib/agents/hamilton/restore-recheck";
import { restoreLostRecheckTakedowns } from "@/lib/agents/hamilton/lost-recheck-restore";
import { restoreCrossPageSupersedes } from "@/lib/agents/hamilton/cross-page-restore";
import { restorePageCopiesOfDownedKeepers } from "@/lib/agents/hamilton/page-copy-restore";
import { pairFeeChangeRecords } from "@/lib/agents/hamilton/change-pairing";
import { restoreOutliersNowInRange, rollBackPublishedOutliers } from "@/lib/agents/hamilton/outlier-rollback";
import { linkImportedFeesToTwins } from "@/lib/agents/hamilton/source-check";
import { moveRowsToIdenticalCopy } from "@/lib/agents/hamilton/refresh-copy";
import { nameLiveFeesByAccount } from "@/lib/agents/hamilton/account-names";
import { retidyLiveFeeNames } from "@/lib/agents/knox/name-retidy";
import { moveExtractionNotes } from "@/lib/agents/knox/extraction-note";
import { correctStoredLineups } from "@/lib/agents/knox/lineup-correct";
import { syncPipelineFeedback } from "@/lib/agents/learning/feedback-sync";
import { repairAccountTypeHoldFeedback } from "@/lib/agents/learning/account-type-hold-feedback";
import { refreshFeeIndexCache } from "@/lib/data-store/fee-index";

type SqlTag = typeof sql;
type Result<F extends (...args: never[]) => unknown> = Awaited<ReturnType<F>>;

/**
 * The publish-sweeps split (2026-10-18 proposal, approved by the coordinator; switch-on is
 * James's call). A lane's publish step ran 40 sweeps that are scoped only by institution or
 * not at all, so in a lane they went over every state's live fees on every lane's publish:
 * about 106 s a step (p99 201 s), over the tick's room. With the switch on, those 40 run once
 * per tick in their own `publish-sweeps` step, and a lane publish keeps the 11 calls that act on
 * its own state or its own rows. Off, every lane still runs all 51 calls, and the `publish-sweeps`
 * step runs the 40 as a dry run (counts, no writes) so the counts can be compared first.
 */
export const PUBLISH_SWEEPS_SPLIT_LIVE = false;
export const PUBLISH_SWEEPS_SOURCE = "hamilton.publish_sweeps";
export const PUBLISH_SWEEPS_STEP_KEY = "publish-sweeps";
/**
 * Off, the dry run runs at most once an hour (after a completed lane publish). Once a tick would
 * take most of every other tick from the lanes while they still run every sweep themselves: the
 * step is priced at 205 s and ranks first, so a tick that runs it fits no lane publish (225 s).
 */
export const PUBLISH_SWEEPS_DRY_RUN_INTERVAL_MINUTES = 60;
/** Would-be takedown ids the dry run keeps on its step detail, to measure the window. */
export const PUBLISH_SWEEPS_TAKEDOWN_ID_LIMIT = 500;

/** The 40 calls that move to `publish-sweeps`, in today's order (35 before the rows, 5 after). The 2026-10-18 proposal named these 40 and counted them as 39 (34 + 5); the names are the approved list. */
export const MOVED_PUBLISH_SWEEPS = [
  "outlierRestores",
  "offTaxonomyRestores",
  "taxonomyFold",
  "outlierRollbacks",
  "offTaxonomyRollbacks",
  "limitRollbacks",
  "businessSchedule",
  "sameLineDuplicates",
  "otherBank",
  "evalVerdicts",
  "handAmounts",
  "cutNameDuplicates",
  "accountTypeHold",
  "handTakedowns",
  "handAudience",
  "closedInstitution",
  "articlePage",
  "productPage",
  "productPageConflict",
  "crossPage",
  "categoryGuard",
  "earlyDuplicateCollapses",
  "nearNameCollapse",
  "pageCopyRestore",
  "pageCopyCollapse",
  "frequencyFill",
  "identicalCopy",
  "nameRetidy",
  "extractionNotes",
  "accountNames",
  "lineupCorrect",
  "restoreRecheck",
  "lostRestore",
  "changePairing",
  "crossPageRestore",
  "importedTwins",
  "sourceLinkFill",
  "linkDrift",
  "feedbackSync",
  "holdFeedback",
] as const;
export type MovedPublishSweep = (typeof MOVED_PUBLISH_SWEEPS)[number];

/**
 * The calls a lane publish keeps: state-scoped, or acting on this step's own rows. They stay in
 * run-store's publish step in today's order.
 */
export const KEPT_PUBLISH_CALLS = [
  "guardRequeue",
  "companionRetire",
  "newerCopy",
  "refreshCopy",
  "currentCopy",
  "rulesRecheck",
  "sourceLinkResource",
  "published",
  "lateDuplicateCollapses",
  "sourceCheck",
  "indexRefresh",
] as const;

/**
 * Which of the moved sweeps a step runs.
 * - `full`: every sweep (switch off, or a publish with no state and no institution).
 * - `lane`: none; the `publish-sweeps` step runs them (switch on, a state lane's publish).
 * - `institution`: every sweep scoped to the institution, and none of the seven that take no
 *   institution id (`GLOBAL_ONLY_PUBLISH_SWEEPS`) (switch on, a Read-now or hand-found run's publish).
 * - `sweeps`: every moved sweep, unscoped (the `publish-sweeps` step itself).
 */
export type PublishSweepMode = "full" | "lane" | "institution" | "sweeps";

export function publishSweepMode(options: {
  stepKey: string;
  stateCode?: string | null;
  institutionId?: number | null;
  live?: boolean;
}): PublishSweepMode {
  if (options.stepKey === PUBLISH_SWEEPS_STEP_KEY) return "sweeps";
  const live = options.live ?? PUBLISH_SWEEPS_SPLIT_LIVE;
  if (!live || options.stepKey !== "publish") return "full";
  if (options.institutionId != null) return "institution";
  if (options.stateCode) return "lane";
  return "full";
}

/**
 * The moved sweeps that take no institution id, so in a Read-now publish they would still run over
 * every bank. With the split on, a Read-now publish leaves them to the `publish-sweeps` step:
 * - `feedbackSync`, `holdFeedback`: learning-store upkeep over every outcome; nothing about the bank.
 * - `handAmounts`, `cutNameDuplicates`, `handTakedowns`, `handAudience`: fixed hand lists keyed by
 *   fee ids already applied; a row the Read-now step publishes gets a new id, so no list can name
 *   it. A newly merged list entry reaches its rows at the next `publish-sweeps` run (one tick), as
 *   does a re-read of a listed line (`handTakedowns`' returns, matched by line, not id).
 * - `extractionNotes`: a tidy of Knox's raw rows (`conditions` to `extraction_note`); it never
 *   decides whether a fee publishes.
 * `accountTypeHold` stays in the Read-now publish, scoped to its bank: it holds the bank's own
 * non-checking monthly fees as verified before its rows publish (#1100 gap 1).
 */
export const GLOBAL_ONLY_PUBLISH_SWEEPS: readonly MovedPublishSweep[] = [
  "handAmounts",
  "cutNameDuplicates",
  "handTakedowns",
  "handAudience",
  "extractionNotes",
  "feedbackSync",
  "holdFeedback",
];

/**
 * Moved sweeps that check a sample per run, keyed by the run (`md5(id || run id)`) or the hour:
 * a dry run and the next lane publish sample different institutions, so their counts differ
 * by sample, not by state. The page-copy takedowns a 2026-10-19 dry run counted and the lanes did
 * not (fees 8543, 82637, 81908) were this: the lanes had not sampled institutions 8121 and 608
 * (25 a run from a pool of 947). Compare these by day totals, not pair by pair.
 */
export const SAMPLED_PUBLISH_SWEEPS: readonly MovedPublishSweep[] = [
  "pageCopyRestore",
  "pageCopyCollapse",
  "nearNameCollapse",
  "crossPage",
];

export function runsMovedSweep(mode: PublishSweepMode, key: MovedPublishSweep): boolean {
  if (mode === "lane") return false;
  if (mode === "institution") return !GLOBAL_ONLY_PUBLISH_SWEEPS.includes(key);
  return true;
}

/** Runs one publish sweep and adds its milliseconds to `times` under `key`; the result is unchanged. */
export async function timedSweep<T>(times: Record<string, number>, key: string, run: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    return await run();
  } finally {
    times[key] = (times[key] ?? 0) + (Date.now() - started);
  }
}

export interface MovedSweepContext {
  db: SqlTag;
  runId: number;
  stepId: number;
  dryRun: boolean;
  /** Undefined in a lane or the `publish-sweeps` step: every state's live fees. */
  institutionId: number | undefined;
  /** The research split's exact dry-run count over every row, on request (#1398). */
  researchSplitFullCount: boolean;
  /** The category guard's batch per step (run-store's CATEGORY_GUARD_STEP_LIMIT). */
  categoryGuardLimit: number;
  sweepMs: Record<string, number>;
  mode: PublishSweepMode;
  /** Called after each sweep that ran (the dry run's write check). */
  afterSweep?: (key: MovedPublishSweep) => Promise<void>;
}

async function sweep<T>(ctx: MovedSweepContext, key: MovedPublishSweep, empty: () => T, run: () => Promise<T>): Promise<T> {
  if (!runsMovedSweep(ctx.mode, key)) return empty();
  const result = await timedSweep(ctx.sweepMs, key, run);
  if (ctx.afterSweep) await ctx.afterSweep(key);
  return result;
}

const batchId = (ctx: MovedSweepContext) => `agentic-run-${ctx.runId}`;

/** Before the guard requeue: restores, the fold, rollbacks, the hand lists and the category guard. */
export async function sweepsBeforeGuardRequeue(ctx: MovedSweepContext) {
  const { db: tx, dryRun, institutionId } = ctx;
  const runId = ctx.runId;
  // A takedown is never final: fees an earlier sweep took down come back once a range
  // widens or the taxonomy gains their category.
  const outlierRestores = await sweep(ctx, "outlierRestores", () => [] as Result<typeof restoreOutliersNowInRange>, () => restoreOutliersNowInRange(tx, {
    runId,
    dryRun,
    institutionId,
  }));
  const offTaxonomyRestores = await sweep(ctx, "offTaxonomyRestores", () => [] as Result<typeof restoreFeesNowInTaxonomy>, () => restoreFeesNowInTaxonomy(tx, {
    runId,
    dryRun,
    institutionId,
  }));
  // The top-50 fold: fees under the fifteen retired categories move to the one their
  // wording places them in, before any sweep judges them by category (fee-fold.ts).
  const taxonomyFold = await sweep(ctx, "taxonomyFold", () => emptyTaxonomyFold(dryRun), () => foldRetiredCategories(tx, {
    runId,
    stepId: ctx.stepId,
    dryRun,
    institutionId,
    researchSplitFullCount: ctx.researchSplitFullCount,
  }));
  const outlierRollbacks = await sweep(ctx, "outlierRollbacks", () => [] as Result<typeof rollBackPublishedOutliers>, () => rollBackPublishedOutliers(tx, {
    runId,
    batchId: batchId(ctx),
    dryRun,
    institutionId,
  }));
  const offTaxonomyRollbacks = await sweep(ctx, "offTaxonomyRollbacks", () => [] as Result<typeof rollBackOffTaxonomyFees>, () => rollBackOffTaxonomyFees(tx, {
    runId,
    batchId: batchId(ctx),
    dryRun,
    institutionId,
  }));
  // A transfer or deposit limit read as a price ("Zelle® transfer limit | $1,000").
  const limitRollbacks = await sweep(ctx, "limitRollbacks", () => [] as Result<typeof rollBackLimitsPublishedAsFees>, () => rollBackLimitsPublishedAsFees(tx, {
    runId,
    batchId: batchId(ctx),
    dryRun,
    institutionId,
  }));
  // A business schedule's fee beside the bank's consumer fee in the same category.
  const businessSchedule = await sweep(ctx, "businessSchedule", (): Result<typeof retireBusinessScheduleFees> => ({
    businessFees: 0, withConsumerFee: 0, flagged: 0, waiting: 0, rolledBack: [], restored: 0, dryRun,
  }), () => retireBusinessScheduleFees(tx, {
    runId,
    batchId: batchId(ctx),
    dryRun,
    institutionId,
  }));
  // A fee the same-line re-decide (9 Oct) published beside an older live line of itself.
  const sameLineDuplicates = await sweep(ctx, "sameLineDuplicates", (): Result<typeof retireSameLineDuplicates> => ({
    candidates: 0, duplicates: 0, flagged: 0, waiting: 0, rolledBack: [], restored: 0, dryRun,
  }), () => retireSameLineDuplicates(tx, {
    runId,
    batchId: batchId(ctx),
    dryRun,
    institutionId,
  }));
  // Another bank's fee: read from a document on another institution's own website.
  const otherBank = await sweep(ctx, "otherBank", (): Result<typeof retireOtherBankDocumentFees> => ({
    otherBankFees: 0, namesOwnBank: 0, flagged: 0, waiting: 0, unconfirmedHostFees: 0, unconfirmedHostFlagged: 0,
    unconfirmedHostWaiting: 0, rolledBack: [], linksCleared: 0, dryRun,
  }), () => retireOtherBankDocumentFees(tx, {
    runId,
    batchId: batchId(ctx),
    dryRun,
    institutionId,
  }));
  // The complete-record eval's critical rows (down now, James Oct 8) and the two name
  // shapes they taught: a rebate published as an ATM fee, a "no fee for" sentence as a fee.
  const evalVerdicts = await sweep(ctx, "evalVerdicts", (): Result<typeof retireEvalVerdictFees> => ({
    evalMatched: 0, evalChanged: 0, handMatched: 0, ruleFailing: 0, deferred: 0, deferredIds: [], flagged: 0, waiting: 0,
    cleared: 0, reconstructed: 0, rolledBack: [], flags: {} as Result<typeof retireEvalVerdictFees>["flags"], flagSamples: [], dryRun,
  }), () => retireEvalVerdictFees(tx, {
    runId,
    batchId: batchId(ctx),
    dryRun,
    institutionId,
  }));
  // #1334: eight live fees read with their cents cut off are corrected in place, and the
  // unpublished copies of those reads rejected, before this step publishes anything.
  const handAmounts = await sweep(ctx, "handAmounts", (): Result<typeof applyHandAmountCorrections> => ({
    dryRun, corrected: [], skipped: [], rejectedTwins: [], skippedTwins: [],
  }), () => applyHandAmountCorrections(tx, { runId, stepId: ctx.stepId, dryRun }));
  // #1196: five live cut-name rows that repeat a clean live row come down; the clean row stays.
  const cutNameDuplicates = await sweep(ctx, "cutNameDuplicates", (): Result<typeof applyCutNameDuplicates> => ({
    dryRun, takenDown: [], skipped: [], error: null,
  }), () => applyCutNameDuplicates(tx, {
    runId,
    stepId: ctx.stepId,
    batchId: batchId(ctx),
    dryRun,
  }));
  // #1100 gap 1 (James, Oct 16): a non-checking account's monthly fee is held as verified with
  // its account type and never published as consumer checking monthly maintenance.
  const accountTypeHold = await sweep(ctx, "accountTypeHold", (): Result<typeof applyAccountTypeHold> => ({
    dryRun, heldLive: [], heldWaiting: [], checkedUntyped: 0, recheckNoProduct: 0, restoredHeld: [], typedRejected: [], error: null,
  }), () => applyAccountTypeHold(tx, {
    runId,
    stepId: ctx.stepId,
    batchId: batchId(ctx),
    dryRun,
    // Scoped to the bank only in a Read-now publish with the split on; otherwise every bank, as before.
    ...(ctx.mode === "institution" ? { institutionId } : {}),
  }));
  // Listed live fees confirmed wrong against their bank's own text (James, Oct 16; #1496 first).
  const handTakedowns = await sweep(ctx, "handTakedowns", (): Result<typeof applyHandTakedowns> => ({
    dryRun, takenDown: [], skipped: [], waitingRejected: [], returns: [], returnsLive: false, error: null,
  }), () => applyHandTakedowns(tx, {
    runId,
    stepId: ctx.stepId,
    batchId: batchId(ctx),
    dryRun,
  }));
  // Listed live fees whose audience is wrong against their bank's own text (#1302 first).
  const handAudience = await sweep(ctx, "handAudience", (): Result<typeof applyHandAudienceFixes> => ({
    dryRun, fixed: [], skipped: [], error: null,
  }), () => applyHandAudienceFixes(tx, { runId, stepId: ctx.stepId, dryRun }));
  // An institution that no longer operates keeps no live fee (#1200).
  const closedInstitution = await sweep(ctx, "closedInstitution", (): Result<typeof retireClosedInstitutionFees> => ({
    liveFees: 0, institutions: 0, rolledBack: [], dryRun,
  }), () => retireClosedInstitutionFees(tx, {
    runId,
    batchId: batchId(ctx),
    dryRun,
    institutionId,
  }));
  // A fee read from an article (a blog post quoting a national average), not a schedule.
  const articlePage = await sweep(ctx, "articlePage", (): Result<typeof retireArticlePageFees> => ({
    articleFees: 0, flagged: 0, waiting: 0, rolledBack: [], dryRun,
  }), () => retireArticlePageFees(tx, {
    runId,
    batchId: batchId(ctx),
    dryRun,
    institutionId,
  }));
  // A $0 benefit bullet read from a product page, not a schedule (off until James answers).
  const productPage = await sweep(ctx, "productPage", (): Result<typeof retireProductPageFees> => ({
    enabled: false, productFees: 0, flagged: 0, waiting: 0, rolledBack: [], dryRun,
  }), () => retireProductPageFees(tx, {
    runId,
    batchId: batchId(ctx),
    dryRun,
    institutionId,
  }));
  // A product-page fee the bank's own schedule prices differently: the schedule wins
  // (James, 2026-10-13). On since 2026-10-20 after an automatic sample checked clean (`PRODUCT_PAGE_CONFLICT_LIVE`).
  const productPageConflict = await sweep(ctx, "productPageConflict", (): Result<typeof retireProductPageConflicts> => ({
    live: false, conflicts: 0, flagged: 0, cleared: 0, waiting: 0, rolledBack: [], dryRun,
  }), () => retireProductPageConflicts(tx, {
    runId,
    batchId: batchId(ctx),
    dryRun,
    institutionId,
  }));
  // One product priced differently on two current pages: the older page's price comes down.
  const crossPage = await sweep(ctx, "crossPage", (): Result<typeof retireCrossPageConflicts> => ({
    pairsChecked: 0, conflicts: 0, flagged: 0, waiting: 0, rolledBack: [], dryRun,
  }), () => retireCrossPageConflicts(tx, {
    runId,
    batchId: batchId(ctx),
    dryRun,
    institutionId,
  }));
  // A live fee whose own name contradicts its category (an ATM fee filed as a card's
  // foreign transaction fee, a rate's figure read as dollars) comes down each step, so
  // a guard change takes effect without anyone starting the repair run by hand.
  const categoryGuard = await sweep(ctx, "categoryGuard", (): Result<typeof runHamiltonCategoryGuard> => ({
    scannedFees: 0, failingFees: 0, rolledBackFees: 0, rejectedVerifiedFees: 0, flaggedFees: 0, awaitingSecondLook: 0,
    confirmedFeeIds: [], restoredFees: 0, refiledFees: 0, liveRefiledFees: 0, cardProductPending: 0, cardProductPendingSamples: [], headingReadFailed: false, boxSectionReadFailed: false,
    limit: ctx.categoryGuardLimit, dryRun, rollbackBatchId: batchId(ctx), guardVersion: 0, byCode: {}, byCategory: {}, failures: [],
  }), () => runHamiltonCategoryGuard({
    runId,
    dryRun,
    limit: ctx.categoryGuardLimit,
    institutionId,
    db: tx,
  }));
  return {
    outlierRestores, offTaxonomyRestores, taxonomyFold, outlierRollbacks, offTaxonomyRollbacks, limitRollbacks,
    businessSchedule, sameLineDuplicates, otherBank, evalVerdicts, handAmounts, cutNameDuplicates, accountTypeHold,
    handTakedowns, handAudience, closedInstitution, articlePage, productPage, productPageConflict, crossPage, categoryGuard,
  };
}

function emptyTaxonomyFold(dryRun: boolean): Result<typeof foldRetiredCategories> {
  return {
    scanned: 0, moved: 0, movedLive: 0, byRoute: {}, noHomeFlagged: 0, noHomeWaiting: 0, noHomeRolledBack: 0, noHomeHeld: 0,
    unplacedVerified: 0, feedbackRows: 0, handRefiled: 0, handSkipped: [], handFlagsCleared: 0, dryRun, rulesVersion: 0, noHomeSample: [],
    pendingResearchSplit: null,
  };
}

/** After the companion retire, before the newer-copy check: duplicate and page-copy collapses, frequencies. */
export async function sweepsBeforeNewerCopy(ctx: MovedSweepContext) {
  const { db: tx, dryRun, institutionId, runId } = ctx;
  const earlyDuplicateCollapses = await sweep(ctx, "earlyDuplicateCollapses", () => [] as Result<typeof collapsePublishedDuplicates>, () => collapsePublishedDuplicates(tx, {
    runId,
    batchId: batchId(ctx),
    dryRun,
    institutionId,
  }));
  // #1302: a live row that repeats another live line of its page under a near name ("Research
  // fee" / "Account Research fee"), when the page prints one line. Live while
  // NEAR_NAME_COLLAPSE_LIVE is on; a dry run reports and changes nothing.
  const nearNameCollapse = await sweep(ctx, "nearNameCollapse", (): Result<typeof collapseNearNameDuplicates> => ({
    live: false, documents: 0, pairs: 0, apartOnPage: 0, notPrinted: 0, noText: 0, collapses: [],
  }), () => collapseNearNameDuplicates(tx, {
    runId,
    batchId: batchId(ctx),
    dryRun,
    institutionId,
  }));
  // #1439 item 3: a copy the page-copy collapse closed comes back when the copy it was kept
  // for came down for its own reasons (not the fee's), so the fee does not vanish. Runs
  // before the collapse; it never makes a second live copy of a price.
  const pageCopyRestore = await sweep(ctx, "pageCopyRestore", (): Result<typeof restorePageCopiesOfDownedKeepers> => ({
    keptDown: 0, carriedOn: 0, keptJudged: 0, failing: [], restored: [], dryRun,
  }), () => restorePageCopiesOfDownedKeepers(tx, {
    runId,
    dryRun,
    institutionId,
  }));
  // #1439: a live row that repeats a line of a newer copy of its page stored under another
  // address ("?print=1", "www.", a mirror). Closes them while PAGE_COPY_COLLAPSE_LIVE is on (James, Oct 17).
  const pageCopyCollapse = await sweep(ctx, "pageCopyCollapse", (): Result<typeof collapsePageCopies> => ({
    live: false, institutions: 0, pairs: 0, apartOnPage: 0, unproven: 0, otherDocument: 0, renamed: 0, collapses: [],
  }), () => collapsePageCopies(tx, {
    runId,
    batchId: batchId(ctx),
    dryRun,
    institutionId,
  }));
  // A live fee's frequency follows its own schedule row: a blank gets the one the row states
  // ("$6.00 each"), and one read from another fee's row is corrected or cleared.
  // A failed fill write is a warning here, never a failed publish (#1349 review).
  const frequencyFill = await sweep(ctx, "frequencyFill", (): Result<typeof fillFrequenciesInPublish> => ({
    scanned: 0, filled: [], held: [], planWouldHold: [], dryRun, writeError: null,
  }), () => fillFrequenciesInPublish(tx, {
    runId,
    stepId: ctx.stepId,
    dryRun,
    institutionId,
  }));
  return { earlyDuplicateCollapses, nearNameCollapse, pageCopyRestore, pageCopyCollapse, frequencyFill };
}

/** After the newer-copy check, before the copy refresh. */
export async function sweepsBeforeRefreshCopy(ctx: MovedSweepContext) {
  const { db: tx, dryRun, institutionId, runId } = ctx;
  // A current copy whose text is identical to the superseded one has no rows of its
  // own (Knox skips text it has read), so the superseded copy's rows move to it.
  const identicalCopy = await sweep(ctx, "identicalCopy", (): Result<typeof moveRowsToIdenticalCopy> => ({
    documents: 0, rowsMoved: 0,
  }), () => moveRowsToIdenticalCopy(tx, {
    runId,
    dryRun,
    institutionId,
  }));
  return { identicalCopy };
}

/** After the rules re-check, before the source-link re-source and the row loop. */
export async function sweepsBeforeRows(ctx: MovedSweepContext) {
  const { db: tx, dryRun, institutionId, runId } = ctx;
  // Live names stored before Knox tidied its reads ("Stop Payment | Item", "A dormant fee
  // of") take their tidy name, a batch of banks per step; the old name stays in
  // pipeline_feedback and a rename never makes a fee fail the source check.
  const nameRetidy = await sweep(ctx, "nameRetidy", (): Result<typeof retidyLiveFeeNames> => ({
    dryRun, institutionsChecked: 0, messyFees: 0, renames: [], skipped: {} as Result<typeof retidyLiveFeeNames>["skipped"],
  }), () => retidyLiveFeeNames(tx, {
    runId,
    dryRun,
    institutionId,
  }));
  // #1234 step 2: Knox's note leaves `conditions` for `extraction_note`, a batch per step.
  const extractionNotes = await sweep(ctx, "extractionNotes", (): Result<typeof moveExtractionNotes> => ({
    moved: 0, remaining: null, dryRun,
  }), () => moveExtractionNotes(tx, { runId, dryRun }));
  // A live fee named only "Monthly Service Fee" takes the account heading above it in its
  // schedule ("Chase Total Checking Monthly Service Fee"); the old name stays in pipeline_feedback.
  const accountNames = await sweep(ctx, "accountNames", (): Result<typeof nameLiveFeesByAccount> => ({
    dryRun, institutionsChecked: 0, genericFees: 0, reverts: [], renames: [], skipped: {} as Result<typeof nameLiveFeesByAccount>["skipped"],
  }), () => nameLiveFeesByAccount(tx, {
    runId,
    dryRun,
    institutionId,
  }));
  // Lineup values stored before Knox v55 that came from a neighbouring account (a balance,
  // waiver or name) are corrected from the stored text; old values stay in pipeline_feedback.
  const lineupCorrect = await sweep(ctx, "lineupCorrect", (): Result<typeof correctStoredLineups> => ({
    dryRun, documentsChecked: 0, rowsChecked: 0, corrected: [],
  }), () => correctStoredLineups(tx, {
    runId,
    dryRun,
    institutionId,
  }));
  // Fees an older re-check restored with no check at all get the restore bar on a second look.
  const restoreRecheck = await sweep(ctx, "restoreRecheck", (): Result<typeof recheckUncheckedRestores> => ({
    unchecked: 0, withoutText: 0, passing: 0, failing: [], flagged: 0, waiting: 0, rolledBack: [], dryRun,
  }), () => recheckUncheckedRestores(tx, {
    runId,
    batchId: batchId(ctx),
    dryRun,
    institutionId,
  }));
  // #1071: fees the re-check took down on Oct 5-11 (before #1022) that are not live again are
  // judged once by the restore bar against their document's newest text; those that pass return.
  const lostRestore = await sweep(ctx, "lostRestore", (): Result<typeof restoreLostRecheckTakedowns> => ({
    candidates: 0, passed: [], failed: [], skipped: [], restored: 0, dryRun,
  }), () => restoreLostRecheckTakedowns(tx, {
    runId,
    batchId: batchId(ctx),
    dryRun,
    institutionId,
  }));
  // Recorded fee changes name their two rows and whether they compare one page with
  // itself, before the restore below reopens any superseded row.
  const changePairing = await sweep(ctx, "changePairing", (): Result<typeof pairFeeChangeRecords> => ({
    unpaired: 0, likeForLike: 0, crossPage: 0, listsBoth: 0, noPair: 0, written: 0, dryRun,
  }), () => pairFeeChangeRecords(tx, {
    runId,
    dryRun,
    institutionId,
  }));
  // Live fees another page's price superseded come back through the restore bar.
  const crossPageRestore = await sweep(ctx, "crossPageRestore", (): Result<typeof restoreCrossPageSupersedes> => ({
    superseded: 0, crossPage: 0, businessLeftDown: 0, failing: [], restored: [], dryRun,
  }), () => restoreCrossPageSupersedes(tx, {
    runId,
    dryRun,
    institutionId,
  }));
  return { nameRetidy, extractionNotes, accountNames, lineupCorrect, restoreRecheck, lostRestore, changePairing, crossPageRestore };
}

/** After the row loop and the source check: links, learning feedback. */
export async function sweepsAfterRows(ctx: MovedSweepContext) {
  const { db: tx, dryRun, institutionId, runId } = ctx;
  // Imported fees with no document take their schedule through an identical imported
  // row the source check could not relink them past.
  const importedTwins = await sweep(ctx, "importedTwins", (): Result<typeof linkImportedFeesToTwins> => ({
    checked: 0, linked: 0, untraced: 0,
  }), () => linkImportedFeesToTwins(tx, {
    runId,
    dryRun,
    institutionId,
  }));
  // #1342: a live fee with no link (one the source check restored after the hand repair,
  // say) takes its own document's URL. Never a takedown. Off with SOURCE_LINK_FILL_ON.
  const sourceLinkFill = await sweep(ctx, "sourceLinkFill", (): Result<typeof fillSourceLinks> => ({
    on: false, dryRun, scanned: 0, fills: [], untraceable: 0, error: null,
  }), () => fillSourceLinks(tx, {
    runId,
    batchId: batchId(ctx),
    dryRun,
    institutionId,
  }));
  // #1347: a live fee whose link opens neither its document's URL nor the page its text was
  // read from takes its document's link when it traces there; one that does not goes through
  // the second look and is archived. Off with SOURCE_LINK_DRIFT_LIVE (then it only reports).
  const linkDrift = await sweep(ctx, "linkDrift", (): Result<typeof repairLinkDrift> => ({
    live: false, dryRun, scanned: 0, repoints: [], flagged: 0, waiting: 0, archived: [], failing: [], skipped: [], error: null,
  }), () => repairLinkDrift(tx, {
    runId,
    batchId: batchId(ctx),
    dryRun,
    institutionId,
  }));
  // Every agent learns from what happened to its output: this step's takedowns and
  // restores (and a batch of older outcomes) go into the shared learning store.
  const feedbackSync = await sweep(ctx, "feedbackSync", (): Result<typeof syncPipelineFeedback> => ({
    ready: false, takedowns: 0, restores: 0, categoryRejects: 0, answerKeyFees: 0, written: 0, relabeled: 0,
  }), () => syncPipelineFeedback(tx, { runId, dryRun }));
  // #1100: the sync's old rows for account type holds go to weight 0, behind a switch (off).
  const holdFeedback = await sweep(ctx, "holdFeedback", (): Result<typeof repairAccountTypeHoldFeedback> => ({
    on: false, dryRun, due: null, zeroed: 0, error: null,
  }), () => repairAccountTypeHoldFeedback(tx, { runId, dryRun }));
  return { importedTwins, sourceLinkFill, linkDrift, feedbackSync, holdFeedback };
}

export type MovedSweepResults = Awaited<ReturnType<typeof sweepsBeforeGuardRequeue>> &
  Awaited<ReturnType<typeof sweepsBeforeNewerCopy>> &
  Awaited<ReturnType<typeof sweepsBeforeRefreshCopy>> &
  Awaited<ReturnType<typeof sweepsBeforeRows>> &
  Awaited<ReturnType<typeof sweepsAfterRows>>;

/**
 * What each moved sweep changed (or, in a dry run, would change), one number per sweep and a
 * `.flagged` number where it flags for a second look. A lane publish and the `publish-sweeps`
 * step both record it as `sweep_counts`, so the dry run's counts can be set beside the lanes'.
 * The same fields the step's summary sentence reads, so dry and live count alike.
 */
export function movedSweepCounts(r: MovedSweepResults, ran: (key: MovedPublishSweep) => boolean): Record<string, number> {
  const all: Record<string, number> = {
    outlierRestores: r.outlierRestores.length,
    offTaxonomyRestores: r.offTaxonomyRestores.length,
    taxonomyFold: r.taxonomyFold.moved + r.taxonomyFold.handRefiled + r.taxonomyFold.handFlagsCleared + r.taxonomyFold.noHomeRolledBack,
    "taxonomyFold.flagged": r.taxonomyFold.noHomeFlagged,
    outlierRollbacks: r.outlierRollbacks.length,
    offTaxonomyRollbacks: r.offTaxonomyRollbacks.length,
    limitRollbacks: r.limitRollbacks.length,
    businessSchedule: r.businessSchedule.rolledBack.length + r.businessSchedule.restored,
    "businessSchedule.flagged": r.businessSchedule.flagged,
    sameLineDuplicates: r.sameLineDuplicates.rolledBack.length + r.sameLineDuplicates.restored,
    "sameLineDuplicates.flagged": r.sameLineDuplicates.flagged,
    otherBank: r.otherBank.rolledBack.length + r.otherBank.linksCleared,
    "otherBank.flagged": r.otherBank.flagged + r.otherBank.unconfirmedHostFlagged,
    evalVerdicts: r.evalVerdicts.rolledBack.length,
    "evalVerdicts.flagged": r.evalVerdicts.flagged,
    handAmounts: r.handAmounts.corrected.length + r.handAmounts.rejectedTwins.length,
    cutNameDuplicates: r.cutNameDuplicates.takenDown.length,
    accountTypeHold:
      r.accountTypeHold.heldLive.length + r.accountTypeHold.heldWaiting.length +
      r.accountTypeHold.restoredHeld.length + r.accountTypeHold.typedRejected.length,
    handTakedowns: r.handTakedowns.takenDown.length + r.handTakedowns.waitingRejected.length,
    handAudience: r.handAudience.fixed.length,
    closedInstitution: r.closedInstitution.rolledBack.length,
    articlePage: r.articlePage.rolledBack.length,
    "articlePage.flagged": r.articlePage.flagged,
    productPage: r.productPage.rolledBack.length,
    "productPage.flagged": r.productPage.flagged,
    productPageConflict: r.productPageConflict.rolledBack.length,
    "productPageConflict.flagged": r.productPageConflict.flagged,
    crossPage: r.crossPage.rolledBack.length,
    "crossPage.flagged": r.crossPage.flagged,
    categoryGuard:
      (r.categoryGuard.dryRun ? Math.min(r.categoryGuard.failingFees, r.categoryGuard.limit) : r.categoryGuard.rolledBackFees) +
      r.categoryGuard.liveRefiledFees,
    "categoryGuard.flagged": r.categoryGuard.flaggedFees,
    earlyDuplicateCollapses: r.earlyDuplicateCollapses.length,
    nearNameCollapse: r.nearNameCollapse.live ? r.nearNameCollapse.collapses.length : 0,
    pageCopyRestore: r.pageCopyRestore.restored.length,
    pageCopyCollapse: r.pageCopyCollapse.live ? r.pageCopyCollapse.collapses.length : 0,
    frequencyFill: r.frequencyFill.filled.length + r.frequencyFill.held.length,
    identicalCopy: r.identicalCopy.rowsMoved,
    nameRetidy: r.nameRetidy.renames.length,
    extractionNotes: r.extractionNotes.moved,
    accountNames: r.accountNames.renames.length,
    "accountNames.reverted": r.accountNames.reverts?.length ?? 0,
    lineupCorrect: r.lineupCorrect.corrected.length,
    restoreRecheck: r.restoreRecheck.rolledBack.length,
    "restoreRecheck.flagged": r.restoreRecheck.flagged,
    // A dry run reports the restores that pass the bar; a live run the ones it made.
    lostRestore: r.lostRestore.dryRun ? r.lostRestore.passed.length : r.lostRestore.restored,
    changePairing: r.changePairing.dryRun
      ? r.changePairing.likeForLike + r.changePairing.crossPage + r.changePairing.listsBoth + r.changePairing.noPair
      : r.changePairing.written,
    crossPageRestore: r.crossPageRestore.restored.length,
    importedTwins: r.importedTwins.linked,
    sourceLinkFill: r.sourceLinkFill.fills.length,
    linkDrift: r.linkDrift.repoints.length + r.linkDrift.archived.length,
    "linkDrift.flagged": r.linkDrift.flagged,
    // A dry run writes nothing, so it counts the rows it would upsert (`wouldWrite`).
    feedbackSync: (r.feedbackSync.wouldWrite ?? r.feedbackSync.written) + r.feedbackSync.relabeled,
    holdFeedback: r.holdFeedback.zeroed,
  };
  const counts: Record<string, number> = {};
  for (const [key, value] of Object.entries(all)) {
    if (ran(key.split(".")[0] as MovedPublishSweep)) counts[key] = value;
  }
  return counts;
}

/**
 * The live fees the moved sweeps took down, or in a dry run would take down: the window check
 * sets these against rows lane publishes published shortly before.
 */
export function movedSweepTakedownIds(r: MovedSweepResults): number[] {
  const ids = [
    ...r.outlierRollbacks.map((row) => row.feePublishedId),
    ...r.offTaxonomyRollbacks.map((row) => row.feePublishedId),
    ...r.limitRollbacks.map((row) => row.feePublishedId),
    ...r.businessSchedule.rolledBack.map((row) => row.feePublishedId),
    ...r.sameLineDuplicates.rolledBack.map((row) => row.feePublishedId),
    ...r.otherBank.rolledBack.map((row) => row.feePublishedId),
    ...r.evalVerdicts.rolledBack.map((row) => row.feePublishedId),
    ...r.cutNameDuplicates.takenDown.map((row) => row.feePublishedId),
    ...r.handTakedowns.takenDown.map((row) => row.feePublishedId),
    ...r.closedInstitution.rolledBack.map((row) => row.feePublishedId),
    ...r.articlePage.rolledBack.map((row) => row.feePublishedId),
    ...r.productPage.rolledBack.map((row) => row.feePublishedId),
    ...r.productPageConflict.rolledBack.map((row) => row.feePublishedId),
    ...r.crossPage.rolledBack.map((row) => row.feePublishedId),
    // Only failures a second look confirmed; first looks and waiting fees stay live
    // (`movedSweepSecondLookIds`).
    ...r.categoryGuard.confirmedFeeIds,
    ...r.earlyDuplicateCollapses.map((row) => row.feePublishedId),
    ...(r.nearNameCollapse.live ? r.nearNameCollapse.collapses.map((row) => row.feePublishedId) : []),
    ...(r.pageCopyCollapse.live ? r.pageCopyCollapse.collapses.map((row) => row.feePublishedId) : []),
    ...r.restoreRecheck.rolledBack.map((row) => row.feePublishedId),
    ...r.linkDrift.archived.map((row) => row.feePublishedId),
  ];
  return Array.from(new Set(ids.filter((id): id is number => Number.isFinite(id)))).sort((a, b) => a - b);
}

/**
 * Category-guard failures that are not coming down this run: first looks and fees waiting for
 * their second look. Kept apart from the takedown ids so the window check counts only takedowns.
 */
export function movedSweepSecondLookIds(r: MovedSweepResults): number[] {
  const confirmed = new Set(r.categoryGuard.confirmedFeeIds);
  return Array.from(new Set(r.categoryGuard.failures.map((row) => row.feePublishedId).filter((id) => !confirmed.has(id)))).sort((a, b) => a - b);
}

const DRY_RUN_ROLLBACK = Symbol("publish-sweeps dry run rolled back");

/**
 * Run `work` in a savepoint that is always rolled back, so nothing it writes through `db`
 * survives (a dry run's safety net). Outside a transaction (a test double) `work` runs directly.
 */
export async function inRolledBackSavepoint<T>(db: SqlTag, work: (scope: SqlTag) => Promise<T>): Promise<{ result: T; rolledBack: boolean }> {
  const savepoint = (db as unknown as { savepoint?: unknown }).savepoint;
  if (typeof savepoint !== "function") return { result: await work(db), rolledBack: false };
  let result: T | undefined;
  try {
    await (savepoint as (callback: (scope: SqlTag) => Promise<unknown>) => Promise<unknown>).call(db, async (scope: SqlTag) => {
      result = await work(scope);
      throw DRY_RUN_ROLLBACK;
    });
  } catch (error) {
    if (error !== DRY_RUN_ROLLBACK) throw error;
  }
  return { result: result as T, rolledBack: true };
}

async function transactionHasWritten(db: SqlTag): Promise<boolean | null> {
  try {
    const [row] = await db<Array<{ xid: string | null }>>`SELECT pg_current_xact_id_if_assigned()::text AS xid`;
    return row?.xid != null;
  } catch {
    return null;
  }
}

export interface PublishSweepsStepOutcome {
  status: "completed";
  summary: string;
  detail: Record<string, unknown>;
}

/**
 * The `publish-sweeps` step: the 40 moved sweeps over every state's live fees, in today's order.
 * Live (switch on, not a dry-run run), the caller holds `agents.hamilton.publish` as a publish
 * step does, and the fee index refreshes when a sweep changed a live fee. Off, it is a dry run:
 * every sweep gets `dryRun: true`, the whole pass runs in a savepoint that is rolled back, and the
 * step records whether anything was written anyway (`dry_run_write_check`). The dry run takes no
 * lock: it writes nothing, and holding the lock for its ~100 s would make lane publishes wait.
 */
export async function runPublishSweepsStep(
  db: SqlTag,
  options: { runId: number; stepId: number; live: boolean; categoryGuardLimit: number },
): Promise<PublishSweepsStepOutcome> {
  const startedAt = Date.now();
  const sweepMs: Record<string, number> = {};
  const dryRun = !options.live;
  // Held in an object: the closure below sets it, which plain `let` narrowing does not see.
  const check: { state: "clean" | "wrote" | "unknown"; firstWriter: MovedPublishSweep | null } = { state: "clean", firstWriter: null };
  const pass = async (scope: SqlTag): Promise<MovedSweepResults> => {
    const ctx: MovedSweepContext = {
      db: scope,
      runId: options.runId,
      stepId: options.stepId,
      dryRun,
      institutionId: undefined,
      researchSplitFullCount: false,
      categoryGuardLimit: options.categoryGuardLimit,
      sweepMs,
      mode: "sweeps",
      afterSweep: dryRun
        ? async (key) => {
            if (check.state !== "clean") return;
            const wrote = await transactionHasWritten(scope);
            if (wrote === null) check.state = "unknown";
            else if (wrote) {
              check.state = "wrote";
              check.firstWriter = key;
            }
          }
        : undefined,
    };
    return {
      ...(await sweepsBeforeGuardRequeue(ctx)),
      ...(await sweepsBeforeNewerCopy(ctx)),
      ...(await sweepsBeforeRefreshCopy(ctx)),
      ...(await sweepsBeforeRows(ctx)),
      ...(await sweepsAfterRows(ctx)),
    };
  };

  let results: MovedSweepResults;
  let rolledBack = false;
  if (dryRun) {
    const before = await transactionHasWritten(db);
    if (before !== false) check.state = "unknown";
    const outcome = await inRolledBackSavepoint(db, pass);
    results = outcome.result;
    rolledBack = outcome.rolledBack;
  } else {
    results = await pass(db);
  }

  const counts = movedSweepCounts(results, () => true);
  const changed = Object.entries(counts)
    .filter(([key]) => !key.includes("."))
    .reduce((sum, [, value]) => sum + value, 0);
  const flagged = Object.entries(counts)
    .filter(([key]) => key.endsWith(".flagged"))
    .reduce((sum, [, value]) => sum + value, 0);
  const takedownIds = movedSweepTakedownIds(results);
  const secondLookIds = movedSweepSecondLookIds(results);
  const indexRefresh = !dryRun && changed > 0
    ? await timedSweep(sweepMs, "indexRefresh", () => refreshFeeIndexCache(db, { runId: options.runId, force: true }))
    : null;
  const busiest = Object.entries(counts)
    .filter(([key, value]) => !key.includes(".") && value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key, value]) => `${key} ${value.toLocaleString()}`);
  const seconds = Math.round((Date.now() - startedAt) / 1000);
  const summary = dryRun
    ? `Publish sweeps dry run (switch off, nothing written): the ${MOVED_PUBLISH_SWEEPS.length} moved sweeps would change ${changed.toLocaleString()} row(s) and flag ${flagged.toLocaleString()} for a second look${busiest.length > 0 ? ` (${busiest.join(", ")})` : ""}, in ${seconds} s.${check.state === "wrote" ? ` A sweep wrote during the dry run (first seen after ${check.firstWriter}); rolled back.` : ""}`
    : `Publish sweeps: the ${MOVED_PUBLISH_SWEEPS.length} moved sweeps changed ${changed.toLocaleString()} row(s) and flagged ${flagged.toLocaleString()} for a second look${busiest.length > 0 ? ` (${busiest.join(", ")})` : ""}, in ${seconds} s.${indexRefresh?.refreshed ? ` Index refreshed: ${indexRefresh.categories} categories.` : ""}`;
  return {
    status: "completed",
    summary,
    detail: {
      dry_run: dryRun,
      live: !dryRun,
      split_live: PUBLISH_SWEEPS_SPLIT_LIVE,
      sweeps: MOVED_PUBLISH_SWEEPS.length,
      changed,
      flagged,
      sweep_counts: counts,
      // Counts of these sweeps come from a per-run sample: compare them by day totals.
      sampled_sweeps: SAMPLED_PUBLISH_SWEEPS,
      sweep_ms: sweepMs,
      would_take_down_ids: dryRun ? takedownIds.slice(0, PUBLISH_SWEEPS_TAKEDOWN_ID_LIMIT) : undefined,
      taken_down_ids: dryRun ? undefined : takedownIds.slice(0, PUBLISH_SWEEPS_TAKEDOWN_ID_LIMIT),
      takedown_ids_total: takedownIds.length,
      // Category-guard first looks and fees awaiting their second look: still live, not takedowns.
      second_look_candidate_ids: secondLookIds.slice(0, PUBLISH_SWEEPS_TAKEDOWN_ID_LIMIT),
      second_look_candidates_total: secondLookIds.length,
      ...(dryRun ? { dry_run_write_check: check.state, dry_run_first_writer: check.firstWriter, rolled_back: rolledBack } : {}),
      index_refreshed: indexRefresh?.refreshed ?? false,
      index_categories: indexRefresh?.categories ?? 0,
      step_ms: Date.now() - startedAt,
    },
  };
}
