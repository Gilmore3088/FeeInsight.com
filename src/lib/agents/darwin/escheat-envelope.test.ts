import { describe, expect, it } from "vitest";
import {
  amountEnvelopeFor,
  ESCHEAT_ENVELOPE,
  ESCHEAT_HOLD_REREAD_LIVE,
  escheatProcessingNameSql,
  isEscheatProcessingName,
  nameEnvelopeLabel,
  withinAmountEnvelope,
} from "./envelopes";
import { darwinStandingDecisionSql } from "./verify";
import { inNameAwareEnvelopeSql } from "@/lib/agents/hamilton/outlier-rollback";
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

describe("abandoned and unclaimed property is escheat processing (#1110)", () => {
  // Lines from the banks' own stored schedules (agent_source_texts, prod, read Oct 30), each held by
  // Darwin as outside_envelope under the $1-$30 monthly dormant range.
  const heldLines: Array<[string, number, string]> = [
    ["Abandoned Property Fee", 50, "Personal Fee Schedule ... Item | Fee\nAbandoned Property Fee* | $50.00"],
    ["Abandoned Account Processing", 100, "Transfer Fee | $5.00\nAbandoned Account Processing | $100.00"],
    ["Abandoned Property, per account or such lesser rate as may be set by law", 65, "Abandoned Property, per account or such lesser rate\nas may be set by law......$65.00"],
    ["Abandoned Account Fee", 50, "Abandoned Account Fee | $50 if escheatment is required"],
    ["Inactive Abandoned Property Fee – share or share draft accounts inactive for over 3 years", 50, "Inactive Abandoned Property Fee – share or share draft accounts inactive for over 3 years | $50.00"],
    ["Abandoned Account Processing", 50, "Abandoned Account Processing | $ 50.00"],
  ];

  it("should_take_the_escheat_range_for_abandoned_property_names_with_the_switch_on", () => {
    for (const [name, amount, line] of heldLines) {
      expect(line).toContain(String(amount));
      expect(isEscheatProcessingName(name, true), name).toBe(true);
      expect(nameEnvelopeLabel("dormant_account", name, true), name).toBe("escheat");
      expect(withinAmountEnvelope("dormant_account", amount, name, true), name).toBe(true);
      expect(amountEnvelopeFor("dormant_account", name, true)).toEqual(ESCHEAT_ENVELOPE);
    }
    expect(isEscheatProcessingName("Unclaimed Funds Fee", true)).toBe(true);
    expect(isEscheatProcessingName("Unclaimed Property", true)).toBe(true);
  });

  it("should_keep_todays_ranges_while_the_switch_is_off", () => {
    expect(ESCHEAT_HOLD_REREAD_LIVE).toBe(false);
    for (const [name, amount] of heldLines) {
      expect(withinAmountEnvelope("dormant_account", amount, name), name).toBe(false);
      expect(withinAmountEnvelope("dormant_account", amount, name, false), name).toBe(false);
    }
    expect(withinAmountEnvelope("dormant_account", 50, "Escheatment Fee", false)).toBe(true);
  });

  it("should_keep_the_monthly_range_for_a_name_charged_by_the_month", () => {
    // "15 Dormant/Abandoned Account Fee – Per Month .... $15.00" (inst 4613): a monthly charge.
    expect(isEscheatProcessingName("15 Dormant/Abandoned Account Fee – Per Month", true)).toBe(false);
    expect(withinAmountEnvelope("dormant_account", 45, "Abandoned Account Fee (monthly)", true)).toBe(false);
    expect(withinAmountEnvelope("dormant_account", 45, "Abandoned Account $5/mo", true)).toBe(false);
    expect(withinAmountEnvelope("dormant_account", 50, "Dormant Account Fee", true)).toBe(false);
  });

  it("should_not_widen_other_categories_for_an_abandoned_name", () => {
    expect(amountEnvelopeFor("money_order", "Abandoned Cashier’s Checks & Money Orders", true)).toEqual(amountEnvelopeFor("money_order"));
    expect(amountEnvelopeFor("safe_deposit_box", "Drilling (abandoned box, etc.)", true)).toEqual(amountEnvelopeFor("safe_deposit_box"));
  });

  it("should_write_the_same_names_in_sql", () => {
    expect(escheatProcessingNameSql("fr.fee_name", false)).toBe("fr.fee_name ~* '\\mescheat'");
    const on = escheatProcessingNameSql("fr.fee_name", true);
    expect(on).toContain("fr.fee_name ~* '\\mescheat'");
    expect(on).toContain("fr.fee_name ~* '\\m(abandon(ed)?\\s+(propert(y|ies)|accounts?|funds?)|unclaimed\\s+(propert(y|ies)|funds?))\\M'");
    expect(on).toContain("fr.fee_name !~* '(\\m(per\\s+month|monthly|a\\s+month|each\\s+month)\\M|/\\s*mo(nth)?\\M)'");
  });

  it("should_reread_held_escheat_processing_only_with_the_switch_on", () => {
    const off = darwinStandingDecisionSql(true, false);
    const on = darwinStandingDecisionSql(true, true);
    expect(off).not.toContain("pa.detail->>'canonical_fee_key' = 'dormant_account'");
    expect(on).toContain("pa.detail->>'canonical_fee_key' = 'dormant_account'");
    expect(on).toContain(escheatProcessingNameSql("fr.fee_name", true));
    expect(on).toContain("(pa.detail->>'amount')::numeric BETWEEN 1 AND 150");
    expect(darwinStandingDecisionSql(true)).toBe(off);
  });

  it("should_judge_the_live_rollback_by_the_same_names", () => {
    expect(inNameAwareEnvelopeSql(false)).toContain(
      "WHEN fp.canonical_fee_key = 'dormant_account' AND fp.fee_name ~* '\\mescheat' THEN fp.amount BETWEEN 1 AND 150",
    );
    expect(inNameAwareEnvelopeSql(true)).toContain(
      `WHEN fp.canonical_fee_key = 'dormant_account' AND ${escheatProcessingNameSql("fp.fee_name", true)} THEN fp.amount BETWEEN 1 AND 150`,
    );
    expect(inNameAwareEnvelopeSql()).toBe(inNameAwareEnvelopeSql(false));
  });
});
