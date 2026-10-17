import { afterEach, describe, expect, it, vi } from "vitest";

import { PROVIDER_STEP_KEYS } from "@/lib/agents/types";

import { resetCategoryModelCache, trainCategoryModel } from "./category-model";
import {
  DARWIN_RELEASE_REPAIR_LIVE,
  RELEASE_REPAIR_CHECK,
  countReleaseRepair,
  judgeReleasedFees,
  recheckReleasedFees,
  releaseRepairCandidateSql,
  releaseRepairVerdict,
  runReleaseRepairStep,
  type ReleaseRepairRow,
} from "./release-repair";

// Live catalog names the category model trains on (`published_fee_catalog`).
const CATALOG = [
  ...Array.from({ length: 20 }, (_, i) => ({ name: `overdraft paid item fee ${i}`, category_key: "overdraft", count: 3 })),
  ...Array.from({ length: 20 }, (_, i) => ({ name: `courtesy pay item ${i}`, category_key: "overdraft", count: 3 })),
  ...Array.from({ length: 20 }, (_, i) => ({ name: `overdraft protection transfer from savings ${i}`, category_key: "od_protection_transfer", count: 3 })),
  ...Array.from({ length: 20 }, (_, i) => ({ name: `monthly maintenance fee ${i}`, category_key: "monthly_maintenance", count: 3 })),
  ...Array.from({ length: 20 }, (_, i) => ({ name: `stop payment ${i}`, category_key: "stop_payment", count: 3 })),
];
const MODEL = trainCategoryModel(CATALOG.map((row) => ({ name: row.name, categoryKey: row.category_key, count: row.count })));

// Verified 173829, live as fp 144005 (#1367 sample): an overdraft item fee released as an overdraft transfer.
const OVERDRAFT_DOC = "Overdraft Services\nOverdraft Paid Item Fee $35.00\nOverdraft Protection Transfer from Savings $10.00";
// No overdraft or transfer wording near the line, and the model picks overdraft.
const COURTESY_DOC = "Courtesy Pay\nCourtesy Pay Item $30.00";
// A real transfer fee printed under the account's name, with no category wording nearby.
const BASIC_DOC = "Basic Checking\nTransfer from Savings $10.00";
const CLUB_DOC = "Christmas Club Accounts\nMonthly charge $5.00\nEarly withdrawal $10.00";
const CHECKING_DOC = "Checking Accounts\nMonthly Maintenance Fee $12.00\nStop Payment $30.00";
const TEXTS = new Map<number, string>([[1, OVERDRAFT_DOC], [2, CLUB_DOC], [3, CHECKING_DOC], [4, COURTESY_DOC], [5, BASIC_DOC]]);

const released = (overrides: Partial<ReleaseRepairRow>): ReleaseRepairRow => ({
  fee_published_id: 144005,
  fee_verified_id: 173829,
  institution_id: 42,
  canonical_fee_key: "od_protection_transfer",
  amount: "35.00",
  fee_name: "Overdraft Paid Item Fee",
  raw_fee_name: "Overdraft Paid Item Fee",
  source_document_id: 1,
  rolled_back_reason: null,
  ...overrides,
});

const MODEL_ONLY = released({});
const BOTH = released({ fee_published_id: 144100, fee_verified_id: 173900, fee_name: "Courtesy Pay Item", raw_fee_name: "Courtesy Pay Item", amount: "30.00", source_document_id: 4 });
const TEXT_ONLY = released({ fee_published_id: 144200, fee_verified_id: 174000, fee_name: "Transfer from Savings", raw_fee_name: "Transfer from Savings", amount: "10.00", source_document_id: 5 });
const RIGHT_OD = released({ fee_published_id: 144006, fee_verified_id: 173830, fee_name: "Overdraft Protection Transfer from Savings", raw_fee_name: "Overdraft Protection Transfer from Savings", amount: "10.00" });
const CLUB = released({ fee_published_id: 150001, fee_verified_id: 180001, canonical_fee_key: "monthly_maintenance", fee_name: "Monthly Fee", raw_fee_name: "Monthly Fee", amount: "5.00", source_document_id: 2 });
const MAINTENANCE = released({ fee_published_id: 150002, fee_verified_id: 180002, canonical_fee_key: "monthly_maintenance", fee_name: "Monthly Maintenance Fee", raw_fee_name: "Monthly Maintenance Fee", amount: "12.00", source_document_id: 3 });
const NO_TEXT = released({ fee_published_id: 150003, fee_verified_id: 180003, canonical_fee_key: "stop_payment", fee_name: "Stop Payment", raw_fee_name: "Stop Payment", amount: "30.00", source_document_id: 99 });
const NOT_ON_PAGE = released({ fee_published_id: 150004, fee_verified_id: 180004, canonical_fee_key: "stop_payment", fee_name: "Stop Payment", raw_fee_name: "Stop Payment", amount: "45.00", source_document_id: 3 });

describe("releaseRepairVerdict (#1367 repair)", () => {
  it("takes down only when the text names no category wording AND the model confidently picks another category", () => {
    const verdict = releaseRepairVerdict(BOTH, COURTESY_DOC, MODEL);
    expect(verdict).toMatchObject({ outcome: "take_down", reason: "release_check:category_not_in_text_and_disputed", modelSuggests: "overdraft" });
    expect(verdict.modelSuggestsProbability).toBeGreaterThanOrEqual(0.5);
  });

  it("reports, never takes down, a fee only the model disputes (the line names the category)", () => {
    expect(releaseRepairVerdict(MODEL_ONLY, OVERDRAFT_DOC, MODEL)).toMatchObject({ outcome: "report_only", bucket: "model_only", reason: "release_check:category_disputed", modelSuggests: "overdraft" });
  });

  it("reports, never takes down, a real name with no heading nearby that the model agrees with", () => {
    expect(releaseRepairVerdict(TEXT_ONLY, BASIC_DOC, MODEL)).toMatchObject({ outcome: "report_only", bucket: "text_only", reason: "release_check:category_not_in_text", modelSuggests: null });
    expect(releaseRepairVerdict(CLUB, CLUB_DOC, MODEL)).toMatchObject({ outcome: "report_only", bucket: "text_only" });
  });

  it("needs real confidence in the model's own pick", () => {
    // Two other categories split the vote: the model disputes, but picks neither with half its probability.
    const split = trainCategoryModel([
      { name: "courtesy pay item", categoryKey: "overdraft", count: 5 },
      { name: "courtesy pay item", categoryKey: "nsf", count: 5 },
      { name: "overdraft protection transfer", categoryKey: "od_protection_transfer", count: 5 },
    ]);
    expect(releaseRepairVerdict(BOTH, COURTESY_DOC, split)).toMatchObject({ outcome: "report_only", bucket: "text_only" });
  });

  it("passes a fee its schedule and the model agree on", () => {
    expect(releaseRepairVerdict(RIGHT_OD, OVERDRAFT_DOC, MODEL)).toMatchObject({ outcome: "pass", reason: null });
    expect(releaseRepairVerdict(MAINTENANCE, CHECKING_DOC, MODEL)).toMatchObject({ outcome: "pass", reason: null });
  });

  it("defers, never takes down, when the text or the model is missing", () => {
    expect(releaseRepairVerdict(BOTH, null, MODEL)).toMatchObject({ outcome: "deferred", reason: "release_check:no_source_text" });
    expect(releaseRepairVerdict(MAINTENANCE, CHECKING_DOC, null)).toMatchObject({ outcome: "deferred", reason: "release_check:no_category_model" });
    // The text check fails before the model is asked: still deferred, never a takedown on the text alone.
    expect(releaseRepairVerdict(BOTH, COURTESY_DOC, null)).toMatchObject({ outcome: "deferred", reason: "release_check:no_category_model" });
  });

  it("reports, never takes down, a fee that fails on something other than the category", () => {
    expect(releaseRepairVerdict(NOT_ON_PAGE, CHECKING_DOC, MODEL)).toMatchObject({ outcome: "report_only", bucket: "other", reason: "release_check:amount_not_the_fee" });
  });

  it("does not let the amount range hide a category failure", () => {
    // $95 is over od_protection_transfer's hand-set range; the release would have kept it as outside_envelope.
    const doc = "Courtesy Pay\nCourtesy Pay Item $95.00";
    expect(releaseRepairVerdict({ ...BOTH, amount: "95.00" }, doc, MODEL).outcome).toBe("take_down");
  });

  it("checks the name Knox read from the schedule, not a tidied catalog name", () => {
    const renamed = { ...BOTH, fee_name: "Overdraft Protection Transfer" };
    expect(releaseRepairVerdict(renamed, COURTESY_DOC, MODEL).outcome).toBe("take_down");
  });
});

describe("judgeReleasedFees", () => {
  it("counts each bucket apart, by reason and category, with samples, and splits restores from live fees", () => {
    const archivedNowPassing = { ...MAINTENANCE, fee_published_id: 150010, rolled_back_reason: "release_repair:category_not_in_text_and_disputed" };
    const archivedStillFailing = { ...BOTH, fee_published_id: 150011, rolled_back_reason: "release_repair:category_not_in_text_and_disputed" };
    const found = judgeReleasedFees([BOTH, MODEL_ONLY, TEXT_ONLY, CLUB, RIGHT_OD, MAINTENANCE, NO_TEXT, NOT_ON_PAGE, archivedNowPassing, archivedStillFailing], TEXTS, MODEL);
    expect(found).toMatchObject({
      checked: 10,
      passed: 2,
      wouldTakeDown: 1,
      textOnly: 2,
      modelOnly: 1,
      otherHold: 1,
      deferred: 1,
      wouldRestore: 1,
      stillDown: 1,
      byCategory: { od_protection_transfer: 1 },
      textOnlyByCategory: { od_protection_transfer: 1, monthly_maintenance: 1 },
      modelOnlyByCategory: { od_protection_transfer: 1 },
    });
    expect(found.samples.map((sample) => sample.feePublishedId)).toEqual([144100]);
    expect(found.modelOnlySamples[0]).toMatchObject({ feePublishedId: 144005, feeVerifiedId: 173829, modelSuggests: "overdraft" });
    expect(found.textOnlySamples.map((sample) => sample.feePublishedId)).toEqual([144200, 150001]);
    expect(found.otherSamples.map((sample) => sample.feePublishedId)).toEqual([150004]);
  });
});

type DbMock = ReturnType<typeof vi.fn>;

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

interface DbOptions {
  cursor?: string | null;
  catalog?: unknown[];
  pending?: Array<Record<string, unknown>>;
  restoreReturns?: Array<Record<string, unknown>>;
}

function dbFor(rows: ReleaseRepairRow[], options: DbOptions = {}): DbMock {
  return vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = templateText(strings);
    if (text.includes("FROM agent_run_events")) return Promise.resolve(options.cursor == null ? [] : [{ next_after_id: options.cursor }]);
    if (text.includes("WITH eligible AS")) return Promise.resolve(options.restoreReturns ?? []);
    if (text.includes("FROM published_fee_records fp") && text.includes("JOIN raw_fee_observations")) {
      const afterId = Number(values.find((value) => typeof value === "number") ?? 0);
      return Promise.resolve(rows.filter((row) => Number(row.fee_published_id) > afterId));
    }
    if (text.includes("FROM agent_source_texts")) return Promise.resolve([...TEXTS].map(([id, normalized_text]) => ({ source_document_id: id, normalized_text })));
    if (text.includes("FROM published_fee_catalog")) return Promise.resolve(options.catalog ?? CATALOG);
    if (text.includes("to_regclass")) return Promise.resolve([{ ready: true }]);
    if (text.includes("FROM pipeline_feedback") && text.includes("dedupe_key")) return Promise.resolve(options.pending ?? []);
    if (text.includes("UPDATE published_fee_records") && text.includes("rolled_back_at = NOW()")) return Promise.resolve([{ fee_published_id: 144100 }]);
    return Promise.resolve([]);
  });
}

const asDb = (db: DbMock) => db as unknown as Parameters<typeof recheckReleasedFees>[0];
const sqlOf = (db: DbMock) => db.mock.calls.map(([strings]) => templateText(strings)).join("\n");
const PENDING_BOTH = { fee_published_id: 144100, kind: "takedown_pending", evidence: { flag_run_id: 6, flagged_at: "2026-10-15T20:00:00Z", reason: "release_repair:category_not_in_text_and_disputed" } };

describe("Darwin release repair step", () => {
  afterEach(() => resetCategoryModelCache());

  it("is on, and is not a provider step", () => {
    expect(DARWIN_RELEASE_REPAIR_LIVE).toBe(true);
    // The category model is Darwin's own naive Bayes, trained in-process: no paid call.
    expect([...PROVIDER_STEP_KEYS].some((key) => key.includes("release_repair"))).toBe(false);
  });

  it("switched off, reports each bucket, records the cursor and writes no fee and no flag", async () => {
    const db = dbFor([BOTH, MODEL_ONLY, TEXT_ONLY, RIGHT_OD], { cursor: "100" });
    const result = await recheckReleasedFees(asDb(db), { runId: 7, stepId: 70, dryRun: false, live: false });
    expect(result).toMatchObject({ live: false, checked: 4, passed: 1, wouldTakeDown: 1, textOnly: 1, modelOnly: 1, afterId: 100, nextAfterId: 0, takenDown: [], flagged: 0 });
    const text = sqlOf(db);
    expect(text).not.toContain("UPDATE");
    expect(text).not.toContain("dedupe_key");
    const calls = JSON.stringify(db.mock.calls);
    expect(calls).toContain(RELEASE_REPAIR_CHECK);
    const event = db.mock.calls.find(([strings]) => templateText(strings).includes("INSERT INTO agent_run_events"))!;
    const detail = JSON.parse(event[event.length - 1] as string);
    expect(detail).toMatchObject({ would_take_down: 1, report_only: { text_only: 1, model_only: 1, other: 0 } });
    expect(detail.samples[0]).toMatchObject({ fee_published_id: 144100, model_suggests: "overdraft" });
  });

  it("carries the cursor on when the batch is full", async () => {
    const db = dbFor([MODEL_ONLY, RIGHT_OD]);
    const result = await recheckReleasedFees(asDb(db), { runId: 7, dryRun: false, limit: 2 });
    expect(result.nextAfterId).toBe(144006);
  });

  it("without the category model judges nothing and keeps the cursor", async () => {
    const db = dbFor([BOTH, CLUB], { cursor: "100", catalog: [] });
    const result = await recheckReleasedFees(asDb(db), { runId: 7, dryRun: false, live: true });
    expect(result).toMatchObject({ modelMissing: true, checked: 0, deferred: 2, wouldTakeDown: 0, nextAfterId: null, afterId: 100 });
    expect(sqlOf(db)).not.toContain("UPDATE");
  });

  it("a dry run writes nothing at all, even switched on", async () => {
    const db = dbFor([BOTH, CLUB]);
    await recheckReleasedFees(asDb(db), { runId: 7, dryRun: true, live: true });
    const text = sqlOf(db);
    expect(text).not.toContain("UPDATE");
    expect(text).not.toContain("INSERT");
  });

  it("switched on, flags only the fee both checks fail; one failure alone is never flagged", async () => {
    const db = dbFor([BOTH, MODEL_ONLY, TEXT_ONLY]);
    const result = await recheckReleasedFees(asDb(db), { runId: 7, dryRun: false, live: true });
    expect(result).toMatchObject({ flagged: 1, takenDown: [] });
    const calls = JSON.stringify(db.mock.calls);
    expect(calls).toContain("hamilton.second_look:darwin.release_repair:pub:144100");
    expect(calls).not.toContain("hamilton.second_look:darwin.release_repair:pub:144005");
    expect(calls).not.toContain("hamilton.second_look:darwin.release_repair:pub:144200");
    expect(sqlOf(db)).not.toContain("UPDATE published_fee_records");
  });

  it("switched on, a second failure 12 hours on archives the fee and rejects its verified row in one savepoint", async () => {
    const now = new Date("2026-10-16T12:00:00Z");
    const db = dbFor([BOTH, RIGHT_OD], { pending: [PENDING_BOTH] });
    const result = await recheckReleasedFees(asDb(db), { runId: 7, dryRun: false, live: true, now });
    expect(result.takenDown).toEqual([144100]);
    const calls = JSON.stringify(db.mock.calls);
    expect(calls).toContain("release_repair:category_not_in_text_and_disputed");
    expect(calls).toContain("darwin_release_repair:category_not_in_text_and_disputed");
    expect(calls).toContain("darwin-release-repair-7");
    // The flag goes last on the verified row, which is what the restore reads.
    expect(sqlOf(db)).toContain("- v.flag || jsonb_build_array(v.flag)");
  });

  it("switched on, does not take down a fee flagged less than 12 hours ago", async () => {
    const now = new Date("2026-10-16T00:00:00Z");
    const db = dbFor([BOTH], { pending: [PENDING_BOTH] });
    const result = await recheckReleasedFees(asDb(db), { runId: 7, dryRun: false, live: true, now });
    expect(result).toMatchObject({ waiting: 1, takenDown: [] });
  });

  it("switched on, clears a pending flag on a fee that is now report-only", async () => {
    const pending = [{ fee_published_id: 144005, kind: "takedown_pending", evidence: { flag_run_id: 6, flagged_at: "2026-10-15T20:00:00Z", reason: "release_repair:category_not_in_text_and_disputed" } }];
    const db = dbFor([MODEL_ONLY], { pending });
    const result = await recheckReleasedFees(asDb(db), { runId: 7, dryRun: false, live: true });
    expect(result.cleared).toBe(1);
    expect(JSON.stringify(db.mock.calls)).toContain("takedown_cleared");
  });

  it("switched on, restores an archived fee that no longer meets the bar, with the second look cleared", async () => {
    const archived = { ...MAINTENANCE, fee_published_id: 150010, rolled_back_reason: "release_repair:category_not_in_text_and_disputed" };
    const db = dbFor([archived], { restoreReturns: [{ fee_published_id: 150010 }] });
    const result = await recheckReleasedFees(asDb(db), { runId: 7, dryRun: false, live: true });
    expect(result).toMatchObject({ restored: [150010], restoreBlocked: 0 });
    const restore = sqlOf(db).split("\n\n").join("\n");
    // One statement: the verified row and the live fee come back together.
    expect(restore).toContain("WITH eligible AS");
    expect(restore).toContain("verified AS (");
    expect(restore).toContain("e.lineage_ref IN (SELECT fee_verified_id FROM verified)");
    // Only when this pass's flag is the row's last: no other rule flagged it since.
    expect(restore).toContain("fv.outlier_flags->>-1 LIKE");
    const calls = JSON.stringify(db.mock.calls);
    expect(calls).toContain("hamilton.second_look:darwin.release_repair:pub:150010");
    expect(calls).toContain("takedown_cleared");
    expect(calls).toContain("flag_cleared");
    expect(calls).toContain("darwin.release_repair_acted");
  });

  it("leaves an archived fee down when the verified row carries another flag (the restore statement matches nothing)", async () => {
    const archived = { ...MAINTENANCE, fee_published_id: 150010, rolled_back_reason: "release_repair:category_not_in_text_and_disputed" };
    const db = dbFor([archived], { restoreReturns: [] });
    const result = await recheckReleasedFees(asDb(db), { runId: 7, dryRun: false, live: true });
    expect(result).toMatchObject({ restored: [], restoreBlocked: 1 });
    expect(JSON.stringify(db.mock.calls)).not.toContain("takedown_cleared");
  });

  it("never restores an archived fee that still fails both checks", async () => {
    const archived = { ...BOTH, fee_published_id: 150011, rolled_back_reason: "release_repair:category_not_in_text_and_disputed" };
    const db = dbFor([archived]);
    const result = await recheckReleasedFees(asDb(db), { runId: 7, dryRun: false, live: true });
    expect(result).toMatchObject({ restored: [], stillDown: 1 });
    expect(sqlOf(db)).not.toContain("WITH eligible AS");
  });

  it("counts every released fee in pages by bucket and writes nothing", async () => {
    const db = dbFor([BOTH, MODEL_ONLY, TEXT_ONLY, RIGHT_OD, MAINTENANCE, NO_TEXT]);
    const totals = await countReleaseRepair(asDb(db), { pageSize: 2 });
    expect(totals).toMatchObject({ checked: 6, wouldTakeDown: 1, textOnly: 1, modelOnly: 1, passed: 2, deferred: 1, byCategory: { od_protection_transfer: 1 } });
    const text = sqlOf(db);
    expect(text).not.toContain("UPDATE");
    expect(text).not.toContain("INSERT");
  });

  it("never fails the verify step, even on a synchronous throw", async () => {
    const db = dbFor([]);
    const throwing = (() => {
      throw new Error("boom");
    }) as unknown as typeof recheckReleasedFees;
    const out = await runReleaseRepairStep(asDb(db), { runId: 7, dryRun: false, fullCount: true }, throwing, (() => {
      throw new Error("count boom");
    }) as unknown as typeof countReleaseRepair);
    expect(out).toEqual({ result: null, full: null, error: "boom" });
  });

  it("gives read-only SQL by category with Postgres word boundaries", () => {
    const text = releaseRepairCandidateSql();
    expect(text).toContain("'darwin_released_hold'");
    expect(text).toContain("('od_protection_transfer', '(overdraft|\\yod\\y|\\yodp\\y|o\\/d|sweep|protection|sobregir)')");
    expect(text).toContain("'verify.release_recorded'");
    expect(text).not.toMatch(/\\b/);
    expect(text).not.toContain("[\\s\\S]");
    expect(text).not.toMatch(/\b(?:UPDATE|INSERT|DELETE)\b/);
  });
});
