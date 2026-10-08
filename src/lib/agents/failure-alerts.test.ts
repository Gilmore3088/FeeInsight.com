import { describe, expect, it } from "vitest";

import { attemptAlerts, mergeStepAlerts, sourceCheckCoverageAlert, stepAlerts, stepStreakAlerts } from "./failure-alerts";

describe("failure alerts", () => {
  it("flags a strategy whose attempts mostly error, with the reason (2026-10-05 OCR outage)", () => {
    const alerts = attemptAlerts([
      {
        strategy: "read.ocr_tesseract",
        stage: "read",
        broken: 8,
        total: 11,
        latest_error: "OCR failed: Error: Cannot find module 'tesseract.js-core/tesseract-core-relaxedsimd'",
        latest_at: "2026-10-05T05:50:00Z",
      },
      { strategy: "read.html_dom", stage: "read", broken: 2, total: 1121, latest_error: "bad markup", latest_at: null },
    ]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ key: "attempt:read.ocr_tesseract", failures: 8, total: 11 });
    expect(alerts[0].message).toContain("8 of 11");
    expect(alerts[0].message).toContain("73%");
    expect(alerts[0].message).toContain("Cannot find module");
  });

  it("flags a step type that mostly fails, and ignores a few scattered failures", () => {
    const alerts = stepAlerts([
      { step_key: "read", failed: 61, total: 70, latest_error: "Database connection timed out", latest_at: "2026-10-04T19:55:00Z" },
      { step_key: "classify", failed: 2, total: 2, latest_error: "x", latest_at: null },
      { step_key: "publish", failed: 3, total: 50, latest_error: "x", latest_at: null },
    ]);
    expect(alerts.map((alert) => alert.key)).toEqual(["step:read"]);
    expect(alerts[0].message).toContain("Database connection timed out");
  });

  it("flags every state with live fees left unchecked against the bank's schedule (2026-10-06)", () => {
    const alerts = sourceCheckCoverageAlert([
      { state_code: "NY", institutions: 40 },
      { state_code: "TX", institutions: 3 },
    ]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].key).toBe("coverage:source_check");
    expect(alerts[0].message).toContain("43 institutions in 2 states");
    expect(alerts[0].message).toContain("NY 40, TX 3");
    expect(sourceCheckCoverageAlert([])).toEqual([]);
  });

  it("flags a step type whose recent steps all failed, even when older successes keep the share low (2026-10-08)", () => {
    const streaks = stepStreakAlerts([
      { step_key: "publish", failed: 5, latest_error: 'column "fee_category" can only be updated to DEFAULT', latest_at: "2026-10-08T12:20:50Z", since: "2026-10-08T12:06:45Z" },
      { step_key: "read", failed: 2, latest_error: "x", latest_at: null, since: null },
    ]);
    expect(streaks.map((alert) => alert.key)).toEqual(["step:publish"]);
    expect(streaks[0].message).toContain("The last 5");
    expect(streaks[0].message).toContain("since 12:06 UTC");
    expect(streaks[0].message).toContain("fee_category");

    // 5 of 43 in two hours is under the rate bar; the streak alone raises it, once.
    const rates = stepAlerts([{ step_key: "publish", failed: 5, total: 43, latest_error: "x", latest_at: null }]);
    expect(rates).toEqual([]);
    const both = mergeStepAlerts(streaks, stepAlerts([{ step_key: "publish", failed: 5, total: 6, latest_error: "x", latest_at: null }]));
    expect(both.map((alert) => alert.key)).toEqual(["step:publish"]);
  });
});
