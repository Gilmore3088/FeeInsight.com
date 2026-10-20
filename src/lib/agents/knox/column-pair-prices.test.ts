// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runFreeSpecialists } from "./specialists";

// #1916: Advia FCU's stored text (doc 32751, text 30743), read by Knox v93 into three live fees
// at another column's $10 (142239, 142241, 142248).
const advia = readFileSync(new URL("../../custom-report/__fixtures__/advia-two-column-source.txt", import.meta.url), "utf8");

describe("Knox reads each column's own price on Advia's two-column page (#1916)", () => {
  const result = runFreeSpecialists(advia);
  const read = (name: string) => result.candidates.filter((row) => row.feeName === name).map((row) => row.amount);

  it("never files the right column's '$10.00 monthly for average' under the left column's names", () => {
    expect(read("ATM Transactions")).not.toContain(10);
    expect(read("ATM Transactions (non-Advia CU")).not.toContain(10);
    expect(read("Garnishment/Tax Levy/Subpoena")).not.toContain(10);
  });

  it("never gives Member-Requested ATM/Debit the $10 printed under Account Reopen", () => {
    expect(read("Member-Requested ATM/Debit")).not.toContain(10);
  });

  it("keeps the page's single-column rows", () => {
    expect(read("Card Rush Order")).toEqual([30]);
    expect(read("Cashier’s Check")).toEqual([5]);
    expect(result.candidates.filter((row) => row.feeName === "3x5").map((row) => row.amount)).toEqual([35]);
  });
});
