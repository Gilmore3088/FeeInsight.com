import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { fullCreditUnionCity, NcuaBranchFormatError, parseNcuaBranches, readNcuaBranchFile } from "./ncua-branches";
import { parseCsv, parseNcuaInstitution, readNcuaArchive } from "./ncua";

const FILE = [
  "CU_NUMBER,CYCLE_DATE,SiteId,CU_NAME,SiteName,SiteTypeName,MainOffice,PhysicalAddressLine1,PhysicalAddressLine2,PhysicalAddressCity,PhysicalAddressStateCode,PhysicalAddressPostalCode,PhysicalAddressCountyName",
  '00005536,6/30/2026,1,AIR ACADEMY,Main Office,Corporate Office,Yes,"1355 Kelly Johnson Blvd",,Colorado Springs,co,80920-3974,El Paso',
  "00005536,6/30/2026,2,AIR ACADEMY,Briargate,Branch,No,8610 Explorer Dr,Suite 100,Colorado Springs,CO,80920,El Paso",
  "00005536,6/30/2026,2,AIR ACADEMY,Briargate duplicate,Branch,No,8610 Explorer Dr,,Colorado Springs,CO,80920,El Paso",
  ",6/30/2026,9,NO CHARTER,X,Branch,No,1 Main St,,Town,TX,75001,",
].join("\n");

describe("NCUA branch file", () => {
  it("reads offices with addresses, main office and charter without leading zeros", () => {
    const rows = parseNcuaBranches(parseCsv(FILE));

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      charter: "5536",
      site_id: "1",
      is_main_office: true,
      address: "1355 Kelly Johnson Blvd",
      city: "Colorado Springs",
      state: "CO",
      zip: "80920-3974",
      county_name: "El Paso",
    });
    expect(rows[1]).toMatchObject({ site_id: "2", is_main_office: false, address: "8610 Explorer Dr, Suite 100" });
  });

  it("fails loudly with the header when required columns are missing", () => {
    const rows = parseCsv("CU_NUMBER,Something\n1,2");

    expect(() => parseNcuaBranches(rows)).toThrow(NcuaBranchFormatError);
    expect(() => parseNcuaBranches(rows)).toThrow(/SOMETHING/);
  });

  it("finds the branch file inside the quarterly archive", () => {
    const zip = zipSync({
      "FOICU.txt": strToU8("CU_NUMBER\n1"),
      "Credit Union Branch Information.txt": strToU8(FILE),
    });

    const found = readNcuaBranchFile(zip);

    expect(found?.file).toBe("Credit Union Branch Information.txt");
    expect(found?.rows).toHaveLength(4);
  });

  it("returns null when the archive has no branch file", () => {
    expect(readNcuaBranchFile(zipSync({ "FOICU.txt": strToU8("CU_NUMBER\n1") }))).toBeNull();
  });

  // Real FOICU cuts from the 2026-06 zip (#1213): FOICU says "Colorado Spring", the branch file says "Colorado Springs".
  it("restores a FOICU city cut at 15 characters from the credit union's own offices", () => {
    const zip = zipSync({
      "FOICU.txt": strToU8('CU_NUMBER,CU_NAME,CITY,STATE,CU_TYPE,RSSD\n"5536","Air Academy","Colorado Spring","CO","1","0"\n'),
      "Credit Union Branch Information.txt": strToU8(FILE),
    });
    const archive = readNcuaArchive(zip);
    const offices = parseNcuaBranches(archive.branchRows);
    expect(fullCreditUnionCity(parseNcuaInstitution(archive.foicu[0])!.city, offices)).toBe("Colorado Springs");

    const office = (city: string, is_main_office = false) => ({ city, is_main_office });
    expect(fullCreditUnionCity("NORTH LITTLE RO", [office("North Little Rock", true)])).toBe("North Little Rock");
    // Main office elsewhere: a branch's longer name still restores the cut.
    expect(fullCreditUnionCity("Saratoga Spring", [office("Ballston Spa", true), office("Saratoga Springs")])).toBe("Saratoga Springs");
    // 15 letters and whole: no office extends it, or the main office is elsewhere.
    expect(fullCreditUnionCity("College Station", [office("College Station", true)])).toBe("College Station");
    expect(fullCreditUnionCity("Fort Lauderdale", [office("Hollywood", true)])).toBe("Fort Lauderdale");
    // Shorter names are never touched, and offices that disagree leave the cut name for a person.
    expect(fullCreditUnionCity("Spring", [office("Springfield", true)])).toBe("Spring");
    expect(fullCreditUnionCity("Highland Height", [office("Highland Heights"), office("Highland Heightsville")])).toBe("Highland Height");
  });
});
