import { describe, expect, it } from "vitest";

import docs from "@/lib/agents/knox/__fixtures__/cut-cents-docs-2026-10-15.json";
import { runFreeSpecialists } from "@/lib/agents/knox/specialists";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { reproducibleReads, feeKey } from "./rules-recheck";
import { decidePriorFee, type PriorPublishedFeeRow, type VerifiedFeeRow } from "./publish";
import { HAND_AMOUNT_CORRECTIONS } from "./hand-amount-corrections";

/**
 * #1334, the whole free extract path on the two stored texts (hashes match `text_hash`): the
 * specialists, Knox's self-check (`checkFeeAgainstSource` inside `runFreeSpecialists`) and the
 * rules re-check's reads. #1310 fixed only the rules pass; this proves the chosen candidates.
 */
const xplore = docs["12872"].text;
const members = docs["13851"].text;

function chosen(text: string, name: string) {
  return runFreeSpecialists(text).candidates.filter((fee) => fee.feeName.toLowerCase() === name.toLowerCase());
}

// The full free extract runs every specialist on 7 stored texts; under CI load it can pass 5 s.
describe("cut-cents fees through the full free extract (#1334)", { timeout: 20_000 }, () => {
  it("chooses $29.95 for Xplore's Loan Skip A Pay Fee and $1.50 for Members 1st's ATM transactions", () => {
    expect(chosen(xplore, "Loan Skip A Pay Fee").map((fee) => fee.amount)).toEqual([29.95]);
    expect(chosen(members, "ATM Transactions (per item)").map((fee) => fee.amount)).toEqual([1.5]);
    // No candidate at the cut amounts.
    expect(runFreeSpecialists(xplore).candidates.some((fee) => /skip a pay/i.test(fee.feeName) && fee.amount === 29)).toBe(false);
    expect(runFreeSpecialists(members).candidates.some((fee) => /atm transactions/i.test(fee.feeName) && fee.amount === 1)).toBe(false);
  });

  it("on all eight documents the full extract reads the corrected price and never the cut one", () => {
    for (const fix of HAND_AMOUNT_CORRECTIONS) {
      const text = (docs as unknown as Record<string, { text: string }>)[String(fix.sourceDocumentId)].text;
      const reads = runFreeSpecialists(text).candidates.filter((fee) => fee.canonicalHint === fix.canonicalFeeKey && fee.feeName.toLowerCase() === fix.feeName.toLowerCase());
      expect(reads.map((fee) => fee.amount), String(fix.feePublishedId)).toContain(fix.to);
      expect(reads.map((fee) => fee.amount), String(fix.feePublishedId)).not.toContain(fix.from);
    }
  });

  it("the rules re-check reads the corrected prices and not the cut ones", () => {
    const xploreReads = reproducibleReads(xplore);
    expect(xploreReads.get(feeKey("other_lending_fee", 29.95))).toContain("loan skip a pay fee");
    expect(xploreReads.get(feeKey("other_lending_fee", 29))).toBeUndefined();
    const memberReads = reproducibleReads(members);
    expect(memberReads.get(feeKey("atm_non_network", 1.5))).toContain("atm transactions (per item)");
    expect(memberReads.get(feeKey("atm_non_network", 1))).toBeUndefined();
  });

  it("the shared check traces each correction on its own document and no longer traces the cut amount", () => {
    for (const fix of HAND_AMOUNT_CORRECTIONS.filter((entry) => entry.sourceDocumentId === 12872 || entry.sourceDocumentId === 13851)) {
      const text = fix.sourceDocumentId === 12872 ? xplore : members;
      expect(checkFeeAgainstSource(text, fix.feeName, fix.to, ".", fix.canonicalFeeKey).ok).toBe(true);
      expect(checkFeeAgainstSource(text, fix.feeName, fix.from, ".", fix.canonicalFeeKey).ok).toBe(false);
    }
  });

  it("the v67 re-read lands as identical to the corrected live row, so no second price is published", () => {
    const corrected = (id: number, doc: number, name: string, amount: number, key: string): PriorPublishedFeeRow => ({
      fee_published_id: id, canonical_fee_key: key, fee_name: name, amount, source_document_id: doc,
      document_crawled_at: "2026-10-01T00:00:00Z", document_stream: null, document_url: null,
    } as unknown as PriorPublishedFeeRow);
    const reread = (doc: number, name: string, amount: number, key: string): VerifiedFeeRow => ({
      fee_verified_id: 999_001, canonical_fee_key: key, fee_name: name, amount, source_document_id: doc,
      document_crawled_at: "2026-10-01T00:00:00Z", document_stream: null, document_url: null,
    } as unknown as VerifiedFeeRow);
    const skip = chosen(xplore, "Loan Skip A Pay Fee")[0];
    expect(decidePriorFee(reread(12872, skip.feeName, skip.amount, "other_lending_fee"), [corrected(49175, 12872, "Loan Skip A Pay Fee", 29.95, "other_lending_fee")]).kind).toBe("identical");
    const atm = chosen(members, "ATM Transactions (per item)")[0];
    expect(decidePriorFee(reread(13851, atm.feeName, atm.amount, "atm_non_network"), [corrected(29166, 13851, "ATM Transactions (per item)", 1.5, "atm_non_network")]).kind).toBe("identical");
  });
});
