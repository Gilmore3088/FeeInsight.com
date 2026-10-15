import { describe, expect, it, vi } from "vitest";

import {
  buildNameDirectory,
  DARWIN_DOCUMENT_OWNER_TAKEDOWN,
  documentOwnerCountSql,
  documentOwnerFingerprint,
  documentOwnerPairsSql,
  creditUnionAcronyms,
  documentOwnerVerdict,
  headerNamesInstitution,
  holdingCompanyKey,
  institutionsNamedIn,
  isVendorDocumentPath,
  onWebsiteHost,
  ownerNameForms,
  recheckDocumentOwners,
  registrableDomain,
  sharedNameIds,
  type OwnerBank,
  vendorCopyOwner,
} from "./document-owner";

// The three #1455 cases, as the registry lists them (the texts are short stand-ins for each schedule).
const bluegrass: OwnerBank = { id: 5756, name: "Bluegrass Community Federal Credit Union", city: "Ashland", stateCode: "KY" };
const ukfcu: OwnerBank = { id: 6729, name: "University of Kentucky Federal Credit Union", city: "Lexington", stateCode: "KY" };
const metrowest: OwnerBank = { id: 4884, name: "Metrowest Community Federal Credit Union", city: "Framingham", stateCode: "MA" };
const stMarys: OwnerBank = { id: 8298, name: "St. Mary's Federal Credit Union", city: "Marlborough", stateCode: "MA" };
const fnbOldham: OwnerBank = {
  id: 1903, name: "First National Bank", city: "Oldham", stateCode: "SD", holdingCompanyName: "Fulda Bancorporation", nameShared: true,
};
const fnbFortPierre: OwnerBank = {
  id: 582, name: "First National Bank", city: "Fort Pierre", stateCode: "SD", holdingCompanyName: "Capitol Bancorp", nameShared: true,
};

const UK_TEXT = "University of Kentucky Federal Credit Union\nSchedule of Fees, effective March 2026\n" +
  "Overdraft fee $30.00\nLexington, KY 40507 | Federally insured by NCUA";
const SMCU_TEXT = "St. Mary’s Credit Union Fee Schedule\nNon-SMCU ATM withdrawal $2.00\n46 Lincoln Street, Marlborough, MA 01752";
const FNB_TEXT = "First National Bank\nPersonal Fee Schedule\nNSF item $30\n" +
  "First National Bank | 101 Main Ave, Fort Pierre, SD 57532 | Member FDIC";

describe("documentOwnerVerdict: the document names another bank (#1455)", () => {
  it("UK FCU's schedule filed under Bluegrass Community FCU", () => {
    expect(documentOwnerVerdict(UK_TEXT, bluegrass, [ukfcu])).toMatchObject({ kind: "other_bank", otherId: 6729 });
  });

  it("St. Mary's CU's schedule filed under Metrowest Community FCU (curly apostrophe, short CU name)", () => {
    expect(documentOwnerVerdict(SMCU_TEXT, metrowest, [stMarys])).toMatchObject({ kind: "other_bank", otherId: 8298 });
  });

  it("First National Bank, Fort Pierre's schedule filed under First National Bank, Oldham: the city decides", () => {
    // The seed stored Fort Pierre's website for Oldham, so the document's host links them.
    const link = { hostIds: [582], documentHost: "firstnationalbanks.bank" };
    expect(documentOwnerVerdict(FNB_TEXT, fnbOldham, [fnbFortPierre], [], link)).toEqual({
      kind: "other_bank", otherId: 582, evidence: "city: fort pierre sd",
    });
    // Linked only by address or text hash, a city alone is not enough.
    expect(documentOwnerVerdict(FNB_TEXT, fnbOldham, [fnbFortPierre])).toEqual({ kind: "shared_service", otherIds: [582] });
  });

  it("the city with its full state name counts too", () => {
    const text = "First National Bank schedule. Fort Pierre, South Dakota.";
    expect(documentOwnerVerdict(text, fnbOldham, [fnbFortPierre], [], { hostIds: [582], documentHost: "firstnationalbanks.bank" }))
      .toMatchObject({ kind: "other_bank", otherId: 582 });
  });
});

describe("documentOwnerVerdict: no takedown", () => {
  it("passes the owner itself on its own schedule", () => {
    expect(documentOwnerVerdict(UK_TEXT, ukfcu, [bluegrass])).toMatchObject({ kind: "own_named" });
    expect(documentOwnerVerdict(FNB_TEXT, fnbFortPierre, [fnbOldham])).toEqual({ kind: "own_named", evidence: "city: fort pierre" });
  });

  it("a holding company or brand name: Capital City Bank on Capital City Bank Group's schedule", () => {
    const own: OwnerBank = { id: 1, name: "Capital City Bank", city: "Tallahassee", stateCode: "FL" };
    const other: OwnerBank = { id: 2, name: "Prime Meridian Bank", city: "Tallahassee", stateCode: "FL" };
    const text = "Capital City Bank Group, Inc. Schedule of Fees. Member FDIC.";
    expect(documentOwnerVerdict(text, own, [other])).toEqual({ kind: "own_named", evidence: "name: capital city bank" });
  });

  it("a name the other institution contains is not evidence for either side", () => {
    const own: OwnerBank = { id: 1, name: "Capital City Bank", city: "Tallahassee", stateCode: "FL" };
    const group: OwnerBank = { id: 2, name: "Capital City Bank Group", city: "Tallahassee", stateCode: "FL" };
    expect(documentOwnerVerdict("Capital City Bank Group fee schedule", own, [group])).toEqual({ kind: "unproven" });
    // The shared city counts for this bank only with its state.
    expect(documentOwnerVerdict("Capital City Bank Group, Tallahassee, Florida", own, [group])).toMatchObject({ kind: "own_named" });
  });

  it("Member FDIC / NCUA boilerplate and a generic name name no one", () => {
    const own: OwnerBank = { id: 1, name: "Farmers Savings Bank", city: "Spencer", stateCode: "IA" };
    const generic: OwnerBank = { id: 2, name: "Community Bank", city: "Pittsburgh", stateCode: "PA" };
    const text = "Your community bank. Member FDIC. Equal Housing Lender. Federally insured by NCUA.";
    expect(ownerNameForms("Community Bank")).toEqual([]);
    expect(documentOwnerVerdict(text, own, [generic])).toEqual({ kind: "unproven" });
  });

  it("a co-branded document that names both banks stays with this bank", () => {
    const text = `${UK_TEXT}\nServices provided with Bluegrass Community Federal Credit Union`;
    expect(documentOwnerVerdict(text, bluegrass, [ukfcu])).toMatchObject({ kind: "own_named" });
  });

  it("a shared-service document naming two other banks is not one bank's schedule", () => {
    const third: OwnerBank = { id: 9, name: "Commonwealth Credit Union", city: "Frankfort", stateCode: "KY" };
    const text = "Shared branch fees for University of Kentucky Federal Credit Union and Commonwealth Credit Union members";
    expect(documentOwnerVerdict(text, bluegrass, [ukfcu, third])).toEqual({ kind: "shared_service", otherIds: [6729, 9] });
  });

  it("sibling charters sharing one schedule are never taken down (#1441)", () => {
    const ibc: OwnerBank = { id: 160, name: "International Bank of Commerce", city: "Laredo", stateCode: "TX", holdingCompanyRssd: "01102367" };
    const commerce: OwnerBank = { id: 1319, name: "Commerce Bank", city: "Laredo", stateCode: "TX", holdingCompanyRssd: "1102367" };
    const brownsville: OwnerBank = { id: 318, name: "International Bank of Commerce", city: "Brownsville", stateCode: "TX", holdingCompanyName: "International Bancshares Corp" };
    const zapata: OwnerBank = { id: 1769, name: "Zapata County Bank", city: "Zapata", stateCode: "OK", holdingCompanyName: "INTERNATIONAL BANCSHARES CORP." };
    const text = "International Bank of Commerce (IBC Bank) fee schedule. Member FDIC";
    expect(documentOwnerVerdict(text, commerce, [ibc])).toMatchObject({ kind: "sibling_shared", siblingIds: [160] });
    expect(documentOwnerVerdict(text, zapata, [brownsville])).toMatchObject({ kind: "sibling_shared" });
  });

  it("another bank's shared name without its city is not enough, even as a title line", () => {
    const own: OwnerBank = { id: 915, name: "Rock Valley State Bank", city: "Rock Valley", stateCode: "IA" };
    const peoples: OwnerBank = { id: 505, name: "Peoples Bank", city: "Bellingham", stateCode: "WA", nameShared: true };
    expect(documentOwnerVerdict("Peoples Bank fee schedule", own, [peoples])).toEqual({ kind: "unproven" });
    expect(documentOwnerVerdict("Peoples Bank fee schedule, Bellingham", own, [peoples])).toMatchObject({ kind: "other_bank", otherId: 505 });
  });

  it("this bank's certificate number keeps the document", () => {
    const own = { ...fnbOldham, certNumber: "3925" };
    expect(documentOwnerVerdict(`${FNB_TEXT} FDIC Certificate #3925`, own, [fnbFortPierre])).toMatchObject({ kind: "own_named" });
  });

  it("no stored text decides nothing", () => {
    expect(documentOwnerVerdict(null, bluegrass, [ukfcu])).toEqual({ kind: "no_text" });
    expect(documentOwnerVerdict("   ", bluegrass, [ukfcu])).toEqual({ kind: "no_text" });
  });
});

describe("the real owner on its own website (#1455 re-review B2)", () => {
  const heartland: OwnerBank = { id: 9101, name: "Heartland Bank and Trust Company", city: "Bloomington", stateCode: "IL", websiteHost: "hbtbank.com" };
  const springfield: OwnerBank = { id: 9102, name: "Town and Country Bank", city: "Springfield", stateCode: "IL", websiteHost: "townandcountrybank.com" };
  const own = { documentHost: "hbtbank.com", hostIds: [], hashIds: [] };

  it("prints its name with '&' and 'Company': own_named, not other_bank naming the url-linked bank's city", () => {
    const text = "Heartland Bank & Trust Company\nPersonal Fee Schedule\n401 N. Hershey Rd., Springfield, IL 62703\nOverdraft $30";
    expect(documentOwnerVerdict(text, heartland, [springfield], [], own)).toMatchObject({ kind: "own_named", evidence: "name: heartland bank and trust" });
  });

  it("'&', 'Company', 'Co.', 'Inc.' and 'N.A.' fold the same way in names and holding companies", () => {
    expect(ownerNameForms("Heartland Bank & Trust Co.", "Bloomington")).toContain("heartland bank and trust");
    expect(ownerNameForms("Heartland Bank and Trust Company, Inc.", "Bloomington")).toContain("heartland bank and trust");
    expect(holdingCompanyKey("Wells Fargo & Company")).toBe(holdingCompanyKey("WELLS FARGO AND CO."));
  });

  it("names only a variant ('HBT Bank'): an address- or hash-linked bank is capped at shared_service on this bank's site or a subdomain", () => {
    const text = "HBT Bank\nPersonal Fee Schedule\nSpringfield, IL 62703\nOverdraft $30";
    expect(documentOwnerVerdict(text, heartland, [springfield], [], own)).toEqual({ kind: "shared_service", otherIds: [9102] });
    expect(documentOwnerVerdict(text, heartland, [springfield], [], { ...own, documentHost: "docs.hbtbank.com", hashIds: [9102] }))
      .toEqual({ kind: "shared_service", otherIds: [9102] });
    // Off this bank's site too: a city is not enough for an address- or hash-linked bank (probe A).
    expect(documentOwnerVerdict(text, heartland, [springfield], [], { ...own, documentHost: "files.vendor.net" }))
      .toEqual({ kind: "shared_service", otherIds: [9102] });
    // A bank linked by its stored website (the seed stored it for this bank too) is not capped.
    expect(documentOwnerVerdict(text, heartland, [{ ...springfield, websiteHost: "hbtbank.com" }], [], { ...own, hostIds: [9102] }))
      .toMatchObject({ kind: "other_bank", otherId: 9102 });
  });

  it("subdomains count as this bank's own site, look-alike hosts do not", () => {
    expect(onWebsiteHost("hbtbank.com", "hbtbank.com")).toBe(true);
    expect(onWebsiteHost("docs.hbtbank.com", "hbtbank.com")).toBe(true);
    expect(onWebsiteHost("myhbtbank.com", "hbtbank.com")).toBe(false);
    expect(onWebsiteHost(null, "hbtbank.com")).toBe(false);
  });
});

describe("the final review's probes (#1455, gen2/probe.test.ts)", () => {
  const hbt: OwnerBank = { id: 1, name: "Heartland Bank and Trust Company", city: "Bloomington", stateCode: "IL", websiteHost: "hbtbank.com" };
  const tc: OwnerBank = { id: 2, name: "Town and Country Bank", city: "Springfield", stateCode: "IL", websiteHost: "townandcountrybank.com" };
  const text = "HBT Bank\nPersonal Fee Schedule\n401 N. Hershey Rd., Springfield, IL 62703\nOverdraft $30";
  const noSite = { ...hbt, websiteHost: null };

  it("A: on a CDN, a url-linked bank's city does not take the real owner's schedule", () => {
    expect(documentOwnerVerdict(text, hbt, [tc], [], { documentHost: "files.vendor.net" })).toEqual({ kind: "shared_service", otherIds: [2] });
    expect(documentOwnerVerdict(text, tc, [hbt], [], { documentHost: "files.vendor.net" })).toMatchObject({ kind: "own_named" });
  });

  it("B: with no stored website the city is still not enough", () => {
    expect(documentOwnerVerdict(text, noSite, [tc], [], { documentHost: "hbtbank.com" })).toEqual({ kind: "shared_service", otherIds: [2] });
  });

  it("C: with no stored website, another bank seeded with this bank's domain gets no site rule", () => {
    const seeded = { ...tc, websiteHost: "hbtbank.com" };
    expect(documentOwnerVerdict("HBT Bank\nFee Schedule\nOverdraft $30", noSite, [seeded], [], { documentHost: "hbtbank.com", hostIds: [2] }))
      .toEqual({ kind: "unproven" });
  });

  it("D: a trade name on a CDN, with a hash-linked bank's city as a branch address", () => {
    const hunt: OwnerBank = { id: 3, name: "The Huntington National Bank", city: "Columbus", stateCode: "OH", websiteHost: "huntington.com" };
    const x: OwnerBank = { id: 4, name: "Heartland Bank", city: "Whitehall", stateCode: "OH", websiteHost: "heartland.bank" };
    expect(documentOwnerVerdict("Huntington\nConsumer Fee Schedule\nWhitehall, Ohio branch\nOverdraft $15", hunt, [x], [],
      { documentHost: "cdn.huntington-assets.net", hashIds: [4] })).toEqual({ kind: "shared_service", otherIds: [4] });
  });

  it("E: a dotted F.S.B. or S.S.B. suffix is dropped, so the name prints", () => {
    const fsb: OwnerBank = { id: 5, name: "Liberty Savings Bank, F.S.B.", city: "Wilmington", stateCode: "OH", websiteHost: "lsbank.com" };
    expect(documentOwnerVerdict("Liberty Savings Bank\nFee schedule\nDayton, OH", fsb, [{ id: 6, name: "Dayton Credit Union", city: "Dayton", stateCode: "OH" }], [],
      { documentHost: "cdn.x.com" })).toEqual({ kind: "own_named", evidence: "name: liberty savings bank" });
    expect(ownerNameForms("Home Savings Bank, S.S.B.", "Madison")).toContain("home savings bank");
  });

  it("F: a stored subdomain website owns its apex and sibling subdomains", () => {
    const sub: OwnerBank = { id: 7, name: "Acme Bank", city: "Zed", stateCode: "TX", websiteHost: "home.acmebank.com" };
    expect(documentOwnerVerdict("Acmebank\nFees\nAustin, TX", sub, [{ id: 8, name: "Austin Bank", city: "Austin", stateCode: "TX" }], [], { documentHost: "acmebank.com" }))
      .toEqual({ kind: "shared_service", otherIds: [8] });
    expect(onWebsiteHost("acmebank.com", "home.acmebank.com")).toBe(true);
    expect(onWebsiteHost("docs.acmebank.com", "home.acmebank.com")).toBe(true);
    expect(onWebsiteHost("acmebank.co.uk", "www.acmebank.co.uk")).toBe(true);
    expect(onWebsiteHost("otherbank.co.uk", "acmebank.co.uk")).toBe(false);
    expect(registrableDomain("online.bank.com.au")).toBe("bank.com.au");
  });

  it("a full name form still gives other_bank for an address- or hash-linked bank off this bank's site", () => {
    expect(documentOwnerVerdict("Town and Country Bank\nFee Schedule", hbt, [tc], [], { documentHost: "files.vendor.net", hashIds: [2] }))
      .toMatchObject({ kind: "other_bank", otherId: 2, evidence: "name: town and country bank" });
  });
});

describe("vendor-served documents and the prod dry run (Oct 15)", () => {
  const healthplus: OwnerBank = { id: 5009, name: "Healthplus Federal Credit Union", city: "Gulfport", stateCode: "MS", websiteHost: "healthplusfcu.org" };
  const members: OwnerBank[] = [
    { id: 4694, name: "Profinance Federal Credit Union", city: "Merrillville", stateCode: "IN", websiteHost: "profinancefcu.com" },
    { id: 5733, name: "East Alabama Community Federal Credit Union", city: "Opelika", stateCode: "AL", websiteHost: "eacfcu.org" },
    { id: 5804, name: "Palace City Federal Credit Union", city: "Mitchell", stateCode: "SD", websiteHost: "palacecityfcu.org" },
    { id: 6045, name: "Meridian Mississippi ANG Federal Credit Union", city: "Meridian", stateCode: "MS", websiteHost: "mmangfcu.org" },
    { id: 5233, name: "Lakehurst Naval Federal Credit Union", city: "Lakehurst", stateCode: "NJ", websiteHost: "lnfcu.org" },
  ];
  const onomea: OwnerBank = { id: 4728, name: "Onomea Federal Credit Union", city: "Hilo", stateCode: "HI", websiteHost: "onomeafcu.org" };
  const lakehurst = members[4];
  const horizons: OwnerBank = { id: 8416, name: "Horizons North Credit Union", city: "Northglenn", stateCode: "CO", websiteHost: "hncu.org" };
  const fiveStar: OwnerBank = { id: 2092, name: "5Star Bank", city: "Colorado Springs", stateCode: "CO", websiteHost: "5star.bank" };
  const currency: OwnerBank = { id: 2720, name: "Currency Bank", city: "Oak Grove", stateCode: "LA" };
  const direct: OwnerBank = { id: 5355, name: "Direct Federal Credit Union", city: "Needham", stateCode: "MA" };
  const westminster: OwnerBank = { id: 900, name: "Westminster Bank", city: "Westminster", stateCode: "CO" };
  const directory = buildNameDirectory([healthplus, ...members, onomea, horizons, fiveStar, ukfcu, bluegrass, currency, direct, westminster]);
  const HEALTHPLUS_TEXT = "HEALTHPLUS FEDERAL CREDIT UNION | Fee Schedule\nEffective January 1, 2026\nDirect deposit: free\nCurrency exchange $5\nNSF / Returned item $30.00\nFederally insured by NCUA";
  const BARE_BRAND_TEXT = "HEALTHPLUS | Fee Schedule\nEffective January 1, 2026\nDirect deposit: free\nNSF / Returned item $30.00";
  const LAKEHURST_TEXT = "LAKEHURST NAVAL FEDERAL CREDIT UNION FEE SCHEDULE\nOverdraft $25\nCurrency order $5";
  const scan = (text: string, own: OwnerBank) =>
    institutionsNamedIn(text, directory).filter((id) => id !== own.id).map((id) => directory.banks.get(id)!);
  const vendor = (own: OwnerBank, linked: OwnerBank[], url = "https://x.org/ezs3download/download/286194/1458976/") => ({
    hashIds: linked.map((other) => other.id), hostIds: [], vendorPath: isVendorDocumentPath(url), documentHost: own.websiteHost,
  });

  it("the Healthplus copy on each member domain names its owner through the text hash (stray 'direct', 'currency' ignored)", () => {
    for (const own of members.slice(0, 4)) {
      const linked = [healthplus, ...members.filter((other) => other.id !== own.id && other.id !== 5233)];
      expect(documentOwnerVerdict(HEALTHPLUS_TEXT, own, linked, scan(HEALTHPLUS_TEXT, own), vendor(own, linked)))
        .toMatchObject({ kind: "other_bank", otherId: 5009, evidence: "vendor copy: text hash" });
    }
  });

  it("but Healthplus's own copy is its own", () => {
    const linked = members.slice(0, 4);
    expect(documentOwnerVerdict(HEALTHPLUS_TEXT, healthplus, linked, scan(HEALTHPLUS_TEXT, healthplus), vendor(healthplus, linked)))
      .toMatchObject({ kind: "own_named" });
  });

  it("a bare one-word brand never names the vendor copy's owner (#1455 re-review)", () => {
    const own = members[0];
    const linked = [healthplus, ...members.slice(1, 4)];
    expect(documentOwnerVerdict(BARE_BRAND_TEXT, own, linked, scan(BARE_BRAND_TEXT, own), vendor(own, linked))).toEqual({ kind: "unproven" });
    expect(vendorCopyOwner(BARE_BRAND_TEXT, [own, ...linked])).toBeNull();
  });

  it("a hash sharer 'Access Credit Union' is not named by 'ATM access fee'", () => {
    const access: OwnerBank = { id: 7001, name: "Access Credit Union", city: "Broadview", stateCode: "IL" };
    const own = members[1];
    const text = "Fee Schedule\nATM access fee $2.00\nOverdraft $25";
    expect(vendorCopyOwner(text, [own, access])).toBeNull();
    expect(documentOwnerVerdict(text, own, [access], [], vendor(own, [access]))).toEqual({ kind: "unproven" });
  });

  it("without the text-hash link, the one-word brand is not a name", () => {
    expect(ownerNameForms("Healthplus Federal Credit Union", "Gulfport")).not.toContain("healthplus");
    expect(documentOwnerVerdict(BARE_BRAND_TEXT, members[0], [], scan(BARE_BRAND_TEXT, members[0]))).toEqual({ kind: "unproven" });
    // The full name without a link is only a registry mention.
    expect(documentOwnerVerdict(HEALTHPLUS_TEXT, members[0], [], scan(HEALTHPLUS_TEXT, members[0]))).toEqual({ kind: "registry_named", otherIds: [5009] });
  });

  it("4728 Onomea and 5009 Healthplus documents that open with Lakehurst Naval FCU's name are Lakehurst's", () => {
    for (const own of [onomea, healthplus]) {
      expect(documentOwnerVerdict(LAKEHURST_TEXT, own, [lakehurst], scan(LAKEHURST_TEXT, own), vendor(own, [lakehurst])))
        .toMatchObject({ kind: "other_bank", otherId: 5233 });
    }
  });

  it("2092 5Star's kcms-doc copy that opens HNCU.ORG: Horizons North only when linked", () => {
    const text = "HNCU.ORG\nFee Schedule\nOverdraft $30\nWestminster branch hours\nCurrency $5\nDirect deposit free";
    const url = "https://5star.bank/_/kcms-doc/1264/97709/WEB_HNCU_Fee_Schedule_.pdf";
    expect(isVendorDocumentPath(url)).toBe(true);
    // Linked by its text hash: its acronym names it.
    expect(documentOwnerVerdict(text, fiveStar, [horizons], scan(text, fiveStar), vendor(fiveStar, [horizons], url)))
      .toMatchObject({ kind: "other_bank", otherId: 8416 });
    // Registry-only: never a takedown, and the common words find no one.
    expect(scan(text, fiveStar)).toEqual([]);
    expect(documentOwnerVerdict(text, fiveStar, [], scan(text, fiveStar), { vendorPath: true, documentHost: "5star.bank" })).toEqual({ kind: "unproven" });
  });

  it("a vendor path alone is no proof: a text that names no one stays", () => {
    const text = "Fee Schedule\nOverdraft $30\nMember FDIC. Equal Housing Lender.";
    expect(scan(text, fiveStar)).toEqual([]);
    expect(documentOwnerVerdict(text, fiveStar, [], scan(text, fiveStar), { vendorPath: true })).toEqual({ kind: "unproven" });
  });

  it("one-word brands count only next to their city; common words never", () => {
    expect(ownerNameForms("Currency Bank", "Oak Grove")).toEqual(["currency bank"]);
    expect(ownerNameForms("Timberline Bank", "Fort Pierre")).toEqual(["timberline bank", "fort pierre timberline", "timberline fort pierre"]);
    expect(ownerNameForms("Members Credit Union")).toEqual(["members credit union"]);
    for (const word of ["currency", "customers", "applied", "direct", "method", "certified", "principal", "primary", "medallion", "surety", "options", "popular"]) {
      expect(institutionsNamedIn(`${word} account ${word}`, buildNameDirectory([{ id: 1, name: `${word} Bank`, city: "Springfield" }]))).toEqual([]);
    }
    expect(institutionsNamedIn("Member FDIC. Federally insured by NCUA. Equal Housing Lender.", directory)).toEqual([]);
  });

  it("5652 Timberline FCU's own schedule is its own, though Timberline Bank exists", () => {
    const own: OwnerBank = { id: 5652, name: "Timberline Federal Credit Union", city: "Hayward", stateCode: "WI" };
    const bank: OwnerBank = { id: 1270, name: "Timberline Bank", city: "Grants Pass", stateCode: "OR" };
    const text = "Timberline Federal Credit Union\nFee Schedule\nOverdraft $25";
    const dir = buildNameDirectory([own, bank]);
    const found = institutionsNamedIn(text, dir).filter((id) => id !== own.id).map((id) => dir.banks.get(id)!);
    expect(documentOwnerVerdict(text, own, [bank], found, { vendorPath: true, documentHost: "x.org" })).toMatchObject({ kind: "own_named" });
  });

  it("the site rule: on exactly one unrelated institution's own website, and not this bank's", () => {
    const metrowest: OwnerBank = { id: 4884, name: "Metrowest Community Federal Credit Union", city: "Framingham", stateCode: "MA", websiteHost: "metrowestcu.org" };
    const smcu: OwnerBank = { id: 8298, name: "St. Mary's Federal Credit Union", city: "Marlborough", stateCode: "MA", websiteHost: "stmaryscu.org" };
    const text = "Fee Schedule\nNon-SMCU ATM withdrawal $2.00";
    expect(documentOwnerVerdict(text, metrowest, [smcu], [], { hostIds: [8298], documentHost: "stmaryscu.org" }))
      .toEqual({ kind: "other_bank", otherId: 8298, evidence: "site: stmaryscu.org" });
    // Linked only by address or text hash, the acronym alone is capped (#1455 final review).
    expect(documentOwnerVerdict(text, metrowest, [smcu], [], { documentHost: "firstbranchcms.com" }))
      .toEqual({ kind: "shared_service", otherIds: [8298] });
    expect(creditUnionAcronyms("St. Mary's Federal Credit Union")).toEqual(["smfcu", "smcu"]);
    // St. Mary's own copy names itself by its acronym.
    expect(documentOwnerVerdict(text, smcu, [metrowest], [], { documentHost: "firstbranchcms.com" })).toMatchObject({ kind: "own_named" });
    // The seed stored the same website for both: the site alone decides nothing.
    const seeded = { ...metrowest, websiteHost: "stmaryscu.org" };
    expect(documentOwnerVerdict("Fee Schedule\nOverdraft $30", seeded, [smcu], [], { hostIds: [8298], documentHost: "stmaryscu.org" })).toEqual({ kind: "unproven" });
  });

  it("this bank's website printed in the text keeps the document (not when it is the document's host)", () => {
    const own: OwnerBank = { id: 7, name: "Riverbend Community Bank", city: "Paducah", stateCode: "KY", websiteHost: "riverbend.bank" };
    const other: OwnerBank = { id: 8, name: "Hostco Savings Bank", city: "Dover", stateCode: "DE", websiteHost: "hostco.com" };
    expect(documentOwnerVerdict("Fees\nVisit riverbend.bank", own, [other], [], { hostIds: [8], documentHost: "hostco.com" }))
      .toEqual({ kind: "own_named", evidence: "website: riverbend.bank" });
  });

  it("7353 Family First's copy that opens with Sunrise Family Credit Union's name, when linked", () => {
    const own: OwnerBank = { id: 7353, name: "Family First Federal Credit Union", city: "Gadsden", stateCode: "AL" };
    const sunrise: OwnerBank = { id: 7367, name: "Sunrise Family Credit Union", city: "Bay City", stateCode: "MI" };
    const text = "Sunrise Family Credit Union\nSchedule of Fees\nOverdraft $28";
    expect(documentOwnerVerdict(text, own, [sunrise], [], { hashIds: [7367], vendorPath: true })).toMatchObject({ kind: "other_bank", otherId: 7367 });
    expect(documentOwnerVerdict(text, own, [], [sunrise], { vendorPath: true })).toEqual({ kind: "registry_named", otherIds: [7367] });
  });

  it("sibling charters on one shared text never fire: IBC's five and Wells Fargo's three (#1441)", () => {
    const ibcRssd = "1102367";
    const ibc: OwnerBank[] = [
      { id: 160, name: "International Bank of Commerce", city: "Laredo", stateCode: "TX", holdingCompanyRssd: ibcRssd },
      { id: 318, name: "International Bank of Commerce", city: "Brownsville", stateCode: "TX", holdingCompanyRssd: ibcRssd },
      { id: 688, name: "International Bank of Commerce Oklahoma", city: "Oklahoma City", stateCode: "OK", holdingCompanyRssd: ibcRssd },
      { id: 1319, name: "Commerce Bank", city: "Laredo", stateCode: "TX", holdingCompanyRssd: ibcRssd },
      { id: 1769, name: "International Bank of Commerce", city: "Zapata", stateCode: "TX", holdingCompanyRssd: ibcRssd },
    ];
    const wells: OwnerBank[] = [
      { id: 4, name: "Wells Fargo Bank, National Association", city: "Sioux Falls", stateCode: "SD", holdingCompanyName: "Wells Fargo & Company" },
      { id: 172, name: "Wells Fargo Bank South Central, National Association", city: "Houston", stateCode: "TX", holdingCompanyName: "WELLS FARGO & COMPANY" },
      { id: 359, name: "Wells Fargo National Bank West", city: "Las Vegas", stateCode: "NV", holdingCompanyName: "Wells Fargo & Company" },
    ];
    const dir = buildNameDirectory([...ibc, ...wells]);
    for (const [group, text] of [
      [ibc, "IBC Bank fee schedule. International Bank of Commerce, Laredo, Texas. Member FDIC."],
      [wells, "Wells Fargo Bank, N.A. Consumer Account Fee and Information Schedule. Member FDIC."],
    ] as const) {
      for (const own of group) {
        const others = group.filter((other) => other.id !== own.id);
        const found = institutionsNamedIn(text, dir).filter((id) => id !== own.id).map((id) => dir.banks.get(id)!);
        const verdict = documentOwnerVerdict(text, own, others, found);
        expect(["sibling_shared", "own_named"]).toContain(verdict.kind);
      }
    }
  });
});

describe("registry-only names never take a fee down (#1455 review)", () => {
  const own: OwnerBank = { id: 1, name: "Riverbend Community Bank", city: "Paducah", stateCode: "KY" };
  const registry: OwnerBank[] = [
    { id: 11, name: "Associated Bank, National Association", city: "Green Bay", stateCode: "WI" },
    { id: 12, name: "Customers Bank", city: "Phoenixville", stateCode: "PA" },
    { id: 13, name: "Popular Bank", city: "New York", stateCode: "NY" },
    { id: 14, name: "Banco Popular de Puerto Rico", city: "San Juan", stateCode: "PR" },
    { id: 15, name: "Independent Bank", city: "McKinney", stateCode: "TX" },
    { id: 16, name: "Origin Bank", city: "Choudrant", stateCode: "LA" },
    { id: 17, name: "Discover Bank", city: "Greenwood", stateCode: "DE" },
    { id: 18, name: "Members Choice Credit Union", city: "Houston", stateCode: "TX" },
    { id: 19, name: "Bank of America, National Association", city: "Charlotte", stateCode: "NC" },
    { id: 20, name: "U.S. Bank National Association", city: "Cincinnati", stateCode: "OH" },
    { id: 21, name: "Wells Fargo Bank, National Association", city: "Sioux Falls", stateCode: "SD" },
    { id: 22, name: "Alloya Corporate Federal Credit Union", city: "Naperville", stateCode: "IL" },
  ];
  const directory = buildNameDirectory([own, ...registry]);
  const phrases = [
    "Fees associated with your account are listed below.",
    "Customers may request a paper statement.",
    "Our most popular checking account has no monthly fee.",
    "Independent ATM operators may charge a surcharge.",
    "Country of origin conversion fee applies.",
    "We accept Visa, Mastercard, Discover and American Express.",
    "Members choice: pick the account that fits you.",
    "Wires are processed through Bank of America.",
    "Our debit card is issued by U.S. Bank.",
    "Coin counting at Wells Fargo is free for our members.",
    "ACH items receive settlement by Alloya Corporate FCU.",
  ];
  for (const phrase of phrases) {
    it(`"${phrase}" on our own schedule is not another bank's`, () => {
      for (const text of [`${phrase}\nFee Schedule\nOverdraft $30`, `Fee Schedule\nWe charge the fees below.\nOverdraft $30\n${phrase}`]) {
        const found = institutionsNamedIn(text, directory).filter((id) => id !== own.id).map((id) => directory.banks.get(id)!);
        const verdict = documentOwnerVerdict(text, own, [], found);
        expect(["registry_named", "unproven"]).toContain(verdict.kind);
      }
    });
  }

  it("the header rule: a title line that starts with the full legal name", () => {
    expect(headerNamesInstitution("Bank of America Consumer Schedule of Fees\nOverdraft $35", "Bank of America, National Association")).toBe(true);
    expect(headerNamesInstitution("BANK OF AMERICA\nOverdraft $35", "Bank of America, N.A.")).toBe(true);
    expect(headerNamesInstitution("Wires are processed through Bank of America.", "Bank of America")).toBe(false);
    expect(headerNamesInstitution("bank of america fees", "Bank of America")).toBe(false);
    expect(headerNamesInstitution("Popular checking fees", "Popular")).toBe(false);
    expect(headerNamesInstitution("Discover Bank fees", "Discover")).toBe(false);
  });

  it("a title-cased correspondent on line 1 is only for review (O1)", () => {
    const wells: OwnerBank = { id: 21, name: "Wells Fargo Bank, National Association", city: "Sioux Falls", stateCode: "SD" };
    const usb: OwnerBank = { id: 20, name: "U.S. Bank National Association", city: "Cincinnati", stateCode: "OH" };
    const boa: OwnerBank = { id: 19, name: "Bank of America, National Association", city: "Charlotte", stateCode: "NC" };
    const discover: OwnerBank = { id: 17, name: "Discover Bank", city: "Greenwood", stateCode: "DE" };
    for (const [text, bank] of [
      ["Wells Fargo Bank\nFee Schedule", wells],
      ["U.S. Bank\nFee Schedule", usb],
      ["Bank of America ATM Fees\nOverdraft $30", boa],
      ["Discover Bank Card Fees\nLate fee $40", discover],
    ] as const) {
      expect(headerNamesInstitution(text, bank.name)).toBe(true);
      expect(documentOwnerVerdict(text, own, [], [bank])).toEqual({ kind: "registry_named", otherIds: [bank.id] });
    }
  });

  it("a header name another institution shares is not enough", () => {
    const fnb = { id: 30, name: "First National Bank", city: "Fort Pierre", stateCode: "SD", nameShared: true };
    expect(documentOwnerVerdict("First National Bank\nFee Schedule", own, [], [fnb])).toMatchObject({ kind: "registry_named" });
  });
});

describe("sharedNameIds", () => {
  it("marks a name another institution has or contains", () => {
    const directory = buildNameDirectory([
      { id: 1, name: "First National Bank" },
      { id: 2, name: "The First National Bank of Omaha" },
      { id: 3, name: "Bluegrass Community FCU" },
    ]);
    expect([...sharedNameIds(directory, [1, 3])]).toEqual([1]);
  });
});

describe("documentOwnerCountSql", () => {
  it("is read-only, counts each live fee once and mirrors the verdicts", () => {
    const text = documentOwnerCountSql();
    expect(text).not.toMatch(/\b(UPDATE|INSERT|DELETE|ALTER|DROP|TRUNCATE)\b/i);
    expect(text).toContain("count(DISTINCT live.fee_published_id) AS live_fees");
    for (const verdict of ["own_named", "sibling_shared", "other_bank", "shared_service", "registry_named", "unproven", "no_text"]) {
      expect(text).toContain(`'${verdict}'`);
    }
    expect(text).toContain("('SD', 'south dakota')");
    expect(documentOwnerCountSql({ detail: true })).toContain("named_other_name");
  });

  it("runs in a read-only transaction that rolls back, with JIT off and a timeout", () => {
    for (const text of [documentOwnerCountSql(), documentOwnerCountSql({ detail: true })]) {
      expect(text).toMatch(/^-- [^\n]*\n(--[^\n]*\n)*BEGIN READ ONLY;\nSET LOCAL jit = off;\nSET LOCAL enable_mergejoin = off;\nSET LOCAL statement_timeout = '120s';\n/);
      expect(text.trimEnd().endsWith("ROLLBACK;")).toBe(true);
    }
  });

  it("skips quarantined fees and boilerplate text hashes, and hashes the judged text row", () => {
    const text = documentOwnerPairsSql();
    expect(text.match(/fp\.quarantined_at IS NULL/g)).toHaveLength(1);
    expect(text).toContain("t.char_count >= 200");
    expect(text).toContain("HAVING count(DISTINCT t.source_document_id) <= 20");
    expect(text).toContain("t.status = 'completed' AND t.normalized_text IS NOT NULL");
  });

  it("reads each pair once per version, mode and text hash; re-reads have their own cap", () => {
    expect(documentOwnerFingerprint(5756, 17191, "ab12", false)).toBe("owner-shadow:5756:17191:ab12");
    expect(documentOwnerFingerprint(5756, 17191, null, true)).toBe("owner:5756:17191:none");
    const text = documentOwnerPairsSql();
    expect(text).toContain("s.source_document_id::text || ':' || s.text_hash");
    expect(text).toContain("LIMIT $4");
    expect(text).toContain("LIMIT $5");
  });
});

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

function createDb(pairs?: unknown[], lastEvent: Record<string, unknown> | null = null) {
  const query = vi.fn((strings: TemplateStringsArray) => {
    const text = templateText(strings);
    if (text.includes("max(fee_published_id)")) return Promise.resolve([{ text_id: 10, fee_id: 20 }]);
    if (text.includes("SELECT detail FROM agent_run_events")) return Promise.resolve(lastEvent ? [{ detail: lastEvent }] : []);
    if (text.includes("to_regclass")) return Promise.resolve([{ ready: true }]);
    if (text.includes("current_setting('statement_timeout')")) return Promise.resolve([{ value: "0", applied: "60s" }]);
    if (text.includes("document-owner name scan")) {
      return Promise.resolve([
        { id: 5756, institution_name: bluegrass.name, city: "Ashland", state_code: "KY", cert_number: null, holding_company_rssd: null, holding_company_name: null },
        { id: 6729, institution_name: ukfcu.name, city: "Lexington", state_code: "KY", cert_number: null, holding_company_rssd: null, holding_company_name: null },
        { id: 160, institution_name: "International Bank of Commerce", city: "Laredo", state_code: "TX", cert_number: null, holding_company_rssd: "1102367", holding_company_name: null },
        { id: 1319, institution_name: "Commerce Bank", city: "Laredo", state_code: "TX", cert_number: null, holding_company_rssd: "1102367", holding_company_name: null },
      ]);
    }
    if (text.includes("FROM agent_source_texts")) {
      return Promise.resolve([
        { source_document_id: 17191, normalized_text: UK_TEXT },
        { source_document_id: 900, normalized_text: "International Bank of Commerce fee schedule" },
      ]);
    }
    if (text.includes("FROM published_fee_records fp")) {
      return Promise.resolve([
        { fee_published_id: 71, fee_verified_id: 81, institution_id: 5756, source_document_id: 17191 },
        { fee_published_id: 72, fee_verified_id: 82, institution_id: 5756, source_document_id: 17191 },
        { fee_published_id: 73, fee_verified_id: 83, institution_id: 6729, source_document_id: 17191 },
      ]);
    }
    return Promise.resolve([]);
  });
  const db = query as unknown as ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
  db.unsafe = vi.fn(() => Promise.resolve(pairs ?? [
    { institution_id: 5756, source_document_id: 17191, document_url: "https://ukcreditunion.org/Schedule-of-Fees-2026-03.pdf", live_fees: 2, other_ids: [6729], text_hash: "h1", reread: false },
    { institution_id: 6729, source_document_id: 17191, document_url: "https://ukcreditunion.org/Schedule-of-Fees-2026-03.pdf", live_fees: 23, other_ids: [5756], text_hash: "h1", reread: false },
    { institution_id: 1319, source_document_id: 900, document_url: "https://ibc.com/fees.pdf", live_fees: 30, other_ids: [160], text_hash: "h2", reread: false },
  ]));
  return db as unknown as Parameters<typeof recheckDocumentOwners>[0] & typeof db;
}

describe("recheckDocumentOwners (shadow)", () => {
  it("is off by default", () => {
    expect(DARWIN_DOCUMENT_OWNER_TAKEDOWN).toBe(false);
  });

  it("reports the live fees it would take down, records each pair, and changes no fee", async () => {
    const db = createDb();
    const result = await recheckDocumentOwners(db, { runId: 77, stepId: 3 });
    expect(result.live).toBe(false);
    expect(result.verdicts).toEqual({ other_bank: 1, own_named: 1, sibling_shared: 1 });
    expect(result.siblingSharedDocuments).toBe(1);
    expect(result.wouldTakeDown.map((fee) => [fee.feePublishedId, fee.otherInstitutionId])).toEqual([[71, 6729], [72, 6729]]);
    expect(result.takenDown).toEqual([]);
    const texts = db.mock.calls.map((call) => templateText(call[0]));
    expect(texts.some((text) => /UPDATE|DELETE/.test(text))).toBe(false);
    expect(texts.filter((text) => text.includes("INSERT INTO pipeline_attempts"))).toHaveLength(3);
    const calls = JSON.stringify(db.mock.calls);
    expect(calls).toContain("owner-shadow:5756:17191:h1");
    expect(calls).toContain("darwin.document_owner_shadow");
    // Shadow reads no re-reads.
    expect(db.unsafe.mock.calls[0][1]).toEqual(["owner-shadow:", "verify.document_owner", 1, 25, 0]);
    // The scoped read runs under a 60 s statement timeout that is put back afterwards.
    const timeouts = db.mock.calls.filter((call) => templateText(call[0]).includes("set_config('statement_timeout'")).map((call) => call.slice(1));
    expect(timeouts).toEqual([["60s"], ["0"]]);
  });

  it("records an empty read with its watermark, and the next step skips while nothing is new", async () => {
    const empty = createDb([]);
    const first = await recheckDocumentOwners(empty, { runId: 77 });
    expect(first).toMatchObject({ selected: 0, pairs: 0, skipped: false });
    const event = JSON.stringify(empty.mock.calls.find((call) => templateText(call[0]).includes("INSERT INTO agent_run_events")));
    expect(event).toContain('\\"max_text_id\\":10');
    expect(templateText(empty.mock.calls.map((call) => call[0]))).not.toContain("INSERT INTO pipeline_attempts");

    const next = createDb([], { selected: 0, max_text_id: 10, max_fee_id: 20 });
    expect(await recheckDocumentOwners(next, { runId: 78 })).toMatchObject({ skipped: true, pairs: 0 });
    expect(next.unsafe).not.toHaveBeenCalled();

    const moved = createDb([], { selected: 0, max_text_id: 9, max_fee_id: 20 });
    expect(await recheckDocumentOwners(moved, { runId: 79 })).toMatchObject({ skipped: false });
    expect(moved.unsafe).toHaveBeenCalled();
  });
});

describe("recheckDocumentOwners: the skip keys on pairs selected (O3)", () => {
  it("a pair whose bank has no registry row is recorded unproven, and the step does not look empty", async () => {
    const db = createDb([
      { institution_id: 99999, source_document_id: 17191, document_url: "https://ukcreditunion.org/x.pdf", live_fees: 2, other_ids: [6729], text_hash: "h1", reread: false },
    ]);
    const result = await recheckDocumentOwners(db, { runId: 81 });
    expect(result).toMatchObject({ selected: 1, pairs: 0, verdicts: { unproven: 1 } });
    const calls = JSON.stringify(db.mock.calls);
    expect(calls).toContain("owner-shadow:99999:17191:h1");
    expect(calls).toContain('\\"no_registry_row\\":true');
    expect(calls).toContain('\\"selected\\":1');
  });

  it("a failed registry read still records the pairs selected, so the next step does not skip", async () => {
    const db = createDb();
    const query = db.getMockImplementation() as unknown as (strings: TemplateStringsArray, ...values: unknown[]) => unknown;
    db.mockImplementation(((strings: TemplateStringsArray, ...values: unknown[]) =>
      templateText(strings).includes("document-owner name scan") ? Promise.reject(new Error("boom")) : query(strings, ...values)) as never);
    const result = await recheckDocumentOwners(db, { runId: 82 });
    expect(result).toMatchObject({ selected: 3, pairs: 0 });
    expect(JSON.stringify(db.mock.calls)).toContain('\\"selected\\":3');
  });
});

describe("recheckDocumentOwners (takedown on)", () => {
  it("flags failing fees for the second look, passes the rest, and caps re-reads apart", async () => {
    const db = createDb();
    const result = await recheckDocumentOwners(db, { runId: 80, takedown: true });
    expect(db.unsafe.mock.calls[0][1]).toEqual(["owner:", "verify.document_owner", 1, 25, 25]);
    expect(result.wouldTakeDown.map((fee) => fee.feePublishedId)).toEqual([71, 72]);
    expect(result.flagged).toBe(2);
    expect(result.takenDown).toEqual([]);
    const calls = JSON.stringify(db.mock.calls);
    expect(calls).toContain("hamilton.second_look:darwin.document_owner:pub:71");
    expect(calls).toContain("owner:5756:17191:h1");
  });
});
