import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sql: vi.fn(), getWorkspaceBriefing: vi.fn(), confirmed: vi.fn() }));
vi.mock("@/lib/data-store/connection", () => ({ sql: mocks.sql }));
vi.mock("@/lib/report-assemblers/monthly-pulse", () => ({ loadConfirmedFeeChanges: mocks.confirmed }));
vi.mock("@/lib/hamilton/workspace/research", () => ({ getWorkspaceBriefing: mocks.getWorkspaceBriefing }));

import { getQuarterlyChanges, runBriefingRefresh, summarizeBriefingRefresh } from "./briefing-snapshots";

const brief = (current: number) => ({
  institutionId: 1,
  institutionName: "Home Bank",
  observations: [],
  positions: [{ feeCategory: "overdraft", displayName: "Overdraft", current, band: null, peerLabel: "Texas banks" }],
  stateCode: "TX",
  generatedAt: "2026-10-07T15:07:00Z",
  provenance: { engineVersion: "1.12.1" },
});

function install({ workspaces = [1], stored = [] as Array<{ institution_id: number; quarter: string }>, inserted = true } = {}) {
  mocks.sql.mockImplementation((strings: TemplateStringsArray) => {
    const text = strings.join("?");
    if (text.includes("FROM institution_workspace_memberships")) return Promise.resolve(workspaces.map((id) => ({ institution_id: id })));
    if (text.includes("SELECT institution_id, quarter")) return Promise.resolve(stored);
    if (text.includes("SELECT briefing FROM")) return Promise.resolve([{ briefing: JSON.stringify(brief(30)) }]);
    if (text.includes("INSERT INTO hamilton_briefing_snapshots")) return Promise.resolve(inserted ? [{ institution_id: 1 }] : []);
    return Promise.resolve([]);
  });
}

const inserts = () => mocks.sql.mock.calls.filter((c) => (c[0] as TemplateStringsArray).join("?").includes("INSERT INTO"));
const now = new Date("2026-10-07T15:07:00Z");

describe("runBriefingRefresh", () => {
  beforeEach(() => {
    mocks.sql.mockReset();
    mocks.getWorkspaceBriefing.mockReset();
    mocks.getWorkspaceBriefing.mockResolvedValue(brief(35));
  });

  it("stores one briefing per workspace per quarter and compares it with the last quarter", async () => {
    install({ stored: [{ institution_id: 1, quarter: "2026-Q3" }] });
    const result = await runBriefingRefresh({ now, runId: 9 });
    expect(result).toMatchObject({ quarter: "2026-Q4", workspaces: 1, stored: 1, withPreviousQuarter: 1 });
    expect(result.previews[0]).toMatchObject({ institutionName: "Home Bank", changes: 1 });
    expect(inserts()).toHaveLength(1);
    expect(summarizeBriefingRefresh(result)).toContain("stored 1");
  });

  it("counts a Pro reader's saved bank as well as paid seats", async () => {
    install({ workspaces: [] });
    await runBriefingRefresh({ now });
    const query = (mocks.sql.mock.calls[0][0] as TemplateStringsArray).join("?");
    expect(query).toContain("FROM hamilton_workspace_contexts");
  });

  it("skips a workspace that already has this quarter's copy", async () => {
    install({ stored: [{ institution_id: 1, quarter: "2026-Q4" }] });
    const result = await runBriefingRefresh({ now });
    expect(result).toMatchObject({ stored: 0, alreadyStored: 1 });
    expect(mocks.getWorkspaceBriefing).not.toHaveBeenCalled();
  });

  it("builds without storing on a dry run, even for an institution without a workspace", async () => {
    install({ workspaces: [] });
    const result = await runBriefingRefresh({ now, dryRun: true, institutionId: 224 });
    expect(result).toMatchObject({ dryRun: true, workspaces: 1, stored: 0 });
    expect(mocks.getWorkspaceBriefing).toHaveBeenCalledWith(224, now);
    expect(inserts()).toHaveLength(0);
  });

  it("counts a failed build and keeps going", async () => {
    install({ workspaces: [1, 2] });
    mocks.getWorkspaceBriefing.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(brief(35));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runBriefingRefresh({ now });
    expect(result).toMatchObject({ failed: 1, stored: 1 });
  });

  it("says plainly when there is no workspace", async () => {
    install({ workspaces: [] });
    expect(summarizeBriefingRefresh(await runBriefingRefresh({ now }))).toContain("No institution has an active workspace");
  });
});

describe("getQuarterlyChanges (#1083)", () => {
  it("is null with no stored copy, names the first copy, then compares the two newest", async () => {
    mocks.sql.mockReset();
    mocks.confirmed.mockReset();
    mocks.confirmed.mockResolvedValue({ changes: [], recorded: 0 });
    mocks.sql.mockResolvedValueOnce([]);
    expect(await getQuarterlyChanges(1)).toBeNull();
    mocks.sql.mockResolvedValueOnce([{ quarter: "2026-Q4", briefing: brief(35) }]);
    expect(await getQuarterlyChanges(1)).toEqual({ kind: "first", quarter: "2026-Q4" });
    mocks.sql.mockResolvedValueOnce([
      { quarter: "2026-Q4", briefing: brief(35) },
      { quarter: "2026-Q3", briefing: JSON.stringify(brief(30)) },
    ]);
    const changes = await getQuarterlyChanges(1);
    expect(changes?.kind === "diff" && changes.diff.changes[0].kind).toBe("own_record");
    expect(changes?.kind === "diff" && changes.diff.changes[0].text).toBe(
      "Overdraft: the figure on file moved from $30.00 to $35.00. No price change is confirmed on its schedules, so this is shown as an update to our data, not as a price change.",
    );
    expect(mocks.confirmed).toHaveBeenCalledWith("2026-10-07T15:07:00Z", "TX");
  });

  it("calls a moved own fee a price change only when the institution's confirmed change bears it out (#1891)", async () => {
    const stored = () => [
      { quarter: "2026-Q4", briefing: brief(35) },
      { quarter: "2026-Q3", briefing: brief(30) },
    ];
    const change = (institution_id: number) => ({ institution_id, fee_category: "overdraft", old_amount: 30, new_amount: 35, changed_at: "2026-09-15" });
    mocks.sql.mockReset();
    mocks.confirmed.mockReset();
    // Another institution's confirmed change never confirms this one's.
    mocks.confirmed.mockResolvedValueOnce({ changes: [change(2)], recorded: 1 });
    mocks.sql.mockResolvedValueOnce(stored());
    const other = await getQuarterlyChanges(1);
    expect(other?.kind === "diff" && other.diff.changes[0].kind).toBe("own_record");
    mocks.confirmed.mockResolvedValueOnce({ changes: [change(1)], recorded: 1 });
    mocks.sql.mockResolvedValueOnce(stored());
    const own = await getQuarterlyChanges(1);
    expect(own?.kind === "diff" && own.diff.changes[0].kind).toBe("own_price");
    // A failed read confirms nothing.
    mocks.confirmed.mockRejectedValueOnce(new Error("db"));
    mocks.sql.mockResolvedValueOnce(stored());
    const failed = await getQuarterlyChanges(1);
    expect(failed?.kind === "diff" && failed.diff.changes[0].kind).toBe("own_record");
  });

  it("shows nothing for a stored copy it cannot read", async () => {
    mocks.sql.mockReset();
    mocks.sql.mockResolvedValueOnce([
      { quarter: "2026-Q4", briefing: brief(35) },
      { quarter: "2026-Q3", briefing: "{not json" },
    ]);
    expect(await getQuarterlyChanges(1)).toBeNull();
  });
});
