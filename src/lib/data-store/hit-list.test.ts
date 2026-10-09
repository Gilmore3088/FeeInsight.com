import { describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => ({ sql: vi.fn(), getSql: vi.fn() }));

import { getHitList, hitListReason, type HitListFacts } from "./hit-list";

type Db = NonNullable<Parameters<typeof getHitList>[0]>["db"];

function createDb(rows: Record<string, unknown>[]) {
  const calls: { text: string; values: unknown[] }[] = [];
  const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("?"), values });
    return Promise.resolve(rows);
  });
  return { db: db as unknown as Db, calls };
}

const facts = (overrides: Partial<HitListFacts>): HitListFacts => ({
  view: "no_fees",
  hasLink: true,
  handLinkWaiting: false,
  rawFees: 0,
  blockedAttempts: 0,
  okReads: 0,
  ...overrides,
});

describe("hit list reasons", () => {
  it("names a waiting hand-found link first, whatever else is true", () => {
    expect(hitListReason(facts({ handLinkWaiting: true, hasLink: false }))).toBe("link_waiting");
    expect(hitListReason(facts({ handLinkWaiting: true, view: "no_overdraft" }))).toBe("link_waiting");
  });

  it("tells a missing link from a blocked site, a wrong page and a thin read", () => {
    expect(hitListReason(facts({ hasLink: false }))).toBe("no_link");
    expect(hitListReason(facts({ blockedAttempts: 3 }))).toBe("blocked");
    expect(hitListReason(facts({ blockedAttempts: 3, okReads: 1 }))).toBe("not_a_schedule");
    expect(hitListReason(facts({}))).toBe("not_a_schedule");
    expect(hitListReason(facts({ rawFees: 4 }))).toBe("read_thin");
  });

  it("marks every overdraft-view row as live without an overdraft fee", () => {
    expect(hitListReason(facts({ view: "no_overdraft", rawFees: 20 }))).toBe("no_overdraft_read");
  });
});

describe("getHitList", () => {
  it("reads same-scale deposits, filters the state and caps the limit", async () => {
    const { db, calls } = createDb([
      {
        id: "41", institution_name: "Old National Bank", state_code: "in ", charter_type: "bank", deposits: "41000000",
        fee_schedule_url: null, website_url: "https://www.oldnational.com", live_types: 0, has_extra_link: false,
        hand_link_waiting: false, raw_fees: "0", documents: "0", blocked_attempts: "2", ok_reads: "0",
        last_tried_at: "2026-10-07T12:00:00Z", total: "5151",
      },
    ]);
    const list = await getHitList({ db, stateCode: " in", limit: 5000 });
    expect(list.total).toBe(5151);
    expect(list.rows[0]).toMatchObject({ institutionId: 41, stateCode: "IN", deposits: 41_000_000, reason: "no_link" });
    const [call] = calls;
    expect(call.values).toContainEqual(["fdic", "ncua"]);
    expect(call.values).toContain("IN");
    expect(call.values).toContain(1000);
    expect(call.values).toContain("no_fees");
  });

  it("falls back to the no-fees view and ignores a bad state code", async () => {
    const { db, calls } = createDb([]);
    const list = await getHitList({ db, view: "bogus" as never, stateCode: "Texas" });
    expect(list).toEqual({ rows: [], total: 0 });
    expect(calls[0].values).toContain("no_fees");
    expect(calls[0].values).not.toContain("TEXAS");
  });
});
