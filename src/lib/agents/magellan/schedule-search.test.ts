import { describe, expect, it, vi } from "vitest";

const trackAnthropicRequest = vi.fn(async (_context: unknown, request: () => PromiseLike<unknown>) => request());
vi.mock("@/lib/ai-provider-usage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai-provider-usage")>()),
  trackAnthropicRequest: (context: unknown, request: () => PromiseLike<unknown>) => trackAnthropicRequest(context, request),
}));

import { FOUND_COOLDOWN_DAYS, MISS_COOLDOWN_DAYS } from "./cooldowns";
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
    // Identifier calls (`db("priority")`) carry a plain string, not SQL text.
    const statements = db.mock.calls.filter((call) => Array.isArray(call[0])).map((call) => (call[0] as unknown as string[]).join("$?"));
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

  it("keeps each lane's own cap, and cuts each lane's pool by requesters, then cells in turn (#1269)", async () => {
    const lane = (priority: boolean, from: number) => Array.from({ length: 4 }, (_, index) => ({ ...wells, id: from + index, state_code: index % 2 ? "VT" : "TX", priority }));
    const db = createDb([...lane(true, 100), ...lane(false, 200)]);
    const result = await runScheduleSearch({ runId: 4, dryRun: true, limit: 3, hiddenLimit: 2, db: asDb(db), create: vi.fn() });
    const ids = result.results.map((entry) => Number(entry.institution_id));
    expect([ids.filter((id) => id < 200).length, ids.filter((id) => id >= 200).length]).toEqual([3, 2]);
    const select = text(db.mock.calls.find((call) => text(call[0]).includes("incomplete-link schedule search"))![0]);
    expect(select).toContain("PARTITION BY priority ORDER BY requested DESC, paying DESC, leader DESC, cell_rank ASC");
  });

  it("searches a small bank on its own sites only, and never sends it to a parent company's domain (#1251)", async () => {
    const cashmere: ScheduleSearchRow = {
      ...wells, id: 12, institution_name: "Cashmere Valley Bank", city: "Cashmere", state_code: "WA",
      website_url: "https://www.cashmerevalleybank.com", fee_schedule_url: "https://www.cashmerevalleybank.com/checking", asset_size: "2300000",
    };
    const db = vi.fn((strings: TemplateStringsArray) => {
      const sqlText = text(strings);
      if (sqlText.includes("incomplete-link schedule search")) return Promise.resolve([cashmere]);
      if (sqlText.includes("bank-owned document hosts")) return Promise.resolve([{ institution_id: 12, host: "cvb.bank", documents: 2 }]);
      return Promise.resolve([]);
    });
    const create = vi.fn().mockResolvedValueOnce(answer({ url: "https://www.cvb.bank/personal-fee-schedule" }));
    const named = SCHEDULE.replace("<h1>Consumer Account", "<p>Cashmere Valley Bank</p><h1>Consumer Account");
    const result = await runScheduleSearch({ runId: 4, db: asDb(db), create, fetchImpl: serve(named) });

    const params = create.mock.calls[0][0];
    expect(params.tools[0].allowed_domains).toEqual(["cashmerevalleybank.com", "cvb.bank"]);
    const prompt = String(params.messages[0].content);
    expect(prompt).not.toContain("parent company");
    expect(prompt).toContain("cashmerevalleybank.com or cvb.bank");
    expect(result.results[0]).toMatchObject({ outcome: "ok", url: "https://www.cvb.bank/personal-fee-schedule" });
    // A $10B+ bank keeps the open web and may still use a parent company's domain.
    expect(scheduleSearchPrompt(wells)).toContain("parent company's domain");

    // The same answer is refused when the document does not name the bank (#1033's rule, now
    // applied to paid answers), and when the host refuses our check, since it can't be read.
    const unnamed = vi.fn().mockResolvedValueOnce(answer({ url: "https://www.cvb.bank/personal-fee-schedule" }));
    const r2 = await runScheduleSearch({ runId: 4, db: asDb(db), create: unnamed, fetchImpl: serve(SCHEDULE) });
    expect(r2.results[0]).toMatchObject({ outcome: "wrong_document", url: null });
    const refused = vi.fn().mockResolvedValueOnce(answer({ url: "https://www.cvb.bank/personal-fee-schedule.pdf" }));
    const r3 = await runScheduleSearch({
      runId: 4, db: asDb(db), create: refused, fetchImpl: vi.fn(async () => new Response("Forbidden", { status: 403, headers: { "content-type": "text/html" } })),
    });
    expect(r3.results[0]).toMatchObject({ url: null });
    expect(r3.results[0].outcome).not.toBe("ok");
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
  it("stops paying for a bank after a few timeouts in the miss cooldown", async () => {
    const db = createDb([]);
    await runScheduleSearch({ runId: 4, db: asDb(db), create: vi.fn(), leaderIds: [] });
    const call = db.mock.calls.find((c) => text(c[0]).includes("incomplete-link schedule search"));
    expect(text(call![0])).toMatch(/AND pa\.outcome <> 'budget_blocked'\s*\)\s*<\s*$/m);
    expect(call!.slice(1)).toContain(MAX_TRANSIENT_TRIES);
  });

  it("counts its cooldown from the last try, 90 days after a find and 30 after a miss (#1031)", async () => {
    const db = createDb([]);
    await runScheduleSearch({ runId: 4, db: asDb(db), create: vi.fn(), leaderIds: [] });
    const call = db.mock.calls.find((c) => text(c[0]).includes("incomplete-link schedule search"));
    expect(text(call![0])).not.toContain("date_trunc('month'");
    expect(text(call![0])).toContain("CASE WHEN pa.outcome = 'ok' THEN");
    expect(call!.slice(1)).toContain(FOUND_COOLDOWN_DAYS);
    expect(call!.slice(1)).toContain(MISS_COOLDOWN_DAYS);
  });
});
