import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { heldByCardProductSwitch, lateBoxFlags, movesBoxLateFee, movesExcessActivityFee, restoreTarget, runHamiltonCategoryGuard, tracesOnOwnText, uniqueRefiles } from "./category-guard";
import { checkFeeCategory } from "@/lib/fee-category-guard";

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

const liveRows = [
  { fee_published_id: 1, lineage_ref: 11, institution_id: 7, canonical_fee_key: "overdraft", fee_name: "Overdraft Fee", amount: "35.00" },
  { fee_published_id: 2, lineage_ref: 12, institution_id: 7, canonical_fee_key: "overdraft", fee_name: "Overdraft Transfer Fee (Sweep)", amount: "7.50" },
  { fee_published_id: 3, lineage_ref: 13, institution_id: 8, canonical_fee_key: "monthly_maintenance", fee_name: "Monthly fee, if the balance falls below", amount: "2500.00" },
  { fee_published_id: 4, lineage_ref: 14, institution_id: 8, canonical_fee_key: "atm_non_network", fee_name: "You may withdraw up to", amount: "500.00" },
];

// Rows 2 and 4 failed their first look 13 hours ago, on another run.
const firstLooks = [2, 4].map((id) => ({
  fee_published_id: id,
  kind: "takedown_pending",
  evidence: { flag_run_id: 1, flagged_at: new Date(Date.now() - 13 * 3_600_000).toISOString(), reason: "name" },
}));

function createDbMock(flags: unknown[] = firstLooks, takenDown: unknown[] = [], texts: Record<number, string> = {}) {
  return vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = templateText(strings);
    if (text.includes("to_regclass('public.pipeline_feedback')")) return Promise.resolve([{ ready: true }]);
    if (text.includes("FROM agent_source_texts")) {
      return Promise.resolve(Object.entries(texts).map(([doc, normalized_text]) => ({ source_document_id: Number(doc), normalized_text })));
    }
    if (text.includes("FROM pipeline_feedback")) return Promise.resolve(flags);
    if (text.includes("rolled_back_at IS NOT NULL")) return Promise.resolve(takenDown);
    if (text.includes("UPDATE published_fee_records") && text.includes("rolled_back_at = NULL")) {
      return Promise.resolve((values[0] as number[]).map((id, i) => ({ fee_published_id: id, lineage_ref: id + 10, canonical_fee_key: (values[1] as string[])[i] })));
    }
    if (text.includes("FROM published_fee_records")) return Promise.resolve(liveRows);
    if (text.includes("UPDATE published_fee_records")) {
      return Promise.resolve((values[1] as number[]).map((id) => ({ fee_published_id: id })));
    }
    if (text.includes("UPDATE verified_fee_observations")) {
      return Promise.resolve((values[0] as number[]).map((id) => ({ fee_verified_id: id })));
    }
    return Promise.resolve([]);
  });
}

type GuardDb = NonNullable<Parameters<typeof runHamiltonCategoryGuard>[0]["db"]>;

describe("Hamilton category guard repair", () => {
  it("reports failing live rows on a dry run without writing", async () => {
    const db = createDbMock();

    const result = await runHamiltonCategoryGuard({ runId: 9, dryRun: true, db: db as unknown as GuardDb });

    expect(result).toMatchObject({
      scannedFees: 4,
      failingFees: 2,
      rolledBackFees: 0,
      rejectedVerifiedFees: 0,
      dryRun: true,
      byCode: { name_contradicts: 1, name_unsupported: 1 },
    });
    // Row 3 names its category; its implausible amount is the outlier rollback's job.
    expect(result.failures.map((failure) => failure.feePublishedId)).toEqual([2, 4]);
    // Both failed an earlier look too, so a live run would take both down.
    expect(result.confirmedFeeIds).toEqual([2, 4]);
    const statements = db.mock.calls.map((call) => templateText(call[0])).join("\n");
    expect(statements).not.toContain("UPDATE");
    expect(statements).not.toContain("INSERT");
  });

  it("soft-deletes failing rows and rejects their verified rows", async () => {
    const db = createDbMock();

    const result = await runHamiltonCategoryGuard({ runId: 10, db: db as unknown as GuardDb });

    expect(result).toMatchObject({ failingFees: 2, rolledBackFees: 2, rejectedVerifiedFees: 2 });
    const statements = db.mock.calls.map((call) => templateText(call[0])).join("\n");
    expect(statements).toContain("SET rolled_back_at = NOW()");
    expect(statements).toContain("review_status = 'rejected'");
    expect(statements).not.toContain("DELETE");
    expect(JSON.stringify(db.mock.calls)).toContain("category-guard-run-10");
  });

  it("takes nothing down on a first failure: it logs both fees for a second look", async () => {
    const db = createDbMock([]);

    const result = await runHamiltonCategoryGuard({ runId: 12, db: db as unknown as GuardDb });

    expect(result).toMatchObject({ failingFees: 0, rolledBackFees: 0, flaggedFees: 2 });
    // First looks are not takedowns (publish-sweeps window check).
    expect(result.confirmedFeeIds).toEqual([]);
    const statements = db.mock.calls.map((call) => templateText(call[0])).join("\n");
    expect(statements).toContain("INSERT INTO pipeline_feedback");
    expect(statements).not.toContain("SET rolled_back_at = NOW()");
  });

  it("brings back an earlier takedown today's guard passes", async () => {
    const db = createDbMock([], [
      { fee_published_id: 21, lineage_ref: 31, source_document_id: 7, canonical_fee_key: "card_replacement", fee_name: "Visa Check Card Replacement", amount: "10.00", conditions: null },
      { fee_published_id: 22, lineage_ref: 32, source_document_id: 7, canonical_fee_key: "atm_non_network", fee_name: "ATM Limit Adjustment", amount: "5.00", conditions: null },
    ], { 7: "Visa Check Card Replacement | $10.00\nATM Limit Adjustment | $5.00" });

    const result = await runHamiltonCategoryGuard({ runId: 13, db: db as unknown as GuardDb });

    expect(result.restoredFees).toBe(1);
    const restore = db.mock.calls.find((call) => templateText(call[0]).includes("rolled_back_at = NULL"));
    expect(restore?.[1]).toEqual([21]);
    // A twin the account type hold took down still counts as present (#1675).
    expect(templateText(restore?.[0])).toContain("(live.rolled_back_at IS NULL OR live.rolled_back_reason LIKE");
    expect(restore?.slice(1)).toContain("account_type_hold:%");
  });

  it("brings back an ATM adjustment the guard took down under the type its fold split gives it, logged as a fold", async () => {
    const db = createDbMock([], [
      { fee_published_id: 45585, lineage_ref: 36992, institution_id: 6182, source_document_id: 9, canonical_fee_key: "atm_non_network", fee_name: "ATM Adjustment", amount: "2.00", conditions: null },
    ], { 9: "ATM Adjustment | $2.00" });

    const result = await runHamiltonCategoryGuard({ runId: 14, db: db as unknown as GuardDb });

    expect(result).toMatchObject({ restoredFees: 1, refiledFees: 1 });
    const restore = db.mock.calls.find((call) => templateText(call[0]).includes("rolled_back_at = NULL"));
    expect([restore?.[1], restore?.[2]]).toEqual([[45585], ["account_research"]]);
    const statements = db.mock.calls.map((call) => templateText(call[0])).join("\n");
    expect(statements).toContain("INSERT INTO pipeline_feedback");
    expect(statements).not.toContain("DELETE");
  });

  it("keeps a takedown down when neither its own type nor a split or checked re-file type accepts it", () => {
    const row = { conditions: null, document_nsf_amount: null };
    expect(restoreTarget({ ...row, canonical_fee_key: "atm_non_network", fee_name: "ATM Adjustment Fee", amount: "5.00" })).toBe("account_research");
    expect(restoreTarget({ ...row, canonical_fee_key: "atm_non_network", fee_name: "ATM Limit Adjustment", amount: "5.00" })).toBeNull();
    // Only spot-checked re-file rules bring a fee back: this one has not been checked yet.
    expect(restoreTarget({ ...row, canonical_fee_key: "overdraft", fee_name: "Overdraft Transfer Fee (Sweep)", amount: "7.50" })).toBeNull();
    expect(restoreTarget({ ...row, canonical_fee_key: "card_replacement", fee_name: "Visa Check Card Replacement", amount: "10.00" })).toBe("card_replacement");
  });

  it("re-files an excess activity charge filed as monthly maintenance from its own line, and leaves other activity charges (guard v62)", () => {
    const note = (line: string) => `Knox deterministic extraction from Rosetta artifact #13538. canonical_hint=monthly_maintenance; excerpt="${line}"`;
    const row = { canonical_fee_key: "monthly_maintenance", fee_name: "Service charge", document_nsf_amount: null };
    // Live fee 60814's source line (Oct 14).
    expect(restoreTarget({ ...row, amount: "2.00", conditions: note("Service charge of $2 per debit in excess of 6 withdrawals per quarter") })).toBe("account_research");
    // Live fee 142257's line: a transfer charge has no one home, so it is not re-filed.
    expect(restoreTarget({ ...row, amount: "5.00", conditions: note("1A $5.00 service charge will be applied to each share transfer.") })).toBeNull();
    // The account's own fee with a per-check charge on top stays where it is.
    expect(restoreTarget({ ...row, amount: "10.00", conditions: note("a service charge of $10.00 and $.25 per check is assessed.*") })).toBe("monthly_maintenance");
  });

  it("brings a night deposit bag key back as a night deposit fee, and leaves bag supplies down (guard v60)", () => {
    const row = { conditions: null, document_nsf_amount: null };
    expect(restoreTarget({ ...row, canonical_fee_key: "safe_deposit_box", fee_name: "Depository Replacement Key", amount: "5.00" })).toBe("night_deposit");
    expect(restoreTarget({ ...row, canonical_fee_key: "safe_deposit_box", fee_name: "Replacement Key for Bag", amount: "5.00" })).toBe("night_deposit");
    expect(restoreTarget({ ...row, canonical_fee_key: "safe_deposit_box", fee_name: "Bag Replacement/Lost Key", amount: "15.00" })).toBe("night_deposit");
    expect(restoreTarget({ ...row, canonical_fee_key: "safe_deposit_box", fee_name: "Deposit Bags & Night Deposit Drop Box: Disposable 9\" x 12\" bundle", amount: "15.00" })).toBeNull();
    expect(restoreTarget({ ...row, canonical_fee_key: "safe_deposit_box", fee_name: "Zipper with Lock (9\" X 16”)", amount: "20.00" })).toBeNull();
  });

  it("brings a returned bond or coupon back as a returned deposited item, and only those (guard v58)", () => {
    const row = { conditions: null, document_nsf_amount: null };
    expect(restoreTarget({ ...row, canonical_fee_key: "nsf", fee_name: "Bond/Coupon Returned Item Fee", amount: "45.00" })).toBe("deposited_item_return");
    expect(restoreTarget({ ...row, canonical_fee_key: "nsf", fee_name: "Bond return items", amount: "35.00" })).toBe("deposited_item_return");
    // A collection of bonds is a collection item, and the rule's unchecked "deposit" names stay down.
    expect(restoreTarget({ ...row, canonical_fee_key: "nsf", fee_name: "Items sent for Collection (i.e.: foreign items, NSF, Bonds, Etc.)", amount: "30.00" })).toBeNull();
    expect(restoreTarget({ ...row, canonical_fee_key: "nsf", fee_name: "Returned Deposit Item NSF Fee (deposit)", amount: "10.00" })).toBeNull();
  });

  it("brings a hand-checked fee back under its checked type, only while it reads as checked (96164, guard v58)", () => {
    const row = { conditions: null, document_nsf_amount: null, canonical_fee_key: "monthly_maintenance", fee_name: "balance requirement to avoid the monthly service charge is met. Otherwise, a fee of", amount: "2.50" };
    expect(checkFeeCategory("monthly_maintenance", row.fee_name).ok).toBe(false);
    expect(restoreTarget({ ...row, fee_published_id: 96164 })).toBe("atm_non_network");
    expect(restoreTarget({ ...row, fee_published_id: 96164, amount: "3.00" })).toBeNull();
    expect(restoreTarget({ ...row, fee_published_id: 96165 })).toBeNull();
  });

  it("brings back the fees the guard took down at 12:26 on Oct 9 under the type their name names", () => {
    const row = { conditions: null, document_nsf_amount: null };
    const cases: Array<[number, string, string, string, string]> = [
      [95142, "money_order", "Money Order Research Fee", "10.00", "account_research"],
      [67519, "wire_intl_outgoing", "International Wire Research or Tracking", "55.00", "account_research"],
      [95114, "wire_intl_outgoing", "Foreign Wire Research", "15.00", "account_research"],
      [51270, "bill_pay", "Member Draft Stop Pymt (Including Bill Pay)", "15.00", "stop_payment"],
      [53995, "bill_pay", "Electronic Bill Pay Stop Pay", "29.50", "stop_payment"],
      [72328, "bill_pay", "Bill Pay Stop Pay", "30.00", "stop_payment"],
      [94280, "bill_pay", "Bill Pay Stop/Cancel Payment", "25.00", "stop_payment"],
      [65499, "nsf", "Payee-returned ACH Payment Due to Member Error", "25.00", "ach_return"],
    ];
    for (const [id, from, name, amount, to] of cases) {
      expect(checkFeeCategory(from, name).ok, `${id}`).toBe(false);
      expect(restoreTarget({ ...row, fee_published_id: id, canonical_fee_key: from, fee_name: name, amount }), `${id}`).toBe(to);
      // The new type's guard keeps it there.
      expect(checkFeeCategory(to, name).ok, `${id}`).toBe(true);
    }
  });

  it("re-files a live fee in place when its name belongs to another type a checked rule names, instead of taking it down", async () => {
    const refileRow = { fee_published_id: 95142, lineage_ref: 195142, institution_id: 8581, source_document_id: 16111, canonical_fee_key: "money_order", fee_name: "Money Order Research Fee", amount: "10.00", conditions: null };
    const flags = [{ fee_published_id: 95142, kind: "takedown_pending", evidence: { flag_run_id: 1, flagged_at: new Date(Date.now() - 13 * 3_600_000).toISOString(), reason: "name" } }];
    const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = templateText(strings);
      if (text.includes("to_regclass('public.pipeline_feedback')")) return Promise.resolve([{ ready: true }]);
      if (text.includes("FROM pipeline_feedback")) return Promise.resolve(flags);
      if (text.includes("rolled_back_at IS NOT NULL")) return Promise.resolve([]);
      if (text.includes("UPDATE published_fee_records") && text.includes("v.from_key")) {
        return Promise.resolve((values[0] as number[]).map((id, i) => ({ fee_published_id: id, lineage_ref: id + 100000, canonical_fee_key: (values[2] as string[])[i] })));
      }
      if (text.includes("FROM published_fee_records")) return Promise.resolve([refileRow]);
      return Promise.resolve([]);
    });

    const dry = await runHamiltonCategoryGuard({ runId: 21, dryRun: true, db: db as unknown as GuardDb });
    expect(dry).toMatchObject({ liveRefiledFees: 1, failingFees: 0, flaggedFees: 0 });

    const result = await runHamiltonCategoryGuard({ runId: 22, db: db as unknown as GuardDb });
    expect(result).toMatchObject({ liveRefiledFees: 1, failingFees: 0, rolledBackFees: 0 });
    const writes = db.mock.calls.map((call) => templateText(call[0]));
    expect(writes.some((text) => text.includes("rolled_back_at = NOW()"))).toBe(false);
    const move = db.mock.calls.find((call) => templateText(call[0]).includes("v.from_key"));
    expect([move?.[1], move?.[2], move?.[3]]).toEqual([[95142], ["money_order"], ["account_research"]]);
  });

  it("re-files an excess withdrawal fee beside the bank's unrelated research fee at its price (#1283 review)", async () => {
    const note = (line: string) => `Knox deterministic extraction from Rosetta artifact #1. canonical_hint=monthly_maintenance; excerpt="${line}"`;
    const fee = (id: number, inst: number, name: string, amount: string, line: string) => ({
      fee_published_id: id, lineage_ref: id + 100000, institution_id: inst, source_document_id: 1,
      canonical_fee_key: "monthly_maintenance", fee_name: name, amount, conditions: note(line), document_nsf_amount: null,
    });
    // Live fees 124670 and 142436's own lines (Oct 15).
    const maintenance = fee(124670, 5502, "Maintenance fee", "5.00", "A maintenance fee of $5.00 per transaction will be charged if you make more than two withdrawals during a 12 month period.");
    const perItem = fee(142436, 3167, "Per item service charge fee", "25.00", "A per item service charge fee of $25.00 will be charged for each transaction in excess of the above limitations.");
    expect(restoreTarget(maintenance)).toBe("account_research");
    expect(restoreTarget(perItem)).toBe("account_research");
    expect(movesExcessActivityFee({ row: maintenance, to: "account_research" })).toBe(true);
    // A plain hand re-file is not an excess activity fee: only a same-name live fee stops it.
    const research = { ...fee(95142, 8581, "Money Order Research Fee", "10.00", "x"), canonical_fee_key: "money_order", conditions: null };
    expect(movesExcessActivityFee({ row: research, to: "account_research" })).toBe(false);
    // Two copies of one line are one fee; an excess fee and an unrelated fee at one price are two.
    const copy = { ...maintenance, fee_published_id: 999 };
    const other = { ...research, institution_id: 5502, amount: "5.00" };
    expect(uniqueRefiles([{ row: maintenance, to: "account_research" }, { row: copy, to: "account_research" }]).map((r) => r.row.fee_published_id)).toEqual([124670]);
    expect(uniqueRefiles([{ row: maintenance, to: "account_research" }, { row: other, to: "account_research" }])).toHaveLength(2);
    // Any other move keeps the old rule: two express card lines at one bank and price are one fee.
    const express = (id: number, name: string) => ({ ...research, fee_published_id: id, institution_id: 6042, canonical_fee_key: "card_replacement", fee_name: name, amount: "40.00" });
    expect(uniqueRefiles([
      { row: express(350, "Replacement Card - Express Mail"), to: "rush_card" },
      { row: express(27687, "Replacement Card Shipped via Express Mail"), to: "rush_card" },
    ]).map((r) => r.row.fee_published_id)).toEqual([350]);

    const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = templateText(strings);
      if (text.includes("to_regclass('public.pipeline_feedback')")) return Promise.resolve([{ ready: true }]);
      if (text.includes("UPDATE published_fee_records") && text.includes("v.from_key")) {
        return Promise.resolve((values[0] as number[]).map((id, i) => ({ fee_published_id: id, lineage_ref: id + 100000, canonical_fee_key: (values[2] as string[])[i] })));
      }
      if (text.includes("rolled_back_at IS NOT NULL")) return Promise.resolve([]);
      if (text.includes("FROM published_fee_records")) return Promise.resolve([maintenance]);
      return Promise.resolve([]);
    });
    const result = await runHamiltonCategoryGuard({ runId: 23, db: db as unknown as GuardDb });
    expect(result).toMatchObject({ liveRefiledFees: 1, failingFees: 0 });
    const move = db.mock.calls.find((call) => templateText(call[0]).includes("v.from_key") && templateText(call[0]).includes("UPDATE"));
    const sqlText = templateText(move?.[0]);
    // The twin test needs the same name, or an excess activity fee when one moves; price alone is not enough.
    expect(sqlText).toContain("lower(btrim(live.fee_name)) = lower(btrim(fp.fee_name))");
    expect(sqlText).toContain("AND (NOT v.excess");
    expect(sqlText).toContain("OR live.fee_name ~*");
    expect(move?.[4]).toEqual(["true"]);
  });

  it("re-files only one of two express card lines at one price, and lets any live rush card fee at that price block them (live path)", async () => {
    const card = (id: number, name: string) => ({ fee_published_id: id, lineage_ref: id + 100000, institution_id: 6042, source_document_id: 1, canonical_fee_key: "card_replacement", fee_name: name, amount: "40.00", conditions: null, document_nsf_amount: null });
    const rows = [card(350, "Replacement Card - Express Mail"), card(27687, "Replacement Card Shipped via Express Mail")];
    expect(rows.map((row) => restoreTarget(row))).toEqual(["rush_card", "rush_card"]);
    const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = templateText(strings);
      if (text.includes("to_regclass('public.pipeline_feedback')")) return Promise.resolve([{ ready: true }]);
      if (text.includes("UPDATE published_fee_records") && text.includes("v.from_key")) {
        return Promise.resolve((values[0] as number[]).map((id, i) => ({ fee_published_id: id, lineage_ref: id + 100000, canonical_fee_key: (values[2] as string[])[i] })));
      }
      if (text.includes("rolled_back_at IS NOT NULL")) return Promise.resolve([]);
      if (text.includes("FROM published_fee_records")) return Promise.resolve(rows);
      return Promise.resolve([]);
    });
    await runHamiltonCategoryGuard({ runId: 24, db: db as unknown as GuardDb });
    const move = db.mock.calls.find((call) => templateText(call[0]).includes("v.from_key") && templateText(call[0]).includes("UPDATE"));
    // One fee per bank, type and price: only 350 is sent to move, and not as an excess activity fee.
    expect([move?.[1], move?.[4]]).toEqual([[350], ["false"]]);
    // No bound value is a boolean array: postgres.js would send it as a scalar bool and the
    // ::boolean[] cast fails on Postgres (Oct 15, every v62 re-file).
    expect(move?.slice(1).some((value) => Array.isArray(value) && value.some((item) => typeof item === "boolean"))).toBe(false);
    // In SQL, a move that is not an excess activity fee is blocked by any live fee of that type and price.
    expect(templateText(move?.[0])).toContain("AND (NOT v.excess");
  });

  it("brings an express card replacement back as the rush card fee, once per institution and price", async () => {
    const row = { conditions: null, document_nsf_amount: null };
    expect(restoreTarget({ ...row, canonical_fee_key: "card_replacement", fee_name: "Express Replacement Card", amount: "25.00" })).toBe("rush_card");
    expect(restoreTarget({ ...row, canonical_fee_key: "card_replacement", fee_name: "Replacement Debit Card Two Day Delivery", amount: "20.00" })).toBe("rush_card");
    const db = createDbMock([], [
      { fee_published_id: 350, lineage_ref: 1350, institution_id: 6042, source_document_id: 2536, canonical_fee_key: "card_replacement", fee_name: "Replacement Card - Express Mail", amount: "40.00", conditions: null },
      { fee_published_id: 27687, lineage_ref: 1687, institution_id: 6042, source_document_id: 15325, canonical_fee_key: "card_replacement", fee_name: "Replacement Card Shipped via Express Mail", amount: "40.00", conditions: null },
    ], { 2536: "Replacement Card - Express Mail | $40.00", 15325: "Replacement Card Shipped via Express Mail | $40.00" });

    await runHamiltonCategoryGuard({ runId: 15, db: db as unknown as GuardDb });

    const restore = db.mock.calls.find((call) => templateText(call[0]).includes("rolled_back_at = NULL"));
    expect([restore?.[1], restore?.[2]]).toEqual([[350], ["rush_card"]]);
    expect(templateText(restore?.[0])).toContain("v.to_key <> fp.canonical_fee_key");
  });

  it("brings a takedown back only when it traces on its own stored text (guard v63, #1312)", async () => {
    const stop = (id: number, doc: number | null, name: string, amount: string) => ({
      fee_published_id: id, lineage_ref: id + 100000, institution_id: id, source_document_id: doc, canonical_fee_key: "stop_payment", fee_name: name, amount, conditions: null,
    });
    // The five stops on official and cashier's checks v63 passes (Oct 15): only 13389's own text states it.
    const rows = [
      stop(13389, 13654, "Stop Payment on Cashier's Checks, Official Checks and Money Orders (each)", "20.00"),
      stop(1120, null, "Official Check Stop Payment", "35.00"),
      stop(11233, null, "Stop Payment (Checks, ACH, Bill Pay, Cashier's Checks)", "18.00"),
      stop(11747, null, "Stop Payment - Cashier's Checks", "20.00"),
      stop(7924, 270, "Official Check Stop Payment", "15.00"),
    ];
    for (const row of rows) expect(restoreTarget({ ...row, document_nsf_amount: null }), String(row.fee_published_id)).toBe("stop_payment");
    const db = createDbMock([], rows, {
      13654: "Stop Payment via Internet (per item or range of items)        $10\nStop Payment on Cashier's Checks, Official Checks and Money Orders (each)          $20",
    });
    const result = await runHamiltonCategoryGuard({ runId: 25, db: db as unknown as GuardDb });
    expect(result.restoredFees).toBe(1);
    const restore = db.mock.calls.find((call) => templateText(call[0]).includes("rolled_back_at = NULL"));
    expect(restore?.[1]).toEqual([13389]);
    // A price the text does not state never comes back either.
    expect(tracesOnOwnText(rows[0], "stop_payment", new Map([[13654, "Stop Payment on Cashier's Checks | $25"]]))).toBe(false);
  });

  it("caps the rollbacks at the run limit", async () => {
    const db = createDbMock();

    const result = await runHamiltonCategoryGuard({ runId: 11, limit: 1, db: db as unknown as GuardDb });

    expect(result).toMatchObject({ failingFees: 2, rolledBackFees: 1 });
    expect(result.confirmedFeeIds).toHaveLength(1);
  });

  it("flags a small returned check filed as NSF beside the schedule's own NSF fee", async () => {
    const dean = { fee_published_id: 5, lineage_ref: 15, institution_id: 9, canonical_fee_key: "nsf", fee_name: "Returned Check Fee", amount: "7.00", document_nsf_amount: "35.00" };
    const db = vi.fn((strings: TemplateStringsArray) => {
      const text = templateText(strings);
      if (text.includes("to_regclass('public.pipeline_feedback')")) return Promise.resolve([{ ready: true }]);
      if (text.includes("FROM published_fee_records") && !text.includes("rolled_back_at IS NOT NULL")) return Promise.resolve([dean]);
      return Promise.resolve([]);
    });

    const result = await runHamiltonCategoryGuard({ runId: 9, dryRun: true, db: db as unknown as GuardDb });

    // First failure: logged for a second look, still live.
    expect(result).toMatchObject({ scannedFees: 1, flaggedFees: 1, rolledBackFees: 0, byCode: { schedule_contradicts: 1 } });
  });
});

describe("guard v70: card-product takedowns wait on CARD_PRODUCT_TAKEDOWN_LIVE", () => {
  const base = { conditions: null, document_nsf_amount: null };
  const cardRows = [
    { fee_published_id: 123627, lineage_ref: 1, institution_id: 6044, source_document_id: 34975, canonical_fee_key: "atm_non_network", fee_name: "ATM/Debit Card - Monthly Fee", amount: "1.00", ...base },
    { fee_published_id: 20339, lineage_ref: 2, institution_id: 6945, source_document_id: 1, canonical_fee_key: "dormant_account", fee_name: "Inactive Debit Card Per month", amount: "5.00", ...base },
    { fee_published_id: 147703, lineage_ref: 3, institution_id: 6056, source_document_id: 35395, canonical_fee_key: "atm_non_network", fee_name: "e-Pay (Bill Payer Service) without Checking and Debit/ATM Card", amount: "6.95", ...base },
  ];
  function cardDb() {
    return vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = templateText(strings);
      if (text.includes("to_regclass('public.pipeline_feedback')")) return Promise.resolve([{ ready: true }]);
      if (text.includes("FROM pipeline_feedback")) return Promise.resolve([]);
      if (text.includes("rolled_back_at IS NOT NULL")) return Promise.resolve([]);
      if (text.includes("FROM published_fee_records")) return Promise.resolve(cardRows);
      if (text.includes("UPDATE published_fee_records")) return Promise.resolve((values[1] as number[] ?? []).map((id) => ({ fee_published_id: id })));
      return Promise.resolve([]);
    });
  }

  it("holds a fee failing only the card-product rule while the switch is off, and not once it is on", () => {
    expect(heldByCardProductSwitch(cardRows[0], false)).toBe(true);
    expect(heldByCardProductSwitch(cardRows[1], false)).toBe(true);
    expect(heldByCardProductSwitch(cardRows[0], true)).toBe(false);
    // A fee another rule fails is never held by this switch.
    expect(heldByCardProductSwitch({ ...base, canonical_fee_key: "atm_non_network", fee_name: "ATM Dispute Fee", amount: "10.00" }, false)).toBe(false);
  });

  it("counts the held fees on a dry run, flags none of them and still re-files the bill payer service", async () => {
    const db = cardDb();
    const result = await runHamiltonCategoryGuard({ runId: 70, dryRun: true, db: db as unknown as GuardDb, cardProductTakedownLive: false });
    expect(result.cardProductPending).toBe(2);
    expect(result.cardProductPendingSamples.map((fee) => fee.feePublishedId)).toEqual([123627, 20339]);
    expect(result.failingFees).toBe(0);
    expect(result.flaggedFees).toBe(0);
    expect(restoreTarget(cardRows[2])).toBe("bill_pay");
  });

  it("flags them for the second look once the switch is on", async () => {
    const db = cardDb();
    const result = await runHamiltonCategoryGuard({ runId: 71, dryRun: true, db: db as unknown as GuardDb, cardProductTakedownLive: true });
    expect(result.cardProductPending).toBe(0);
    expect(result.flaggedFees).toBe(2);
  });

  it("re-files skipped loan payments and the early-closure card charge to their checked types", () => {
    expect(restoreTarget({ ...base, canonical_fee_key: "late_payment", fee_name: "Skip-A-Pay Fee", amount: "25.00" })).toBe("other_lending_fee");
    expect(restoreTarget({ ...base, canonical_fee_key: "loan_origination", fee_name: "Loan Extension (Skip-A-Pay)", amount: "25.00" })).toBe("other_lending_fee");
    expect(restoreTarget({ ...base, canonical_fee_key: "atm_non_network", fee_name: "Account Closure ATM/Debit Card - if account closed within 12 months", amount: "10.00" })).toBe("early_closure");
  });
});

describe("guard v87: a live box late fee re-files in place to safe_deposit_box (#1916)", () => {
  const advia = readFileSync(join(process.cwd(), "src/lib/custom-report/__fixtures__/advia-two-column-source.txt"), "utf8");
  const fee = (id: number, inst: number, doc: number, name: string, amount: string, key = "late_payment") => ({
    fee_published_id: id, lineage_ref: id + 100000, institution_id: inst, source_document_id: doc,
    canonical_fee_key: key, fee_name: name, amount, conditions: null, document_nsf_amount: null,
  });
  const loanText = "LOAN FEES\nLate Payment Fee | $25.00";

  it("moves Advia's box late fee (142240) with its own name and price, and leaves a loan's late fee", async () => {
    const box = fee(142240, 7288, 32751, "Late Payment (by credit union", "10.00");
    const loan = fee(500, 7288, 9, "Late Payment Fee", "25.00");
    const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = templateText(strings);
      if (text.includes("to_regclass('public.pipeline_feedback')")) return Promise.resolve([{ ready: true }]);
      if (text.includes("FROM agent_source_texts")) {
        return Promise.resolve([{ source_document_id: 32751, normalized_text: advia }, { source_document_id: 9, normalized_text: loanText }]);
      }
      if (text.includes("UPDATE published_fee_records") && text.includes("v.from_key")) {
        return Promise.resolve((values[0] as number[]).map((id, i) => ({ fee_published_id: id, lineage_ref: id + 100000, canonical_fee_key: (values[2] as string[])[i] })));
      }
      if (text.includes("rolled_back_at IS NOT NULL")) return Promise.resolve([]);
      if (text.includes("FROM published_fee_records")) return Promise.resolve([box, loan]);
      return Promise.resolve([]);
    });
    const result = await runHamiltonCategoryGuard({ runId: 85, db: db as unknown as GuardDb });
    expect(result).toMatchObject({ liveRefiledFees: 1, failingFees: 0, boxSectionReadFailed: false });
    const move = db.mock.calls.find((call) => templateText(call[0]).includes("v.from_key") && templateText(call[0]).includes("UPDATE"));
    expect([move?.[1], move?.[2], move?.[3], move?.[5]]).toEqual([[142240], ["late_payment"], ["safe_deposit_box"], ["true"]]);
    // Its twin is a live box fee at that price with its name or a late word; Advia's $10 key is not.
    expect(templateText(move?.[0])).toContain("AND (NOT v.late_box");
  });

  it("judges by name and line only when the stored text cannot be read", async () => {
    const box = fee(142240, 7288, 32751, "Late Payment (by credit union", "10.00");
    const db = vi.fn((strings: TemplateStringsArray) => {
      const text = templateText(strings);
      if (text.includes("FROM agent_source_texts")) return Promise.reject(new Error("timeout"));
      if (text.includes("rolled_back_at IS NOT NULL")) return Promise.resolve([]);
      if (text.includes("FROM published_fee_records")) return Promise.resolve([box]);
      return Promise.resolve([]);
    });
    const result = await runHamiltonCategoryGuard({ runId: 86, db: db as unknown as GuardDb });
    expect(result).toMatchObject({ liveRefiledFees: 0, failingFees: 0, boxSectionReadFailed: true });
  });

  it("keeps one box late fee per bank and price, but not a box key fee at that price", () => {
    const late = { row: fee(9785, 593, 1, "Late Fee: Late Payment Charge", "25.00"), to: "safe_deposit_box" };
    const copy = { row: fee(35992, 593, 2, "Late Fee: Late Payment Charge", "25.00"), to: "safe_deposit_box" };
    const key = { row: fee(77, 593, 1, "Replacement Key", "25.00", "card_replacement"), to: "safe_deposit_box" };
    expect(movesBoxLateFee(late)).toBe(true);
    expect(movesBoxLateFee(key)).toBe(false);
    expect(uniqueRefiles([late, copy]).map((r) => r.row.fee_published_id)).toEqual([9785]);
    const kept = uniqueRefiles([late, key]);
    expect(kept.map((r) => r.row.fee_published_id)).toEqual([9785, 77]);
    expect(lateBoxFlags(kept)).toEqual(["true", "false"]);
  });
});
