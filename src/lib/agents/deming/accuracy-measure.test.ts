import { describe, expect, it } from "vitest";
import { ACCURACY_DAILY_SAMPLE, ACCURACY_WEEKLY_MIN_SCORABLE, accuracyStatus, formatAccuracyBound, poolFreshAudits, wilsonRange, type AccuracyEvent, type AuditObservation } from "./accuracy-measure";

export function auditEvent(at: string, observations: AuditObservation[], versions: Record<string, unknown> = {}): AccuracyEvent {
  const counts = (verdict: string) => observations.filter(([, v]) => v === verdict).length;
  return { at, detail: {
    reporting_version: 1, version: 5, category_guard_version: 75, source_check_version: 18, name_check_version: 23,
    seed: at.slice(0, 10), right: counts("right"), sampled: observations.length, no_text: counts("unknown"), scorable: observations.length - counts("unknown"),
    amount_miss: counts("amount"), category_miss: counts("category"), evidence_miss: counts("evidence"), not_a_fee: counts("notAFee"), name_miss: counts("name"), observations,
    ...versions,
  } };
}

const rightFees = (n: number, start = 1): AuditObservation[] => Array.from({ length: n }, (_, i) => [start + i, "right"]);

describe("accuracy confidence and sampling contract (#2071)", () => {
  it("sizes a seven-day sample for a 99.5% rate at less than a quarter-point interval half-width", () => {
    expect(ACCURACY_DAILY_SAMPLE * 7).toBeGreaterThanOrEqual(ACCURACY_WEEKLY_MIN_SCORABLE);
    const n = ACCURACY_WEEKLY_MIN_SCORABLE;
    const interval = wilsonRange(Math.floor(n * 0.995), n)!;
    expect((interval.high - interval.low) / 2).toBeLessThan(0.0025);
    expect(wilsonRange(1393, 1400)!.low).toBeLessThan(0.995);
    expect(wilsonRange(0, 0)).toBeNull();
    expect(wilsonRange(11, 10)).toBeNull();
  });

  it("never says met from a 99.5% point estimate or even a perfect but undersized sample", () => {
    const n = ACCURACY_WEEKLY_MIN_SCORABLE;
    expect(accuracyStatus({ series: "1.5.75.18.23", scorable: n, range: wilsonRange(Math.floor(n * 0.995), n) })).toBe("not_met");
    expect(accuracyStatus({ series: "1.5.75.18.23", scorable: 200, range: wilsonRange(200, 200) })).toBe("insufficient");
    expect(accuracyStatus({ series: "1.5.75.18.23", scorable: n, range: wilsonRange(n, n) })).toBe("met");
    expect(accuracyStatus({ series: null, scorable: 10000, range: wilsonRange(10000, 10000) })).toBe("legacy");
  });

  it("counts a retry of the same seeded draw once, using its latest completed result", () => {
    const first = auditEvent("2026-10-18T01:00:00Z", rightFees(500));
    const retry = auditEvent("2026-10-18T02:00:00Z", [[1, "amount"], ...rightFees(499, 2)]);
    const result = poolFreshAudits([first, retry]);
    expect(result).toMatchObject({ right: 499, scorable: 500, audits: 1, duplicateDraws: 1, status: "insufficient", misses: { amount: 1 } });
  });

  it("counts a fee repeated on another day once, including a newer unknown instead of its older pass", () => {
    const result = poolFreshAudits([
      auditEvent("2026-10-17T01:00:00Z", [[1, "right"], [2, "right"], [3, "category"]]),
      auditEvent("2026-10-18T01:00:00Z", [[1, "unknown"], [2, "amount"], [4, "right"]]),
    ]);
    expect(result).toMatchObject({ sampled: 4, right: 1, scorable: 3, unknown: 1, repeatedFees: 2, audits: 2, misses: { amount: 1, category: 1 } });
  });

  it("only pools the latest scoring series and retains other versions in the dated history", () => {
    const result = poolFreshAudits([
      auditEvent("2026-10-17T01:00:00Z", rightFees(500)),
      auditEvent("2026-10-18T01:00:00Z", [[501, "amount"]], { category_guard_version: 76 }),
    ]);
    expect(result).toMatchObject({ right: 0, scorable: 1, audits: 1, excludedAudits: 1, series: "1.5.76.18.23" });
    expect(result.daily).toHaveLength(2);
  });

  it("preserves old or malformed receipts as legacy counts with no confidence or target claim", () => {
    const invalid = auditEvent("2026-10-18T01:00:00Z", rightFees(500), { right: 600 });
    const duplicateUnit = auditEvent("2026-10-19T01:00:00Z", [[1, "right"], [1, "right"]]);
    const legacy = poolFreshAudits([{ at: "2026-10-17T01:00:00Z", detail: { right: 190, scorable: 200 } }]);
    expect(legacy).toMatchObject({ right: 190, scorable: 200, range: null, series: null, status: "legacy" });
    expect(poolFreshAudits([invalid]).scorable).toBe(0);
    expect(poolFreshAudits([duplicateUnit])).toMatchObject({ series: null, range: null, status: "legacy" });
  });

  it("does not round the lower bound before deciding whether a near miss met the target", () => {
    expect(accuracyStatus({ series: "1.5.75.18.23", scorable: 10000, range: { low: 0.99499999, high: 1 } })).toBe("not_met");
    expect(formatAccuracyBound(0.99499999, "low")).toBe("99.49%");
    expect(formatAccuracyBound(0.99499999, "high")).toBe("99.50%");
  });
});
