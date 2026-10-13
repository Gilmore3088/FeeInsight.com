import { describe, expect, it, vi } from "vitest";

import { otherInstitutionAtHost, textNamesBank, unconfirmedDocumentHost, urlHost } from "./other-bank-host";

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

  it("does nothing without the bank's website", () => {
    expect(unconfirmedDocumentHost({ url: "https://other.example/fees", websiteUrl: null, text: schedule })).toBeNull();
  });
});
