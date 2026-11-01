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

  it("shows a competitor's one fee as its price and several fees as their range with names (#1931)", () => {
    const several: LocalMarketAnswer = {
      ...data,
      categories: ["overdraft", "garnishment"],
      competitors: [
        { ...data.competitors[0], fees: { overdraft: 35 } },
        {
          ...data.competitors[1],
          fees: { overdraft: 25, garnishment: 162.5 },
          several: { garnishment: { low: 150, high: 175, fees: [{ name: "Levy", amount: 150 }, { name: "Garnishment", amount: 175 }] } },
        },
      ],
    };
    const html = renderToStaticMarkup(<LocalMarketView data={several} />);
    expect(html).toContain("$35");
    expect(html).toContain("$150 to $175");
    expect(html).toContain("Levy $150; Garnishment $175");
    expect(html).not.toContain("$162.50");
  });

  it("counts a several-fee competitor in the headline by its one value, and shows its range in the table (#1931)", () => {
    const levy = { low: 150, high: 175, fees: [{ name: "Levy", amount: 150 }, { name: "Garnishment", amount: 175 }] };
    const counted: LocalMarketAnswer = {
      ...data,
      categories: ["nsf"],
      you: { ...data.you, fees: { nsf: 160 } },
      competitors: [
        { ...data.competitors[0], fees: { nsf: 170 } },
        { ...data.competitors[1], fees: { nsf: 162.5 }, several: { nsf: levy } },
      ],
    };
    const html = renderToStaticMarkup(<LocalMarketView data={counted} />);
    expect(html).toContain("Of 2 competitors with a nsf / returned item fee on file, 2 are higher than Test Credit Union’s $160 and 0 lower");
    expect(html).toContain("$150 to $175");
    expect(html).not.toContain("$162.50");
    expect(html).not.toContain("single");
  });
});

describe("sister charters that share one fee schedule (statistics rule 7, #1441)", () => {
  it("counts the Laredo-shaped group once in the fee headline, but every charter in the presence title", () => {
    // Test figures only: three charters of one holding company publish one $30 schedule.
    const sisters: LocalMarketAnswer = {
      ...data,
      competitors: [
        { institutionId: 160, name: "Sister Laredo", charterType: "bank", branches: 9, deposits: 900, fees: { overdraft: 35 } },
        { institutionId: 1319, name: "Sister Commerce", charterType: "bank", branches: 8, deposits: 800, fees: { overdraft: 35 }, countedAs: { overdraft: 160 } },
        { institutionId: 1769, name: "Sister Zapata", charterType: "bank", branches: 7, deposits: 700, fees: { overdraft: 35 }, countedAs: { overdraft: 160 } },
        { institutionId: 50, name: "Rival A", charterType: "bank", branches: 6, deposits: 600, fees: { overdraft: 25 } },
      ],
    };
    const html = renderToStaticMarkup(<LocalMarketView data={sisters} />);
    expect(html).toContain("4 institutions compete with Test Credit Union in the Testville, FL area");
    expect(html).toContain("Of 2 competitors with an overdraft fee on file, 1 is higher than Test Credit Union’s $30 and 1 lower");
    for (const name of ["Sister Laredo", "Sister Commerce", "Sister Zapata", "Rival A"]) expect(html).toContain(name);
  });
});
