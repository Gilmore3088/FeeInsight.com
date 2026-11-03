import { describe, expect, it } from "vitest";
import { findProductSplits, productSplitDetail, type ProductSplitPairRow } from "./product-split-check";

const URL = "https://www.mutualone.example/disclosures/fee-schedule-business/";
const TEXT = ["Commercial Checking", "Monthly Service Charge | $12.00", "Free Business Checking Plus", "Monthly Service Charge | None",
  "Personal:", "Stop Payment | $30.00", "Business:", "Stop Payment | $30.00"].join("\n");

const pair = (over: Partial<ProductSplitPairRow>): ProductSplitPairRow => ({
  institution_id: 882, canonical_fee_key: "monthly_maintenance", amount: 0,
  older_id: 73214, older_verified_id: 1, older_name: "Monthly Service Charge", older_product: null, older_frequency: "monthly",
  older_document_id: 40689, older_url: URL, older_stream: null, older_crawled_at: "2026-06-01T00:00:00Z", older_excerpt: "Monthly Service Charge | None",
  newer_id: 900001, newer_verified_id: 2, newer_name: "Monthly Service Charge", newer_product: "Free Business Checking Plus", newer_frequency: "monthly",
  newer_document_id: 41984, newer_url: URL, newer_stream: null, newer_crawled_at: "2026-11-01T00:00:00Z", newer_excerpt: "Monthly Service Charge | None",
  ...over,
});

describe("Darwin's product-split re-check", () => {
  it("takes down the older copy's row when the current copy's re-read names the line's heading (MutualOne #73214)", () => {
    const found = findProductSplits([pair({})], new Map([["41984", TEXT]]));
    expect(found.matches.map((match) => [match.feePublishedId, match.keptFeePublishedId, match.reason])).toEqual([[73214, 900001, "same_line_duplicate: live fee #900001"]]);
    expect(found.passing).toEqual([900001]);
  });

  it("keeps the live row whose product heads the line and takes the re-read down", () => {
    const found = findProductSplits([pair({ older_product: "Free Business Checking Plus", newer_product: null })], new Map([["41984", TEXT]]));
    expect(found.matches.map((match) => [match.feePublishedId, match.keptFeePublishedId])).toEqual([[900001, 73214]]);
  });

  it("judges nothing without the newer document's text, and leaves a line printed twice", () => {
    expect(findProductSplits([pair({})], new Map()).matched).toBe(0);
    const twice = pair({ canonical_fee_key: "stop_payment", amount: 30, older_excerpt: "Stop Payment | $30.00", newer_excerpt: "Stop Payment | $30.00" });
    expect(findProductSplits([twice], new Map([["41984", TEXT]])).matched).toBe(0);
  });

  it("never keeps a fee behind one the same pass takes down", () => {
    // Pair one: 1 (no product) would come down behind 2 ("Commercial Checking"). Pair two, on one
    // document: 2 comes down behind 3, whose "Free Business Checking Plus" heads the line nearer.
    // 1 is left for the next pass instead of being kept behind a fee that is going.
    const one = pair({ older_id: 1, newer_id: 2, older_product: null, newer_product: "Commercial Checking" });
    const two = pair({ older_id: 2, newer_id: 3, older_product: "Commercial Checking", newer_product: "Free Business Checking Plus",
      older_document_id: 41984, newer_document_id: 41984, older_crawled_at: "2026-11-01T00:00:00Z" });
    const found = findProductSplits([one, two], new Map([["41984", TEXT]]));
    expect(found.matches.map((match) => [match.feePublishedId, match.keptFeePublishedId])).toEqual([[2, 3]]);
    expect(found.passing.sort()).toEqual([1, 3]);
    const detail = productSplitDetail({ ...found, live: false, dryRun: true, flagged: 0, waiting: 0, cleared: 0, takenDown: [] });
    expect(detail).toMatchObject({ check: "darwin.product_split", switch_live: false, matched: 1 });
  });
});
