import { describe, expect, it } from "vitest";
import { verifiedFrequency } from "./verify";

describe("verifiedFrequency (#1456: hourly read at verify)", () => {
  it("should_read_an_hourly_price_from_the_fee_s_own_line", () => {
    expect(verifiedFrequency("Account balancing assistance .... $25.00 per hour, $25.00 minimum", 25, null, "account_research")).toBe("hourly");
    expect(verifiedFrequency("Research | $20.00/hr", 20, "per_item", "account_research")).toBe("hourly");
  });

  it("should_not_read_hourly_in_a_category_never_charged_by_the_hour", () => {
    expect(verifiedFrequency("Monthly Fee: (per hour) | $25", 25, null, "monthly_maintenance")).not.toBe("hourly");
  });

  it("should_leave_a_flat_line_flat", () => {
    expect(verifiedFrequency("Stop Payment | $30.00", 30, null, "stop_payment")).toBeNull();
    expect(verifiedFrequency("24 hour ATM access fee | $2.00", 2, null, "atm_non_network")).not.toBe("hourly");
  });

  it("should_keep_nsf_per_item_as_before", () => {
    expect(verifiedFrequency("NSF Fee | $30.00", 30, "monthly", "nsf")).not.toBe("monthly");
  });

  it("should_keep_the_stated_frequency_when_there_is_no_amount", () => {
    expect(verifiedFrequency("Rate | 1%", null, "per_item", "card_foreign_txn")).toBe("per_item");
  });

  it("should_leave_a_stated_or_printed_period_to_a_person_as_the_live_sweep_does", () => {
    // hourlyVerdict exempts these (period_word, stated_period); verify does the same.
    expect(verifiedFrequency("Research | $25.00 per hour, monthly", 25, "monthly", "account_research")).not.toBe("hourly");
    expect(verifiedFrequency("Safe deposit drilling | $150.00 per hour", 150, "annual", "safe_deposit_box")).not.toBe("hourly");
    expect(verifiedFrequency("Research | $25.00 per hour", 25, "monthly", "account_research")).not.toBe("hourly");
  });
});
