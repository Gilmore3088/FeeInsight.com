import { describe, expect, it, vi } from "vitest";

const trackAnthropicRequest = vi.fn(async (_context: unknown, request: () => PromiseLike<unknown>) => request());
vi.mock("@/lib/ai-provider-usage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai-provider-usage")>()),
  trackAnthropicRequest: (context: unknown, request: () => PromiseLike<unknown>) => trackAnthropicRequest(context, request),
}));

import { checkHomepage, distinctiveNameWords, runWebsiteFind, websiteOrigin, type WebsiteFindRow } from "./website-find";

type DbMock = ReturnType<typeof vi.fn>;

const text = (strings: unknown) => (Array.isArray(strings) ? strings.join(" ") : String(strings));

const lipan: WebsiteFindRow = { id: 7, institution_name: "The First National Bank of Lipan", city: "Lipan", state_code: "TX", charter_type: "bank", cert_number: "3303" };
const mct: WebsiteFindRow = { id: 8, institution_name: "Mct Federal Credit Union", city: "Port Neches", state_code: "TX", charter_type: "credit_union", cert_number: "97089" };

const page = (body: string) => `<html><head><title>${body.split("|")[0]}</title></head><body><p>${body}</p></body></html>`;

function createDb(rows: WebsiteFindRow[], taken = false): DbMock {
  return vi.fn((strings: TemplateStringsArray) => {
    const sqlText = text(strings);
    if (sqlText.includes("inst.charter_type")) return Promise.resolve(rows);
    if (sqlText.includes("AS taken")) return Promise.resolve([{ taken }]);
    return Promise.resolve([]);
  });
}

const asDb = (db: DbMock) => db as unknown as NonNullable<Parameters<typeof runWebsiteFind>[0]["db"]>;

const answer = (json: Record<string, unknown>) =>
  ({
    content: [{ type: "text", text: JSON.stringify(json) }],
    usage: { input_tokens: 1500, output_tokens: 100, server_tool_use: { web_search_requests: 1 } },
  }) as never;

function serve(html: string, status = 200) {
  return vi.fn(async () => new Response(html, { status, headers: { "content-type": "text/html" } }));
}

function websiteUpdates(db: DbMock) {
  return db.mock.calls.filter((call) => text(call[0]).includes("SET website_url"));
}

describe("Magellan website search for institutions with no website", () => {
  it("keeps only the words that tell an institution apart", () => {
    expect(distinctiveNameWords("The First National Bank of Lipan")).toEqual(["first", "lipan"]);
    expect(distinctiveNameWords("Mct Federal Credit Union")).toEqual(["mct"]);
  });

  it("rejects directories, social sites and government domains", () => {
    expect(websiteOrigin("https://www.fnblipan.com/about")).toBe("https://www.fnblipan.com");
    expect(websiteOrigin("fnblipan.com")).toBe("https://fnblipan.com");
    expect(websiteOrigin("https://www.facebook.com/fnblipan")).toBeNull();
    expect(websiteOrigin("https://mapping.ncua.gov/x")).toBeNull();
    expect(websiteOrigin("https://www.bankrate.com/banks/lipan")).toBeNull();
  });

  it("needs the name plus the city or the charter number on the homepage", () => {
    expect(checkHomepage(lipan, page("First National Bank of Lipan | Serving Lipan, Texas since 1907")).ok).toBe(true);
    expect(checkHomepage(mct, page("MCT Credit Union | NCUA charter 97089")).charterMatched).toBe(true);
    expect(checkHomepage(mct, page("MCT Credit Union | NCUA charter 97089")).ok).toBe(true);
    // Right name, wrong place: a different First National Bank.
    expect(checkHomepage(lipan, page("First National Bank | Serving Abilene, Texas")).ok).toBe(false);
    // Right town, different institution.
    expect(checkHomepage(lipan, page("Lipan Community Church")).ok).toBe(false);
  });

  it("saves a website that passes the homepage check and resets the bank's search", async () => {
    const db = createDb([lipan]);
    const create = vi.fn().mockResolvedValueOnce(answer({ url: "https://www.fnblipan.com/", evidence: "Official site" }));
    const result = await runWebsiteFind({ runId: 3, stateCode: "TX", db: asDb(db), create, fetchImpl: serve(page("First National Bank of Lipan | Lipan, TX")) });
    expect(result).toMatchObject({ selected: 1, processed: 1, saved: 1, needsHuman: 0 });
    const updates = websiteUpdates(db);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toContain("https://www.fnblipan.com");
    expect(text(updates[0][0])).toContain("rescue_status = 'pending'");
    expect(text(updates[0][0])).toContain("locked_by_correction IS TRUE");
  });

  it("does not save a homepage that fails the check, a taken domain, or a directory answer", async () => {
    const failing = createDb([lipan]);
    const r1 = await runWebsiteFind({
      runId: 3, db: asDb(failing), create: vi.fn().mockResolvedValueOnce(answer({ url: "https://fnb-abilene.example" })),
      fetchImpl: serve(page("First National Bank | Abilene")),
    });
    expect(r1).toMatchObject({ saved: 0, needsHuman: 1 });
    expect(r1.results[0]).toMatchObject({ outcome: "evidence_mismatch", candidate_url: "https://fnb-abilene.example" });
    expect(websiteUpdates(failing)).toHaveLength(0);

    const taken = createDb([lipan], true);
    const fetchImpl = serve(page("First National Bank of Lipan | Lipan"));
    const r2 = await runWebsiteFind({ runId: 3, db: asDb(taken), create: vi.fn().mockResolvedValueOnce(answer({ url: "https://bigbank.example" })), fetchImpl });
    expect(r2.results[0]).toMatchObject({ outcome: "rejected" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(websiteUpdates(taken)).toHaveLength(0);

    const directory = createDb([lipan]);
    const r3 = await runWebsiteFind({ runId: 3, db: asDb(directory), create: vi.fn().mockResolvedValueOnce(answer({ url: "https://www.facebook.com/fnblipan" })) });
    expect(r3.results[0]).toMatchObject({ outcome: "invalid_url" });
  });

  it("sends a one-word stored name to a person without a paid search", async () => {
    const create = vi.fn();
    const short: WebsiteFindRow = { id: 9, institution_name: "CALIFORNIA", city: "GLENDALE", state_code: "CA", charter_type: "credit_union", cert_number: "24980" };
    const result = await runWebsiteFind({ runId: 3, db: asDb(createDb([short])), create });
    expect(create).not.toHaveBeenCalled();
    expect(result).toMatchObject({ processed: 1, needsHuman: 1, costMicrousd: 0 });
  });

  it("dry runs list who would be searched without calling the model", async () => {
    const create = vi.fn();
    const result = await runWebsiteFind({ runId: 3, dryRun: true, db: asDb(createDb([lipan, mct])), create });
    expect(result.selected).toBe(2);
    expect(result.results).toHaveLength(2);
    expect(create).not.toHaveBeenCalled();
  });
});
