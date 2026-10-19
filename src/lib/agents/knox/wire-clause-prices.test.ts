// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runFreeSpecialists } from "./specialists";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { checkWireClausePrice, domesticWireClausePrices, wireClausePrices } from "@/lib/custom-report/wire-clause-prices";
import { institutionValue } from "@/lib/data-store/fee-stats";
import { groundPaidRow } from "./paid-extract";

const family = JSON.parse(readFileSync(new URL("./__fixtures__/family-wire-inline-directions.json", import.meta.url), "utf8"));
const newHeights = "Wire Out/Wire In | $15.00 Per Transaction Outgoing/$5 Per Transaction Incoming";
const newHeightsSource = JSON.parse(readFileSync(new URL("./__fixtures__/new-heights-wire-inline-directions.json", import.meta.url), "utf8"));

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

  it("does not let a paid source-line fallback override an explicit own-direction refusal", () => {
    const sourceLine = family.normalizedText.split("\n").find((line: string) => line.includes("$10.00 on Incoming Wires"));
    const row = { fee_name: "Incoming Wires", canonical_key: "wire_domestic_incoming", source_line: sourceLine };
    expect(groundPaidRow({ ...row, amount: 10 }, family.normalizedText)).toMatchObject({ amount: 10 });
    expect(groundPaidRow({ ...row, amount: 20 }, family.normalizedText)).toBe("not_in_text");
    expect(groundPaidRow({ ...row, amount: 10, canonical_key: "wire_domestic_outgoing" }, family.normalizedText)).toBe("not_in_text");
  });

  it("retains both actual slash-joined directions from the #2021 source row", () => {
    expect(createHash("sha256").update(newHeightsSource.normalizedText).digest("hex")).toBe(newHeightsSource.textSHA256);
    for (const text of [newHeights, newHeightsSource.normalizedText]) {
      const rows = runFreeSpecialists(text).candidates;
      expect(rows.some(row => row.canonicalHint === "wire_domestic_outgoing" && row.amount === 15)).toBe(true);
      expect(rows.some(row => row.canonicalHint === "wire_domestic_incoming" && row.amount === 5)).toBe(true);
      expect(checkFeeAgainstSource(text, "Wire In", 5, ".", "wire_domestic_incoming").ok).toBe(true);
      expect(checkFeeAgainstSource(text, "Wire Out", 15, ".", "wire_domestic_outgoing").ok).toBe(true);
    }
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

  it("does not select an unscoped domestic tier over another ordinary same-direction price", () => {
    const pair = "Wire Transfer Fee | $10 on Incoming Wires / $20 on Outgoing Domestic";
    for (const ordinary of [
      "Incoming Wires | $12 per wire",
      "Domestic incoming wire transfer | $12",
      "Wire Transfer Fees\nIncoming | $12 per wire",
      "Outgoing Domestic Wire Transfer | $25",
      "Wire Transfer Fee | $12 on Incoming Wires / $25 on Outgoing Domestic",
    ]) {
      for (const text of [pair + "\n" + ordinary, ordinary + "\n" + pair]) {
        expect(domesticWireClausePrices(text)).toEqual([]);
        expect(checkWireClausePrice(text, "Incoming Wires", 10, "wire_domestic_incoming", ".")).toBeNull();
        expect(runFreeSpecialists(text).candidates.some(row => row.ownedPolicy && row.canonicalHint.startsWith("wire_"))).toBe(false);
      }
    }
  });

  it("rejects unsupported price syntax, units and direction ambiguity without inventing a price", () => {
    for (const text of [
      "Wire Transfer Fee | $10 on Incoming Wires / $20-$25 on Outgoing Domestic",
      "Wire Transfer Fee | $10 on Incoming Wires / $20 on Outgoing Domestic if under age18",
      "Wire Transfer Fee | $10 on Incoming Wires / $20 per month on Outgoing Domestic",
      "Wire Transfer Fee | $10 on Incoming Outgoing / $20 on Outgoing Domestic",
      "Wire Transfer Fee | $0 on Incoming Wires / $20 on Outgoing Domestic",
      "International Wire Transfer Fee | $10 on Incoming Domestic / $20 on Outgoing Domestic",
    ]) expect(wireClausePrices(text), text).toEqual([]);
  });

  it("also declines conflicting ordinary In/Out aliases supported by the paired header", () => {
    for (const ordinary of [
      "Wire In | $10.00",
      "Wire Out | $30.00",
      "Wire Transfer Fee In | $10.00",
      "Wire Transfer Fee Out | $30.00",
      "Wire Fees\nIn | $10.00",
      "Wire Fees\nOut | $30.00",
    ]) {
      for (const text of [newHeights + "\n" + ordinary, ordinary + "\n" + newHeights]) {
        expect(domesticWireClausePrices(text), text).toEqual([]);
        expect(checkWireClausePrice(text, "Wire In", 5, "wire_domestic_incoming", ".")).toBeNull();
        expect(checkWireClausePrice(text, "Wire Out", 15, "wire_domestic_outgoing", ".")).toBeNull();
        expect(runFreeSpecialists(text).candidates.some(row => row.ownedPolicy && row.canonicalHint.startsWith("wire_"))).toBe(false);
      }
    }
  });

  it("does not turn an age or account section's literal pair into new standard-tier authority", () => {
    const first = "Wire Transfer Fee | $5 on Incoming Wires / $10 on Outgoing Domestic";
    const second = "Wire In/Wire Out | $5 Per Transaction Incoming/$10 Per Transaction Outgoing";
    for (const heading of ["Youth Checking (ages18andunder)", "Senior Accounts", "Student Fees", "Business Wire Fees", "Commercial Wire Services"]) {
      const text = heading + "\n" + first + "\nOther services\n" + second;
      expect(domesticWireClausePrices(text)).toEqual([]);
      expect(checkWireClausePrice(text, "Incoming Wires", 5, "wire_domestic_incoming", ".")).toBeNull();
      expect(domesticWireClausePrices(text + "\nGeneral Fees\n" + first)).toHaveLength(2);
    }
  });
});
