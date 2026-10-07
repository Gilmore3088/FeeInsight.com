import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn(), getSql: vi.fn() }));

import type { CandidateDiscoveryResult } from "./discovery";
import { SEARCH_MISS_CHECK, searchMissFeedbackRows } from "./search-misses";

function result(institutionId: number, outcome: CandidateDiscoveryResult["outcome"]): CandidateDiscoveryResult {
  return {
    institutionId,
    institutionName: `Bank ${institutionId}`,
    stateCode: "TN",
    outcome,
    code: outcome === "discovered" ? "found_homepage_link" as CandidateDiscoveryResult["code"] : "no_fee_links",
    url: null,
    documentType: null,
    confidence: null,
    reason: "No fee links",
    method: "magellan_agentic_discovery",
    attemptedUrls: 7,
    foundBy: null,
    movedTo: null,
    platform: null,
    homepageHash: null,
    homepageBlocked: false,
    websiteRepair: null,
    finders: [],
    durationMs: 10,
    resumedFrom: null,
    resume: null,
  };
}

describe("searchMissFeedbackRows", () => {
  it("writes one missed lesson per dead end or needs-human bank, per method version", () => {
    const rows = searchMissFeedbackRows(
      [result(1, "dead"), result(2, "discovered"), result(3, "needs_human"), result(4, "retry_after")],
      { runId: 9, method: "magellan_agentic_discovery", methodVersion: 5, websites: new Map([[1, "https://bank1.example"]]) },
    );
    expect(rows.map((row) => row.institutionId)).toEqual([1, 3]);
    expect(rows[0]).toMatchObject({
      signal: "missed",
      kind: "search_miss",
      checkName: SEARCH_MISS_CHECK,
      aboutStage: "discover",
      aboutVersion: 5,
      sourceUrl: "https://bank1.example",
      dedupeKey: `${SEARCH_MISS_CHECK}:1:v5`,
    });
    expect(rows[0].evidence).toMatchObject({ outcome: "dead", code: "no_fee_links", attempted_urls: 7 });
    expect(rows[1].sourceUrl).toBeNull();
  });
});
