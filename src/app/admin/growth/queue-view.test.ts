import { describe, expect, it } from "vitest";
import type { ContentDraft } from "@/lib/data-store/content-drafts";
import { GROWTH_VIEWS, filterHref, filterQueue, parseGrowthPage, parseGrowthView, parseQueueFilter, sectionFor, viewHref } from "./queue-view";

const item = (id: number, agent: string, kind: string) => ({ id, agent, kind }) as ContentDraft;

describe("growth queue filter", () => {
  it("keeps only roster agents and known kinds from the query", () => {
    expect(parseQueueFilter({ agent: "ernest", kind: "article" })).toEqual({ agent: "ernest", kind: "article" });
    expect(parseQueueFilter({ agent: "atlas", kind: ["nope"] })).toEqual({ agent: null, kind: null });
  });

  it("filters by agent and kind together", () => {
    const items = [item(1, "murrow", "linkedin_post"), item(2, "ernest", "article"), item(3, "ernest", "pull_request")];
    expect(filterQueue(items, { agent: "ernest", kind: null }).map((i) => i.id)).toEqual([2, 3]);
    expect(filterQueue(items, { agent: "ernest", kind: "pull_request" }).map((i) => i.id)).toEqual([3]);
    expect(filterQueue(items, { agent: null, kind: null })).toHaveLength(3);
  });

  it("builds links that keep the other filter", () => {
    expect(filterHref({ agent: "ernest", kind: null }, { kind: "article" })).toBe("/admin/growth?agent=ernest&kind=article");
    expect(filterHref({ agent: "ernest", kind: "article" }, { agent: null })).toBe("/admin/growth?kind=article");
    expect(filterHref({ agent: null, kind: null }, {})).toBe("/admin/growth");
  });

  it("keeps the view in filter links, leaving the default view out", () => {
    expect(filterHref({ agent: null, kind: null }, { agent: "murrow" }, "approved")).toBe("/admin/growth?view=approved&agent=murrow");
    expect(filterHref({ agent: "murrow", kind: null }, { agent: null }, "review")).toBe("/admin/growth");
  });
});

describe("growth page view", () => {
  it("defaults to review and ignores unknown views", () => {
    expect(parseGrowthView({})).toBe("review");
    expect(parseGrowthView({ view: "nope" })).toBe("review");
    expect(parseGrowthView({ view: ["team", "done"] })).toBe("team");
    for (const view of GROWTH_VIEWS) expect(parseGrowthView({ view })).toBe(view);
  });

  it("parses the view and filter together", () => {
    expect(parseGrowthPage({ view: "skipped", agent: "ernest", kind: "bad" })).toEqual({
      view: "skipped",
      filter: { agent: "ernest", kind: null },
    });
  });

  it("links to another view keeping the filter", () => {
    const state = { view: "review" as const, filter: { agent: "ernest" as const, kind: null } };
    expect(viewHref(state, "team")).toBe("/admin/growth?view=team&agent=ernest");
    expect(viewHref(state, "review")).toBe("/admin/growth?agent=ernest");
  });

  it("maps each queue view to its status and the team view to none", () => {
    expect(sectionFor("review")?.status).toBe("draft");
    expect(sectionFor("approved")?.status).toBe("approved");
    expect(sectionFor("done")?.status).toBe("posted");
    expect(sectionFor("skipped")?.status).toBe("skipped");
    expect(sectionFor("team")).toBeNull();
  });
});
