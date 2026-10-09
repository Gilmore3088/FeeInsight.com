import { beforeEach, describe, expect, it, vi } from "vitest";

const { paidModelCallMock, fetchAndRecordLinkMock, fetchAndRecordCompanionMock } = vi.hoisted(() => ({
  paidModelCallMock: vi.fn(),
  fetchAndRecordLinkMock: vi.fn(),
  fetchAndRecordCompanionMock: vi.fn(),
}));

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn(), getSql: vi.fn() }));
vi.mock("@/lib/agents/learning/attempts", () => ({ learningSchemaReady: vi.fn(async () => true) }));
vi.mock("@/lib/agents/document-vault", () => ({
  documentVaultSchemaReady: vi.fn(async () => true),
  getDocumentVault: vi.fn(() => ({ configured: true })),
}));
vi.mock("@/lib/agents/paid-pass", () => ({
  PAID_PASS_MODELS: { find: () => "test-model" },
  paidModelCall: paidModelCallMock,
}));
vi.mock("./companion-fetch", () => ({ fetchAndRecordCompanion: fetchAndRecordCompanionMock, COMPANION_FETCH_STRATEGY: { strategy: "fetch.companion", version: 1 } }));
vi.mock("./fetch", () => ({ fetchAndRecordLink: fetchAndRecordLinkMock, MAGELLAN_FETCH_STRATEGY: { strategy: "fetch.http", version: 2 } }));

import { ProviderBudgetBlockedError } from "@/lib/api-hardening/budget";
import { BLOCKED_COMPANION_FETCH_STRATEGY, BLOCKED_FETCH_STRATEGY, responseFromWebFetch, runBlockedFetch } from "./blocked-fetch";

type Message = Parameters<typeof responseFromWebFetch>[0];

function fetchResult(source: unknown): Message {
  return {
    content: [{
      type: "web_fetch_tool_result",
      tool_use_id: "t1",
      caller: { type: "direct" },
      content: { type: "web_fetch_result", url: "https://www.pnfp.com/fees", retrieved_at: null, content: { type: "document", citations: null, title: null, source } },
    }],
  } as unknown as Message;
}

describe("responseFromWebFetch", () => {
  it("turns fetched page text and PDFs into responses the fetch path stores", async () => {
    const page = responseFromWebFetch(fetchResult({ type: "text", media_type: "text/plain", data: "Overdraft fee $36" }));
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/plain");
    expect(await page.text()).toBe("Overdraft fee $36");
    const pdf = responseFromWebFetch(fetchResult({ type: "base64", media_type: "application/pdf", data: Buffer.from("%PDF-1.7 fees").toString("base64") }));
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await pdf.arrayBuffer()).toString()).toBe("%PDF-1.7 fees");
  });

  it("maps a refused fetch to 403 and a missing fetch to 502", () => {
    const refused = {
      content: [{ type: "web_fetch_tool_result", tool_use_id: "t1", caller: { type: "direct" }, content: { type: "web_fetch_tool_result_error", error_code: "url_not_accessible" } }],
    } as unknown as Message;
    expect(responseFromWebFetch(refused).status).toBe(403);
    expect(responseFromWebFetch(refused).statusText).toBe("web fetch error: url_not_accessible");
    const cutOff = responseFromWebFetch({ content: [], stop_reason: "max_tokens" } as unknown as Message);
    expect(cutOff.status).toBe(502);
    expect(cutOff.statusText).toBe("no web fetch (stop: max_tokens)");
  });
});

describe("runBlockedFetch", () => {
  const rows = [
    { id: 47, institution_name: "Pinnacle Bank", state_code: "TN", website_url: "https://www.pnfp.com", fee_schedule_url: "https://www.pnfp.com/personal-finance/deposit-accounts/checking/", asset_size: 50_000_000, last_crawl_at: null, consecutive_failures: 3 },
    { id: 8, institution_name: "Wrong Link CU", state_code: "TX", website_url: "https://wrong.example", fee_schedule_url: "https://www.lpl.com/disclosures/summary.pdf", asset_size: 5, last_crawl_at: null, consecutive_failures: 1 },
    { id: 9, institution_name: "Second Bank", state_code: "TN", website_url: "https://second.example", fee_schedule_url: "https://second.example/fees.pdf", asset_size: 1, last_crawl_at: null, consecutive_failures: 1 },
  ];
  const db = vi.fn(async (strings: TemplateStringsArray) => (strings.join("?").includes("companion pages blocked") ? [] : rows)) as unknown as NonNullable<Parameters<typeof runBlockedFetch>[0]["db"]>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchAndRecordLinkMock.mockResolvedValue({ result: { outcome: "success", attemptOutcome: "ok", reason: null }, sourceDocumentId: 1, supersededCopies: 0 });
  });

  it("fetches each refused link on the bank's own site once through the paid web fetch, on its own host only", async () => {
    paidModelCallMock.mockResolvedValue({ message: fetchResult({ type: "text", media_type: "text/plain", data: "Overdraft fee $36" }), costMicrousd: 1200 });
    const result = await runBlockedFetch({ runId: 5, db });
    expect(result).toMatchObject({ selected: 2, processed: 2, stored: 2, costMicrousd: 2400, budgetStopped: false });
    const tool = paidModelCallMock.mock.calls[0][0].params.tools[0];
    expect(tool).toMatchObject({ type: "web_fetch_20250910", name: "web_fetch", max_uses: 1, allowed_domains: ["pnfp.com"] });
    // Room for the tool call: at 64 tokens the model stopped before calling it.
    expect(paidModelCallMock.mock.calls[0][0].params.max_tokens).toBeGreaterThanOrEqual(512);
    const [, row, fetcher, ctx] = fetchAndRecordLinkMock.mock.calls[0];
    expect(row.id).toBe(47);
    expect(ctx).toMatchObject({ strategy: BLOCKED_FETCH_STRATEGY, costMicrousd: 1200, learning: true });
    expect(await (await fetcher()).text()).toBe("Overdraft fee $36");
  });

  it("stops at the budget cap without recording a fetch", async () => {
    paidModelCallMock.mockRejectedValue(new ProviderBudgetBlockedError("budget_run_cap_exhausted", "Magellan cap reached"));
    const result = await runBlockedFetch({ runId: 5, db });
    expect(result.budgetStopped).toBe(true);
    expect(result.processed).toBe(0);
    expect(fetchAndRecordLinkMock).not.toHaveBeenCalled();
  });

  it("gives the slots main links leave to blocked companion pages, stored as companions", async () => {
    const companion = { id: 2104, institution_id: 19, url: "https://www.53.com/content/dam/fifth-third/docs/legal/fees.pdf", document_role: "account_page", account_name: null, fetch_failures: 0, last_source_document_id: 20860, last_hash: "e4", website_url: "https://www.53.com" };
    const companionDb = vi.fn(async (strings: TemplateStringsArray) => (strings.join("?").includes("companion pages blocked") ? [companion] : [rows[0]])) as unknown as NonNullable<Parameters<typeof runBlockedFetch>[0]["db"]>;
    paidModelCallMock.mockResolvedValue({ message: fetchResult({ type: "base64", media_type: "application/pdf", data: Buffer.from("%PDF-1.7 fees").toString("base64") }), costMicrousd: 900 });
    fetchAndRecordCompanionMock.mockResolvedValue({ outcome: "success", attemptOutcome: "ok", reason: null });
    const result = await runBlockedFetch({ runId: 5, db: companionDb });
    expect(result).toMatchObject({ selected: 2, processed: 2, stored: 2, costMicrousd: 1800 });
    expect(paidModelCallMock.mock.calls[1][0].params.tools[0].allowed_domains).toEqual(["53.com"]);
    const [, row, , , ctx] = fetchAndRecordCompanionMock.mock.calls[0];
    expect(row.id).toBe(2104);
    expect(ctx).toMatchObject({ strategy: BLOCKED_COMPANION_FETCH_STRATEGY, costMicrousd: 900 });
    expect(result.results[1]).toMatchObject({ companion_source_id: 2104, outcome: "ok" });
  });

  it("only counts in a dry run", async () => {
    const result = await runBlockedFetch({ runId: 5, db, dryRun: true });
    expect(result.selected).toBe(2);
    expect(paidModelCallMock).not.toHaveBeenCalled();
  });
});

describe("selectBlockedLinks", () => {
  it("takes refused links and links that keep timing out, on the bank's own site", async () => {
    const { selectBlockedLinks, BLOCKED_TIMEOUT_MIN_FAILURES } = await import("./blocked-fetch");
    const texts: string[] = [];
    const values: unknown[][] = [];
    const db = vi.fn(async (strings: TemplateStringsArray, ...args: unknown[]) => {
      texts.push(strings.join("?"));
      values.push(args);
      return [
        { id: 37, institution_name: "First Horizon Bank", state_code: "TN", website_url: "https://www.firsthorizon.com", fee_schedule_url: "https://www.firsthorizon.com/Personal/Products-and-Services/Banking/Checking-Accounts/Account-and-Service-Fees", asset_size: 1, last_crawl_at: null, consecutive_failures: 4 },
      ];
    }) as unknown as Parameters<typeof selectBlockedLinks>[0];
    const rows = await selectBlockedLinks(db, 3);
    expect(rows.map((row) => row.id)).toEqual([37]);
    expect(texts[0]).toContain("plain.outcome = 'http_403'");
    // A refused connection (Centennial Bank) counts like a timeout.
    expect(texts[0]).toContain("plain.outcome IN ('timeout', 'network_error')");
    expect(values[0]).toContain(BLOCKED_TIMEOUT_MIN_FAILURES);
  });
});

describe("selectBlockedCompanions", () => {
  it("takes PDF links stored as web pages and pages refused or timing out, on the bank's own site or given by hand", async () => {
    const { selectBlockedCompanions } = await import("./blocked-fetch");
    const texts: string[] = [];
    const db = vi.fn(async (strings: TemplateStringsArray) => {
      texts.push(strings.join("?"));
      return [
        { id: 2104, institution_id: 19, url: "https://www.53.com/docs/fees.pdf", website_url: "https://www.53.com" },
        { id: 9, institution_id: 8, url: "https://www.lpl.com/disclosures/summary.pdf", website_url: "https://wrong.example" },
        {
          id: 2048, institution_id: 35, url: "https://www.amegybank.com/content/dam/zbna/scheduleoffeesconsut.pdf",
          website_url: "https://www.zionsbancorporation.com", found_by_strategy: "discover.operator_schedule",
        },
      ];
    }) as unknown as Parameters<typeof selectBlockedCompanions>[0];
    const rows = await selectBlockedCompanions(db, 3);
    // A schedule given by hand on a sister brand's site (Zions' Amegy) counts.
    expect(rows.map((row) => row.id)).toEqual([2104, 2048]);
    expect(texts[0]).toContain("ILIKE 'text/html%'");
    expect(texts[0]).toContain("'blocked_bot'");
    // A dormant bank's hand-found schedule is fetched too (Stock Yards); a closed charter's is not.
    expect(texts[0]).toContain("OR (inst.status = 'dormant' AND ias.found_by_strategy = 'discover.operator_schedule')");
    // A hand-found page goes to the paid fetch after one timeout; others after two.
    expect(texts[0]).toContain("WHEN plain.outcome = 'timeout' AND ias.found_by_strategy = ? THEN TRUE");
    // A hand-found page Rosetta read blank as built by JavaScript (Arvest's bot challenge).
    expect(texts[0].replace(/\s+/g, " ")).toContain(
      "OR (ias.status = 'rejected' AND ias.found_by_strategy = ? AND lower(COALESCE(ias.reason, '')) ~ 'built by javascript')",
    );
    // Hand-found pages jump the queue ahead of larger banks' pages.
    expect(texts[0]).toContain("ORDER BY (ias.found_by_strategy = ?) DESC NULLS LAST,");
    expect(await selectBlockedCompanions(db, 0)).toEqual([]);
  });
});
