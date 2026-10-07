import { describe, expect, it, vi } from "vitest";

const trackAnthropicRequest = vi.fn(async (_context: unknown, request: () => PromiseLike<unknown>) => request());
vi.mock("@/lib/ai-provider-usage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai-provider-usage")>()),
  trackAnthropicRequest: (context: unknown, request: () => PromiseLike<unknown>) => trackAnthropicRequest(context, request),
}));

import { runScheduleSearch, scheduleSearchPrompt, type ScheduleSearchRow } from "./schedule-search";

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
