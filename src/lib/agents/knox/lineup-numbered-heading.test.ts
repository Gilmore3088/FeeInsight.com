// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { opensOnNameNumber, printedNearerThan, withLineupFromText, type AccountLineup } from "./lineup";
import { runFreeSpecialists } from "./specialists";

/** The stored text of Farmers & Merchants Bank's personal checking page (inst 608, docs 34081/34667, from "Find the checking account"). */
const gofm = readFileSync(new URL("./__fixtures__/gofm-personal-checking-608.txt", import.meta.url), "utf8");
/** River Bank's stored checking page (inst 1027, doc 34897), the fee schedule block as stored. */
const river = readFileSync(new URL("./__fixtures__/river-bank-checking-1027.txt", import.meta.url), "utf8");

const read = (excerpt: string, feeName: string, amount: number) => ({
  canonicalHint: "monthly_maintenance", feeName, excerpt, amount, lineup: null as AccountLineup | null,
});

describe("Knox v141: an account heading that opens on its own number (inst 608)", () => {
  it("files 360 Checking's $8.00 fee under 360 Checking, not Gold Checking above it", () => {
    const fees = runFreeSpecialists(gofm).candidates
      .filter((fee) => fee.canonicalHint === "monthly_maintenance")
      .map((fee) => ({ amount: fee.amount, product: withLineupFromText(fee, gofm).lineup?.productName ?? null }));
    expect(fees).toContainEqual({ amount: 3, product: "Gold Checking" });
    expect(fees).toContainEqual({ amount: 8, product: "360 Checking" });
    expect(fees.some((fee) => fee.amount === 8 && fee.product === "Gold Checking")).toBe(false);
  });

  it("files River Bank's $7.00 fee under 50+ Checking, not Easy Checking (no monthly fees)", () => {
    const excerpt = "$7.00 monthly maintenance fee - Fee waived with $100.00 minimum daily balance";
    const lineup = withLineupFromText(read(excerpt, "monthly maintenance fee - Fee waived with minimum daily balance", 7), river).lineup;
    expect(lineup?.productName).toBe("50+ Checking");
  });

  it.each(["360 Checking", "50+ Interest Checking", "55 Plus Checking", "22nd State Checking", "1st Cashback Checking"])(
    "reads %s as the account above its fee", (heading) => {
      const excerpt = "$6.00 monthly service fee if balance falls below $500";
      const text = ["Classic Checking", "$4.00 monthly service fee", heading, "Minimum Opening Deposit", excerpt].join("\n\n");
      expect(withLineupFromText(read(excerpt, "monthly service fee", 6), text).lineup?.productName).toBe(heading);
    });

  it.each(["2026 Checking Account Fees", "Checking 12", "$25 Checking"])("still reads no name from %s", (line) => {
    const excerpt = "$6.00 monthly service fee if balance falls below $500";
    const text = [line, excerpt].join("\n\n");
    expect(withLineupFromText(read(excerpt, "monthly service fee", 6), text).lineup?.productName ?? null).not.toBe(line);
  });

  it("tells a numbered heading printed nearer the fee than the stored account", () => {
    const excerpt = "$8.00 monthly service fee, may be avoided if meet certain criteria.* Full waiver of fee if maintain daily balance of $20,000+";
    expect(printedNearerThan(gofm, excerpt, "360 Checking", "Gold Checking")).toBe(true);
    expect(printedNearerThan(gofm, excerpt, "Gold Checking", "360 Checking")).toBe(false);
    expect(printedNearerThan(gofm, "$3 monthly maintenance fee (may be avoided if maintain daily balance of $5,000+)", "360 Checking", "Gold Checking")).toBe(false);
    expect(opensOnNameNumber("360 Checking")).toBe(true);
    expect(opensOnNameNumber("Gold Checking")).toBe(false);
  });
});
