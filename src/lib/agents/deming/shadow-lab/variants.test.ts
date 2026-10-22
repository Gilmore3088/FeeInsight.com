// @vitest-environment node
import { describe, expect, it } from "vitest";
import { assertOfflineEnv } from "./env-guard";
import type { StageFee } from "./types";
import { toCents } from "./rows";
import { currentVariant, EXPERIMENTS, experimentalVariant, selectExperiment } from "./variants";

describe("shadow lab offline guard", () => {
  it("should_throw_when_DATABASE_URL_is_set", () => {
    expect(() => assertOfflineEnv({ DATABASE_URL: "postgres://x" })).toThrow(/offline/);
    expect(() => assertOfflineEnv({ E2E_DATABASE_URL: "postgres://x" })).toThrow(/offline/);
    expect(() => assertOfflineEnv({})).not.toThrow();
  });
});

describe("shadow lab variants", () => {
  it("should_refuse_a_limit_named_in_the_fee_at_the_publish_gate", () => {
    const text = "No Bounce Courtesy Pay Limit | $600.00";
    const fee = { canonicalFeeKey: "od_daily_cap", feeName: "No Bounce Courtesy Pay Limit", amountCents: 60000, frequency: null, excerpt: text, reason: null };
    expect(currentVariant.publishGate(fee, text, [])).toMatchObject({ publish: false, reason: expect.stringMatching(/Transaction limit/) });
  });

  it("should_refuse_a_limit_priced_in_the_line_only_with_the_excerpt_at_publish", () => {
    const text = "PROPERTY SEARCH | $58.00\n\nAPPRAISAL | $450.00 & up\n\nSATISFACTION | $68.75";
    const fee: StageFee = { canonicalFeeKey: "appraisal_fee", feeName: "APPRAISAL", amountCents: 45000, frequency: null, excerpt: "APPRAISAL | $450.00 & up", reason: null };
    expect(currentVariant.publishGate(fee, text, []).publish).toBe(true);
    expect(experimentalVariant(EXPERIMENTS["excerpt-at-publish"]).publishGate(fee, text, []).publish).toBe(false);
  });

  it("should_select_the_default_experiment", () => {
    expect(selectExperiment({}).id).toBe("hourly-at-verify");
    expect(() => selectExperiment({ SHADOW_LAB_EXPERIMENT: "nope" })).toThrow(/hourly-at-verify/);
  });

  it("should_round_money_to_cents", () => {
    expect(toCents("30.00")).toBe(3000);
    expect(toCents(29.999999)).toBe(3000);
    expect(toCents(null)).toBeNull();
  });

  it("should_publish_a_zero_fee_darwin_verified", () => {
    const text = "Online Bill Pay | $0.00";
    const fee = { canonicalFeeKey: "bill_pay", feeName: "Online Bill Pay", amountCents: 0, frequency: null, excerpt: text, reason: null };
    const verified = currentVariant.verify(fee, text);
    expect(verified.ok).toBe(true);
    if (verified.ok) expect(currentVariant.publishGate(verified.fee, text, [])).toEqual({ publish: true, reason: null });
  });

  it("should_drop_a_period_from_a_per_item_fee_as_darwin_does", () => {
    const text = "NSF Fee | $30.00";
    const fee = { canonicalFeeKey: "nsf", feeName: "NSF Fee", amountCents: 3000, frequency: "monthly", excerpt: text, reason: null };
    const verified = currentVariant.verify(fee, text);
    expect(verified.ok && verified.fee.frequency).not.toBe("monthly");
  });

  it("should_refuse_a_fee_its_source_does_not_state", () => {
    const fee = { canonicalFeeKey: "wire_domestic_outgoing", feeName: "Outgoing Wire", amountCents: 2500, frequency: null, excerpt: null, reason: null };
    expect(currentVariant.verify(fee, "Stop Payment | $30.00")).toEqual({ ok: false, reason: "not_in_source" });
  });

  it("should_read_hourly_only_in_the_hourly_experiment", () => {
    const text = "Account research | $25.00 per hour";
    const fee = { canonicalFeeKey: "account_research", feeName: "Account research", amountCents: 2500, frequency: null, excerpt: text, reason: null };
    const current = currentVariant.verify(fee, text);
    const experiment = experimentalVariant(EXPERIMENTS["hourly-at-verify"]).verify(fee, text);
    expect(current.ok && current.fee.frequency).not.toBe("hourly");
    expect(experiment.ok && experiment.fee.frequency).toBe("hourly");
  });
});
