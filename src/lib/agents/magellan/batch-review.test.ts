import { describe, expect, it, vi } from "vitest";

import {
  BATCH_REVIEW_CHECK,
  BATCH_SIZE,
  batchFeedbackRows,
  linkError,
  reviewLinkBatches,
  scoreBatch,
  type BatchLinkRow,
} from "./batch-review";
import { demoteFinders } from "./discovery";
import { FINDER_ORDER, FINDERS } from "./finders";

function link(id: number, strategy: string | null, overrides: Partial<BatchLinkRow> = {}): BatchLinkRow {
  return {
    id,
    institution_id: 1000 + id,
    source_url: `https://bank${id}.example/fee-schedule`,
    about_strategy: strategy,
    signal: "right",
    kind: "produced_live_fees",
    darwin_right: 10,
    darwin_wrong: 0,
    answer_key_url: null,
    ...overrides,
  };
}

describe("linkError", () => {
  it("counts the ledger's own verdict, Darwin's rejections and an answer-key mismatch", () => {
    expect(linkError(link(1, "discover.site_crawl", { signal: "wrong", kind: "thin_link" }))).toBe("thin_link");
    expect(linkError(link(2, "discover.hub_pages", { darwin_right: 1, darwin_wrong: 4 }))).toBe("darwin_rejected_fees");
    expect(linkError(link(3, "discover.hub_pages", { darwin_right: 9, darwin_wrong: 4 }))).toBeNull();
    expect(linkError(link(4, "discover.sitemap", { answer_key_url: "https://bank4.example/other.pdf" }))).toBe("answer_key_other_document");
    expect(linkError(link(5, "discover.sitemap", { answer_key_url: "https://www.bank5.example/fee-schedule/" }))).toBeNull();
  });
});

describe("scoreBatch", () => {
  it("scores each finder's share of errors and marks a finder wrong at 40% or more", () => {
    const rows = [
      ...Array.from({ length: 6 }, (_, index) =>
        link(index, "discover.site_crawl", index < 3 ? { signal: "wrong", kind: "wrong_document" } : {})),
      ...Array.from({ length: 6 }, (_, index) => link(10 + index, "discover.sitemap", index === 0 ? { signal: "wrong", kind: "dead_link" } : {})),
    ];
    const scores = scoreBatch(rows);
    const crawl = scores.find((score) => score.strategy === "discover.site_crawl")!;
    expect(crawl).toMatchObject({ links: 6, errors: 3, errorShare: 0.5, byKind: { wrong_document: 3 } });
    expect(crawl.samples).toHaveLength(3);

    const feedback = batchFeedbackRows(scores, { firstId: 0, lastId: 15, links: 12, errors: 4 }, 9);
    expect(feedback.map((row) => [row.aboutStrategy, row.signal])).toEqual([
      ["discover.site_crawl", "wrong"],
      ["discover.sitemap", "right"],
    ]);
    expect(feedback[0]).toMatchObject({ checkName: BATCH_REVIEW_CHECK, kind: "batch_review", reportedBy: "magellan" });
    expect(feedback[0].evidence).toMatchObject({ last_link_feedback_id: 15, counts_toward_demotion: true });
  });
});

describe("demoteFinders", () => {
  it("runs a demoted finder after the others and keeps the known link first", () => {
    const order = demoteFinders(FINDER_ORDER, new Set([FINDERS.hubPages.strategy]));
    expect(order[0].key).toBe("knownLink");
    expect(order[order.length - 1].key).toBe("hubPages");
    expect(order).toHaveLength(FINDER_ORDER.length);
    expect(demoteFinders(FINDER_ORDER, new Set())).toBe(FINDER_ORDER);
  });
});

describe("reviewLinkBatches", () => {
  function createDb(rows: BatchLinkRow[]) {
    return vi.fn((strings: TemplateStringsArray) => {
      const text = Array.isArray(strings) ? strings.join(" ") : String(strings);
      if (text.includes("to_regclass('public.pipeline_feedback')")) return Promise.resolve([{ ready: true }]);
      if (text.includes("AS cursor")) return Promise.resolve([{ cursor: null }]);
      if (text.includes("next chunks of judged links")) return Promise.resolve(rows);
      if (text.includes("INSERT INTO pipeline_feedback")) return Promise.resolve([{ id: 1 }, { id: 2 }]);
      return Promise.resolve([]);
    });
  }

  it("reviews only full chunks and leaves the rest waiting", async () => {
    const rows = Array.from({ length: BATCH_SIZE + 7 }, (_, index) => link(index + 1, index % 2 ? "discover.site_crawl" : "discover.sitemap"));
    const db = createDb(rows);
    const result = await reviewLinkBatches(db as never, { runId: 3 });
    expect(result).toMatchObject({ ready: true, batches: 1, links: BATCH_SIZE, waiting: 7, errors: 0 });
  });

  it("does nothing until a chunk is full", async () => {
    const db = createDb(Array.from({ length: BATCH_SIZE - 1 }, (_, index) => link(index + 1, "discover.sitemap")));
    const result = await reviewLinkBatches(db as never, { runId: 3 });
    expect(result).toMatchObject({ batches: 0, waiting: BATCH_SIZE - 1, written: 0 });
  });
});
