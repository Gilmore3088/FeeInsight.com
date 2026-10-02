import { describe, expect, it } from "vitest";
import { narrateEvent, narrateStepFinished } from "./narrate";

describe("narrateStepFinished", () => {
  it("describes Magellan downloads with failures and skips", () => {
    expect(narrateStepFinished("fetch", {
      processed_institutions: 25, fetched_documents: 21, failed_fetches: 3, skipped_fetches: 1,
    }, "GA")).toBe("Downloaded 21 fee schedules in GA: 3 failed, 1 skipped.");
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
    }, "GA")).toBe("Verified 91 fees of 100 checked in GA: 9 held for review.");
    expect(narrateStepFinished("publish", {
      processed_verified_fees: 91, published_fees: 1, skipped_verified_fees: 90,
    }, "GA")).toBe("Published 1 fee in GA: 90 already published or not eligible.");
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
