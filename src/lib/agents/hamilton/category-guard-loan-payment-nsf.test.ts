// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

// The other lending guard accepts every name today, so a refusal is simulated: any name with
// "REFUSED" in it. Darwin's verdict and Hamilton's pass-through read the same guard.
vi.mock("@/lib/fee-category-guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/fee-category-guard")>();
  return {
    ...actual,
    checkFeeCategory: (key: string, name: string | null | undefined, ...rest: unknown[]) =>
      key === "other_lending_fee" && /REFUSED/.test(name ?? "")
        ? { ok: false, code: "name_contradicts", reason: "simulated refusal" }
        : (actual.checkFeeCategory as (...args: unknown[]) => unknown)(key, name, ...rest),
  };
});
import { loanPaymentNsfOwnedByDarwin } from "./category-guard";
import { loanPaymentNsfVerdict } from "@/lib/agents/darwin/loan-payment-nsf-refile-check";

const cenlar = "» NSF mortgage payment: Additional Cenlar charge";

describe("Hamilton's category guard leaves a bounced loan payment to Darwin only when Darwin acts on it", () => {
  it("off by default: nothing is left to Darwin", () => {
    expect(loanPaymentNsfOwnedByDarwin("nsf", cenlar)).toBe(false);
  });

  it("on: a name the other lending guard accepts is Darwin's (re-file or twin takedown)", () => {
    expect(loanPaymentNsfOwnedByDarwin("nsf", cenlar, true)).toBe(true);
    expect(loanPaymentNsfOwnedByDarwin("nsf", "NSF Loan Payment", true)).toBe(true);
    expect(loanPaymentNsfOwnedByDarwin("overdraft", cenlar, true)).toBe(false);
    expect(loanPaymentNsfOwnedByDarwin("nsf", "NSF check/Loan Payment", true)).toBe(false);
  });

  it("on: a name the other lending guard refuses falls through to Hamilton's own re-file and takedown", () => {
    const refused = "NSF Loan Payment REFUSED";
    expect(loanPaymentNsfOwnedByDarwin("nsf", refused, true)).toBe(false);
    const row = { fee_published_id: 1, fee_verified_id: 2, institution_id: 3, amount: "25.00", canonical_fee_key: "nsf", lending_twin_id: null };
    expect(loanPaymentNsfVerdict({ ...row, fee_name: refused })?.outcome).toBe("refused");
    // Every fee Hamilton leaves to Darwin is one Darwin re-files or takes down.
    expect(loanPaymentNsfVerdict({ ...row, fee_name: cenlar })?.outcome).toBe("refile");
    expect(loanPaymentNsfVerdict({ ...row, fee_name: cenlar, lending_twin_id: 9 })?.outcome).toBe("twin");
  });
});
