import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { text: string; values: unknown[] }[] = [];
const replies: unknown[][] = [];

vi.mock("./connection", () => ({
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("?"), values });
    return Promise.resolve(replies.shift() ?? []);
  }),
}));

import { getLocalMarketMembers } from "./custom-report-market";

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
