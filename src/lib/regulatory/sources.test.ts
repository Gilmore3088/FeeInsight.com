import { readFileSync } from "node:fs";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import { aggregationBuckets, fetchCfpbCompanyBreakdown, normalizeCompanyName } from "./cfpb";
import { parseFdicSod } from "./fdic";
import { isFredNativeSeries, parseBeigeBookPage, parseBeigeBookReleaseCodes, parseFredCsv } from "./fed";
import { ncuaZipUrl, parseCsv, parseNcuaFinancial, parseNcuaInstitution, readNcuaArchive } from "./ncua";
import { parseSecCompanyFacts, parseSecSubmissions } from "./sec";
import { chartering, STATE_REGULATORS } from "./state-regulators";

describe("NCUA 5300", () => {
  it("resolves every archive naming scheme", () => {
    expect(ncuaZipUrl({ year: 2026, quarter: 2 })).toBe("https://ncua.gov/files/publications/analysis/call-report-data-2026-06.zip");
    expect(ncuaZipUrl({ year: 2015, quarter: 3 })).toBe("https://ncua.gov/files/publications/analysis/Call-Report-Data-2015-09.zip");
    expect(ncuaZipUrl({ year: 2015, quarter: 1 })).toBe("https://ncua.gov/files/publications/data-apps/QCR201503.zip");
    expect(ncuaZipUrl({ year: 2013, quarter: 2 })).toBe("https://ncua.gov/files/publications/data-apps/5300Data0613Final.zip");
    expect(ncuaZipUrl({ year: 2010, quarter: 2 })).toBe("https://ncua.gov/files/publications/data-apps/QCR201006.Zip");
  });

  it("parses quoted CSV with embedded commas and quotes", () => {
    const rows = parseCsv('CU_NUMBER,CU_NAME\r\n"1","Smith, Jones ""Federal"" CU"\r\n2,Plain\n');
    expect(rows).toEqual([
      { CU_NUMBER: "1", CU_NAME: 'Smith, Jones "Federal" CU' },
      { CU_NUMBER: "2", CU_NAME: "Plain" },
    ]);
  });

  it("reads overdraft and NSF fee income from FS220P, and leaves them null when absent", () => {
    const zip = zipSync({
      "FOICU.txt": strToU8('CU_NUMBER,CU_NAME,CITY,STATE,CU_TYPE,RSSD\n"1034","Marisol FCU","Phoenix","AZ","1","0"\n"2000","Old CU","Mesa","AZ","1","0"\n'),
      "FS220.txt": strToU8("CU_NUMBER,ACCT_010\n1034,74247904\n2000,1000000\n"),
      "FS220P.txt": strToU8("CU_NUMBER,ACCT_IS0048,ACCT_IS0049\n1034,412500,96300\n"),
    });
    const archive = readNcuaArchive(zip);
    const row = parseNcuaFinancial("1034", archive.accounts.get("1034")!, { year: 2026, quarter: 2 })!;
    expect(row).toMatchObject({ overdraft_fee_income_ytd: 413, nsf_fee_income_ytd: 96 });
    const old = parseNcuaFinancial("2000", archive.accounts.get("2000")!, { year: 2026, quarter: 2 })!;
    expect(old).toMatchObject({ overdraft_fee_income_ytd: null, nsf_fee_income_ytd: null });
  });

  it("merges FOICU and every FS220 file from the quarterly zip", () => {
    const zip = zipSync({
      "FOICU.txt": strToU8('CU_NUMBER,CU_NAME,CITY,STATE,CU_TYPE,RSSD\n"1034","Marisol Federal Credit Union","Phoenix","AZ","1","0"\n'),
      "FS220.txt": strToU8("CU_NUMBER,CYCLE_DATE,ACCT_010,ACCT_018,ACCT_083\n1034,6/30/2026,74247904,59078732,6269\n"),
      "FS220A.txt": strToU8("CU_NUMBER,ACCT_025B,ACCT_131,ACCT_661A,ACCT_550,ACCT_551,ACCT_041B,ACCT_998,ACCT_115,ACCT_117\n1034,36509834,178726,400000,90000,10000,365000,19.89,3340235,362321\n"),
      "AcctDesc.txt": strToU8("ignored"),
    });
    const archive = readNcuaArchive(zip);
    expect(archive.foicu).toHaveLength(1);
    const accounts = archive.accounts.get("1034")!;
    expect(accounts.ACCT_010).toBe("74247904");
    expect(accounts.ACCT_661A).toBe("400000");

    expect(parseNcuaInstitution(archive.foicu[0])).toMatchObject({
      charter: "1034",
      name: "Marisol Federal Credit Union",
      state_code: "AZ",
      cu_charter_type: "federal",
      rssd_id: null,
    });
    const row = parseNcuaFinancial("1034", accounts, { year: 2026, quarter: 2 })!;
    expect(row).toMatchObject({
      report_date: "2026-06-30",
      total_assets: 74248,
      total_deposits: 59079,
      total_loans: 36510,
      fee_income_ytd: 179,
      net_income_ytd: 400,
      net_charge_offs_ytd: 80,
      noncurrent_loans: 365,
      tier1_capital_ratio: 19.89,
      member_count: 6269,
      total_revenue_ytd: 3703,
    });
    // Q2 YTD annualized: 400,000 * 2 / 74,247,904.
    expect(row.roa).toBeCloseTo((400000 * 2 * 100) / 74247904, 3);
    expect(row.net_charge_off_rate).toBeCloseTo((80000 * 2 * 100) / 36509834, 3);
    expect(row.efficiency_ratio).toBeNull();
    expect(row.raw_json.ACCT_131).toBe("178726");
  });
});

describe("FDIC Summary of Deposits", () => {
  it("parses a branch office", () => {
    expect(
      parseFdicSod({
        STALPBR: "NY",
        ZIPBR: "11566",
        MSABR: 35620,
        NAMEBR: "Merrick Branch",
        ADDRESBR: "2122 Merrick Ave",
        SIMS_LONGITUDE: -73.5534124325744,
        YEAR: 2025,
        BKMO: 0,
        STCNTYBR: 36059,
        DEPSUMBR: 267588,
        MSANAMB: "New York-Newark-Jersey City, NY-NJ",
        CERT: 628,
        CITYBR: "Merrick",
        SIMS_LATITUDE: 40.6660880756872,
        BRNUM: 1003,
      }),
    ).toEqual({
      cert: 628,
      year: 2025,
      branch_number: 1003,
      is_main_office: false,
      deposits: 267588,
      branch_name: "Merrick Branch",
      address: "2122 Merrick Ave",
      city: "Merrick",
      state: "NY",
      zip: "11566",
      county_fips: 36059,
      msa_code: 35620,
      msa_name: "New York-Newark-Jersey City, NY-NJ",
      latitude: 40.6660880756872,
      longitude: -73.5534124325744,
    });
  });
});

describe("CFPB", () => {
  it("normalizes company names across CFPB, FDIC, and holding-company spellings", () => {
    expect(normalizeCompanyName("JPMORGAN CHASE & CO.")).toBe("JPMORGAN CHASE");
    expect(normalizeCompanyName("JPMorgan Chase Bank, National Association")).toBe("JPMORGAN CHASE");
    expect(normalizeCompanyName("JPMORGAN CHASE&CO")).toBe("JPMORGAN CHASE");
    expect(normalizeCompanyName("CAPITAL ONE FINANCIAL CORPORATION")).toBe("CAPITAL ONE");
    expect(normalizeCompanyName("Navy Federal Credit Union")).toBe("NAVY FEDERAL CREDIT UNION");
    expect(normalizeCompanyName("The Bank")).toBe("THE BANK");
  });

  it("reads nested aggregation buckets and drops empty ones", () => {
    const body = {
      aggregations: {
        product: { doc_count: 3, product: { buckets: [{ key: "Credit card", doc_count: 3 }, { key: "", doc_count: 1 }, { key: "Zero", doc_count: 0 }] } },
      },
    };
    expect(aggregationBuckets(body, "product")).toEqual([{ key: "Credit card", doc_count: 3 }]);
  });

  it("requests one company-year breakdown with size=0", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          hits: { total: { value: 24458 } },
          aggregations: {
            product: { product: { buckets: [{ key: "Checking or savings account", doc_count: 8937 }] } },
            issue: { issue: { buckets: [{ key: "Managing an account", doc_count: 4957 }] } },
          },
        }),
      ),
    );
    const result = await fetchCfpbCompanyBreakdown("JPMORGAN CHASE & CO.", 2025, { fetchImpl, backoffMs: 0 });
    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(url.searchParams.get("size")).toBe("0");
    expect(url.searchParams.get("company")).toBe("JPMORGAN CHASE & CO.");
    expect(url.searchParams.get("date_received_min")).toBe("2025-01-01");
    expect(result).toMatchObject({ total: 24458, products: [{ key: "Checking or savings account", doc_count: 8937 }] });
  });
});

describe("SEC EDGAR", () => {
  it("keeps only material forms and builds document URLs", () => {
    const parsed = parseSecSubmissions(
      {
        cik: "19617",
        name: "JPMORGAN CHASE & CO",
        sic: "6021",
        tickers: ["JPM"],
        filings: {
          recent: {
            accessionNumber: ["0000019617-26-000123", "0000019617-26-000124"],
            filingDate: ["2026-08-01", "2026-08-02"],
            reportDate: ["2026-06-30", ""],
            form: ["10-Q", "4"],
            primaryDocument: ["jpm-20260630.htm", "x.xml"],
            primaryDocDescription: ["10-Q", "Form 4"],
          },
        },
      },
      "19617",
    );
    expect(parsed.sic).toBe("6021");
    expect(parsed.filings).toEqual([
      {
        accession_no: "0000019617-26-000123",
        form: "10-Q",
        filed_at: "2026-08-01",
        period_of_report: "2026-06-30",
        primary_doc_url: "https://www.sec.gov/Archives/edgar/data/19617/000001961726000123/jpm-20260630.htm",
        description: "10-Q",
      },
    ]);
  });

  it("builds one row per calendar quarter from XBRL frames", () => {
    const facts = parseSecCompanyFacts({
      facts: {
        "us-gaap": {
          Assets: { units: { USD: [
            { end: "2026-06-30", val: 4_500_000_000_000, frame: "CY2026Q2I" },
            { end: "2026-06-30", val: 1, frame: "CY2026Q2" },
            { end: "2009-12-31", val: 2, frame: "CY2009Q4I" },
          ] } },
          NetIncomeLoss: { units: { USD: [
            { end: "2026-06-30", val: 15_000_000_000, frame: "CY2026Q2" },
            { end: "2025-12-31", val: 58_000_000_000, frame: "CY2025" },
          ] } },
          EarningsPerShareDiluted: { units: { "USD/shares": [{ end: "2026-06-30", val: 5.2, frame: "CY2026Q2" }] } },
        },
      },
    });
    expect(facts).toEqual([
      {
        period_end: "2026-06-30",
        fiscal_period: "2026Q2",
        total_assets: 4_500_000_000_000,
        total_liabilities: null,
        stockholders_equity: null,
        net_income: 15_000_000_000,
        eps_diluted: 5.2,
      },
    ]);
  });
});

describe("Federal Reserve", () => {
  it("splits a Beige Book district page into sections", () => {
    const html = readFileSync(join(__dirname, "__fixtures__", "beigebook-boston.html"), "utf8");
    const page = parseBeigeBookPage(html);
    expect(page.releaseDate).toBe("August 2026");
    expect(page.sections.map((s) => s.section_name)).toEqual([
      "Summary of Economic Activity",
      "Labor Markets",
      "Prices",
      "Consumer Spending",
      "Manufacturing and Distribution",
      "Nonfinancial Services",
      "Financial Services",
      "Real Estate and Construction",
    ]);
    expect(page.sections[0].content_text.length).toBeGreaterThan(200);
    expect(page.sections[0].content_text).not.toMatch(/<[a-z]/i);
  });

  it("lists release codes from the index page", () => {
    expect(
      parseBeigeBookReleaseCodes('<a href="/monetarypolicy/beigebook202608-summary.htm"></a><a href="beigebook202601.htm"></a>'),
    ).toEqual(["202601", "202608"]);
  });

  it("parses FRED graph CSV and skips missing values", () => {
    expect(parseFredCsv("observation_date,UNRATE\n2026-06-01,4.1\n2026-07-01,.\n2026-08-01,4.2\n")).toEqual([
      { observation_date: "2026-06-01", value: 4.1 },
      { observation_date: "2026-08-01", value: 4.2 },
    ]);
    expect(isFredNativeSeries("UNRATE")).toBe(true);
    expect(isFredNativeSeries("NYFED_SOFR")).toBe(false);
    expect(isFredNativeSeries("OFR_FSI")).toBe(false);
  });
});

describe("state regulators", () => {
  it("covers all 50 states and DC exactly once", () => {
    const codes = STATE_REGULATORS.map((entry) => entry.stateCode);
    expect(new Set(codes).size).toBe(51);
    expect(codes).toContain("DC");
  });

  it("resolves the chartering agency, preferring a separate credit-union regulator", () => {
    expect(chartering("TX", "credit_union", "State")).toEqual({ agency: "Texas Credit Union Department", website: "https://www.cud.texas.gov" });
    expect(chartering("TX", "bank", "State")).toEqual({ agency: "Texas Department of Banking", website: "https://www.dob.texas.gov" });
    expect(chartering("OH", "bank", "OCC")).toEqual({ agency: "OCC", website: null });
    expect(chartering("OH", "bank", null)).toBeNull();
  });
});
