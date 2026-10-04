import { describe, expect, it, vi } from "vitest";

import { additionalDocumentRole, runSecondDocumentFind, SECOND_DOCUMENT_FINDER, THIN_BANK_CATEGORY_LIMIT } from "./second-document";

type DbMock = ReturnType<typeof vi.fn>;

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

const thinBank = {
  id: 7,
  institution_name: "Thin Bank",
  state_code: "VT",
  website_url: "https://thin.example",
  fee_schedule_url: "https://thin.example/personal/fees",
  categories: 3,
};

function createDb(ready = true): DbMock {
  return vi.fn((strings: TemplateStringsArray) => {
    const text = templateText(strings);
    if (text.includes("institution_additional_sources') IS NOT NULL")) return Promise.resolve([{ ready }]);
    if (text.includes("FROM published_fee_catalog")) return Promise.resolve([thinBank]);
    if (text.includes("SELECT document_url AS url")) return Promise.resolve([{ url: "https://thin.example/personal/fees" }]);
    return Promise.resolve([]);
  });
}

const asDb = (db: DbMock) => db as unknown as Parameters<typeof runSecondDocumentFind>[0]["db"];

const html = (body: string) => new Response(body, { headers: { "content-type": "text/html" } });
const FEES = "<table><tr><td>Business account maintenance fee</td><td>$15.00</td></tr><tr><td>Night deposit bag fee</td><td>$25.00</td></tr>" +
  "<tr><td>Coin counting fee</td><td>$5.00</td></tr></table>";

describe("Magellan second-document finder", () => {
  it("finds a business fee schedule for a thin bank and stores it beside the main link", async () => {
    const db = createDb();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://thin.example/") return html('<a href="/personal/fees">Fee Schedule</a> <a href="/about">About</a>');
      if (url === "https://thin.example/personal/fees") return html('<p>Consumer fees</p><a href="/business/business-fee-schedule">Business Fee Schedule</a>');
      if (url === "https://thin.example/business/business-fee-schedule") return html(FEES);
      return new Response("missing", { status: 404, headers: { "content-type": "text/html" } });
    });

    const result = await runSecondDocumentFind({ db: asDb(db), fetchImpl, runId: 5, stateCode: "VT", deadline: Date.now() + 60_000, learning: true });

    expect(result).toMatchObject({ status: "ran", checked: 1, found: 1 });
    expect(result.results[0]).toMatchObject({ url: "https://thin.example/business/business-fee-schedule", role: "business", outcome: "ok" });
    const insert = db.mock.calls.find((call) => templateText(call[0]).includes("INSERT INTO institution_additional_sources"));
    expect(insert).toContain("https://thin.example/business/business-fee-schedule");
    const attempt = db.mock.calls.find((call) => templateText(call[0]).includes("INSERT INTO pipeline_attempts"));
    expect(attempt?.[4]).toBe(SECOND_DOCUMENT_FINDER.strategy);
    // The main fee link is never touched.
    expect(db.mock.calls.some((call) => templateText(call[0]).includes("UPDATE institution_sources"))).toBe(false);
    const select = db.mock.calls.find((call) => templateText(call[0]).includes("FROM published_fee_catalog"));
    expect(select).toContain(THIN_BANK_CATEGORY_LIMIT);
  });

  it("waits for its migration and the attempt log", async () => {
    const fetchImpl = vi.fn();
    expect((await runSecondDocumentFind({ db: asDb(createDb(false)), fetchImpl, runId: 1, deadline: Date.now() + 1000, learning: true })).status).toBe("schema_pending");
    expect((await runSecondDocumentFind({ db: asDb(createDb()), fetchImpl, runId: 1, deadline: Date.now() + 1000, learning: false })).status).toBe("no_attempt_log");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("names the document's role from its label", () => {
    expect(additionalDocumentRole("Commercial Account Fees")).toBe("business");
    expect(additionalDocumentRole("other-services-fees.pdf")).toBe("other_services");
    expect(additionalDocumentRole("Schedule of Fees 2")).toBe("consumer_supplement");
  });
});
