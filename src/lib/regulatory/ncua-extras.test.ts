import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { chooseNcuaExtraLines, readNcuaExtras, topicOf } from "./ncua-extras";

const account = (code: string, name: string, description = name) => ({ code, name, description, table: "FS220" });

describe("NCUA extra topics", () => {
  it("files lines by NCUA's own description and skips unrelated ones", () => {
    expect(topicOf(account("ACCT_A", "Number of Share Drafts"))).toBe("account_counts");
    expect(topicOf(account("ACCT_B", "Number of full-time employees"))).toBe("employees");
    expect(topicOf(account("ACCT_C", "Overdraft fee income"))).toBe("fee_income");
    expect(topicOf(account("ACCT_D", "Number of loans to members"))).toBeNull();
    expect(topicOf(account("ACCT_E", "Employee benefits expense"))).toBeNull();
  });

  it("counts are counts and fee income is year to date", () => {
    const { lines } = chooseNcuaExtraLines([account("ACCT_A", "Number of Share Drafts"), account("ACCT_C", "Interchange income")]);
    expect(lines).toEqual([
      expect.objectContaining({ code: "ACCT_A", unit: "count", basis: "point_in_time" }),
      expect.objectContaining({ code: "ACCT_C", unit: "dollars", basis: "ytd" }),
    ]);
  });
});

describe("NCUA dividend and share-mix topics", () => {
  it("files dividend expense as year to date and share balances by type", () => {
    const lines = chooseNcuaExtraLines([
      { code: "ACCT_380", name: "Dividends on Shares", description: "Dividends on shares", table: "FS220A" },
      { code: "ACCT_902", name: "Share Drafts", description: "Share drafts", table: "FS220" },
      { code: "ACCT_452", name: "Number of Share Drafts", description: "Number of share draft accounts", table: "FS220" },
      { code: "ACCT_110", name: "Interest on Loans", description: "Interest on loans", table: "FS220A" },
    ]).lines;
    expect(lines.map((l) => [l.code, l.topic, l.basis])).toEqual([
      ["ACCT_380", "dividend_expense", "ytd"],
      ["ACCT_902", "share_mix", "point_in_time"],
      ["ACCT_452", "account_counts", "point_in_time"],
    ]);
  });
});

describe("readNcuaExtras", () => {
  it("loads nothing without the account description file", () => {
    const zip = zipSync({ "FS220.txt": strToU8("CU_NUMBER,ACCT_X\n1,5\n") });
    const read = readNcuaExtras(zip);
    expect(read.hasDescriptionFile).toBe(false);
    expect(read.values).toEqual([]);
  });

  it("reads the described lines and reports topics with nothing", () => {
    const zip = zipSync({
      "AcctDesc.txt": strToU8('Account,AcctName,AcctDesc,TableName\n"ACCT_564A","Employees","Number of full-time employees","FS220"\n"ACCT_999","Interchange income","Interchange income","FS220A"\n'),
      "FS220.txt": strToU8("CU_NUMBER,ACCT_564A\n100,25\n200,\n"),
    });
    const read = readNcuaExtras(zip);
    expect(read.values).toEqual([expect.objectContaining({ charter: "100", code: "ACCT_564A", key: "acct_564a", value: 25, unit: "count" })]);
    expect(read.linesNotInData).toEqual(["ACCT_999"]);
    expect(read.topicsWithoutLines).toEqual(["account_counts", "uninsured_shares", "fee_income", "dividend_expense", "share_mix"]);
  });

  it("reads AcctDesc.txt, not the trade-names file beside it (2026Q2 run)", () => {
    const zip = zipSync({
      "Acct-DescTradeNames.txt": strToU8("Account,AcctName,AcctDesc,TableName\n"),
      "AcctDesc.txt": strToU8('Account,AcctName,AcctDesc,TableName\n"ACCT_564A","Employees","Number of full-time employees","FS220"\n'),
      "FS220.txt": strToU8("CU_NUMBER,ACCT_564A\n100,25\n"),
    });
    const read = readNcuaExtras(zip);
    expect(read.descriptionFile).toBe("AcctDesc.txt");
    expect(read.values).toHaveLength(1);
  });
});
