import { describe, expect, it } from "vitest";

import { PROD_NON_CHECKING_SQL } from "./__fixtures__/non-checking-account-names-2026-10-26";
import { accountKind, accountKindSql, isNonCheckingAccount, nonCheckingAccountSql } from "./account-kind";
import { namesNoAccountSql } from "./account-name-exclusions";

describe("accountKind (#1100, #1912)", () => {
  it("reads the kind a name says, first rule first", () => {
    expect(accountKind("M&T Preferred Money Market")).toBe("money_market");
    expect(accountKind("Money Market Checking")).toBe("money_market");
    expect(accountKind("Advantage Checking")).toBe("checking");
    expect(accountKind("Business Money Market")).toBe("business");
    expect(accountKind("12 Month Certificate")).toBe("ira_hsa_cd");
    expect(accountKind("Holiday Club")).toBe("club");
    expect(accountKind("Money Tree Kids Club")).toBe("savings");
    expect(accountKind("Statement Savings")).toBe("savings");
    expect(accountKind("Regular Share Draft")).toBe("checking");
    expect(accountKind("Premier Account")).toBeNull();
    expect(accountKind(null)).toBeNull();
  });

  it("calls savings, money market, certificate, IRA, HSA and club accounts non-checking", () => {
    for (const name of ["M&T Preferred Money Market", "Statement Savings", "Christmas Club", "Traditional IRA", "12 Month CD", "Share Term Certificates"]) {
      expect(isNonCheckingAccount(name), name).toBe(true);
    }
    for (const name of ["Advantage Checking", "Business Savings", "Premier Account", "", null, "Truth in Savings", "Hotel Savings Network", "Free Bangor Savings Bank Debit Mastercard®", "Health Savings Card"]) {
      expect(isNonCheckingAccount(name), String(name)).toBe(false);
    }
  });

  it("agrees with PostgreSQL on every live account name it might apply to (prod, 2026-10-26)", () => {
    expect(PROD_NON_CHECKING_SQL.length).toBeGreaterThan(100);
    for (const [name, sqlSays] of PROD_NON_CHECKING_SQL) expect(isNonCheckingAccount(name), name).toBe(sqlSays);
  });

  it("states the same rules in SQL, static columns only", () => {
    const kind = accountKindSql("ef.account_product_type");
    expect(kind).toContain("WHEN ef.account_product_type ~* '\\ymoney\\s*market\\y|\\ymmda\\y' THEN 'money_market'");
    expect(kind).toContain("kids?''?s?");
    expect(kind.indexOf("'business'")).toBeLessThan(kind.indexOf("'money_market'"));
    expect(kind.indexOf("'checking'")).toBeLessThan(kind.indexOf("'savings'"));
    expect(nonCheckingAccountSql("ef.account_product_type")).toBe(
      `COALESCE(NOT ${namesNoAccountSql("ef.account_product_type")} AND ${kind} IN ('money_market', 'ira_hsa_cd', 'club', 'savings'), false)`,
    );
    expect(namesNoAccountSql("ef.x")).toContain("\\ytruth[\\s-]+in[\\s-]+savings");
    expect(namesNoAccountSql("ef.x")).not.toContain("\\b");
    expect(() => accountKindSql("ef.x; drop")).toThrow();
    expect(() => namesNoAccountSql("x")).toThrow();
  });
});
