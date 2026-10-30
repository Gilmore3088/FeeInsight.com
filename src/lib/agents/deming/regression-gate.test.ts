import { describe, expect, it } from "vitest";
import fixture from "./__fixtures__/regression-cases.json";
import { replayCase } from "./checkers";
import { severityFor } from "./severity";
import { FIXTURE_CHECKS, type RegressionFixture } from "./regression-fixture";

/**
 * The CI gate: every confirmed production mistake in the fixture must still be caught by the
 * rule that caught it, with the same reason. A change that lets one back through fails here
 * before it can publish the fee again. The fixture is rebuilt from confirmed cases
 * (`regression-fixture.ts`, #2064); a case names its check (`check_name`, else its case key's).
 */
const cases = (fixture as RegressionFixture).cases;
const checkOf = (item: (typeof cases)[number]) => item.check_name ?? item.case_key.split(":").slice(2).join(":");

describe("Deming regression gate", () => {
  it("holds confirmed takedowns", () => {
    expect(cases.length).toBeGreaterThan(0);
    expect(new Set(cases.map((item) => item.case_key)).size).toBe(cases.length);
  });

  it.each(cases.map((item) => [item.case_key, item] as const))("%s is still caught", (_key, item) => {
    const replay = replayCase(item.input, checkOf(item));
    expect(replay).not.toBeNull();
    expect(replay?.caught).toBe(true);
    expect(replay?.verdict).toBe(item.expected_verdict);
  });

  it("records each case at the severity the scale gives it", () => {
    for (const item of cases) {
      const check = checkOf(item);
      expect(FIXTURE_CHECKS).toContain(check);
      expect(item.case_key.endsWith(`:${check}`)).toBe(true);
      expect(severityFor(check, `${item.error_class}:${item.expected_verdict}`)).toBe(item.severity);
    }
  });
});
