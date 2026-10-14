import { describe, expect, it, vi } from "vitest";

import { loadSharedNameIds, otherInstitutionAtHost, textNamesBank, unconfirmedDocumentHost, urlHost } from "./other-bank-host";

describe("other bank host", () => {
  it("reads an address's host without www", () => {
    expect(urlHost("https://www.peoplesbank-wa.com/wp-content/uploads/2024/11/Personal-Fee-Schedule.pdf")).toBe("peoplesbank-wa.com");
    expect(urlHost("peoples-ebank.com")).toBe("peoples-ebank.com");
    expect(urlHost("mailto:hello@bank.test")).toBeNull();
    expect(urlHost(null)).toBeNull();
  });

  it("names the institution whose own website holds the link (Peoples Bank WA for Peoples Bank IA)", async () => {
    const db = vi.fn(() => Promise.resolve([{ id: 505, institution_name: "Peoples Bank", state_code: "WA" }]));
    const other = await otherInstitutionAtHost(db as never, 915, "https://www.peoplesbank-wa.com/Personal-Fee-Schedule.pdf");
    expect(other).toEqual({ institutionId: 505, institutionName: "Peoples Bank", stateCode: "WA", host: "peoplesbank-wa.com" });
    expect((db.mock.calls[0] as unknown[]).slice(1)).toEqual([915, "peoplesbank-wa.com", 915, "peoplesbank-wa.com"]);
  });

  it("finds none for an address that is no web address", async () => {
    const db = vi.fn();
    expect(await otherInstitutionAtHost(db as never, 915, "not a url ::")).toBeNull();
    expect(db).not.toHaveBeenCalled();
  });
});

describe("documents on a host that is not the bank's (#1033)", () => {
  const schedule = "Schedule of Fees\nOverdraft fee $30.00\nStop payment $25.00";
  const check = (url: string, websiteUrl: string, text: string | null = schedule, institutionName: string | null = null) =>
    unconfirmedDocumentHost({ url, websiteUrl, institutionName, text });

  it("refuses another host's schedule that does not name the bank (USF FCU, N Y Team FCU, Oct 2026)", () => {
    expect(check("https://www.usfcu.com/schedule-of-fees", "http://www.usffcu.com")).toContain("usfcu.com");
    expect(check("https://teamfcu.org/saving/schedule-of-fees/", "http://www.nyteamfcu.org", schedule, "N Y Team FCU")).toContain("teamfcu.org");
    expect(check("https://www.ncwb.uscourts.gov/sites/ncwb/files/Fee_Schedule_12_01_20.pdf", "https://www.r.bank", null)).not.toBeNull();
  });

  it("keeps the bank's own site, its subdomains, shared file hosts and same-name hosts", () => {
    expect(check("https://www.bank.example/fees", "https://bank.example")).toBeNull();
    expect(check("https://docs.bank.example/fees.pdf", "https://www.bank.example")).toBeNull();
    expect(check("https://cdn.zephyrcms.com/x/fee-schedule.pdf", "https://bank.example")).toBeNull();
    expect(check("https://healthplusfcu.com/fees", "https://healthplusfcu.org")).toBeNull();
  });

  it("keeps a document on a new host that names the bank's website or name", () => {
    expect(check("https://newbrand.example/fees", "https://oldbank.example", "Oldbank.example customers: Schedule of Fees")).toBeNull();
    expect(check("https://newbrand.example/fees", "https://ofb.example", "First Valley Savings Bank, N.A. fee schedule", "First Valley Savings Bank, N.A.")).toBeNull();
    expect(textNamesBank("members of Rivertown Credit Union", { websiteHost: "rtfcu.example", institutionName: "Rivertown Federal Credit Union" })).toBe(true);
  });

  // #1287: whole words, a shared name needs the city or number, short same-name hosts are read.
  it.each([
    ["a name inside another name", "https://first.bank/fees", "https://tbank.com", "First Bank fee schedule", { institutionName: "T Bank, N.A." }, false],
    ["a shared name alone (Peoples Bank WA for Peoples Bank IA)", "https://peoplesbank-wa.com/fees.pdf", "https://peoples-ebank.com", "Peoples Bank, Bellingham. Fees", { institutionName: "Peoples Bank", nameShared: true, city: "Rock Valley" }, false],
    ["a shared name with the city", "https://monument.bank/fees", "https://fnbheavener.com", "First National Bank, Heavener: fees", { institutionName: "First National Bank", nameShared: true, city: "Heavener" }, true],
    ["a shared name with the certificate number", "https://monument.bank/fees", "https://fnbheavener.com", "First National Bank (FDIC #4567) fees", { institutionName: "First National Bank", nameShared: true, certNumber: "4567" }, true],
    ["a short same-name host that does not name the bank", "https://fnb.bank/fees", "https://fnb.com", schedule, { institutionName: "First National Bank" }, false],
    ["a short same-name host that names the website", "https://sfnb.bank/fees", "https://sfnb.com", "SFNB fee schedule", {}, true],
  ])("%s", (_case, url, websiteUrl, text, bank, kept) => {
    expect(unconfirmedDocumentHost({ url, websiteUrl, text, ...bank }) == null).toBe(kept);
  });

  // #1309: the certificate number counts only after "FDIC", "Cert", "Certificate", "Charter" or "NCUA".
  it.each([
    ["FDIC Certificate #175", "175", true],
    ["Cert. No. 175", "175", true],
    ["NCUA Charter Number: 24051", "24051", true],
    ["FDIC-insured. FDIC cert 0175", "175", true],
    ["Stop payment $175.00", "175", false],
    ["Wire fee 175.00", "175", false],
    ["Call (712) 175-2400", "175", false],
    ["Rock Valley, IA 51247", "51247", false],
    ["Certificate of deposit 175 days", "175", false],
    ["FDIC Cert #1750", "175", false],
  ])("cert number in %j (cert %s): %s", (text, certNumber, found) => {
    expect(textNamesBank(`Peoples Bank. ${text}`, { websiteHost: "peoples-ebank.com", institutionName: "Peoples Bank", nameShared: true, certNumber })).toBe(found);
  });

  it("marks the banks whose name another institution has, or holds inside its own name", async () => {
    const rows = [
      { id: 1, institution_name: "Peoples Bank" },
      { id: 2, institution_name: "Peoples Bank, N.A." },
      { id: 3, institution_name: "Machias Savings Bank" },
      { id: 4, institution_name: "American National Bank" },
      { id: 5, institution_name: "First American National Bank" },
      { id: 6, institution_name: "Liberty Bay Federal Credit Union" },
      { id: 7, institution_name: "Bay Federal Credit Union" },
      { id: 8, institution_name: "Rivertown Federal Credit Union" },
      { id: 9, institution_name: "Rivertown Credit Union of Ohio" },
      { id: 10, institution_name: "Main Bank" },
      { id: 11, institution_name: "Mainstreet Bank" },
    ];
    const db = vi.fn(() => Promise.resolve(rows));
    const shared = await loadSharedNameIds(db as never, rows.filter((row) => [1, 3, 4, 5, 7, 8, 10].includes(row.id)));
    // "Main Bank" is no whole-word part of "Mainstreet Bank"; "First American National Bank" is in no other name.
    expect([...shared]).toEqual([1, 4, 7, 8]);
  });

  it("treats every bank as shared when the names cannot be read, and says so on the run", async () => {
    const db = vi.fn((strings: TemplateStringsArray) =>
      strings.join(" ").includes("shared-name check") ? Promise.reject(new Error("statement timeout")) : Promise.resolve([]),
    );
    const shared = await loadSharedNameIds(db as never, [{ id: 1, institution_name: "Machias Savings Bank" }, { id: 2, institution_name: "Peoples Bank" }], { runId: 12, stepId: 34 });
    expect([...shared]).toEqual([1, 2]);
    const event = db.mock.calls.find((call) => call[0].join(" ").includes("INSERT INTO agent_run_events"));
    expect(event?.slice(1, 3)).toEqual([12, 34]);
  });

  it("does nothing without the bank's website", () => {
    expect(unconfirmedDocumentHost({ url: "https://other.example/fees", websiteUrl: null, text: schedule })).toBeNull();
  });
});
