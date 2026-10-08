import { describe, expect, it, vi } from "vitest";

import { isMarketingStep, isProviderStep } from "@/lib/agents/types";
import {
  belongsToSite,
  checkSite,
  contactPageLinks,
  contactConfidence,
  contactsCsv,
  extractContacts,
  isSharedMailbox,
  normalizeContact,
  rankContacts,
  roleFor,
  runContactFinder,
  summarizeContactFinder,
  type ProspectContactRow,
} from "./contacts";

type Db = NonNullable<Parameters<typeof runContactFinder>[0]["db"]>;

const HOME = `<html><body>
  <nav><a href="/about-us">About Us</a> <a href="/about-us/leadership">Our Leadership</a>
  <a href="/contact">Contact</a> <a href="https://othersite.com/team">Partner team</a>
  <a href="/rates.pdf">Rates</a></nav>
  <footer>Questions? <a href="mailto:info@firstbank.com">info@firstbank.com</a> · vendor: help@fiserv.com</footer>
</body></html>`;

const LEADERSHIP = `<html><body><h1>Leadership</h1>
  <div class="person"><h3>Jane Q. Smith</h3><p>SVP, Director of Marketing</p><p><a href="mailto:jsmith@firstbank.bank?subject=Hi">Email Jane</a></p></div>
  <div class="person"><h3>Robert Lee</h3><p>President &amp; CEO</p><p>rlee&#64;firstbank.com</p></div>
  <div class="person"><h3>Ann Diaz</h3><p>Branch Manager</p></div>
  <img src="logo@2x.png">
</body></html>`;

describe("reading a page", () => {
  it("keeps the institution's own addresses with the name and title printed before them", () => {
    const contacts = extractContacts(LEADERSHIP, "https://www.firstbank.com/about-us/leadership", "firstbank.com");
    expect(contacts).toEqual([
      expect.objectContaining({ email: "jsmith@firstbank.bank", kind: "person", name: "Jane Q. Smith", title: "SVP, Director of Marketing", role: "marketing" }),
      expect.objectContaining({ email: "rlee@firstbank.com", kind: "person", name: "Robert Lee", title: "President & CEO", role: "executive" }),
    ]);
  });

  it("leaves out vendor addresses and files shared mailboxes as general", () => {
    const contacts = extractContacts(HOME, "https://www.firstbank.com/", "firstbank.com");
    expect(contacts).toEqual([expect.objectContaining({ email: "info@firstbank.com", kind: "general", name: null, title: null })]);
  });

  it("never guesses a name or title the page doesn't print", () => {
    const [contact] = extractContacts("<p>Write to kjones@firstbank.com</p>", "https://firstbank.com/", "firstbank.com");
    expect(contact).toMatchObject({ email: "kjones@firstbank.com", kind: "person", name: null, title: null, role: "other" });
  });

  it("matches the bank's own domain, its subdomains and the same name under another ending", () => {
    expect(belongsToSite("a@firstbank.com", "firstbank.com")).toBe(true);
    expect(belongsToSite("a@mail.firstbank.com", "firstbank.com")).toBe(true);
    expect(belongsToSite("a@firstbank.bank", "firstbank.com")).toBe(true);
    expect(belongsToSite("a@gmail.com", "firstbank.com")).toBe(false);
    expect(belongsToSite("a@fiserv.com", "firstbank.com")).toBe(false);
  });

  it("reads the role from the title, marketing first", () => {
    expect(roleFor("SVP Marketing and Retail")).toBe("marketing");
    expect(roleFor("Chief Financial Officer")).toBe("finance");
    expect(roleFor("Deposit Product Manager")).toBe("retail");
    expect(roleFor("President and CEO")).toBe("executive");
    expect(roleFor("Loan Officer")).toBe("other");
  });

  it("doesn't take lenders, branch staff or a vice president's rank for a buyer (prod, Oct 8)", () => {
    expect(roleFor("Vice President, Cash Management")).toBe("other");
    expect(roleFor("Vice President, Senior Business Banker, Indiana Market")).toBe("other");
    expect(roleFor("Retail Lending Coordinator")).toBe("other");
    expect(roleFor("AVP, Branch Manager")).toBe("other");
    expect(roleFor("Senior Vice President, Chief Lending Officer")).toBe("other");
    expect(roleFor("SVP, Chief Retail Officer")).toBe("retail");
    expect(roleFor("VP of Retail & Business Development")).toBe("retail");
    expect(roleFor("President & CEO*")).toBe("executive");
    expect(roleFor("Vice President, Chief Financial Officer & Treasurer")).toBe("finance");
  });

  it("re-reads saved contacts: labels aren't names and headings aren't titles", () => {
    const saved = { kind: "person" as const, role: "executive" as const };
    expect(normalizeContact({ ...saved, name: "Accessibility Statement", title: null })).toMatchObject({ name: null, role: "other" });
    expect(normalizeContact({ ...saved, name: "Commercial Lender", title: "Vice President" })).toMatchObject({ name: null, role: "other" });
    expect(normalizeContact({ ...saved, name: "SEND EMAIL", title: null }).name).toBeNull();
    expect(normalizeContact({ ...saved, name: null, title: "President’s Message March 2026" })).toMatchObject({ title: null, role: "other" });
    expect(normalizeContact({ ...saved, name: "Patrick B. Thorpe", title: "President & CEO*" })).toMatchObject({
      name: "Patrick B. Thorpe",
      title: "President & CEO",
      role: "executive",
    });
  });

  it("drops a name printed beside several addresses", () => {
    const html = "<p>North Pointe</p><p>SVP, Chief Financial Officer</p><p>ecoop@sbw.bank</p><p>North Pointe</p><p>SVP, Chief Risk Officer</p><p>rrice@sbw.bank</p>";
    const contacts = extractContacts(html, "https://www.sbw.bank/about/our-people/", "sbw.bank");
    expect(contacts.map((contact) => contact.name)).toEqual([null, null]);
    expect(contacts[0]).toMatchObject({ title: "SVP, Chief Financial Officer", role: "finance" });
  });

  it("follows same-site leadership pages first, then about, then contact", () => {
    expect(contactPageLinks(HOME, "https://www.firstbank.com/")).toEqual([
      "https://www.firstbank.com/about-us/leadership",
      "https://www.firstbank.com/about-us",
      "https://www.firstbank.com/contact",
    ]);
  });
});

function fakeFetcher(pages: Record<string, { status?: number; body: string }>) {
  const calls: string[] = [];
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    const key = String(url);
    calls.push(key);
    const page = pages[key];
    if (!page) return new Response("missing", { status: 404, headers: { "content-type": "text/html" } });
    return new Response(page.body, { status: page.status ?? 200, headers: { "content-type": key.endsWith(".txt") ? "text/plain" : "text/html" } });
  });
  return { fetcher: fetcher as unknown as typeof fetch, calls };
}

describe("checkSite", () => {
  it("reads the homepage and its leadership page, honoring robots.txt", async () => {
    const { fetcher, calls } = fakeFetcher({
      "https://www.firstbank.com/robots.txt": { body: "User-agent: *\nDisallow: /contact\n" },
      "https://www.firstbank.com/": { body: HOME },
      "https://www.firstbank.com/about-us/leadership": { body: LEADERSHIP },
      "https://www.firstbank.com/about-us": { body: "<p>About</p>" },
    });
    const check = await checkSite({ institutionId: 7, name: "First Bank", websiteUrl: "https://www.firstbank.com/" }, fetcher);
    expect(check.outcome).toBe("found");
    expect(check.contacts.map((contact) => contact.email)).toEqual(["info@firstbank.com", "jsmith@firstbank.bank", "rlee@firstbank.com"]);
    expect(calls).not.toContain("https://www.firstbank.com/contact");
  });

  it("reads nothing when robots.txt shuts our crawler out", async () => {
    const { fetcher, calls } = fakeFetcher({ "https://firstbank.com/robots.txt": { body: "User-agent: FeeInsightBot\nDisallow: /\n" } });
    const check = await checkSite({ institutionId: 7, name: "First Bank", websiteUrl: "firstbank.com" }, fetcher);
    expect(check.outcome).toBe("blocked");
    expect(calls).toEqual(["https://firstbank.com/robots.txt"]);
  });
});

function fakeDb(options: { ready?: boolean } = {}) {
  const writes: string[] = [];
  const db = vi.fn((strings: TemplateStringsArray) => {
    const query = strings.join("?");
    if (query.includes("to_regclass('public.prospect_contacts')")) return Promise.resolve([{ ready: options.ready ?? true }]);
    if (query.includes("FROM live l")) return Promise.resolve([{ id: 7, institution_name: "First Bank", website_url: "https://www.firstbank.com/" }]);
    if (query.includes("INSERT INTO")) writes.push(query);
    return Promise.resolve([]);
  });
  return { db: db as unknown as Db, writes };
}

describe("runContactFinder", () => {
  const pages = {
    "https://www.firstbank.com/robots.txt": { body: "" },
    "https://www.firstbank.com/": { body: HOME },
    "https://www.firstbank.com/about-us/leadership": { body: LEADERSHIP },
  };

  it("saves each address and the check, and counts people apart from shared mailboxes", async () => {
    const { db, writes } = fakeDb();
    const result = await runContactFinder({ db, runId: 9, fetcher: fakeFetcher(pages).fetcher });
    expect(result).toMatchObject({ schemaReady: true, checked: 1, found: 1, people: 2, general: 1, byRole: { marketing: 1, executive: 1 } });
    expect(writes.filter((query) => query.includes("prospect_contacts ("))).toHaveLength(3);
    expect(writes.filter((query) => query.includes("prospect_contact_checks"))).toHaveLength(1);
    expect(summarizeContactFinder(result)).toBe(
      "Read 1 prospect websites: 1 published at least one address; 2 named or personal addresses and 1 shared mailboxes.",
    );
  });

  it("saves nothing on a dry run and reads nothing before the migration", async () => {
    const dry = fakeDb();
    await runContactFinder({ db: dry.db, dryRun: true, fetcher: fakeFetcher(pages).fetcher });
    expect(dry.writes).toEqual([]);
    const before = await runContactFinder({ db: fakeDb({ ready: false }).db, fetcher: fakeFetcher(pages).fetcher });
    expect(before.schemaReady).toBe(false);
  });

  it("is a free marketing step", () => {
    expect(isMarketingStep("growth-contacts")).toBe(true);
    expect(isProviderStep("growth-contacts")).toBe(false);
  });
});

describe("contact confidence", () => {
  const person = { kind: "person" as const, name: "Jane Smith", title: "SVP Marketing", role: "marketing" as const, email: "jsmith@firstbank.com" };

  it("is high only for a named person with a title in a buying role", () => {
    expect(contactConfidence(person)).toBe("high");
    expect(contactConfidence({ ...person, role: "other", title: "Loan Officer" })).toBe("medium");
    expect(contactConfidence({ ...person, name: null, title: null, role: "other" })).toBe("low");
    expect(contactConfidence({ ...person, kind: "general" })).toBe("low");
  });

  it("puts the marketing owner first and a shared mailbox last", () => {
    const ceo = { ...person, name: "Robert Lee", title: "President & CEO", role: "executive" as const, email: "rlee@firstbank.com" };
    const info = { kind: "general" as const, name: null, title: null, role: "other" as const, email: "info@firstbank.com" };
    expect(rankContacts([info, ceo, person]).map((contact) => contact.email)).toEqual([
      "jsmith@firstbank.com",
      "rlee@firstbank.com",
      "info@firstbank.com",
    ]);
  });
});

describe("shared mailboxes and phone lines", () => {
  it("reads committee, service and distribution-list addresses as shared", () => {
    for (const email of ["member_serv@x.org", "treasurysupport@x.com", "web-executive-dl@x.com", "supervisorycommittee@x.org", "e-statements@x.com", "cmadmin@x.bank", "smart_insurance@x.org", "info@x.com"]) {
      expect(isSharedMailbox(email)).toBe(true);
    }
    for (const email of ["kday@sbw.bank", "mark.rieger@ffbkc.com", "cpouliot@hrcu.org", "jadmiral@x.com"]) {
      expect(isSharedMailbox(email)).toBe(false);
    }
  });

  it("drops a phone line printed where a title would be", () => {
    expect(normalizeContact({ name: null, title: "Member Services: 800.742.5582 or", role: "retail", kind: "person" })).toMatchObject({ title: null, role: "other" });
    expect(normalizeContact({ name: null, title: "Main Branch Line: (360) 685-8477", role: "other", kind: "person" }).title).toBeNull();
  });
});

describe("contactsCsv", () => {
  it("quotes commas and defuses spreadsheet formulas", () => {
    const row: ProspectContactRow = {
      institution_id: 7,
      institution_name: "First Bank, N.A.",
      charter_type: "bank",
      state_code: "TX",
      city: "Waco",
      assets_musd: 812,
      email: "jsmith@firstbank.bank",
      kind: "person",
      name: "Jane Smith",
      title: "=HYPERLINK()",
      role: "marketing",
      source_url: "https://firstbank.com/leadership",
      found_at: "2026-10-08T15:30:00.000Z",
    };
    const [header, line] = contactsCsv([row]).trim().split("\n");
    expect(header.startsWith("institution_id,institution_name")).toBe(true);
    expect(line).toContain('"First Bank, N.A."');
    expect(line).toContain("'=HYPERLINK()");
  });
});
