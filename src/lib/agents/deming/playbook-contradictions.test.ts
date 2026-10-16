import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import {
  playbookContradictionsDetail,
  playbookContradictionsSql,
  runPlaybookContradictions,
  SEARCH_FROM_STRATEGIES,
  summarizePlaybookContradictions,
} from "./playbook-contradictions";

function fakeDb(row: Record<string, unknown> | null, ready = true) {
  const unsafe = vi.fn(async (...args: [string, unknown[]]) => (args && row ? [row] : []));
  const db = Object.assign(vi.fn(async () => [{ ready }]), { unsafe });
  return { db, unsafe };
}

describe("Deming playbook contradiction check (#1105)", () => {
  it("reads once, read-only, and never counts the search-from strategies as judging the current link", () => {
    const text = playbookContradictionsSql();
    expect(text).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/i);
    expect(text).toContain("NOT (entry->>'strategy' = ANY($1::text[]))");
    expect(text).toContain("expected_fee_count < $2::int");
    expect(text).toContain("expected_fee_count >= $3::int");
    expect(SEARCH_FROM_STRATEGIES).toEqual(["discover.second_document", "discover.site_search"]);
  });

  it("returns counts and samples from the row and summarizes them", async () => {
    const { db, unsafe } = fakeDb({
      profiles: 8775, any_contradiction: 13, search_from_entries: 1758, layout_never_recorded: 5683,
      source_rejected: 0, source_unfetchable: 4, source_judged_wrong: 0, schedule_expects_few: 9, product_page_expects_many: 0,
      source_unfetchable_sample: ["666", "1354"], schedule_expects_few_sample: [91], source_rejected_sample: null,
    });
    const result = await runPlaybookContradictions({ db: db as never });
    expect(unsafe.mock.calls[0][1]).toEqual([["discover.second_document", "discover.site_search"], 5, 15, 20]);
    expect(result).toMatchObject({
      ready: true, profiles: 8775, institutions: 13, searchFromEntries: 1758, layoutNeverRecorded: 5683,
      counts: { source_unfetchable: 4, schedule_expects_few: 9, source_rejected: 0 },
      samples: { source_unfetchable: [666, 1354], schedule_expects_few: [91], source_rejected: [] },
    });
    expect(summarizePlaybookContradictions(result)).toBe(
      "Deming checked 8,775 playbooks: 13 contradict themselves (4 current source on its own do-not-retry list for a fetch failure; 9 a fee schedule expected to hold fewer than 5 fees). 1,758 carry a second-document search entry on their current link (not a contradiction), and 5,683 have no layout recorded.",
    );
    expect(playbookContradictionsDetail(result)).toMatchObject({ version: 1, institutions: 13, search_from_entries: 1758 });
  });

  it("reports not ready, without reading, when the playbook table is missing", async () => {
    const { db, unsafe } = fakeDb(null, false);
    const result = await runPlaybookContradictions({ db: db as never });
    expect(result.ready).toBe(false);
    expect(unsafe).not.toHaveBeenCalled();
    expect(summarizePlaybookContradictions(result)).toContain("could not check");
  });
});
