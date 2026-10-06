import { describe, expect, it } from "vitest";

import { repairIsWorthSaving, repairWebsiteUrl } from "./website-repair";

describe("repairWebsiteUrl", () => {
  it("leaves a well-formed address alone", () => {
    expect(repairWebsiteUrl("https://www.firstbank.com")).toMatchObject({ status: "ok", url: "https://www.firstbank.com", changes: [] });
    expect(repairWebsiteUrl("https://www.firstbank.com/")).toMatchObject({ status: "ok", url: "https://www.firstbank.com" });
    expect(repairWebsiteUrl("https://bank.example.com/personal?x=1")).toMatchObject({ status: "ok", url: "https://bank.example.com/personal?x=1" });
    expect(repairWebsiteUrl("https://www2.bank.com")).toMatchObject({ status: "ok", url: "https://www2.bank.com" });
    expect(repairWebsiteUrl("https://www-bank.com")).toMatchObject({ status: "ok", url: "https://www-bank.com" });
  });

  it("reports empty values as empty", () => {
    expect(repairWebsiteUrl(null).status).toBe("empty");
    expect(repairWebsiteUrl("   ").status).toBe("empty");
  });

  it("adds a missing scheme without treating it as worth saving", () => {
    const repair = repairWebsiteUrl("www.firstbank.com");
    expect(repair).toMatchObject({ status: "repaired", url: "https://www.firstbank.com", changes: ["added_scheme"] });
    expect(repairIsWorthSaving(repair)).toBe(false);
  });

  it("adds the dot missing after www", () => {
    const repair = repairWebsiteUrl("wwwfirstbank.com");
    expect(repair).toMatchObject({ status: "repaired", url: "https://www.firstbank.com" });
    expect(repair.changes).toContain("added_dot_after_www");
    expect(repairIsWorthSaving(repair)).toBe(true);
    expect(repairWebsiteUrl("http://wwwfirstbank.com/").url).toBe("http://www.firstbank.com");
  });

  it("adds the dot missing before the domain ending", () => {
    expect(repairWebsiteUrl("www.firstbankcom")).toMatchObject({ status: "repaired", url: "https://www.firstbank.com" });
    expect(repairWebsiteUrl("https://www.unitedcunet")).toMatchObject({ url: "https://www.unitedcu.net" });
    expect(repairWebsiteUrl("wwwfirstbankcom")).toMatchObject({ url: "https://www.firstbank.com" });
  });

  it("fixes scheme typos, uppercase, whitespace and trailing junk", () => {
    expect(repairWebsiteUrl("HTTP://WWW.FirstBank.COM")).toMatchObject({ url: "http://www.firstbank.com" });
    expect(repairWebsiteUrl("https//www.firstbank.com")).toMatchObject({ url: "https://www.firstbank.com" });
    expect(repairWebsiteUrl("http:/firstbank.com")).toMatchObject({ url: "http://firstbank.com" });
    expect(repairWebsiteUrl("htps://firstbank.com")).toMatchObject({ url: "https://firstbank.com" });
    expect(repairWebsiteUrl("  www.firstbank . com  ")).toMatchObject({ url: "https://www.firstbank.com" });
    expect(repairWebsiteUrl("www.firstbank com")).toMatchObject({ url: "https://www.firstbank.com" });
    expect(repairWebsiteUrl("www.firstbank.com.")).toMatchObject({ url: "https://www.firstbank.com" });
    expect(repairWebsiteUrl("<www.firstbank.com>;")).toMatchObject({ url: "https://www.firstbank.com" });
    expect(repairWebsiteUrl("www.firstbank.com (main office)")).toMatchObject({ url: "https://www.firstbank.com" });
    expect(repairWebsiteUrl("www,firstbank,com")).toMatchObject({ url: "https://www.firstbank.com" });
    expect(repairWebsiteUrl("www.firstbank..com")).toMatchObject({ url: "https://www.firstbank.com" });
    expect(repairWebsiteUrl("https://www.FirstBank.com/Personal/Fees")).toMatchObject({ url: "https://www.firstbank.com/Personal/Fees" });
  });

  it("fixes misspelled domain endings with one obvious meaning", () => {
    const repair = repairWebsiteUrl("www.firstbank.con");
    expect(repair).toMatchObject({ status: "repaired", url: "https://www.firstbank.com" });
    expect(repair.changes).toContain("fixed_tld_con");
    expect(repairWebsiteUrl("firstbank.ocm").url).toBe("https://firstbank.com");
    expect(repairWebsiteUrl("firstcu.ogr").url).toBe("https://firstcu.org");
  });

  it("flags, but keeps, an unfamiliar domain ending", () => {
    const repair = repairWebsiteUrl("https://www.firstbank.holdings");
    expect(repair).toMatchObject({ status: "ok", url: "https://www.firstbank.holdings", warnings: ["unfamiliar_tld_holdings"] });
    expect(repairWebsiteUrl("https://www.firstbank.bank").warnings).toEqual([]);
    expect(repairWebsiteUrl("https://firstbank.us").warnings).toEqual([]);
  });

  it("reports an address it cannot read as unparseable instead of guessing", () => {
    expect(repairWebsiteUrl("www")).toMatchObject({ status: "unparseable", url: null });
    expect(repairWebsiteUrl("firstbank")).toMatchObject({ status: "unparseable" });
    expect(repairWebsiteUrl("www.firstbank")).toMatchObject({ status: "unparseable" });
    expect(repairWebsiteUrl("n/a")).toMatchObject({ status: "unparseable" });
    expect(repairWebsiteUrl("mailto:info@firstbank.com")).toMatchObject({ status: "unparseable" });
    expect(repairWebsiteUrl("ftp://firstbank.com")).toMatchObject({ status: "unparseable" });
    expect(repairWebsiteUrl("https://user@firstbank.com")).toMatchObject({ status: "unparseable" });
    expect(repairWebsiteUrl("http://10.0.0.1")).toMatchObject({ status: "unparseable" });
    expect(repairWebsiteUrl("first_bank!.com")).toMatchObject({ status: "unparseable" });
  });

  it("keeps a port", () => {
    expect(repairWebsiteUrl("firstbank.com:8443/home").url).toBe("https://firstbank.com:8443/home");
  });
});
