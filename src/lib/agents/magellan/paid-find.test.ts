import { describe, expect, it, vi } from "vitest";

const trackAnthropicRequest = vi.fn(async (_context: unknown, request: () => PromiseLike<unknown>) => request());
vi.mock("@/lib/ai-provider-usage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai-provider-usage")>()),
  trackAnthropicRequest: (context: unknown, request: () => PromiseLike<unknown>) => trackAnthropicRequest(context, request),
}));

import { ProviderBudgetBlockedError } from "@/lib/api-hardening/budget";

import { DISCOVERY_METHOD_VERSION } from "./discovery";
import { onBankDomain, PAID_FIND_STRATEGY, runMagellanPaidFind } from "./paid-find";

type DbMock = ReturnType<typeof vi.fn>;

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

const banks = [
  { id: 1, institution_name: "Alpha Bank", city: "Burlington", state_code: "VT", website_url: "https://www.alpha.example" },
  { id: 2, institution_name: "Beta Bank", city: "Rutland", state_code: "VT", website_url: "https://beta.example" },
  { id: 3, institution_name: "Gamma Bank", city: "Barre", state_code: "VT", website_url: "https://gamma.example" },
];

function createDb(rows = banks): DbMock {
  return vi.fn((strings: TemplateStringsArray) => {
    const text = templateText(strings);
    if (text.includes("learning_schema_ready")) return Promise.resolve([{ learning_schema_ready: true }]);
    if (text.includes("inst.city")) return Promise.resolve(rows);
    return Promise.resolve([]);
  });
}

const asDb = (db: DbMock) => db as unknown as NonNullable<Parameters<typeof runMagellanPaidFind>[0]["db"]>;

const answer = (json: Record<string, unknown>) =>
  ({
    content: [{ type: "text", text: `Here is what I found:\n${JSON.stringify(json)}` }],
    usage: { input_tokens: 2000, output_tokens: 200, server_tool_use: { web_search_requests: 2 } },
  }) as never;

const FEE_TABLE = "<table><tr><td>Overdraft fee</td><td>$32.00</td></tr><tr><td>Stop payment</td><td>$35.00</td></tr>" +
  "<tr><td>Monthly maintenance fee</td><td>$12.00</td></tr></table>";

function attempts(db: DbMock) {
  return db.mock.calls
    .filter((call) => templateText(call[0]).includes("INSERT INTO pipeline_attempts"))
    .map((call) => ({ institutionId: call[1], strategy: call[4], outcome: call[7], cost: call[9], detail: JSON.parse(String(call[13])) }));
}

describe("Magellan paid find (pass 3)", () => {
  it("selects only banks every free finder missed with the current method, once a month", async () => {
    const db = createDb([]);
    await runMagellanPaidFind({ runId: 1, stateCode: "vt", db: asDb(db), create: vi.fn() });
    const select = db.mock.calls.find((call) => templateText(call[0]).includes("inst.city"))!;
    const text = templateText(select[0]);
    expect(text).toContain("inst.rescue_status = 'dead'");
    expect(text).toContain("pa.detail @>");
    expect(text).toContain("date_trunc('month', NOW())");
    expect(select).toContain(JSON.stringify({ method_version: DISCOVERY_METHOD_VERSION }));
    expect(select).toContain(PAID_FIND_STRATEGY.strategy);
    expect(select).toContain("VT");
  });

  it("asks once per bank with web search, validates the answer, and stores only real fee schedules", async () => {
    const db = createDb();
    const create = vi
      .fn()
      .mockResolvedValueOnce(answer({ url: "https://alpha.example/disclosures/fees", confidence: 0.9, evidence: "Linked from Disclosures" }))
      .mockResolvedValueOnce(answer({ url: "https://beta.example/rates", confidence: 0.4 }))
      .mockResolvedValueOnce(answer({ url: "https://other-site.example/gamma-fees.pdf", confidence: 0.5 }));
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("alpha")
        ? new Response(FEE_TABLE, { headers: { "content-type": "text/html" } })
        : new Response("<h1>Rates</h1><p>Savings 0.50% APY</p>", { headers: { "content-type": "text/html" } }),
    );

    const result = await runMagellanPaidFind({ runId: 9, stepId: 4, stateCode: "VT", db: asDb(db), create, fetchImpl });

    expect(result).toMatchObject({ selected: 3, processed: 3, succeeded: 1, failed: 2, budgetStopped: false });
    expect(result.costMicrousd).toBeGreaterThan(0);
    const params = create.mock.calls[0][0];
    expect(params.tools).toEqual([{ type: "web_search_20250305", name: "web_search", max_uses: 3 }]);
    expect(params.messages[0].content).toContain("Alpha Bank");
    expect(params.messages[0].content).toContain("Burlington, VT");
    expect(trackAnthropicRequest).toHaveBeenCalledWith(expect.objectContaining({ agent: "magellan", operation: "paid_find", agentRunId: 9 }), expect.any(Function));
    // The off-domain answer is never opened.
    expect(fetchImpl.mock.calls.map((call) => String(call[0]))).not.toContain("https://other-site.example/gamma-fees.pdf");

    const logged = attempts(db);
    expect(logged.map((attempt) => [attempt.institutionId, attempt.outcome])).toEqual([
      [1, "ok"],
      [2, "wrong_document"],
      [3, "invalid_url"],
    ]);
    expect(logged.every((attempt) => attempt.strategy === PAID_FIND_STRATEGY.strategy && Number(attempt.cost) > 0)).toBe(true);
    expect(logged[0].detail).toMatchObject({ pass: 3, url: "https://alpha.example/disclosures/fees" });
    const stored = db.mock.calls.filter((call) => templateText(call[0]).includes("UPDATE institution_sources"));
    expect(stored).toHaveLength(1);
    expect(stored[0]).toContain("https://alpha.example/disclosures/fees");
  });

  it("stops cleanly at the budget cap without logging the unspent bank", async () => {
    const db = createDb();
    const create = vi
      .fn()
      .mockResolvedValueOnce(answer({ url: null }))
      .mockRejectedValueOnce(new ProviderBudgetBlockedError("budget_monthly_exhausted", "Magellan monthly cap reached"));

    const result = await runMagellanPaidFind({ runId: 10, db: asDb(db), create, fetchImpl: vi.fn() });

    expect(result).toMatchObject({ processed: 1, failed: 1, budgetStopped: true, budgetReason: "Magellan monthly cap reached" });
    expect(create).toHaveBeenCalledTimes(2);
    expect(attempts(db).map((attempt) => attempt.outcome)).toEqual(["no_candidates"]);
  });

  it("dry runs list the banks without calling the model", async () => {
    const db = createDb();
    const create = vi.fn();
    const result = await runMagellanPaidFind({ runId: 11, dryRun: true, db: asDb(db), create });
    expect(create).not.toHaveBeenCalled();
    expect(result).toMatchObject({ selected: 3, processed: 0, dryRun: true });
  });

  it("accepts only the bank's own domain or its subdomains", () => {
    expect(onBankDomain("https://docs.alpha.example/fees.pdf", "www.alpha.example")).toBe(true);
    expect(onBankDomain("https://alpha.example.evil.example/fees.pdf", "alpha.example")).toBe(false);
    expect(onBankDomain("ftp://alpha.example/fees.pdf", "alpha.example")).toBe(false);
  });
});
