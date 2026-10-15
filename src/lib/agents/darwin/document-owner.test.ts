import { describe, expect, it, vi } from "vitest";

import {
  buildNameDirectory,
  DARWIN_DOCUMENT_OWNER_TAKEDOWN,
  documentOwnerCountSql,
  documentOwnerFingerprint,
  documentOwnerPairsSql,
  documentOwnerVerdict,
  headerNamesInstitution,
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

  it("the Healthplus header fires on every member domain linked to Healthplus by text hash", () => {
    for (const own of members) {
      expect(documentOwnerVerdict(HEALTHPLUS_TEXT, own, [healthplus], scan(HEALTHPLUS_TEXT, own))).toMatchObject({ kind: "other_bank", otherId: 5009 });
    }
  });

  it("without the text-hash link, the brand alone is only for review (the header rule needs the legal name)", () => {
    expect(documentOwnerVerdict(HEALTHPLUS_TEXT, members[0], [], scan(HEALTHPLUS_TEXT, members[0]))).toEqual({
      kind: "registry_named", otherIds: [5009],
    });
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
    // Registry-only: its legal name opens the document as a title, so the header rule decides.
    expect(documentOwnerVerdict(HNCU_TEXT, fiveStar, [], scan(HNCU_TEXT, fiveStar))).toEqual({
      kind: "other_bank", otherId: 8416, evidence: "header: horizons north credit union",
    });
    // The same name lower down or in lower case is only for review.
    for (const text of [
      "Fee Schedule\nOverdraft $30\nWire fee $25\nStop payment $30\nATM fee $2\nCashier check $10\nMoney order $5\nCoin $1\nPaper statement $3\nDormant $5\nHorizons North Credit Union members pay no fee",
      "horizons north credit union fee schedule\nOverdraft $30",
    ]) {
      expect(documentOwnerVerdict(text, fiveStar, [], scan(text, fiveStar))).toMatchObject({ kind: "registry_named" });
    }
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
  });

  it("records an empty read with its watermark, and the next step skips while nothing is new", async () => {
    const empty = createDb([]);
    const first = await recheckDocumentOwners(empty, { runId: 77 });
    expect(first).toMatchObject({ pairs: 0, skipped: false });
    const event = JSON.stringify(empty.mock.calls.find((call) => templateText(call[0]).includes("INSERT INTO agent_run_events")));
    expect(event).toContain('\\"max_text_id\\":10');
    expect(templateText(empty.mock.calls.map((call) => call[0]))).not.toContain("INSERT INTO pipeline_attempts");

    const next = createDb([], { pairs: 0, max_text_id: 10, max_fee_id: 20 });
    expect(await recheckDocumentOwners(next, { runId: 78 })).toMatchObject({ skipped: true, pairs: 0 });
    expect(next.unsafe).not.toHaveBeenCalled();

    const moved = createDb([], { pairs: 0, max_text_id: 9, max_fee_id: 20 });
    expect(await recheckDocumentOwners(moved, { runId: 79 })).toMatchObject({ skipped: false });
    expect(moved.unsafe).toHaveBeenCalled();
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
