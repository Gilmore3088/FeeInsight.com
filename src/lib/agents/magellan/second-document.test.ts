import { describe, expect, it, vi } from "vitest";

import {
  accountNameFor,
  additionalDocumentRole,
  classifyCompanionLink,
  isGenericAccountName,
  MAX_SEARCH_PAGES_PER_BANK,
  runSecondDocumentFind,
  SECOND_DOCUMENT_FINDER,
  SITE_SEARCH_QUERIES,
  SITE_SEARCH_STRATEGY,
  siteSearchQueries,
  siteSearchUrl,
  siteSearchUrls,
  THIN_BANK_CATEGORY_LIMIT,
} from "./second-document";

type DbMock = ReturnType<typeof vi.fn>;

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

// Shaped like Triangle FCU (MS): live fees from an "Additional Services" page only, while
// each checking account's page lists its own fees and a courtesy pay PDF sits behind an
// opaque /assets/files link.
const thinBank = {
  id: 5829,
  institution_name: "Triangle Federal Credit Union",
  state_code: "MS",
  website_url: "https://www.triangle.example",
  fee_schedule_url: "https://www.triangle.example/resources/account-services/additional-services",
  categories: 4,
};

function createDb(ready = true): DbMock {
  return vi.fn((strings: TemplateStringsArray) => {
    const text = templateText(strings);
    if (text.includes("AS companion_ready")) return Promise.resolve([{ companion_ready: ready }]);
    if (text.includes("FROM published_fee_records")) return Promise.resolve([thinBank]);
    if (text.includes("SELECT document_url AS url")) return Promise.resolve([{ url: thinBank.fee_schedule_url }]);
    return Promise.resolve([]);
  });
}

const asDb = (db: DbMock) => db as unknown as Parameters<typeof runSecondDocumentFind>[0]["db"];

const html = (body: string) => new Response(body, { headers: { "content-type": "text/html" } });
const notFound = () => new Response("missing", { status: 404, headers: { "content-type": "text/html" } });

const HOMEPAGE = `
  <nav>
    <a href="/accounts/personal-checking">Personal Checking</a>
    <a href="/accounts/personal-checking/value-checking">Value Checking</a>
    <a href="/accounts/personal-checking/freedom-checking">Freedom Checking</a>
    <a href="/loans/auto-loans">Auto Loans</a>
    <a href="/business/business-checking">Business Checking</a>
    <a href="/resources/account-services/additional-services">Additional Services</a>
  </nav>
  <form action="/search" method="get" role="search"><input type="search" name="q"><button>Search</button></form>`;
const FREEDOM = `<h1>Freedom Checking</h1><p>No minimum balance</p><p>Monthly service fee $5.00, waived with a $500 balance</p>
  <p>Paper statement fee $2.00 per month</p><a href="/assets/files/IkShrDjx">Courtesy Pay Policy</a>`;
const VALUE = `<h1>Value Checking</h1><p>Dividends paid monthly</p>`;
const SEARCH = `<ul><li><a href="/assets/files/IkShrDjx">Discretionary Courtesy Pay Policy</a></li></ul>`;
const COURTESY_PAY = `<h1>Courtesy Pay</h1><p>NSF fee $25.00 per item</p><p>Overdraft fee $25.00 per item</p><p>Daily overdraft charge $5.00</p>`;

describe("Magellan companion finder", () => {
  it("keeps every account page and fee document that lists fees, tied to its account", async () => {
    const db = createDb();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://www.triangle.example/") return html(HOMEPAGE);
      if (url === thinBank.fee_schedule_url) return html("<p>Incoming wire fee $10.00</p>");
      if (url.startsWith("https://www.triangle.example/search?q=fee+schedule")) return html(SEARCH);
      if (url === "https://www.triangle.example/accounts/personal-checking") return html(`<a href="/accounts/personal-checking/freedom-checking">Freedom Checking</a>`);
      if (url === "https://www.triangle.example/accounts/personal-checking/freedom-checking") return html(FREEDOM);
      if (url === "https://www.triangle.example/accounts/personal-checking/value-checking") return html(VALUE);
      if (url === "https://www.triangle.example/assets/files/IkShrDjx") return html(COURTESY_PAY);
      return notFound();
    });

    const result = await runSecondDocumentFind({ db: asDb(db), fetchImpl, runId: 5, stateCode: "MS", deadline: Date.now() + 60_000, learning: true });

    expect(result).toMatchObject({ status: "ran", checked: 1, found: 2 });
    const pages = result.results[0].pages;
    expect(pages).toEqual([
      expect.objectContaining({ url: "https://www.triangle.example/accounts/personal-checking/freedom-checking", kind: "account_page", role: "account_page", accountName: "Freedom Checking" }),
      expect.objectContaining({ url: "https://www.triangle.example/assets/files/IkShrDjx", kind: "fee_document", accountName: "Discretionary Courtesy Pay Policy" }),
    ]);
    // Value Checking lists no fees; loans and business pages are never opened.
    const opened = fetchImpl.mock.calls.map((call) => String(call[0]));
    expect(opened).toContain("https://www.triangle.example/accounts/personal-checking/value-checking");
    expect(opened.some((url) => url.includes("auto-loans") || url.includes("/business/"))).toBe(false);

    const inserts = db.mock.calls.filter((call) => templateText(call[0]).includes("INSERT INTO institution_additional_sources"));
    expect(inserts).toHaveLength(2);
    expect(inserts[0]).toContain("Freedom Checking");
    const attempts = db.mock.calls.filter((call) => templateText(call[0]).includes("INSERT INTO pipeline_attempts"));
    expect(attempts.filter((call) => call[4] === SECOND_DOCUMENT_FINDER.strategy)).toHaveLength(1);
    // The "fee schedule" search found the courtesy pay policy.
    const feeSearch = attempts.find((call) => call[4] === SITE_SEARCH_STRATEGY.strategy && String(call[6]).includes("q=fee+schedule"));
    expect(feeSearch?.[7]).toBe("ok");
    // The main fee link is never touched.
    expect(db.mock.calls.some((call) => templateText(call[0]).includes("UPDATE institution_sources"))).toBe(false);
    const select = db.mock.calls.find((call) => templateText(call[0]).includes("FROM published_fee_records"));
    expect(select).toContain(THIN_BANK_CATEGORY_LIMIT);
  });

  it("waits for its migration and the attempt log", async () => {
    const fetchImpl = vi.fn();
    expect((await runSecondDocumentFind({ db: asDb(createDb(false)), fetchImpl, runId: 1, deadline: Date.now() + 1000, learning: true })).status).toBe("schema_pending");
    expect((await runSecondDocumentFind({ db: asDb(createDb()), fetchImpl, runId: 1, deadline: Date.now() + 1000, learning: false })).status).toBe("no_attempt_log");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("classifies links into account pages and fee documents", () => {
    const site = new URL("https://bank.example/");
    const link = (url: string, label: string) => classifyCompanionLink({ url, label }, site);
    expect(link("https://bank.example/personal/checking/kasasa-cash", "Kasasa Cash")?.kind).toBe("account_page");
    expect(link("https://bank.example/savings/money-market", "Money Market")?.kind).toBe("account_page");
    expect(link("https://bank.example/files/abc123", "Truth in Savings Disclosure")?.kind).toBe("fee_document");
    expect(link("https://cdn.example/schedule-of-fees.pdf", "Schedule of Fees")?.kind).toBe("fee_document");
    expect(link("https://bank.example/business/checking", "Business Checking")).toBeNull();
    expect(link("https://bank.example/loans/auto", "Auto Loans")).toBeNull();
    expect(link("https://bank.example/about", "About Us")).toBeNull();
    // A HELOC disclosure labelled "Download" is not a deposit fee document.
    expect(link("https://cu.example/documents/heloc-important-terms-disclosures/", "Download")).toBeNull();
    expect(link("https://bank.example/docs/home-equity-line-of-credit-fees.pdf", "Fees")).toBeNull();
    expect(link("https://bank.example/cftc-swap-disclosures/credit-derivatives-disclosure-annex.pdf", "Credit Derivatives Disclosure Annex")).toBeNull();
  });

  it("finds the site's own search form", () => {
    const site = new URL("https://bank.example/");
    expect(siteSearchUrl(`<form action="/search" method="get"><input type="text" name="q"><button>Search</button></form>`, site))
      .toBe("https://bank.example/search?q=fee+schedule");
    expect(siteSearchUrl(`<form role="search" action="https://bank.example/"><input type="search" name="s"></form>`, site))
      .toBe("https://bank.example/?s=fee+schedule");
    expect(siteSearchUrl(`<form action="/login" method="post"><input name="q"></form>`, site)).toBeNull();
    expect(siteSearchUrl(`<form action="https://other.example/search"><input type="search" name="q"></form>`, site)).toBeNull();
  });

  it("names the account from the label, or the path for 'Learn more' links", () => {
    expect(accountNameFor("Freedom Checking", "https://bank.example/freedom-checking")).toBe("Freedom Checking");
    expect(accountNameFor("Learn more", "https://bank.example/accounts/value-checking/")).toBe("Value Checking");
    expect(accountNameFor("Product Details", "https://bank.example/checking/virtual-wallet.html")).toBe("Virtual Wallet");
    expect(accountNameFor("Download", "https://cu.example/documents/consumer-rate-and-fee-schedule/")).toBe("Consumer Rate And Fee Schedule");
    // Opaque file names fall back to the folder that names the account.
    expect(accountNameFor("Features and Fees", "https://bank.example/pdf/personal/Checking/fees-vw-A.pdf")).toBe("Checking");
    expect(isGenericAccountName("See Rates")).toBe(true);
    expect(isGenericAccountName("Freedom Checking")).toBe(false);
  });

  it("names the document's role from its label", () => {
    expect(additionalDocumentRole("Commercial Account Fees")).toBe("business");
    expect(additionalDocumentRole("other-services-fees.pdf")).toBe("other_services");
    expect(additionalDocumentRole("Schedule of Fees 2")).toBe("consumer_supplement");
  });
});

describe("Magellan site search for fee schedules and agreements", () => {
  const AGREEMENT_HOME = `
    <a href="/about">About Us</a>
    <form action="/search" method="get"><input type="search" name="q"><button>Search</button></form>`;
  const ACCOUNT_AGREEMENT = `<h1>Deposit Account Agreement</h1><p>These terms govern your account.</p>
    <p>Overdraft fee $30.00 per item paid</p><p>Stop payment fee $25.00</p>`;
  const MEMBERSHIP_AGREEMENT = `<h1>Membership Agreement</h1><p>By joining the credit union you agree to these terms.</p>
    <p>Members must maintain a share account. Dividends are paid as declared by the board.</p>`;

  function agreementFetch() {
    return vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://www.triangle.example/") return html(AGREEMENT_HOME);
      if (url === thinBank.fee_schedule_url) return html("<p>Incoming wire fee $10.00</p>");
      if (url === "https://www.triangle.example/search?q=account+agreement") {
        return html(`<a href="/disclosures/deposit-account-agreement">Deposit Account Agreement</a>`);
      }
      if (url === "https://www.triangle.example/search?q=member+agreement") {
        return html(`<a href="/disclosures/membership-agreement">Membership Agreement</a>`);
      }
      if (url.startsWith("https://www.triangle.example/search?")) return html("<p>No results</p>");
      if (url === "https://www.triangle.example/disclosures/deposit-account-agreement") return html(ACCOUNT_AGREEMENT);
      if (url === "https://www.triangle.example/disclosures/membership-agreement") return html(MEMBERSHIP_AGREEMENT);
      return notFound();
    });
  }

  const detailOf = (call: unknown[]) => JSON.parse(String(call[call.length - 1])) as { query: string; kept: number };

  it("runs several queries: fee schedule first, then a rotating slice of fee and agreement wording", () => {
    expect(siteSearchQueries(0)).toEqual(["fee schedule", "account agreement", "schedule of fees", "member agreement"]);
    expect(siteSearchQueries(1)).toEqual(["fee schedule", "truth in savings", "deposit agreement", "membership agreement"]);
    // Two runs cover every query.
    expect(new Set([...siteSearchQueries(0), ...siteSearchQueries(1)])).toEqual(new Set(SITE_SEARCH_QUERIES));
    for (const query of ["fee schedule", "schedule of fees", "truth in savings", "account agreement", "member agreement", "membership agreement", "deposit agreement"]) {
      expect(SITE_SEARCH_QUERIES).toContain(query);
    }
    const site = new URL("https://bank.example/");
    const urls = siteSearchUrls(`<form action="/search"><input type="search" name="q"></form>`, site, siteSearchQueries(0));
    expect(urls.map((search) => search.url)).toEqual([
      "https://bank.example/search?q=fee+schedule",
      "https://bank.example/search?q=account+agreement",
      "https://bank.example/search?q=schedule+of+fees",
      "https://bank.example/search?q=member+agreement",
    ]);
    expect(siteSearchUrls(`<p>no search</p>`, site, siteSearchQueries(0))).toEqual([]);
  });

  it("classifies agreements apart from fee schedules", () => {
    const site = new URL("https://bank.example/");
    const link = (url: string, label: string) => classifyCompanionLink({ url, label }, site);
    expect(link("https://bank.example/disclosures/account-agreement", "Account Agreement")?.kind).toBe("agreement");
    expect(link("https://bank.example/files/membership-agreement.pdf", "Membership Agreement")?.kind).toBe("agreement");
    expect(link("https://bank.example/files/deposit.pdf", "Deposit Agreement and Disclosures")?.kind).toBe("agreement");
    expect(link("https://bank.example/files/fees.pdf", "Fee Schedule and Account Agreement")?.kind).toBe("fee_document");
    expect(link("https://bank.example/files/loan-agreement.pdf", "Loan Agreement")).toBeNull();
    expect(link("https://bank.example/business/account-agreement", "Business Account Agreement")).toBeNull();
  });

  it("keeps an agreement that lists a fee, drops one that lists none, and logs each query", async () => {
    const db = createDb();
    const fetchImpl = agreementFetch();

    const result = await runSecondDocumentFind({ db: asDb(db), fetchImpl, runId: 7, deadline: Date.now() + 60_000, learning: true, searchRotation: 0 });

    expect(SECOND_DOCUMENT_FINDER.version).toBe(3);
    expect(result).toMatchObject({ status: "ran", checked: 1, found: 1 });
    expect(result.results[0].pages).toEqual([
      expect.objectContaining({
        url: "https://www.triangle.example/disclosures/deposit-account-agreement",
        kind: "agreement",
        role: "consumer_supplement",
        accountName: "Deposit Account Agreement",
        documentType: "html",
      }),
    ]);
    // The membership agreement was opened and dropped: it lists no fee.
    const opened = fetchImpl.mock.calls.map((call) => String(call[0]));
    expect(opened).toContain("https://www.triangle.example/disclosures/membership-agreement");

    const inserts = db.mock.calls.filter((call) => templateText(call[0]).includes("INSERT INTO institution_additional_sources"));
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toContain("consumer_supplement");
    expect(inserts[0]).not.toContain("https://www.triangle.example/disclosures/membership-agreement");

    const attempts = db.mock.calls.filter((call) => templateText(call[0]).includes("INSERT INTO pipeline_attempts"));
    const searches = attempts.filter((call) => call[4] === SITE_SEARCH_STRATEGY.strategy);
    expect(searches).toHaveLength(MAX_SEARCH_PAGES_PER_BANK);
    expect(searches.map((call) => detailOf(call).query)).toEqual(siteSearchQueries(0));
    const byQuery = (query: string) => searches.find((call) => detailOf(call).query === query)!;
    expect(detailOf(byQuery("account agreement")).kept).toBe(1);
    expect(byQuery("account agreement")[7]).toBe("ok");
    expect(detailOf(byQuery("member agreement")).kept).toBe(0);
    expect(byQuery("member agreement")[7]).toBe("rejected");
    expect(byQuery("fee schedule")[7]).toBe("no_candidates");
    expect(attempts.filter((call) => call[4] === SECOND_DOCUMENT_FINDER.strategy)).toHaveLength(1);
  });

  it("requests at most MAX_SEARCH_PAGES_PER_BANK search pages per bank", async () => {
    for (const rotation of [0, 1, 2, 5]) {
      expect(siteSearchQueries(rotation)).toHaveLength(MAX_SEARCH_PAGES_PER_BANK);
    }
    expect(siteSearchQueries(0, 50)).toHaveLength(SITE_SEARCH_QUERIES.length);
    const fetchImpl = agreementFetch();
    await runSecondDocumentFind({ db: asDb(createDb()), fetchImpl, runId: 8, deadline: Date.now() + 60_000, learning: true, searchRotation: 3 });
    const searchRequests = fetchImpl.mock.calls.map((call) => String(call[0])).filter((url) => url.includes("/search?"));
    expect(searchRequests.length).toBeGreaterThan(1);
    expect(searchRequests.length).toBeLessThanOrEqual(MAX_SEARCH_PAGES_PER_BANK);
  });
});
