import { describe, expect, it } from "vitest";

import { lowestPerBank, medianWithCount, parseFhlbSeriesKey, rateMove, termDays, type FhlbRate } from "./fhlb-advance-rates-aggregates";

describe("FHLB advance rate reads", () => {
  it("splits series keys, including bank names with a hyphen", () => {
    expect(parseFhlbSeriesKey("fhlb_des_moines_fixed_rate_1y")).toEqual({ bank: "des-moines", product: "fixed_rate", term: "1y" });
    expect(parseFhlbSeriesKey("fhlb_boston_classic_advance_overnight")).toEqual({ bank: "boston", product: "classic_advance", term: "overnight" });
    expect(parseFhlbSeriesKey("fhlb_boston_fixed_1_5y")).toEqual({ bank: "boston", product: "fixed", term: "1_5y" });
    expect(parseFhlbSeriesKey("fhlb_gotham_fixed_1y")).toBeNull();
    expect(parseFhlbSeriesKey("permits_units_total")).toBeNull();
  });

  it("orders terms by length", () => {
    expect(termDays("overnight")).toBe(1);
    expect(termDays("3m")).toBe(90);
    expect(termDays("1_5y")).toBe(548);
    expect(termDays("odd")).toBeNull();
  });

  it("gives a median only with enough banks, always with the count", () => {
    expect(medianWithCount([4.1, 4.3])).toEqual({ median: null, count: 2 });
    expect(medianWithCount([4.1, 4.3, 4.2, 4.6])).toEqual({ median: 4.25, count: 4 });
  });

  it("measures a move only against a posting old enough", () => {
    const rows = [
      { period: "2026-10-15", value: 4.4 },
      { period: "2026-10-14", value: 4.45 },
      { period: "2026-09-14", value: 4.7 },
    ];
    expect(rateMove("s", rows, 30)).toMatchObject({ prior_date: "2026-09-14", change: -0.3 });
    expect(rateMove("s", rows.slice(0, 2), 30)).toMatchObject({ prior_date: null, change: null });
    expect(rateMove("s", [], 30)).toBeNull();
  });

  it("takes each bank's lowest percent rate at the term", () => {
    const base = { bank_name: null, product_label: null, term: "1y", term_label: null, posted_date: "2026-10-15", note: null, source_url: null };
    const rates: FhlbRate[] = [
      { ...base, bank: "boston", product: "classic", value: 4.2, unit: "percent" },
      { ...base, bank: "boston", product: "amortizing", value: 4.0, unit: "percent" },
      { ...base, bank: "boston", product: "sofr_spread_bps", value: 1, unit: "basis_points" },
      { ...base, bank: "dallas", product: "fixed", value: 4.1, unit: "percent" },
      { ...base, bank: "topeka", product: "fixed", value: null, unit: "percent" },
    ];
    const out = lowestPerBank("1y", rates);
    expect(out.banks.map((b) => [b.bank, b.lowest_rate, b.product])).toEqual([
      ["boston", 4.0, "amortizing"],
      ["dallas", 4.1, "fixed"],
    ]);
    expect(out).toMatchObject({ median: null, bank_count: 2 });
  });
});
