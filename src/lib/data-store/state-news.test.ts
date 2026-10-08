import { describe, expect, it } from "vitest";
import { toFeeBills, toPressStories, toRegulatorPosts } from "./state-news";

describe("state news shaping", () => {
  it("puts fee posts first, then newest, and reads the state from the source", () => {
    const posts = toRegulatorPosts([
      { source: "state:ny", title: "DFS announces new superintendent", link: "https://a", published_at: "2026-10-01T00:00:00.000Z" },
      { source: "state:ny", title: "DFS proposes limits on bank overdraft fees", link: "https://b", published_at: "2026-09-01T00:00:00.000Z" },
      { source: "state:ny", title: "DFS warns of scam calls", link: "https://c", published_at: null },
    ]);
    expect(posts.map((p) => p.link)).toEqual(["https://b", "https://a", "https://c"]);
    expect(posts[0]).toMatchObject({ state_code: "NY", fee_related: true, published_at: "2026-09-01" });
  });

  it("splits the outlet off a press headline", () => {
    const [story] = toPressStories([
      { source: "news:CO", title: "Colorado lawmakers weigh paycheck advance rules - The Denver Post", link: "https://n", published_at: "2026-09-30T12:00:00.000Z" },
    ]);
    expect(story).toEqual({ state_code: "CO", headline: "Colorado lawmakers weigh paycheck advance rules", publisher: "The Denver Post", link: "https://n", published_at: "2026-09-30" });
  });

  it("keeps a bill's identifier and last action date", () => {
    const [bill] = toFeeBills([{ jurisdiction: "ny", identifier: "A 3428", title: "Limits overdraft fees", stage: "in_committee", stage_on: new Date("2026-03-02T00:00:00Z"), url: null }]);
    expect(bill).toEqual({ state_code: "NY", identifier: "A 3428", title: "Limits overdraft fees", stage: "in_committee", stage_on: "2026-03-02", url: null });
  });
});
