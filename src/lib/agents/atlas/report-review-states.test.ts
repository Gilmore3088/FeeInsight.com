import { describe, expect, it } from "vitest";

import { reportReviewStates } from "./report-review-states";

describe("report-review states", () => {
  const requests = [{ stateCode: "tn", until: "2026-10-19" }];

  it("boosts a state through its end day", () => {
    expect(reportReviewStates(new Date("2026-10-12T08:00:00Z"), requests)).toEqual(["TN"]);
    expect(reportReviewStates(new Date("2026-10-19T23:59:00Z"), requests)).toEqual(["TN"]);
  });

  it("drops the boost after its end day (#1117)", () => {
    expect(reportReviewStates(new Date("2026-10-20T00:00:00Z"), requests)).toEqual([]);
  });
});
