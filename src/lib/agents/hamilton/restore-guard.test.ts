import { describe, expect, it } from "vitest";

import { trainCategoryModel } from "@/lib/agents/darwin/category-model";

import { disputedRestoreVerdict, statesPriceOnItsOwnRow, statesRefundableDeposit } from "./restore-guard";

const MODEL = trainCategoryModel([
  { name: "Outgoing domestic wire transfer", categoryKey: "wire_domestic_outgoing", count: 40 },
  { name: "Outgoing domestic wires", categoryKey: "wire_domestic_outgoing", count: 30 },
  { name: "Incoming wire transfer", categoryKey: "wire_domestic_incoming", count: 30 },
  { name: "Stop payment fee", categoryKey: "stop_payment", count: 50 },
  { name: "Stop payment request", categoryKey: "stop_payment", count: 20 },
  { name: "Cash advance fee", categoryKey: "cash_advance", count: 20 },
  { name: "Credit card cash advance", categoryKey: "cash_advance", count: 20 },
  { name: "Safe deposit box size 10x10", categoryKey: "safe_deposit_box", count: 30 },
  { name: "Box size 5x10", categoryKey: "safe_deposit_box", count: 30 },
  { name: "Copy of check", categoryKey: "document_reproduction", count: 20 },
  { name: "Money order", categoryKey: "money_order", count: 30 },
]);

const WIRES = "Stop Payment Fee | $25.00 per item\n\nOutgoing Domestic Wires | $20.00 Per wire\n\nDraft Photocopy Request Fee | $2.50 per copy";

describe("statesPriceOnItsOwnRow", () => {
  it("accepts a fee whose row carries its price", () => {
    expect(statesPriceOnItsOwnRow(WIRES, "Outgoing Domestic Wires", 20)).toBe(true);
  });

  it("accepts a schedule printed name over price", () => {
    expect(statesPriceOnItsOwnRow("Credit Card Replacement\n\n$8.00\n\nOther Accounts", "Credit Card Replacement", 8)).toBe(true);
  });

  it("rejects a price that ends the row before the name", () => {
    expect(statesPriceOnItsOwnRow("Limit $120 per occurrence) ...... $12^ Stop Payment Fee (Per item) ......", "^ Stop Payment Fee (Per item)", 12)).toBe(false);
  });

  it("rejects a price from another cell's row", () => {
    expect(statesPriceOnItsOwnRow("Expedited | Cashier's Check Issuance: | Statement Prints (each) | $5.00", "Cashier's Check Issuance:", 5)).toBe(false);
  });

  it("rejects a row with a second price", () => {
    expect(statesPriceOnItsOwnRow("Member Check Cashing $3 to $5 per check", "Member Check Cashing", 3)).toBe(false);
  });
});

describe("statesRefundableDeposit", () => {
  it("spots a refundable key deposit but not a non-refundable bag", () => {
    expect(statesRefundableDeposit("Night Depository access key is $2.00 refundable", "Night Depository access key")).toBe(true);
    expect(statesRefundableDeposit("Night deposit bag (non-refundable) | $40.00", "Night deposit bag")).toBe(false);
  });
});

describe("disputedRestoreVerdict", () => {
  const wire = { feeName: "Outgoing Domestic Wires", amount: 20, canonicalFeeKey: "wire_domestic_outgoing" };

  it("restores a fee that passes the second look and the model agrees with", () => {
    expect(disputedRestoreVerdict(WIRES, wire, MODEL)).toEqual({ restore: true });
  });

  it("restores nothing without the category model", () => {
    expect(disputedRestoreVerdict(WIRES, wire, null)).toEqual({ restore: false, reason: "no_category_model" });
  });

  it("keeps down a fee the model files elsewhere", () => {
    const verdict = disputedRestoreVerdict(WIRES, { ...wire, canonicalFeeKey: "wire_domestic_incoming" }, MODEL);
    expect(verdict.restore).toBe(false);
  });

  it("keeps down $0 rows, markups, cut-off sentences and copies of items", () => {
    expect(disputedRestoreVerdict(WIRES, { ...wire, amount: 0 }, MODEL)).toMatchObject({ reason: "zero_amount" });
    expect(disputedRestoreVerdict("UPS Fee + $1", { feeName: "UPS Fee +", amount: 1, canonicalFeeKey: "wire_domestic_outgoing" }, MODEL)).toMatchObject({ reason: "markup_on_cost" });
    expect(disputedRestoreVerdict("3 Receive a discount of $10 off", { feeName: "3 Receive a discount of", amount: 10, canonicalFeeKey: "safe_deposit_box" }, MODEL)).toMatchObject({ reason: "name_cut_before_figure" });
    expect(disputedRestoreVerdict("Copy of Money Order check | $5.00", { feeName: "Copy of Money Order check", amount: 5, canonicalFeeKey: "money_order" }, MODEL)).toMatchObject({ reason: "copy_of_item" });
  });

  it("keeps down a joined name whose later cell is another table's", () => {
    const text = "Credit card cash advance | Size 10x10 $90/year Both Keys Lost $75.00";
    const verdict = disputedRestoreVerdict(text, { feeName: "Credit card cash advance | Size 10x10", amount: 90, canonicalFeeKey: "cash_advance" }, MODEL);
    expect(verdict.restore).toBe(false);
  });

  it("keeps down a fee whose name does not trace in its own text", () => {
    expect(disputedRestoreVerdict("Stop Payment Fee | $25.00", wire, MODEL)).toMatchObject({ restore: false });
  });
});
