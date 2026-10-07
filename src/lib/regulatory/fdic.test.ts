import { describe, expect, it, vi } from "vitest";

import {
  assetSizeTier,
  fetchFdicFinancialsForQuarter,
  normalizeWebsite,
  parseFdicDate,
  parseFdicFinancial,
  parseFdicInstitution,
} from "./fdic";
import {
  latestPublishableQuarter,
  parseQuarterKey,
  quarterKey,
  quartersNewestFirst,
} from "./quarters";

// Live BankFind responses for JPMorgan Chase Bank (CERT 628), captured 2026-10-03.
const JPM_2026Q1 = {
  CERT: 628,
  REPDTE: "20260331",
  ASSET: 4016571000,
  DEP: 2787994000,
  LNLSNET: 1493977000,
  EQTOT: 335961000,
  SC: 821921000,
  NETINCQ: 13974000,
  NIMQ: 25316000,
  NONIIQ: 18541000,
  NONIXQ: 24045000,
  ISERCHGQ: 1672000,
  NTLNLSQ: 2320000,
  NCLNLS: 12861000,
  LNRE: 504275000,
  LNCI: 237720000,
  LNCON: 275044000,
  LNCRCD: 206178000,
  LNAUTO: 56741000,
  LNAG: 499000,
  COREDEP: 1976710000,
  BRO: 49354000,
  DEPUNINS: 1287930000,
  ROAQ: 1.44,
  NIMYQ: 2.92,
  NTLNLSR: 0.6151396608976333,
  NCLNLSR: 0.8462793254770151,
  RBC1AAJ: 7.625673239135933,
  RBC1RWAJ: 15.08,
  RBCRWAJ: 16.252939131154776,
  NUMEMP: 227258,
  OFFDOM: 5137,
  ID: "628_20260331",
};

const STATE_STREET_INSTITUTION = {
  ZIP: "02114",
  CBSA_NO: "14460",
  ACTIVE: 1,
  CHRTAGNT: "STATE",
  WEBADDR: "www.statestreet.com",
  ENDEFYMD: "12/31/9999",
  NAMEHCR: "STATE STREET CORP",
  FED: "01",
  REGAGNT: "FED",
  FED_RSSD: "35301",
  ASSET: 412620000,
  NAME: "State Street Bank and Trust Company",
  CITY: "Boston",
  INACTIVE: 0,
  RSSDHCR: "1111435",
  CERT: 14,
  STALP: "MA",
  ESTYMD: "01/01/1792",
};

describe("FDIC financial parser", () => {
  it("maps quarterly call-report fields to institution_financial_records columns in thousands", () => {
    const row = parseFdicFinancial(JPM_2026Q1, { year: 2026, quarter: 1 });

    expect(row).toMatchObject({
      cert: "628",
      report_date: "2026-03-31",
      total_assets: 4016571000,
      total_deposits: 2787994000,
      total_loans: 1493977000,
      total_equity: 335961000,
      // SC is total securities, never service charges.
      total_securities: 821921000,
      service_charge_income: 1672000,
      net_income: 13974000,
      net_interest_income: 25316000,
      other_noninterest_income: 18541000,
      noninterest_expense: 24045000,
      net_charge_offs: 2320000,
      loans_credit_card: 206178000,
      roa: 1.44,
      net_interest_margin: 2.92,
      leverage_ratio: 7.625673239135933,
      tier1_capital_ratio: 15.08,
      branch_count: 5137,
      employee_count: 227258,
    });
    expect(row?.total_revenue).toBe(25316000 + 18541000);
    expect(row?.fee_income_ratio).toBeCloseTo(1672000 / (25316000 + 18541000), 6);
  });

  it("keeps missing fields null instead of zero", () => {
    const row = parseFdicFinancial({ CERT: "9", ASSET: 1000 }, { year: 2010, quarter: 1 });
    expect(row?.service_charge_income).toBeNull();
    expect(row?.uninsured_deposits).toBeNull();
    expect(row?.total_revenue).toBeNull();
    expect(row?.fee_income_ratio).toBeNull();
  });

  it("drops records without a certificate", () => {
    expect(parseFdicFinancial({ ASSET: 1 }, { year: 2026, quarter: 1 })).toBeNull();
  });
});

describe("FDIC institution parser", () => {
  it("extracts identity, regulator, and tier", () => {
    expect(parseFdicInstitution(STATE_STREET_INSTITUTION)).toMatchObject({
      cert: "14",
      name: "State Street Bank and Trust Company",
      active: true,
      rssd_id: "35301",
      holding_company_rssd: "1111435",
      holding_company_name: "STATE STREET CORP",
      primary_regulator: "Federal Reserve",
      charter_agency: "State",
      state_code: "MA",
      website_url: "https://www.statestreet.com",
      asset_size_tier: "super_regional",
      fed_district: 1,
      established_date: "1792-01-01",
      closed_date: null,
    });
  });

  it("keeps only a real Fed district (1-12)", () => {
    expect(parseFdicInstitution({ ...STATE_STREET_INSTITUTION, FED: "12" })?.fed_district).toBe(12);
    expect(parseFdicInstitution({ ...STATE_STREET_INSTITUTION, FED: 0 })?.fed_district).toBeNull();
    expect(parseFdicInstitution({ ...STATE_STREET_INSTITUTION, FED: 13 })?.fed_district).toBeNull();
  });

  it("records the end date for an inactive institution", () => {
    const parsed = parseFdicInstitution({ ...STATE_STREET_INSTITUTION, ACTIVE: 0, ENDEFYMD: "04/15/2025" });
    expect(parsed?.active).toBe(false);
    expect(parsed?.closed_date).toBe("2025-04-15");
  });

  it("normalizes helpers", () => {
    expect(parseFdicDate("12/31/9999")).toBeNull();
    expect(normalizeWebsite("N/A")).toBeNull();
    expect(normalizeWebsite("http://bank.example/home")).toBe("http://bank.example/home");
    expect(assetSizeTier(299_999)).toBe("community_small");
    expect(assetSizeTier(1_000_000)).toBe("community_large");
    expect(assetSizeTier(250_000_000)).toBe("super_regional");
  });
});

describe("FDIC client", () => {
  it("requests one quarter by REPDTE and unwraps BankFind envelopes", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ meta: { total: 1 }, data: [{ data: JPM_2026Q1 }] }), { status: 200 }),
    );

    const page = await fetchFdicFinancialsForQuarter({ year: 2026, quarter: 1 }, { fetchImpl, backoffMs: 0 });

    expect(page.rows).toHaveLength(1);
    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe("https://api.fdic.gov/banks/financials");
    expect(url.searchParams.get("filters")).toBe("REPDTE:20260331");
    expect(url.searchParams.get("fields")).toContain("ISERCHGQ");
    expect(fetchImpl.mock.calls[0][1].headers["User-Agent"]).toContain("hello@bankfeeindex.com");
  });

  it("retries transient upstream errors", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ meta: { total: 0 }, data: [] }), { status: 200 }));

    const page = await fetchFdicFinancialsForQuarter({ year: 2026, quarter: 2 }, { fetchImpl, backoffMs: 0 });

    expect(page.rows).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fails fast on a non-retryable status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("bad", { status: 400 }));
    await expect(
      fetchFdicFinancialsForQuarter({ year: 2026, quarter: 2 }, { fetchImpl, backoffMs: 0 }),
    ).rejects.toThrow("HTTP 400");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("quarters", () => {
  it("finds the newest publishable quarter after the filing lag", () => {
    expect(quarterKey(latestPublishableQuarter(new Date("2026-10-03T00:00:00Z"), 30))).toBe("2026Q2");
    expect(quarterKey(latestPublishableQuarter(new Date("2026-11-05T00:00:00Z"), 30))).toBe("2026Q3");
  });

  it("lists quarters newest first across year boundaries", () => {
    const keys = quartersNewestFirst({ year: 2025, quarter: 3 }, { year: 2026, quarter: 1 }).map(quarterKey);
    expect(keys).toEqual(["2026Q1", "2025Q4", "2025Q3"]);
    expect(parseQuarterKey("2010q1")).toEqual({ year: 2010, quarter: 1 });
    expect(parseQuarterKey("2010Q5")).toBeNull();
  });
});
