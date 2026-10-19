import { describe, expect, it } from "vitest";
import { financialPeerComparison } from "@/lib/data-store/financial-peer-contract";
import { checkAnswerInterpretations } from "./answer-interpretations";
import { checkAnswerEvidence, HELD_ANSWER_MESSAGE } from "./answer-gate";
import { writtenAnswerCheck } from "./answer-save";

// Exact retained candidate and its actual relevant tool reads from the bounded Navy run,
// 2026-10-19, result-navy_comparable_peers.json. No corrected or canned model output.
const question = "How does Navy Federal fee income compare with comparable credit unions in Q2 2026? State the measure, reporting period, size criteria, sample size and whether Navy is included.";
const actualAnswer = "## Hamilton's View\nNavy Federal reported $297.36 million in NCUA fee income year to date through June 30, 2026. That is about 13.3 times the $22.44 million median of the 20 credit unions closest to it in assets. The gap mostly reflects size, not pricing.\n\n## What This Means\nThis is a dollar comparison, not a comparison adjusted for size. No other credit union is close to Navy's size, so even its nearest peers are much smaller. A same-tier median can't be calculated because only two credit unions are in Navy's size band.\n\n## Why It Matters\n- The peer gap reflects size difference, not how Navy prices its fees.\n- The only true size peer group has just two credit unions, too few for a benchmark.\n- This line covers all member fees, not overdraft income or bank service charges.\n\n## Evidence\n- Measure: NCUA fee income \u2014 year-to-date fees charged to members for services or membership, such as overdraft, ATM and credit card fees. Treat it as half-year revenue, not a single quarter (Source: NCUA (5300 call report), 2026-06-30).\n- Navy Federal: $297.36 million \u2014 year to date through 2026-06-30 (Source: NCUA (5300 call report), 2026-06-30).\n- Peer group: the 20 credit unions closest in assets, all NCUA filers. All 20 reported a figure. The source doesn't say whether Navy is one of the 20 (Source: NCUA (5300 call report), 2026-06-30).\n- Peer median: $22.44 million. The middle half runs from $13.11 million to $37.23 million. Navy is 13.3 times the median ($297.36 million \u00f7 $22.44 million) (Source: NCUA (5300 call report), 2026-06-30).\n- Same-size group ($50 billion to $250 billion in assets): no median. Only 2 credit unions have a figure, Navy included, and a median needs at least 5 (Source: NCUA (5300 call report), 2026-06-30).\n\n## Explore Further\n- How does Navy's fee income compare with its nearest peers relative to assets or share-draft accounts?\n- How has Navy's half-year fee income changed from June 2025 to June 2026?\n- How do Navy's published overdraft and NSF fees compare with the large credit union median?\n\nWould you like a full fee-revenue-correlation analysis? It would give a more detailed, structured comparison.";
const actualReads = [
  {
    "toolName": "queryData",
    "input": {
      "measure": "call:acct_131",
      "scope": {
        "kind": "institution",
        "id": "4956"
      },
      "period": {
        "from": "2026Q2",
        "to": "2026Q2"
      }
    },
    "output": {
      "ok": true,
      "measure": "call:acct_131",
      "scope": "institution",
      "measure_metadata": {
        "item_code": "ACCT_131",
        "name": "Fee income",
        "source": "ncua-extras",
        "publisher": "NCUA (5300 call report)",
        "unit": "USD",
        "period_basis": "ytd",
        "caveat": "Broad year-to-date institutional revenue, not a consumer fee price, overdraft-only income or an FFIEC service-charge equivalent. Do not annualize it."
      },
      "rows": [
        {
          "institution_id": 4956,
          "period": "2026-06-30",
          "value": 297362500,
          "unit": "USD",
          "period_basis": "ytd",
          "item_code": "ACCT_131",
          "item_description": "Fees charged to members for services or membership (i.e., overdraft fees, ATM fees, credit card fees, etc.).",
          "schedule": "FS220A",
          "source": "ncua",
          "source_url": "https://ncua.gov/files/publications/analysis/call-report-data-2026-06.zip",
          "fetched_at": "2026-10-17T13:52:50.872Z"
        }
      ],
      "unit": "USD",
      "citation": {
        "publisher": "NCUA (5300 call report)",
        "source_url": "https://ncua.gov/files/publications/analysis/call-report-data-2026-06.zip",
        "as_of": "2026-06-30",
        "fetched_at": "2026-10-17T13:52:50.872Z"
      }
    }
  },
  {
    "toolName": "queryData",
    "input": {
      "measure": "call:acct_131",
      "scope": {
        "kind": "peer_set",
        "id": "4956",
        "peer": {
          "charter_type": "credit_union",
          "asset_tiers": "same"
        }
      },
      "period": {
        "from": "2026Q2",
        "to": "2026Q2"
      }
    },
    "output": {
      "ok": true,
      "measure": "call:acct_131",
      "scope": "peer_set",
      "measure_metadata": {
        "item_code": "ACCT_131",
        "name": "Fee income",
        "source": "ncua-extras",
        "publisher": "NCUA (5300 call report)",
        "unit": "USD",
        "period_basis": "ytd",
        "caveat": "Broad year-to-date institutional revenue, not a consumer fee price, overdraft-only income or an FFIEC service-charge equivalent. Do not annualize it."
      },
      "rows": [
        {
          "scope_label": "Credit unions with $50B to $250B in assets \u2014 NCUA filers only",
          "period": "2026-06-30",
          "median": null,
          "p25": null,
          "p75": null,
          "unit": "USD",
          "institution_count": 2,
          "member_count": 2,
          "note": "Only 2 institutions have a figure for this period; a median needs at least 5.",
          "period_basis": "ytd",
          "sources": "ncua"
        }
      ],
      "unit": "USD",
      "citation": {
        "publisher": "NCUA (5300 call report)",
        "source_url": "https://ncua.gov/files/publications/analysis/call-report-data-2026-06.zip",
        "as_of": "2026-06-30",
        "fetched_at": "2026-10-17T13:53:45.367Z"
      },
      "note": "2 of the group's 2 institutions have a filed figure for 2026-06-30. A period with fewer than 5 shows no median."
    }
  },
  {
    "toolName": "queryData",
    "input": {
      "measure": "call:acct_131",
      "scope": {
        "kind": "peer_set",
        "id": "4956",
        "peer": {
          "charter_type": "credit_union",
          "nearest": 20
        }
      },
      "period": {
        "from": "2026Q2",
        "to": "2026Q2"
      }
    },
    "output": {
      "ok": true,
      "measure": "call:acct_131",
      "scope": "peer_set",
      "measure_metadata": {
        "item_code": "ACCT_131",
        "name": "Fee income",
        "source": "ncua-extras",
        "publisher": "NCUA (5300 call report)",
        "unit": "USD",
        "period_basis": "ytd",
        "caveat": "Broad year-to-date institutional revenue, not a consumer fee price, overdraft-only income or an FFIEC service-charge equivalent. Do not annualize it."
      },
      "rows": [
        {
          "scope_label": "The 20 credit unions closest in assets \u2014 NCUA filers only",
          "period": "2026-06-30",
          "median": 22435501,
          "p25": 13107332,
          "p75": 37232323.25,
          "unit": "USD",
          "institution_count": 20,
          "member_count": 20,
          "note": null,
          "period_basis": "ytd",
          "sources": "ncua"
        }
      ],
      "unit": "USD",
      "citation": {
        "publisher": "NCUA (5300 call report)",
        "source_url": "https://ncua.gov/files/publications/analysis/call-report-data-2026-06.zip",
        "as_of": "2026-06-30",
        "fetched_at": "2026-10-17T13:53:50.371Z"
      },
      "note": "20 of the group's 20 institutions have a filed figure for 2026-06-30."
    }
  }
];

const actualEvidence = { selected_institution_id: 4956, tool_evidence: actualReads };
const comparison = financialPeerComparison({ source: "ncua", reportDate: "2026-06-30", tier: "regional", minimumAssetsUsd: 1e10, maximumAssetsUsd: 250e9, subjectIncluded: true, eligibleCount: 25, reportedCount: 25, ratioReportedCount: 25, minimumMedianCount: 5 });
const quarterEvidence = { selected_institution_id: 4956, tool_evidence: [{ toolName: "getInstitution", input: { id: 4956 }, output: { peer_ranking: { sc_income: 153079, peer_median_sc: 11125, peer_count: 25, comparison } } }] };

describe("actual Navy peer-answer failures (#2355)", () => {
  it("holds the retained source-passing answer for its period substitution, causal story, sole-valid group and unchecked quotient", () => {
    const problems = checkAnswerInterpretations(actualAnswer, actualEvidence, question).join(" ");
    expect(problems).toContain("standalone-quarter fee income");
    expect(problems).toContain("size, rather than pricing");
    expect(problems).toContain("only true or valid peer group");
    expect(problems).toContain("peer-income multiple");
    expect(checkAnswerEvidence(actualAnswer, actualEvidence, { question }).passed).toBe(false);
  });

  it.each([
    "The gap mostly reflects size, not pricing.",
    "The peer gap reflects size difference, not how Navy prices its fees.",
    "The income difference is driven by scale.",
    "The only true size peer group has just two credit unions.",
    "The sole valid cohort is the chosen tier.",
  ])("holds unsupported interpretation: %s", (answer) => {
    expect(checkAnswerInterpretations(answer, actualEvidence)).not.toEqual([]);
  });

  it.each([
    "This is an unadjusted dollar-income comparison, not evidence that size or pricing caused the gap.",
    "The figures cannot establish that the gap reflects size.",
    "The size band is not the only valid peer group.",
    "A broad size band and nearest-in-assets peers answer different stated cohort definitions.",
  ])("allows bounded scope and explicit limits: %s", (answer) => {
    expect(checkAnswerInterpretations(answer, actualEvidence)).toEqual([]);
  });

  it("accepts a sourced standalone quarter and preserves legitimate YTD questions", () => {
    const answer = "Q2 2026 broad fee income was $153.08 million; the peer median was $11.13 million for the same quarter.";
    expect(checkAnswerInterpretations(answer, quarterEvidence, question)).toEqual([]);
    expect(checkAnswerInterpretations("YTD fee income was $297.36 million through June 2026.", actualEvidence, "How much fee income was reported year to date through Q2 2026?")).toEqual([]);
  });

  it.each([
    "The peer median was $11.13 million, and Navy Federal fee income was $153.08 million in Q2 2026.",
    "In Q2 2026, the peer median was $11.13 million versus Navy Federal's fee income of $153.08 million.",
    "In Q2 2026, Navy Federal fee income was $153.08 million and the peer median was $11.13 million.",
  ])("binds the role to each figure across assertion order and conjunctions (#2359): %s", (answer) => {
    expect(checkAnswerInterpretations(answer, quarterEvidence, question)).toEqual([]);
  });

  it("checks income assertions even when the same clause states valid asset bounds (#2360)", () => {
    const mixed = { ...quarterEvidence, tool_evidence: [...quarterEvidence.tool_evidence, ...actualReads] };
    const falseAnswer = "Q2 2026 Navy fee income was $153.08 million. In a cohort with $10 billion to $250 billion in assets, Q2 Navy fee income was $297.36 million and the peer median was $22.44 million.";
    expect(checkAnswerInterpretations(falseAnswer, mixed, question).join(" ")).toContain("standalone-quarter");
    expect(checkAnswerInterpretations("In a cohort with $10 billion to $250 billion in assets, Q2 2026 Navy fee income was $153.08 million and the peer median was $11.13 million.", quarterEvidence, question)).toEqual([]);
    expect(checkAnswerInterpretations("Q2 2026 Navy fee income was $153.08 million. The peer median was $22.44 million for credit unions with $10 billion to $250 billion in assets.", mixed, question).join(" ")).toContain("standalone-quarter");
  });

  it("accepts the server's matched institution-quarter result with its shown YTD subtraction", () => {
    const evidence = { selected_institution_id: 4382, publisher: "NCUA", validated_calculations: [{ source: "ncua", institution_id: 4382, measure: "call:acct_131", metric: "Fee income, standalone quarter", operation: "ytd_to_quarter", unit: "USD", period_basis: "standalone_quarter", report_date: "2026-06-30", value: 30032341 }] };
    expect(checkAnswerInterpretations("April through June 2026 fee income was $30.032341 million = $57.261959 million YTD minus $27.229618 million YTD.", evidence, "How much fee income did PenFed earn during April through June 2026, rather than the first six months? Show the calculation.")).toEqual([]);
  });

  it("cannot relabel a YTD amount as Q2 merely because a valid quarter fact is also present", () => {
    const mixed = { ...quarterEvidence, tool_evidence: [...quarterEvidence.tool_evidence, ...actualReads] };
    expect(checkAnswerInterpretations("Q2 2026 fee income was $297.36 million.", mixed, question).join(" ")).toContain("standalone-quarter");
    expect(checkAnswerInterpretations("Q2 2026 fee income was $153.08 million; the peer median was $22.44 million.", mixed, question).join(" ")).toContain("standalone-quarter");
  });

  it("allows a clear inability to compute the requested quarter, with YTD only as labeled context", () => {
    expect(checkAnswerInterpretations("The Q2 standalone-quarter peer comparison cannot be computed from these available rows. The related year-to-date income through June is $297.36 million.", actualEvidence, question)).toEqual([]);
  });

  it("a refusal elsewhere cannot excuse a false affirmative quarter amount", () => {
    expect(checkAnswerInterpretations("Navy earned $297.4 million in Q2. The Q2 peer comparison is unavailable.", quarterEvidence, question).join(" ")).toContain("standalone-quarter");
    expect(checkAnswerInterpretations("The Q2 peer comparison is unavailable. Navy earned $297.4 million in Q2.", quarterEvidence, question).join(" ")).toContain("standalone-quarter");
  });

  it("a peer median cannot authorize the subject's quarter amount and prior quarters keep their own dates", () => {
    const evidence = { ...quarterEvidence, tool_evidence: [{ ...quarterEvidence.tool_evidence[0], output: { peer_ranking: { ...quarterEvidence.tool_evidence[0].output.peer_ranking, peer_median_sc: 297400 }, revenue_trend_definition: { source: "ncua", period_basis: "standalone_quarter", unit: "thousands of dollars" }, revenue_trend: [{ quarter: "2025-Q2", service_charge_income: 130800 }, { quarter: "2026-Q1", service_charge_income: 144300 }] } }] };
    expect(checkAnswerInterpretations("Navy earned $297.4 million in Q2 2026.", evidence, question)).not.toEqual([]);
    expect(checkAnswerInterpretations("Navy's Q2 2026 fee income was $153.08 million. Q2 2025 fee income was $130.8 million. Q1 2026 fee income was $144.3 million.", evidence, question)).toEqual([]);
    expect(checkAnswerInterpretations("YTD fee income through June was $297.36 million. Q2 2026 fee income was $153.08 million.", evidence, question)).toEqual([]);
  });

  it.each(["13.3 times", "13.3x", "13.3×"])("rejects a peer multiplier %s without a typed server derivation", (multiple) => {
    const answer = `Navy is ${multiple} the peer median.`;
    expect(checkAnswerInterpretations(answer, actualEvidence).join(" ")).toContain("peer-income multiple");
    const validated = { ...actualEvidence, validated_calculations: [{ source: "ncua", metric: "fee_income_peer_multiple", operation: "ratio", unit: "multiple", report_date: "2026-06-30", value: 13.253 }] };
    expect(checkAnswerInterpretations(answer, validated)).toEqual([]);
    expect(checkAnswerInterpretations(`Navy is 20.0 times the peer median.`, validated)).not.toEqual([]);
    expect(checkAnswerInterpretations(answer, { ...actualEvidence, ratios: [{ value: 13.253 }] })).not.toEqual([]);
  });

  it("keeps the source hold and internal account-code rejection intact", () => {
    expect(HELD_ANSWER_MESSAGE).toBe("This answer didn't pass Hamilton's source check, so it isn't shown. Ask again, or name one fee to compare.");
    expect(writtenAnswerCheck("NCUA ACCT_131 reported $297.36 million.", actualReads.map((read) => read.output)).passed).toBe(false);
  });
});
