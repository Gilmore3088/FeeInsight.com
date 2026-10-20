import { describe, expect, it, vi } from "vitest";

import {
  accountNameFor,
  additionalDocumentRole,
  classifyCompanionLink,
  disclosureIndexDocuments,
  isDocumentIndexPage,
  isGenericAccountName,
  isNonDepositLink,
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
import { urlIdentity } from "./finders";

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

function createDb(ready = true, stateRows: unknown[] = [thinBank], hiddenRows: unknown[] = []): DbMock {
  return vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = templateText(strings);
    if (text.includes("AS companion_ready")) return Promise.resolve([{ companion_ready: ready }]);
    // The hidden-bank top-up passes hiddenOnly = true; the state's own query passes false.
    if (text.includes("FROM published_fee_records")) return Promise.resolve(values.includes(true) ? hiddenRows : stateRows);
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
  <p>Paper statement fee $2.00 per month</p><p>Debit card replacement fee $10.00</p><a href="/assets/files/IkShrDjx">Courtesy Pay Policy</a>`;
// One fee line is not enough: such pages gave live fees 1 time in 10 on prod.
const VALUE = `<h1>Value Checking</h1><p>Dividends paid monthly</p><p>Paper statement fee $2.00 per month</p>`;
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
    // Value Checking lists one fee, under the bar; loans and business pages are never opened.
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
    // Banks past the thin limit still qualify when a headline fee (maintenance, overdraft) is missing.
    expect(templateText(select![0])).toMatch(/OR NOT has_monthly_fee\s+OR NOT has_overdraft/);
  });

  it("fills spare slots with hidden banks from any state, never the same bank twice", async () => {
    const hiddenBank = { ...thinBank, id: 1562, state_code: "MN", categories: 1 };
    const db = createDb(true, [], [hiddenBank]);
    const fetchImpl = vi.fn(async () => notFound());

    const result = await runSecondDocumentFind({ db: asDb(db), fetchImpl, runId: 5, stateCode: "MT", deadline: Date.now() + 60_000, learning: true, dryRun: true });

    expect(result.results.map((row) => row.institutionId)).toEqual([1562]);
    const selects = db.mock.calls.filter(([strings]) => templateText(strings).includes("FROM published_fee_records"));
    expect(selects).toHaveLength(2);
    // State query: its own state, not hidden-only. Top-up: every state, hidden-only, at most the spare slots.
    expect(selects[0].slice(1)).toContain("MT");
    expect(selects[0].slice(1)).not.toContain(true);
    expect(selects[1].slice(1)).toContain(true);
    expect(selects[1].slice(1)).not.toContain("MT");
  });

  it("runs the stored-text tests only on banks that pass the cheap filters", async () => {
    const db = createDb(true, [], []);
    await runSecondDocumentFind({ db: asDb(db), fetchImpl: vi.fn(async () => notFound()), runId: 5, stateCode: "MT", deadline: Date.now() + 60_000, learning: true, dryRun: true });

    const [, topUp] = db.mock.calls.filter(([strings]) => templateText(strings).includes("FROM published_fee_records"));
    const text = templateText(topUp[0]);
    // Run on every bank first, the national top-up scanned 5,141 banks' texts to keep 65 (17 Oct 2026).
    const candidates = text.slice(text.indexOf("candidates AS MATERIALIZED"), text.indexOf("scoped AS"));
    expect(candidates).toContain("pipeline_attempts");
    expect(candidates).toContain("COALESCE(thin.categories, 0) <");
    expect(candidates).not.toContain("agent_source_texts");
    expect(text).toContain("FROM candidates inst");
  });

  it("skips the top-up when the state fills every slot, or with no state", async () => {
    const full = createDb(true, Array.from({ length: 6 }, (_, index) => ({ ...thinBank, id: index + 1 })), [thinBank]);
    await runSecondDocumentFind({ db: asDb(full), fetchImpl: vi.fn(async () => notFound()), runId: 5, stateCode: "MT", deadline: Date.now() + 60_000, learning: true, dryRun: true });
    expect(full.mock.calls.filter(([strings]) => templateText(strings).includes("FROM published_fee_records"))).toHaveLength(1);

    const national = createDb(true, [], [thinBank]);
    await runSecondDocumentFind({ db: asDb(national), fetchImpl: vi.fn(async () => notFound()), runId: 5, deadline: Date.now() + 60_000, learning: true, dryRun: true });
    expect(national.mock.calls.filter(([strings]) => templateText(strings).includes("FROM published_fee_records"))).toHaveLength(1);
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

    expect(SECOND_DOCUMENT_FINDER.version).toBe(4);
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
    expect(JSON.parse(String(byQuery("member agreement")[13]))).toMatchObject({ candidates: 1, checked: 1, unchecked: 0, rejected: 1 });
    expect(byQuery("fee schedule")[7]).toBe("no_candidates");
    expect(attempts.filter((call) => call[4] === SECOND_DOCUMENT_FINDER.strategy)).toHaveLength(1);
  });

  it("records timeout instead of rejection when result hits were never validated before the deadline", async () => {
    let now = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    const db = createDb();
    const originalFetch = agreementFetch();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "https://www.triangle.example/search?q=member+agreement") now = 1001;
      return originalFetch(input);
    });
    try {
      const result = await runSecondDocumentFind({ db: asDb(db), fetchImpl, runId: 9, deadline: 1000, learning: true, searchRotation: 0 });

      expect(result.results[0].outcome).toBe("timeout");
      expect(result.results[0].searches.find((search) => search.query === "account agreement")).toMatchObject({
        outcome: "timeout", status: 200, candidates: 1, kept: 0, checked: 0, unchecked: 1, rejected: 0,
      });
      expect(result.results[0].searches.find((search) => search.query === "member agreement")?.outcome).toBe("timeout");
      expect(result.results[0].searches.find((search) => search.query === "fee schedule")?.outcome).toBe("no_candidates");
      const searchAttempt = db.mock.calls.find((call) => templateText(call[0]).includes("INSERT INTO pipeline_attempts") && call[4] === SITE_SEARCH_STRATEGY.strategy && String(call[6]).includes("q=account+agreement"))!;
      expect(searchAttempt[5]).toBe(SITE_SEARCH_STRATEGY.version);
      expect(searchAttempt[7]).toBe("timeout");
      expect(JSON.parse(String(searchAttempt[13]))).toMatchObject({ query: "account agreement", candidates: 1, kept: 0, checked: 0, unchecked: 1, rejected: 0 });
      expect(fetchImpl.mock.calls.map((call) => String(call[0]))).not.toContain("https://www.triangle.example/disclosures/deposit-account-agreement");
    } finally {
      clock.mockRestore();
    }
  });

  it("preserves a kept query hit when the deadline leaves another query's candidates unchecked", async () => {
    let now = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    const feeUrl = "https://www.triangle.example/files/schedule-of-fees";
    let feeReads = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://www.triangle.example/") return html(AGREEMENT_HOME);
      if (url === thinBank.fee_schedule_url) return html("<p>Incoming wire fee $10.00</p>");
      if (url === "https://www.triangle.example/search?q=fee+schedule") return html('<a href="/files/schedule-of-fees">Fee Schedule</a>');
      if (url === "https://www.triangle.example/search?q=account+agreement") return html('<a href="/disclosures/deposit-account-agreement">Deposit Account Agreement</a>');
      if (url.includes("/search?")) return html("<p>No results</p>");
      if (url === feeUrl) {
        feeReads += 1;
        // The hub read completes first; the fee check then finishes as the budget expires.
        if (feeReads === 2) now = 1001;
        return html(COURTESY_PAY);
      }
      if (url === "https://www.triangle.example/disclosures/deposit-account-agreement") return html(ACCOUNT_AGREEMENT);
      return notFound();
    });
    try {
      const result = await runSecondDocumentFind({ db: asDb(createDb()), fetchImpl, runId: 10, deadline: 1000, learning: true, searchRotation: 0 });

      expect(result.found).toBe(1);
      expect(result.results[0].searches.find((search) => search.query === "fee schedule")).toMatchObject({ outcome: "ok", candidates: 1, kept: 1, checked: 1, unchecked: 0, rejected: 0 });
      expect(result.results[0].searches.find((search) => search.query === "account agreement")).toMatchObject({ outcome: "timeout", candidates: 1, kept: 0, checked: 0, unchecked: 1, rejected: 0 });
    } finally {
      clock.mockRestore();
    }
  });

  it("treats a duplicate hit already kept by an earlier query as unchanged", async () => {
    const originalFetch = agreementFetch();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "https://www.triangle.example/search?q=member+agreement") {
        return html('<a href="/disclosures/deposit-account-agreement">Deposit Account Agreement</a>');
      }
      return originalFetch(input);
    });
    const result = await runSecondDocumentFind({ db: asDb(createDb()), fetchImpl, runId: 11, deadline: Date.now() + 60_000, learning: true, searchRotation: 0 });

    expect(result.results[0].searches.find((search) => search.query === "account agreement")?.outcome).toBe("ok");
    expect(result.results[0].searches.find((search) => search.query === "member agreement")).toMatchObject({ outcome: "unchanged", candidates: 1, kept: 0, checked: 1, unchecked: 0, rejected: 0 });
  });

  it("keeps a completed rejection when its final check finishes after the deadline", async () => {
    let now = 0;
    let membershipReads = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    const originalFetch = agreementFetch();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "https://www.triangle.example/disclosures/membership-agreement") {
        membershipReads += 1;
        if (membershipReads === 2) now = 1001;
      }
      return originalFetch(input);
    });
    try {
      const result = await runSecondDocumentFind({ db: asDb(createDb()), fetchImpl, runId: 12, deadline: 1000, learning: true, searchRotation: 0 });

      expect(result.results[0].searches.find((search) => search.query === "member agreement")).toMatchObject({ outcome: "rejected", candidates: 1, kept: 0, checked: 1, unchecked: 0, rejected: 1 });
    } finally {
      clock.mockRestore();
    }
  });

  it("does not claim capped, unchecked hits were rejected", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://www.triangle.example/") return html(AGREEMENT_HOME);
      if (url === thinBank.fee_schedule_url) return html("<p>Incoming wire fee $10.00</p>");
      if (url === "https://www.triangle.example/search?q=member+agreement") {
        return html([1, 2, 3, 4].map((id) => `<a href="/disclosures/member-agreement-${id}">Membership Agreement ${id}</a>`).join(""));
      }
      if (url.includes("/search?")) return html("<p>No results</p>");
      if (url.includes("/disclosures/member-agreement-")) return html(MEMBERSHIP_AGREEMENT);
      return notFound();
    });
    const result = await runSecondDocumentFind({ db: asDb(createDb()), fetchImpl, runId: 13, deadline: Date.now() + 60_000, learning: true, searchRotation: 0 });

    expect(result.results[0].searches.find((search) => search.query === "member agreement")).toMatchObject({ outcome: "no_candidates", candidates: 4, kept: 0, checked: 3, unchecked: 1, rejected: 3 });
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

describe("companion links that are never fee documents", () => {
  const site = new URL("https://bank.example");
  const classify = (label: string, path: string) => classifyCompanionLink({ url: `https://bank.example${path}`, label } as never, site);

  it("skips funds-availability notices, opt-in forms, Zelle terms, rates pages, calculators and join pages", () => {
    expect(classify("Funds Availability", "/uploads/Funds-Availability-Disclosure.pdf")).toBeNull();
    expect(classify("Overdraft Opt-In", "/uploads/Overdraft-Opt-InForm-5-14-20.pdf")).toBeNull();
    expect(classify("Zelle terms", "/docs/zelle-consumer-terms.pdf")).toBeNull();
    expect(classify("Savings Rates", "/Rates/Savings-Rates")).toBeNull();
    expect(classify("Share & Deposit Account Rates", "/rates-fees/account-rates")).toBeNull();
    expect(classify("Savings Calculators", "/Save-and-Spend/Savings-Calculators")).toBeNull();
    expect(classify("The Credit Union Difference", "/savings/join/")).toBeNull();
  });

  it("still takes fee schedules and account pages", () => {
    expect(classify("Fee Schedule", "/fee-schedule.pdf")?.kind).toBe("fee_document");
    expect(classify("Free Checking", "/checking/free-checking")?.kind).toBe("account_page");
  });
});

describe("market leaders without a live overdraft fee", () => {
  it("searches up to two leaders from any state before the state's own banks", async () => {
    const leader = { ...thinBank, id: 839, institution_name: "The Yellowstone Bank", state_code: "MT" };
    const queries: Array<{ text: string; values: unknown[] }> = [];
    const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = templateText(strings);
      queries.push({ text, values });
      if (text.includes("AS companion_ready")) return Promise.resolve([{ companion_ready: true }]);
      if (text.includes("FROM published_fee_records")) {
        const leaderOnly = values.some((value) => Array.isArray(value) && value.length === 2 && value.includes(839));
        return Promise.resolve(leaderOnly ? [leader] : [thinBank]);
      }
      return Promise.resolve([]);
    });
    const result = await runSecondDocumentFind({
      db: asDb(db),
      fetchImpl: vi.fn(async () => notFound()),
      runId: 5,
      stateCode: "MS",
      deadline: Date.now() + 60_000,
      learning: true,
      dryRun: true,
      hiddenTopUp: false,
      leaderIds: [839, 1],
    });
    expect(result.results.map((row) => row.institutionId)).toEqual([839, 5829]);
    const thinQueries = queries.filter((query) => query.text.includes("FROM published_fee_records"));
    expect(thinQueries[0].text).toContain("NOT has_overdraft");
    expect(thinQueries[0].values).toContain(2);
    // The state's own query leaves out the leader already taken.
    expect(thinQueries[1].values).toContainEqual([839]);
  });
});

describe("Magellan companion finder: disclosure index pages (#1051)", () => {
  const site = new URL("https://www.jonesboro.example/");
  const index = "https://www.jonesboro.example/agreements-and-disclosures";
  const links = [
    { url: "https://www.jonesboro.example/uploads/files/a81f", label: "Download" },
    { url: "https://www.jonesboro.example/uploads/consumer-information.pdf", label: "Consumer Information" },
    { url: "https://www.jonesboro.example/uploads/privacy-notice.pdf", label: "Privacy Notice" },
    { url: "https://www.jonesboro.example/uploads/business-services.pdf", label: "Business Services" },
    { url: "https://www.jonesboro.example/uploads/home-equity.pdf", label: "Home Equity Disclosure" },
    { url: "https://www.jonesboro.example/uploads/fee-schedule.pdf", label: "Fee Schedule" },
    { url: "https://www.jonesboro.example/personal/checking", label: "Checking" },
  ];

  it("offers an index page's untitled documents, never its privacy, loan or business ones", () => {
    const found = disclosureIndexDocuments(index, links, site, new Set());
    expect(found.map((candidate) => candidate.url)).toEqual([
      "https://www.jonesboro.example/uploads/files/a81f",
      "https://www.jonesboro.example/uploads/consumer-information.pdf",
    ]);
    expect(found[0]).toMatchObject({ kind: "fee_document", foundOn: index, source: "hub_link", reasons: ["disclosure_index"] });
    // "Fee Schedule" is a fee document by name: the normal path opens it, ahead of these.
    expect(classifyCompanionLink(links[5], site)?.kind).toBe("fee_document");
    expect(found[0].score).toBeLessThan(classifyCompanionLink(links[5], site)!.score);
  });

  it("is only for index pages that list several documents", () => {
    expect(isDocumentIndexPage(index)).toBe(true);
    expect(isDocumentIndexPage("https://www.jonesboro.example/disclosures")).toBe(true);
    expect(isDocumentIndexPage("https://www.jonesboro.example/personal/checking")).toBe(false);
    expect(isDocumentIndexPage("https://www.jonesboro.example/uploads/disclosures.pdf")).toBe(false);
    // #1306: the word must start a segment or a word in one.
    expect(isDocumentIndexPage("https://www.jonesboro.example/forms-documents")).toBe(true);
    expect(isDocumentIndexPage("https://www.jonesboro.example/digital-platforms")).toBe(false);
    // Run-together names still count (209 stored addresses, Oct 14).
    expect(isDocumentIndexPage("https://www.bank.example/ConsumerDisclosures")).toBe(true);
    expect(isDocumentIndexPage("https://www.bank.example/AccountAgreements")).toBe(true);
    expect(disclosureIndexDocuments("https://www.jonesboro.example/personal/checking", links, site, new Set())).toEqual([]);
    expect(disclosureIndexDocuments(index, links.slice(0, 1), site, new Set())).toEqual([]);
    // A document already stored for the bank is not offered again.
    expect(disclosureIndexDocuments(index, links, site, new Set([urlIdentity(links[0].url)])).map((candidate) => candidate.url)).toEqual([
      "https://www.jonesboro.example/uploads/consumer-information.pdf",
    ]);
  });

  it("keeps the schedule an index page links to under a generic name", async () => {
    const bank = {
      id: 899,
      institution_name: "Jonesboro State Bank",
      state_code: "LA",
      website_url: "https://www.jonesboro.example",
      fee_schedule_url: index,
      categories: 0,
    };
    const db = createDb(true, [bank]);
    const SCHEDULE = `<h1>Schedule of Fees and Charges</h1><p>Overdraft fee $30.00 per item</p><p>NSF fee $30.00 per item</p>
      <p>Stop payment $25.00</p><p>Incoming wire $15.00</p><p>Monthly service charge $8.00</p>`;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://www.jonesboro.example/") return html(`<a href="/agreements-and-disclosures">Disclosures</a>`);
      if (url === index) {
        return html(`<h1>Agreements, Disclosures, and Terms of Use</h1><p>Internet Banking Agreement ... a stop payment fee may apply.</p>
          <a href="/uploads/files/a81f">Download</a><a href="/uploads/consumer-information.pdf">Consumer Information</a>
          <a href="/uploads/privacy-notice.pdf">Privacy Notice</a>`);
      }
      if (url === "https://www.jonesboro.example/uploads/files/a81f") return html(SCHEDULE);
      return notFound();
    });

    const result = await runSecondDocumentFind({ db: asDb(db), fetchImpl, runId: 9, deadline: Date.now() + 60_000, learning: true, hiddenTopUp: false });

    expect(result.results[0].pages).toEqual([
      expect.objectContaining({ url: "https://www.jonesboro.example/uploads/files/a81f", kind: "fee_document" }),
    ]);
    expect(result.results[0].indexDocumentsChecked).toBe(2);
    const opened = fetchImpl.mock.calls.map((call) => String(call[0]));
    expect(opened).not.toContain("https://www.jonesboro.example/uploads/privacy-notice.pdf");
    const attempt = db.mock.calls.find((call) => templateText(call[0]).includes("INSERT INTO pipeline_attempts") && call[4] === SECOND_DOCUMENT_FINDER.strategy);
    expect(JSON.parse(String(attempt![attempt!.length - 1]))).toMatchObject({ index_documents_checked: 2 });
  });
});

// #1309: a fee document on another host must name this bank, and a name another institution
// has counts only with the city or the certificate number next to "FDIC" / "Cert".
describe("Magellan companion finder: documents on another host", () => {
  const bank = {
    id: 41,
    institution_name: "Peoples Bank",
    city: "Rock Valley",
    cert_number: "175",
    state_code: "IA",
    website_url: "https://www.peoples-ebank.example",
    fee_schedule_url: "https://www.peoples-ebank.example/checking",
    categories: 1,
  };
  const pdf = "https://www.peoplesbank-wa.example/fee-schedule.pdf";
  const schedule = (who: string) =>
    `<h1>${who} Schedule of Fees</h1><p>Overdraft fee $30.00 per item</p><p>NSF fee $30.00 per item</p><p>Stop payment $175.00</p><p>Incoming wire $15.00</p><p>Monthly service charge $8.00</p>`;
  it.each([
    // The schedule's "$175.00" is a price, not cert 175.
    ["the shared name alone", "Peoples Bank", false],
    ["the shared name and the city", "Peoples Bank, Rock Valley", true],
    ["the shared name and the FDIC certificate", "Peoples Bank (FDIC Cert #175)", true],
  ])("%s", async (_case, who, kept) => {
    const base = createDb(true, [bank]) as unknown as (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
    const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) =>
      templateText(strings).includes("shared-name check")
        ? Promise.resolve([{ id: 41, institution_name: "Peoples Bank" }, { id: 77, institution_name: "Peoples Bank" }])
        : base(strings, ...values),
    );
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://www.peoples-ebank.example/") return html(`<a href="${pdf}">Fee Schedule</a>`);
      if (url === pdf) return html(schedule(who));
      return notFound();
    });

    const result = await runSecondDocumentFind({ db: asDb(db), fetchImpl, runId: 9, deadline: Date.now() + 60_000, learning: true, hiddenTopUp: false });

    expect(fetchImpl.mock.calls.map((call) => String(call[0]))).toContain(pdf);
    expect(result.results[0].pages.map((page) => page.url)).toEqual(kept ? [pdf] : []);
  });
});

describe("brokerage, wealth and loan pages are not deposit fee documents (#1442)", () => {
  const site = new URL("https://bank.example");
  const classify = (label: string, path: string) => classifyCompanionLink({ url: `https://bank.example${path}`, label } as never, site);

  it("discovery skips brokerage, investment, wealth and trust-and-investment links", () => {
    expect(classify("Brokerage Fee Schedule", "/docs/brokerage-fee-schedule.pdf")).toBeNull();
    expect(classify("Self-Directed Investing Pricing", "/investing/self-directed-investing/pricing")).toBeNull();
    expect(classify("Wealth Management Fees", "/wealth-management/fee-schedule")).toBeNull();
    expect(classify("Trust & Investment Services", "/trust-and-investment-services/fees")).toBeNull();
    expect(classify("Download", "/docs/Credit-Card-Solicitation-disclosure.pdf")).toBeNull();
  });

  it("discovery keeps deposit links that carry an investment or wealth word", () => {
    expect(classify("Fee Schedule", "/personal/checking-savings-and-investments-fee-schedule.pdf")?.kind).toBe("fee_document");
    expect(classify("Fee Schedule", "/wp-content/uploads/Investment-and-Deposit-Fee-Schedule.pdf")?.kind).toBe("fee_document");
    expect(classify("HSA Fees", "/docs/hsa-investments-fees.pdf")?.kind).toBe("fee_document");
    expect(classify("Wealth Builder Savings", "/accounts/wealth-builder-savings")?.kind).toBe("account_page");
    expect(classify("Investment Money Market", "/accounts/investment-money-market")?.kind).toBe("account_page");
    expect(classify("Schedule of Fees", "/personal/Schedule-of-Fees-Personal-Checking.pdf")?.kind).toBe("fee_document");
  });

  it("isNonDepositLink, which retires stored companions, keeps its pre-#1442 words", () => {
    expect(isNonDepositLink("Brokerage Fee Schedule", "https://bank.example/docs/brokerage-fee-schedule.pdf")).toBe(false);
    expect(isNonDepositLink("Wealth Management", "https://bank.example/wealth-management/fee-schedule")).toBe(false);
    expect(isNonDepositLink("Rates", "https://bank.example/current-rates/")).toBe(false);
    expect(isNonDepositLink("Cardholder Agreement", "https://bank.example/forms/cardholder-agreement")).toBe(false);
    expect(isNonDepositLink("Home Equity Line of Credit", "https://bank.example/heloc")).toBe(true);
    expect(isNonDepositLink("Fee Schedule", "https://bank.example/fee-schedule")).toBe(false);
  });
});
