import type { HoovieSourceContract } from "./contract";

/** Hoovie source contracts, slice 00 (registry order). Facts read from each loader's code. */
export const HOOVIE_SOURCES_00: HoovieSourceContract[] = [
  {
    // magellan/registry/fdic-universe.ts, regulatory/fdic.ts (api.fdic.gov/banks)
    source: "fdic-universe",
    publisher: "FDIC (BankFind Suite API)",
    licence: { status: "public-domain" },
    connection: "rest-api",
    cadence: "irregular",
    grain: ["institution"],
    linkKeys: ["fdic-cert", "rssd"],
    tables: ["institution_sources"],
  },
  {
    // magellan/registry/fdic-financials.ts, regulatory/fdic.ts (api.fdic.gov/banks)
    source: "fdic-financials",
    publisher: "FDIC (BankFind Suite API, call-report financials)",
    licence: { status: "public-domain" },
    connection: "rest-api",
    cadence: "quarterly",
    grain: ["institution"],
    linkKeys: ["fdic-cert"],
    tables: ["institution_financial_records"],
  },
  {
    // magellan/registry/ncua-financials.ts, regulatory/ncua.ts (ncua.gov quarterly 5300 zip)
    source: "ncua-financials",
    publisher: "NCUA (5300 call report)",
    licence: { status: "public-domain" },
    connection: "bulk-file",
    cadence: "quarterly",
    grain: ["institution"],
    linkKeys: ["ncua-charter"],
    tables: ["institution_financial_records", "institution_sources"],
  },
  {
    // magellan/registry/ffiec-overdraft.ts, regulatory/ffiec.ts (cdr.ffiec.gov bulk download)
    source: "ffiec-overdraft",
    publisher: "FFIEC Central Data Repository (call report Schedule RI)",
    licence: { status: "public-domain" },
    connection: "bulk-file",
    cadence: "quarterly",
    grain: ["institution"],
    linkKeys: ["rssd"],
    tables: ["institution_financial_records"],
  },
  {
    // magellan/registry/ffiec-call-detail.ts, regulatory/ffiec.ts, regulatory/ffiec-call-items.ts
    source: "ffiec-call-detail",
    publisher: "FFIEC Central Data Repository (call report)",
    licence: { status: "public-domain" },
    connection: "bulk-file",
    cadence: "quarterly",
    grain: ["institution"],
    linkKeys: ["rssd"],
    tables: ["institution_call_report_items"],
  },
  {
    // magellan/registry/ncua-extras.ts, regulatory/ncua.ts (ncuaZipUrl), regulatory/ncua-extras.ts
    source: "ncua-extras",
    publisher: "NCUA (5300 call report)",
    licence: { status: "public-domain" },
    connection: "bulk-file",
    cadence: "quarterly",
    grain: ["institution"],
    linkKeys: ["ncua-charter"],
    tables: ["institution_call_report_items"],
  },
  {
    // magellan/registry/fdic-history.ts, regulatory/fdic-history.ts (api.fdic.gov/banks/history)
    source: "fdic-history",
    publisher: "FDIC (BankFind structure history)",
    licence: { status: "public-domain" },
    connection: "rest-api",
    cadence: "irregular",
    grain: ["institution", "branch"],
    linkKeys: ["fdic-cert"],
    tables: ["institution_structure_events"],
  },
  {
    // magellan/registry/cfpb-card-agreements.ts, regulatory/cfpb-card-agreements.ts (files.consumerfinance.gov)
    source: "cfpb-card-agreements",
    publisher: "CFPB (Credit Card Agreement Database, Prepaid Product Agreements Database, TCCP survey)",
    licence: {
      status: "terms-unconfirmed",
      note: "CFPB hosts the issuers' own agreement PDFs; the CFPB did not write them, so 17 U.S.C. 105 does not cover the text. Fee facts read from them are not in question; quoting agreement text needs the terms checked.",
    },
    connection: "bulk-file",
    cadence: "quarterly",
    grain: ["document"],
    linkKeys: ["institution-name"],
    tables: ["cfpb_card_agreements", "cfpb_agreement_terms"],
  },
  {
    // magellan/registry/ubpr-peer-groups.ts, regulatory/ubpr-peer-groups.ts (cdr.ffiec.gov UBPR bulk)
    source: "ubpr-peer-groups",
    publisher: "FFIEC (Uniform Bank Performance Report)",
    licence: { status: "public-domain" },
    connection: "bulk-file",
    cadence: "quarterly",
    grain: ["institution", "national"],
    linkKeys: ["rssd"],
    tables: ["ubpr_bank_peer_groups", "ubpr_peer_group_averages"],
  },
  {
    // magellan/registry/fr-y9c.ts, regulatory/fr-y9c.ts (ffiec.gov/npw BHCF zips, federalreserve.gov MDRM)
    source: "fr-y9c",
    publisher: "Federal Reserve Board (FR Y-9C, via the FFIEC National Information Center)",
    licence: { status: "public-domain" },
    connection: "bulk-file",
    cadence: "quarterly",
    grain: ["holding-company"],
    linkKeys: ["rssd"],
    tables: ["holding_company_y9c_filers", "holding_company_y9c_items"],
  },
  {
    // magellan/registry/nic-structure.ts, regulatory/nic-structure.ts (ffiec.gov/npw bulk CSV)
    source: "nic-structure",
    publisher: "FFIEC National Information Center (Federal Reserve)",
    licence: { status: "public-domain" },
    connection: "bulk-file",
    cadence: "irregular",
    grain: ["holding-company", "institution"],
    linkKeys: ["rssd"],
    tables: ["nic_relationships", "nic_entities"],
  },
  {
    // magellan/registry/cra.ts, regulatory/cra.ts (apps.ffiec.gov craratng.zip, ffiec.gov CRA flat files)
    source: "cra",
    publisher: "FFIEC (CRA ratings and CRA small business / small farm data)",
    licence: { status: "public-domain" },
    connection: "bulk-file",
    cadence: "annual",
    grain: ["institution", "county"],
    linkKeys: ["rssd", "fdic-cert", "county-fips", "cbsa"],
    tables: ["cra_ratings", "cra_lending_respondents", "cra_small_business_lending"],
  },
  {
    // magellan/registry/designation-lists.ts, regulatory/designation-lists.ts (FDIC API, NCUA, CDFI Fund, joinbankon.org)
    source: "designation-lists",
    publisher: "FDIC, NCUA, CDFI Fund (US Treasury) and Bank On (joinbankon.org)",
    licence: {
      status: "terms-unconfirmed",
      note: "FDIC, NCUA and CDFI Fund lists are federal works; the Bank On certified-accounts list (joinbankon.org) is not, and its terms are not stated in code.",
    },
    connection: "web-pages",
    cadence: "irregular",
    grain: ["institution"],
    linkKeys: ["fdic-cert", "ncua-charter", "institution-name", "state"],
    tables: ["institution_designations"],
  },
  {
    // magellan/registry/hmda.ts, regulatory/hmda.ts (ffiec.cfpb.gov Data Browser API, snapshot panel)
    source: "hmda",
    publisher: "CFPB / FFIEC (HMDA Data Browser)",
    licence: { status: "public-domain" },
    connection: "rest-api",
    cadence: "annual",
    grain: ["institution", "county", "metro"],
    linkKeys: ["lei", "rssd", "county-fips", "cbsa", "state"],
    tables: ["hmda_lenders", "hmda_lender_originations", "hmda_lender_loan_costs"],
  },
  {
    // magellan/registry/hmda.ts (runRegistryHmdaApor), regulatory/hmda.ts (CFPB YieldTable*.txt)
    source: "hmda-apor",
    publisher: "CFPB (average prime offer rate tables)",
    licence: { status: "public-domain" },
    connection: "bulk-file",
    cadence: "weekly",
    grain: ["national"],
    linkKeys: [],
    tables: ["hmda_apor_rates"],
  },
  {
    // magellan/registry/payment-networks.ts, regulatory/payment-networks.ts (zellepay.com, frbservices.org, theclearinghouse.org, federalreserve.gov, overpass-api.de)
    source: "payment-networks",
    publisher: "Zelle, Federal Reserve Financial Services (FedNow), The Clearing House (RTP), Federal Reserve Board (Reg II) and OpenStreetMap",
    licence: {
      status: "terms-unconfirmed",
      note: "Reg II lists and tables are Federal Reserve Board works; OpenStreetMap rows are ODbL 1.0 with attribution on every row; Zelle, FedNow (Reserve Banks) and RTP participant lists have no terms stated in code.",
    },
    connection: "web-pages",
    cadence: "irregular",
    grain: ["institution", "branch", "national"],
    linkKeys: ["rssd", "fdic-cert", "ncua-charter", "institution-name", "state"],
    tables: ["institution_network_memberships", "reg_ii_interchange_figures", "osm_financial_locations"],
  },
  {
    // magellan/registry/industry-events.ts, regulatory/industry-events.ts (Fed H.2, OCC, FDIC, NCUA, FHFA, CDFI Fund, SBA, SEC, regulations.gov, CourtListener)
    source: "industry-events",
    publisher: "Federal Reserve Board, OCC, FDIC, NCUA, FHFA, CDFI Fund, SBA, SEC, regulations.gov and CourtListener",
    licence: {
      status: "terms-unconfirmed",
      note: "Most lists are federal works; CourtListener (fee lawsuits) is not a federal publisher and its terms are not stated in code.",
    },
    connection: "web-pages",
    optionalEnvKeys: ["DATA_GOV_API_KEY", "COURTLISTENER_API_TOKEN"],
    cadence: "irregular",
    grain: ["institution", "document"],
    linkKeys: ["fdic-cert", "ncua-charter", "rssd", "cik", "institution-name"],
    tables: [
      "institution_structure_events",
      "fhlb_members",
      "cdfi_awards",
      "sba_lender_lending",
      "fee_lawsuits",
      "rule_comments",
      "sec_fee_income_facts",
      "sec_event_filings",
    ],
  },
  {
    // magellan/registry/fdic-sod.ts, regulatory/fdic.ts (api.fdic.gov/banks sod endpoint)
    source: "fdic-sod",
    publisher: "FDIC (Summary of Deposits)",
    licence: { status: "public-domain" },
    connection: "rest-api",
    cadence: "annual",
    grain: ["branch"],
    linkKeys: ["fdic-cert"],
    tables: ["institution_branch_deposits"],
  },
];
