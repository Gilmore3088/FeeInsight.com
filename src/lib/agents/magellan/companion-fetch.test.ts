import { describe, expect, it, vi } from "vitest";

import { COMPANION_FETCH_STRATEGY, reviewStoredCompanions, runCompanionFetch } from "./companion-fetch";

type DbMock = ReturnType<typeof vi.fn>;

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

const freedom = {
  id: 41,
  institution_id: 5829,
  url: "https://www.triangle.example/accounts/personal-checking/freedom-checking",
  document_role: "account_page",
  account_name: "Freedom Checking",
  fetch_failures: 0,
  last_source_document_id: null,
  last_hash: null,
};

function createDb(rows: unknown[], options: { ready?: boolean; existing?: number | null } = {}): DbMock {
  return vi.fn((strings: TemplateStringsArray) => {
    const text = templateText(strings);
    if (text.includes("AS companion_ready")) return Promise.resolve([{ companion_ready: options.ready ?? true }]);
    if (text.includes("FROM institution_additional_sources ias")) return Promise.resolve(rows);
    if (text.includes("SELECT id FROM source_documents")) return Promise.resolve(options.existing ? [{ id: options.existing }] : []);
    if (text.includes("INSERT INTO source_documents")) return Promise.resolve([{ id: 9001 }]);
    return Promise.resolve([]);
  });
}

const asDb = (db: DbMock) => db as unknown as Parameters<typeof runCompanionFetch>[0]["db"];
const page = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/html" } });

describe("Magellan companion fetch", () => {
  it("stores a companion page as its own document stream, never touching the main fee link", async () => {
    const db = createDb([freedom]);
    const fetchImpl = vi.fn(async () => page("<p>Monthly service fee $5.00</p>"));

    const result = await runCompanionFetch({ db: asDb(db), fetchImpl, vault: null, runId: 7, stateCode: "MS" });

    expect(result).toMatchObject({ status: "ran", selected: 1, fetched: 1, failed: 0 });
    expect(result.results[0]).toMatchObject({ companionId: 41, sourceDocumentId: 9001, accountName: "Freedom Checking", outcome: "success" });
    const insert = db.mock.calls.find((call) => templateText(call[0]).includes("INSERT INTO source_documents"));
    expect(templateText(insert?.[0])).toContain("companion_source_id");
    expect(insert).toContain(41);
    const marked = db.mock.calls.find((call) => templateText(call[0]).includes("SET status = 'fetched'"));
    expect(marked).toContain(9001);
    const attempt = db.mock.calls.find((call) => templateText(call[0]).includes("INSERT INTO pipeline_attempts"));
    expect(attempt).toContain(COMPANION_FETCH_STRATEGY.strategy);
    const touched = db.mock.calls.map((call) => templateText(call[0]));
    expect(touched.some((text) => text.includes("UPDATE institution_sources") || text.includes("institution_source_profiles"))).toBe(false);
  });

  it("fetches a schedule found by hand in any state's lane until it is first fetched", async () => {
    const db = createDb([]);
    await runCompanionFetch({ db: asDb(db), fetchImpl: vi.fn(), vault: null, runId: 7, stateCode: "LA" });
    const select = db.mock.calls.find((call) => templateText(call[0]).includes("latest.content_hash AS last_hash"));
    expect(templateText(select?.[0]).replace(/\s+/g, " ")).toContain(
      "OR (ias.found_by_strategy = 'discover.operator_schedule' AND ias.last_fetched_at IS NULL)",
    );
    expect(templateText(select?.[0]).replace(/\s+/g, " ")).toContain(
      "OR (inst.status = 'dormant' AND ias.found_by_strategy = 'discover.operator_schedule')",
    );
  });

  it("reuses a stored document with the same bytes instead of inserting a duplicate", async () => {
    const db = createDb([freedom], { existing: 512 });
    const result = await runCompanionFetch({ db: asDb(db), fetchImpl: vi.fn(async () => page("same bytes")), vault: null, runId: 7 });

    expect(result.results[0]).toMatchObject({ outcome: "unchanged", sourceDocumentId: 512 });
    expect(db.mock.calls.some((call) => templateText(call[0]).includes("INSERT INTO source_documents"))).toBe(false);
  });

  it("retires a page that is gone twice in a row", async () => {
    const db = createDb([{ ...freedom, fetch_failures: 1 }]);
    const result = await runCompanionFetch({ db: asDb(db), fetchImpl: vi.fn(async () => page("gone", 404)), vault: null, runId: 7 });

    expect(result).toMatchObject({ failed: 1 });
    const failure = db.mock.calls.find((call) => templateText(call[0]).includes("SET fetch_failures"));
    expect(failure).toContain(2);
    expect(failure).toContain(true);
  });

  it("does not store a PDF link answered with a web page (the bot wall), and marks it blocked", async () => {
    const pdf = { ...freedom, url: "https://www.53.com/content/dam/fifth-third/docs/legal/fee-schedule.pdf" };
    const db = createDb([pdf]);
    const result = await runCompanionFetch({ db: asDb(db), fetchImpl: vi.fn(async () => page("<html><body>This page doesn't exist</body></html>")), vault: null, runId: 7 });

    expect(result).toMatchObject({ fetched: 0, failed: 1 });
    expect(result.results[0]).toMatchObject({ attemptOutcome: "blocked_bot" });
    expect(db.mock.calls.some((call) => templateText(call[0]).includes("INSERT INTO source_documents"))).toBe(false);
    const attempt = db.mock.calls.find((call) => templateText(call[0]).includes("INSERT INTO pipeline_attempts"));
    expect(attempt).toContain("blocked_bot");
  });

  it("does not store a bot challenge served in place of the page, and marks it blocked", async () => {
    const arvest = { ...freedom, url: "https://www.arvest.com/personal/fee-schedule" };
    const db = createDb([arvest]);
    const challenge = '<html><head><title>Just a moment...</title></head><body><script src="/cdn-cgi/challenge-platform/x.js"></script></body></html>';
    const result = await runCompanionFetch({ db: asDb(db), fetchImpl: vi.fn(async () => page(challenge)), vault: null, runId: 7 });

    expect(result).toMatchObject({ fetched: 0, failed: 1 });
    expect(result.results[0]).toMatchObject({ attemptOutcome: "blocked_bot" });
    expect(db.mock.calls.some((call) => templateText(call[0]).includes("INSERT INTO source_documents"))).toBe(false);
  });

  it("waits for its migration", async () => {
    const fetchImpl = vi.fn();
    const result = await runCompanionFetch({ db: asDb(createDb([freedom], { ready: false })), fetchImpl, vault: null, runId: 7 });
    expect(result.status).toBe("schema_pending");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("re-applies today's finder rules to pages already stored: retires loan documents, renames link-text names", async () => {
    const heloc = { id: 67, institution_id: 8455, url: "https://frontier.example/documents/heloc-important-terms-disclosures/", account_name: "Download" };
    const pdf = { id: 51, institution_id: 8, url: "https://pnc.example/pdf/personal/Checking/Simple_Checking_Fees.pdf", account_name: "Features and Fees" };
    const db = createDb([heloc, pdf, freedom]);

    const review = await reviewStoredCompanions(asDb(db), { stateCode: "WA", institutionId: null });

    expect(review.checked).toBe(3);
    expect(review.retired.map((page) => page.companionId)).toEqual([67]);
    expect(review.renamed).toEqual([{ companionId: 51, from: "Features and Fees", to: "Simple Checking Fees" }]);
    const retired = db.mock.calls.find((call) => templateText(call[0]).includes("SET status = 'rejected'") && !templateText(call[0]).includes("institution_sources other"));
    expect(String(retired?.[1])).toMatch(/^not_consumer_fee_page/);
    expect(retired).toContain(67);
  });

  it("retires a stored page on another institution's own website, even one found by hand", async () => {
    const db = vi.fn((strings: TemplateStringsArray) => {
      const sqlText = templateText(strings);
      if (sqlText.includes("FROM institution_sources inst, institution_sources other")) {
        return Promise.resolve([{ id: 2514, institution_id: 118, url: "https://mybank.com/wp-content/uploads/OAC_Account_Disclosures.pdf", account_name: null, other_name: "First United Bank & Trust" }]);
      }
      return Promise.resolve([]);
    });

    const review = await reviewStoredCompanions(asDb(db), { stateCode: null, institutionId: 118 });

    expect(review.retired.map((page) => page.companionId)).toEqual([2514]);
    const update = db.mock.calls.find((call) => templateText(call[0]).includes("institution_sources other"));
    const updateText = templateText(update?.[0]).replace(/\s+/g, " ");
    expect(updateText).toContain("SET status = 'rejected'");
    expect(updateText).toContain("other.id <> inst.id");
    expect(updateText).toContain("IS DISTINCT FROM");
    expect(updateText).not.toContain("found_by_strategy");
    // Not limited to the lane's state.
    expect(updateText).not.toContain("inst.state_code");
    expect(update).toContain("other_bank_host");
  });

  it("never retires a schedule found by hand for its link words, and puts back the ones it did", async () => {
    // Valley's fee schedule PDF is named "Schedule of Fees-Privacy Policy-ADA"; First United's
    // overdraft notice is "opt-in-form.pdf".
    const valley = {
      id: 2301, institution_id: 44, account_name: null, found_by_strategy: "discover.operator_schedule",
      url: "https://www.valley.com/content/dam/valley/pdfs/cra/public-file/NEW_AAYA-Schedule%20of%20Fees-Privacy%20Policy-ADA.pdf",
    };
    const db = createDb([valley]);

    const review = await reviewStoredCompanions(asDb(db), { stateCode: "NJ", institutionId: null });

    expect(review.retired).toEqual([]);
    const restore = db.mock.calls.find((call) => templateText(call[0]).includes("SET status = 'found'"));
    const restoreText = templateText(restore?.[0]).replace(/\s+/g, " ");
    expect(restoreText).toContain("ias.found_by_strategy = 'discover.operator_schedule'");
    expect(restoreText).toContain("ias.status = 'rejected'");
    expect(restore).toContain("not_consumer_fee_page: loan or other non-deposit document");
  });
});
