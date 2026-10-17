import { describe, expect, it, vi } from "vitest";

const trackAnthropicRequest = vi.fn(async (_context: unknown, request: () => PromiseLike<unknown>) => request());
vi.mock("@/lib/ai-provider-usage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai-provider-usage")>()),
  trackAnthropicRequest: (context: unknown, request: () => PromiseLike<unknown>) => trackAnthropicRequest(context, request),
}));

import { FOUND_COOLDOWN_DAYS, MISS_COOLDOWN_DAYS } from "./cooldowns";
import { TOP_TEN_RETRY_DAYS } from "./top-ten-first";
import {
  GAP_FILL_CAP_DAYS,
  GAP_FILL_CAP_MICROUSD,
  GAP_FILL_PER_RUN,
  MAX_TRANSIENT_TRIES,
  runScheduleSearch,
  SCHEDULE_SEARCH_PER_RUN,
  scheduleSearchPrompt,
  type ScheduleSearchRow,
  UNCOVERED_SETTLE_DAYS,
} from "./schedule-search";

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

  // Uncovered (100s), covered priority (200s) and other covered (300s) rows; the gap-fill lane
  // takes priority names before the rest, inside one cap (#1030 on #1269's work lists).
  it.each([
    { name: "two priority gaps fill the gap cap", priority: 4, gapLimit: 2, picks: [3, 2, 0] },
    { name: "one priority gap, the rest from the other covered banks", priority: 1, gapLimit: 3, picks: [3, 1, 2] },
  ])("keeps each lane's own cap, uncovered first, and cuts each pool by requesters, then cells in turn: $name", async ({ priority, gapLimit, picks }) => {
    const pool = (from: number, count: number, extra: Partial<ScheduleSearchRow>) =>
      Array.from({ length: count }, (_, index) => ({ ...wells, id: from + index, state_code: index % 2 ? "VT" : "TX", ...extra }));
    const db = createDb([
      ...pool(100, 4, { uncovered: true, priority: false }),
      ...pool(200, priority, { uncovered: false, priority: true }),
      ...pool(300, 4, { uncovered: false, priority: false }),
    ]);
    const result = await runScheduleSearch({ runId: 4, dryRun: true, limit: 3, gapLimit, db: asDb(db), create: vi.fn() });
    const ids = result.results.map((entry) => Number(entry.institution_id));
    expect([1, 2, 3].map((hundred) => ids.filter((id) => Math.floor(id / 100) === hundred).length)).toEqual(picks);
    // Uncovered rows come first, and the work lists rotate states inside the lane.
    expect(result.results.slice(0, 3).map((entry) => entry.lane)).toEqual(["uncovered", "uncovered", "uncovered"]);
    expect(new Set(ids.slice(0, 2).map((id) => (id % 2 ? "VT" : "TX"))).size).toBe(2);
    const select = text(db.mock.calls.find((call) => text(call[0]).includes("incomplete-link schedule search"))![0]);
    expect(select).toContain("PARTITION BY pool_lane ORDER BY requested DESC, paying DESC, top_ten DESC, leader DESC, cell_rank ASC");
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

describe("institutions without live fees come first (#1030)", () => {
  const pinnacle: ScheduleSearchRow = {
    id: 31, institution_name: "Pinnacle Community Credit Union", city: "Fargo", state_code: "ND", website_url: "https://www.pinnaclecu.org",
    fee_schedule_url: "https://www.pinnaclecu.org/checking/", asset_size: "90000", requested: false, uncovered: true,
    business_only: false, no_overdraft_price: true, refers_elsewhere: false,
  };
  const selection = (db: DbMock) => db.mock.calls.find((c) => text(c[0]).includes("incomplete-link schedule search"))!;
  const attempts = (db: DbMock) => db.mock.calls.filter((call) => text(call[0]).includes("INSERT INTO pipeline_attempts"));
  const detailOf = (call: unknown[]) => JSON.parse(String(call.find((value) => typeof value === "string" && value.startsWith("{\"pass\""))));
  const reasonOf = (call: unknown[]) => String(call.find((value) => typeof value === "string" && value.startsWith("Paid schedule search")));

  it("ranks an uncovered institution above a covered one, whatever their size", async () => {
    const db = createDb([]);
    await runScheduleSearch({ runId: 4, db: asDb(db), create: vi.fn(), leaderIds: [] });
    const sqlText = text(selection(db)[0]);
    // A bank counts as uncovered with no live fee record at all, once its held copy is a few days old.
    expect(sqlText).toContain("COALESCE(live.categories, 0) = 0 AS uncovered");
    expect(sqlText).toContain("(uncovered AND settled AND NOT companion_waiting)");
    // A free find in the same days (a #1327 re-search) is read before a paid search runs.
    expect(sqlText).toMatch(/AND NOT EXISTS \(\s*SELECT 1 FROM pipeline_attempts found[\s\S]*found\.outcome = 'ok'[\s\S]*\) AS settled/);
    // Each pool is cut on its own; uncovered rows are never mixed into a covered pool.
    expect(sqlText).toContain("CASE WHEN uncovered THEN 'uncovered' WHEN priority THEN 'gap_priority' ELSE 'gap_other' END AS pool_lane");
    // Gap-filling is only for banks that already have live fees.
    expect(sqlText).toContain("(NOT uncovered AND priority AND (business_only OR no_overdraft_price OR refers_elsewhere OR stale_copy OR hidden))");
    expect(selection(db).slice(1)).toContain(UNCOVERED_SETTLE_DAYS);
  });

  it("searches a state top-10 slot holder with nothing live first, and once a week with the three-document ask it never had", async () => {
    const topTen = { ...pinnacle, id: 41, institution_name: "Aloha Pacific Federal Credit Union", state_code: "HI", top_ten: true, top_ten_retry: true };
    const db = createDb([{ ...pinnacle }, topTen]);
    const create = vi.fn().mockResolvedValue(answer({ fee_schedule: null, truth_in_savings: null, account_agreement: null }));
    await runScheduleSearch({ runId: 4, db: asDb(db), create, leaderIds: [], topTenIds: [41], fetchImpl: serve(SCHEDULE) });

    const select = selection(db);
    const sqlText = text(select[0]);
    // Off the cooldown, or on the weekly try: only uncovered, only while no try in the cooldown
    // used the three-document ask, at most once in TOP_TEN_RETRY_DAYS, never inside a find's 90 days.
    expect(sqlText).toContain("AND (NOT cooled.on_cooldown OR retry.early)");
    expect(sqlText).toContain("pa.detail->>'lane' = 'uncovered'");
    expect(sqlText).toContain("(cooled.on_cooldown AND retry.early) AS top_ten_retry");
    expect(sqlText).toContain("PARTITION BY pool_lane ORDER BY requested DESC, paying DESC, top_ten DESC, leader DESC");
    expect(select.slice(1)).toContain(TOP_TEN_RETRY_DAYS);
    expect(select.slice(1)).toContainEqual([41]);
    // The few-timeouts cap still applies to the weekly try.
    expect(select.slice(1)).toContain(MAX_TRANSIENT_TRIES);

    expect(String(create.mock.calls[0][0].messages[0].content)).toContain("Aloha Pacific");
    const logged = attempts(db).map(detailOf);
    expect(logged[0]).toMatchObject({ lane: "uncovered", top_ten: true, top_ten_retry: true });
    expect(logged[1]).not.toHaveProperty("top_ten");
  });

  it("asks for the fee schedule, the Truth in Savings disclosure and the deposit account agreement", () => {
    const prompt = scheduleSearchPrompt(pinnacle);
    expect(prompt).toContain("fee_schedule: the fee schedule");
    expect(prompt).toContain("truth_in_savings: the Truth in Savings disclosure");
    expect(prompt).toContain("account_agreement: the deposit account agreement");
    expect(prompt).toContain("we could read no fees from it");
    expect(prompt).toContain("\"truth_in_savings\": string | null, \"account_agreement\": string | null");
    // The gap-fill ask is unchanged: one consumer schedule.
    expect(scheduleSearchPrompt(wells)).toContain("{\"url\": string | null");
  });

  it("stores each document the search finds as its own companion, and checks a repeated URL once", async () => {
    const db = createDb([pinnacle]);
    const create = vi.fn().mockResolvedValueOnce(answer({
      fee_schedule: "https://www.pinnaclecu.org/fee-schedule/",
      truth_in_savings: "https://www.pinnaclecu.org/truth-in-savings/",
      account_agreement: "https://www.pinnaclecu.org/fee-schedule/",
    }));
    const fetchImpl = serve(SCHEDULE);
    const result = await runScheduleSearch({ runId: 4, db: asDb(db), create, fetchImpl, leaderIds: [] });
    expect(result).toMatchObject({ selected: 1, processed: 1, found: 1, documents: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // A small credit union is searched on its own site only (#1035, #1251), for all three documents.
    const params = create.mock.calls[0][0];
    expect(params.tools[0].allowed_domains).toEqual(["pinnaclecu.org"]);
    expect(String(params.messages[0].content)).toContain("- Each URL must be on the bank's own site (pinnaclecu.org");
    const inserted = companions(db);
    expect(inserted).toHaveLength(2);
    expect(inserted[0]).toContain("https://www.pinnaclecu.org/fee-schedule/");
    expect(inserted[1]).toContain("https://www.pinnaclecu.org/truth-in-savings/");
    expect(reasonOf(inserted[1])).toContain("Truth in Savings disclosure");
    const detail = detailOf(attempts(db)[0]);
    expect(detail).toMatchObject({ lane: "uncovered", url: "https://www.pinnaclecu.org/fee-schedule/" });
    expect(detail.documents.map((document: { kind: string }) => document.kind)).toEqual(["fee_schedule", "truth_in_savings"]);
    expect(result.results[0]).toMatchObject({ lane: "uncovered", outcome: "ok" });
  });

  it("keeps the documents that pass when another answer is off the bank's domain", async () => {
    const db = createDb([pinnacle]);
    const create = vi.fn().mockResolvedValueOnce(answer({
      fee_schedule: "https://www.nerdwallet.com/pinnacle-fees",
      truth_in_savings: null,
      account_agreement: "https://www.pinnaclecu.org/membership-agreement.html",
    }));
    const result = await runScheduleSearch({ runId: 4, db: asDb(db), create, fetchImpl: serve(SCHEDULE), leaderIds: [] });
    expect(result).toMatchObject({ found: 1, documents: 1 });
    expect(companions(db)).toHaveLength(1);
    const detail = detailOf(attempts(db)[0]);
    expect(detail.documents.map((document: { outcome: string }) => document.outcome)).toEqual(["invalid_url", "ok"]);
  });

  it("records a miss when the search finds none of the three", async () => {
    const db = createDb([pinnacle]);
    const create = vi.fn().mockResolvedValueOnce(answer({ fee_schedule: null, truth_in_savings: null, account_agreement: null }));
    const result = await runScheduleSearch({ runId: 4, db: asDb(db), create, leaderIds: [] });
    expect(result.results[0]).toMatchObject({ outcome: "no_candidates", lane: "uncovered" });
    expect(companions(db)).toHaveLength(0);
  });
});

describe("gap-filling for covered banks runs on its own small cap (#1030)", () => {
  const spentDb = (spent: number, rows: ScheduleSearchRow[] = []): DbMock =>
    vi.fn((strings: TemplateStringsArray) => {
      const sqlText = text(strings);
      if (sqlText.includes("gap-fill lane spend")) return Promise.resolve([{ spent }]);
      if (sqlText.includes("incomplete-link schedule search")) return Promise.resolve(rows);
      return Promise.resolve([]);
    });

  it.each([
    { spent: 0, covered: GAP_FILL_PER_RUN },
    { spent: GAP_FILL_CAP_MICROUSD, covered: 0 },
  ])("takes $covered covered banks a step after $spent spent; the uncovered lane keeps its limit", async ({ spent, covered }) => {
    const rows = [
      ...Array.from({ length: SCHEDULE_SEARCH_PER_RUN + 2 }, (_, index) => ({ ...wells, id: 100 + index, uncovered: true })),
      ...Array.from({ length: GAP_FILL_PER_RUN + 2 }, (_, index) => ({ ...wells, id: 300 + index, uncovered: false, priority: true })),
    ];
    const db = spentDb(spent, rows);
    const result = await runScheduleSearch({ runId: 4, dryRun: true, db: asDb(db), create: vi.fn(), leaderIds: [] });
    const lanes = result.results.map((entry) => entry.lane);
    expect([lanes.filter((lane) => lane === "uncovered").length, lanes.filter((lane) => lane === "gap_fill").length]).toEqual([SCHEDULE_SEARCH_PER_RUN, covered]);
    const spendCall = db.mock.calls.find((c) => text(c[0]).includes("gap-fill lane spend"))!;
    expect(text(spendCall[0])).toContain("pa.detail->>'lane' = 'gap_fill'");
    expect(spendCall.slice(1)).toContain(GAP_FILL_CAP_DAYS);
  });

  it("stops gap-filling within a step when a search takes the lane past its cap", async () => {
    const second = { ...wells, id: 10, institution_name: "Second Bank" };
    const db = spentDb(GAP_FILL_CAP_MICROUSD - 1, [wells, second]);
    const create = vi.fn().mockResolvedValue(answer({ url: null }));
    const result = await runScheduleSearch({ runId: 4, db: asDb(db), create, leaderIds: [] });
    expect(create).toHaveBeenCalledTimes(1);
    expect(result.processed).toBe(1);
    expect(result.results[1]).toMatchObject({ institution_id: 10, outcome: "skipped", lane: "gap_fill" });
  });
});
