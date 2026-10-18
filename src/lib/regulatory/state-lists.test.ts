import { strToU8 } from "fflate";
import { describe, expect, it } from "vitest";

import { buildInstitutionIndex } from "./designation-lists";
import {
  buildCountyNameIndex,
  chooseUrbanColumns,
  countyNameIndex,
  depositoryListDate,
  findDepositoryFiles,
  findLicenseText,
  findUrbanFiles,
  isoDate,
  lenderActive,
  lenderAreaStats,
  lenderCategory,
  lenderDatasets,
  mapLenderFields,
  matchDepository,
  parseUrbanDebt,
  readDepositoryRows,
  readLenderRows,
  readNameMarks,
  readSodaMetadata,
  sodaRowsUrl,
  STATE_DEPOSITORY_LISTS,
  yearInName,
  type LenderDataset,
} from "./state-lists";

const csvRows = (csv: string) => csv.trim().split("\n").map((l) => l.split(","));

describe("public depository lists", () => {
  it("reads the Florida notice marks: asterisk is limited, a date is withdrawing", () => {
    expect(readNameMarks("First Bank of Testing*")).toEqual({ name: "First Bank of Testing", limited: true, date: null, dateText: null });
    expect(readNameMarks("Gulf Coast Bank 09/30/2026")).toEqual({ name: "Gulf Coast Bank", limited: false, date: "2026-09-30", dateText: "09/30/2026" });
    expect(readNameMarks("Plain Bank, N.A.")).toMatchObject({ name: "Plain Bank, N.A.", limited: false, date: null });
  });

  it("reads a list table below a title row, keeps every row and reports missing fields", () => {
    const rows = csvRows(`Qualified Public Depositories as of September 30 2026,,
Depository Name,City,State
First Bank of Testing*,Austin,TX
Gulf Coast Bank 10/15/2026,Tampa,FL
,Nowhere,FL
Sunshine Bank,Miami,Florida`);
    rows[0] = ["Qualified Public Depositories as of September 30, 2026"];
    const read = readDepositoryRows(rows, "FL");
    expect(read.records.map((r) => [r.name, r.homeState, r.status, r.statusDate])).toEqual([
      ["First Bank of Testing", "TX", "limited", null],
      ["Gulf Coast Bank", "FL", "withdrawing", "2026-10-15"],
      ["Sunshine Bank", "FL", "listed", null],
    ]);
    expect(read.skipped).toEqual({ no_name: 1 });
    expect(read.fieldsMissing).toEqual(["cert", "charter", "status"]);
    expect(read.titleDate).toBe("2026-09-30");
    expect(depositoryListDate("https://x/qpd.csv", read, "2026-10-17")).toEqual({ listDate: "2026-09-30", basis: "file_title" });
    expect(depositoryListDate("https://x/qpd_2026-07-31.xlsx", read, "2026-10-17")).toEqual({ listDate: "2026-07-31", basis: "file_name" });
  });

  it("reports a file with no name column instead of guessing", () => {
    const read = readDepositoryRows(csvRows("Foo,Bar\n1,2"), "FL");
    expect(read.records).toEqual([]);
    expect(read.fieldsMissing).toEqual(["header row with a depository name column"]);
  });

  it("finds spreadsheet links on the page and reports PDF-only ones", () => {
    expect(STATE_DEPOSITORY_LISTS).toEqual([]);
    const list = { state: "ZZ", title: "Example public depositories", pageUrl: "https://treasury.example.gov/qpd", urlEnv: "ZZ_QPD_LIST_URL", linkHint: /qpd|qualified|depositor/i };
    const html = `<a href="/docs-sf/treasury/QPD-List.xlsx">List</a><a href="/forms/other.xlsx">Form</a><a href="/notice/qualified-depositories.pdf">PDF</a>`;
    expect(findDepositoryFiles(html, list)).toEqual({
      files: ["https://treasury.example.gov/docs-sf/treasury/QPD-List.xlsx"],
      unreadable: ["https://treasury.example.gov/notice/qualified-depositories.pdf"],
    });
  });

  it("matches by cert, else exact name in the home-office state; ambiguous and missed keys stay unmatched", () => {
    const index = buildInstitutionIndex([
      { id: 1, source: "fdic", cert_number: "628", ncua_charter_id: null, institution_name: "First Bank of Testing", state_code: "TX" },
      { id: 2, source: "fdic", cert_number: "700", ncua_charter_id: null, institution_name: "Sunshine Bank", state_code: "FL" },
      { id: 3, source: "fdic", cert_number: "701", ncua_charter_id: null, institution_name: "Twin Bank", state_code: "FL" },
      { id: 4, source: "fdic", cert_number: "702", ncua_charter_id: null, institution_name: "Twin Bank", state_code: "FL" },
    ]);
    const rec = (over: Partial<Parameters<typeof matchDepository>[0]>) => ({
      programState: "FL",
      recordKey: "k",
      name: "x",
      city: null,
      homeState: null,
      cert: null,
      charter: null,
      status: "listed" as const,
      statusText: null,
      statusDate: null,
      raw: {},
      ...over,
    });
    expect(matchDepository(rec({ name: "First Bank of Testing", homeState: "TX" }), index)).toMatchObject({ institutionId: 1, matchedBy: "name_state", matchState: "TX" });
    expect(matchDepository(rec({ name: "First Bank of Testing" }), index)).toMatchObject({ institutionId: null, unmatchedReason: "name_state_not_found", matchState: "FL" });
    expect(matchDepository(rec({ name: "The Sunshine Bank" }), index)).toMatchObject({ institutionId: 2 });
    expect(matchDepository(rec({ name: "Twin Bank" }), index)).toMatchObject({ institutionId: null, unmatchedReason: "ambiguous_name_state" });
    expect(matchDepository(rec({ name: "Sunshine Bank", cert: "999" }), index)).toMatchObject({ institutionId: null, unmatchedReason: "key_not_found" });
    expect(matchDepository(rec({ name: "whatever", cert: "628" }), index)).toMatchObject({ institutionId: 1, matchedBy: "fdic_cert" });
  });
});

describe("state non-bank lender datasets", () => {
  const dataset: LenderDataset = { state: "NY", domain: "data.ny.gov", dataset: "abcd-1234", licenseType: null };

  it("takes datasets only from a well-formed env entry", () => {
    const env = {
      STATE_LENDER_DATASETS: JSON.stringify([
        { state: "NY", domain: "data.ny.gov", dataset: "abcd-1234" },
        { state: "Texas", domain: "data.texas.gov", dataset: "wxyz-9876", licenseType: "Credit Access Business" },
        { state: "ZZ", domain: "x", dataset: "nope" },
      ]),
    };
    const out = lenderDatasets(env);
    expect(out.datasets.map((d) => `${d.state}-${d.dataset}`)).toEqual(["NY-abcd-1234", "TX-wxyz-9876"]);
    expect(out.errors).toHaveLength(1);
    expect(lenderDatasets({ STATE_LENDER_DATASETS: "{oops" }).errors[0]).toMatch(/not valid JSON/);
    expect(lenderDatasets({}).datasets).toEqual([]);
  });

  it("builds SODA URLs with paging", () => {
    expect(sodaRowsUrl(dataset, 50_000)).toBe("https://data.ny.gov/resource/abcd-1234.json?%24limit=50000&%24offset=50000&%24order=%3Aid");
  });

  it("maps fields from the metadata and reports missing ones", () => {
    const meta = readSodaMetadata({
      name: "Licensed Check Cashers",
      rowsUpdatedAt: 1_790_000_000,
      license: { name: "Public Domain" },
      columns: [{ fieldName: "licensee_name" }, { fieldName: "license_type" }, { fieldName: "street_address" }, { fieldName: "city" }, { fieldName: "zip_code" }, { fieldName: "county" }, { fieldName: "license_status" }, { fieldName: "phone" }],
    });
    expect(meta.license).toBe("Public Domain");
    expect(meta.rowsUpdated).toBe("2026-09-21");
    const map = mapLenderFields(meta.columns, dataset);
    expect(map.fields).toMatchObject({ name: "licensee_name", licenseType: "license_type", address: "street_address", zip: "zip_code", status: "license_status" });
    expect(map.missing).toEqual(["licenseNumber", "licenseDate"]);
    expect(map.unexpected).toEqual(["phone"]);
  });

  it("sorts license types into the four competitor groups", () => {
    expect(lenderCategory("Check Casher")).toBe("check_casher");
    expect(lenderCategory("Deferred Deposit Service Provider")).toBe("payday_deferred_deposit");
    expect(lenderCategory("Credit Access Business")).toBe("payday_deferred_deposit");
    expect(lenderCategory("Money Transmitter")).toBe("money_transmitter");
    expect(lenderCategory("Licensed Lender")).toBe("licensed_lender");
    expect(lenderCategory("Consumer Installment Lender")).toBe("licensed_lender");
    expect(lenderCategory("Mortgage Lender")).toBe("other");
    expect(lenderActive("Active")).toBe(true);
    expect(lenderActive("Inactive")).toBe(false);
    expect(lenderActive(null)).toBeNull();
  });

  it("places licensees in counties by name within the state and counts them", () => {
    const counties = buildCountyNameIndex([
      { fips: "36047", name: "Kings" },
      { fips: "36061", name: "New York" },
    ]);
    const map = mapLenderFields(
      ["licensee_name", "license_type", "license_number", "address", "city", "zip", "county", "license_status"].map((fieldName) => ({ fieldName, name: null, dataTypeName: null })),
      dataset,
    );
    const read = readLenderRows(
      [
        { licensee_name: "Corner Check Cashing", license_type: "Check Casher", license_number: "1", address: "1 Main St", zip: "11201", county: "Kings County", license_status: "Active" },
        { licensee_name: "Corner Check Cashing", license_type: "Check Casher", license_number: "2", address: "9 Side St", zip: "11201", county: "KINGS", license_status: "Active" },
        { licensee_name: "Old Check Co", license_type: "Check Casher", license_number: "3", county: "Kings", license_status: "Expired" },
        { licensee_name: "Wire Co", license_type: "Money Transmitter", zip: "bad", county: "Atlantis", license_status: "Licensed" },
        { license_type: "Check Casher" },
      ],
      dataset,
      map,
      counties,
    );
    expect(read.records).toHaveLength(4);
    expect(read.skipped).toEqual({ no_name: 1, zip_unreadable_kept_null: 1 });
    expect(read.countyUnmatched).toEqual({ Atlantis: 1 });
    expect(read.records[0]).toMatchObject({ countyFips: "36047", countyBasis: "county_name", licenseCategory: "check_casher", active: true });
    const stats = lenderAreaStats(
      [
        { state: "NY", county_fips: "36047", license_category: "check_casher", licensees: 2, with_status: 2 },
        { state: "NY", county_fips: null, license_category: "money_transmitter", licensees: 1, with_status: 1 },
        { state: "NY", county_fips: null, license_category: "other", licensees: 9, with_status: 9 },
      ],
      "2026-09",
    );
    expect(stats.map((s) => [s.geo_type, s.geo_code, s.series_key, s.value])).toEqual([
      ["county", "36047", "nonbank_check_casher_licensees", 2],
      ["state", "NY", "nonbank_check_casher_licensees", 2],
      ["state", "NY", "nonbank_money_transmitter_licensees", 1],
    ]);
    expect(stats[2].raw).toMatchObject({ licensees_without_county: 1 });
  });

  it("indexes the bundled Census counties by name", () => {
    const index = countyNameIndex();
    expect(index.get("NY|kings")).toEqual(["36047"]);
    expect(index.get("FL|miami dade")).toEqual(["12086"]);
  });
});

describe("Urban Institute Debt in America", () => {
  it("chooses the overall share columns and skips community subgroups", () => {
    const headers = [
      "County FIPS",
      "County Name",
      "Share with any debt in collections, All",
      "Share with any debt in collections, Comm of color",
      "Median debt in collections, All",
      "Share with medical debt in collections, All",
      "Share with student loan debt in collections, All",
      "Share with auto/retail loan debt in collections, All",
    ];
    const choice = chooseUrbanColumns(headers);
    expect(choice.columns).toEqual({ any: 2, medical: 5, student: 6, auto_retail: 7 });
    expect(choice.missing).toEqual([]);
  });

  it("parses a county file with percent cells and suppression marks", () => {
    const csv = `County FIPS,County Name,State,Share with any debt in collections,Share with medical debt in collections
1001,Autauga County,AL,34%,20%
06037,Los Angeles County,CA,n<50,12%
US,United States,,28%,13%`;
    const out = parseUrbanDebt(strToU8(csv), "county", "2023", "https://x/county_2023.csv");
    expect(out.missingFields).toEqual(["share with student debt in collections", "share with auto debt in collections", "share with retail debt in collections"]);
    expect(out.skipped).toEqual({ national_row: 1 });
    expect(out.rows.map((r) => [r.geo_code, r.state_code, r.series_key, r.value, r.unit, r.note])).toEqual([
      ["01001", "AL", "urban_debt_share_any_collections", 34, "percent", null],
      ["01001", "AL", "urban_debt_share_medical_collections", 20, "percent", null],
      ["06037", "CA", "urban_debt_share_any_collections", null, "percent", "n<50"],
      ["06037", "CA", "urban_debt_share_medical_collections", 12, "percent", null],
    ]);
  });

  it("keeps a 0-1 column as a share and reads state names", () => {
    const csv = `State Name,Share with any debt in collections\nTexas,0.31\nNot A State,0.2`;
    const out = parseUrbanDebt(strToU8(csv), "state", "2023", null);
    expect(out.rows).toEqual([expect.objectContaining({ geo_code: "TX", value: 0.31, unit: "share" })]);
    expect(out.skipped).toEqual({ unreadable_geo_code: 1 });
  });

  it("records license wording and finds one county and one state file", () => {
    const html = `<div>License: Open Data Commons Attribution License (ODC-By).</div>
      <a href="/files/dia_county_2023.csv">county</a><a href="/files/dia_state_2023.csv">state</a>`;
    expect(findLicenseText(html)[0]).toBe("Open Data Commons Attribution License (ODC-By)");
    expect(findUrbanFiles(html, "https://datacatalog.urban.org/dataset/debt-america-2023")).toMatchObject({
      county: "https://datacatalog.urban.org/files/dia_county_2023.csv",
      state: "https://datacatalog.urban.org/files/dia_state_2023.csv",
    });
    expect(yearInName("https://x/dia_county_2023.csv")).toBe("2023");
    expect(yearInName("https://x/dia_2022_to_2023.csv")).toBeNull();
  });

  it("reads dates in the shapes the lists use", () => {
    expect(isoDate("9/30/26")).toBe("2026-09-30");
    expect(isoDate("September 30, 2026")).toBe("2026-09-30");
    expect(isoDate("2026-09-30T00:00:00.000")).toBe("2026-09-30");
    expect(isoDate("soon")).toBeNull();
  });
});
