import { describe, expect, it, vi } from "vitest";

import { isMarketingStep, isProviderStep } from "@/lib/agents/types";
import { measureFor, NO_MEASURE_REASONS, runGrowthScore, summarizeGrowthScore, trackedLinkOf } from "./score";

type Db = Parameters<typeof runGrowthScore>[0]["db"];

const POST_LINK = "https://feeinsight.com/reports?utm_source=linkedin&utm_medium=social&utm_campaign=w1-market-spread&utm_content=overdraft-2026-09-20";

function row(overrides: Record<string, unknown>) {
  return {
    id: 1,
    agent: "murrow",
    kind: "linkedin_post",
    workflow: "w1-market-spread",
    channel: "linkedin",
    subject_key: "s",
    title: "Overdraft in Tampa",
    caption: "text",
    facts: { link: POST_LINK },
    as_of: "2026-09-20T00:00:00Z",
    status: "posted",
    agent_run_id: null,
    reviewed_by: null,
    reviewed_at: "2026-09-21T10:00:00Z",
    posted_at: "2026-09-21T10:00:00Z",
    created_at: "2026-09-20T13:37:00Z",
    skip_reason: null,
    pr_url: null,
    score: null,
    scored_at: null,
    ...overrides,
  };
}

function fakeDb(
  rows: Record<string, unknown>[],
  options: { touches?: boolean; queueColumns?: number; journey?: boolean; events?: Array<{ event: string }>; outcomes?: Array<{ outcome: string }> } = {},
) {
  const writes: Array<{ query: string; values: unknown[] }> = [];
  const counts: unknown[][] = [];
  const journeyReads: unknown[][] = [];
  const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?");
    if (query.includes("table_name = 'content_drafts'")) return Promise.resolve([{ n: options.queueColumns ?? 5 }]);
    if (query.includes("to_regclass('public.marketing_touches')")) {
      return Promise.resolve([{ touches: options.touches ?? true, lead_columns: options.touches === false ? 0 : 2 }]);
    }
    if (query.includes("to_regclass('public.snapshot_events')")) return Promise.resolve([{ ready: options.journey ?? true }]);
    if (query.includes("FROM snapshot_events")) {
      journeyReads.push(values);
      return Promise.resolve(options.events ?? []);
    }
    if (query.includes("FROM outreach_outcomes")) return Promise.resolve(options.outcomes ?? []);
    if (query.includes("SELECT * FROM content_drafts")) return Promise.resolve(rows);
    if (query.includes("GROUP BY status")) return Promise.resolve([{ status: "draft", n: 3 }, { status: "skipped", n: 2 }]);
    if (query.includes("FROM marketing_touches")) {
      counts.push(values);
      return Promise.resolve([{ visits: 14, leads: 1 }]);
    }
    if (query.includes("UPDATE content_drafts")) writes.push({ query, values });
    return Promise.resolve([]);
  });
  return { db: db as unknown as Db, writes, counts, journeyReads };
}

describe("what can measure a queue item", () => {
  it("reads the tagged link from the stored facts, else from the text", () => {
    expect(trackedLinkOf({ facts: { link: POST_LINK }, caption: "" })).toEqual({ campaign: "w1-market-spread", content: "overdraft-2026-09-20" });
    expect(trackedLinkOf({ facts: {}, caption: `Read more: ${POST_LINK}\nThanks` })).toEqual({ campaign: "w1-market-spread", content: "overdraft-2026-09-20" });
    expect(trackedLinkOf({ facts: {}, caption: "https://feeinsight.com/reports?utm_campaign=only-campaign" })).toBeNull();
  });

  it("measures a sent outreach email by its institution's journey", () => {
    expect(measureFor({ kind: "outreach_email", facts: { institution_id: 4715 }, caption: "" })).toEqual({ kind: "journey", institutionId: 4715 });
    expect(measureFor({ kind: "outreach_email", facts: {}, caption: "" })).toEqual({ kind: "none", reason: NO_MEASURE_REASONS.no_institution });
  });

  it("has no measure for emails, PRs or untagged items, and says why", () => {
    expect(measureFor({ kind: "email", facts: { link: POST_LINK }, caption: "" })).toEqual({ kind: "none", reason: NO_MEASURE_REASONS.email });
    expect(measureFor({ kind: "pull_request", facts: {}, caption: "" })).toEqual({ kind: "none", reason: NO_MEASURE_REASONS.pull_request });
    expect(measureFor({ kind: "article", facts: {}, caption: "no link" })).toEqual({ kind: "none", reason: NO_MEASURE_REASONS.no_link });
    expect(measureFor({ kind: "linkedin_post", facts: { link: POST_LINK }, caption: "" }).kind).toBe("tracked_link");
  });
});

describe("growth-score step", () => {
  it("scores a posted item from visits in the week after posting and leaves the rest null with reasons", async () => {
    const { db, writes, counts } = fakeDb([row({ id: 1 }), row({ id: 2, kind: "pull_request", pr_url: "https://github.com/a/b/pull/1", facts: {} })]);
    const result = await runGrowthScore({ db, runId: 5, dryRun: false });

    expect(result.checked).toBe(2);
    expect(result.scored).toEqual([
      expect.objectContaining({
        draftId: 1,
        campaign: "w1-market-spread",
        content: "overdraft-2026-09-20",
        windowFrom: "2026-09-21T10:00:00.000Z",
        windowTo: "2026-09-28T10:00:00.000Z",
        visits: 14,
        leads: 1,
        score: 14,
      }),
    ]);
    expect(counts[0]).toEqual(["w1-market-spread", "overdraft-2026-09-20", "2026-09-21T10:00:00.000Z", "2026-09-28T10:00:00.000Z",
      "w1-market-spread", "overdraft-2026-09-20", "2026-09-21T10:00:00.000Z", "2026-09-28T10:00:00.000Z"]);
    expect(result.unscored).toEqual([expect.objectContaining({ draftId: 2, reason: NO_MEASURE_REASONS.pull_request })]);
    expect(result.notPosted).toEqual({ draft: 3, skipped: 2 });

    // One score written; the PR gets scored_at only, its score stays null.
    expect(writes).toHaveLength(2);
    expect(writes[0].query).toContain("SET score =");
    expect(writes[0].values).toEqual([14, 1]);
    expect(writes[1].query).toContain("SET scored_at = now()");
    expect(writes[1].query).not.toContain("score =");
    expect(writes[1].values).toEqual([2]);
    expect(summarizeGrowthScore(result)).toBe(
      "Scored 1 of 2 posted items (14 tracked visits, 1 lead); 1 left unscored with no measure; reasons are in the step result.",
    );
  });

  it("scores a sent outreach email by the furthest journey stage in the week after sending", async () => {
    const outreach = row({ id: 7, kind: "outreach_email", agent: "carnegie", facts: { institution_id: 4715 } });
    const { db, writes, journeyReads } = fakeDb([outreach], {
      events: [{ event: "opened" }, { event: "source_click" }],
      outcomes: [{ outcome: "sent" }, { outcome: "replied" }],
    });
    const result = await runGrowthScore({ db, runId: 5, dryRun: false });

    expect(journeyReads[0]).toEqual([4715, "outreach-launch", "2026-09-21T10:00:00.000Z", "2026-09-28T10:00:00.000Z"]);
    expect(result.scored).toEqual([expect.objectContaining({ draftId: 7, stage: "interest", score: 4, visits: 1, content: "inst-4715" })]);
    expect(writes[0].values).toEqual([4, 7]);
    expect(summarizeGrowthScore(result)).toBe("Scored 1 of 1 posted item (1 outreach email, 1 reaching commercial interest).");
  });

  it("scores an outreach email with no recorded response as 0, and waits when the journey tables are missing", async () => {
    const outreach = row({ id: 8, kind: "outreach_email", facts: { institution_id: 12 } });
    const silent = await runGrowthScore({ db: fakeDb([outreach]).db, runId: 5, dryRun: false });
    expect(silent.scored).toEqual([expect.objectContaining({ draftId: 8, stage: null, score: 0 })]);

    const missing = fakeDb([outreach], { journey: false });
    const waiting = await runGrowthScore({ db: missing.db, runId: 5, dryRun: false });
    expect(waiting.unscored).toEqual([expect.objectContaining({ draftId: 8, reason: NO_MEASURE_REASONS.no_journey_tables })]);
    expect(missing.writes).toHaveLength(0);
  });

  it("writes nothing on a dry run", async () => {
    const { db, writes } = fakeDb([row({ id: 1 }), row({ id: 2, kind: "email" })]);
    const result = await runGrowthScore({ db, runId: 5, dryRun: true });
    expect(result.scored).toHaveLength(1);
    expect(writes).toHaveLength(0);
  });

  it("keeps an item in line when the visits table is missing, rather than calling it unmeasurable", async () => {
    const { db, writes } = fakeDb([row({ id: 1 })], { touches: false });
    const result = await runGrowthScore({ db, runId: 5, dryRun: false });
    expect(result.unscored).toEqual([expect.objectContaining({ draftId: 1, reason: NO_MEASURE_REASONS.no_tables })]);
    expect(writes).toHaveLength(0);
  });

  it("scores nothing before the queue migration", async () => {
    const { db } = fakeDb([row({ id: 1 })], { queueColumns: 0 });
    const result = await runGrowthScore({ db, runId: 5, dryRun: false });
    expect(result.schemaReady).toBe(false);
    expect(summarizeGrowthScore(result)).toContain("20270110000025");
  });

  it("is a free marketing step (the marketing pause holds it; run-store.test checks heldByPause)", () => {
    for (const key of ["growth-score", "growth-intake"]) {
      expect(isMarketingStep(key)).toBe(true);
      expect(isProviderStep(key)).toBe(false);
    }
  });
});
