// @vitest-environment node
import { describe, expect, it } from "vitest";
import { assertOfflineEnv } from "./env-guard";
import { toCents } from "./rows";
import { currentVariant, selectExperiment } from "./variants";

describe("shadow lab offline guard", () => {
  it("should_throw_when_DATABASE_URL_is_set", () => {
    expect(() => assertOfflineEnv({ DATABASE_URL: "postgres://x" })).toThrow(/offline/);
    expect(() => assertOfflineEnv({ E2E_DATABASE_URL: "postgres://x" })).toThrow(/offline/);
    expect(() => assertOfflineEnv({})).not.toThrow();
  });
});

describe("shadow lab variants", () => {
  it("should_read_a_limit_line_through_the_current_variant", () => {
    const text = "PROPERTY SEARCH | $58.00\n\nAPPRAISAL | $450.00 & up\n\nSATISFACTION | $68.75";
    const verified = currentVariant
      .extract(text)
      .passed.map((fee) => currentVariant.verify(fee, text))
      .flatMap((result) => (result.ok ? [result.fee] : []));
    expect(verified.some((fee) => fee.amountCents === 45000)).toBe(false);
  });

  it("should_select_the_default_experiment", () => {
    expect(selectExperiment({}).id).toBe("source-check-gate");
    expect(() => selectExperiment({ SHADOW_LAB_EXPERIMENT: "nope" })).toThrow(/source-check-gate/);
  });

  it("should_round_money_to_cents", () => {
    expect(toCents("30.00")).toBe(3000);
    expect(toCents(29.999999)).toBe(3000);
    expect(toCents(null)).toBeNull();
  });
});
