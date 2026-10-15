import { describe, expect, it, vi } from "vitest";

import {
  buildNameDirectory,
  DARWIN_DOCUMENT_OWNER_TAKEDOWN,
  documentOwnerCountSql,
  documentOwnerFingerprint,
  documentOwnerPairsSql,
  documentOwnerVerdict,
  institutionsNamedIn,
  isVendorDocumentPath,
  ownerNameForms,
  recheckDocumentOwners,
  sharedNameIds,
  type OwnerBank,
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
    expect(documentOwnerVerdict(FNB_TEXT, fnbOldham, [fnbFortPierre])).toEqual({
      kind: "other_bank", otherId: 582, evidence: "city: fort pierre sd",
    });
  });

  it("the city with its full state name counts too", () => {
    const text = "First National Bank schedule. Fort Pierre, South Dakota.";
    expect(documentOwnerVerdict(text, fnbOldham, [fnbFortPierre])).toMatchObject({ kind: "other_bank", otherId: 582 });
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

  it("another bank's shared name without its city is not enough", () => {
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

describe("vendor-served documents (coordinator finding, Oct 15)", () => {
  const healthplus: OwnerBank = { id: 5009, name: "Healthplus Federal Credit Union", city: "Gulfport", stateCode: "MS" };
  const members: OwnerBank[] = [
    { id: 4694, name: "Profinance Federal Credit Union", city: "Merrillville", stateCode: "IN" },
    { id: 4728, name: "Onomea Federal Credit Union", city: "Hilo", stateCode: "HI" },
    { id: 5233, name: "Lakehurst Naval Federal Credit Union", city: "Lakehurst", stateCode: "NJ" },
    { id: 5733, name: "East Alabama Community Federal Credit Union", city: "Opelika", stateCode: "AL" },
    { id: 5804, name: "Palace City Federal Credit Union", city: "Mitchell", stateCode: "SD" },
    { id: 6045, name: "Meridian Mississippi ANG Federal Credit Union", city: "Meridian", stateCode: "MS" },
  ];
  const horizons: OwnerBank = { id: 8416, name: "Horizons North Credit Union", city: "Northglenn", stateCode: "CO" };
  const fiveStar: OwnerBank = { id: 2092, name: "5Star Bank", city: "Colorado Springs", stateCode: "CO" };
  const directory = buildNameDirectory([healthplus, ...members, horizons, fiveStar, ukfcu, bluegrass]);
  const HEALTHPLUS_TEXT = "HEALTHPLUS | Fee Schedule\nEffective January 1, 2026\nNSF / Returned item $30.00\nFederally insured by NCUA";
  const HNCU_TEXT = "Horizons North Credit Union Fee Schedule\nOverdraft $30\nThank you for being a member.";
  const scan = (text: string, own: OwnerBank) =>
    institutionsNamedIn(text, directory).filter((id) => id !== own.id).map((id) => directory.banks.get(id)!);

  it("the Healthplus header fires on every member domain, linked by text hash or found by name", () => {
    for (const own of members) {
      expect(documentOwnerVerdict(HEALTHPLUS_TEXT, own, [healthplus])).toMatchObject({ kind: "other_bank", otherId: 5009 });
      expect(documentOwnerVerdict(HEALTHPLUS_TEXT, own, [], scan(HEALTHPLUS_TEXT, own))).toMatchObject({ kind: "other_bank", otherId: 5009 });
    }
  });

  it("but not on Healthplus itself", () => {
    expect(documentOwnerVerdict(HEALTHPLUS_TEXT, healthplus, members.slice(0, 3), scan(HEALTHPLUS_TEXT, healthplus))).toEqual({
      kind: "own_named", evidence: "name: healthplus",
    });
  });

  it("Horizons North CU's schedule on 5Star Bank's kcms-doc path, found by name in the registry", () => {
    expect(isVendorDocumentPath("https://5star.bank/_/kcms-doc/1264/97709/WEB_HNCU_Fee_Schedule_.pdf")).toBe(true);
    expect(isVendorDocumentPath("https://bluegrasscfcu.org/ezs3download/download/286194/1458976/")).toBe(true);
    expect(isVendorDocumentPath("https://5star.bank/fees.pdf")).toBe(false);
    expect(documentOwnerVerdict(HNCU_TEXT, fiveStar, [], scan(HNCU_TEXT, fiveStar))).toMatchObject({ kind: "other_bank", otherId: 8416 });
  });

  it("a vendor path alone is no proof: a text that names no one stays", () => {
    const text = "Fee Schedule\nOverdraft $30\nMember FDIC. Equal Housing Lender.";
    expect(scan(text, fiveStar)).toEqual([]);
    expect(documentOwnerVerdict(text, fiveStar, [], scan(text, fiveStar))).toEqual({ kind: "unproven" });
  });

  it("the registry scan reads whole words and brand stems, never boilerplate", () => {
    expect(ownerNameForms("Healthplus Federal Credit Union")).toContain("healthplus");
    expect(ownerNameForms("Members Credit Union")).toEqual(["members credit union"]);
    expect(institutionsNamedIn("healthplusone savings", directory)).toEqual([]);
    expect(institutionsNamedIn("Member FDIC. Federally insured by NCUA. Equal Housing Lender.", directory)).toEqual([]);
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
    for (const verdict of ["own_named", "sibling_shared", "other_bank", "shared_service", "unproven", "no_text"]) {
      expect(text).toContain(`'${verdict}'`);
    }
    expect(text).toContain("('SD', 'south dakota')");
    expect(documentOwnerCountSql({ detail: true })).toContain("named_other_name");
  });

  it("reads each pair once per version and mode", () => {
    expect(documentOwnerFingerprint(5756, 17191, false)).toBe("owner-shadow:5756:17191");
    expect(documentOwnerFingerprint(5756, 17191, true)).toBe("owner:5756:17191");
    expect(documentOwnerPairsSql()).toContain("pa.input_fingerprint = $1 || s.institution_id::text");
  });
});

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

function createDb(pairs?: unknown[]) {
  const query = vi.fn((strings: TemplateStringsArray) => {
    const text = templateText(strings);
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
      ]);
    }
    return Promise.resolve([]);
  });
  const db = query as unknown as ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
  db.unsafe = vi.fn(() => Promise.resolve(pairs ?? [
    { institution_id: 5756, source_document_id: 17191, document_url: "https://ukcreditunion.org/Schedule-of-Fees-2026-03.pdf", live_fees: 2, other_ids: [6729] },
    { institution_id: 6729, source_document_id: 17191, document_url: "https://ukcreditunion.org/Schedule-of-Fees-2026-03.pdf", live_fees: 23, other_ids: [5756] },
    { institution_id: 1319, source_document_id: 900, document_url: "https://ibc.com/fees.pdf", live_fees: 30, other_ids: [160] },
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
    expect(calls).toContain("owner-shadow:5756:17191");
    expect(calls).toContain("darwin.document_owner_shadow");
  });

  it("reads nothing more when no pair is shared", async () => {
    const db = createDb([]);
    const result = await recheckDocumentOwners(db, { runId: 77 });
    expect(result.pairs).toBe(0);
    expect(db.mock.calls).toHaveLength(0);
  });
});
