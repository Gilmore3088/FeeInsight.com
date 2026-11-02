import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { findRereadCategoryMoves, type RereadCategoryRow } from "@/lib/agents/darwin/reread-category-check";
import { judgeLiveNameRefresh, type LiveNameRefreshRow } from "@/lib/agents/hamilton/live-name-refresh";
import { publishedFeeName } from "@/lib/agents/hamilton/publish";
import { forLiveRelabel, HELD_VOCABULARY_RELABEL_LIVE } from "./held-name-vocabulary";
import { planLiveRetidy } from "./name-retidy";
import { decideRereads, toRereadRequest } from "./reread-feedback";
import { classifyFeeText } from "./rules";
import { runFreeSpecialists } from "./specialists";

/**
 * `HELD_VOCABULARY_RELABEL_LIVE` (v157, off): each of the five paths that change a fee already live
 * reads as main does while it is off, and would use the vocabulary only once it is switched on.
 */
const SKIP_TEXT = ["Loan Services", "Year round skip-a-loan-payment $20.00 request"].join("\n");
const FRAGMENT = "Year round skip-a-loan";

describe("HELD_VOCABULARY_RELABEL_LIVE is off and its paths read as main", () => {
  it("is off", () => {
    expect(HELD_VOCABULARY_RELABEL_LIVE).toBe(false);
  });

  it("reads without the vocabulary inside a gated path, with it outside (extract, publish, rules re-check)", () => {
    expect(forLiveRelabel(() => classifyFeeText("Skip-a-Loan payment"))).toBeNull();
    expect(forLiveRelabel(() => classifyFeeText("Skip-a-Loan payment"), true)).toBe("other_lending_fee");
    expect(classifyFeeText("Skip-a-Loan payment")).toBe("other_lending_fee");
  });

  it("1. Darwin's re-read category check leaves a live late fee on a skipped payment's line alone", () => {
    const live: RereadCategoryRow = {
      fee_published_id: 501, fee_verified_id: 511, institution_id: 7114, fee_name: FRAGMENT, amount: "20.00", canonical_fee_key: "late_payment",
      source_document_id: 9001, fragment_name: FRAGMENT, document_text_id: 9101, normalized_text: SKIP_TEXT, same_amount: [],
    };
    expect(findRereadCategoryMoves([live]).verdicts[0].outcome).toBe("not_found");
    const switchedOn = findRereadCategoryMoves([live], (t) => forLiveRelabel(() => runFreeSpecialists(t), true).candidates).verdicts[0];
    expect(switchedOn).toMatchObject({ outcome: "refile", newKey: "other_lending_fee" });
  });

  it("2. Knox's re-read of Darwin's requests settles nothing new for that fee", () => {
    const request = toRereadRequest({
      request_id: 1, institution_id: 7114, source_document_id: 9001, fee_raw_id: 11, fee_published_id: 501, canonical_fee_key: "late_payment",
      amount: "20.00", evidence: { kept_live: true, fee_name: FRAGMENT }, raw_fee_name: FRAGMENT, live_fee_name: FRAGMENT,
      live_rolled_back: false, document_text_id: 9101, text_hash: null, source_url: null,
    });
    const texts = new Map([[9101, SKIP_TEXT]]);
    expect(decideRereads([request], texts)[0].decision.outcome).toBe("not_found");
    expect(decideRereads([request], texts, { live: true })[0].decision.outcome).toBe("other_category");
  });

  it("3. the live name re-tidy keeps a title fee's described name", () => {
    const name = "Title Fee: charged for each vehicle title that we file with the state when you finance a car";
    const fee = { fee_published_id: 1, lineage_ref: 1, fee_raw_id: 1, institution_id: 7, source: "knox", source_document_id: 70, canonical_fee_key: "vehicle_title", fee_name: name, amount: 18 };
    const texts = [{ source_document_id: 70, normalized_text: `${name} $18.00` }];
    expect(planLiveRetidy([fee], texts).renames).toEqual([]);
    expect(planLiveRetidy([fee], texts, [fee], new Map(), true).renames.map((r) => r.newName)).toEqual(["Title Fee"]);
  });

  it("4. Hamilton's live name refresh names a re-read as main's publish does", () => {
    // Publish outside the gate (a new fee) cuts the heading; the refresh of a live fee does not.
    expect(publishedFeeName("(Per vehicle): Title Fee", "vehicle_title")).toBe("Title Fee");
    expect(forLiveRelabel(() => publishedFeeName("(Per vehicle): Title Fee", "vehicle_title"))).toBe("(Per vehicle): Title Fee");
    const row: LiveNameRefreshRow = {
      fee_published_id: 601, fee_verified_id: 611, institution_id: 7, fee_name: "(Per vehicle)", canonical_fee_key: "vehicle_title", amount: "18.00",
      frequency: null, source_document_id: 70, live_excerpt: "(Per vehicle): Title Fee $18.00", reread_raw_id: 12, reread_verified_id: 13,
      reread_name: "(Per vehicle): Title Fee", reread_key: "vehicle_title", reread_frequency: null, reread_excerpt: "(Per vehicle): Title Fee $18.00",
      document_text_id: 71, normalized_text: "Loan Fees\n(Per vehicle): Title Fee $18.00", same_amount: [],
    };
    expect(judgeLiveNameRefresh(row).newName).toBe("(Per vehicle): Title Fee");
  });

  it("5. Darwin's overdraft-transfer and protection-item re-files read their texts inside the gate", () => {
    for (const file of ["src/lib/agents/darwin/od-transfer-refile-check.ts", "src/lib/agents/darwin/protection-item-refile-check.ts"]) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      const reads = source.match(/runFreeSpecialists\(/g) ?? [];
      const gated = source.match(/forLiveRelabel\(\(\) => runFreeSpecialists\(/g) ?? [];
      expect(reads.length, file).toBeGreaterThan(0);
      expect(gated.length, file).toBe(reads.length);
    }
  });
});
