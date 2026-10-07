import { describe, expect, it } from "vitest";
import {
  FINANCIAL_SOURCES,
  FINANCIAL_SOURCES_SQL,
  financialSourceFilter,
  isFinancialSource,
} from "./financial-sources";

describe("financial sources", () => {
  it("reads fdic and ncua rows only, never ffiec", () => {
    expect(FINANCIAL_SOURCES).toEqual(["fdic", "ncua"]);
    expect(FINANCIAL_SOURCES_SQL).toBe("('fdic', 'ncua')");
    expect(isFinancialSource("FDIC")).toBe(true);
    expect(isFinancialSource("ncua")).toBe(true);
    expect(isFinancialSource("ffiec")).toBe(false);
  });

  it("builds the SQL filter, with or without a table alias", () => {
    expect(financialSourceFilter("inf")).toBe("inf.source IN ('fdic', 'ncua')");
    expect(financialSourceFilter()).toBe("source IN ('fdic', 'ncua')");
  });
});
