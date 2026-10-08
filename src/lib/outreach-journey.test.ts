import { describe, expect, it } from "vitest";

import { journeyFunnel, journeyStage, parseBuyerLog, parseSnapshotEvent } from "./outreach-journey";

describe("the outreach journey", () => {
  it("places each institution at the furthest stage it reached", () => {
    expect(journeyStage([], ["sent"])).toBe("delivered");
    expect(journeyStage(["opened"], ["sent"])).toBe("opened");
    expect(journeyStage(["opened", "source_click"], ["sent"])).toBe("engaged");
    expect(journeyStage(["opened", "report_click"], [])).toBe("interest");
    expect(journeyStage([], ["sent", "replied"])).toBe("interest");
    expect(journeyStage(["opened"], ["sent", "purchased_report"])).toBe("purchase");
    expect(journeyStage([], [])).toBeNull();
  });

  it("counts every institution at its stage and each stage before it", () => {
    const funnel = journeyFunnel(["delivered", "opened", "engaged", "purchase", null]);
    expect(funnel.map((stage) => stage.count)).toEqual([4, 3, 2, 1, 1]);
  });

  it("keeps only known events and short fee keys, no personal data", () => {
    expect(parseSnapshotEvent({ institutionId: 7, event: "source_click", detail: "overdraft", utm_campaign: "outreach-launch", utm_content: "inst-7" })).toEqual({
      institutionId: 7,
      event: "source_click",
      detail: "overdraft",
      utmCampaign: "outreach-launch",
      utmContent: "inst-7",
    });
    expect(parseSnapshotEvent({ institutionId: 7, event: "email_open" })).toBeNull();
    expect(parseSnapshotEvent({ institutionId: -1, event: "opened" })).toBeNull();
    expect(parseSnapshotEvent({ institutionId: 7, event: "opened", detail: "jane@bank.com" })?.detail).toBeNull();
  });
});

describe("the buyer log", () => {
  it("keeps answered fields, trims them, and drops options that aren't on the list", () => {
    const form = new Map<string, string>([
      ["log_signer", "Finance"],
      ["log_frequency", "Weekly"],
      ["log_budget", "  Marketing, set each November  "],
      ["log_review_cost", ""],
    ]);
    expect(parseBuyerLog((key) => form.get(key))).toEqual({ signer: "Finance", budget: "Marketing, set each November" });
    expect(parseBuyerLog(() => null)).toBeNull();
  });
});
