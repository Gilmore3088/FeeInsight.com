import type { EdgarSourceContract } from "./contract";

/** Edgar source contracts, slice 01 (registry order). Facts read from each loader's code. */
export const EDGAR_SOURCES_01: EdgarSourceContract[] = [
  {
    // magellan/registry/ncua-branches.ts (runRegistryNcuaBranches), regulatory/ncua-branches.ts (5300 zip)
    source: "ncua-branches",
    publisher: "National Credit Union Administration (NCUA)",
    licence: { status: "public-domain" },
    connection: "bulk-file",
    cadence: "quarterly",
    grain: ["branch"],
    linkKeys: ["ncua-charter"],
    tables: ["credit_union_branches"],
  },
  {
    // magellan/registry/ncua-branches.ts (runRegistryNcuaBranchGeocode), regulatory/census-geocoder.ts,
    // magellan/registry/fdic-universe.ts (deriveOtherDistricts)
    source: "ncua-branch-geocode",
    publisher: "US Census Bureau geocoder, applied to NCUA branch addresses already held",
    licence: { status: "public-domain" },
    connection: "derived",
    cadence: "irregular",
    grain: ["branch", "institution"],
    linkKeys: ["fed-district"],
    tables: ["credit_union_branches", "institution_sources"],
  },
  {
    // magellan/registry/cfpb.ts, regulatory/cfpb.ts (consumerfinance.gov search API), magellan/registry/identity.ts
    source: "cfpb",
    publisher: "Consumer Financial Protection Bureau (CFPB)",
    licence: { status: "public-domain" },
    connection: "rest-api",
    cadence: "irregular",
    grain: ["institution"],
    linkKeys: ["institution-name"],
    tables: ["institution_complaint_records", "institution_identity_links"],
  },
  {
    // magellan/registry/census-acs.ts, regulatory/census-acs.ts (api.census.gov ACS 5-year)
    source: "census-acs",
    publisher: "US Census Bureau (American Community Survey)",
    licence: { status: "public-domain" },
    connection: "keyed-api",
    envKey: "CENSUS_API_KEY",
    cadence: "annual",
    grain: ["state", "county", "zip", "tract"],
    linkKeys: ["state", "county-fips", "zip", "tract"],
    tables: ["demographics"],
  },
  {
    // magellan/registry/irs-zip-income.ts, regulatory/irs-soi.ts (irs.gov/pub/irs-soi zpallnoagi.csv)
    source: "irs-zip-income",
    publisher: "Internal Revenue Service, Statistics of Income (IRS SOI)",
    licence: { status: "public-domain" },
    connection: "bulk-file",
    cadence: "annual",
    grain: ["zip"],
    linkKeys: ["zip", "state"],
    tables: ["irs_zip_income"],
  },
  {
    // magellan/registry/economy.ts (rucc), regulatory/economy.ts (fetchRucc, ers.usda.gov CSV, one vintage per decade)
    source: "usda-rucc",
    publisher: "USDA Economic Research Service",
    licence: { status: "public-domain" },
    connection: "bulk-file",
    cadence: "irregular",
    grain: ["county"],
    linkKeys: ["county-fips"],
    tables: ["area_statistics"],
  },
  {
    // magellan/registry/economy.ts (runFfiecTracts), regulatory/economy.ts (ffiec.gov CensusFlatFile{year}.zip)
    source: "ffiec-census-tracts",
    publisher: "Federal Financial Institutions Examination Council (FFIEC)",
    licence: { status: "public-domain" },
    connection: "bulk-file",
    cadence: "annual",
    grain: ["tract"],
    linkKeys: ["tract", "county-fips", "cbsa"],
    tables: ["census_tracts"],
  },
  {
    // magellan/registry/economy.ts (runBranchTracts), regulatory/economy.ts (Census geographies geocoder)
    source: "branch-census-tracts",
    publisher: "US Census Bureau geocoder, applied to FDIC SOD and NCUA branch addresses already held",
    licence: { status: "public-domain" },
    connection: "derived",
    cadence: "irregular",
    grain: ["branch"],
    linkKeys: ["fdic-cert", "ncua-charter", "tract", "county-fips"],
    tables: ["branch_census_tracts"],
  },
  {
    // magellan/registry/economy.ts (runUrbanRural; writes only when ECONOMY_URBAN_RURAL_WRITE=true)
    source: "urban-rural-fill",
    publisher: "Derived from USDA ERS Rural-Urban Continuum Codes and institution HQ counties already held",
    licence: { status: "public-domain" },
    connection: "derived",
    cadence: "irregular",
    grain: ["institution"],
    linkKeys: ["county-fips"],
    tables: ["institution_sources"],
  },
  {
    // magellan/registry/economy.ts (qcew), regulatory/economy.ts (data.bls.gov/cew annual-average CSV)
    source: "bls-qcew",
    publisher: "US Bureau of Labor Statistics (BLS)",
    licence: { status: "public-domain" },
    connection: "bulk-file",
    cadence: "annual",
    grain: ["national", "state", "county", "metro"],
    linkKeys: ["state", "county-fips", "cbsa"],
    tables: ["area_statistics"],
  },
  {
    // magellan/registry/economy.ts (cbp), regulatory/economy.ts (cbpUrl, api.census.gov/data/{year}/cbp)
    source: "census-cbp",
    publisher: "US Census Bureau (County Business Patterns)",
    licence: { status: "public-domain" },
    connection: "keyed-api",
    envKey: "CENSUS_API_KEY",
    cadence: "annual",
    grain: ["national", "state", "county", "metro"],
    linkKeys: ["state", "county-fips", "cbsa"],
    tables: ["area_statistics"],
  },
  {
    // magellan/registry/economy.ts (saipe), regulatory/economy.ts (SAIPE_URL timeseries API)
    source: "census-saipe",
    publisher: "US Census Bureau (Small Area Income and Poverty Estimates)",
    licence: { status: "public-domain" },
    connection: "keyed-api",
    envKey: "CENSUS_API_KEY",
    cadence: "annual",
    grain: ["national", "state", "county"],
    linkKeys: ["state", "county-fips"],
    tables: ["area_statistics"],
  },
  {
    // magellan/registry/economy.ts (bea, BEA_KEY_ENV), regulatory/economy.ts (apps.bea.gov CAINC1)
    source: "bea-personal-income",
    publisher: "US Bureau of Economic Analysis (BEA)",
    licence: { status: "public-domain" },
    connection: "keyed-api",
    envKey: "BEA_API_KEY",
    cadence: "annual",
    grain: ["national", "state", "county", "metro"],
    linkKeys: ["state", "county-fips", "cbsa"],
    tables: ["area_statistics"],
  },
  {
    // magellan/registry/economy.ts (fhfa), regulatory/economy.ts (fhfa.gov hpi_master.csv, quarterly all-transactions rows)
    source: "fhfa-hpi",
    publisher: "Federal Housing Finance Agency (FHFA)",
    licence: { status: "public-domain" },
    connection: "bulk-file",
    cadence: "quarterly",
    grain: ["national", "state", "metro"],
    linkKeys: ["state", "cbsa"],
    tables: ["area_statistics"],
  },
  {
    // magellan/registry/economy.ts (fdicSurvey; biennial, odd years), regulatory/economy.ts (FDIC_HOUSEHOLD_SURVEY_CSV_URL)
    source: "fdic-household-survey",
    publisher: "Federal Deposit Insurance Corporation (FDIC)",
    licence: { status: "public-domain" },
    connection: "bulk-file",
    cadence: "irregular",
    grain: ["national", "state", "metro"],
    linkKeys: ["state", "cbsa"],
    tables: ["area_statistics"],
  },
  {
    // magellan/registry/economy.ts (shed), regulatory/economy.ts (federalreserve.gov SHED public-use zip)
    source: "fed-shed",
    publisher: "Board of Governors of the Federal Reserve System",
    licence: { status: "public-domain" },
    connection: "bulk-file",
    cadence: "annual",
    grain: ["national"],
    linkKeys: [],
    tables: ["area_statistics"],
  },
  {
    // magellan/registry/economy.ts (runFdicIndustry), regulatory/economy.ts (fetchIndustryRecords, FDIC financials API)
    source: "fdic-industry-totals",
    publisher: "Federal Deposit Insurance Corporation (FDIC)",
    licence: { status: "public-domain" },
    connection: "rest-api",
    cadence: "quarterly",
    grain: ["national"],
    linkKeys: [],
    tables: ["area_statistics"],
  },
  {
    // magellan/registry/economy.ts (fdicRates), regulatory/economy.ts (FDIC_NATIONAL_RATES_CSV_URL)
    source: "fdic-national-rates",
    publisher: "Federal Deposit Insurance Corporation (FDIC)",
    licence: { status: "public-domain" },
    connection: "bulk-file",
    cadence: "irregular",
    grain: ["national"],
    linkKeys: [],
    tables: ["area_statistics"],
  },
  {
    // magellan/registry/economy.ts (paymentChoice), regulatory/economy.ts (ATLANTA_FED_PAYMENT_CHOICE_CSV_URL)
    source: "atlanta-fed-payment-choice",
    publisher: "Federal Reserve Bank of Atlanta",
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
    // magellan/registry/economy.ts (runRemittances), regulatory/economy.ts (WORLD_BANK_RPW_CSV_URL)
    source: "world-bank-remittance-prices",
    publisher: "World Bank (Remittance Prices Worldwide)",
    licence: {
      status: "terms-unconfirmed",
      note: "The code names no licence for the RPW dataset; confirm its terms before showing it to customers.",
    },
    connection: "bulk-file",
    cadence: "irregular",
    grain: ["institution"],
    linkKeys: ["institution-name"],
    tables: ["remittance_prices"],
  },
  {
    // magellan/registry/economy.ts (runHudCrosswalk), regulatory/economy.ts (huduser.gov USPS crosswalk API, HUD_USER_TOKEN)
    source: "hud-zip-county",
    publisher: "US Department of Housing and Urban Development (HUD)",
    licence: { status: "public-domain" },
    connection: "keyed-api",
    envKey: "HUD_USER_TOKEN",
    cadence: "quarterly",
    grain: ["zip"],
    linkKeys: ["zip", "county-fips", "state"],
    tables: ["zip_county_crosswalk"],
  },
  {
    // magellan/registry/market-growth.ts (permits), regulatory/market-growth.ts (www2.census.gov/econ/bps/County monthly and annual files)
    source: "census-permits",
    publisher: "US Census Bureau (Building Permits Survey)",
    licence: { status: "public-domain" },
    connection: "bulk-file",
    cadence: "monthly",
    grain: ["national", "state", "county"],
    linkKeys: ["county-fips", "state"],
    tables: ["area_statistics"],
  },
];
