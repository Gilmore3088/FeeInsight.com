import { describe, expect, it } from "vitest";
import type { StateWireItem } from "@/lib/data-store/state-news";
import { buildWireDigest, wireDigestHasItems, wireDigestLines } from "./wire-digest";
import { researchKey, type ResearchNote } from "./wire-research";

const now = new Date("2026-10-08T15:00:00Z");

const bill = (state: string, identifier: string, title: string, stageOn: string, trackerId?: string): StateWireItem => ({
  kind: "bill",
  date: stageOn,
  state_code: state,
  identifier,
  title,
  stage: "in_committee",
  stage_on: stageOn,
  introduced_on: "2026-02-01",
  url: `https://openstates.org/${state}/${identifier}`,
  tracker_id: trackerId,
});
const post = (state: string, title: string, at: string, guid: string): StateWireItem => ({
  kind: "regulator",
  date: at,
  state_code: state,
  title,
  link: `https://dfpi.example/${guid}`,
  published_at: at,
  fee_related: false,
  guid,
});
const story = (state: string, headline: string, at: string): StateWireItem => ({
  kind: "press",
  date: at,
  state_code: state,
  headline,
  publisher: "Example Times",
  link: `https://news.example/${encodeURIComponent(headline)}`,
  published_at: at,
});

const note = (kind: "article" | "tracker", id: string, summary: string, status: ResearchNote["status"] = "ok"): [string, ResearchNote] => [
  researchKey(kind, id),
  {
    itemKind: kind, itemId: id, status, reason: null, summary, actionType: null, commentDeadline: null,
    effectiveDate: null, whyItMatters: null, dockets: [], sourceUrl: "https://x.example", model: "m", createdAt: null,
  },
];

describe("weekly Wire digest grouping", () => {
  const stateItems = [
    bill("CA", "AB 12", "Overdraft fee limits", "2026-10-06", "open_states:ab12"),
    post("CA", "DFPI issues guidance on overdraft fees", "2026-10-05T12:00:00Z", "g1"),
    story("CA", "Lawmakers push overdraft cap", "2026-10-07T09:00:00Z"),
    post("CA", "Old post outside the week", "2026-09-20T12:00:00Z", "g0"),
    bill("TX", "HB 3", "ATM surcharge disclosure", "2026-10-02"),
    story("NY", "Not a watched state", "2026-10-07T09:00:00Z"),
  ];
  const federal = [
    { guid: "f1", source: "CFPB", title: "CFPB issues overdraft rule", link: "https://cfpb.example/1", published_at: "2026-10-06T14:00:00Z" },
    { guid: "f2", source: "FED", title: "Federal Reserve announces approval", link: "https://fed.example/2", published_at: "2026-10-07T14:00:00Z" },
    { guid: "f3", source: "FDIC", title: "Last month", link: "https://fdic.example/3", published_at: "2026-09-01T14:00:00Z" },
  ];
  const notes = new Map([
    note("tracker", "open_states:ab12", "The bill would cap overdraft fees."),
    note("article", "f1", "The CFPB finalized a rule."),
    note("article", "g1", "Not kept", "source_unreadable"),
  ]);

  const digest = buildWireDigest({ states: ["tx", "CA"], stateItems, federal, notes, now });

  it("has one section per watched state, alphabetical, then the federal agencies", () => {
    expect(digest.sections.map((s) => s.jurisdiction)).toEqual(["CA", "TX", "federal"]);
    expect(digest.sections.map((s) => s.name)).toEqual(["California", "Texas", "Federal agencies"]);
  });

  it("groups a state's items by kind in a fixed order and leaves out items outside 7 days and other states", () => {
    const ca = digest.sections[0];
    expect(ca.groups.map((g) => g.label)).toEqual(["Legislation", "Regulators", "Press"]);
    expect(ca.total).toBe(3);
    expect(ca.groups[1].items.map((i) => i.title)).toEqual(["DFPI issues guidance on overdraft fees"]);
    expect(digest.total).toBe(6);
  });

  it("groups federal items by agency, Fed first, and keeps fee-type tags", () => {
    const fed = digest.sections[2];
    expect(fed.groups.map((g) => g.label)).toEqual(["Federal Reserve", "CFPB"]);
    expect(fed.groups[1].items[0].feeTypes).toEqual(["overdraft"]);
    expect(digest.sections[1].groups[0].items[0].feeTypes).toEqual(["atm"]);
  });

  it("adds a summary only where stage 2 wrote one that passed its checks; press never gets one", () => {
    const ca = digest.sections[0];
    expect(ca.groups[0].items[0].summary).toBe("The bill would cap overdraft fees.");
    expect(ca.groups[1].items[0].summary).toBeNull();
    expect(ca.groups[2].items[0].summary).toBeNull();
    expect(digest.sections[2].groups[1].items[0].summary).toBe("The CFPB finalized a rule.");
    expect(digest.summaries).toBe(2);
  });

  it("keeps a watched state with nothing new, and has only the federal section without watched states", () => {
    const quiet = buildWireDigest({ states: ["VT"], stateItems, federal: [], now });
    expect(quiet.sections[0]).toMatchObject({ jurisdiction: "VT", total: 0, groups: [] });
    expect(wireDigestHasItems(quiet)).toBe(false);
    const none = buildWireDigest({ states: [], stateItems: [], federal, now });
    expect(none.sections.map((s) => s.jurisdiction)).toEqual(["federal"]);
  });

  it("renders email lines with labelled AI summaries and a link when a section runs long", () => {
    const lines = wireDigestLines(digest, "https://feeinsight.com/");
    expect(lines[0]).toBe("Regulatory Wire: Oct 1, 2026 to Oct 8, 2026");
    expect(lines).toContain("California: 3 item(s)");
    expect(lines).toContain("Legislation · Oct 6, 2026 · AB 12: Overdraft fee limits [Overdraft & NSF]");
    expect(lines).toContain("AI summary of the source text: The bill would cap overdraft fees.");
    const many = buildWireDigest({
      states: ["CA"],
      stateItems: Array.from({ length: 7 }, (_, i) => story("CA", `Story ${i}`, "2026-10-07T09:00:00Z")),
      federal: [],
      now,
    });
    expect(wireDigestLines(many, "https://feeinsight.com")).toContain("and 2 more: https://feeinsight.com/pro/news/digest");
  });
});
