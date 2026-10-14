import { describe, expect, it } from "vitest";
import { DARWIN_AUDIENCE_PREFIX, darwinAudience } from "./audience";

describe("Darwin's audience decision (#1059)", () => {
  it("keeps the label Knox read on the fee's own line", () => {
    expect(darwinAudience({ fee_audience: "business", source_url: null, fee_name: "Business NSF" }, 35, "Fee Schedule\nStop Payment $30")).toBeNull();
  });

  it("decides a fee Knox left unknown from its context, with evidence the trigger keeps", () => {
    const decided = darwinAudience({ fee_audience: "unknown", source_url: "https://bank.example/fee-schedule.pdf", fee_name: "Stop Payment" }, 30, "Fee Schedule\nStop Payment $30\nOverdraft $32");
    expect(decided).toEqual({ feeAudience: "consumer", audienceEvidence: `${DARWIN_AUDIENCE_PREFIX}default_general_schedule: no business fees in the document` });
    const business = darwinAudience({ fee_audience: "unknown", source_url: "https://www.tabbank.com/uploads/TAB-Business-Checking-Fee-Schedule.pdf", fee_name: "Stop Payment" }, 30, null);
    expect(business).toMatchObject({ feeAudience: "business", audienceEvidence: expect.stringMatching(/^darwin:document_url: /) });
  });

  it("decides nothing when the context says nothing", () => {
    expect(darwinAudience({ fee_audience: "unknown", source_url: null, fee_name: "Stop Payment" }, 30, null)).toBeNull();
  });
});
