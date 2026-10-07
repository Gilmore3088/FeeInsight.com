import { describe, expect, it, vi } from "vitest";

import {
  judgeLink,
  linkFeedbackRow,
  linkYieldSlot,
  stepSlot,
  recordLinkOutcomes,
  type LinkOutcomeRow,
} from "./outcomes";

const NOW = new Date("2026-10-06T07:30:00Z");

function link(overrides: Partial<LinkOutcomeRow> = {}): LinkOutcomeRow {
  return {
    institution_id: 31,
    url: "https://bank.example/fee-schedule.pdf",
    role: "main",
    first_document_id: 500,
    last_document_id: 640,
    last_status: "success",
    last_status_code: 200,
    last_read: "ok",
    last_extract_at: "2026-10-04T00:00:00Z",
    knox_fees: 14,
    live_fees: 12,
    live_categories: ["overdraft", "nsf", "monthly_maintenance"],
    found_by: "discover.hub_pages",
    found_by_version: 2,
    found_attempt_id: 9001,
    current_signal: null,
    current_kind: null,
    current_weight: null,
    ...overrides,
  };
}

describe("Magellan outcome ledger", () => {
  it("labels a link by what it produced downstream", () => {
    expect(judgeLink(link(), NOW)).toEqual({ label: "good", signal: "right", kind: "produced_live_fees", weight: 12 });
    expect(judgeLink(link({ live_fees: 1, last_status: "failed", last_status_code: 404 }), NOW))
      .toMatchObject({ label: "dead", kind: "dead_link" });
    expect(judgeLink(link({ live_fees: 0, last_read: "http_404" }), NOW)).toMatchObject({ label: "dead" });
    expect(judgeLink(link({ live_fees: 0, last_read: "wrong_document" }), NOW))
      .toMatchObject({ label: "rejected", signal: "wrong", kind: "wrong_document" });
    expect(judgeLink(link({ live_fees: 2 }), NOW)).toMatchObject({ label: "thin", kind: "thin_link", weight: 1 });
  });

  it("keeps live fees ahead of a later failed fetch", () => {
    expect(judgeLink(link({ last_status: "failed", last_status_code: 404 }), NOW)).toMatchObject({ label: "good" });
  });

  it("does not judge a link the pipeline has not finished with", () => {
    // Read but not extracted yet, extracted within the day, or behind a bot wall.
    expect(judgeLink(link({ live_fees: 0, last_extract_at: null }), NOW)).toBeNull();
    expect(judgeLink(link({ live_fees: 0, last_extract_at: "2026-10-06T01:00:00Z" }), NOW)).toBeNull();
    expect(judgeLink(link({ live_fees: null, last_read: null, last_extract_at: null, last_status: "failed", last_status_code: 403 }), NOW)).toBeNull();
  });

  it("writes one shared-store row per link, keyed on its first document", () => {
    const row = linkFeedbackRow(link(), judgeLink(link(), NOW)!, 77);
    expect(row).toMatchObject({
      aboutStage: "discover",
      aboutStrategy: "discover.hub_pages",
      aboutVersion: 2,
      aboutAttemptId: 9001,
      signal: "right",
      kind: "produced_live_fees",
      reportedBy: "magellan",
      checkName: "magellan.link_yield",
      institutionId: 31,
      sourceDocumentId: 500,
      sourceUrl: "https://bank.example/fee-schedule.pdf",
      weight: 12,
      runId: 77,
      dedupeKey: "magellan.link_yield:doc:500",
    });
    expect(row.evidence).toMatchObject({ label: "good", role: "main", live_fees: 12, knox_fees: 14, last_document_id: 640 });
  });

  it("rotates through 24 slots of banks, one per hour", () => {
    expect(linkYieldSlot(new Date("2026-10-06T00:10:00Z"))).toBe(0);
    expect(linkYieldSlot(new Date("2026-10-06T23:59:00Z"))).toBe(23);
  });

  it("judges a state's whole bank list, and one hourly slot only without a state", () => {
    expect(stepSlot("TX", new Date("2026-10-06T07:10:00Z"))).toBeNull();
    expect(stepSlot(" ", new Date("2026-10-06T07:10:00Z"))).toBe(7);
    expect(stepSlot(null, new Date("2026-10-06T07:10:00Z"))).toBe(7);
  });

  function fakeDb(links: LinkOutcomeRow[], ready = true) {
    const statements: string[] = [];
    const db = vi.fn(async (strings: TemplateStringsArray) => {
      const text = strings.join("?");
      statements.push(text);
      if (text.includes("to_regclass")) return [{ ready }];
      if (text.includes("WITH banks AS")) return links;
      if (text.includes("INSERT INTO pipeline_feedback")) return [{ id: 1 }, { id: 2 }].slice(0, 2);
      return [];
    });
    return { db, statements };
  }

  it("writes only judgements that changed and skips undecided links", async () => {
    const { db, statements } = fakeDb([
      link(),
      link({ first_document_id: 501, live_fees: 0, last_read: "wrong_document" }),
      link({ first_document_id: 502, current_signal: "right", current_kind: "produced_live_fees", current_weight: "12" }),
      link({ first_document_id: 503, live_fees: 0, last_extract_at: null }),
    ]);
    const result = await recordLinkOutcomes(db as never, { runId: 5, now: NOW });
    expect(result).toMatchObject({
      ready: true,
      slot: 7,
      links: 4,
      judged: { good: 2, thin: 0, rejected: 1, dead: 0 },
      undecided: 1,
      unchanged: 1,
      written: 2,
    });
    expect(statements.filter((text) => text.includes("INSERT INTO pipeline_feedback"))).toHaveLength(1);
  });

  it("does nothing before the shared store exists, and writes nothing on a dry run", async () => {
    const missing = fakeDb([link()], false);
    expect(await recordLinkOutcomes(missing.db as never, { runId: 5, now: NOW })).toMatchObject({ ready: false, links: 0 });
    const dry = fakeDb([link()]);
    expect(await recordLinkOutcomes(dry.db as never, { runId: 5, now: NOW, dryRun: true })).toMatchObject({ judged: { good: 1 }, written: 0 });
    expect(dry.statements.some((text) => text.includes("INSERT INTO pipeline_feedback"))).toBe(false);
  });

  it("never throws into the discovery step", async () => {
    const db = vi.fn(async (strings: TemplateStringsArray) => {
      if (strings.join("?").includes("to_regclass")) return [{ ready: true }];
      throw new Error("statement timeout");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(recordLinkOutcomes(db as never, { runId: 5, now: NOW })).resolves.toMatchObject({ ready: true, links: 0 });
    error.mockRestore();
  });
});
