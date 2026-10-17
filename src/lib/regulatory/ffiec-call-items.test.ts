import { strToU8 } from "fflate";
import { describe, expect, it } from "vitest";

import { schedulePattern } from "./ffiec";
import { describes, FFIEC_CALL_ITEMS, readFfiecCallItems } from "./ffiec-call-items";

const tsv = (rows: string[][]) => strToU8(rows.map((r) => r.map((c) => `"${c}"`).join("\t")).join("\n"));
const item = (key: string) => FFIEC_CALL_ITEMS.find((i) => i.key === key)!;

describe("schedulePattern", () => {
  it("keeps the named schedules and their split parts only", () => {
    const re = schedulePattern(["RI", "RIBI", "RCN"]);
    expect(re.test("FFIEC CDR Call Schedule RI 06302026.txt")).toBe(true);
    expect(re.test("FFIEC CDR Call Schedule RIBI 06302026.txt")).toBe(true);
    expect(re.test("FFIEC CDR Call Schedule RCN(1 of 2) 06302026.txt")).toBe(true);
    expect(re.test("FFIEC CDR Call Schedule RIA 06302026.txt")).toBe(false);
    expect(re.test("FFIEC CDR Call Schedule RCO 06302026.txt")).toBe(false);
    // The bulk zip puts the part marker after the date; 2026Q1 missed RC-O this way.
    expect(schedulePattern(["RCO"]).test("FFIEC CDR Call Schedule RCO 03312026(1 of 2).txt")).toBe(true);
  });
});

describe("description checks", () => {
  it("matches the abbreviated descriptions in the 2026Q1 bulk file", () => {
    expect(describes(item("consumer_maintenance_charges_ytd"), "SEV CHAR DEP DOM OFF MAIN IND")).toBe(true);
    expect(describes(item("other_deposit_service_charges_ytd"), "SEV CHAR DEP DOM OFF ALL IND")).toBe(true);
    expect(describes(item("consumer_noninterest_transaction_deposits"), "NONINTR TRN ACCTS INDIV HSHLD FMLY")).toBe(true);
    expect(describes(item("consumer_interest_transaction_deposits"), "INTR TRN ACCTS INDIV HSHLD FMLY")).toBe(true);
    expect(describes(item("consumer_interest_transaction_deposits"), "NONINTR TRN ACCTS INDIV HSHLD FMLY")).toBe(false);
    expect(describes(item("consumer_money_market_deposits"), "MMDA DEPS PRIMRLY INDIV HSHLD FAMLY")).toBe(true);
    expect(describes(item("consumer_money_market_deposits"), "OTHR MMDA INDIV PRTNRS CORPS")).toBe(false);
    expect(describes(item("consumer_other_savings_deposits"), "OTHR SVGS DEPS IND HSHLD FAMILY USE")).toBe(true);
    expect(describes(item("charge_offs_other_consumer_ytd"), "CHARGE-OFFS ALL OTHER")).toBe(true);
    expect(describes(item("charge_offs_other_consumer_ytd"), "RECOVERIES ALL OTHER")).toBe(false);
    expect(describes(item("recoveries_other_consumer_ytd"), "RECOVERIES ALL OTHER")).toBe(true);
  });

  it("keeps charge-off and recovery columns apart", () => {
    expect(describes(item("charge_offs_credit_card_ytd"), "CREDIT CARD CHARGE-OFFS")).toBe(true);
    expect(describes(item("charge_offs_credit_card_ytd"), "CREDIT CARD RECOVERIES")).toBe(false);
    expect(describes(item("recoveries_credit_card_ytd"), "CREDIT CARD RECOVERIES")).toBe(true);
    expect(describes(item("recoveries_credit_card_ytd"), "CREDIT CARD CHARGE-OFFS")).toBe(false);
  });

  it("tells account amounts from account counts", () => {
    const amount = item("deposits_250k_or_less_amount");
    expect(describes(amount, "AMOUNT OF DEPOSIT ACCOUNTS (EXCLUDING RETIREMENT ACCOUNTS) OF $250,000 OR LESS")).toBe(true);
    expect(describes(amount, "NUMBER OF DEPOSIT ACCOUNTS (EXCLUDING RETIREMENT ACCOUNTS) OF $250,000 OR LESS")).toBe(false);
  });
});

describe("readFfiecCallItems", () => {
  const files = {
    "FFIEC CDR Call Schedule RI 06302026.txt": tsv([
      ["IDRSSD", "RIADH032", "RIADH033", "RIADH034"],
      ["", "CONSUMER OVERDRAFT-RELATED SERVICE CHARGES", "CONSUMER ACCOUNT PERIODIC MAINTENANCE CHARGES", "SOMETHING ELSE ENTIRELY"],
      ["852218", "2500", "700", "40"],
      ["480228", "", "", "12"],
    ]),
    "FFIEC CDR Call Schedule RCN 06302026.txt": tsv([
      ["IDRSSD", "RCFD1406", "RCON1406"],
      ["", "TOTAL LOANS PAST DUE 30 THROUGH 89 DAYS", "TOTAL LOANS PAST DUE 30 THROUGH 89 DAYS"],
      ["852218", "9000", "8800"],
      ["480228", "", "310"],
    ]),
  };

  it("loads a line only when its code and description both check out", () => {
    const read = readFfiecCallItems(files);
    const status = (code: string) => read.columns.find((c) => c.code === code)?.status;
    expect(status("RIADH033")).toBe("loaded");
    expect(status("RIADH034")).toBe("description_mismatch");
    expect(status("RIADH035")).toBe("not_in_file");
    expect(read.values.filter((v) => v.key === "consumer_atm_fees_ytd")).toEqual([]);
  });

  it("leaves blank cells out and takes RCFD before RCON", () => {
    const read = readFfiecCallItems(files);
    const pick = (rssd: string, key: string) => read.values.find((v) => v.rssd === rssd && v.key === key);
    expect(pick("852218", "consumer_maintenance_charges_ytd")).toMatchObject({ value: 700, unit: "thousands", basis: "ytd" });
    expect(pick("480228", "consumer_maintenance_charges_ytd")).toBeUndefined();
    expect(pick("852218", "loans_past_due_30_89")).toMatchObject({ code: "RCFD1406", value: 9000 });
    expect(pick("480228", "loans_past_due_30_89")).toMatchObject({ code: "RCON1406", value: 310 });
  });

  it("counts banks whose consumer charge-offs exceed the total", () => {
    const read = readFfiecCallItems({
      "FFIEC CDR Call Schedule RIBI 06302026.txt": tsv([
        ["IDRSSD", "RIAD4635", "RIADB514"],
        ["", "TOTAL CHARGE-OFFS", "CREDIT CARD CHARGE-OFFS"],
        ["1", "100", "60"],
        ["2", "100", "160"],
      ]),
    });
    expect(read.chargeOffPartsOverTotal).toBe(1);
  });

  it("loads a shared candidate code only for the line its description fits, and refuses ambiguous ones", () => {
    const read = readFfiecCallItems({
      "FFIEC CDR Call Schedule RIE 12312025.txt": tsv([
        ["IDRSSD", "RIADC013", "RIADC016", "RIADF555", "RIADF556"],
        ["", "INCOME AND FEES FROM THE PRINTING AND SALE OF CHECKS", "INCOME AND FEES FROM AUTOMATED TELLER MACHINES (ATMS)", "BANK CARD AND CREDIT CARD INTERCHANGE FEES", "OTHER INTERCHANGE INCOME"],
        ["1", "5", "70", "300", "9"],
      ]),
    });
    const value = (key: string) => read.values.find((v) => v.key === key);
    expect(value("check_printing_income_ytd")).toMatchObject({ code: "RIADC013", value: 5 });
    expect(value("atm_income_ytd")).toMatchObject({ code: "RIADC016", value: 70 });
    expect(value("interchange_fees_ytd")).toBeUndefined();
    expect(read.columns.filter((c) => c.key === "interchange_fees_ytd" && c.status === "ambiguous")).toHaveLength(2);
  });
});
