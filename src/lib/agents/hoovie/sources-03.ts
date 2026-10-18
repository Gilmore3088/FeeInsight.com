import type { HoovieSourceContract } from "./contract";

/** Hoovie source contracts, slice 03 (registry order). Facts read from each loader's code. */
export const HOOVIE_SOURCES_03: HoovieSourceContract[] = [
  {
    // magellan/registry/state-lists.ts (runRegistryUrbanDebt), regulatory/state-lists.ts (datacatalog.urban.org
    // debt-america page, county/state CSVs); writes area_statistics (economy.ts upsertAreaStats)
    source: "urban-debt-in-america",
    loader: "state-lists",
    publisher: "Urban Institute (Debt in America)",
    licence: {
      status: "open-licence",
      licenceName: "ODC-By 1.0",
      attribution: "Braga et al., Debt in America, Urban Institute",
      note: "Released from held 2026-10-18: ODC-By 1.0, \"These rights explicitly include commercial use\". Cite as \"Braga et al., Debt in America, Urban Institute\" (URBAN_DEBT_ATTRIBUTION), carried on every stored row and every read.",
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
    loader: "alltheplaces",
    publisher: "AllThePlaces (alltheplaces.xyz)",
    licence: { status: "open-licence", licenceName: "CC0 1.0", attribution: "AllThePlaces (alltheplaces.xyz), CC0 1.0", note: "Cite as \"AllThePlaces (alltheplaces.xyz), CC0 1.0\" (ATP_ATTRIBUTION)." },
    connection: "bulk-file",
    cadence: "weekly",
    grain: ["branch", "county", "state", "national"],
    linkKeys: ["institution-name", "state", "county-fips", "zip"],
    tables: ["atp_financial_locations", "area_statistics"],
  },
  {
    // magellan/registry/gleif.ts, regulatory/gleif.ts (api.gleif.org level 1 API; goldencopy.gleif.org level 2 RR file;
    // GLEIF_LICENSE_NOTE). Level 1 is the API; level 2 is a streamed golden-copy file. The lei-match-*
    // partitions (magellan/registry/gleif-lei-match.ts, #1868) link institutions to LEIs by RSSD, FDIC cert,
    // NCUA charter (the registered id under each regulator's GLEIF registration authority), else exact
    // legal name plus state; unmatched and ambiguous institutions stay in institution_lei_links for review.
    source: "gleif",
    loader: "gleif",
    publisher: "Global Legal Entity Identifier Foundation (GLEIF)",
    licence: {
      status: "open-licence",
      licenceName: "CC0 1.0",
      note: "\"The data available through the Access Service are provided under the CC0 licence\" (licence audit 2026-10-17). No attribution required; do not imply GLEIF endorsement. Terms: https://www.gleif.org/en/meta/lei-data-terms-of-use",
    },
    connection: "rest-api",
    cadence: "irregular",
    grain: ["institution", "holding-company"],
    linkKeys: ["lei", "rssd", "fdic-cert", "ncua-charter", "institution-name", "state"],
    tables: ["institution_lei_links", "gleif_relationships", "gleif_entities"],
  },
  {
    // magellan/registry/state-lists.ts (runRegistryStateNonbankLenders), regulatory/state-lists.ts (Socrata
    // datasets named in STATE_LENDER_DATASETS; SOCRATA_APP_TOKEN optional); counts via economy.ts upsertAreaStats
    source: "state-nonbank-lenders",
    loader: "state-lists",
    publisher: "State open-data portals (Socrata), per configured state dataset",
    licence: {
      status: "terms-unconfirmed",
      note: "Each dataset's own Socrata licence is recorded per run (dataset_license); the code rates these portals OK (mostly open licences) but confirms none.",
    },
    connection: "rest-api",
    // Sent as X-App-Token when set, for a higher Socrata rate limit; every dataset loads without it.
    optionalEnvKeys: ["SOCRATA_APP_TOKEN"],
    cadence: "irregular",
    grain: ["institution", "county", "state"],
    linkKeys: ["state", "county-fips", "zip"],
    tables: ["state_nonbank_licensees", "area_statistics"],
  },
  {
    // magellan/registry/state-lists.ts (runRegistryStateDepositories), regulatory/state-lists.ts
    // (STATE_DEPOSITORY_LISTS: empty; Florida's CFO list was removed on 2026-10-17)
    source: "state-public-depositories",
    loader: "state-lists",
    publisher: "State public-funds programs (none wired)",
    licence: {
      status: "terms-unconfirmed",
      note: "No state list is wired. Florida's CFO list was removed on 2026-10-17: its site allows only educational, personal or training use. A state's terms are read before its list is added.",
    },
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
    loader: "sec-market-value",
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
    loader: "sec",
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
    loader: "sec",
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
    loader: "fed",
    publisher: "Board of Governors of the Federal Reserve System",
    licence: { status: "public-domain" },
    connection: "web-pages",
    cadence: "irregular",
    grain: ["national", "fed-district"],
    linkKeys: ["fed-district"],
    tables: ["fed_beige_book"],
  },
  {
    // magellan/registry/fed.ts (runRegistryFred), regulatory/federal-indicators.ts (PUBLISHER_INDICATORS:
    // api.bls.gov, BLS_API_KEY optional; apps.bea.gov NIPA, BEA_API_KEY; federalreserve.gov FRB_h15_xml.zip).
    // The source key keeps its FRED-era name so the step and its history stay joined.
    source: "fred",
    loader: "fed",
    publisher: "US Bureau of Labor Statistics, US Bureau of Economic Analysis and the Federal Reserve Board (H.15)",
    licence: {
      status: "public-domain",
      note: "Each series from its original publisher since 2026-10-18; FRED is no longer read (its terms bar commercial use and storing FRED content). BLS: \"everything that we publish ... is in the public domain\" (bls.gov/opub/copyright-information.htm); Fed Board: public domain (federalreserve.gov/disclaimer.htm); BEA data are federal works (17 USC 105). QBPQYTNIYSRVDP and DRCBLACBS have no confirmed publisher file and are struck. FRED-era rows are retired per series: served until the series' first publisher row lands (fedIndicatorServedSql); registry-fred names any still on FRED-era values.",
    },
    connection: "rest-api",
    optionalEnvKeys: ["BLS_API_KEY", "BEA_API_KEY"],
    cadence: "irregular",
    grain: ["national", "fed-district"],
    linkKeys: ["fed-district"],
    tables: ["fed_economic_indicators"],
  },
  {
    // magellan/registry/fed.ts (runRegistryFomcMinutes), regulatory/fed.ts (federalreserve.gov FOMC calendar)
    source: "fomc-minutes",
    loader: "fed",
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
    loader: "fed-publications",
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
    loader: "reg-news",
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
    loader: "federal-register",
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
    loader: "federal-bills",
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
    loader: "state-bills",
    publisher: "Open States (state legislature bill data)",
    licence: {
      status: "public-domain",
      note: "Open States: \"No attribution is required for using data obtained via Open States\" (licence audit 2026-10-17); the publisher disclaims copyright. Do not imply endorsement.",
    },
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
    loader: "state-reg-news",
    publisher: "State banking and credit union regulators (New York, North Carolina and Florida struck)",
    licence: {
      status: "terms-unconfirmed",
      note: "New York DFS (\"for non-commercial purposes\"), North Carolina (\"for non-commercial use\") and Florida were struck 2026-10-18 (STRUCK_REGULATOR_STATES; readers hide their stored posts). New Jersey allows free reuse; the other state sites' terms are not yet read.",
    },
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
    loader: "state-bill-news",
    publisher: "News outlets, found through Google News RSS search",
    licence: {
      status: "held",
      note: "Held 2026-10-18 (DECISIONS.md \"No non-commercial data\"): Google's News RSS terms are unread and reported as personal, non-commercial use. The code is kept; no partitions are scheduled (HELD_REGISTRY_SOURCES) and no reader returns its \"news:XX\" rows until James confirms the terms.",
    },
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
    loader: "state-regulators",
    publisher: "Fee Insight's reviewed list of state banking regulators (agency names and websites)",
    licence: {
      status: "public-domain",
      note: "Facts compiled by Fee Insight: state agency names and URLs held in code, nothing fetched (licence audit 2026-10-18). Facts are not copyrightable.",
    },
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
    loader: "enforcement",
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
    loader: "state-enforcement",
    publisher: "State banking departments (New Jersey, Illinois, Maryland, Washington, Texas)",
    licence: {
      status: "terms-unconfirmed",
      note: "New York and North Carolina were struck 2026-10-18 (non-commercial site terms; readers hide their stored orders). New Jersey allows free reuse; Washington, Texas, Illinois and Maryland state no reuse terms.",
    },
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
    loader: "wire-research",
    publisher: "Fee Insight model notes on federal agency releases, state regulator posts and state fee bills",
    licence: {
      status: "terms-unconfirmed",
      note: "Inputs mix federal releases (public domain), state regulator posts and Open States bills (public domain). Posts from struck states (NY, NC, FL) and held press are never read; the other state sites' terms are not yet read.",
    },
    connection: "web-pages",
    cadence: "irregular",
    grain: ["document"],
    linkKeys: [],
    tables: ["reg_wire_research"],
  },
];
