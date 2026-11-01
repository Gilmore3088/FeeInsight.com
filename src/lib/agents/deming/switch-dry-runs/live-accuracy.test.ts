import { describe, expect, it } from "vitest";

import { wilsonRange } from "@/lib/agents/deming/accuracy-measure";
import { scoreFreshAudit, type FreshAuditFee, type FreshAuditResult } from "@/lib/agents/deming/fresh-audit";
import { liveAccuracyFrom } from "./live-accuracy";

function audit(score: Partial<FreshAuditResult>): FreshAuditResult {
  return {
    readable: true,
    seed: "2026-11-01",
    categoryGuardVersion: 1,
    sourceCheckVersion: 28,
    ...scoreFreshAudit([], new Map()),
    ...score,
  };
}

function fee(id: number, institutionId: number, name: string, amount: number, key: string): FreshAuditFee {
  return {
    fee_id: id, fee_published_id: id, lineage_ref: id, fee_raw_id: id, institution_id: institutionId, source: "knox",
    source_document_id: institutionId * 10, canonical_fee_key: key, fee_name: name, amount, document_url: null,
  };
}

describe("switch dry runs: live accuracy", () => {
  it("should_restate_the_fresh_audits_amount_and_category_share", () => {
    const result = liveAccuracyFrom(audit({ sampled: 45, scorable: 40, noText: 5, amountMiss: 3, categoryMiss: 1, right: 34 }));
    // 40 scorable - 3 amount misses - 1 category miss = 36 supported on both.
    expect(result.amountAndCategory).toBe(36);
    expect(result.share).toBe(0.9);
    expect(result.range).toEqual(wilsonRange(36, 40));
    expect(result.rightShare).toBe(0.85);
    expect(result.method).toMatch(/checkFeeAgainstSource/);
  });

  it("should_report_no_share_without_a_scorable_fee", () => {
    const result = liveAccuracyFrom(audit({ sampled: 3, scorable: 0, noText: 3 }));
    expect(result.share).toBeNull();
    expect(result.range).toBeNull();
  });

  it("should_score_live_fees_against_stored_texts_through_the_fresh_audit", () => {
    const fees = [
      fee(1, 1, "Stop Payment", 30, "stop_payment"),
      fee(2, 1, "Stop Payment", 25, "stop_payment"),
      fee(3, 2, "Stop Payment", 30, "stop_payment"),
    ];
    const texts = new Map([[1, [{ source_document_id: 10, normalized_text: "Fee Schedule\nStop Payment | $30.00" }]]]);
    const result = liveAccuracyFrom(audit(scoreFreshAudit(fees, texts)));
    // Fee 1 traces; fee 2's $25 is not on the schedule; fee 3's institution has no stored text.
    expect(result).toMatchObject({ sampled: 3, scorable: 2, noText: 1, amountMiss: 1, categoryMiss: 0, amountAndCategory: 1, share: 0.5, right: 1 });
  });
});
