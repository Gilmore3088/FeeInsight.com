import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai-provider-usage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai-provider-usage")>("@/lib/ai-provider-usage");
  return {
    ...actual,
    // The budget guard and the usage log need the database; the test stands in for both.
    trackAnthropicRequest: vi.fn(async (_context: unknown, request: () => PromiseLike<unknown>) => request()),
  };
});

import { trackAnthropicRequest } from "@/lib/ai-provider-usage";
import { isProviderStep } from "@/lib/agents/types";
import type { RegistryDb } from "./partitions";
import {
  WIRE_RESEARCH_STEP_KEY,
  pickCandidates,
  runRegistryWireResearch,
  wireResearchLimit,
  wireSummariesLive,
  type WireResearchCandidate,
} from "./wire-research";

const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;

function createDb() {
  const statements: Array<{ text: string; values: unknown[] }> = [];
  const db = vi.fn((strings: unknown, ...values: unknown[]) => {
    if (!Array.isArray(strings) || !("raw" in (strings as object))) return strings;
    statements.push({ text: (strings as string[]).join(" "), values });
    return Promise.resolve([]);
  });
  return { db: db as unknown as RegistryDb, statements };
}

const PAGE = `<html><body><main><h1>Federal Reserve Board announces it will extend, until November 4, the comment period on its proposal to modernize Regulation O</h1>
<p>The Federal Reserve Board on Thursday announced it will extend, until November 4, the comment period on its proposal to modernize Regulation O, which governs extensions of credit to insiders. The original deadline was October 6. Docket No. R-1850.</p>
<p>The extension gives the public more time to analyze the proposal and prepare comments.</p></main></body></html>`;

const CANDIDATE: WireResearchCandidate = {
  itemKind: "article",
  itemId: "https://www.federalreserve.gov/newsevents/pressreleases/bcreg20261002a.htm",
  subject: "federal_release",
  source: "FED",
  headline: "Federal Reserve Board announces it will extend, until November 4, the comment period on its proposal to modernize Regulation O",
  url: "https://www.federalreserve.gov/newsevents/pressreleases/bcreg20261002a.htm",
  published: "2026-10-02",
};

function message(text: string) {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5-20251001",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 900, output_tokens: 120, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  } as never;
}

const fetchPage = vi.fn(async () => ({ status: 200, contentType: "text/html", body: PAGE }));

describe("registry-wire-research gating", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is a provider step and is off unless REG_WIRE_SUMMARIES_LIVE is exactly true", () => {
    expect(isProviderStep(WIRE_RESEARCH_STEP_KEY)).toBe(true);
    expect(wireSummariesLive(env({}))).toBe(false);
    expect(wireSummariesLive(env({ REG_WIRE_SUMMARIES_LIVE: "1" }))).toBe(false);
    expect(wireSummariesLive(env({ REG_WIRE_SUMMARIES_LIVE: "true" }))).toBe(true);
    expect(wireResearchLimit(env({}))).toBe(20);
    expect(wireResearchLimit(env({ REG_WIRE_SUMMARIES_PER_RUN: "500" }))).toBe(30);
  });

  it("shadow mode reads the page and logs what it would summarise, with no model call and no note", async () => {
    const { db, statements } = createDb();
    const create = vi.fn();
    const r = await runRegistryWireResearch({ runId: 7, db, live: false, candidates: [CANDIDATE], fetchPage, create });
    expect(create).not.toHaveBeenCalled();
    expect(trackAnthropicRequest).not.toHaveBeenCalled();
    expect(r).toMatchObject({ shadow: true, selected: 1, written: 0, costMicrousd: 0 });
    expect(r.items[0]).toMatchObject({ outcome: "would_summarise", truncated: false });
    expect(r.items[0].est_input_tokens).toBeGreaterThan(0);
    expect(statements.some((s) => s.text.includes("INSERT INTO reg_wire_research"))).toBe(false);
    const partition = statements.find((s) => s.text.includes("INSERT INTO registry_ingest_partitions"));
    expect(JSON.parse(String(partition!.values.find((v) => typeof v === "string" && v.startsWith("{"))))).toMatchObject({ shadow: true, selected: 1 });
  });

  it("live mode calls the model through the budget guard, keeps stated dates and drops the rest", async () => {
    const { db, statements } = createDb();
    const create = vi.fn(async () =>
      message(
        JSON.stringify({
          summary: "The Federal Reserve Board extended the comment period on its proposal to modernize Regulation O. Comments are now due November 4.",
          action_type: "comment_period_change",
          comment_deadline: "2026-11-04",
          effective_date: "2027-01-01",
          why_it_matters: "Banks that lend to their own officers and directors have more time to comment.",
        }),
      ),
    );
    const r = await runRegistryWireResearch({ runId: 7, db, live: true, candidates: [CANDIDATE], fetchPage, create });
    expect(create).toHaveBeenCalledTimes(1);
    expect(trackAnthropicRequest).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "magellan", operation: "wire_research_summary", agentRunId: 7 }),
      expect.any(Function),
    );
    expect(r).toMatchObject({ shadow: false, written: 1, datesDropped: 1 });
    // Haiku 4.5 at $1/$5 per million tokens: 900 in + 120 out = 900 + 600 micro-dollars.
    expect(r.costMicrousd).toBe(1500);
    const insert = statements.find((s) => s.text.includes("INSERT INTO reg_wire_research"));
    expect(insert!.values).toContain("2026-11-04");
    expect(insert!.values).not.toContain("2027-01-01");
    expect(insert!.values).toContainEqual(["R-1850"]);
  });

  it("a dry run never calls the model even when live", async () => {
    const { db } = createDb();
    const create = vi.fn();
    const r = await runRegistryWireResearch({ runId: 7, db, live: true, dryRun: true, candidates: [CANDIDATE], fetchPage, create });
    expect(create).not.toHaveBeenCalled();
    expect(r.items[0].outcome).toBe("would_summarise");
  });

  it("a budget stop ends the step before more calls", async () => {
    const { db } = createDb();
    const blocked = Object.assign(new Error("Provider daily budget exhausted for agent:magellan."), { name: "ProviderBudgetBlockedError" });
    const create = vi.fn(async () => {
      throw blocked;
    });
    const many = [1, 2, 3, 4, 5].map((i) => ({ ...CANDIDATE, itemId: `g${i}` }));
    const r = await runRegistryWireResearch({ runId: 7, db, live: true, candidates: many, fetchPage, create });
    expect(r.budgetStopped).toBe(true);
    expect(r.written).toBe(0);
    expect(create.mock.calls.length).toBeLessThanOrEqual(3);
    expect(r.items.every((i) => i.outcome === "budget_stopped")).toBe(true);
  });

  it("an unreadable page gets a source_unreadable note in live mode and no model call", async () => {
    const { db, statements } = createDb();
    const create = vi.fn();
    const pdf = vi.fn(async () => ({ status: 200, contentType: "application/pdf", body: "" }));
    const r = await runRegistryWireResearch({ runId: 7, db, live: true, candidates: [CANDIDATE], fetchPage: pdf, create });
    expect(create).not.toHaveBeenCalled();
    expect(r.unreadable).toBe(1);
    expect(statements.find((s) => s.text.includes("INSERT INTO reg_wire_research"))!.values).toContain("source_unreadable");
  });
});

describe("pickCandidates", () => {
  it("never picks press, keeps banking posts only, and takes the newest first", () => {
    const picked = pickCandidates(
      [
        { guid: "f1", source: "FED", title: "Fed release", link: "https://fed/1", published: "2026-10-01" },
        { guid: "n1", source: "news:CA", title: "Overdraft bill story - Paper", link: "https://news/1", published: "2026-10-05" },
        { guid: "s1", source: "state:NY", title: "DFS announces holiday schedule", link: "https://dfs/1", published: "2026-10-04" },
        { guid: "s2", source: "state:NY", title: "DFS fines bank for overdraft fee practices", link: "https://dfs/2", published: "2026-10-03" },
      ],
      [{ source: "open_states", external_id: "ocd-bill/9", jurisdiction: "CA", identifier: "AB 1520", title: "Overdraft fees", url: "https://os/9", published: "2026-10-02" }],
      3,
    );
    expect(picked.map((c) => [c.itemId, c.subject])).toEqual([
      ["s2", "state_regulator_post"],
      ["open_states:ocd-bill/9", "state_bill"],
      ["f1", "federal_release"],
    ]);
  });
});
