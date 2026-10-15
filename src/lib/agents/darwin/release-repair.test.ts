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
const CLUB_DOC = "Christmas Club Accounts\nMonthly charge $5.00\nEarly withdrawal $10.00";
const CHECKING_DOC = "Checking Accounts\nMonthly Maintenance Fee $12.00\nStop Payment $30.00";
const TEXTS = new Map<number, string>([[1, OVERDRAFT_DOC], [2, CLUB_DOC], [3, CHECKING_DOC]]);

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

const WRONG_OD = released({});
const RIGHT_OD = released({ fee_published_id: 144006, fee_verified_id: 173830, canonical_fee_key: "od_protection_transfer", fee_name: "Overdraft Protection Transfer from Savings", raw_fee_name: "Overdraft Protection Transfer from Savings", amount: "10.00" });
const CLUB = released({ fee_published_id: 150001, fee_verified_id: 180001, canonical_fee_key: "monthly_maintenance", fee_name: "Monthly Fee", raw_fee_name: "Monthly Fee", amount: "5.00", source_document_id: 2 });
const MAINTENANCE = released({ fee_published_id: 150002, fee_verified_id: 180002, canonical_fee_key: "monthly_maintenance", fee_name: "Monthly Maintenance Fee", raw_fee_name: "Monthly Maintenance Fee", amount: "12.00", source_document_id: 3 });
const NO_TEXT = released({ fee_published_id: 150003, fee_verified_id: 180003, canonical_fee_key: "stop_payment", fee_name: "Stop Payment", raw_fee_name: "Stop Payment", amount: "30.00", source_document_id: 99 });
const NOT_ON_PAGE = released({ fee_published_id: 150004, fee_verified_id: 180004, canonical_fee_key: "stop_payment", fee_name: "Stop Payment", raw_fee_name: "Stop Payment", amount: "45.00", source_document_id: 3 });

describe("releaseRepairVerdict (#1367 repair)", () => {
  it("takes down a fee whose category the model disputes: an overdraft item fee filed as an overdraft transfer", () => {
    expect(releaseRepairVerdict(WRONG_OD, OVERDRAFT_DOC, MODEL)).toEqual({ outcome: "take_down", reason: "release_check:category_disputed" });
  });

  it("takes down a fee with no category wording near its line", () => {
    expect(releaseRepairVerdict(CLUB, CLUB_DOC, MODEL)).toEqual({ outcome: "take_down", reason: "release_check:category_not_in_text" });
  });

  it("passes a fee its schedule and the model agree on", () => {
    expect(releaseRepairVerdict(RIGHT_OD, OVERDRAFT_DOC, MODEL)).toEqual({ outcome: "pass", reason: null });
    expect(releaseRepairVerdict(MAINTENANCE, CHECKING_DOC, MODEL)).toEqual({ outcome: "pass", reason: null });
  });

  it("defers, never takes down, when the text or the model is missing", () => {
    expect(releaseRepairVerdict(WRONG_OD, null, MODEL)).toEqual({ outcome: "deferred", reason: "release_check:no_source_text" });
    expect(releaseRepairVerdict(MAINTENANCE, CHECKING_DOC, null)).toEqual({ outcome: "deferred", reason: "release_check:no_category_model" });
  });

  it("reports, never takes down, a fee that fails on something other than the category", () => {
    expect(releaseRepairVerdict(NOT_ON_PAGE, CHECKING_DOC, MODEL)).toEqual({ outcome: "report_only", reason: "release_check:amount_not_the_fee" });
  });

  it("does not let the amount range hide a category failure", () => {
    // $95 is over od_protection_transfer's hand-set range; the release would have kept it as outside_envelope.
    const doc = "Overdraft Services\nOverdraft Paid Item Fee $95.00";
    expect(releaseRepairVerdict(released({ amount: "95.00" }), doc, MODEL)).toEqual({ outcome: "take_down", reason: "release_check:category_disputed" });
  });

  it("checks the name Knox read from the schedule, not a tidied catalog name", () => {
    const renamed = released({ fee_name: "Overdraft Protection Transfer", raw_fee_name: "Overdraft Paid Item Fee" });
    expect(releaseRepairVerdict(renamed, OVERDRAFT_DOC, MODEL).outcome).toBe("take_down");
  });
});

describe("judgeReleasedFees", () => {
  it("counts by reason and by category, with samples, and splits restores from live fees", () => {
    const archivedNowPassing = { ...MAINTENANCE, fee_published_id: 150010, rolled_back_reason: "release_repair:category_not_in_text" };
    const archivedStillFailing = { ...CLUB, fee_published_id: 150011, rolled_back_reason: "release_repair:category_not_in_text" };
    const found = judgeReleasedFees([WRONG_OD, RIGHT_OD, CLUB, MAINTENANCE, NO_TEXT, NOT_ON_PAGE, archivedNowPassing, archivedStillFailing], TEXTS, MODEL);
    expect(found).toMatchObject({
      checked: 8,
      passed: 2,
      wouldTakeDown: 2,
      deferred: 1,
      reportOnly: 1,
      wouldRestore: 1,
      stillDown: 1,
      byCategory: { od_protection_transfer: 1, monthly_maintenance: 1 },
      byReason: {
        "release_check:category_disputed": 1,
        "release_check:category_not_in_text": 2,
        "release_check:no_source_text": 1,
        "release_check:amount_not_the_fee": 1,
      },
    });
    expect(found.samples[0]).toMatchObject({ feePublishedId: 144005, feeVerifiedId: 173829, reason: "release_check:category_disputed", modelSuggests: "overdraft" });
    expect(found.reportOnlySamples.map((sample) => sample.feePublishedId)).toEqual([150004]);
  });
});

type DbMock = ReturnType<typeof vi.fn>;

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

function dbFor(rows: ReleaseRepairRow[], options: { cursor?: string | null; catalog?: unknown[]; pending?: Array<Record<string, unknown>> } = {}): DbMock {
  return vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = templateText(strings);
    if (text.includes("FROM agent_run_events")) return Promise.resolve(options.cursor == null ? [] : [{ next_after_id: options.cursor }]);
    if (text.includes("FROM published_fee_records fp") && text.includes("JOIN verified_fee_observations")) {
      const afterId = Number(values.find((value) => typeof value === "number") ?? 0);
      return Promise.resolve(rows.filter((row) => Number(row.fee_published_id) > afterId));
    }
    if (text.includes("FROM agent_source_texts")) return Promise.resolve([...TEXTS].map(([id, normalized_text]) => ({ source_document_id: id, normalized_text })));
    if (text.includes("FROM published_fee_catalog")) return Promise.resolve(options.catalog ?? CATALOG);
    if (text.includes("to_regclass")) return Promise.resolve([{ ready: true }]);
    if (text.includes("FROM pipeline_feedback") && text.includes("dedupe_key")) return Promise.resolve(options.pending ?? []);
    if (text.includes("UPDATE published_fee_records") && text.includes("rolled_back_at = NOW()")) {
      return Promise.resolve([{ fee_published_id: 144005 }]);
    }
    if (text.includes("UPDATE published_fee_records") && text.includes("rolled_back_at = NULL")) {
      return Promise.resolve([{ fee_published_id: 150010, lineage_ref: 180002 }]);
    }
    return Promise.resolve([]);
  });
}

const asDb = (db: DbMock) => db as unknown as Parameters<typeof recheckReleasedFees>[0];
const sqlOf = (db: DbMock) => db.mock.calls.map(([strings]) => templateText(strings)).join("\n");

describe("Darwin release repair step", () => {
  afterEach(() => resetCategoryModelCache());

  it("ships in shadow, and is not a provider step", () => {
    expect(DARWIN_RELEASE_REPAIR_LIVE).toBe(false);
    // The category model is Darwin's own naive Bayes, trained in-process: no paid call.
    expect([...PROVIDER_STEP_KEYS].some((key) => key.includes("release_repair"))).toBe(false);
  });

  it("in shadow reports what it would take down, records the cursor and writes no fee", async () => {
    const db = dbFor([WRONG_OD, RIGHT_OD, CLUB, MAINTENANCE], { cursor: "100" });
    const result = await recheckReleasedFees(asDb(db), { runId: 7, stepId: 70, dryRun: false });
    expect(result).toMatchObject({ live: false, checked: 4, passed: 2, wouldTakeDown: 2, afterId: 100, nextAfterId: 0, takenDown: [], flagged: 0 });
    const text = sqlOf(db);
    expect(text).not.toContain("UPDATE");
    expect(text).not.toContain("dedupe_key");
    expect(JSON.stringify(db.mock.calls)).toContain(RELEASE_REPAIR_CHECK);
  });

  it("carries the cursor on when the batch is full", async () => {
    const db = dbFor([WRONG_OD, RIGHT_OD]);
    const result = await recheckReleasedFees(asDb(db), { runId: 7, dryRun: false, limit: 2 });
    expect(result.nextAfterId).toBe(144006);
  });

  it("without the category model judges nothing and keeps the cursor", async () => {
    const db = dbFor([WRONG_OD, CLUB], { cursor: "100", catalog: [] });
    const result = await recheckReleasedFees(asDb(db), { runId: 7, dryRun: false, live: true });
    expect(result).toMatchObject({ modelMissing: true, checked: 0, deferred: 2, wouldTakeDown: 0, nextAfterId: null, afterId: 100 });
    expect(sqlOf(db)).not.toContain("UPDATE");
  });

  it("a dry run writes nothing at all, even switched on", async () => {
    const db = dbFor([WRONG_OD, CLUB]);
    await recheckReleasedFees(asDb(db), { runId: 7, dryRun: true, live: true });
    const text = sqlOf(db);
    expect(text).not.toContain("UPDATE");
    expect(text).not.toContain("INSERT");
  });

  it("switched on, a first failure is only flagged for the 12-hour second look", async () => {
    const db = dbFor([WRONG_OD, RIGHT_OD]);
    const result = await recheckReleasedFees(asDb(db), { runId: 7, dryRun: false, live: true });
    expect(result).toMatchObject({ flagged: 1, takenDown: [] });
    const text = sqlOf(db);
    expect(text).not.toContain("UPDATE published_fee_records");
    expect(JSON.stringify(db.mock.calls)).toContain("hamilton.second_look:darwin.release_repair:pub:144005");
  });

  it("switched on, a second failure 12 hours on archives the fee with its reason and rejects the verified row", async () => {
    const now = new Date("2026-10-16T12:00:00Z");
    const pending = [{ fee_published_id: 144005, kind: "takedown_pending", evidence: { flag_run_id: 6, flagged_at: "2026-10-15T20:00:00Z", reason: "release_repair:category_disputed" } }];
    const db = dbFor([WRONG_OD, RIGHT_OD], { pending });
    const result = await recheckReleasedFees(asDb(db), { runId: 7, dryRun: false, live: true, now });
    expect(result.takenDown).toEqual([144005]);
    const calls = JSON.stringify(db.mock.calls);
    expect(calls).toContain("release_repair:category_disputed");
    expect(calls).toContain("darwin_release_repair:category_disputed");
    expect(calls).toContain("darwin-release-repair-7");
    expect(sqlOf(db)).toContain("UPDATE verified_fee_observations");
  });

  it("switched on, does not take down a fee flagged less than 12 hours ago", async () => {
    const now = new Date("2026-10-16T00:00:00Z");
    const pending = [{ fee_published_id: 144005, kind: "takedown_pending", evidence: { flag_run_id: 6, flagged_at: "2026-10-15T20:00:00Z", reason: "release_repair:category_disputed" } }];
    const db = dbFor([WRONG_OD], { pending });
    const result = await recheckReleasedFees(asDb(db), { runId: 7, dryRun: false, live: true, now });
    expect(result).toMatchObject({ waiting: 1, takenDown: [] });
  });

  it("switched on, restores a fee it archived that passes now", async () => {
    const archived = { ...MAINTENANCE, fee_published_id: 150010, rolled_back_reason: "release_repair:category_not_in_text" };
    const db = dbFor([archived]);
    const result = await recheckReleasedFees(asDb(db), { runId: 7, dryRun: false, live: true });
    expect(result.restored).toEqual([150010]);
    const text = sqlOf(db);
    expect(text).toContain("rolled_back_at = NULL");
    expect(text).toContain("review_status = 'verified'");
    expect(JSON.stringify(db.mock.calls)).toContain("darwin.release_repair_acted");
  });

  it("never restores an archived fee that still fails", async () => {
    const archived = { ...CLUB, fee_published_id: 150011, rolled_back_reason: "release_repair:category_not_in_text" };
    const db = dbFor([archived]);
    const result = await recheckReleasedFees(asDb(db), { runId: 7, dryRun: false, live: true });
    expect(result).toMatchObject({ restored: [], stillDown: 1 });
    expect(sqlOf(db)).not.toContain("rolled_back_at = NULL");
  });

  it("counts every released fee in pages and writes nothing", async () => {
    const db = dbFor([WRONG_OD, RIGHT_OD, CLUB, MAINTENANCE, NO_TEXT]);
    const totals = await countReleaseRepair(asDb(db), { pageSize: 2 });
    expect(totals).toMatchObject({ checked: 5, wouldTakeDown: 2, passed: 2, deferred: 1, byCategory: { od_protection_transfer: 1, monthly_maintenance: 1 } });
    const text = sqlOf(db);
    expect(text).not.toContain("UPDATE");
    expect(text).not.toContain("INSERT");
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
