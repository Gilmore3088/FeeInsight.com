import { describe, expect, it } from "vitest";

import { affectedSavedOutputsLabel, collectFeeRefs, MAX_SAVED_FEE_REFS, savedOutputNotice, writtenAnswerFeeRefs } from "./saved-output-corrections";

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

  it("should_collect_profile_catalog_rows_by_record_id_and_skip_preview_rows_and_competitor_prices", () => {
    // getInstitution's profile shape (src/lib/research/tools.ts): snake_case record and document ids.
    const profile = {
      identity: { id: 7, name: "Synthetic Bank" },
      fees: {
        verified: [{ fee_name: "Overdraft", amount: 35, status: "verified", record_id: 401, source_document_id: 905 }],
        provisional: [
          { fee_name: "Stop payment", amount: 30, status: "provisional", record_id: "402", source_document_id: null },
          // Pipeline previews: no catalog row behind them, even if an id were present.
          { fee_name: "Wire", amount: 25, status: "provisional", pipeline_stage: "verified_unpublished" },
          { fee_name: "Paper", amount: 2, status: "provisional", pipeline_stage: "raw_unverified", record_id: 403 },
        ],
      },
    };
    const competitors = { institution: "Synthetic Bank", your_fees: { overdraft: 35 }, competitors: [{ name: "Other Bank", fees: { overdraft: 30 } }] };
    expect(collectFeeRefs([profile, competitors])).toEqual([
      { feePublishedId: 401, institutionId: 7, sourceDocumentId: 905, sourceContentHash: null },
      { feePublishedId: 402, institutionId: 7, sourceDocumentId: null, sourceContentHash: null },
    ]);
    // A profile of preview rows only, and a competitor read alone, record nothing.
    expect(collectFeeRefs({ identity: { id: 7 }, fees: { verified: [], provisional: [profile.fees.provisional[2]] } }, competitors)).toEqual([]);
  });

  it("should_not_loop_on_a_value_that_refers_to_itself", () => {
    const loop: Record<string, unknown> = { ownRows: [{ id: 5 }], institutionId: 3 };
    loop.self = loop;
    expect(collectFeeRefs(loop).map((ref) => ref.feePublishedId)).toEqual([5]);
  });
});

describe("writtenAnswerFeeRefs", () => {
  const own = { feePublishedId: 1, institutionId: 9001, sourceDocumentId: 101, sourceContentHash: null };
  const peer = { feePublishedId: 2, institutionId: 9002, sourceDocumentId: 102, sourceContentHash: null };
  it("should_keep_refs_that_include_a_row_of_the_research_subject", () => {
    expect(writtenAnswerFeeRefs([own, peer], 9001)).toEqual([own, peer]);
  });
  it("should_save_none_when_no_ref_is_the_subjects_so_the_institution_match_stays", () => {
    expect(writtenAnswerFeeRefs([peer], 9001)).toEqual([]);
  });
  it("should_save_none_when_the_subjects_profile_was_cut_by_compaction_so_the_institution_match_stays", () => {
    const cutProfile = { _shortened: "fees.verified kept 20 of 40 rows", identity: { id: 9001 }, fees: { verified: [], provisional: [] } };
    expect(writtenAnswerFeeRefs([own, peer], 9001, [cutProfile])).toEqual([]);
    expect(writtenAnswerFeeRefs([own, peer], 9001, [{ _shortened: "Result cut to 12000 characters.", text: "…" }])).toEqual([]);
    // A peer's cut profile leaves the subject's rows whole.
    expect(writtenAnswerFeeRefs([own, peer], 9001, [{ ...cutProfile, identity: { id: 9002 } }])).toEqual([own, peer]);
    expect(writtenAnswerFeeRefs([own, peer], 9001, [{ _shortened: "rows kept 50 of 100", rows: [] }])).toEqual([own, peer]);
  });
  it("should_keep_refs_when_compaction_trimmed_the_subjects_profile_but_kept_every_fee_row", () => {
    const trimmed = { _shortened: "Fee rows trimmed. Every fee row is kept.", _fee_rows_complete: true, identity: { id: 9001 }, fees: { verified: [], provisional: [] } };
    expect(writtenAnswerFeeRefs([own, peer], 9001, [trimmed])).toEqual([own, peer]);
    // The marker counts only on a profile; a plain-text cut still saves none.
    expect(writtenAnswerFeeRefs([own, peer], 9001, [{ _shortened: "Result cut to 12000 characters.", _fee_rows_complete: true, text: "…" }])).toEqual([]);
  });
  it("should_keep_refs_when_the_answer_has_no_subject", () => {
    expect(writtenAnswerFeeRefs([peer], null)).toEqual([peer]);
  });
});
