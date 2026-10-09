import { describe, expect, it, vi } from "vitest";

const trackAnthropicRequest = vi.fn(async (_context: unknown, request: () => PromiseLike<unknown>) => request());
vi.mock("@/lib/ai-provider-usage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai-provider-usage")>()),
  trackAnthropicRequest: (context: unknown, request: () => PromiseLike<unknown>) => trackAnthropicRequest(context, request),
}));

import { runScheduleSearch, scheduleSearchPrompt, type ScheduleSearchRow, MAX_TRANSIENT_TRIES } from "./schedule-search";

type DbMock = ReturnType<typeof vi.fn>;
const text = (strings: unknown) => (Array.isArray(strings) ? strings.join(" ") : String(strings));

const wells: ScheduleSearchRow = {
  id: 9, institution_name: "Wells Fargo Bank", city: "Sioux Falls", state_code: "SD", website_url: "https://www.wellsfargo.com",
  fee_schedule_url: "https://www.wellsfargo.com/checking/clear-access-banking/", asset_size: "1700000000",
  requested: false, business_only: false, no_overdraft_price: true, refers_elsewhere: false,
};

function createDb(rows: ScheduleSearchRow[], known: string[] = []): DbMock {
  return vi.fn((strings: TemplateStringsArray) => {
    const sqlText = text(strings);
    if (sqlText.includes("incomplete-link schedule search")) return Promise.resolve(rows);
    if (sqlText.includes("UNION")) return Promise.resolve(known.map((url) => ({ url })));
    return Promise.resolve([]);
  });
}
const asDb = (db: DbMock) => db as unknown as NonNullable<Parameters<typeof runScheduleSearch>[0]["db"]>;
const answer = (json: Record<string, unknown>) =>
  ({ content: [{ type: "text", text: JSON.stringify(json) }], usage: { input_tokens: 1500, output_tokens: 100, server_tool_use: { web_search_requests: 1 } } }) as never;
const SCHEDULE = `<html><body><main><h1>Consumer Account Fee and Information Schedule</h1>
<p>Overdraft fee $35.00 per item</p><p>Stop payment $31.00</p><p>Outgoing domestic wire $30.00</p>
<p>Cashier's check $10.00</p><p>Monthly service fee $10.00</p></main></body></html>`;
const serve = (html: string) => vi.fn(async () => new Response(html, { status: 200, headers: { "content-type": "text/html" } }));
const companions = (db: DbMock) => db.mock.calls.filter((call) => text(call[0]).includes("INSERT INTO institution_additional_sources"));

describe("paid schedule search for the largest banks", () => {
  it("sends SQL with no comparison left without its right-hand side", async () => {
    // PR 314 shipped `btrim(...) <>` with its '' lost, and every paid discovery step failed.
    const db = createDb([]);
    await runScheduleSearch({ runId: 4, db: asDb(db), create: vi.fn() });
    const statements = db.mock.calls.map((call) => (call[0] as unknown as string[]).join("$?"));
    expect(statements.some((sqlText) => sqlText.includes("incomplete-link schedule search"))).toBe(true);
    for (const sqlText of statements) {
      expect(sqlText).not.toMatch(/(<>|<=|>=|=|<|>)\s*(\n\s*(AND|OR|\))|$)/);
    }
  });

  it("tells the model why the page we hold is not the schedule", () => {
    expect(scheduleSearchPrompt(wells)).toContain("does not list the overdraft or NSF fee amount");
    expect(scheduleSearchPrompt({ ...wells, business_only: true })).toContain("business account schedule");
    expect(scheduleSearchPrompt({ ...wells, no_overdraft_price: false, stale_copy: true })).toContain("current edition");
    expect(scheduleSearchPrompt({ ...wells, product_page: true })).toContain("account product page");
    expect(scheduleSearchPrompt({ ...wells, no_overdraft_price: false, hidden: true })).toContain("fewer than three fees");
  });

  it("keeps a schedule that passes the fee-page check as a companion, beside the bank's link", async () => {
    const db = createDb([wells]);
    const create = vi.fn().mockResolvedValueOnce(answer({ url: "https://www.wellsfargo.com/fee-information/consumer-schedule/" }));
    const result = await runScheduleSearch({ runId: 4, db: asDb(db), create, fetchImpl: serve(SCHEDULE) });
    expect(result).toMatchObject({ selected: 1, processed: 1, found: 1 });
    const inserted = companions(db);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toContain("https://www.wellsfargo.com/fee-information/consumer-schedule/");
    expect(text(inserted[0][0])).toContain("'consumer_supplement'");
    expect(db.mock.calls.some((call) => text(call[0]).includes("UPDATE institution_sources"))).toBe(false);
  });

  it("keeps an answer the bank's site refuses to show us (HTTP 403) for the paid fetch", async () => {
    const db = createDb([wells]);
    const create = vi.fn().mockResolvedValueOnce(answer({ url: "https://www.wellsfargo.com/fee-schedule.pdf" }));
    const refused = vi.fn(async () => new Response("Forbidden", { status: 403, headers: { "content-type": "text/html" } }));
    const result = await runScheduleSearch({ runId: 4, db: asDb(db), create, fetchImpl: refused });
    expect(result.results[0]).toMatchObject({ outcome: "ok", url: "https://www.wellsfargo.com/fee-schedule.pdf" });
    expect(companions(db)[0]).toContain("pdf");
  });

  it("rejects another domain, a business schedule and a document the bank already has", async () => {
    const offDomain = createDb([wells]);
    await runScheduleSearch({ runId: 4, db: asDb(offDomain), create: vi.fn().mockResolvedValueOnce(answer({ url: "https://www.nerdwallet.com/wells" })) });
    expect(companions(offDomain)).toHaveLength(0);

    const business = createDb([wells]);
    const r2 = await runScheduleSearch({
      runId: 4, db: asDb(business), create: vi.fn().mockResolvedValueOnce(answer({ url: "https://www.wellsfargo.com/business-fee-schedule.pdf" })), fetchImpl: serve(SCHEDULE),
    });
    expect(r2.results[0]).toMatchObject({ outcome: "wrong_document" });
    expect(companions(business)).toHaveLength(0);

    const known = createDb([wells], ["https://www.wellsfargo.com/fees.pdf"]);
    const r3 = await runScheduleSearch({ runId: 4, db: asDb(known), create: vi.fn().mockResolvedValueOnce(answer({ url: "https://www.wellsfargo.com/fees.pdf" })) });
    expect(r3.results[0]).toMatchObject({ outcome: "rejected" });
  });

  it("dry runs list the banks without calling the model", async () => {
    const create = vi.fn();
    const result = await runScheduleSearch({ runId: 4, dryRun: true, db: asDb(createDb([wells])), create });
    expect(result.selected).toBe(1);
    expect(result.results[0]).toMatchObject({ would_search_schedule: true });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("market leaders in the priority lane", () => {
  it("treats each state's top 15 as priority, hidden or not", async () => {
    const db = createDb([]);
    await runScheduleSearch({ runId: 4, db: asDb(db), create: vi.fn(), leaderIds: [17, 42] });
    const call = db.mock.calls.find((c) => text(c[0]).includes("incomplete-link schedule search"));
    expect(call).toBeDefined();
    const sqlText = text(call![0]);
    expect(sqlText).toContain("::bigint[]) AS leader");
    expect(sqlText).toMatch(/priority AND \(business_only OR no_overdraft_price OR refers_elsewhere OR stale_copy OR hidden\)/);
    expect(call!.slice(1)).toContainEqual([17, 42]);
  });

  it("still searches by size when the ranking fails", async () => {
    const db = vi.fn((strings: TemplateStringsArray) => {
      const sqlText = text(strings);
      if (sqlText.includes("market leaders by state")) return Promise.reject(new Error("timeout"));
      return Promise.resolve([]);
    });
    const result = await runScheduleSearch({ runId: 4, db: asDb(db), create: vi.fn() });
    expect(result.selected).toBe(0);
    const call = db.mock.calls.find((c) => text(c[0]).includes("incomplete-link schedule search"));
    expect(call!.slice(1)).toContainEqual([]);
  });
});

describe("banks whose answer never opens", () => {
  it("stops paying for a bank after a few timeouts in a month", async () => {
    const db = createDb([]);
    await runScheduleSearch({ runId: 4, db: asDb(db), create: vi.fn(), leaderIds: [] });
    const call = db.mock.calls.find((c) => text(c[0]).includes("incomplete-link schedule search"));
    expect(text(call![0])).toMatch(/AND pa\.outcome <> 'budget_blocked'\s*\)\s*<\s*$/m);
    expect(call!.slice(1)).toContain(MAX_TRANSIENT_TRIES);
  });
});
