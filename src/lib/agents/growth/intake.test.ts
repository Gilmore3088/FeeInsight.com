import { describe, expect, it, vi } from "vitest";

import { foreignEmailAddresses, parseIntakeItem, runGrowthIntake, summarizeGrowthIntake } from "./intake";
import { GROWTH_AGENTS } from "./roster";

type Db = Parameters<typeof runGrowthIntake>[0]["db"];

const VALID = {
  agent: "ernest",
  kind: "article",
  title: "Overdraft fees by state",
  body: "Draft text. Questions: hello@bankfeeindex.com",
};

/** A tagged-template db that answers by query text and records inserts. */
function fakeDb(options: { columns?: number; existing?: number | null } = {}) {
  const inserts: unknown[][] = [];
  const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?");
    if (query.includes("information_schema.columns")) return Promise.resolve([{ n: options.columns ?? 5 }]);
    if (query.includes("SELECT id FROM content_drafts")) return Promise.resolve(options.existing ? [{ id: options.existing }] : []);
    if (query.includes("INSERT INTO content_drafts")) {
      inserts.push(values);
      return Promise.resolve([{ id: 41 }]);
    }
    return Promise.resolve([]);
  });
  return { db: db as unknown as Db, inserts };
}

describe("intake validation", () => {
  it("accepts a valid item and defaults its subject to the title", () => {
    const parsed = parseIntakeItem(VALID);
    expect(parsed).toEqual({
      ok: true,
      item: { agent: "ernest", kind: "article", title: "Overdraft fees by state", body: VALID.body, prUrl: null, subjectKey: "overdraft-fees-by-state" },
    });
  });

  it("knows the eight marketing agents", () => {
    expect([...GROWTH_AGENTS]).toEqual(["bernays", "carnegie", "draper", "edison", "ernest", "murrow", "nielsen", "norman", "sherlock"]);
  });

  it("refuses an unknown agent, an unknown kind and missing text, all at once", () => {
    const parsed = parseIntakeItem({ agent: "hamilton", kind: "tweet", title: " ", body: "" });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors).toHaveLength(4);
    expect(parsed.errors[0]).toMatch(/^agent must be one of bernays, carnegie/);
    expect(parsed.errors[1]).toMatch(/^kind must be one of linkedin_post/);
  });

  it("refuses fields outside the queue's own, so no personal data rides along", () => {
    const parsed = parseIntakeItem({ ...VALID, recipient_email: "x", contact_name: "y" });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors[0]).toContain("recipient_email, contact_name");
  });

  it("refuses an email address that is not ours", () => {
    expect(foreignEmailAddresses("write to jane.doe@examplebank.com or hello@bankfeeindex.com")).toEqual(["jane.doe@examplebank.com"]);
    const parsed = parseIntakeItem({ ...VALID, body: "Send to jane.doe@examplebank.com" });
    expect(parsed.ok).toBe(false);
  });

  it("needs a GitHub PR link for a pull request and uses it as the subject", () => {
    expect(parseIntakeItem({ ...VALID, kind: "pull_request" }).ok).toBe(false);
    expect(parseIntakeItem({ ...VALID, kind: "pull_request", pr_url: "https://example.com/pull/1" }).ok).toBe(false);
    const parsed = parseIntakeItem({ ...VALID, kind: "pull_request", pr_url: "https://github.com/acme/feeinsight/pull/540" });
    expect(parsed.ok && parsed.item.subjectKey).toBe("https://github.com/acme/feeinsight/pull/540");
  });

  it("checks lengths and the subject key's characters", () => {
    expect(parseIntakeItem({ ...VALID, title: "x".repeat(201) }).ok).toBe(false);
    expect(parseIntakeItem({ ...VALID, body: "x".repeat(20_001) }).ok).toBe(false);
    expect(parseIntakeItem({ ...VALID, subject_key: "Has Spaces" }).ok).toBe(false);
    const parsed = parseIntakeItem({ ...VALID, subject_key: "seo:state-pages" });
    expect(parsed.ok && parsed.item.subjectKey).toBe("seo:state-pages");
  });

  it("refuses a body that is not an object", () => {
    expect(parseIntakeItem([VALID]).ok).toBe(false);
    expect(parseIntakeItem(null).ok).toBe(false);
  });
});

describe("growth-intake step", () => {
  it("files the item as a draft under its agent and kind", async () => {
    const { db, inserts } = fakeDb();
    const result = await runGrowthIntake({ db, runId: 9, item: VALID, dryRun: false, now: new Date("2026-10-08T12:00:00Z") });
    expect(result.draftId).toBe(41);
    expect(result.alreadyFiled).toBe(false);
    expect(inserts).toHaveLength(1);
    const values = inserts[0];
    // workflow, channel, subject, title, caption, facts, as_of, run, agent, kind, pr_url
    expect(values[0]).toBe("intake:ernest");
    expect(values[1]).toBe("site");
    expect(values[2]).toBe("overdraft-fees-by-state");
    expect(values[4]).toBe(VALID.body);
    expect(JSON.parse(String(values[5]))).toEqual({ source: "intake" });
    expect(values.slice(7)).toEqual([9, "ernest", "article", null]);
    expect(summarizeGrowthIntake(result)).toBe(`Filed ernest's article "Overdraft fees by state" into the queue as #41 for James to review.`);
  });

  it("does not queue a repeat filing twice", async () => {
    const { db, inserts } = fakeDb({ existing: 17 });
    const result = await runGrowthIntake({ db, runId: 9, item: VALID, dryRun: false });
    expect(result).toMatchObject({ draftId: 17, alreadyFiled: true });
    expect(inserts).toHaveLength(0);
  });

  it("writes nothing on a dry run or before the queue migration", async () => {
    const dry = fakeDb();
    expect((await runGrowthIntake({ db: dry.db, runId: 1, item: VALID, dryRun: true })).draftId).toBeNull();
    expect(dry.inserts).toHaveLength(0);
    const old = fakeDb({ columns: 2 });
    const result = await runGrowthIntake({ db: old.db, runId: 1, item: VALID, dryRun: false });
    expect(result.errors[0]).toContain("20270110000025");
    expect(old.inserts).toHaveLength(0);
  });

  it("re-checks the item inside the step", async () => {
    const { db, inserts } = fakeDb();
    const result = await runGrowthIntake({ db, runId: 1, item: { ...VALID, agent: "nobody" }, dryRun: false });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(summarizeGrowthIntake(result)).toMatch(/^Filed nothing:/);
    expect(inserts).toHaveLength(0);
  });
});
