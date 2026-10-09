import { describe, expect, it } from "vitest";
import { isBankingPost, toFeeBills, toPressStories, toRegulatorPosts } from "./state-news";

describe("state news shaping", () => {
  it("puts fee posts first, then newest, and reads the state from the source", () => {
    const posts = toRegulatorPosts([
      { source: "state:ny", title: "Kansas Bank Commissioner to Retire", link: "https://a", published_at: "2026-10-01T00:00:00.000Z" },
      { source: "state:ny", title: "Jobs in the 605 Statewide Virtual Hiring Event", link: "https://x", published_at: "2026-10-07T00:00:00.000Z" },
      { source: "state:ny", title: "DFS proposes limits on bank overdraft fees", link: "https://b", published_at: "2026-09-01T00:00:00.000Z" },
      { source: "state:ny", title: "DFS warns of scam calls", link: "https://c", published_at: null },
    ]);
    // The hiring event comes from a department-wide feed and is dropped.
    expect(posts.map((p) => p.link)).toEqual(["https://b", "https://a", "https://c"]);
    expect(posts[0]).toMatchObject({ state_code: "NY", fee_related: true, published_at: "2026-09-01" });
  });

  it("keeps banking posts and drops other divisions' news (headlines from prod, Oct 8 2026)", () => {
    for (const kept of [
      "Kansas Joins $15.5 Million Settlement with Mortgage Servicer NewRez LLC",
      "Consumer Alert: The Fine Print Behind Social Media’s Credit Repair Promises",
      "Banking Commissioner Announces 2026 Deposit Index",
      "2026-09-17 Electronic Bulletin",
      "Kansas Office of the State Bank Commissioner Closes Small Business Bank, Lenexa, Kansas, Appoints Federal Deposit Insurance Corporation as Receiver",
      "Don’t let scammers steal your holiday spirit",
      "New York State Department of Financial Services and Wyoming Division of Banking Sign MOU to Enable Coordinated Oversight of Virtual Currency and Digital Asset Activities",
    ])expect(isBankingPost(kept), kept).toBe(true);
    for (const dropped of [
      "Jobs in the 605 Statewide Virtual Hiring Event",
      "Investigation uncovers illegal cannabis operation in Torrance County",
      "RESIDENTS URGED TO FILE INSURANCE CLAIMS AFTER SEVERE WEATHER",
      "Department of Financial Services Announces 2027 Health Insurance Premium Rates, Saving New Yorkers $1.6 Billion",
      "FREE EMISSIONS FIX AVAILABLE FOR AFFECTED MERCEDES-BENZ DIESEL OWNERS IN HAWAIʻI",
      "NYSIF Collaborates with Cities for Financial Empowerment Fund to Expand Safe Banking Access for Injured Workers",
      // The agency's name alone does not make a post about banking (prod, Oct 8 2026).
      "Department of Financial Services Announces Return of Painting to Heirs of Family Persecuted by Nazi Regime",
    ]) expect(isBankingPost(dropped), dropped).toBe(false);
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

  it("sets all-caps headlines in title case and moves date-only bulletins last (prod, Oct 8 2026)", () => {
    const posts = toRegulatorPosts([
      { source: "state:MO", title: "2026-09-17 Electronic Bulletin", link: "https://mo1", published_at: "2026-09-17T00:00:00.000Z" },
      { source: "state:MO", title: "2026-09-01 Electronic Bulletin", link: "https://mo2", published_at: "2026-09-01T00:00:00.000Z" },
      { source: "state:MO", title: "2025-11-04 - Electronic Bulletin", link: "https://mo3", published_at: "2025-11-04T00:00:00.000Z" },
      {
        source: "state:HI",
        title: "HAWAIʻI OFFICE OF CONSUMER PROTECTION ANNOUNCES SETTLEMENT WITH SUBPRIME AUTO LENDER CREDIT ACCEPTANCE CORPORATION",
        link: "https://hi",
        published_at: "2026-09-23T18:41:08.000Z",
      },
      { source: "state:KS", title: "Banking Commissioner Announces 2026 Deposit Index", link: "https://ks", published_at: "2025-06-01T00:00:00.000Z" },
    ]);
    expect(posts.map((p) => [p.link, p.title])).toEqual([
      ["https://hi", "Hawaiʻi Office of Consumer Protection Announces Settlement with Subprime Auto Lender Credit Acceptance Corporation"],
      ["https://ks", "Banking Commissioner Announces 2026 Deposit Index"],
      // Only the newest bulletin per state, under its plain name; the date is shown beside it.
      ["https://mo1", "Electronic bulletin"],
    ]);
  });
});
