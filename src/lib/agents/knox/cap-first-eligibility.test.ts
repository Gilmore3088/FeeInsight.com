// @vitest-environment node
import { describe, expect, it } from "vitest";
import { capFirstEligibility } from "./cap-first-eligibility";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";

const price = "NSF Fee\n• $140 Maximum. $5 per item";

describe("#2304 source-owned cap-first applicability", () => {
  it.each(["Youth Checking Account", "Senior Checking", "Student Accounts", "Business Accounts"])(
    "holds the literal restriction %s without inventing a product", heading => {
      const text = `${heading}\n${price}`;
      expect(capFirstEligibility(text, "NSF Fee", 5, "nsf")).toEqual({
        kind: "hold", canonicalKey: "nsf", ownText: "NSF Fee | • $140 Maximum. $5 per item", context: heading,
      });
      // Price support remains true; it is not applicability/publication authority.
      expect(checkFeeAgainstSource(text, "NSF Fee", 5, ".", "nsf").ok).toBe(true);
    },
  );

  it("matches a model name's transport case/colon without changing source price grammar", () => {
    expect(capFirstEligibility(`Youth Checking Account\n${price}`, "nsf fee:", 5, "nsf"))
      .toMatchObject({ kind: "hold", context: "Youth Checking Account" });
  });

  it("declines an unknown section rather than silently turning it into a standard price", () => {
    expect(capFirstEligibility(`Youth Checking Account\nAdditional terms continue\n${price}`, "NSF Fee", 5, "nsf"))
      .toEqual({ kind: "decline", reason: "cap_scope_unknown" });
  });

  it("leaves an explicit General reset and the standard Oakwood own price unchanged", () => {
    expect(capFirstEligibility(`Youth Checking Account\nGeneral Fees\n${price}`, "NSF Fee", 5, "nsf")).toBeNull();
    expect(capFirstEligibility("Overdraft Fee Savings\n• $140.00 Maximum. $35.00 per item", "Overdraft Fee Savings", 35, "overdraft")).toBeNull();
  });

  it("does not treat the cap amount as an item fee or create another price witness", () => {
    const text = `Youth Checking Account\n${price}`;
    expect(capFirstEligibility(text, "NSF Fee", 140, "nsf")).toBeNull();
    expect(checkFeeAgainstSource(text, "NSF Fee", 140, ".", "nsf").ok).toBe(false);
  });

  it("declines a conflicting caller category instead of silently reclassifying it", () => {
    expect(capFirstEligibility(`Youth Checking Account\n${price}`, "NSF Fee", 5, "overdraft"))
      .toEqual({ kind: "decline", reason: "cap_category_mismatch" });
  });

  it("does not borrow scope from a different amount, fee name or non-cap own row", () => {
    const text = `Youth Checking Account\n${price}\nGeneral Fees\nStop Payment Fee | $5\nNSF Fee | $30`;
    expect(capFirstEligibility(text, "Stop Payment Fee", 5, "stop_payment")).toBeNull();
    expect(capFirstEligibility(text, "NSF Fee", 30, "nsf")).toBeNull();
    expect(capFirstEligibility(text, "NSF Fee", 5, "nsf")).toMatchObject({ kind: "hold" });
  });

  it.each([
    `Youth Checking Account\n${price}\nGeneral Fees\n${price}`,
    `Youth Checking Account\n${price}\nGeneral Fees\nNSF Fee | $5.00`,
    `Youth Checking Account\n${price}\nGeneral Fees\nNSF Fee\n• $5.00 per item`,
  ])("declines an indistinguishable same-name same-price physical occurrence", text => {
    expect(capFirstEligibility(text, "NSF Fee", 5, "nsf"))
      .toEqual({ kind: "decline", reason: "cap_scope_ambiguous" });
  });

  it("leaves ordinary repeated standard prices outside this scope-only repair", () => {
    expect(capFirstEligibility(`${price}\n${price}`, "NSF Fee", 5, "nsf")).toBeNull();
    expect(capFirstEligibility("NSF Fee | $5 per item", "NSF Fee", 5, "nsf")).toBeNull();
  });
});
