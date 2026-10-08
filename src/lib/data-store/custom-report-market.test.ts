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
});
