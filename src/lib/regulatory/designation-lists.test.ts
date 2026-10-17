import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  DESIGNATIONS,
  buildInstitutionIndex,
  cdfiDepositoryKind,
  cleanDesignationRecords,
  dateInFileName,
  findListLinks,
  foicuRowsFromZip,
  isYes,
  locateHeader,
  matchRecord,
  readCdfiList,
  readFdicFlags,
  readFoicuFlags,
  readNcuaMdiList,
  readXlsxRows,
} from "./designation-lists";

function xlsx(rows: string[][]): Uint8Array {
  const shared: string[] = [];
  const idx = (s: string) => {
    const at = shared.indexOf(s);
    if (at >= 0) return at;
    shared.push(s);
    return shared.length - 1;
  };
  const cols = "ABCDEFGH";
  const sheet = `<worksheet><sheetData>${rows
    .map((r, i) => `<row r="${i + 1}">${r.map((v, j) => (v === "" ? "" : `<c r="${cols[j]}${i + 1}" t="s"><v>${idx(v)}</v></c>`)).join("")}</row>`)
    .join("")}</sheetData></worksheet>`;
  const sst = `<sst>${shared.map((s) => `<si><t>${s.replace(/&/g, "&amp;")}</t></si>`).join("")}</sst>`;
  return zipSync({ "xl/worksheets/sheet1.xml": strToU8(sheet), "xl/sharedStrings.xml": strToU8(sst) });
}

const institutions = buildInstitutionIndex([
  { id: 1, source: "fdic", cert_number: "628", ncua_charter_id: null, institution_name: "First Bank of Testing", state_code: "TX" },
  { id: 2, source: "ncua", cert_number: "00123", ncua_charter_id: null, institution_name: "Hope Federal Credit Union", state_code: "MS" },
  { id: 3, source: "fdic", cert_number: "9", ncua_charter_id: null, institution_name: "Twin Bank", state_code: "OH" },
  { id: 4, source: "fdic", cert_number: "10", ncua_charter_id: null, institution_name: "Twin Bank", state_code: "OH" },
]);

describe("readFdicFlags", () => {
  it("reads MDI, specialty, ownership and Subchapter S, and names missing fields", () => {
    const read = readFdicFlags([
      { CERT: "628", NAME: "First Bank of Testing", STALP: "TX", MDI_STATUS_CODE: "B", MDI_STATUS_DESC: "Black or African American", SPECGRPN: "Commercial Lending", MUTUAL: "0", SUBCHAPS: "1" },
      { CERT: "9", NAME: "Twin Bank", STALP: "OH", MDI_STATUS_CODE: "0", SPECGRPN: "", MUTUAL: "", SUBCHAPS: "0" },
    ]);
    const kinds = read.records.map((r) => `${r.recordKey}:${r.designation}=${r.value}`);
    expect(kinds).toEqual([
      "628:minority_depository=Black or African American",
      "628:fdic_specialty_group=Commercial Lending",
      "628:ownership_form=stock",
      "628:subchapter_s=yes",
    ]);
    expect(read.fieldsMissing).toEqual(["SPECGRP"]);
  });
});

describe("readFoicuFlags", () => {
  it("reads low-income, FOM type and year, and never defaults a missing column", () => {
    const zip = zipSync({ "FOICU.txt": strToU8("CU_NUMBER,CU_NAME,STATE,LIMITED_INC,YEAR_OPENED\n00123,Hope Federal Credit Union,MS,1,1994\n7,Other CU,AL,0,\n") });
    const read = readFoicuFlags(foicuRowsFromZip(zip)!);
    expect(read.records.map((r) => `${r.recordKey}:${r.designation}=${r.value}`)).toEqual(["123:low_income=yes", "123:year_chartered=1994"]);
    expect(read.fieldsMissing).toEqual(["TOM_CODE|FOM_CODE|FOM_TYPE"]);
  });
});

describe("published lists", () => {
  it("finds the header below title rows and keeps depository CDFIs only", () => {
    const bytes = xlsx([
      ["List of Certified CDFIs as of 9/30/2026"],
      [],
      ["Organization Name", "City", "State", "Organization Type", "Extra Col"],
      ["First Bank of Testing", "Austin", "TX", "Bank or Thrift", "x"],
      ["Neighborhood Loan Fund", "Austin", "TX", "Loan Fund", ""],
      ["Holding & Co", "Dallas", "TX", "Depository Institution Holding Company", ""],
    ]);
    const read = readCdfiList(bytes);
    expect(read.format).toBe("xlsx");
    expect(read.records.map((r) => r.name)).toEqual(["First Bank of Testing", "Holding & Co"]);
    expect(read.skipped).toEqual({ not_depository: 1 });
    expect(read.unexpectedFields).toEqual(["Extra Col"]);
  });

  it("reads an NCUA MDI csv with charters", () => {
    const read = readNcuaMdiList(strToU8('Charter Number,Credit Union Name,City,State,Minority Status\n123,"Hope Federal Credit Union",Jackson,MS,Black American\n'));
    expect(read.records[0]).toMatchObject({ ncuaCharter: "123", value: "Black American", state: "MS" });
    expect(read.fieldsMissing).toEqual([]);
  });

  it("reads inline strings and sparse cells", () => {
    const sheet = '<worksheet><sheetData><row><c r="B1" t="inlineStr"><is><t>A &amp; B</t></is></c><c r="C1"><v>42</v></c></row></sheetData></worksheet>';
    expect(readXlsxRows(zipSync({ "xl/worksheets/sheet1.xml": strToU8(sheet) })).rows).toEqual([["", "A & B", "42"]]);
  });

  it("returns null when no header row names a name column", () => {
    expect(locateHeader([["a", "b"], ["1", "2"]])).toBeNull();
  });

  it("finds file links and dates", () => {
    const html = '<a href="/sites/cdfi/files/2026-09/Certified_CDFI_List_09-30-2026.xlsx">List</a>';
    const links = findListLinks(html, /href="([^"]*certified[^"]*cdfi[^"]*\.xlsx)"/gi, "https://www.cdfifund.gov/x");
    expect(links).toEqual(["https://www.cdfifund.gov/sites/cdfi/files/2026-09/Certified_CDFI_List_09-30-2026.xlsx"]);
    expect(dateInFileName("https://x/MDI_List_2026-06.xlsx")).toBe("2026-06-01");
    expect(dateInFileName("https://x/list.xlsx")).toBeNull();
  });

  it("classifies CDFI organization types", () => {
    expect(cdfiDepositoryKind("Credit Union")).toBe("credit_union");
    expect(cdfiDepositoryKind("Bank or Thrift")).toBe("bank");
    expect(cdfiDepositoryKind("Loan Fund")).toBeNull();
  });
});

describe("matching and cleaning", () => {
  const base = { list: "cdfi-fund" as const, designation: DESIGNATIONS.cdfi, value: "yes", city: null, raw: {}, orgType: "Bank or Thrift" };

  it("matches by key, then by exact normalized name and state, and never guesses an ambiguous name", () => {
    const byCert = matchRecord({ ...base, recordKey: "628", name: "x", state: "TX", fdicCert: "628", ncuaCharter: null }, institutions);
    const byCharter = matchRecord({ ...base, recordKey: "123", name: "x", state: "MS", fdicCert: null, ncuaCharter: "123" }, institutions);
    const byName = matchRecord({ ...base, recordKey: "k", name: "The First Bank of Testing", state: "TX", fdicCert: null, ncuaCharter: null }, institutions);
    const ambiguous = matchRecord({ ...base, recordKey: "t", name: "Twin Bank", state: "OH", fdicCert: null, ncuaCharter: null }, institutions);
    const missingKey = matchRecord({ ...base, recordKey: "999", name: "First Bank of Testing", state: "TX", fdicCert: "999", ncuaCharter: null }, institutions);
    expect([byCert.institutionId, byCert.matchedBy]).toEqual([1, "fdic_cert"]);
    expect([byCharter.institutionId, byCharter.matchedBy]).toEqual([2, "ncua_charter"]);
    expect([byName.institutionId, byName.matchedBy]).toEqual([1, "name_state"]);
    expect([ambiguous.institutionId, ambiguous.unmatchedReason]).toEqual([null, "ambiguous_name_state"]);
    expect(missingKey.unmatchedReason).toBe("key_not_found");
  });

  it("reports unmatched rows, duplicates and impossible years without changing values", () => {
    const rec = (over: object) => ({ ...base, recordKey: "a", name: "A", state: "TX", fdicCert: null, ncuaCharter: null, institutionId: null, matchedBy: null, unmatchedReason: "name_state_not_found" as const, ...over });
    const report = cleanDesignationRecords(
      [
        rec({}),
        rec({}),
        rec({ designation: DESIGNATIONS.yearChartered, value: "2099", recordKey: "y", institutionId: 5, matchedBy: "ncua_charter", unmatchedReason: null }),
        rec({ recordKey: "b", state: null, raw: { State: "Texas" } }),
      ],
      2026,
    );
    expect(report.unmatched).toBe(3);
    expect(report.unmatchedRows).toHaveLength(3);
    expect(report.duplicateKeys).toEqual([{ designation: "cdfi", key: "a", count: 2 }]);
    expect(report.impossibleYears).toEqual([{ key: "y", value: "2099" }]);
    expect(report.invalidState).toBe(1);
  });

  it("treats only explicit yes values as yes", () => {
    expect([isYes("1"), isYes("Y"), isYes("0"), isYes(""), isYes("maybe")]).toEqual([true, true, false, null, null]);
  });
});
