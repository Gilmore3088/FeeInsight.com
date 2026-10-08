import { describe, expect, it } from "vitest";
import { unbackedNumbers } from "@/lib/agents/marketing/facts";
import {
  allowedNumbers,
  draftCaption,
  metroLabel,
  money,
  pickMarket,
  refusal,
  subjectKey,
  summarizeMarkets,
  type MarketRow,
  type MarketSpread,
} from "./market-spread";
import { themeFees } from "./calendar";

function rows(metro: string, fee: string, values: number[]): MarketRow[] {
  return values.map((amount, index) => ({ institution_id: `${metro}-${index}`.length * 1000 + index, cbsa_name: metro, fee_category: fee, amount }));
}

function spread(over: Partial<MarketSpread>): MarketSpread {
  return { feeCategory: "nsf", metro: "Miami-Fort Lauderdale-Pompano Beach, FL", institutions: 12, low: 10, high: 40, p25: 20, median: 30, p75: 35, zeros: 0, values: [], ...over };
}

describe("summarizeMarkets", () => {
  it("counts each institution once, overdraft at its highest tier", () => {
    const input: MarketRow[] = [
      { institution_id: 1, cbsa_name: "Tulsa, OK", fee_category: "overdraft", amount: 5 },
      { institution_id: 1, cbsa_name: "Tulsa, OK", fee_category: "overdraft", amount: 35 },
      { institution_id: 2, cbsa_name: "Tulsa, OK", fee_category: "overdraft", amount: 0 },
    ];
    const [result] = summarizeMarkets(input);
    expect(result.institutions).toBe(2);
    expect(result.values).toEqual([0, 35]);
    expect(result.zeros).toBe(1);
  });

  it("keeps metros and fees apart", () => {
    const result = summarizeMarkets([...rows("Tulsa, OK", "nsf", [10, 20]), ...rows("Tulsa, OK", "overdraft", [30]), ...rows("Boise City, ID", "nsf", [25])]);
    expect(result).toHaveLength(3);
  });
});

describe("refusal", () => {
  it("needs ten institutions and a $10 spread", () => {
    expect(refusal(spread({ institutions: 9 }))).toMatch(/9 institutions/);
    expect(refusal(spread({ low: 25, high: 30 }))).toMatch(/spread/);
    expect(refusal(spread({}))).toBeNull();
  });
});

describe("pickMarket", () => {
  it("prefers the widest middle half over one outlier", () => {
    const outlier = spread({ metro: "A, TX", low: 0, high: 90, p25: 30, p75: 32 });
    const real = spread({ metro: "B, TX", low: 10, high: 40, p25: 18, p75: 35 });
    expect(pickMarket([outlier, real], new Set())?.metro).toBe("B, TX");
  });

  it("skips a metro and fee featured recently", () => {
    const first = spread({ metro: "B, TX", p25: 10, p75: 35 });
    const second = spread({ metro: "C, TX", p25: 20, p75: 30 });
    expect(pickMarket([first, second], new Set([subjectKey(first)]))?.metro).toBe("C, TX");
  });

  it("returns null when nothing passes", () => {
    expect(pickMarket([spread({ institutions: 3 })], new Set())).toBeNull();
  });
});

describe("caption", () => {
  const asOf = new Date("2026-11-01T13:37:00Z");

  it("shortens metro names", () => {
    expect(metroLabel("Miami-Fort Lauderdale-Pompano Beach, FL")).toBe("Miami, FL");
    expect(metroLabel("Washington-Arlington-Alexandria, DC-VA-MD-WV")).toBe("Washington, DC");
  });

  it("prints whole dollars plainly and cents with two places", () => {
    expect(money(30)).toBe("$30");
    expect(money(12.5)).toBe("$12.50");
  });

  it("uses only the spread's own numbers and names no institution", () => {
    const s = spread({ low: 12.5, high: 38, p25: 18.5, p75: 35, institutions: 14, zeros: 0 });
    const draft = draftCaption(s, asOf);
    expect(unbackedNumbers(draft.body, allowedNumbers(s, asOf))).toEqual([]);
    expect(draft.body).toContain("$12.50 to $38");
    expect(draft.body).toContain("a $25.50 difference");
    expect(draft.body).not.toMatch(/cheap|expensive|raise|lower your|should/i);
    expect(draft.caption).toContain("utm_campaign=w1-market-spread");
  });

  it("ends on the free report, not a Hamilton page", () => {
    const draft = draftCaption(spread({}), asOf);
    expect(draft.link).toMatch(/^https:\/\/feeinsight\.com\/reports\?/);
    expect(draft.caption.endsWith(`Get a free fee report: ${draft.link}`)).toBe(true);
    expect(draft.caption).not.toMatch(/feeinsight\.com\/(fees|for-institutions|pro)\b/);
  });

  it("mentions free accounts only when some charge nothing", () => {
    expect(draftCaption(spread({ zeros: 2 }), asOf).body).toContain("2 charge nothing");
    expect(draftCaption(spread({ zeros: 0 }), asOf).body).not.toContain("charge nothing");
  });
});

describe("calendar", () => {
  it("uses the month's theme, else every featured fee", () => {
    expect(themeFees(new Date("2026-11-10T00:00:00Z"))).toContain("overdraft");
    expect(themeFees(new Date("2027-06-10T00:00:00Z")).length).toBeGreaterThan(5);
  });
});
