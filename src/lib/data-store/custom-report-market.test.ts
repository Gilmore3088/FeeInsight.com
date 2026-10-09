import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { text: string; values: unknown[] }[] = [];
const replies: unknown[][] = [];

vi.mock("./connection", () => ({
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("?"), values });
    return Promise.resolve(replies.shift() ?? []);
  }),
}));

import { getLocalMarketMembers, maintenanceLineIsNotChecking, reportRowProblem } from "./custom-report-market";

function countyQuery(): string {
  const query = calls.find((call) => call.text.includes("hq AS ("));
  if (!query) throw new Error("market county query not run");
  return query.text.replace(/\s+/g, " ");
}

describe("market counties", () => {
  beforeEach(() => {
    calls.length = 0;
    replies.length = 0;
  });

  it("picks headquarters-city counties in a fixed order: most branches, then deposits, then county code", async () => {
    replies.push([{ id: 7, city: "Houston", state_code: "TX", cert_number: "6672", charter_type: "credit_union" }], []);
    expect(await getLocalMarketMembers(7)).toBeNull();
    const hq = countyQuery().split("hq AS (")[1];
    expect(hq).toMatch(/ORDER BY COUNT\(\*\) DESC, SUM\(COALESCE\(b\.deposits, 0\)\) DESC, b\.county_fips::text LIMIT \?/);
  });

  it("never matches a credit union's charter number against FDIC branch certs", async () => {
    replies.push([{ id: 7, city: "Fairmont", state_code: "WV", cert_number: "6672", charter_type: "credit_union" }], []);
    await getLocalMarketMembers(7);
    const county = calls.find((call) => call.text.includes("hq AS ("));
    expect(county?.values.slice(0, 2)).toEqual([null, null]);
    expect(county?.values).not.toContain("6672");
  });

  it("matches a bank's own branches by its FDIC cert", async () => {
    replies.push([{ id: 19, city: "Cincinnati", state_code: "OH", cert_number: "6672", charter_type: "bank" }], []);
    await getLocalMarketMembers(19);
    const county = calls.find((call) => call.text.includes("hq AS ("));
    expect(county?.values.slice(0, 2)).toEqual(["6672", "6672"]);
  });
});

describe("whole-record problems that keep a published row out of a report", () => {
  it("leaves out a fee waiting on its takedown second look", () => {
    expect(reportRowProblem({ fee_name: "Overdraft Fee", takedown_pending: true })).toBe("takedown_pending");
  });

  it("leaves out a business price but not a fee that mentions business days", () => {
    expect(reportRowProblem({ fee_name: "Business Wire Transfer Incoming (domestic)" })).toBe("business_price");
    expect(reportRowProblem({ fee_name: "Wire Transfer Incoming (same business day)" })).toBeNull();
  });

  it("leaves out a name that is a cut sentence", () => {
    expect(reportRowProblem({ fee_name: "to open the account. A Maintenance Service Charge of" })).toBe("name_fragment");
    expect(reportRowProblem({ fee_name: "at all times. If you do not, a monthly fee of" })).toBe("name_fragment");
  });

  it("keeps a clean consumer fee", () => {
    expect(reportRowProblem({ fee_name: "Overdraft/Non-sufficient Funds (NSF)", takedown_pending: false })).toBeNull();
  });
});

describe("monthly maintenance compares checking only", () => {
  it("leaves out a monthly fee stated on a savings or money market line", () => {
    const savings = "Advantages Money Market Savings: a $1,000 minimum daily balance is required to avoid a monthly fee of $10.";
    expect(maintenanceLineIsNotChecking("monthly_maintenance", savings)).toBe(true);
  });

  it("keeps a checking maintenance charge and other lines", () => {
    const checking = "A Maintenance Service Charge of $8.95 each statement cycle applies to this account.";
    expect(maintenanceLineIsNotChecking("monthly_maintenance", checking)).toBe(false);
    expect(maintenanceLineIsNotChecking("overdraft", "Savings overdraft $29")).toBe(false);
  });
});
