import type { HoovieSourceContract } from "./contract";

/** Hoovie source contracts, slice 03 (registry order). Facts read from each loader's code. */
export const HOOVIE_SOURCES_03: HoovieSourceContract[] = [
  {
    // magellan/registry/state-lists.ts (runRegistryUrbanDebt), regulatory/state-lists.ts (datacatalog.urban.org
    // debt-america page, county/state CSVs); writes area_statistics (economy.ts upsertAreaStats) only once confirmed
    source: "urban-debt-in-america",
    publisher: "Urban Institute (Debt in America)",
    licence: {
      status: "held",
      note: "Licence is \"Check\": rows are read and held, nothing written until URBAN_DEBT_LICENSE_CONFIRMED=true after a person reads the licence text the loader records.",
    },
    connection: "bulk-file",
    cadence: "irregular",
    grain: ["county", "state"],
    linkKeys: ["county-fips", "state"],
    tables: ["area_statistics"],
  },
  {
    // magellan/registry/alltheplaces.ts, regulatory/alltheplaces.ts (data.alltheplaces.xyz runs/latest.json,
    // weekly run output.zip read by HTTP Range; ATP_LICENSE "CC0-1.0")
    source: "alltheplaces",
    publisher: "AllThePlaces (alltheplaces.xyz)",
    licence: { status: "open-licence", licenceName: "CC0 1.0", note: "Cite as \"AllThePlaces (alltheplaces.xyz), CC0 1.0\" (ATP_ATTRIBUTION)." },
    connection: "bulk-file",
    cadence: "weekly",
    grain: ["branch", "county", "state", "national"],
    linkKeys: ["institution-name", "state", "county-fips", "zip"],
    tables: ["atp_financial_locations", "area_statistics"],
  },
  {
    // magellan/registry/gleif.ts, regulatory/gleif.ts (api.gleif.org level 1 API; goldencopy.gleif.org level 2 RR file;
    // GLEIF_LICENSE_NOTE). Level 1 is the API; level 2 is a streamed golden-copy file.
    source: "gleif",
    publisher: "Global Legal Entity Identifier Foundation (GLEIF)",
    licence: {
      status: "terms-unconfirmed",
      note: "GLEIF data, free of charge under GLEIF's terms of use; not confirmed as CC0 (GLEIF_LICENSE_NOTE). Terms: https://www.gleif.org/en/meta/lei-data-terms-of-use",
    },
    connection: "rest-api",
    cadence: "irregular",
    grain: ["institution", "holding-company"],
    linkKeys: ["lei", "rssd"],
    tables: ["gleif_relationships", "gleif_entities"],
  },
  {
    // magellan/registry/state-lists.ts (runRegistryStateNonbankLenders), regulatory/state-lists.ts (Socrata
    // datasets named in STATE_LENDER_DATASETS; SOCRATA_APP_TOKEN optional); counts via economy.ts upsertAreaStats
    source: "state-nonbank-lenders",
    publisher: "State open-data portals (Socrata), per configured state dataset",
    licence: {
      status: "terms-unconfirmed",
      note: "Each dataset's own Socrata licence is recorded per run (dataset_license); the code rates these portals OK (mostly open licences) but confirms none.",
    },
    connection: "rest-api",
    cadence: "irregular",
    grain: ["institution", "county", "state"],
    linkKeys: ["state", "county-fips", "zip"],
    tables: ["state_nonbank_licensees", "area_statistics"],
  },
  {
    // magellan/registry/state-lists.ts (runRegistryStateDepositories), regulatory/state-lists.ts
    // (STATE_DEPOSITORY_LISTS: Florida CFO qualified public depositories only, published quarterly)
    source: "state-public-depositories",
    publisher: "Florida Chief Financial Officer, Bureau of Collateral Management",
    licence: { status: "terms-unconfirmed", note: "State government list; terms not stated in code." },
    connection: "bulk-file",
    cadence: "quarterly",
    grain: ["institution"],
    linkKeys: ["fdic-cert", "ncua-charter", "institution-name", "state"],
    tables: ["state_public_depositories"],
  },
  {
    // magellan/registry/sec-market-value.ts, regulatory/sec-market-value.ts (data.sec.gov/api/xbrl/companyfacts),
    // CIKs from accepted sec_cik identity links
    source: "sec-market-value",
    publisher: "US Securities and Exchange Commission (SEC EDGAR)",
    licence: { status: "public-domain" },
    connection: "rest-api",
    cadence: "irregular",
    grain: ["holding-company"],
    linkKeys: ["cik"],
    tables: ["sec_market_value_facts"],
  },
  {
    // magellan/registry/sec.ts (runRegistrySecLinks), regulatory/sec.ts (sec.gov company_tickers_exchange.json and
    // data.sec.gov submissions per CIK for SIC), magellan/registry/identity.ts (upsertIdentityLinks)
    source: "sec-links",
    publisher: "US Securities and Exchange Commission (SEC EDGAR)",
    licence: { status: "public-domain" },
    connection: "rest-api",
    cadence: "irregular",
    grain: ["holding-company"],
    linkKeys: ["cik", "institution-name", "rssd"],
    tables: ["institution_identity_links", "institution_sources"],
  },
  {
    // magellan/registry/sec.ts (runRegistrySecFilings), regulatory/sec.ts (data.sec.gov submissions and companyfacts)
    source: "sec-filings",
    publisher: "US Securities and Exchange Commission (SEC EDGAR)",
    licence: { status: "public-domain" },
    connection: "rest-api",
    cadence: "irregular",
    grain: ["holding-company", "document"],
    linkKeys: ["cik"],
    tables: ["institution_filings", "holding_company_financials"],
  },
  {
    // magellan/registry/fed.ts (runRegistryBeigeBook; "publishes 8 times a year"), regulatory/fed.ts (federalreserve.gov)
    source: "beige-book",
    publisher: "Board of Governors of the Federal Reserve System",
    licence: { status: "public-domain" },
    connection: "web-pages",
    cadence: "irregular",
    grain: ["national", "fed-district"],
    linkKeys: ["fed-district"],
    tables: ["fed_beige_book"],
  },
  {
    // magellan/registry/fed.ts (runRegistryFred), regulatory/fed.ts (fred.stlouisfed.org keyless graph CSV;
    // api.bls.gov for BLS CPI series, BLS_API_KEY optional)
    source: "fred",
    publisher: "Federal Reserve Bank of St. Louis (FRED), plus US Bureau of Labor Statistics CPI series",
    licence: {
      status: "terms-unconfirmed",
      note: "FRED series come from many publishers, each with its own terms; the St. Louis Fed is not a federal agency. BLS series are public domain.",
    },
    connection: "rest-api",
    optionalEnvKeys: ["BLS_API_KEY"],
    cadence: "irregular",
    grain: ["national", "fed-district"],
    linkKeys: ["fed-district"],
    tables: ["fed_economic_indicators"],
  },
  {
    // magellan/registry/fed.ts (runRegistryFomcMinutes), regulatory/fed.ts (federalreserve.gov FOMC calendar)
    source: "fomc-minutes",
    publisher: "Board of Governors of the Federal Reserve System (FOMC)",
    licence: { status: "public-domain" },
    connection: "web-pages",
    cadence: "irregular",
    grain: ["document"],
    linkKeys: [],
    tables: ["fed_fomc_minutes"],
  },
  {
    // magellan/registry/fed-publications.ts, regulatory/fed-banks.ts (fedinprint.org/rss, Reserve Banks' own feeds)
    source: "fed-publications",
    publisher: "The 12 regional Federal Reserve Banks (via Fed in Print)",
    licence: {
      status: "terms-unconfirmed",
      note: "Reserve Banks are not federal agencies under 17 USC 105; terms not stated in code.",
    },
    connection: "web-pages",
    cadence: "irregular",
    grain: ["document", "fed-district"],
    linkKeys: ["fed-district"],
    tables: ["fed_publications"],
  },
  {
    // magellan/registry/reg-news.ts, data-store/news.ts FEEDS (Fed, FDIC via govdelivery, OCC, CFPB press RSS)
    source: "reg-news",
    publisher: "Federal Reserve Board, FDIC, OCC and CFPB",
    licence: { status: "public-domain" },
    connection: "web-pages",
    cadence: "irregular",
    grain: ["document"],
    linkKeys: [],
    tables: ["reg_articles"],
  },
  {
    // magellan/registry/federal-register.ts, regulatory/federal-register.ts (federalregister.gov/api/v1/documents.json;
    // writes only when FEDERAL_REGISTER_TRACKER_LIVE=true)
    source: "federal-register",
    publisher: "Office of the Federal Register (Federal Register)",
    licence: { status: "public-domain" },
    connection: "rest-api",
    cadence: "irregular",
    grain: ["document"],
    linkKeys: [],
    tables: ["reg_tracker_items"],
  },
  {
    // magellan/registry/federal-bills.ts, regulatory/congress-gov.ts (api.congress.gov/v3/bill; needs CONGRESS_GOV_API_KEY;
    // writes only when FEDERAL_BILLS_TRACKER_LIVE=true)
    source: "federal-bills",
    publisher: "Library of Congress (Congress.gov)",
    licence: { status: "public-domain" },
    connection: "keyed-api",
    envKey: "CONGRESS_GOV_API_KEY",
    cadence: "irregular",
    grain: ["document"],
    linkKeys: [],
    tables: ["reg_tracker_items"],
  },
  {
    // magellan/registry/state-bills.ts, regulatory/open-states.ts (v3.openstates.org/bills; needs OPEN_STATES_API_KEY;
    // writes only when STATE_BILLS_TRACKER_LIVE=true)
    source: "state-bills",
    publisher: "Open States (state legislature bill data)",
    licence: { status: "terms-unconfirmed", note: "Open States terms not stated in code." },
    connection: "keyed-api",
    envKey: "OPEN_STATES_API_KEY",
    cadence: "irregular",
    grain: ["document", "state"],
    linkKeys: ["state"],
    tables: ["reg_tracker_items"],
  },
  {
    // magellan/registry/state-reg-news.ts, regulatory/state-regulators.ts (agency sites), regulatory/state-news.ts
    // (feeds or news pages; writes only when STATE_NEWS_TRACKER_LIVE=true, source "state:XX")
    source: "state-reg-news",
    publisher: "State banking and credit union regulators",
    licence: { status: "terms-unconfirmed", note: "State government sites; terms not stated in code." },
    connection: "web-pages",
    cadence: "irregular",
    grain: ["document", "state"],
    linkKeys: ["state"],
    tables: ["reg_articles"],
  },
  {
    // magellan/registry/state-bill-news.ts, regulatory/state-news.ts (news.google.com/rss/search; writes only when
    // STATE_NEWS_TRACKER_LIVE=true, source "news:XX")
    source: "state-bill-news",
    publisher: "News outlets, found through Google News RSS search",
    licence: { status: "terms-unconfirmed", note: "Third-party news stories via Google News; terms not stated in code." },
    connection: "web-pages",
    cadence: "irregular",
    grain: ["document", "state"],
    linkKeys: ["state"],
    tables: ["reg_articles"],
  },
  {
    // magellan/registry/state-regulators.ts: syncs the reviewed STATE_REGULATORS constant in
    // regulatory/state-regulators.ts and tags credit unions' chartering agency; nothing is fetched
    source: "state-regulators",
    publisher: "Fee Insight's reviewed list of state banking regulators (agency names and websites)",
    licence: { status: "terms-unconfirmed", note: "Derived from state agency names and URLs held in code; state government terms not stated." },
    connection: "derived",
    cadence: "irregular",
    grain: ["state", "institution"],
    linkKeys: ["state"],
    tables: ["state_regulators", "institution_sources"],
  },
  {
    // magellan/registry/enforcement.ts, regulatory/enforcement.ts (apps.occ.gov EASearch JSON export,
    // federalreserve.gov enforcementactions.csv); matched by name and state or to a holding company
    source: "enforcement",
    publisher: "Office of the Comptroller of the Currency (OCC) and Federal Reserve Board",
    licence: { status: "public-domain" },
    connection: "bulk-file",
    cadence: "irregular",
    grain: ["institution", "holding-company"],
    linkKeys: ["institution-name", "state"],
    tables: ["institution_enforcement_actions"],
  },
  {
    // magellan/registry/state-enforcement.ts, regulatory/state-enforcement.ts (STATE_ORDER_SOURCES pages);
    // matched by name within the state
    source: "state-enforcement",
    publisher: "State banking departments",
    licence: { status: "terms-unconfirmed", note: "State government sites; terms not stated in code." },
    connection: "web-pages",
    cadence: "irregular",
    grain: ["institution"],
    linkKeys: ["institution-name", "state"],
    tables: ["institution_enforcement_actions"],
  },
  {
    // magellan/registry/wire-research.ts (provider step): picks held reg_articles and reg_tracker_items, re-reads each
    // item's own page with a plain fetch, and has a model write a note (paidModelCall); shadow until REG_WIRE_SUMMARIES_LIVE=true
    source: "wire-research",
    publisher: "Fee Insight model notes on federal agency releases, state regulator posts and state fee bills",
    licence: {
      status: "terms-unconfirmed",
      note: "Inputs mix federal releases (public domain), state regulator posts and Open States bills, whose terms are not confirmed.",
    },
    connection: "web-pages",
    cadence: "irregular",
    grain: ["document"],
    linkKeys: [],
    tables: ["reg_wire_research"],
  },
];
