import { describe, expect, it } from "vitest";
import { amountEnvelopeFor, withinAmountEnvelope } from "./envelopes";
import { darwinEnvelopeFor } from "./learned-envelopes";
import { passesDarwinChecks } from "@/lib/agents/knox/layout";

describe("escheat processing priced as a one-time charge", () => {
  it("should_allow_escheat_fees_above_the_monthly_dormant_ceiling", () => {
    // Shadow lab answer keys (#2536): "Escheatment | $50.00", "Escheatment processing $ 100.00".
    expect(withinAmountEnvelope("dormant_account", 50, "Escheatment")).toBe(true);
    expect(withinAmountEnvelope("dormant_account", 100, "Escheatment processing")).toBe(true);
    expect(darwinEnvelopeFor("dormant_account", new Map(), "Escheat Processing Fee").max).toBe(amountEnvelopeFor("dormant_account", "Escheat").max);
    expect(passesDarwinChecks("dormant_account", "Escheats – after 3 years", 50)).toBe(true);
  });

  it("should_keep_the_monthly_dormant_ceiling_for_other_names", () => {
    // "Dormant Account (Per month/maximum) | $5.00/$60.00": $60 is a cap, not the fee.
    expect(withinAmountEnvelope("dormant_account", 60, "Dormant Account (after 12 months) (Service Charge) (Per maximum)")).toBe(false);
    expect(withinAmountEnvelope("dormant_account", 60)).toBe(false);
    expect(darwinEnvelopeFor("dormant_account", new Map()).max).toBe(30);
  });

  it("should_not_widen_other_categories_for_an_escheat_name", () => {
    expect(amountEnvelopeFor("stop_payment", "Escheat stop")).toEqual(amountEnvelopeFor("stop_payment"));
  });
});
