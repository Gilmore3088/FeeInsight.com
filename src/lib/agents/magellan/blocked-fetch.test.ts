import { beforeEach, describe, expect, it, vi } from "vitest";

const { paidModelCallMock, fetchAndRecordLinkMock } = vi.hoisted(() => ({
  paidModelCallMock: vi.fn(),
  fetchAndRecordLinkMock: vi.fn(),
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
vi.mock("./fetch", () => ({ fetchAndRecordLink: fetchAndRecordLinkMock }));

import { ProviderBudgetBlockedError } from "@/lib/api-hardening/budget";
import { BLOCKED_FETCH_STRATEGY, responseFromWebFetch, runBlockedFetch } from "./blocked-fetch";

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
    expect(responseFromWebFetch({ content: [] } as unknown as Message).status).toBe(502);
  });
});

describe("runBlockedFetch", () => {
  const rows = [
    { id: 47, institution_name: "Pinnacle Bank", state_code: "TN", website_url: "https://www.pnfp.com", fee_schedule_url: "https://www.pnfp.com/personal-finance/deposit-accounts/checking/", asset_size: 50_000_000, last_crawl_at: null, consecutive_failures: 3 },
    { id: 8, institution_name: "Wrong Link CU", state_code: "TX", website_url: "https://wrong.example", fee_schedule_url: "https://www.lpl.com/disclosures/summary.pdf", asset_size: 5, last_crawl_at: null, consecutive_failures: 1 },
    { id: 9, institution_name: "Second Bank", state_code: "TN", website_url: "https://second.example", fee_schedule_url: "https://second.example/fees.pdf", asset_size: 1, last_crawl_at: null, consecutive_failures: 1 },
  ];
  const db = vi.fn(async () => rows) as unknown as NonNullable<Parameters<typeof runBlockedFetch>[0]["db"]>;

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

  it("only counts in a dry run", async () => {
    const result = await runBlockedFetch({ runId: 5, db, dryRun: true });
    expect(result.selected).toBe(2);
    expect(paidModelCallMock).not.toHaveBeenCalled();
  });
});
