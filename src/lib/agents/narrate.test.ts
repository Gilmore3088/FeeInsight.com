import { describe, expect, it } from "vitest";
import { narrateEvent, narrateStepFinished } from "./narrate";
import { verifiedRecheckReceipt } from "./darwin/verified-recheck-receipt";

describe("narrateStepFinished", () => {
  it("independently discloses unknown returned-response costs without calling them zero", () => {
    expect(narrateStepFinished("read-paid", { processed: 2, succeeded: 1, cost_microusd: 220, unknown_cost_responses: 1 }))
      .toContain("$0.00 in known estimates; cost unavailable for 1 returned response");
    expect(narrateStepFinished("read-paid", { processed: 2, succeeded: 2, cost_microusd: 0, unknown_cost_responses: 2 }))
      .toContain("cost unavailable for 2 returned responses");
  });
  const recheckZero = { checked: 0, passed: 0, rejected: [], restored: [], cleared: 0, flagged: 0, waiting: 0, takenDown: [] };
  const recheckContext = { dryRun: false, learning: true };

  it.each(["classify", "verify"])("keeps nonzero recheck narration when %s has zero new raw fees", alias => {
    const recheck = verifiedRecheckReceipt({ ...recheckZero, checked: 3, takenDown: [7], olderLive: { read: 2, wouldFail: { tier_perk_zero: 1 }, samples: [] } }, recheckContext);
    const sentence = narrateStepFinished(alias, { processed_raw_fees: 0, recheck }, "GA");
    expect(sentence).toContain("Had no new fees to check in GA. Recheck producer report: 3 checked");
    expect(sentence).toContain("1 takedown reports");
    expect(sentence).toContain("Older-live shadow: 2 assessed in the selected batch");
    expect(sentence).toContain("Assessment completeness unknown; reported IDs do not verify affected rows");
    expect(sentence).not.toMatch(/backlog|all fees|switch|more work/);
  });

  it("retains ordinary verification counts alongside a reported zero of unknown completeness", () => {
    const sentence = narrateStepFinished("classify", { processed_raw_fees: 7, verified_fee_observations: 6, skipped_raw_fees: 1, recheck: verifiedRecheckReceipt(recheckZero, recheckContext) }, "GA");
    expect(sentence).toContain("Verified 6 fees of 7 checked in GA: 1 not verified. Recheck producer report: 0 checked");
    expect(sentence).toContain("completeness unknown");
  });

  it("exposes partial assessment errors safely, without converting absent wouldClear to a complement", () => {
    const recheck = verifiedRecheckReceipt({ ...recheckZero, dueSecondLooks: { due: 5, wouldConfirm: { conditional_zero: 1 }, samples: [], error: "SECRET raw error/source/stack" } }, recheckContext);
    const sentence = narrateStepFinished("verify", { processed_raw_fees: 0, recheck });
    expect(sentence).toContain("5 assessed in the selected batch; assessment error reported; invalid fields unavailable");
    expect(sentence).not.toContain("SECRET");
    expect(recheck.dueSecondLooks.wouldClear).toBeNull();
  });

  it.each([
    [recheckContext, "Recheck report unavailable; cause and assessment completeness unknown"],
    [{ dryRun: true, learning: false }, "Recheck not run: verification dry run"],
    [{ dryRun: false, learning: false }, "Recheck not run: learning log unavailable"],
  ])("distinguishes unavailable and intentionally unexecuted rechecks", (context, expected) => {
    expect(narrateStepFinished("verify", { processed_raw_fees: 0, recheck: verifiedRecheckReceipt(null, context) })).toContain(expected);
  });

  it("preserves legacy narration with no receipt and ignores unprojected/raw recheck text", () => {
    expect(narrateStepFinished("verify", { processed_raw_fees: 0 })).toBe("Had no new fees to check across all states.");
    expect(narrateStepFinished("verify", { processed_raw_fees: 0, recheck: { ...recheckZero, error: "SECRET" } })).toBe("Had no new fees to check across all states.");
  });
  it("separates pending selected-identity deferrals from already published or ineligible fees",()=>{
    expect(narrateStepFinished('publish',{processed_verified_fees:3,published_fees:0,skipped_verified_fees:3,identity_deferred_verified_fees:3},'GA'))
      .toBe('Published 0 fees in GA: 3 deferred after selected verification or identity changed (still pending).');
  });
  it("names excluded references instead of implying no confirmed keys or a passing empty replay", () => {
    expect(narrateStepFinished("score-answer-key",{schema_ready:true,banks_scored:0,reference_eligibility:{state:"no_measurement",eligibleBanks:0,excludedBanks:3}})).toContain("No answer-key measurement: 0 eligible and 3 excluded");
    expect(narrateStepFinished("deming-knox-misses",{ready:true,fees_scored:0,reference_excluded_banks:3,reference_excluded_cases:9})).toContain("No eligible reference fees to replay; 3 reference banks and 9 unbound");
  });

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

describe("Regulatory Wire notes stopped by a budget (#1149)", () => {
  it("names the cap and what waits instead of reading as 0 failed", () => {
    const sentence = narrateStepFinished("registry-wire-research", {
      selected: 20, written: 0, unreadable: 0, failed: 0, budget_stopped: true, budget_waiting: 6,
      budget_reason: "Monthly cap agent:magellan: $150.02 used of $150.00; resets the 1st at 00:00 UTC.",
    });
    expect(sentence).toBe("Wrote 0 Regulatory Wire research notes from 20 items; 0 unreadable, 0 failed. Stopped by a budget cap with 6 items waiting: Monthly cap agent:magellan: $150.02 used of $150.00; resets the 1st at 00:00 UTC.");
  });
});
