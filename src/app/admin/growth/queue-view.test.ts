import { describe, expect, it } from "vitest";
import type { ContentDraft } from "@/lib/data-store/content-drafts";
import { filterHref, filterQueue, parseQueueFilter } from "./queue-view";

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
});
