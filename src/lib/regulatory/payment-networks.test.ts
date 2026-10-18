import { describe, expect, it, vi } from "vitest";

import {
  checkInterchangeFigures,
  checkMembershipList,
  checkOsmLocations,
  createMembershipMatcher,
  dedupeListed,
  extractTables,
  fetchPublicPage,
  linkOsmLocation,
  normalizeListedName,
  osmPartitionKeys,
  overpassQuery,
  parseFigure,
  parseOsmPartition,
  readInterchangeTables,
  readMembershipCsv,
  readMembershipHtml,
  readOverpass,
  recogniseColumns,
  regIiListLinks,
  splitTrailingState,
  stateCode,
  statedDateIso,
  statedListDate,
} from "./payment-networks";

describe("normalizeListedName", () => {
  it("folds case, punctuation, a leading The, legal suffixes and FCU", () => {
    expect(normalizeListedName("The First National Bank of Elk City, N.A.")).toBe("first national bank of elk city");
    expect(normalizeListedName("Navy FCU")).toBe("navy federal credit union");
    expect(normalizeListedName("Bank & Trust Co., Inc.")).toBe("bank and trust");
    expect(normalizeListedName("Acme Bank d/b/a Acme Direct")).toBe("acme bank");
  });
});

describe("stateCode", () => {
  it("reads codes and full names, and returns null for anything else", () => {
    expect(stateCode("tx")).toBe("TX");
    expect(stateCode("New York")).toBe("NY");
    expect(stateCode("Ontario")).toBeNull();
    expect(stateCode("")).toBeNull();
  });
});

describe("readMembershipHtml", () => {
  it("reads the largest table with a name column and reports unrecognised headings", () => {
    const html = `<table><tr><th>Nav</th></tr><tr><td>x</td></tr></table>
      <table><caption>Participants</caption>
        <tr><th>Institution Name</th><th>City</th><th>State</th><th>Service</th></tr>
        <tr><td>First Bank &amp; Trust</td><td>Austin</td><td>TX</td><td>Receive</td></tr>
        <tr><td>Elm CU</td><td></td><td>Narnia</td><td>Send</td></tr>
        <tr><td></td><td>Nowhere</td><td>OH</td><td>Send</td></tr>
      </table>`;
    const read = readMembershipHtml("reg-ii-exempt", html);
    expect(read.shape).toBe("table");
    expect(read.rows).toHaveLength(2);
    expect(read.rows[0]).toMatchObject({ listedName: "First Bank & Trust", city: "Austin", state: "TX" });
    expect(read.rows[1]).toMatchObject({ city: null, state: null, normalizedName: "elm credit union" });
    expect(read.blankNames).toBe(1);
    expect(read.unknownStates).toEqual([{ name: "Elm CU", state: "Narnia" }]);
    expect(read.unrecognisedHeaders).toEqual(["Service"]);
    expect(read.missingRoles).toEqual(["rssd", "cert", "ncua_charter"]);
  });

  it("reads A-Z lists of names and sets menus aside", () => {
    const html = `<ul><li>Home</li><li>About</li><li>Contact</li></ul>
      <h2>A</h2><ul><li>Ally Bank</li><li>Alpine Credit Union</li><li>Amex</li></ul>
      <h2>B</h2><ul><li><a href="#">Bank of Somewhere, N.A.</a></li></ul>`;
    const read = readMembershipHtml("reg-ii-exempt", html);
    expect(read.shape).toBe("lists");
    expect(read.rows.map((r) => r.listedName)).toEqual(["Ally Bank", "Alpine Credit Union", "Amex", "Bank of Somewhere, N.A."]);
    expect(read.skippedLists).toBe(1);
  });

  it("finds nothing in a page that builds its list with script", () => {
    const read = readMembershipHtml("reg-ii-exempt", `<div id="root"></div><script>render([{"name":"Ally Bank"}])</script>`);
    expect(read.shape).toBe("none");
    expect(read.rows).toHaveLength(0);
  });
});

describe("readMembershipCsv", () => {
  it("reads RSSD and cert columns by heading", () => {
    const read = readMembershipCsv("reg-ii-not-exempt", '﻿Institution Name,RSSD ID,City,State\n"Big Bank, N.A.",1234,Charlotte,NC\n');
    expect(read.rows[0]).toMatchObject({ listedName: "Big Bank, N.A.", rssd: "1234", state: "NC", normalizedName: "big bank" });
  });
});

describe("recogniseColumns", () => {
  it("assigns each role once by heading", () => {
    expect(recogniseColumns(["Bank Name", "FDIC Cert", "RSSD", "State", "Notes"]).roles).toEqual({ name: 0, cert: 1, rssd: 2, state: 3 });
  });
});

describe("regIiListLinks", () => {
  const html = `<a href="/files/notexempt-2026.csv">Not Exempt institutions as of June 30, 2026 (CSV)</a>
    <a href="/files/notexempt-2026.pdf">Not Exempt institutions (PDF)</a>
    <a href="/files/exempt.csv">Exempt institutions</a>`;
  const page = "https://www.federalreserve.gov/paymentsystems/regii-about.htm";

  it("separates the Not Exempt list from the Exempt list", () => {
    const notExempt = regIiListLinks(html, page, "not-exempt");
    expect(notExempt.map((l) => l.format)).toEqual(["csv", "pdf"]);
    expect(notExempt[0].href).toBe("https://www.federalreserve.gov/files/notexempt-2026.csv");
    expect(regIiListLinks(html, page, "exempt").map((l) => l.href)).toEqual(["https://www.federalreserve.gov/files/exempt.csv"]);
  });

  it("turns the stated as-of date into an ISO date", () => {
    expect(statedDateIso(statedListDate(regIiListLinks(html, page, "not-exempt")[0].text))).toBe("2026-06-30");
    expect(statedDateIso("2/30/2026")).toBeNull();
    expect(statedDateIso("6/30/2026")).toBe("2026-06-30");
  });
});

describe("splitTrailingState", () => {
  it("reads a state written after the name", () => {
    expect(splitTrailingState("Elm Bank (TX)")).toEqual({ name: "Elm Bank", state: "TX" });
    expect(splitTrailingState("Elm Bank - OH")).toEqual({ name: "Elm Bank", state: "OH" });
    expect(splitTrailingState("Bank of Somewhere, NA")).toEqual({ name: "Bank of Somewhere, NA", state: null });
  });

  it("gives RTP list rows their states", () => {
    const read = readMembershipHtml("reg-ii-exempt", "<ul><li>Elm Bank (TX)</li><li>Oak Credit Union (OH)</li></ul>");
    expect(read.rows.map((r) => r.state)).toEqual(["TX", "OH"]);
    expect(read.missingRoles).not.toContain("state");
  });
});

describe("OpenStreetMap", () => {
  it("builds one state's Overpass query and partition keys", () => {
    expect(overpassQuery("TX")).toContain('area["ISO3166-2"="US-TX"]');
    expect(parseOsmPartition("osm-TX")).toBe("TX");
    expect(parseOsmPartition("osm-ZZ")).toBeNull();
    expect(osmPartitionKeys()).toContain("osm-DC");
  });

  it("reads ATMs and banks, keeps tags, and reports gaps", () => {
    const read = readOverpass({
      elements: [
        { type: "node", id: 1, lat: 30, lon: -97, tags: { amenity: "atm", operator: "Elm Bank", network: "Allpoint" } },
        { type: "way", id: 2, center: { lat: 31, lon: -96 }, tags: { amenity: "bank", brand: "Navy Federal Credit Union", "addr:state": "TX" } },
        { type: "node", id: 1, lat: 30, lon: -97, tags: { amenity: "atm" } },
        { type: "node", id: 3, tags: { amenity: "atm" } },
        { type: "node", id: 4, lat: 1, lon: 1, tags: { amenity: "cafe" } },
        { id: 5 },
      ],
    });
    expect(read).toMatchObject({ valid: true, elements: 6, duplicates: 1, missingCoordinates: 1, otherAmenity: 1, malformed: 1 });
    expect(read.locations[1]).toMatchObject({ kind: "bank", lat: 31, lon: -96, addrState: "TX" });

    const match = createMembershipMatcher([
      { id: 7, name: "Elm Bank", state: "TX", rssd: null, cert: "1", ncuaCharter: null, source: "fdic" },
      { id: 8, name: "Navy Federal Credit Union", state: "VA", rssd: null, cert: "5536", ncuaCharter: null, source: "ncua" },
    ]);
    const links = read.locations.map((l) => linkOsmLocation(match, l, "TX"));
    expect(links.slice(0, 2)).toEqual([
      { institutionId: 7, method: "name_state", field: "operator" },
      { institutionId: 8, method: "name_only_unique", field: "brand" },
    ]);
    const checks = checkOsmLocations(read, links, "TX");
    expect(checks).toMatchObject({ atms: 2, banks: 1, linked: 2, network_tags: { Allpoint: 1 }, without_operator_or_brand: 1 });
  });

  it("marks a response without elements as invalid", () => {
    expect(readOverpass({ remark: "runtime error: Query timed out" })).toMatchObject({ valid: false, remark: "runtime error: Query timed out" });
  });
});

describe("matching", () => {
  const universe = [
    { id: 1, name: "First National Bank", state: "TX", rssd: "111", cert: "10", ncuaCharter: null, source: "fdic" },
    { id: 2, name: "First National Bank", state: "OK", rssd: "222", cert: "20", ncuaCharter: null, source: "fdic" },
    { id: 3, name: "Navy Federal Credit Union", state: "VA", rssd: null, cert: "5536", ncuaCharter: "5536", source: "ncua" },
  ];
  const match = createMembershipMatcher(universe);
  const html = (rows: string) => `<table><tr><th>Name</th><th>State</th></tr>${rows}</table>`;

  it("matches by name and state, never by name alone when a state is given", () => {
    const read = readMembershipHtml("reg-ii-exempt", html("<tr><td>First National Bank</td><td>OK</td></tr><tr><td>First National Bank</td><td>KS</td></tr>"));
    expect(read.rows.map(match)).toEqual([
      { institutionId: 2, method: "name_state", unmatchedReason: null },
      { institutionId: null, method: null, unmatchedReason: "no_match" },
    ]);
  });

  it("matches a stateless name only when one institution carries it", () => {
    const read = readMembershipHtml("reg-ii-exempt", "<ul><li>Navy FCU</li><li>First National Bank</li></ul>");
    expect(read.rows.map(match)).toEqual([
      { institutionId: 3, method: "name_only_unique", unmatchedReason: null },
      { institutionId: null, method: null, unmatchedReason: "ambiguous" },
    ]);
  });

  it("matches by RSSD first", () => {
    const read = readMembershipCsv("reg-ii-not-exempt", "Name,RSSD\nSomething Else,111\n");
    expect(match(read.rows[0])).toMatchObject({ institutionId: 1, method: "rssd" });
  });

  it("reports unmatched, ambiguous, duplicates and a big count change", () => {
    const read = readMembershipHtml("reg-ii-exempt", "<ul><li>Navy FCU</li><li>First National Bank</li><li>Navy FCU</li></ul>");
    const { rows, duplicates } = dedupeListed([...read.rows, read.rows[0]]);
    const checks = checkMembershipList({ ...read, rows }, rows.map(match), duplicates, 10);
    expect(checks).toMatchObject({ rows: 2, duplicate_rows: 1, matched: 1, unmatched: 1, ambiguous: 1, previous_rows: 10, count_change_flag: true });
  });
});

describe("interchange tables", () => {
  it("parses dollar, cent and percent cells and leaves text as null", () => {
    expect(parseFigure("$0.24")).toEqual({ value: 0.24, unit: "dollars" });
    expect(parseFigure("1,234.5")).toEqual({ value: 1234.5, unit: null });
    expect(parseFigure("45%")).toEqual({ value: 45, unit: "percent" });
    expect(parseFigure("(2.0)")).toEqual({ value: -2, unit: null });
    expect(parseFigure("n/a")).toEqual({ value: null, unit: null });
  });

  it("reads every body cell with its row and column labels and year", () => {
    const html = `<table><caption>Average interchange fee per transaction</caption>
      <tr><th>Network</th><th>2021</th><th>2023</th></tr>
      <tr><td>Covered, single-message</td><td>$0.23</td><td>$0.22</td></tr>
      <tr><td>Exempt, dual-message</td><td>$0.51</td><td>*</td></tr></table>`;
    const read = readInterchangeTables(html);
    expect(read.tables).toBe(1);
    expect(read.figures).toHaveLength(4);
    expect(read.figures[0]).toMatchObject({ rowLabel: "Covered, single-message", columnLabel: "2021", value: 0.23, unit: "dollars", surveyYear: 2021 });
    const checks = checkInterchangeFigures([...read.figures, { ...read.figures[0], valueText: "$9.00", value: 9, rowLabel: "Odd" }]);
    expect(checks).toMatchObject({ cells: 5, non_numeric: 1, dollar_outliers: 1, negatives: 0 });
  });

  it("extracts tables with entities and line breaks", () => {
    const [t] = extractTables("<table><tr><th>A&nbsp;B</th><th>C<br>D</th></tr><tr><td>1</td></tr></table>");
    expect(t.headers).toEqual(["A B", "C D"]);
    expect(t.ragged).toBe(1);
  });
});

describe("statedListDate", () => {
  it("reads the date a page gives for its list", () => {
    expect(statedListDate("<p>List updated March 3, 2026.</p>")).toBe("March 3, 2026");
    expect(statedListDate("<p>No date here</p>")).toBeNull();
  });
});

describe("fetchPublicPage", () => {
  it("does not fetch a page robots.txt disallows for our crawler", async () => {
    const fetchImpl = vi.fn(async () => new Response("User-agent: *\nDisallow: /private\n", { status: 200 })) as unknown as typeof fetch;
    const page = await fetchPublicPage("https://example.com/private/list", { fetchImpl, backoffMs: 0 });
    expect(page.status).toBe("robots_disallowed");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fetches when robots.txt is missing, and reports a missing page", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    const page = await fetchPublicPage("https://example.com/list", { fetchImpl, backoffMs: 0 });
    expect(page.status).toBe("not_found");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
