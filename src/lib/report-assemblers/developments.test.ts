import { describe, expect, it } from "vitest";
import { buildDevelopments, classifyRelease, countByAgency, itemsNamingState, type RawReleaseRow } from "./developments";

describe("classifyRelease", () => {
  it("sorts releases by their titles", () => {
    expect(classifyRelease("Federal Reserve Board issues enforcement action with Ontario Bancorporation, Inc.", "FED")).toBe("enforcement");
    expect(classifyRelease("Press Release: FDIC Publishes Enforcement Orders for August 2026", "FDIC")).toBe("enforcement");
    expect(classifyRelease("Press Release: Sunwest Bank Assumes All Deposits and Certain Assets of Nano Banc", "FDIC")).toBe("structure");
    expect(classifyRelease("Federal Reserve Board announces approval of application by Peoples Bancorp Inc.", "FED")).toBe("structure");
    expect(classifyRelease("The CFPB to Cease Discretionary Publication of Complaint Narratives", "CFPB")).toBe("consumer");
    expect(classifyRelease("Agencies seek comment on proposed third-party risk management guidance", "FED")).toBe("rulemaking");
    expect(classifyRelease("FDIC-Insured Institutions Reported Return on Assets of 1.37 Percent", "FDIC")).toBe("industry");
    expect(classifyRelease("Federal Reserve issues FOMC statement", "FED")).toBe("industry");
  });

  it("drops calendar notices", () => {
    expect(classifyRelease("Sunshine Act Notice: FDIC Board of Directors Meeting", "FDIC")).toBeNull();
    expect(classifyRelease("Minutes of the Board's discount rate meetings on July 20", "FED")).toBeNull();
  });
});

describe("buildDevelopments", () => {
  const rows: RawReleaseRow[] = [
    { source: "FDIC", topic: "general", title: "Press Release: Agencies Seek Comment on Proposed Guidance", link: "https://fdic.example/1", published_at: "2026-09-11T14:05:21.000Z" },
    { source: "OCC", topic: "general", title: "Agencies Seek Comment on Proposed Guidance", link: "https://occ.example/1", published_at: "2026-09-11T14:00:00.000Z" },
    { source: "FED", topic: "general", title: "Federal Reserve issues FOMC statement", link: "https://fed.example/1", published_at: "2026-09-16T18:00:00.000Z" },
    { source: "FED", topic: "general", title: "Old release", link: "https://fed.example/0", published_at: "2026-01-01T00:00:00.000Z" },
    { source: "FDIC", topic: "general", title: "Sunshine Act Notice: FDIC Board of Directors Meeting", link: "https://fdic.example/2", published_at: "2026-09-15T00:00:00.000Z" },
  ];

  it("lists a joint release once, names each agency, and keeps the window", () => {
    const items = buildDevelopments(rows, "2026-07-08", "2026-10-06");
    expect(items.map((i) => i.title)).toEqual(["Federal Reserve issues FOMC statement", "Agencies Seek Comment on Proposed Guidance"]);
    expect(items[1].agencies).toEqual(["FDIC", "OCC"]);
    expect(countByAgency(items)).toEqual([
      { agency: "FDIC", count: 1 },
      { agency: "FED", count: 1 },
      { agency: "OCC", count: 1 },
    ]);
  });

  it("finds releases that name a state as a whole word", () => {
    const items = buildDevelopments(
      [
        { source: "FDIC", topic: null, title: "Bank of Tennessee assumes deposits", link: "https://x/1", published_at: "2026-09-01T00:00:00Z" },
        { source: "FDIC", topic: null, title: "Tennesseeans unaffected", link: "https://x/2", published_at: "2026-09-02T00:00:00Z" },
      ],
      "2026-07-08",
      "2026-10-06",
    );
    expect(itemsNamingState(items, "Tennessee").map((i) => i.link)).toEqual(["https://x/1"]);
  });
});
