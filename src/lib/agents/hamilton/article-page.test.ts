import { describe, expect, it, vi } from "vitest";

import { isArticlePage, retireArticlePageFees } from "./article-page";

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

describe("isArticlePage", () => {
  it("names blog posts and stories, not schedules that sit under an article path", () => {
    expect(isArticlePage("https://www.sccu.com/articles/personal-finance/common-checking-account-fees-to-avoid")).toBe(true);
    expect(isArticlePage("https://www.ally.com/stories/spend/what-is-overdraft-protection/")).toBe(true);
    expect(isArticlePage("https://www.citynational.com/post/overdraft-protection-how-to-prevent-fees-and-stay-financially-secure")).toBe(true);
    expect(isArticlePage("https://www.mtcfcu.org/articles/schedule-of-fees/")).toBe(false);
    expect(isArticlePage("https://www.example.com/posts/fee-schedule/")).toBe(false);
    expect(isArticlePage("https://www.nstarcu.org/learn/fees")).toBe(false);
    expect(isArticlePage("http://www.ffcocu.org/resources/fee-schedule.html")).toBe(false);
    expect(isArticlePage(null)).toBe(false);
  });
});

const rows = [
  { fee_published_id: 33560, fee_verified_id: 18375, institution_id: 8109, source_document_id: 6194, document_url: "https://www.sccu.com/articles/personal-finance/common-checking-account-fees-to-avoid", canonical_fee_key: "atm_non_network", amount: "4.73" },
];

function createDb(pendingFlag: { flag_run_id: number; flagged_at: string } | null) {
  const query = (strings: TemplateStringsArray) => {
    const text = templateText(strings);
    if (text.includes("to_regclass")) return Promise.resolve([{ ready: true }]);
    if (text.includes("FROM pipeline_feedback")) {
      return Promise.resolve(pendingFlag ? [{ fee_published_id: 33560, kind: "takedown_pending", evidence: { ...pendingFlag, reason: "article_page: #6194" } }] : []);
    }
    if (text.includes("SET rolled_back_at = NOW()")) return Promise.resolve([{ fee_published_id: 33560 }]);
    return Promise.resolve([]);
  };
  const db = vi.fn(query) as unknown as ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
  db.unsafe = vi.fn(() => Promise.resolve(rows));
  return db as unknown as Parameters<typeof retireArticlePageFees>[0] & typeof db;
}
const writes = (db: ReturnType<typeof createDb>) => db.mock.calls.map((call) => templateText(call[0]));
const options = { runId: 5, batchId: "agentic-run-5", dryRun: false };

describe("retireArticlePageFees", () => {
  it("only flags an article-page fee the first time, keeping it live", async () => {
    const db = createDb(null);
    const result = await retireArticlePageFees(db, options);
    expect(result).toMatchObject({ articleFees: 1, flagged: 1, rolledBack: [] });
    expect(writes(db).some((text) => text.includes("SET rolled_back_at = NOW()"))).toBe(false);
  });

  it("archives it on its second look and teaches Magellan, never deleting", async () => {
    const db = createDb({ flag_run_id: 1, flagged_at: new Date(Date.now() - 13 * 3_600_000).toISOString() });
    const result = await retireArticlePageFees(db, options);
    expect(result.rolledBack.map((fee) => [fee.feePublishedId, fee.reason])).toEqual([[33560, "article_page: #6194"]]);
    expect(writes(db).some((text) => text.includes("SET review_status = 'rejected'"))).toBe(true);
    expect(writes(db).some((text) => text.includes("DELETE"))).toBe(false);
    const calls = JSON.stringify(db.mock.calls);
    expect(calls).toContain("hamilton.article_page:doc:6194");
    expect(calls).toContain("wrong_document");
  });
});
