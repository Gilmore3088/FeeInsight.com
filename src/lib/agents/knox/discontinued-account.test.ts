import { describe, expect, it } from "vitest";
import { runFreeSpecialists } from "./specialists";

// #2070: rows priced for accounts the bank no longer offers, beside the current schedule's rows.
const SCHEDULE = [
  "Personal Fee Schedule",
  "Stop Payment Fee | $30.00",
  "Overdraft Fee | $32.00",
  "Monthly Service Charge (80 Suffix) daily balance below $500 | $5.00 (this account no longer offered)",
  "",
  "Retired Accounts (no longer available on new memberships)",
  "Gold Rewards Checking",
  "Paper Statement Fee | $4.00",
  "",
  "Wire Transfer Fees",
  "Domestic Outgoing Wire | $25.00",
].join("\n");

describe("Knox v107: a discontinued account's row is not a current fee (#2070)", () => {
  const { candidates } = runFreeSpecialists(SCHEDULE, { institutionName: "Example Bank" });

  it("no specialist read of a discontinued row passes the self-check", () => {
    expect(candidates.some((fee) => fee.amount === 5)).toBe(false);
    expect(candidates.some((fee) => fee.amount === 4)).toBe(false);
  });

  it("reads the same rows when nothing says the account is closed", () => {
    const current = SCHEDULE.replace(" (this account no longer offered)", "").replace("Retired Accounts (no longer available on new memberships)", "Gold Accounts");
    const read = runFreeSpecialists(current, { institutionName: "Example Bank" }).candidates;
    expect(read.some((fee) => fee.amount === 5)).toBe(true);
    expect(read.some((fee) => fee.amount === 4)).toBe(true);
  });

  it("still reads the current rows", () => {
    expect(candidates.some((fee) => fee.amount === 30)).toBe(true);
    expect(candidates.some((fee) => fee.amount === 25)).toBe(true);
  });
});
