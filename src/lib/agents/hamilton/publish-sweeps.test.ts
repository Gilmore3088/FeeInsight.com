import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Every sweep function the moved groups call, keyed by the sweep it serves. Each mock resolves to
// that sweep's empty result (filled in from a `lane` pass, which calls nothing), unless a test
// overrides it.
const { calls, results, mocks } = vi.hoisted(() => {
  const calls: Array<{ key: string; args: unknown[] }> = [];
  const results: Record<string, unknown> = {};
  const make = (key: string) =>
    vi.fn((...args: unknown[]) => {
      calls.push({ key, args });
      return Promise.resolve(results[key]);
    });
  const mocks = {
    restoreOutliersNowInRange: make("outlierRestores"),
    rollBackPublishedOutliers: make("outlierRollbacks"),
    restoreFeesNowInTaxonomy: make("offTaxonomyRestores"),
    rollBackOffTaxonomyFees: make("offTaxonomyRollbacks"),
    foldRetiredCategories: make("taxonomyFold"),
    rollBackLimitsPublishedAsFees: make("limitRollbacks"),
    retireBusinessScheduleFees: make("businessSchedule"),
    retireSameLineDuplicates: make("sameLineDuplicates"),
    retireOtherBankDocumentFees: make("otherBank"),
    retireEvalVerdictFees: make("evalVerdicts"),
    applyHandAmountCorrections: make("handAmounts"),
    applyCutNameDuplicates: make("cutNameDuplicates"),
    applyAccountTypeHold: make("accountTypeHold"),
    applyHandTakedowns: make("handTakedowns"),
    applyHandAudienceFixes: make("handAudience"),
    retireClosedInstitutionFees: make("closedInstitution"),
    retireArticlePageFees: make("articlePage"),
    retireProductPageFees: make("productPage"),
    retireProductPageConflicts: make("productPageConflict"),
    retireCrossPageConflicts: make("crossPage"),
    runHamiltonCategoryGuard: make("categoryGuard"),
    collapsePublishedDuplicates: make("earlyDuplicateCollapses"),
    collapseNearNameDuplicates: make("nearNameCollapse"),
    restorePageCopiesOfDownedKeepers: make("pageCopyRestore"),
    collapsePageCopies: make("pageCopyCollapse"),
    fillFrequenciesInPublish: make("frequencyFill"),
    moveRowsToIdenticalCopy: make("identicalCopy"),
    retidyLiveFeeNames: make("nameRetidy"),
    moveExtractionNotes: make("extractionNotes"),
    nameLiveFeesByAccount: make("accountNames"),
    correctStoredLineups: make("lineupCorrect"),
    recheckUncheckedRestores: make("restoreRecheck"),
    restoreLostRecheckTakedowns: make("lostRestore"),
    pairFeeChangeRecords: make("changePairing"),
    restoreCrossPageSupersedes: make("crossPageRestore"),
    linkImportedFeesToTwins: make("importedTwins"),
    fillSourceLinks: make("sourceLinkFill"),
    repairLinkDrift: make("linkDrift"),
    syncPipelineFeedback: make("feedbackSync"),
    repairAccountTypeHoldFeedback: make("holdFeedback"),
    refreshFeeIndexCache: vi.fn(() => Promise.resolve({ refreshed: true, categories: 50, reason: "forced" })),
  };
  return { calls, results, mocks };
});

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));
vi.mock("@/lib/agents/hamilton/outlier-rollback", () => ({
  restoreOutliersNowInRange: mocks.restoreOutliersNowInRange,
  rollBackPublishedOutliers: mocks.rollBackPublishedOutliers,
}));
vi.mock("@/lib/agents/hamilton/off-taxonomy-rollback", () => ({
  restoreFeesNowInTaxonomy: mocks.restoreFeesNowInTaxonomy,
  rollBackOffTaxonomyFees: mocks.rollBackOffTaxonomyFees,
}));
vi.mock("@/lib/agents/hamilton/taxonomy-fold", () => ({ foldRetiredCategories: mocks.foldRetiredCategories }));
vi.mock("@/lib/agents/hamilton/limit-guard", () => ({ rollBackLimitsPublishedAsFees: mocks.rollBackLimitsPublishedAsFees }));
vi.mock("@/lib/agents/hamilton/business-schedule", () => ({ retireBusinessScheduleFees: mocks.retireBusinessScheduleFees }));
vi.mock("@/lib/agents/hamilton/same-line-duplicates", () => ({ retireSameLineDuplicates: mocks.retireSameLineDuplicates }));
vi.mock("@/lib/agents/hamilton/other-bank-document", () => ({ retireOtherBankDocumentFees: mocks.retireOtherBankDocumentFees }));
vi.mock("@/lib/agents/hamilton/eval-verdicts", () => ({ retireEvalVerdictFees: mocks.retireEvalVerdictFees }));
vi.mock("@/lib/agents/hamilton/hand-amount-corrections", () => ({ applyHandAmountCorrections: mocks.applyHandAmountCorrections }));
vi.mock("@/lib/agents/hamilton/cut-name-duplicates", () => ({ applyCutNameDuplicates: mocks.applyCutNameDuplicates }));
vi.mock("@/lib/agents/hamilton/account-type-hold", () => ({ applyAccountTypeHold: mocks.applyAccountTypeHold }));
vi.mock("@/lib/agents/hamilton/hand-takedowns", () => ({
  applyHandTakedowns: mocks.applyHandTakedowns,
  applyHandAudienceFixes: mocks.applyHandAudienceFixes,
}));
vi.mock("@/lib/agents/hamilton/closed-institution", () => ({ retireClosedInstitutionFees: mocks.retireClosedInstitutionFees }));
vi.mock("@/lib/agents/hamilton/article-page", () => ({ retireArticlePageFees: mocks.retireArticlePageFees }));
vi.mock("@/lib/agents/hamilton/product-page", () => ({ retireProductPageFees: mocks.retireProductPageFees }));
vi.mock("@/lib/agents/hamilton/product-page-conflict", () => ({ retireProductPageConflicts: mocks.retireProductPageConflicts }));
vi.mock("@/lib/agents/hamilton/cross-page-conflict", () => ({ retireCrossPageConflicts: mocks.retireCrossPageConflicts }));
vi.mock("@/lib/agents/hamilton/category-guard", () => ({ runHamiltonCategoryGuard: mocks.runHamiltonCategoryGuard }));
vi.mock("@/lib/agents/hamilton/duplicate-collapse", () => ({
  collapsePublishedDuplicates: mocks.collapsePublishedDuplicates,
  collapseNearNameDuplicates: mocks.collapseNearNameDuplicates,
}));
vi.mock("@/lib/agents/hamilton/page-copy-restore", () => ({ restorePageCopiesOfDownedKeepers: mocks.restorePageCopiesOfDownedKeepers }));
vi.mock("@/lib/agents/hamilton/page-copy-collapse", () => ({ collapsePageCopies: mocks.collapsePageCopies }));
vi.mock("@/lib/agents/hamilton/frequency-fill", () => ({ fillFrequenciesInPublish: mocks.fillFrequenciesInPublish }));
vi.mock("@/lib/agents/hamilton/refresh-copy", () => ({ moveRowsToIdenticalCopy: mocks.moveRowsToIdenticalCopy }));
vi.mock("@/lib/agents/knox/name-retidy", () => ({ retidyLiveFeeNames: mocks.retidyLiveFeeNames }));
vi.mock("@/lib/agents/knox/extraction-note", () => ({ moveExtractionNotes: mocks.moveExtractionNotes }));
vi.mock("@/lib/agents/hamilton/account-names", () => ({ nameLiveFeesByAccount: mocks.nameLiveFeesByAccount }));
vi.mock("@/lib/agents/knox/lineup-correct", () => ({ correctStoredLineups: mocks.correctStoredLineups }));
vi.mock("@/lib/agents/hamilton/restore-recheck", () => ({ recheckUncheckedRestores: mocks.recheckUncheckedRestores }));
vi.mock("@/lib/agents/hamilton/lost-recheck-restore", () => ({ restoreLostRecheckTakedowns: mocks.restoreLostRecheckTakedowns }));
vi.mock("@/lib/agents/hamilton/change-pairing", () => ({ pairFeeChangeRecords: mocks.pairFeeChangeRecords }));
vi.mock("@/lib/agents/hamilton/cross-page-restore", () => ({ restoreCrossPageSupersedes: mocks.restoreCrossPageSupersedes }));
vi.mock("@/lib/agents/hamilton/source-check", () => ({ linkImportedFeesToTwins: mocks.linkImportedFeesToTwins }));
vi.mock("@/lib/agents/hamilton/source-link", () => ({
  fillSourceLinks: mocks.fillSourceLinks,
  repairLinkDrift: mocks.repairLinkDrift,
}));
vi.mock("@/lib/agents/learning/feedback-sync", () => ({ syncPipelineFeedback: mocks.syncPipelineFeedback }));
vi.mock("@/lib/agents/learning/account-type-hold-feedback", () => ({ repairAccountTypeHoldFeedback: mocks.repairAccountTypeHoldFeedback }));
vi.mock("@/lib/data-store/fee-index", () => ({ refreshFeeIndexCache: mocks.refreshFeeIndexCache }));

import {
  inRolledBackSavepoint,
  KEPT_PUBLISH_CALLS,
  MOVED_PUBLISH_SWEEPS,
  movedSweepCounts,
  movedSweepSecondLookIds,
  movedSweepTakedownIds,
  GLOBAL_ONLY_PUBLISH_SWEEPS,
  publishSweepMode,
  PUBLISH_SWEEPS_SPLIT_LIVE,
  runPublishSweepsStep,
  runsMovedSweep,
  sweepsAfterRows,
  sweepsBeforeGuardRequeue,
  sweepsBeforeNewerCopy,
  sweepsBeforeRefreshCopy,
  sweepsBeforeRows,
  type MovedSweepContext,
  type MovedSweepResults,
  type PublishSweepMode,
} from "./publish-sweeps";

type Db = MovedSweepContext["db"];

function context(mode: PublishSweepMode, overrides: Partial<MovedSweepContext> = {}): MovedSweepContext {
  return {
    db: vi.fn() as unknown as Db,
    runId: 42,
    stepId: 4200,
    dryRun: false,
    institutionId: undefined,
    researchSplitFullCount: false,
    categoryGuardLimit: 100,
    sweepMs: {},
    mode,
    ...overrides,
  };
}

async function allGroups(ctx: MovedSweepContext): Promise<MovedSweepResults> {
  return {
    ...(await sweepsBeforeGuardRequeue(ctx)),
    ...(await sweepsBeforeNewerCopy(ctx)),
    ...(await sweepsBeforeRefreshCopy(ctx)),
    ...(await sweepsBeforeRows(ctx)),
    ...(await sweepsAfterRows(ctx)),
  };
}

/** A transaction double: a tagged template answering the write check, with a savepoint. */
function transaction() {
  let wrote = false;
  const savepoints: Array<"rolled_back" | "released"> = [];
  const db = vi.fn((strings: TemplateStringsArray) => {
    const text = strings.join("?");
    if (text.includes("pg_current_xact_id_if_assigned")) return Promise.resolve([{ xid: wrote ? "777" : null }]);
    return Promise.resolve([]);
  }) as unknown as Db & { savepoint: unknown };
  (db as unknown as { savepoint: unknown }).savepoint = async (work: (scope: Db) => Promise<unknown>) => {
    try {
      const out = await work(db);
      savepoints.push("released");
      return out;
    } catch (error) {
      savepoints.push("rolled_back");
      throw error;
    }
  };
  return {
    db,
    savepoints,
    markWrote: () => {
      wrote = true;
    },
  };
}

beforeAll(async () => {
  // A lane pass calls no sweep and returns every sweep's empty result: those are the mocks' answers.
  const empty = await allGroups(context("lane"));
  for (const [key, value] of Object.entries(empty)) results[key] = value;
});

beforeEach(() => {
  calls.length = 0;
  for (const mock of Object.values(mocks)) mock.mockClear();
});

describe("which steps run the moved sweeps", () => {
  it("ships with the split off: every publish runs every sweep", () => {
    expect(PUBLISH_SWEEPS_SPLIT_LIVE).toBe(false);
    expect(publishSweepMode({ stepKey: "publish", stateCode: "TX" })).toBe("full");
    expect(publishSweepMode({ stepKey: "publish", stateCode: "IA", institutionId: 5 })).toBe("full");
  });

  it("on, a state lane's publish hands them off and a Read-now publish keeps all but the feedback sync", () => {
    expect(publishSweepMode({ stepKey: "publish", stateCode: "TX", live: true })).toBe("lane");
    expect(publishSweepMode({ stepKey: "publish", stateCode: "IA", institutionId: 5, live: true })).toBe("institution");
    // No state and no institution: nothing else runs the sweeps for it, so it keeps them.
    expect(publishSweepMode({ stepKey: "publish", live: true })).toBe("full");
    expect(publishSweepMode({ stepKey: "publish-index", stateCode: "TX", live: true })).toBe("full");
    expect(publishSweepMode({ stepKey: "publish-sweeps", live: false })).toBe("sweeps");
    expect(MOVED_PUBLISH_SWEEPS.filter((key) => runsMovedSweep("lane", key))).toEqual([]);
    expect(MOVED_PUBLISH_SWEEPS.filter((key) => !runsMovedSweep("institution", key))).toEqual([
      "handAmounts", "cutNameDuplicates", "handTakedowns", "handAudience", "extractionNotes", "feedbackSync", "holdFeedback",
    ]);
    expect([...GLOBAL_ONLY_PUBLISH_SWEEPS].sort()).toEqual(MOVED_PUBLISH_SWEEPS.filter((key) => !runsMovedSweep("institution", key)).sort());
    expect(MOVED_PUBLISH_SWEEPS.every((key) => runsMovedSweep("sweeps", key) && runsMovedSweep("full", key))).toBe(true);
  });

  it("moves the 40 named sweeps and keeps the 11 calls, together the publish step's 51 timed calls", () => {
    expect(MOVED_PUBLISH_SWEEPS).toHaveLength(40);
    expect(new Set(MOVED_PUBLISH_SWEEPS).size).toBe(40);
    expect(KEPT_PUBLISH_CALLS).toHaveLength(11);
    expect(MOVED_PUBLISH_SWEEPS.filter((key) => (KEPT_PUBLISH_CALLS as readonly string[]).includes(key))).toEqual([]);
    const root = join(__dirname, "..");
    const sweepsSource = readFileSync(join(__dirname, "publish-sweeps.ts"), "utf8");
    const moved = Array.from(sweepsSource.matchAll(/await sweep\(ctx, "(\w+)"/g), (match) => match[1]);
    expect(moved).toEqual([...MOVED_PUBLISH_SWEEPS]);
    const publishCase = readFileSync(join(root, "run-store.ts"), "utf8");
    const kept = new Set(Array.from(publishCase.matchAll(/timedSweep\(sweepMs, "(\w+)"/g), (match) => match[1]));
    expect([...kept].sort()).toEqual([...KEPT_PUBLISH_CALLS].sort());
  });
});

describe("the moved sweep groups", () => {
  it("call every sweep in today's order, unscoped, with the step's dry-run flag", async () => {
    const ctx = context("sweeps", { dryRun: true });
    await allGroups(ctx);
    expect(calls.map((call) => call.key)).toEqual([...MOVED_PUBLISH_SWEEPS]);
    for (const call of calls) {
      const options = (call.key === "categoryGuard" ? call.args[0] : call.args[1]) as Record<string, unknown>;
      expect(options.dryRun, call.key).toBe(true);
      expect(options.institutionId, call.key).toBeUndefined();
    }
    expect(Object.keys(ctx.sweepMs)).toEqual([...MOVED_PUBLISH_SWEEPS]);
  });

  it("a lane with the split on calls none of them and records no sweep time", async () => {
    const ctx = context("lane");
    const out = await allGroups(ctx);
    expect(calls).toEqual([]);
    expect(ctx.sweepMs).toEqual({});
    expect(movedSweepCounts(out, (key) => runsMovedSweep("lane", key))).toEqual({});
  });

  it("a Read-now publish with the split on runs only sweeps scoped to its institution, each with that institution", async () => {
    await allGroups(context("institution", { institutionId: 77 }));
    expect(calls.map((call) => call.key)).toEqual(MOVED_PUBLISH_SWEEPS.filter((key) => !GLOBAL_ONLY_PUBLISH_SWEEPS.includes(key)));
    for (const call of calls) {
      const options = (call.key === "categoryGuard" ? call.args[0] : call.args[1]) as Record<string, unknown>;
      expect(options.institutionId, call.key).toBe(77);
    }
  });

  it("the account type hold runs over every bank except in a Read-now publish with the split on", async () => {
    await allGroups(context("full", { institutionId: 77 }));
    const full = calls.find((call) => call.key === "accountTypeHold");
    expect((full?.args[1] as Record<string, unknown>).institutionId).toBeUndefined();
    calls.length = 0;
    await allGroups(context("sweeps"));
    expect((calls.find((call) => call.key === "accountTypeHold")?.args[1] as Record<string, unknown>).institutionId).toBeUndefined();
  });
});

describe("sweep counts", () => {
  it("count a dry run's would-be restores and a live run's restores alike, and only for sweeps that ran", () => {
    const base = results as unknown as MovedSweepResults;
    const dry = { ...base, lostRestore: { ...base.lostRestore, dryRun: true, passed: [{}, {}] as never, restored: 0 } };
    const live = { ...base, lostRestore: { ...base.lostRestore, dryRun: false, passed: [{}, {}] as never, restored: 2 } };
    expect(movedSweepCounts(dry, () => true).lostRestore).toBe(2);
    expect(movedSweepCounts(live, () => true).lostRestore).toBe(2);
    const counts = movedSweepCounts(dry, (key) => key !== "otherBank");
    expect(counts).not.toHaveProperty("otherBank");
    expect(counts).not.toHaveProperty("otherBank.flagged");
    expect(counts).toHaveProperty("businessSchedule.flagged", 0);
  });

  it("list each would-be takedown once, and keep category-guard first looks out of them", () => {
    const base = results as unknown as MovedSweepResults;
    const swept = {
      ...base,
      outlierRollbacks: [{ feePublishedId: 9 }, { feePublishedId: 3 }] as never,
      // Fee 3 failed and is confirmed; 12 failed for the first time; 15 waits for its second look.
      categoryGuard: { ...base.categoryGuard, failures: [{ feePublishedId: 3 }, { feePublishedId: 12 }, { feePublishedId: 15 }] as never, confirmedFeeIds: [3] },
    };
    expect(movedSweepTakedownIds(swept)).toEqual([3, 9]);
    expect(movedSweepSecondLookIds(swept)).toEqual([12, 15]);
  });
});

describe("the publish-sweeps step", () => {
  it("off: a dry run in a savepoint that is always rolled back, with a clean write check and no index refresh", async () => {
    results.outlierRollbacks = [{ feePublishedId: 11 }];
    const tx = transaction();
    const outcome = await runPublishSweepsStep(tx.db, { runId: 42, stepId: 4200, live: false, categoryGuardLimit: 100 });
    results.outlierRollbacks = [];
    expect(tx.savepoints).toEqual(["rolled_back"]);
    expect(outcome.detail).toMatchObject({
      dry_run: true,
      rolled_back: true,
      dry_run_write_check: "clean",
      dry_run_first_writer: null,
      changed: 1,
      would_take_down_ids: [11],
      index_refreshed: false,
    });
    expect((outcome.detail.sweep_counts as Record<string, number>).outlierRollbacks).toBe(1);
    expect(mocks.refreshFeeIndexCache).not.toHaveBeenCalled();
    expect(calls.every((call) => ((call.key === "categoryGuard" ? call.args[0] : call.args[1]) as { dryRun: boolean }).dryRun)).toBe(true);
    expect(outcome.summary).toContain("dry run");
  });

  it("off: names the first sweep after which the transaction had written, and still rolls it back", async () => {
    const tx = transaction();
    mocks.retidyLiveFeeNames.mockImplementationOnce(async () => {
      tx.markWrote();
      return results.nameRetidy as never;
    });
    const outcome = await runPublishSweepsStep(tx.db, { runId: 42, stepId: 4200, live: false, categoryGuardLimit: 100 });
    expect(tx.savepoints).toEqual(["rolled_back"]);
    expect(outcome.detail).toMatchObject({ dry_run_write_check: "wrote", dry_run_first_writer: "nameRetidy" });
    expect(outcome.summary).toContain("nameRetidy");
  });

  it("live: writes in the step's transaction and refreshes the fee index when a sweep changed a fee", async () => {
    results.handTakedowns = { ...(results.handTakedowns as object), takenDown: [{ feePublishedId: 5 }] };
    const tx = transaction();
    const outcome = await runPublishSweepsStep(tx.db, { runId: 42, stepId: 4200, live: true, categoryGuardLimit: 100 });
    results.handTakedowns = { ...(results.handTakedowns as object), takenDown: [] };
    expect(tx.savepoints).toEqual([]);
    expect(outcome.detail).toMatchObject({ dry_run: false, changed: 1, taken_down_ids: [5], index_refreshed: true });
    expect(outcome.detail).not.toHaveProperty("dry_run_write_check");
    expect(mocks.refreshFeeIndexCache).toHaveBeenCalledWith(tx.db, { runId: 42, force: true });
    expect(calls.every((call) => !((call.key === "categoryGuard" ? call.args[0] : call.args[1]) as { dryRun: boolean }).dryRun)).toBe(true);
  });

  it("the rollback savepoint passes a real error through", async () => {
    const tx = transaction();
    await expect(inRolledBackSavepoint(tx.db, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(inRolledBackSavepoint(vi.fn() as unknown as Db, async () => 7)).resolves.toEqual({ result: 7, rolledBack: false });
  });
});
