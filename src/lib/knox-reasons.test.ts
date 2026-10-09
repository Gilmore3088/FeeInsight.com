import { describe, expect, it } from "vitest";
import { linesNamingFee } from "@/lib/custom-report/source-check";
import {
  describeFeeAmount,
  interpretKnoxReason,
  interpretKnoxReasons,
  isKnoxReasonGroup,
  knoxPayloadReasons,
  knoxReasonGroup,
  knoxReviewActionsExplanation,
} from "./knox-reasons";

// The five reason shapes stored on prod Knox rejects (payload.reasons), Oct 2026.
const ZERO =
  "amount=0 but fee_name has no free-fee wording (searched: ('free', 'waived', 'no charge', 'no fee', 'complimentary', 'included'))";
const WITHIN = "amount=0.00 within 5.0x peer_median=1.00 (n=10)";
const EXCEEDS = "amount=150.00 exceeds 5.0x peer_median=25.00 (n=42)";
const FEW_PEERS = "peer_count=2 below min 5; skipping excess check";
const NO_MEDIAN = "no valid peer median for comparison";

describe("interpretKnoxReason", () => {
  it("reads the zero-amount check as a rejection and names the words Knox looked for", () => {
    const r = interpretKnoxReason(ZERO);
    expect(r.code).toBe("zero_without_free_wording");
    expect(r.blocking).toBe(true);
    expect(r.detail).toContain("Knox read the amount as $0.00");
    expect(r.detail).toContain('"waived"');
    expect(r.raw).toBe(ZERO);
  });

  it("says when the amount was missing rather than $0", () => {
    const r = interpretKnoxReason(ZERO, { amountRecorded: false });
    expect(r.detail).toContain("No amount is recorded for this fee");
  });

  it("reads the peer excess check with its numbers", () => {
    const r = interpretKnoxReason(EXCEEDS);
    expect(r).toMatchObject({ code: "above_peer_median", blocking: true });
    expect(r.detail).toBe("$150.00 is more than 5x the peer median of $25.00 (42 peer fees).");
  });

  it("treats passed or skipped peer checks as context, not reasons", () => {
    expect(interpretKnoxReason(WITHIN)).toMatchObject({ code: "within_peer_median", blocking: false });
    expect(interpretKnoxReason(FEW_PEERS)).toMatchObject({ code: "too_few_peers", blocking: false });
    expect(interpretKnoxReason(FEW_PEERS).detail).toContain("Only 2 peer fees (at least 5 needed)");
    expect(interpretKnoxReason(NO_MEDIAN)).toMatchObject({ code: "no_peer_median", blocking: false });
  });

  it("keeps an unknown reason's text and counts it as a reason", () => {
    expect(interpretKnoxReason("  something new  ")).toMatchObject({
      code: "unrecognized",
      blocking: true,
      detail: "something new",
    });
  });
});

describe("knoxPayloadReasons / interpretKnoxReasons", () => {
  it("reads payload.reasons and the older payload.reason", () => {
    expect(knoxPayloadReasons({ reasons: [WITHIN, ZERO, 3, ""], decision: "reject" })).toEqual([WITHIN, ZERO]);
    expect(knoxPayloadReasons({ reason: "old shape" })).toEqual(["old shape"]);
    expect(knoxPayloadReasons(null)).toEqual([]);
    expect(knoxPayloadReasons({ reasons: "not an array" })).toEqual([]);
  });

  it("lists rejection reasons before context checks", () => {
    const codes = interpretKnoxReasons({ reasons: [WITHIN, ZERO] }).map((r) => r.code);
    expect(codes).toEqual(["zero_without_free_wording", "within_peer_median"]);
  });
});

describe("knoxReasonGroup", () => {
  it("groups by the reason Knox rejected on", () => {
    expect(knoxReasonGroup({ reasons: [WITHIN, ZERO] })).toBe("zero_amount");
    expect(knoxReasonGroup({ reasons: [FEW_PEERS, ZERO] })).toBe("zero_amount");
    expect(knoxReasonGroup({ reasons: [EXCEEDS] })).toBe("above_peers");
    expect(knoxReasonGroup({ reasons: [ZERO, EXCEEDS] })).toBe("zero_amount");
    expect(knoxReasonGroup({ reasons: [NO_MEDIAN] })).toBe("unrecognized");
    expect(knoxReasonGroup({})).toBe("unrecognized");
  });

  it("validates a group from a query string", () => {
    expect(isKnoxReasonGroup("above_peers")).toBe(true);
    expect(isKnoxReasonGroup("other")).toBe(false);
    expect(isKnoxReasonGroup(undefined)).toBe(false);
  });
});

describe("describeFeeAmount", () => {
  it("tells a dollar fee, a free fee, a percentage and an unknown amount apart", () => {
    expect(describeFeeAmount({ amount: 25, amount_kind: "flat" })).toMatchObject({ kind: "flat", label: "$25.00" });
    expect(describeFeeAmount({ amount: "0", amount_kind: "flat" })).toMatchObject({ kind: "free", label: "Free ($0)" });
    expect(
      describeFeeAmount({ amount: null, amount_kind: "percent", rate_percent: 1.1, rate_basis: "transaction" }),
    ).toMatchObject({ kind: "percent", label: "1.1% of the transaction" });
    expect(describeFeeAmount({ amount: null, amount_kind: "flat" })).toMatchObject({
      kind: "unknown",
      label: "Unknown",
      note: "No amount recorded.",
    });
  });

  it("points out a rate stated in the conditions of an unknown amount", () => {
    const shown = describeFeeAmount({
      amount: null,
      amount_kind: "flat",
      conditions: "Up to 1.00% of each transaction in US dollars",
    });
    expect(shown.kind).toBe("unknown");
    expect(shown.note).toContain("(1.00%)");
  });

  it("does not show a percentage fee with no rate as a rate", () => {
    expect(describeFeeAmount({ amount_kind: "percent", rate_percent: null }).kind).toBe("unknown");
  });
});

describe("knoxReviewActionsExplanation", () => {
  const now = new Date("2026-10-09T12:00:00Z");

  it("says override tries to publish when Darwin accepted within 30 days", () => {
    const text = knoxReviewActionsExplanation("2026-10-01T00:00:00Z", now);
    expect(text).toContain("tries to publish this fee at once");
    expect(text).toContain("2026-10-01");
  });

  it("says override cannot publish when Darwin's accept is older than 30 days", () => {
    const text = knoxReviewActionsExplanation("2026-08-12T16:50:25Z", now);
    expect(text).toContain("cannot publish this fee");
    expect(text).toContain("Darwin last accepted it on 2026-08-12");
    expect(text).toContain("No later pass reads overrides");
  });

  it("says so when Darwin never accepted the fee", () => {
    expect(knoxReviewActionsExplanation(null, now)).toContain("Darwin has never accepted it");
  });

  it("says confirm changes no fee record", () => {
    expect(knoxReviewActionsExplanation(null, now)).toMatch(/^Confirm rejection records your verdict only/);
  });
});

describe("linesNamingFee", () => {
  const text = [
    "Public Service Federal Credit Union",
    "Membership Fee: Five (5) Shares | $50.00",
    "Address Change by member | No Charge",
    "Photocopy Fee (per page) | $1.00",
  ].join("\n");

  it("returns the lines that name the fee", () => {
    expect(linesNamingFee(text, "Photocopy Fee")).toEqual(["Photocopy Fee (per page) | $1.00"]);
  });

  it("returns nothing for missing text or an unnamed fee", () => {
    expect(linesNamingFee(null, "Photocopy Fee")).toEqual([]);
    expect(linesNamingFee(text, "Wire Transfer Outgoing")).toEqual([]);
  });
});
