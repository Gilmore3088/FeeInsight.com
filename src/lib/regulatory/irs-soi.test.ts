import { describe, expect, it, vi } from "vitest";

import { fetchIrsZipIncome, irsSoiZipUrl, parseIrsZipCsv } from "./irs-soi";

const CSV = [
  "STATEFIPS,STATE,zipcode,agi_stub,N1,N2,A00100,A00200,N00300,A00300,A00600,N59660",
  "01,AL,00000,0,2100000,4300000,130000000,90000000,500000,1500000,2000000,450000",
  "01,AL,35004,0,5300,10200,330000,250000,1100,2100,3000,900",
  "25,MA,2139,0,21000,30000,3100000,2200000,9000,45000,120000,1200",
  "25,MA,99999,0,500,900,20000,15000,10,20,30,40",
  "",
].join("\n");

describe("IRS SOI ZIP parser", () => {
  it("keeps ZIP rows, pads ZIPs and skips state totals", () => {
    const rows = parseIrsZipCsv(CSV, 2022);
    expect(rows.map((r) => r.zip)).toEqual(["35004", "02139"]);
    expect(rows[1]).toEqual({
      tax_year: 2022,
      zip: "02139",
      state: "MA",
      state_fips: "25",
      returns: 21000,
      individuals: 30000,
      agi_thousands: 3100000,
      wages_thousands: 2200000,
      interest_returns: 9000,
      taxable_interest_thousands: 45000,
      dividends_thousands: 120000,
      eitc_returns: 1200,
    });
  });

  it("uses only the all-incomes row when a file has income brackets", () => {
    const text = ["STATEFIPS,STATE,zipcode,agi_stub,N1", "01,AL,35004,1,100", "01,AL,35004,2,200"].join("\n");
    expect(parseIrsZipCsv(text, 2022)).toHaveLength(0);
  });

  it("names files by two-digit tax year", () => {
    expect(irsSoiZipUrl(2022)).toBe("https://www.irs.gov/pub/irs-soi/22zpallnoagi.csv");
  });

  it("returns null for a year not yet published", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>Page not found</html>", { status: 200 }));
    expect(await fetchIrsZipIncome(2030, { fetchImpl: fetchImpl as unknown as typeof fetch, retries: 0 })).toBeNull();
  });
});
