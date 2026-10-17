import type { EdgarSourceContract } from "./contract";

/** Edgar source contracts, slice 02 (registry order). Facts read from each loader's code. */
export const EDGAR_SOURCES_02: EdgarSourceContract[] = [
  {
    // magellan/registry/market-growth.ts (popest), regulatory/market-growth.ts (www2.census.gov popest co-est{vintage}-alldata.csv)
    source: "census-popest",
    publisher: "US Census Bureau (Population Estimates Program)",
    licence: { status: "public-domain" },
    connection: "bulk-file",
    cadence: "annual",
    grain: ["national", "state", "county"],
    linkKeys: ["county-fips", "state"],
    tables: ["area_statistics"],
  },
  {
    // magellan/registry/market-growth.ts (irsMigration), regulatory/market-growth.ts (irs.gov/pub/irs-soi county/state inflow and outflow CSVs)
    source: "irs-migration",
    publisher: "Internal Revenue Service, Statistics of Income (IRS SOI)",
    licence: { status: "public-domain" },
    connection: "bulk-file",
    cadence: "annual",
    grain: ["state", "county"],
    linkKeys: ["county-fips", "state"],
    tables: ["area_statistics"],
  },
  {
    // magellan/registry/market-growth.ts (bfs), regulatory/market-growth.ts (census.gov/econ/bfs monthly CSV; county annual file or BFS_COUNTY_CSV_URL)
    source: "census-bfs",
    publisher: "US Census Bureau (Business Formation Statistics)",
    licence: { status: "public-domain" },
    connection: "bulk-file",
    cadence: "monthly",
    grain: ["national", "state", "county"],
    linkKeys: ["county-fips", "state"],
    tables: ["area_statistics"],
  },
  {
    // magellan/registry/market-growth.ts (laus), regulatory/market-growth.ts (bls.gov laucntycur14.txt and laucnty{yy} annual files)
    source: "bls-laus",
    publisher: "US Bureau of Labor Statistics (Local Area Unemployment Statistics)",
    licence: { status: "public-domain" },
    connection: "bulk-file",
    cadence: "monthly",
    grain: ["national", "state", "county"],
    linkKeys: ["county-fips", "state"],
    tables: ["area_statistics"],
  },
  {
    // magellan/registry/market-growth.ts (lodes), regulatory/market-growth.ts (lehd.ces.census.gov LODES WAC/RAC csv.gz per state and year)
    source: "census-lehd",
    publisher: "US Census Bureau (LEHD Origin-Destination Employment Statistics)",
    licence: { status: "public-domain" },
    connection: "bulk-file",
    cadence: "annual",
    grain: ["state", "county"],
    linkKeys: ["county-fips", "state"],
    tables: ["area_statistics"],
  },
  {
    // magellan/registry/smallbiz-payments.ts (kcfed), regulatory/smallbiz-payments.ts (kansascityfed.org survey page workbook or KCFED_SBLS_DATA_URL)
    source: "kcfed-sb-lending",
    publisher: "Federal Reserve Bank of Kansas City",
    licence: {
      status: "terms-unconfirmed",
      note: "A Reserve Bank is not a federal agency under 17 U.S.C. 105; the code states no terms.",
    },
    connection: "bulk-file",
    cadence: "quarterly",
    grain: ["national"],
    linkKeys: [],
    tables: ["area_statistics"],
  },
  {
    // magellan/registry/smallbiz-payments.ts (sbcs), regulatory/smallbiz-payments.ts (fedsmallbusiness.org report pages, FED_SBCS_DATA_URL / FED_SBCS_STATE_DATA_URL)
    source: "fed-sbcs",
    publisher: "Federal Reserve Small Business Credit Survey (fedsmallbusiness.org)",
    licence: {
      status: "terms-unconfirmed",
      note: "Published on fedsmallbusiness.org, not by a named federal agency in code; the code states no terms.",
    },
    connection: "bulk-file",
    cadence: "annual",
    grain: ["national", "state"],
    linkKeys: ["state"],
    tables: ["area_statistics"],
  },
  {
    // magellan/registry/smallbiz-payments.ts (payments), regulatory/smallbiz-payments.ts (FED_PAYMENTS_PAGES: frbservices.org volume pages, federalreserve.gov FR Payments Study)
    source: "fed-payments",
    publisher: "Federal Reserve Financial Services (FedACH, FedNow, Fed check) and Federal Reserve Board (Payments Study)",
    licence: {
      status: "terms-unconfirmed",
      note: "The Payments Study is a Federal Reserve Board work; frbservices.org volume pages are run by the Reserve Banks, which are not federal agencies under 17 U.S.C. 105, and the code states no terms.",
    },
    connection: "web-pages",
    cadence: "quarterly",
    grain: ["national"],
    linkKeys: [],
    tables: ["area_statistics"],
  },
  {
    // magellan/registry/smallbiz-payments.ts (nacha), regulatory/smallbiz-payments.ts (NACHA_PAGES: nacha.org volume and value pages)
    source: "nacha-volume",
    publisher: "Nacha",
    licence: { status: "terms-unconfirmed", note: "Nacha is a private association; the code states no terms." },
    connection: "web-pages",
    cadence: "quarterly",
    grain: ["national"],
    linkKeys: [],
    tables: ["area_statistics"],
  },
  {
    // magellan/registry/national-credit.ts (nationalSeries), regulatory/national-credit.ts (FRED keyless fredgraph.csv per series)
    source: "national-series",
    publisher: "FRED (Federal Reserve Bank of St. Louis), carrying Fed H.8, Z.1 and SLOOS, Freddie Mac PMMS and Philadelphia Fed series",
    licence: {
      status: "terms-unconfirmed",
      note: "FRED series come from many publishers (Fed Board, Freddie Mac, Philadelphia Fed); each series' terms must be checked before showing it to customers.",
    },
    connection: "rest-api",
    cadence: "weekly",
    grain: ["national"],
    linkKeys: [],
    tables: ["area_statistics"],
  },
  {
    // magellan/registry/national-credit.ts (householdDebt), regulatory/national-credit.ts (newyorkfed.org area_report_by_year.xlsx or NYFED_HHDC_STATE_XLSX_URL)
    source: "nyfed-household-debt",
    publisher: "Federal Reserve Bank of New York (Household Debt and Credit)",
    licence: {
      status: "terms-unconfirmed",
      note: "A Reserve Bank is not a federal agency under 17 U.S.C. 105; the code states no terms.",
    },
    connection: "bulk-file",
    cadence: "quarterly",
    grain: ["national", "state"],
    linkKeys: ["state"],
    tables: ["area_statistics"],
  },
  {
    // magellan/registry/national-credit.ts (sceCredit), regulatory/national-credit.ts (newyorkfed.org SCE credit access chart-data xlsx, "one wave every four months")
    source: "nyfed-sce-credit",
    publisher: "Federal Reserve Bank of New York (Survey of Consumer Expectations)",
    licence: {
      status: "terms-unconfirmed",
      note: "A Reserve Bank is not a federal agency under 17 U.S.C. 105; the code states no terms.",
    },
    connection: "bulk-file",
    cadence: "irregular",
    grain: ["national"],
    linkKeys: [],
    tables: ["area_statistics"],
  },
  {
    // magellan/registry/national-credit.ts (creditTrends), regulatory/national-credit.ts (files.consumerfinance.gov consumer-credit-trends CSVs)
    source: "cfpb-credit-trends",
    publisher: "Consumer Financial Protection Bureau (CFPB)",
    licence: { status: "public-domain" },
    connection: "bulk-file",
    cadence: "monthly",
    grain: ["national"],
    linkKeys: [],
    tables: ["area_statistics"],
  },
  {
    // magellan/registry/uscourts-bankruptcy.ts, regulatory/uscourts-bankruptcy.ts (uscourts.gov F-2 workbooks), magellan/registry/risk-costs.ts
    source: "uscourts-bankruptcy",
    publisher: "Administrative Office of the US Courts (Table F-2)",
    licence: { status: "public-domain" },
    connection: "bulk-file",
    cadence: "quarterly",
    grain: ["national", "state"],
    linkKeys: ["state"],
    tables: ["area_statistics"],
  },
  {
    // magellan/registry/usda-farm.ts, regulatory/usda-farm.ts (ERS data files; NASS Quick Stats API with NASS_API_KEY), magellan/registry/risk-costs.ts
    source: "usda-farm",
    publisher: "US Department of Agriculture (Economic Research Service and NASS)",
    licence: {
      status: "public-domain",
      note: "The NASS cash-rent half needs NASS_API_KEY; without it only the ERS state farm income loads.",
    },
    connection: "bulk-file",
    cadence: "annual",
    grain: ["national", "state", "county"],
    linkKeys: ["county-fips", "state"],
    tables: ["area_statistics"],
  },
  {
    // magellan/registry/bls-oews.ts, regulatory/bls-oews.ts (bls.gov oesm{YY}nat/st/ma.zip), magellan/registry/risk-costs.ts
    source: "bls-oews",
    publisher: "US Bureau of Labor Statistics (Occupational Employment and Wage Statistics)",
    licence: { status: "public-domain" },
    connection: "bulk-file",
    cadence: "annual",
    grain: ["national", "state", "metro"],
    linkKeys: ["state"],
    tables: ["area_statistics"],
  },
  {
    // magellan/registry/finra-nfcs.ts, regulatory/finra-nfcs.ts (finrafoundation.org NFCS downloads, waves every three years), magellan/registry/risk-costs.ts
    source: "finra-nfcs",
    publisher: "FINRA Investor Education Foundation (National Financial Capability Study)",
    licence: { status: "terms-unconfirmed", note: "FINRA Foundation is not a federal publisher; the code states no terms." },
    connection: "bulk-file",
    cadence: "irregular",
    grain: ["national", "state"],
    linkKeys: ["state"],
    tables: ["area_statistics"],
  },
  {
    // magellan/registry/fhlb-advance-rates.ts, regulatory/fhlb-advance-rates.ts (each FHLBank's public rate page)
    source: "fhlb-advance-rates",
    publisher: "Federal Home Loan Banks (each bank's posted advance rates)",
    licence: { status: "terms-unconfirmed", note: "FHLBanks are not federal agencies under 17 U.S.C. 105; the code states no terms." },
    connection: "web-pages",
    cadence: "daily",
    grain: ["national"],
    linkKeys: [],
    tables: ["area_statistics"],
  },
  {
    // magellan/registry/bank-merger-orders.ts, regulatory/bank-merger-orders.ts (federalreserve.gov ne-press.json feed and orders, occ.gov decisions)
    source: "bank-merger-orders",
    publisher: "Federal Reserve Board and Office of the Comptroller of the Currency (OCC)",
    licence: { status: "public-domain" },
    connection: "web-pages",
    cadence: "irregular",
    grain: ["institution", "document"],
    linkKeys: ["institution-name", "fdic-cert", "rssd"],
    tables: ["institution_structure_events"],
  },
  {
    // magellan/registry/making-ends-meet.ts, regulatory/making-ends-meet.ts (consumerfinance.gov public-use file zips and codebook)
    source: "cfpb-making-ends-meet",
    publisher: "Consumer Financial Protection Bureau (CFPB)",
    licence: { status: "public-domain" },
    connection: "bulk-file",
    cadence: "annual",
    grain: ["national", "state"],
    linkKeys: ["state"],
    tables: ["area_statistics"],
  },
  {
    // magellan/registry/payday-reports.ts, regulatory/payday-reports.ts (Washington DFI and Texas OCCC annual report PDFs)
    source: "state-payday-reports",
    publisher: "State regulators (Washington DFI, Texas OCCC)",
    licence: { status: "terms-unconfirmed", note: "State government reports; the code states no terms." },
    connection: "bulk-file",
    cadence: "annual",
    grain: ["state"],
    linkKeys: ["state"],
    tables: ["area_statistics"],
  },
];
