/**
 * A deliberately small set of NCUA 5300 lines for Hamilton. Codes and meanings checked against
 * the publisher's AcctDesc.txt in the 2023Q1/Q2, 2024Q4 and 2026Q2 archives, not inferred from FFIEC
 * labels. Discovery confirms comparable resident rows before advertising any of these keys.
 * https://ncua.gov/files/publications/analysis/call-report-data-2026-06.zip
 */
export interface NcuaCallMeasure {
  key: string;
  code: string;
  name: string;
  description: string;
  storedUnit: "count" | "dollars";
  unit: "count" | "USD";
  periodBasis: "point_in_time" | "ytd";
  caveat: string;
}

export const NCUA_CALL_MEASURES: readonly NcuaCallMeasure[] = [
  {
    key: "acct_452", code: "ACCT_452", name: "Share-draft account count",
    description: "Number of credit union share-draft (checking) accounts.",
    storedUnit: "count", unit: "count", periodBasis: "point_in_time",
    caveat: "Quarter-end accounts, not members or customers; one member can hold multiple accounts.",
  },
  {
    key: "acct_902", code: "ACCT_902", name: "Share-draft balances",
    description: "Dollar balance of credit union share-draft (checking) accounts.",
    storedUnit: "dollars", unit: "USD", periodBasis: "point_in_time",
    caveat: "Quarter-end balance, not deposits received during the quarter or a fee price.",
  },
  {
    key: "acct_657", code: "ACCT_657", name: "Regular-share balances",
    description: "Dollar balance of credit union regular-share (savings) accounts.",
    storedUnit: "dollars", unit: "USD", periodBasis: "point_in_time",
    caveat: "Quarter-end balance, not deposits received during the quarter or a fee price.",
  },
  {
    key: "acct_564a", code: "ACCT_564A", name: "Full-time employees",
    description: "Credit union staffing: number of employees working 26 hours or more per week.",
    storedUnit: "count", unit: "count", periodBasis: "point_in_time",
    caveat: "Quarter-end employee headcount under NCUA's 26-hour threshold, not full-time equivalents (FTEs).",
  },
  {
    key: "acct_380", code: "ACCT_380", name: "Dividends on shares",
    description: "Member share funding cost: year-to-date dividend expense on all classes of credit union shares.",
    storedUnit: "dollars", unit: "USD", periodBasis: "ytd",
    caveat: "Year-to-date funding expense, not fee income, a dividend rate or a standalone quarter. Do not annualize it.",
  },
  {
    key: "acct_131", code: "ACCT_131", name: "Fee income",
    description: "Year-to-date credit union revenue from service and membership fees.",
    storedUnit: "dollars", unit: "USD", periodBasis: "ytd",
    caveat: "Broad year-to-date institutional revenue, not a consumer fee price, overdraft-only income or an FFIEC service-charge equivalent. Do not annualize it.",
  },
];

export function ncuaCallMeasure(itemKey: string): NcuaCallMeasure | undefined {
  return NCUA_CALL_MEASURES.find((measure) => measure.key === itemKey);
}
