import type { HoovieSourceContract } from "./contract";

/** Hoovie source contracts, slice 02 (registry order). Facts read from each loader's code. */
export const HOOVIE_SOURCES_02: HoovieSourceContract[] = [
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
    // magellan/registry/smallbiz-payments.ts (payments), regulatory/smallbiz-payments.ts (FED_PAYMENTS_PAGES: federalreserve.gov FedACH quarterly commercial volume, FR Payments Study)
    source: "fed-payments",
    publisher: "Federal Reserve Board (FedACH commercial volume and the Payments Study)",
    licence: {
      status: "public-domain",
      note: "Both pages are Federal Reserve Board works. The frbservices.org FedACH, FedNow and Fed check pages were removed on 2026-10-17: Federal Reserve Financial Services terms need written permission for commercial use.",
    },
    connection: "web-pages",
    cadence: "quarterly",
    grain: ["national"],
    linkKeys: [],
    tables: ["area_statistics"],
  },
  {
    // magellan/registry/national-credit.ts (nationalSeries), regulatory/national-credit.ts and regulatory/fed-board-data.ts
    // (federalreserve.gov: FRB_h8_xml.zip, chargeoff/delallsa.htm, data/sloos/sloos-YYYYMM-chart-data.htm)
    source: "national-series",
    publisher: "Board of Governors of the Federal Reserve System (H.8, charge-off and delinquency rates, SLOOS)",
    licence: {
      status: "public-domain",
      note: "Read from the Board's own files since 2026-10-18 (FRED replaced by the original publishers: FRED's terms bar commercial use and storing FRED content). Board site: \"information on Board's website is in the public domain and may be copied and distributed without permission\" (federalreserve.gov/disclaimer.htm); cite the Board. FDIC national deposit rates dropped (no FDIC file confirmed); the two Z.1 commercial-mortgage series are not read yet (the Z.1 package is about 592 MB) and keep their FRED-era rows; Freddie Mac PMMS and the Philadelphia Fed card series struck 2026-10-18 (non-commercial terms). A row stored from FRED (fred.stlouisfed.org source_url) is served only until its key has a Board row (areaRowServedSql).",
    },
    connection: "bulk-file",
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
      status: "open-licence",
      licenceName: "FRBNY Terms of Use",
      attribution: "New York Fed Consumer Credit Panel / Equifax. © Federal Reserve Bank of New York",
      note: "NY Fed licence \"to use, copy, and distribute Content\" for \"your personal or business purposes\" (licence audit 2026-10-17). Cite \"New York Fed Consumer Credit Panel / Equifax\" and \"© [year] Federal Reserve Bank of New York\".",
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
      status: "open-licence",
      licenceName: "FRBNY SCE licence",
      attribution: "Source: Survey of Consumer Expectations, © 2013-2019 Federal Reserve Bank of New York (FRBNY).",
      note: "SCE licence: \"a worldwide, royalty-free, nonexclusive right to reproduce, use, and distribute\" (licence audit 2026-10-18); no FRBNY logos or implied endorsement. Cite \"Source: Survey of Consumer Expectations, © 2013-2019 Federal Reserve Bank of New York (FRBNY).\"",
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
    licence: { status: "public-domain" },
    connection: "bulk-file",
    // The NASS cash-rent half needs it; without it only the ERS state farm income loads.
    optionalEnvKeys: ["NASS_API_KEY"],
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
