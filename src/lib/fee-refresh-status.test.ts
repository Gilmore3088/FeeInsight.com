import { describe, expect, it } from "vitest";

import { refreshStatus, rowsTouched, type RefreshInput } from "./fee-refresh-status";

// H03-T08 (#978): each reader's status after an operator's fee action is read from evidence and
// never claims a change before that reader shows it.

const at = "2026-10-16T12:00:00.000Z";
const minutes = (n: number) => new Date(Date.parse(at) + n * 60_000);

function input(overrides: Partial<RefreshInput> = {}): RefreshInput {
  return {
    action: "correct",
    actionAt: at,
    events: [
      { eventType: "index.refresh", status: "completed", createdAt: at },
      { eventType: "cache.invalidate", status: "completed", createdAt: at },
    ],
    indexComputedAt: at,
    catalog: { removedStillListed: false, addedListed: true, addedStillLive: true },
    now: minutes(5),
    ...overrides,
  };
}

const state = (status: ReturnType<typeof refreshStatus>, surface: string) => status.surfaces.find((s) => s.surface === surface)?.state;

describe("fee refresh status", () => {
  it("should_report_every_reader_updated_when_the_evidence_shows_it", () => {
    const status = refreshStatus(input());
    expect(status.surfaces.map((s) => s.state)).toEqual(["reached", "reached", "reached", "reached"]);
    expect(status.needsRetry).toBe(false);
  });

  it("should_not_claim_the_index_or_pro_before_servers_drop_their_memo", () => {
    const status = refreshStatus(input({ now: new Date(Date.parse(at) + 20_000) }));
    expect(state(status, "national_index")).toBe("waiting");
    expect(state(status, "pro")).toBe("waiting");
  });

  it("should_mark_a_failed_index_rebuild_for_retry_and_recover_after_a_retry_run", () => {
    const failed = input({
      events: [
        { eventType: "index.refresh", status: "failed", createdAt: at },
        { eventType: "cache.invalidate", status: "completed", createdAt: at },
      ],
      indexComputedAt: "2026-10-16T06:00:00.000Z",
    });
    const before = refreshStatus(failed);
    expect(state(before, "national_index")).toBe("failed");
    expect(state(before, "pro")).toBe("failed");
    expect(before.needsRetry).toBe(true);

    // The retry run's events are read with the original run's.
    const after = refreshStatus({
      ...failed,
      events: [...failed.events, { eventType: "index.refresh", status: "completed", createdAt: minutes(3).toISOString() }],
      indexComputedAt: minutes(3).toISOString(),
    });
    expect(state(after, "national_index")).toBe("reached");
    expect(after.needsRetry).toBe(false);
  });

  it("should_count_a_later_publish_rebuild_as_reaching_the_index", () => {
    const status = refreshStatus(input({
      events: [{ eventType: "index.refresh", status: "failed", createdAt: at }, { eventType: "cache.invalidate", status: "completed", createdAt: at }],
      indexComputedAt: minutes(2).toISOString(),
    }));
    expect(state(status, "national_index")).toBe("reached");
  });

  it("should_ask_for_a_retry_when_the_page_caches_were_not_cleared_and_have_not_expired", () => {
    const events = [{ eventType: "index.refresh", status: "completed", createdAt: at }];
    const fresh = refreshStatus(input({ events }));
    expect(state(fresh, "public_pages")).toBe("failed");
    expect(fresh.needsRetry).toBe(true);
    // An hour later every cached page has expired on its own.
    const expired = refreshStatus(input({ events, now: minutes(61) }));
    expect(state(expired, "public_pages")).toBe("reached");
    expect(expired.needsRetry).toBe(false);
  });

  it("should_say_when_a_live_fee_is_left_out_of_the_fee_list_by_another_rule", () => {
    const status = refreshStatus(input({ catalog: { removedStillListed: false, addedListed: false, addedStillLive: true } }));
    expect(state(status, "fee_list")).toBe("hidden");
    expect(state(status, "pro")).toBe("hidden");
  });

  it("should_treat_a_value_replaced_by_a_later_change_as_reached", () => {
    const status = refreshStatus(input({ catalog: { removedStillListed: false, addedListed: false, addedStillLive: false } }));
    expect(state(status, "fee_list")).toBe("reached");
    expect(status.surfaces[0].detail).toMatch(/later change/);
  });

  it("should_map_each_action_to_the_rows_it_took_out_and_made_live", () => {
    expect(rowsTouched("hold", null, 5)).toEqual({ removed: 5, added: null });
    expect(rowsTouched("release", null, 5)).toEqual({ removed: null, added: 5 });
    expect(rowsTouched("correct", 4, 5)).toEqual({ removed: 4, added: 5 });
    expect(rowsTouched("reverse", 5, 6)).toEqual({ removed: 5, added: 6 });
  });
});
