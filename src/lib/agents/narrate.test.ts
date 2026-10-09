import { describe, expect, it } from "vitest";
import { narrateEvent, narrateStepFinished } from "./narrate";

describe("narrateStepFinished", () => {
  it("names the cap that stopped a paid pass", () => {
    expect(narrateStepFinished("discover-paid", {
      processed: 29, succeeded: 6, cost_microusd: 1_370_000, budget_stopped: true,
      budget_reason: "Per-run spend cap agent:magellan (agent magellan) reached in run 3155: $1.37 used of $1.25 by magellan in this run; a new run starts at $0.",
    }, "KS")).toBe(
      "Paid pass to find fee schedules in KS: 6 of 29 succeeded for $1.37; then stopped: Per-run spend cap agent:magellan (agent magellan) reached in run 3155: $1.37 used of $1.25 by magellan in this run; a new run starts at $0.",
    );
    expect(narrateStepFinished("discover-paid", { processed: 2, succeeded: 1, cost_microusd: 0, budget_stopped: true }, "KS"))
      .toBe("Paid pass to find fee schedules in KS: 1 of 2 succeeded for $0.00; then stopped: a budget cap (which cap was not recorded).");
  });

  it("describes Magellan downloads with failures and skips", () => {
    expect(narrateStepFinished("fetch", {
      processed_institutions: 25, fetched_documents: 21, failed_fetches: 3, skipped_fetches: 1,
    }, "GA")).toBe("Downloaded 21 fee schedules in GA: 3 failed, 1 skipped.");
  });

  it("leads with new vs unchanged once Magellan stops re-downloading duplicates", () => {
    expect(narrateStepFinished("fetch", {
      processed_institutions: 25, fetched_documents: 3, unchanged_documents: 21, failed_fetches: 1, skipped_fetches: 0,
    }, "GA")).toBe("Checked 25 fee schedules in GA: 3 new, 21 unchanged, 1 failed.");
    expect(narrateStepFinished("fetch", {
      processed_institutions: 4, fetched_documents: 0, unchanged_documents: 4,
    }, "GA")).toBe("Checked 4 fee schedules in GA: 0 new, 4 unchanged.");
  });

  it("mentions inputs skipped because they already failed or were already done", () => {
    expect(narrateStepFinished("read", {
      processed_documents: 5, text_artifacts: 3, skipped_known_failures: 2,
    }, "TX")).toBe("Read 3 documents in TX: 2 skipped (failed before, unchanged since).");
    expect(narrateStepFinished("extract", {
      processed_text_artifacts: 4, inserted_raw_fee_observations: 40, skipped_known_inputs: 1,
    }, "TX")).toBe("Pulled 40 fees from 4 documents in TX: 1 documents already done.");
  });

  it("reports wrong pages, send-backs and vault use", () => {
    expect(narrateStepFinished("read", {
      processed_documents: 25, text_artifacts: 14, wrong_documents: 9, sent_back_to_magellan: 8, read_from_vault: 20,
    }, "GA")).toBe(
      "Read 14 documents in GA: 9 were not fee pages, 8 sent back to Magellan to find the real fee page, 20 read from our stored copy.",
    );
    expect(narrateStepFinished("read", { processed_documents: 0, wrong_documents: 12, sent_back_to_magellan: 10 }, "TX"))
      .toBe("Re-checked earlier pages in TX: 12 pages not a fee schedule, 10 sent back to Magellan.");
    expect(narrateStepFinished("fetch", {
      processed_institutions: 5, fetched_documents: 2, unchanged_documents: 3, stored_documents: 4,
    }, "GA")).toBe("Checked 5 fee schedules in GA: 2 new, 3 unchanged, 4 saved to the vault.");
  });

  it("mentions the index refresh after a publish", () => {
    expect(narrateStepFinished("publish", {
      processed_verified_fees: 20, published_fees: 18, index_refreshed: true, index_categories: 49,
    }, "GA")).toBe("Published 18 fees in GA: index refreshed (49 categories).");
  });

  it("describes discovery results", () => {
    expect(narrateStepFinished("discover", {
      processed_institutions: 25, discovered_fee_urls: 7, retry_after: 2, dead_institutions: 1, needs_human: 0,
    }, null)).toBe(
      "Searched 25 websites across all states and found 7 fee schedules: 2 to retry later, 1 with no schedule found.",
    );
  });

  it("describes reads, including scans that need OCR", () => {
    expect(narrateStepFinished("read", {
      processed_documents: 10, text_artifacts: 8, needs_ocr: 2, failed_reads: 0, empty_documents: 0,
    }, "TX")).toBe("Read 8 documents in TX: 2 are scans that need OCR.");
  });

  it("describes Knox, Darwin and Hamilton work", () => {
    expect(narrateStepFinished("extract", {
      processed_text_artifacts: 18, inserted_raw_fee_observations: 312, skipped_fee_candidates: 9,
    }, "GA")).toBe("Pulled 312 fees from 18 documents in GA: 9 lines set aside.");
    expect(narrateStepFinished("classify", {
      processed_raw_fees: 100, verified_fee_observations: 91, skipped_raw_fees: 9,
    }, "GA")).toBe("Verified 91 fees of 100 checked in GA: 9 not verified.");
    expect(narrateStepFinished("verify", {
      processed_raw_fees: 10, verified_fee_observations: 8, verified_free_fees: 2, skipped_raw_fees: 2,
    }, "GA")).toBe("Verified 8 fees of 10 checked in GA: 2 of them free ($0), 2 not verified.");
    expect(narrateStepFinished("publish", {
      processed_verified_fees: 91, published_fees: 1, skipped_verified_fees: 90,
    }, "GA")).toBe("Published 1 fee in GA: 90 already published or not eligible.");
    expect(narrateStepFinished("publish", {
      processed_verified_fees: 5, published_fees: 3, superseded_fees: 1, published_free_fees: 1, skipped_verified_fees: 2,
    }, "GA")).toBe("Published 3 fees in GA: 1 replaced an older price, 1 free ($0), 2 already published or not eligible.");
  });

  it("says plainly when there was nothing to do", () => {
    expect(narrateStepFinished("fetch", { processed_institutions: 0 }, "WY"))
      .toBe("Checked fee schedules in WY; none were due for a refresh.");
    expect(narrateStepFinished("publish", { processed_verified_fees: 0 }, null))
      .toBe("Had nothing new to publish across all states.");
  });

  it("stays quiet for bookkeeping steps and unknown keys", () => {
    expect(narrateStepFinished("public-cluster", {}, "GA")).toBeNull();
    expect(narrateStepFinished("mystery", {}, "GA")).toBeNull();
  });
});

describe("narrateEvent", () => {
  const base = { status: "completed", message: "", detail: {}, stepKey: null, stateCode: null };

  it("explains failures, reaps and blocks in plain words", () => {
    expect(narrateEvent({ ...base, eventType: "step.failed", stepKey: "read", message: "timeout after 20s" }))
      .toBe('Stopped with an error while working on "read": timeout after 20s');
    expect(narrateEvent({ ...base, eventType: "step.reaped" })).toBe("A step got stuck, so it was restarted.");
    expect(narrateEvent({ ...base, eventType: "step.dead" })).toContain("needs a look");
    expect(narrateEvent({ ...base, eventType: "run.completed", stateCode: "GA" })).toBe("Finished the GA run.");
  });

  it("ignores step.started noise", () => {
    expect(narrateEvent({ ...base, eventType: "step.started" })).toBeNull();
  });
});
