import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { text: string; values: unknown[] }[] = [];
const replies: unknown[][] = [];

vi.mock("./connection", () => ({
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("?"), values });
    return Promise.resolve(replies.shift() ?? []);
  }),
}));

import { getLocalMarketMembers, maintenanceLineIsNotChecking, recordSourceLine, reportRowProblem } from "./custom-report-market";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { FEE_LINE_RULES } from "@/lib/custom-report/rules";
import { evidenceProblem } from "@/lib/custom-report/evidence";

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

describe("recordSourceLine (Hancock Whitney, rows 66419 and 66411, read 17 Oct 2026)", () => {
  // The stored text of source document 19615, cut to the two places it states $36 for overdraft.
  const text = [
    "Customers who do not qualify as a direct deposit. | Sustained Overdraft Fee of $36.00. This fee is charged when an account remains overdrawn",
    "On Us Check Cashing Fee** | $9.00",
    "Overdraft Charge/Overdraft Fee (each item) | $36.00",
    "Nonsufficient Funds Charge (NSF Charge or NSF Fee) each item | $36.00",
    "Stop Payment Fee | $36.00",
    "Sustained Overdraft Fee | $36.00",
  ].join("\n");
  const excerpt = "Overdraft Charge/Overdraft Fee (each item) | $36.00";
  const sustained = "not qualify as a direct deposit. | Sustained Overdraft Fee of $36.00. This";

  it("keeps the per-item overdraft fee in, on the line it was read from", () => {
    const line = recordSourceLine("overdraft", sustained, excerpt, 36, text);
    expect(line).toBe(excerpt);
    expect(evidenceProblem("overdraft", { product: "Overdraft Charge/Overdraft Fee (each item)", amount: 36, quote: line, source_url: "https://www.hancockwhitney.com/hubfs/Forms/Access-TISA.pdf" })).toBeNull();
    // The shared check alone passes on the document and the record's own excerpt.
    const include = FEE_LINE_RULES.find((r) => r.key === "overdraft")!.include;
    expect(checkFeeAgainstSource(text, "Overdraft Charge/Overdraft Fee (each item)", 36, include).ok).toBe(true);
  });

  it("keeps the checked line when the excerpt is not on that document or does not label the fee", () => {
    expect(recordSourceLine("overdraft", sustained, excerpt, 36, "Sustained Overdraft Fee of $36.00")).toBe(sustained);
    expect(recordSourceLine("overdraft", sustained, null, 36, text)).toBe(sustained);
    // TD's "$3 monthly fee" excerpt must not hide the paper statement fee its line names (row 64716).
    const td = "Paper statements | $3 monthly fee | Free for customers aged 60+, otherwise $3 monthly fee";
    expect(recordSourceLine("monthly_maintenance", td, "$3 monthly fee | Free for customers aged 60+, otherwise $3 monthly fee", 3, td)).toBe(td);
  });
});
