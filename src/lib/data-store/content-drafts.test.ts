import { describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => ({ sql: vi.fn() }));

import { getContentDraft, insertContentDraft, setContentDraftStatus, updateContentDraftText } from "./content-drafts";

type Db = NonNullable<Parameters<typeof insertContentDraft>[1]>;

function mockDb(answer: unknown[] = []) {
  const calls: Array<{ query: string; values: unknown[] }> = [];
  const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ query: strings.join("?"), values });
    return Promise.resolve(answer);
  });
  return { db: db as unknown as Db, calls };
}

const base = {
  workflow: "w1-market-spread",
  subjectKey: "overdraft:Kansas City",
  title: "Kansas City overdraft",
  caption: "Caption",
  facts: { p25: 25 },
  asOf: new Date("2026-10-08T00:00:00Z"),
  agentRunId: 7,
};

describe("content queue", () => {
  it("inserts a LinkedIn draft without the queue columns, so it works before the migration", async () => {
    const { db, calls } = mockDb([{ id: 4 }]);
    await expect(insertContentDraft(base, db)).resolves.toBe(4);
    expect(calls[0].query).not.toContain("agent, kind");
  });

  it("records the agent, kind and PR link when a caller sets them", async () => {
    const { db, calls } = mockDb([{ id: 5 }]);
    await insertContentDraft({ ...base, agent: "ernest", kind: "pull_request", prUrl: "https://github.com/x/y/pull/1" }, db);
    expect(calls[0].query).toContain("agent, kind, pr_url");
    expect(calls[0].values.slice(-3)).toEqual(["ernest", "pull_request", "https://github.com/x/y/pull/1"]);
  });

  it("stores the skip reason with a skip, trimmed", async () => {
    const { db, calls } = mockDb();
    await setContentDraftStatus(3, "skipped", "james", db, "  Metro too small  ");
    expect(calls[0].query).toContain("skip_reason");
    expect(calls[0].values).toContain("Metro too small");
  });

  it("skips without a reason, and never stores a reason on approve", async () => {
    const { db, calls } = mockDb();
    await setContentDraftStatus(3, "skipped", "james", db, "   ");
    await setContentDraftStatus(3, "approved", "james", db, "ignored");
    expect(calls.every((call) => !call.query.includes("skip_reason"))).toBe(true);
  });

  it("reads old rows as murrow LinkedIn posts with no reason, link or score", async () => {
    const { db } = mockDb([{ id: 1, workflow: "w1-market-spread", channel: "linkedin", subject_key: "k", title: "t", caption: "c", facts: {}, as_of: "2026-10-01", status: "draft", agent_run_id: null, created_at: "2026-10-01" }]);
    await expect(getContentDraft(1, db)).resolves.toMatchObject({
      agent: "murrow",
      kind: "linkedin_post",
      skipReason: null,
      prUrl: null,
      score: null,
      scoredAt: null,
    });
  });

  it("edits the title and text of an item still waiting for review only", async () => {
    const { db, calls } = mockDb();
    await updateContentDraftText(3, `  ${"T".repeat(250)}  `, "New text", "james", db);
    expect(calls[0].query).toContain("status = 'draft'");
    expect(calls[0].query).not.toContain("'approved'");
    expect(calls[0].values).toEqual(["T".repeat(200), "New text", "james", 3]);
  });
});
