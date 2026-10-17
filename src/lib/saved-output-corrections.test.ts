import { describe, expect, it } from "vitest";

import { affectedSavedOutputsLabel, collectFeeRefs, MAX_SAVED_FEE_REFS, savedOutputNotice } from "./saved-output-corrections";

// H03-T09 (#978): a saved output made before a fee change keeps its figures and says so.

const saved = "2026-10-10T09:00:00.000Z";

describe("saved output notice", () => {
  it("should_say_nothing_when_no_fee_changed_after_the_output_was_saved", () => {
    expect(savedOutputNotice([], saved)).toBeNull();
    expect(savedOutputNotice([{ kind: "correct", at: "2026-10-09T09:00:00.000Z" }, { kind: "hold", at: saved }], saved)).toBeNull();
  });

  it("should_name_one_change_and_its_date_without_rewriting_the_output", () => {
    const notice = savedOutputNotice([{ kind: "correct", at: "2026-10-16T12:00:00.000Z" }], saved);
    expect(notice?.count).toBe(1);
    expect(notice?.text).toBe(
      "This institution's fee data changed after this answer was saved: 1 fee corrected on Oct 16, 2026. " +
        "This answer still shows the figures from when it was saved.",
    );
  });

  it("should_group_several_changes_and_give_the_latest_date", () => {
    const notice = savedOutputNotice([
      { kind: "hold", at: "2026-10-12T12:00:00.000Z" },
      { kind: "correct", at: "2026-10-14T12:00:00.000Z" },
      { kind: "correct", at: "2026-10-15T12:00:00.000Z" },
    ], saved, "report");
    expect(notice?.latestAt).toBe("2026-10-15T12:00:00.000Z");
    expect(notice?.text).toContain("2 fees corrected and 1 fee taken out for review, the latest on Oct 15, 2026.");
    expect(notice?.text).toContain("This report still shows the figures");
  });

  it("should_never_name_a_pipeline_agent_or_suggest_a_fee_change", () => {
    const notice = savedOutputNotice([
      { kind: "correct", at: "2026-10-16T12:00:00.000Z" },
      { kind: "reverse", at: "2026-10-16T13:00:00.000Z" },
      { kind: "hold", at: "2026-10-16T14:00:00.000Z" },
      { kind: "release", at: "2026-10-16T15:00:00.000Z" },
    ], saved);
    expect(notice?.text).not.toMatch(/Atlas|Magellan|Rosetta|Knox|Darwin|should|recommend|raise|lower/i);
  });

  it("should_label_affected_saved_outputs_and_keep_unknown_counts_honest", () => {
    expect(affectedSavedOutputsLabel({ analyses: 3, reports: 1, briefings: 0 })).toBe("3 saved answers, 1 report");
    expect(affectedSavedOutputsLabel({ analyses: 0, reports: 0, briefings: 0 })).toBe("none");
    expect(affectedSavedOutputsLabel({ analyses: 0, reports: null, briefings: 0 })).toBe("unknown");
    expect(affectedSavedOutputsLabel({ analyses: 2, reports: null, briefings: 0 })).toBe("2 saved answers (some unreadable)");
    expect(affectedSavedOutputsLabel(null)).toBe("unknown");
  });
});

describe("saved output notice from the fee rows it used", () => {
  it("should_name_the_fee_data_the_output_used_rather_than_the_institution", () => {
    const notice = savedOutputNotice([{ kind: "hold", at: "2026-10-16T12:00:00.000Z" }], saved, "report", "fees");
    expect(notice?.text).toBe(
      "Fee data this report used changed after this report was saved: 1 fee taken out for review on Oct 16, 2026. " +
        "This report still shows the figures from when it was saved.",
    );
    expect(notice?.text).not.toMatch(/—|Knox|Darwin|Free/);
  });
});

describe("collectFeeRefs", () => {
  it("should_collect_own_rows_evidence_facts_and_named_peers_but_skip_market_layers", () => {
    const research = {
      institutionId: 7,
      ownRows: [{ id: 101, sourceDocumentId: 900, sourceContentHash: "h1" }, { id: "102", sourceDocumentId: null }],
      peers: [{ institutionId: 8, amount: 30, sourceDocumentIds: [901], feePublishedIds: [201, 202] }],
      localCompetitors: [{ institutionId: 9, sourceDocumentIds: [902, 903], feePublishedIds: [301] }],
      layers: [{ scope: "national", members: [{ institutionId: 10, feePublishedIds: [999] }] }],
    };
    const evidence = {
      facts: [
        { scope: { institutionId: 7 }, source: { table: "published_fee_catalog", recordId: 102, sourceDocumentIds: [904], documentContentHash: "h2" } },
        { scope: { institutionId: 7 }, source: { table: "institution_financial_records", recordId: 555, sourceDocumentIds: [] } },
      ],
    };
    expect(collectFeeRefs(research, evidence)).toEqual([
      { feePublishedId: 101, institutionId: 7, sourceDocumentId: 900, sourceContentHash: "h1" },
      // First seen without a document; the evidence fact fills it in.
      { feePublishedId: 102, institutionId: 7, sourceDocumentId: 904, sourceContentHash: "h2" },
      { feePublishedId: 201, institutionId: 8, sourceDocumentId: 901, sourceContentHash: null },
      { feePublishedId: 202, institutionId: 8, sourceDocumentId: 901, sourceContentHash: null },
      // Two documents behind one value: no single source version to record.
      { feePublishedId: 301, institutionId: 9, sourceDocumentId: null, sourceContentHash: null },
    ]);
  });

  it("should_ignore_ids_that_are_not_positive_integers_and_stop_at_the_cap", () => {
    expect(collectFeeRefs(null, "x", { ownRows: [{ id: 0 }, { id: -1 }, { id: 1.5 }, { id: "abc" }] })).toEqual([]);
    const many = { feePublishedIds: Array.from({ length: MAX_SAVED_FEE_REFS + 50 }, (_, i) => i + 1), institutionId: 1 };
    expect(collectFeeRefs(many)).toHaveLength(MAX_SAVED_FEE_REFS);
  });

  it("should_not_loop_on_a_value_that_refers_to_itself", () => {
    const loop: Record<string, unknown> = { ownRows: [{ id: 5 }], institutionId: 3 };
    loop.self = loop;
    expect(collectFeeRefs(loop).map((ref) => ref.feePublishedId)).toEqual([5]);
  });
});
