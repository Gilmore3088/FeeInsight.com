import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocalMarketView } from "./local-market";
import type { LocalMarketAnswer } from "@/lib/hamilton/local-market-answer";

// Test figures only.
const data: LocalMarketAnswer = {
  institutionId: 1,
  institutionName: "Test Credit Union",
  charterType: "credit_union",
  market: { label: "Testville, FL area", basis: "hq_city", sodYear: 2026, countyCount: 1 },
  you: { branches: 30, branchesInMarket: 20, depositsInMarket: null, cities: [{ city: "Testville", state: "FL", branches: 12, lat: null, lon: null }], fees: { overdraft: 30 } },
  marketDeposits: 10_000_000_000,
  marketBranches: 80,
  competitors: [
    { institutionId: 2, name: "Test Bank A", charterType: "bank", branches: 12, deposits: 2_000_000_000, fees: { overdraft: 35 } },
    { institutionId: 3, name: "Test Credit Union B", charterType: "credit_union", branches: 9, deposits: null, fees: { overdraft: 25 } },
  ],
  categories: ["overdraft", "nsf"],
  sources: [],
  map: null,
  colours: {},
  network: null,
  unmapped: 0,
};

describe("LocalMarketView", () => {
  it("draws the market, the bank's cities and the fee grid against its own price", () => {
    const html = renderToStaticMarkup(<LocalMarketView data={data} />);
    expect(html).toContain("2 institutions compete with Test Credit Union in the Testville, FL area");
    expect(html).toContain("Test Credit Union (research subject)");
    expect(html).toContain("$2.0B");
    expect(html).toContain("20.0%");
    expect(html).toContain("Test Credit Union has the most branches here (20); Test Bank A is next with 12");
    expect(html).toContain("Of 2 competitors with an overdraft fee on file, 1 is higher than Test Credit Union’s $30 and 1 lower");
    expect(html).toContain('class="rd-exhibit"');
    expect(html).toContain("Testville, FL");
    expect(html).toContain('aria-label="higher than the research subject"');
    expect(html).toContain('aria-label="lower than the research subject"');
    expect(html).not.toContain("NSF");
    expect(html).not.toMatch(/\b(?:Your|your|with you|\(you\))\b/);
  });
});
