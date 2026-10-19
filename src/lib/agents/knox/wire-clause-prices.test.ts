// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runFreeSpecialists } from "./specialists";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { checkWireClausePrice, wireClausePrices } from "@/lib/custom-report/wire-clause-prices";
import { institutionValue } from "@/lib/data-store/fee-stats";

const family = JSON.parse(readFileSync(new URL("./__fixtures__/family-wire-inline-directions.json", import.meta.url), "utf8"));
const newHeights = "Wire Out/Wire In | $15.00 Per Transaction Outgoing/$5 Per Transaction Incoming";

describe("own post-price wire directions (#2021)", () => {
  it("keeps Family's hash-bound incoming10 and outgoing20 with their own inline direction", () => {
    expect(createHash("sha256").update(family.normalizedText).digest("hex")).toBe(family.textSHA256);
    const rows = runFreeSpecialists(family.normalizedText).candidates;
    expect(rows.some(row => row.canonicalHint === "wire_domestic_incoming" && row.amount === 10)).toBe(true);
    expect(rows.some(row => row.canonicalHint === "wire_domestic_outgoing" && row.amount === 20)).toBe(true);
    expect(rows.some(row => row.canonicalHint === "wire_domestic_incoming" && row.amount === 20)).toBe(false);
  });

  it("uses the same bounded own price in the shared live checker", () => {
    expect(checkFeeAgainstSource(family.normalizedText, "Incoming Wires", 10, ".", "wire_domestic_incoming").ok).toBe(true);
    expect(checkFeeAgainstSource(family.normalizedText, "Incoming Wires", 20, ".", "wire_domestic_incoming").ok).toBe(false);
  });

  it("retains both actual slash-joined directions from the #2021 source row", () => {
    const rows = runFreeSpecialists(newHeights).candidates;
    expect(rows.some(row => row.canonicalHint === "wire_domestic_outgoing" && row.amount === 15)).toBe(true);
    expect(rows.some(row => row.canonicalHint === "wire_domestic_incoming" && row.amount === 5)).toBe(true);
  });

  it("leaves Family's unresolved international35/45 scope outside new admission authority", () => {
    const rows = runFreeSpecialists(family.normalizedText).candidates;
    expect(rows.filter(row => row.canonicalHint === "wire_intl_outgoing").map(row => row.amount)).toEqual([35]);
    expect(rows.some(row => row.amount === 45)).toBe(false);
    expect(checkWireClausePrice(family.normalizedText, "International Wire Transfer Fee", 35, "wire_intl_outgoing", ".")).toBeNull();
    expect(checkFeeAgainstSource(family.normalizedText, "International Wire Transfer Fee", 35, ".", "wire_intl_outgoing").ok).toBe(true);
    expect(wireClausePrices(family.normalizedText).some(row => row.canonicalKey === "wire_intl_outgoing" && row.amount === 45)).toBe(true);
    // One retained international price cannot create a synthetic40 midpoint.
    const international = rows.filter(row => row.canonicalHint === "wire_intl_outgoing").map(row => row.amount);
    expect(institutionValue("wire_intl_outgoing", international)).toBe(35);
  });

  it("keeps an exact same-name ordinary price in another table regardless of order", () => {
    const inline = "Wire Transfer Fee | $10 on Incoming Wires / $20 on Outgoing Domestic";
    const ordinary = "Incoming Wires | $20 per wire";
    for (const text of [inline + "\n" + ordinary, ordinary + "\n" + inline]) {
      expect(checkWireClausePrice(text, "Incoming Wires", 20, "wire_domestic_incoming", ".")).toBeNull();
      expect(checkFeeAgainstSource(text, "Incoming Wires", 20, ".", "wire_domestic_incoming").ok).toBe(true);
    }
  });

  it("binds the canonical direction even for a loose category pattern", () => {
    expect(checkWireClausePrice(family.normalizedText, "Incoming Wires", 10, "wire_domestic_outgoing", ".")).toEqual({ ok: false, reason: "category_not_in_text" });
    for (const category of ["document_reproduction", "overdraft", "wire_intl_incoming", "wire_intl_outgoing"]) {
      expect(checkWireClausePrice(family.normalizedText, "Incoming Wires", 10, category, ".")).toBeNull();
    }
    expect(checkWireClausePrice(family.normalizedText, "Incoming Wires", 10, "wire_domestic_incoming", "\\mincoming\\M")?.ok).toBe(true);
    expect(checkWireClausePrice(family.normalizedText, "Incoming Wires", 10, "wire_domestic_incoming", "notary")).not.toMatchObject({ ok: true });
  });
});
