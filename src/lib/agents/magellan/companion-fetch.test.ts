import { describe, expect, it, vi } from "vitest";

import { COMPANION_FETCH_STRATEGY, runCompanionFetch } from "./companion-fetch";

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

  it("waits for its migration", async () => {
    const fetchImpl = vi.fn();
    const result = await runCompanionFetch({ db: asDb(createDb([freedom], { ready: false })), fetchImpl, vault: null, runId: 7 });
    expect(result.status).toBe("schema_pending");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
