import { describe, expect, it, vi } from "vitest";

const trackAnthropicRequest = vi.fn(async (_context: unknown, request: () => PromiseLike<unknown>) => request());
vi.mock("@/lib/ai-provider-usage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai-provider-usage")>()),
  trackAnthropicRequest: (context: unknown, request: () => PromiseLike<unknown>) => trackAnthropicRequest(context, request),
}));

import { ProviderBudgetBlockedError } from "@/lib/api-hardening/budget";

import { FOUND_COOLDOWN_DAYS, MISS_COOLDOWN_DAYS } from "./cooldowns";
import { DISCOVERY_METHOD_VERSION } from "./discovery";
import { NOT_ONLINE_AFTER_MISSES, NOT_ONLINE_RETRY_DAYS } from "./escalation";
import { onBankDomain, PAID_FIND_STRATEGY, PAID_PICK_STRATEGY, runMagellanPaidFind } from "./paid-find";

type DbMock = ReturnType<typeof vi.fn>;

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

const banks = [
  { id: 1, institution_name: "Alpha Bank", city: "Burlington", state_code: "VT", website_url: "https://www.alpha.example", asset_size: "250000" },
  { id: 2, institution_name: "Beta Bank", city: "Rutland", state_code: "VT", website_url: "https://beta.example", asset_size: "180000" },
  { id: 3, institution_name: "Gamma Bank", city: "Barre", state_code: "VT", website_url: "https://gamma.example", asset_size: "120000" },
];

function createDb(rows: Array<(typeof banks)[number] & { paid_misses?: number }> = banks): DbMock {
  return vi.fn((strings: TemplateStringsArray) => {
    const text = templateText(strings);
    if (text.includes("learning_schema_ready")) return Promise.resolve([{ learning_schema_ready: true }]);
    // Institutions with no website (website-find.ts): none in these tests.
    if (text.includes("inst.charter_type")) return Promise.resolve([]);
    if (text.includes("incomplete-link schedule search")) return Promise.resolve([]);
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
  it("selects only banks every free finder missed with the current method, off the rolling cooldown", async () => {
    const db = createDb([]);
    await runMagellanPaidFind({ runId: 1, stateCode: "vt", db: asDb(db), create: vi.fn() });
    const select = db.mock.calls.find((call) => templateText(call[0]).includes("inst.city"))!;
    const text = templateText(select[0]);
    expect(text).toContain("inst.rescue_status = 'dead'");
    expect(text).toContain("pa.detail @>");
    expect(text).not.toContain("date_trunc('month'");
    expect(text).toContain("pa.created_at >= NOW() - make_interval(days => CASE WHEN pa.outcome = 'ok' THEN");
    expect(select).toContain(FOUND_COOLDOWN_DAYS);
    expect(select).toContain(MISS_COOLDOWN_DAYS);
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

    const result = await runMagellanPaidFind({ runId: 9, stepId: 4, stateCode: "VT", db: asDb(db), create, fetchImpl, pick: false });

    expect(result).toMatchObject({ selected: 3, processed: 3, succeeded: 1, failed: 2, budgetStopped: false });
    expect(result.costMicrousd).toBeGreaterThan(0);
    const params = create.mock.calls[0][0];
    // A bank under $10B searches its own site only, twice at most (#1035).
    expect(params.tools).toEqual([{ type: "web_search_20250305", name: "web_search", max_uses: 2, allowed_domains: ["alpha.example"] }]);
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

    const result = await runMagellanPaidFind({ runId: 10, db: asDb(db), create, fetchImpl: vi.fn(), pick: false });

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

  it("accepts the bank's corporate domain (Citi's schedule on citigroup.com)", () => {
    const citi = "https://www.citigroup.com/rcs/citigpa/storage/public/Schedule_of_Charges_Effective_February_26_2026.pdf";
    expect(onBankDomain(citi, "https://www.citi.com")).toBe(true);
    expect(onBankDomain("https://online.citibank.com/fees.pdf", "citi.com")).toBe(true);
    expect(onBankDomain("https://www.citizensbank.com/fees.pdf", "citi.com")).toBe(false);
    expect(onBankDomain("https://www.notchase.example/fees.pdf", "abc.com")).toBe(false);
    expect(onBankDomain("https://bigbank.com/fees.pdf", "big.com")).toBe(false);
  });

  describe("pick from homepage links", () => {
    const pickAnswer = (json: Record<string, unknown>) =>
      ({ content: [{ type: "text", text: JSON.stringify(json) }], usage: { input_tokens: 3000, output_tokens: 40 } }) as never;
    const home = '<a href="/about">About us</a> <a href="/resources/forms">Forms &amp; Documents</a> <a href="/docs/tis-2026.pdf">Account Disclosures</a>';

    it("stores a picked link that passes the fee-page check and skips the web search", async () => {
      const db = createDb([banks[0]]);
      const create = vi.fn().mockResolvedValueOnce(pickAnswer({ picks: [3, 2], reason: "disclosures" }));
      const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "https://www.alpha.example/") return new Response(home, { headers: { "content-type": "text/html" } });
        if (url === "https://www.alpha.example/docs/tis-2026.pdf") return new Response(FEE_TABLE, { headers: { "content-type": "text/html" } });
        return new Response("missing", { status: 404, headers: { "content-type": "text/html" } });
      });

      const result = await runMagellanPaidFind({ runId: 11, db: asDb(db), create, fetchImpl });

      expect(create).toHaveBeenCalledTimes(1);
      expect(create.mock.calls[0][0].tools).toBeUndefined();
      expect(result).toMatchObject({ processed: 1, succeeded: 1 });
      const logged = attempts(db);
      expect(logged).toHaveLength(1);
      expect(logged[0]).toMatchObject({ strategy: PAID_PICK_STRATEGY.strategy, outcome: "ok" });
      expect(logged[0].detail.picks).toEqual(["https://www.alpha.example/docs/tis-2026.pdf", "https://www.alpha.example/resources/forms"]);
      expect(db.mock.calls.some((call) => templateText(call[0]).includes("UPDATE institution_sources"))).toBe(true);
    });

    it("falls back to the web search when every pick fails", async () => {
      const db = createDb([banks[0]]);
      const create = vi
        .fn()
        .mockResolvedValueOnce(pickAnswer({ picks: [1] }))
        .mockResolvedValueOnce(answer({ url: null }));
      const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
        String(input) === "https://www.alpha.example/"
          ? new Response(home, { headers: { "content-type": "text/html" } })
          : new Response("<p>About our bank</p>", { headers: { "content-type": "text/html" } }),
      );

      await runMagellanPaidFind({ runId: 12, db: asDb(db), create, fetchImpl });

      expect(create).toHaveBeenCalledTimes(2);
      expect(attempts(db).map((attempt) => attempt.strategy)).toEqual([PAID_PICK_STRATEGY.strategy, PAID_FIND_STRATEGY.strategy]);
    });

    it("does not search the web twice in a month when only the pick was due", async () => {
      const db = createDb([{ ...banks[0], web_searched: true } as never]);
      const create = vi.fn().mockResolvedValueOnce(pickAnswer({ picks: [] }));
      const fetchImpl = vi.fn(async () => new Response(home, { headers: { "content-type": "text/html" } }));

      await runMagellanPaidFind({ runId: 13, db: asDb(db), create, fetchImpl });

      expect(create).toHaveBeenCalledTimes(1);
      expect(attempts(db).map((attempt) => attempt.strategy)).toEqual([PAID_PICK_STRATEGY.strategy]);
    });
  });
});

describe("escalation ladder (#1032)", () => {
  it("holds 'not published online' banks off the paid list until the retry, on the same website only", async () => {
    const db = createDb([]);
    await runMagellanPaidFind({ runId: 1, stateCode: "vt", db: asDb(db), create: vi.fn() });
    const select = db.mock.calls.find((call) => templateText(call[0]).includes("inst.city"))!;
    const text = templateText(select[0]);
    expect(text).toContain("LEFT JOIN LATERAL");
    expect(text).toContain("COALESCE(pa.detail->>'website_url', inst.website_url) = inst.website_url");
    expect(text).toContain("found.outcome = 'ok'");
    expect(text).toMatch(/AND NOT \(\s*ladder\.misses >=/);
    expect(select).toContain(NOT_ONLINE_AFTER_MISSES);
    expect(select).toContain(NOT_ONLINE_RETRY_DAYS);
  });

  it("asks for the fee schedule first and a disclosure or account agreement after one miss", async () => {
    const db = createDb([
      { ...banks[0], paid_misses: 0 },
      { ...banks[1], paid_misses: 1 },
    ]);
    const create = vi.fn().mockResolvedValue(answer({ url: null, confidence: 0 }));
    await runMagellanPaidFind({ runId: 2, stateCode: "VT", db: asDb(db), create, pick: false });

    const prompts = create.mock.calls.map((call) => String(call[0].messages[0].content));
    expect(prompts[0]).toContain("consumer fee schedule");
    expect(prompts[1]).toContain("Truth in Savings disclosure");
    expect(prompts[1]).toContain("Beta Bank");

    const logged = attempts(db);
    expect(logged.map((attempt) => attempt.detail.rung)).toEqual(["schedule", "disclosure"]);
    expect(logged[1].detail.website_url).toBe("https://beta.example");
    expect(logged[1].outcome).toBe("no_candidates");
  });
});

describe("state experts' work lists (#1029)", () => {
  // Twelve large TX banks the old order (largest first) would put ahead of every VT bank.
  const texas = Array.from({ length: 12 }, (_, index) => ({
    id: 100 + index, institution_name: `Texas Bank ${index}`, city: "Austin", state_code: "TX",
    website_url: `https://tx${index}.example`, asset_size: 9_000_000 - index * 1000,
  }));
  const vermont = [
    { id: 200, institution_name: "Green Mountain Bank", city: "Barre", state_code: "VT", website_url: "https://gm.example", asset_size: 120_000 },
    { id: 201, institution_name: "Lake Bank", city: "Burlington", state_code: "VT", website_url: "https://lake.example", asset_size: 90_000, requested: true },
  ];

  function workListDb() {
    return vi.fn((strings: TemplateStringsArray) => {
      const text = templateText(strings);
      if (text.includes("learning_schema_ready")) return Promise.resolve([{ learning_schema_ready: true }]);
      if (text.includes(") coverage_groups")) {
        return Promise.resolve([
          { state_code: "TX", size_group: "1b_10b", total: 60, covered: 10, target: 30, short: 20 },
          { state_code: "VT", size_group: "under_300m", total: 12, covered: 5, target: 9, short: 4 },
        ]);
      }
      if (text.includes("inst.charter_type")) return Promise.resolve([]);
      if (text.includes("incomplete-link schedule search")) return Promise.resolve([]);
      if (text.includes("inst.city")) return Promise.resolve([...texas, ...vermont]);
      return Promise.resolve([]);
    });
  }

  it("serves two states with different gaps in one run, a requester first, under the same cap", async () => {
    const db = workListDb();
    const result = await runMagellanPaidFind({ runId: 3, db: asDb(db), create: vi.fn(), dryRun: true });
    const searched = result.results.filter((entry) => entry.would_search);
    // The cap is unchanged: 10 of the 14 due banks.
    expect(searched).toHaveLength(10);
    expect(searched[0]).toMatchObject({ institution_id: 201, work_list: "requested_or_paying" });
    expect(searched.slice(1, 3).map((entry) => entry.institution_id)).toEqual([100, 200]);
    expect(searched[2]).toMatchObject({ work_list: "VT", work_group: "under_300m", work_group_short: 4 });
    // The query reads a pool and the cap applies after the lists are ordered.
    const select = db.mock.calls.find((call) => templateText(call[0]).includes("inst.city"))!;
    expect(templateText(select[0])).toContain("institution_workspace_memberships");
  });
});

describe("site-limited search follow-ups (#1251)", () => {
  const machias = { id: 41, institution_name: "Machias Savings Bank", city: "Machias", state_code: "ME", website_url: "https://www.machiassavings.com", asset_size: "2900000" };

  function ownHostDb(rows: Array<Record<string, unknown>>, ownHosts: Array<{ institution_id: number; host: string; documents?: number }>): DbMock {
    return vi.fn((strings: TemplateStringsArray) => {
      const text = templateText(strings);
      if (text.includes("learning_schema_ready")) return Promise.resolve([{ learning_schema_ready: true }]);
      if (text.includes("inst.charter_type")) return Promise.resolve([]);
      if (text.includes("incomplete-link schedule search")) return Promise.resolve([]);
      if (text.includes("bank-owned document hosts")) return Promise.resolve(ownHosts);
      if (text.includes("inst.city")) return Promise.resolve(rows);
      return Promise.resolve([]);
    });
  }

  it("searches the bank's other own host too, and keeps an answer found there", async () => {
    const db = ownHostDb([machias], [{ institution_id: 41, host: "machiassavings.bank" }]);
    const create = vi.fn().mockResolvedValueOnce(answer({ url: "https://machiassavings.bank/fee-schedule", confidence: 0.9 }));
    const fetchImpl = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async () => new Response(FEE_TABLE, { headers: { "content-type": "text/html" } }));

    const result = await runMagellanPaidFind({ runId: 5, stateCode: "ME", db: asDb(db), create, fetchImpl, pick: false });

    const params = create.mock.calls[0][0];
    expect(params.tools[0].allowed_domains).toEqual(["machiassavings.com", "machiassavings.bank"]);
    const prompt = String(params.messages[0].content);
    // A site-limited search cannot reach a parent company's domain, so it is not sent there.
    expect(prompt).not.toContain("parent company");
    expect(prompt).toContain("machiassavings.com or machiassavings.bank");
    expect(fetchImpl.mock.calls.map((call) => String(call[0]))).toContain("https://machiassavings.bank/fee-schedule");
    expect(result).toMatchObject({ processed: 1, succeeded: 1 });
    const [logged] = attempts(db);
    expect(logged.outcome).toBe("ok");
    expect(logged.detail.search_domains).toEqual(["machiassavings.com", "machiassavings.bank"]);
    expect(logged.detail.own_hosts).toEqual(["machiassavings.bank"]);
  });

  it("an answer on a .bank host with another name must name the bank, as every finder's must (#1033)", async () => {
    const cashmere = { ...machias, id: 42, institution_name: "Cashmere Valley Bank", website_url: "https://www.cashmerevalleybank.com" };
    const db = ownHostDb([cashmere], [{ institution_id: 42, host: "cvb.bank", documents: 2 }]);
    const create = vi.fn().mockResolvedValueOnce(answer({ url: "https://cvb.bank/fees", confidence: 0.9 }));
    const fetchImpl = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async () => new Response(FEE_TABLE, { headers: { "content-type": "text/html" } }));

    const result = await runMagellanPaidFind({ runId: 5, stateCode: "ME", db: asDb(db), create, fetchImpl, pick: false });

    expect(create.mock.calls[0][0].tools[0].allowed_domains).toEqual(["cashmerevalleybank.com", "cvb.bank"]);
    expect(fetchImpl).toHaveBeenCalled();
    expect(result).toMatchObject({ processed: 1, succeeded: 0 });
    const [logged] = attempts(db);
    expect(logged.outcome).toBe("wrong_document");
    expect(logged.detail.verdict).toBe("unconfirmed_host");
  });

  it("without a known own host, an answer on another domain is still refused", async () => {
    const db = ownHostDb([machias], []);
    const create = vi.fn().mockResolvedValueOnce(answer({ url: "https://machiassavings.bank/fee-schedule", confidence: 0.9 }));
    const fetchImpl = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async () => new Response(FEE_TABLE, { headers: { "content-type": "text/html" } }));

    await runMagellanPaidFind({ runId: 5, stateCode: "ME", db: asDb(db), create, fetchImpl, pick: false });

    expect(create.mock.calls[0][0].tools[0].allowed_domains).toEqual(["machiassavings.com"]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(attempts(db)[0].outcome).toBe("invalid_url");
  });

  it("a bank with no asset size on file searches the open web and may use a parent company's domain", async () => {
    const db = ownHostDb([{ ...machias, asset_size: null }], []);
    const create = vi.fn().mockResolvedValueOnce(answer({ url: null, confidence: 0 }));

    await runMagellanPaidFind({ runId: 5, stateCode: "ME", db: asDb(db), create, pick: false });

    const params = create.mock.calls[0][0];
    expect(params.tools).toEqual([{ type: "web_search_20250305", name: "web_search", max_uses: 3 }]);
    expect(String(params.messages[0].content)).toContain("parent company's domain");
    expect(attempts(db)[0].detail.search_domains).toBeNull();
  });
});
