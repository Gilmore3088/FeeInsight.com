import { describe, expect, it } from "vitest";
import {
  isBankingPost,
  mergeStateWire,
  toFeeBills,
  toPressStories,
  toRegulatorPosts,
  toWireBills,
  type StateWireBill,
} from "./state-news";

describe("state wire: one chronological feed", () => {
  // Headlines from prod (Oct 2026); the bill is a made-up fixture (no bills are stored yet).
  const regulators = toRegulatorPosts([
    {
      source: "state:NY",
      title:
        "New York State Department of Financial Services and Wyoming Division of Banking Sign MOU to Enable Coordinated Oversight of Virtual Currency and Digital Asset Activities",
      link: "https://ny/mou",
      published_at: "2026-10-01T00:00:00.000Z",
    },
    { source: "state:KS", title: "Kansas Joins $15.5 Million Settlement with Mortgage Servicer NewRez LLC", link: "https://ks/newrez", published_at: "2026-09-18T00:00:00.000Z" },
    // A department-wide feed's post the banking filter drops: it must not count anywhere.
    { source: "state:SD", title: "Jobs in the 605 Statewide Virtual Hiring Event", link: "https://sd/jobs", published_at: "2026-10-07T00:00:00.000Z" },
    { source: "state:NY", title: "DFS proposes limits on bank overdraft fees", link: "https://ny/od", published_at: null },
  ]);
  const press = toPressStories([
    {
      source: "news:CO",
      title: "Colorado lawmakers face a familiar question as they consider new financial regs: Is a paycheck advance a loan? - The Denver Post",
      link: "https://co/dp",
      published_at: "2026-03-31T12:00:00.000Z",
    },
  ]);
  const bills: StateWireBill[] = [
    { state_code: "CO", identifier: "HB 0000", title: "Fixture bill", stage: "in_committee", stage_on: "2026-10-01", url: null, introduced_on: "2026-02-01" },
    { state_code: "CO", identifier: "SB 0001", title: "Fixture bill without an action date", stage: "introduced", stage_on: null, url: null, introduced_on: "2026-09-30" },
  ];

  it("counts only what the banking filter keeps, so the total matches the pages", () => {
    const page = mergeStateWire({ regulators, press, bills });
    expect(page.counts).toEqual({ bills: 2, regulators: 3, press: 1 });
    expect(page.total).toBe(6);
    expect(page.items.some((i) => i.kind === "regulator" && i.link === "https://sd/jobs")).toBe(false);
  });

  it("orders newest first across kinds, official before press on the same day, undated last", () => {
    const page = mergeStateWire({ regulators, press, bills });
    expect(page.items.map((i) => `${i.kind}:${i.date}`)).toEqual([
      "bill:2026-10-01",
      "regulator:2026-10-01",
      "bill:2026-09-30",
      "regulator:2026-09-18",
      "press:2026-03-31",
      "regulator:null",
    ]);
  });

  it("filters by kind but keeps every kind's count", () => {
    const page = mergeStateWire({ regulators, press, bills }, { kind: "press" });
    expect(page.items.map((i) => i.kind)).toEqual(["press"]);
    expect(page.total).toBe(1);
    expect(page.counts).toEqual({ bills: 2, regulators: 3, press: 1 });
    const story = page.items[0];
    expect(story.kind === "press" && story.publisher).toBe("The Denver Post");
  });

  it("pages with limit and offset, clamping a page past the end to the last page", () => {
    const parts = { regulators, press, bills };
    expect(mergeStateWire(parts, { limit: 4, offset: 0 }).items).toHaveLength(4);
    const second = mergeStateWire(parts, { limit: 4, offset: 4 });
    expect(second).toMatchObject({ total: 6, offset: 4 });
    expect(second.items.map((i) => i.date)).toEqual(["2026-03-31", null]);
    expect(mergeStateWire(parts, { limit: 4, offset: 40 }).offset).toBe(4);
    expect(mergeStateWire({ regulators: [], press: [], bills: [] }, { offset: 50 })).toMatchObject({ items: [], total: 0, offset: 0 });
  });

  it("keeps a bill's introduction date beside its latest action", () => {
    const [bill] = toWireBills([
      { jurisdiction: "co", identifier: "HB 0000", title: "Fixture", stage: "introduced", stage_on: null, url: null, published_on: new Date("2026-02-01T00:00:00Z") },
    ]);
    expect(bill).toMatchObject({ state_code: "CO", stage_on: null, introduced_on: "2026-02-01" });
  });
});

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
});
