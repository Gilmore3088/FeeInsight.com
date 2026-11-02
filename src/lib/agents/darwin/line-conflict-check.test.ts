import { beforeEach, describe, expect, it, vi } from "vitest";

const { secondLookMock } = vi.hoisted(() => ({ secondLookMock: vi.fn() }));
vi.mock("@/lib/agents/hamilton/second-look", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agents/hamilton/second-look")>()),
  secondLook: secondLookMock,
}));
vi.mock("@/lib/agents/savepoint", () => ({ inSavepoint: (db: unknown, fn: (scope: unknown) => unknown) => fn(db) }));
vi.mock("@/lib/data-store/fee-cache", () => ({ invalidatePublicReadCache: vi.fn() }));
const { recordFeedbackMock } = vi.hoisted(() => ({ recordFeedbackMock: vi.fn() }));
vi.mock("@/lib/agents/learning/feedback", () => ({ recordFeedback: recordFeedbackMock }));

import { trainCategoryModel } from "./category-model";
import {
  LINE_CONFLICT_FLAG,
  LINE_CONFLICT_OWN_UNIT_LIVE,
  LINE_CONFLICT_TAKEDOWN_LIVE,
  findLineConflicts,
  judgeLineConflictRestores,
  lineConflictRestoreRowsSql,
  type LineConflictRestoreRow,
  lineConflictCountSql,
  lineConflictVerdict,
  recheckLineConflicts,
  type LineConflictRow,
} from "./line-conflict-check";

let nextId = 1;
function row(overrides: Partial<LineConflictRow>): LineConflictRow {
  const id = nextId++;
  return {
    fee_published_id: id,
    fee_verified_id: 1000 + id,
    institution_id: 7,
    fee_name: "Fee",
    amount: 5,
    rate_percent: null,
    variant_type: null,
    source_url: "https://bank.example/fees.pdf",
    canonical_fee_key: "check_image",
    frequency: null,
    fee_audience: "unknown",
    published_at: `2026-10-0${(id % 9) + 1}T00:00:00Z`,
    source_document_id: 1,
    conditions: null,
    ...overrides,
  };
}

// A small catalog: photocopies of checks are check images, a prepaid card is a gift card.
const model = trainCategoryModel([
  ...Array.from({ length: 30 }, (_, i) => ({ name: `photocopy of cleared check ${i}`, categoryKey: "check_image", count: 5 })),
  ...Array.from({ length: 30 }, (_, i) => ({ name: `statement copy research ${i}`, categoryKey: "document_reproduction", count: 5 })),
  ...Array.from({ length: 30 }, (_, i) => ({ name: `prepaid gift card ${i}`, categoryKey: "gift_card_purchase", count: 5 })),
  ...Array.from({ length: 30 }, (_, i) => ({ name: `loan modification processing ${i}`, categoryKey: "other_lending_fee", count: 5 })),
  ...Array.from({ length: 5 }, (_, i) => ({ name: `loan origination ${i}`, categoryKey: "loan_origination", count: 5 })),
  ...Array.from({ length: 30 }, (_, i) => ({ name: `atm envelope no contents included ${i}`, categoryKey: "atm_non_network", count: 5 })),
  ...Array.from({ length: 30 }, (_, i) => ({ name: `account research reconciliation ${i}`, categoryKey: "account_research", count: 5 })),
  ...Array.from({ length: 30 }, (_, i) => ({ name: `legal processing levy ${i}`, categoryKey: "legal_process", count: 5 })),
  ...Array.from({ length: 30 }, (_, i) => ({ name: `charge back returned deposit ${i}`, categoryKey: "deposited_item_return", count: 5 })),
  ...Array.from({ length: 30 }, (_, i) => ({ name: `check printing order ${i}`, categoryKey: "check_printing", count: 5 })),
]);

describe("lineConflictVerdict (#1440)", () => {
  it("keeps the category the model is sure of and retires the other reading", () => {
    const a = row({ fee_name: "Photocopy of cleared check", canonical_fee_key: "document_reproduction" });
    const b = row({ fee_name: "Photocopy of cleared check", canonical_fee_key: "check_image", source_document_id: 2 });
    const verdict = lineConflictVerdict([a, b], model)!;
    expect(verdict.kind).toBe("category");
    expect(verdict.basis).toBe("model");
    expect(verdict.keptReading).toBe("check_image");
    expect(verdict.retired.map((fee) => fee.feePublishedId)).toEqual([Number(a.fee_published_id)]);
    expect(verdict.retired[0].reason).toBe(`one line, two reads: kept #${b.fee_published_id} (category, model: check_image)`);
  });

  it("leaves a line undecided without a model or a guard decision", () => {
    const a = row({ fee_name: "Photocopy of cleared check", canonical_fee_key: "document_reproduction" });
    const b = row({ fee_name: "Photocopy of cleared check", canonical_fee_key: "check_image" });
    expect(lineConflictVerdict([a, b], null)).toMatchObject({ exempt: "undecided", retired: [] });
  });

  it("never lets the model choose between the unsettled lending categories", () => {
    const a = row({ fee_name: "Loan Modification Fee", canonical_fee_key: "loan_origination", amount: 50 });
    const b = row({ fee_name: "Loan Modification Fee", canonical_fee_key: "other_lending_fee", amount: 50 });
    expect(lineConflictVerdict([a, b], model)).toMatchObject({ exempt: "undecided", retired: [] });
  });

  it("keeps a name that joins two fees under both categories", () => {
    const a = row({ fee_name: "Money order/Cashier check fee", canonical_fee_key: "money_order", amount: 8 });
    const b = row({ fee_name: "Money order/Cashier check fee", canonical_fee_key: "cashiers_check", amount: 8 });
    expect(lineConflictVerdict([a, b], model)).toMatchObject({ exempt: "joint_line", retired: [] });
  });

  it("does not read a joiner inside the name's note", () => {
    const a = row({ fee_name: "Stop Payment on Money Order (lost or stolen only)", canonical_fee_key: "money_order", amount: 10 });
    const b = row({ fee_name: "Stop Payment on Money Order (lost or stolen only)", canonical_fee_key: "stop_payment", amount: 10 });
    expect(lineConflictVerdict([a, b], model)?.exempt).not.toBe("joint_line");
  });

  it("never retires NSF for overdraft when the name says both (8078)", () => {
    const name = "NSF (courtesy pay items: check, ACH, or debit card)";
    const a = row({ fee_name: name, canonical_fee_key: "nsf", amount: 32 });
    const b = row({ fee_name: name, canonical_fee_key: "overdraft", amount: 32 });
    expect(lineConflictVerdict([a, b], model)).toMatchObject({ exempt: "joint_line", retired: [] });
  });

  it("leaves a clause name undecided even when the model is sure (7913)", () => {
    const name = "No contents (e.g. check) included in the ATM";
    const a = row({ fee_name: name, canonical_fee_key: "account_research", amount: 2 });
    const b = row({ fee_name: name, canonical_fee_key: "atm_non_network", amount: 2 });
    const verdict = lineConflictVerdict([a, b], model)!;
    expect(verdict.model!.atm_non_network).toBeGreaterThan(0.95);
    expect(verdict).toMatchObject({ exempt: "undecided", retired: [] });
  });

  it("keeps a name that runs two fees together under both readings (3699, 8396)", () => {
    for (const [name, keys] of [
      ["Charge-Back Fee Check Printing Fee", ["deposited_item_return", "check_printing"]],
      ["Legal Processing / Account Research (per hour, 1 hour minimum)", ["legal_process", "account_research"]],
    ] as const) {
      const rows = keys.map((key) => row({ fee_name: name, canonical_fee_key: key }));
      expect(lineConflictVerdict(rows, model)).toMatchObject({ exempt: "joint_line", retired: [] });
    }
  });

  it("never lets the model decide a line with any lending category on it (55406, 11427)", () => {
    const sure = trainCategoryModel([
      ...Array.from({ length: 30 }, (_, i) => ({ name: `faxed documentation copy ${i}`, categoryKey: "document_reproduction", count: 5 })),
      ...Array.from({ length: 30 }, (_, i) => ({ name: `consumer loan processing ${i}`, categoryKey: "other_lending_fee", count: 5 })),
      ...Array.from({ length: 30 }, (_, i) => ({ name: `account research ${i}`, categoryKey: "account_research", count: 5 })),
    ]);
    for (const [name, keys, sureOf] of [
      ["Faxed Documentation", ["document_reproduction", "other_lending_fee"], "document_reproduction"],
      ["Consumer Loan Processing Fee", ["account_research", "other_lending_fee"], "other_lending_fee"],
    ] as const) {
      const verdict = lineConflictVerdict(keys.map((key) => row({ fee_name: name, canonical_fee_key: key, amount: 10 })), sure)!;
      expect(verdict.model![sureOf]).toBeGreaterThan(0.95);
      expect(verdict).toMatchObject({ exempt: "undecided", retired: [] });
    }
  });

  it("leaves a foreign ATM fee filed as non-network and foreign transaction undecided (126315)", () => {
    const name = "ATM – Surcharge for Foreign Transactions";
    const rows = ["atm_non_network", "card_foreign_txn"].map((key) => row({ fee_name: name, canonical_fee_key: key, amount: 2 }));
    expect(lineConflictVerdict(rows, model)).toMatchObject({ exempt: "undecided", retired: [] });
  });

  it("keeps rows that state different audiences apart", () => {
    const a = row({ fee_name: "Photocopy of cleared check", canonical_fee_key: "document_reproduction", fee_audience: "consumer" });
    const b = row({ fee_name: "Photocopy of cleared check", canonical_fee_key: "check_image", fee_audience: "business" });
    expect(lineConflictVerdict([a, b], model)).toMatchObject({ exempt: "audiences", retired: [] });
  });

  it("keeps the frequency the schedule line states (Abound's safe deposit box)", () => {
    const excerpt = 'excerpt="Safe deposit box 5x5 | $ 15.00 Charged once each year for renting a safe deposit box of this size."';
    const a = row({ fee_name: "Safe deposit box 5x5", canonical_fee_key: "safe_deposit_box", amount: 15, frequency: "per_item", conditions: excerpt });
    const b = row({ fee_name: "Safe deposit box 5x5", canonical_fee_key: "safe_deposit_box", amount: 15, frequency: "annual", conditions: excerpt });
    const verdict = lineConflictVerdict([a, b], model)!;
    expect(verdict).toMatchObject({ kind: "frequency", basis: "line", keptReading: "annual", keptFeePublishedId: Number(b.fee_published_id) });
    expect(verdict.retired.map((fee) => fee.feePublishedId)).toEqual([Number(a.fee_published_id)]);
  });

  it("never takes a per-item reading over a period category's period", () => {
    const excerpt = 'excerpt="Monthly Paper Statements / $2.00 Each"';
    const a = row({ fee_name: "Monthly Paper Statements", canonical_fee_key: "paper_statement", amount: 2, frequency: "monthly", conditions: excerpt });
    const b = row({ fee_name: "Monthly Paper Statements", canonical_fee_key: "paper_statement", amount: 2, frequency: "per_item", conditions: excerpt });
    expect(lineConflictVerdict([a, b], model)).toMatchObject({ exempt: "undecided", retired: [] });
  });

  it("does not read a period from a rate on the line", () => {
    const excerpt = 'excerpt="Late payment fees of 5% of the monthly payment or $35.00 whichever is greater may apply."';
    const a = row({ fee_name: "Late payment fees", canonical_fee_key: "late_payment", amount: 35, frequency: "per_item", conditions: excerpt });
    const b = row({ fee_name: "Late payment fees", canonical_fee_key: "late_payment", amount: 35, frequency: "monthly", conditions: excerpt });
    expect(lineConflictVerdict([a, b], model)).toMatchObject({ exempt: "undecided", retired: [] });
  });

  it("is no conflict when the frequencies are one class or one is blank", () => {
    const a = row({ fee_name: "Photocopy", frequency: "per_item" });
    const b = row({ fee_name: "Photocopy", frequency: "per_occurrence" });
    const c = row({ fee_name: "Photocopy", frequency: null });
    expect(lineConflictVerdict([a, b, c], model)).toBeNull();
  });
});

describe("lineConflictVerdict v2: the line's own unit (#2248)", () => {
  // Prod, Nov 1: 6775's "Photocopies | $.25 per page", live per_item since Oct 13 (141881); the
  // Oct 26 re-read of the newer copy said per_page (160637) and v1 retired it, keeping the stale copy.
  const photocopies = (frequency: string, published: string) =>
    row({ fee_name: "Photocopies", canonical_fee_key: "document_reproduction", amount: 0.25, frequency,
      published_at: published, conditions: 'excerpt="Photocopies | $.25 per page"' });

  it("never retires the reading that carries the unit the line prints, while the switch is off", () => {
    const stale = photocopies("per_item", "2026-10-13T00:00:00Z");
    const reread = photocopies("per_page", "2026-10-26T00:00:00Z");
    expect(lineConflictVerdict([stale, reread], model, { ownUnitLive: false })).toMatchObject({ kind: "frequency", exempt: "own_unit", retired: [] });
    expect(lineConflictVerdict([stale, reread], model, { ownUnitLive: false })?.retired).toEqual([]);
  });

  it("switched on, keeps the unit reading and retires the stale per-item copy", () => {
    const stale = photocopies("per_item", "2026-10-13T00:00:00Z");
    const reread = photocopies("per_page", "2026-10-26T00:00:00Z");
    const verdict = lineConflictVerdict([stale, reread], model, { ownUnitLive: true })!;
    expect(verdict).toMatchObject({ kind: "frequency", basis: "unit", keptReading: "per_page", keptFeePublishedId: Number(reread.fee_published_id) });
    expect(verdict.retired.map((fee) => [fee.feePublishedId, fee.reason])).toEqual([
      [Number(stale.fee_published_id), `one line, two reads: kept #${reread.fee_published_id} (frequency, unit: per_page)`],
    ]);
  });

  it("reads a statement unit on a period category (4779's paper statement, per statement cycle)", () => {
    const excerpt = 'excerpt="Paper Statement Mailed (Business) | $3 per Statement Cycle"';
    const stale = row({ fee_name: "Paper Statement Mailed (Business)", canonical_fee_key: "paper_statement", amount: 3, frequency: "monthly", conditions: excerpt });
    const reread = row({ fee_name: "Paper Statement Mailed (Business)", canonical_fee_key: "paper_statement", amount: 3, frequency: "per_statement", conditions: excerpt });
    expect(lineConflictVerdict([stale, reread], model, { ownUnitLive: true })).toMatchObject({ basis: "unit", keptReading: "per_statement" });
  });

  it("leaves the line to the older step when no row carries the unit, or the lines disagree", () => {
    const a = photocopies("per_item", "2026-10-13T00:00:00Z");
    const b = photocopies("monthly", "2026-10-14T00:00:00Z");
    expect(lineConflictVerdict([a, b], model, { ownUnitLive: true })?.basis).not.toBe("unit");
    const c = row({ fee_name: "Photocopies", canonical_fee_key: "document_reproduction", amount: 0.25, frequency: "per_page",
      conditions: 'excerpt="Photocopies | $.25 per document"' });
    expect(lineConflictVerdict([photocopies("per_item", "2026-10-13T00:00:00Z"), c], model, { ownUnitLive: true })?.basis).not.toBe("unit");
  });

  it("switched on, keeps a row that states no frequency, as the line step does", () => {
    const stale = photocopies("per_item", "2026-10-13T00:00:00Z");
    const blank = row({ fee_name: "Photocopies", canonical_fee_key: "document_reproduction", amount: 0.25, frequency: null,
      conditions: 'excerpt="Photocopies | $.25 per page"' });
    const reread = photocopies("per_page", "2026-10-26T00:00:00Z");
    const verdict = lineConflictVerdict([stale, blank, reread], model, { ownUnitLive: true })!;
    expect(verdict.basis).toBe("unit");
    expect(verdict.retired.map((fee) => fee.feePublishedId)).toEqual([Number(stale.fee_published_id)]);
  });

  it("a copy whose stored line names no unit leaves the line unsettled, switch on or off; a copy with no stored line does not", () => {
    for (const ownUnitLive of [false, true]) {
      const silent = row({ fee_name: "Photocopies", canonical_fee_key: "document_reproduction", amount: 0.25, frequency: "per_item",
        conditions: 'excerpt="Photocopies | $.25"' });
      const reread = photocopies("per_page", "2026-10-26T00:00:00Z");
      // Nothing retired either way: the older line step would read "per page" as per item.
      expect(lineConflictVerdict([silent, reread], model, { ownUnitLive })).toMatchObject({ exempt: "undecided", retired: [] });
      const noLine = row({ fee_name: "Photocopies", canonical_fee_key: "document_reproduction", amount: 0.25, frequency: "per_occurrence", conditions: null });
      const other = photocopies("per_page", "2026-10-27T00:00:00Z");
      expect(lineConflictVerdict([noLine, other], model, { ownUnitLive })).toMatchObject(
        ownUnitLive ? { basis: "unit", keptReading: "per_page" } : { exempt: "own_unit", retired: [] },
      );
    }
  });

  it("counts unit lines apart in the findings", () => {
    const found = findLineConflicts([photocopies("per_item", "2026-10-13T00:00:00Z"), photocopies("per_page", "2026-10-26T00:00:00Z")], model, { ownUnitLive: false });
    expect(found).toMatchObject({ lines: 1, wouldRetire: 0, byExempt: { own_unit: 1 }, byBasis: { unit: 0 } });
  });
});

describe("findLineConflicts", () => {
  it("groups by institution, name, amount, variant and source address", () => {
    const rows = [
      row({ fee_name: "Prepaid Card", canonical_fee_key: "document_reproduction" }),
      row({ fee_name: " prepaid card ", canonical_fee_key: "gift_card_purchase" }),
      // Another address, another amount, another bank: not the same line.
      row({ fee_name: "Prepaid Card", canonical_fee_key: "document_reproduction", source_url: "https://bank.example/other.pdf" }),
      row({ fee_name: "Prepaid Card", canonical_fee_key: "gift_card_purchase", amount: 6 }),
      row({ fee_name: "Prepaid Card", canonical_fee_key: "gift_card_purchase", institution_id: 8 }),
    ];
    const found = findLineConflicts(rows, model);
    expect(found).toMatchObject({ lines: 1, rows: 2, wouldRetire: 1, byKind: { category: 1, frequency: 0 }, byBasis: { model: 1 } });
    expect(found.verdicts[0].keptReading).toBe("gift_card_purchase");
  });

  it("ships switched on (James, Oct 16), with a read-only count", () => {
    expect(LINE_CONFLICT_TAKEDOWN_LIVE).toBe(true);
    expect(lineConflictCountSql()).not.toMatch(/\b(UPDATE|INSERT|DELETE)\b/i);
  });
});

describe("recheckLineConflicts switch", () => {
  const excerpt = 'excerpt="Safe deposit box 5x5 | $ 15.00 Charged once each year for renting a safe deposit box of this size."';
  function lineDb() {
    const a = row({ fee_name: "Safe deposit box 5x5", canonical_fee_key: "safe_deposit_box", amount: 15, frequency: "per_item", conditions: excerpt });
    const b = row({ fee_name: "Safe deposit box 5x5", canonical_fee_key: "safe_deposit_box", amount: 15, frequency: "annual", conditions: excerpt });
    const db = vi.fn(() => Promise.resolve([])) as unknown as ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
    db.unsafe = vi.fn(() => Promise.resolve([a, b]));
    return { db, retiredId: Number(a.fee_published_id) };
  }
  type Db = Parameters<typeof recheckLineConflicts>[0];

  beforeEach(() => {
    secondLookMock.mockReset();
    secondLookMock.mockResolvedValue({ flagged: 1, waiting: 0, cleared: 1, confirmed: [] });
  });

  it("on by default: a retired row goes to the shared second look", async () => {
    const { db, retiredId } = lineDb();
    const result = await recheckLineConflicts(db as unknown as Db, { runId: 5, dryRun: false, model: null });
    expect(result).toMatchObject({ live: true, wouldRetire: 1, flagged: 1, takenDown: [] });
    expect(secondLookMock).toHaveBeenCalledTimes(1);
    expect(secondLookMock.mock.calls[0][1]).toMatchObject({ check: "darwin.line_conflict", dryRun: false });
    expect(secondLookMock.mock.calls[0][1].failing.map((fee: { feePublishedId: number }) => fee.feePublishedId)).toEqual([retiredId]);
  });

  it("switched off (live: false) or in a dry run, only reports", async () => {
    for (const options of [{ live: false, dryRun: false }, { dryRun: true }]) {
      const { db } = lineDb();
      const result = await recheckLineConflicts(db as unknown as Db, { runId: 5, model: null, ...options });
      expect(result).toMatchObject({ wouldRetire: 1, flagged: 0, takenDown: [] });
      const writes = db.mock.calls.map((call) => (call[0] as TemplateStringsArray).join("?")).join("\n");
      expect(writes).not.toMatch(/UPDATE|DELETE/);
    }
    expect(secondLookMock).not.toHaveBeenCalled();
  });
});

describe("the v2 restore of unit reads v1 archived", () => {
  function archived(overrides: Partial<LineConflictRestoreRow> = {}): LineConflictRestoreRow {
    return {
      ...row({ fee_name: "Photocopies", canonical_fee_key: "document_reproduction", amount: 0.25, frequency: "per_page",
        conditions: 'excerpt="Photocopies | $.25 per page"' }),
      review_status: "rejected",
      last_flag: LINE_CONFLICT_FLAG,
      rolled_back_reason: "one line, two reads: kept #141881 (frequency, line: each)",
      kept_canonical_fee_key: "document_reproduction",
      kept_fee_published_id: 141881,
      kept_live: true,
      kept_same_line: true,
      kept_frequency: "per_item",
      kept_conditions: 'excerpt="Photocopies | $.25 per page"',
      unit_copy_live: false,
      ...overrides,
    };
  }

  it("brings back a unit read whose line prints its unit beside a live stale twin, one per line", () => {
    const older = archived();
    const newer = archived();
    const judged = judgeLineConflictRestores([older, newer]);
    expect(judged.restorable.map((fee) => [fee.feePublishedId, fee.unit, fee.staleFeePublishedId])).toEqual([[Number(newer.fee_published_id), "per_page", 141881]]);
    expect(judged.kept).toEqual({ same_line_restored: 1 });
  });

  it("never undoes a category takedown, even of a unit read", () => {
    // A per_page row the category step took down under the wrong category would come back under it.
    const judged = judgeLineConflictRestores([
      archived({ rolled_back_reason: "one line, two reads: kept #141881 (category, model: check_image)", kept_canonical_fee_key: "check_image" }),
      archived({ kept_canonical_fee_key: "check_image" }),
      archived({ rolled_back_reason: "one line, two reads: kept #141881 (category, guard: document_reproduction)" }),
    ]);
    expect(judged.restorable).toEqual([]);
    expect(judged.kept).toEqual({ not_a_frequency_takedown: 3 });
    // A twin that no longer exists is a gone twin, not a category takedown.
    expect(judgeLineConflictRestores([archived({ kept_fee_published_id: null, kept_canonical_fee_key: null, kept_live: null, kept_same_line: null })]).kept)
      .toEqual({ kept_gone: 1 });
    expect(lineConflictRestoreRowsSql()).toContain("strpos(fp.rolled_back_reason, ' (frequency, ') > 0");
    expect(lineConflictRestoreRowsSql()).toContain("kept.canonical_fee_key = fp.canonical_fee_key");
  });

  it("keeps down what it cannot prove", () => {
    const judged = judgeLineConflictRestores([
      archived({ frequency: "per_item" }),
      archived({ kept_live: false }),
      archived({ kept_same_line: false }),
      archived({ kept_frequency: "per_page" }),
      archived({ kept_conditions: 'excerpt="Photocopies | $.25"' }),
      archived({ unit_copy_live: true }),
      archived({ review_status: "verified" }),
    ]);
    expect(judged.restorable).toEqual([]);
    expect(judged.kept).toEqual({ not_a_unit_read: 1, kept_gone: 2, kept_has_unit: 1, line_not_unit: 1, unit_copy_live: 1, verified_moved: 1 });
  });

  it("is on (sampled clean 2026-11-02), and its count SQL only reads", () => {
    expect(LINE_CONFLICT_OWN_UNIT_LIVE).toBe(true);
    expect(lineConflictRestoreRowsSql()).not.toMatch(/\b(UPDATE|INSERT|DELETE)\b/i);
    expect(lineConflictRestoreRowsSql()).not.toContain("$1");
  });

  type Db = Parameters<typeof recheckLineConflicts>[0];
  function restoreDb(restored: LineConflictRestoreRow[], options: { twinGone?: boolean } = {}) {
    const db = vi.fn((strings: TemplateStringsArray) => {
      const text = strings.join("?");
      if (text.includes("rolled_back_at = NULL")) return Promise.resolve(restored.map((fee) => ({ fee_published_id: fee.fee_published_id })));
      if (text.includes("rolled_back_at = NOW()")) {
        return Promise.resolve(options.twinGone ? [] : restored.map((fee) => ({ fee_published_id: fee.kept_fee_published_id, lineage_ref: 1 })));
      }
      return Promise.resolve([]);
    }) as unknown as ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
    db.unsafe = vi.fn().mockResolvedValueOnce(restored).mockResolvedValueOnce([]);
    return db;
  }

  beforeEach(() => {
    secondLookMock.mockReset();
    recordFeedbackMock.mockReset();
  });

  it("switched off or in a dry run, counts the restores and writes nothing", async () => {
    for (const options of [{ dryRun: false, ownUnitLive: false }, { dryRun: true, ownUnitLive: true }]) {
      const fee = archived();
      const db = restoreDb([fee]);
      const result = await recheckLineConflicts(db as unknown as Db, { runId: 5, model: null, ...options });
      expect(result.restore).toMatchObject({ read: 1, restored: [] });
      expect(result.restore.restorable).toHaveLength(1);
      const writes = db.mock.calls.map((call) => (call[0] as TemplateStringsArray).join("?")).join("\n");
      expect(writes).not.toMatch(/UPDATE/);
    }
    expect(recordFeedbackMock).not.toHaveBeenCalled();
  });

  it("switched on, puts the unit read back live, verifies it again and clears its second look", async () => {
    const fee = archived();
    const db = restoreDb([fee]);
    const result = await recheckLineConflicts(db as unknown as Db, { runId: 5, dryRun: false, model: null, ownUnitLive: true });
    expect(result.restore.restored).toEqual([Number(fee.fee_published_id)]);
    const writes = db.mock.calls.map((call) => (call[0] as TemplateStringsArray).join("?")).join("\n");
    expect(writes).toMatch(/SET review_status = 'verified'/);
    // The write re-checks the twin's line, category, and that it still lacks the unit.
    expect(writes).toMatch(/kept\.canonical_fee_key = fp\.canonical_fee_key/);
    expect(writes).toMatch(/FOR UPDATE OF kept/);
    expect(writes).toMatch(/o\.rate_percent IS NOT DISTINCT FROM fp\.rate_percent/);
    expect(writes).toMatch(/COALESCE\(o\.variant_type, ''\) = COALESCE\(fp\.variant_type, ''\)/);
    expect(writes).toMatch(/lower\(btrim\(COALESCE\(kept\.frequency, ''\)\)\) <> lower\(btrim\(fp\.frequency\)\)/);
    // The stale twin comes down in the same write, with its verified row rejected.
    const twin = db.mock.calls.find((call) => (call[0] as TemplateStringsArray).join("?").includes("rolled_back_at = NOW()"));
    expect(twin?.slice(1)).toContainEqual([`one line, two reads: kept #${fee.fee_published_id} (frequency, unit: per_page)`]);
    expect(writes).toMatch(/SET review_status = 'rejected'/);
    expect(writes).toMatch(/darwin\.line_conflict_restored/);
    expect(recordFeedbackMock).toHaveBeenCalledTimes(1);
    expect(recordFeedbackMock.mock.calls[0][1].map((entry: { kind: string; weight: number }) => [entry.kind, entry.weight])).toEqual([
      ["takedown_cleared", 0], ["flag_cleared", 0],
    ]);
  });

  it("switched on, restores nothing when its stale twin cannot come down in the same write", async () => {
    const fee = archived();
    const db = restoreDb([fee], { twinGone: true });
    const result = await recheckLineConflicts(db as unknown as Db, { runId: 5, dryRun: false, model: null, ownUnitLive: true });
    expect(result.restore.restored).toEqual([]);
    expect(recordFeedbackMock).not.toHaveBeenCalled();
  });
});
