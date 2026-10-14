import { describe, expect, it } from "vitest";
import fixture from "./__fixtures__/regression-cases.json";
import { replayCase, type CaseInput } from "./checkers";
import { severityFor } from "./severity";
import { LIMIT_GUARD_CHECK } from "@/lib/agents/hamilton/limit-guard";

/**
 * The CI gate: every confirmed production mistake in the fixture must still be caught by the
 * rule that caught it, with the same reason. A change that lets one back through fails here
 * before it can publish the fee again.
 */
interface FixtureCase {
  case_key: string;
  severity: string;
  error_class: string;
  expected_verdict: string;
  input: CaseInput;
}

const cases = (fixture as { cases: FixtureCase[] }).cases;

describe("Deming regression gate", () => {
  it("holds confirmed takedowns", () => {
    expect(cases.length).toBeGreaterThan(0);
    expect(new Set(cases.map((item) => item.case_key)).size).toBe(cases.length);
  });

  it.each(cases.map((item) => [item.case_key, item] as const))("%s is still caught", (_key, item) => {
    const replay = replayCase(item.input);
    expect(replay).not.toBeNull();
    expect(replay?.caught).toBe(true);
    expect(replay?.verdict).toBe(item.expected_verdict);
  });

  it("records each case at the severity the scale gives it", () => {
    for (const item of cases) {
      const check = item.case_key.split(":").slice(2).join(":");
      expect(check).toBe(LIMIT_GUARD_CHECK);
      expect(severityFor(check, `${item.error_class}:${item.expected_verdict}`)).toBe(item.severity);
    }
  });
});
