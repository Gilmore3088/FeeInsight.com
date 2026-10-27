import { describe, expect, it, vi } from "vitest";

import { addPathFacts, createPlatformLearner, pathNamesOwnSite, rankPeerPaths, rankPlatformPaths, type PathFactRow } from "./platform-learning";

function facts(rows: PathFactRow[]) {
  const result = { found: new Map<string, number>(), banks: new Map<string, number>(), good: new Map<string, number>(), rejected: new Map<string, number>() };
  for (const row of rows) addPathFacts(result, row);
  return result;
}

const link = (host: string, path: string, kind: string | null = null, live: number | null = null): PathFactRow => ({
  url: `https://${host}${path}`,
  rejected: [],
  yield_kind: kind,
  live_fees: live,
});

describe("one institution's file is never a path for another bank (#1455)", () => {
  // Prod, Oct 14-19: Sunrise Family CU's file, served by the website vendor on every member
  // domain, became Family First's (peer hint), then Beach Municipal's, First Pace's and
  // Alhambra's (platform path): 102 live fees from another CU's schedule.
  const SUNRISE = "/files/sunrisefamilycu/1/file/Fee-Schedule-11-2025.pdf";

  it("a link whose path names its own website teaches no path", () => {
    expect(pathNamesOwnSite(`https://www.sunrisefamilycu.org${SUNRISE}`)).toBe(true);
    expect(pathNamesOwnSite("https://www.fam1st.com/fee-schedule")).toBe(false);
    // A short website name is an ordinary word, not a bank's folder.
    expect(pathNamesOwnSite("https://fees.com/fees/schedule.pdf")).toBe(false);
    const learned = facts([link("sunrisefamilycu.org", SUNRISE, "produced_live_fees", 24)]);
    expect(learned.good.size).toBe(0);
    expect(rankPeerPaths(learned, [], null)).toEqual([]);
  });

  it("a vendor file-folder path is neither a peer hint nor a platform path, wherever it was found", () => {
    const learned = facts([
      link("sunrisefamilycu.org", SUNRISE, "produced_live_fees", 24),
      link("fam1st.com", SUNRISE, "produced_live_fees", 26),
      link("beachmunicipal.org", SUNRISE, "produced_live_fees", 26),
      link("a.bank", "/fee-schedule", "produced_live_fees", 14),
      link("b.bank", "/fee-schedule", null),
    ]);
    expect(rankPeerPaths(learned, [], null)).not.toContain(SUNRISE);
    expect(rankPlatformPaths(learned, [])).toEqual(["/fee-schedule"]);
  });

  it("a seeded path that is one site's file is not tried either", () => {
    const seeds = ["/fee-schedule", SUNRISE, "/getmedia/e5c2ff85-ac70-49e5-8a17-b870fb5bd34a/Consumer-Schedule-of-Fees-Services.pdf"];
    expect(rankPlatformPaths(facts([]), seeds)).toEqual(["/fee-schedule"]);
  });
});

describe("platform path learning scored by link yield", () => {
  it("promotes a path only when its links recur and produce fees", () => {
    const learned = facts([
      link("a.bank", "/fee-schedule", "produced_live_fees", 14),
      link("b.bank", "/fee-schedule", null),
      // Two banks hold this path, but both links were thin: it is not promoted.
      link("c.bank", "/personal/checking", "thin_link"),
      link("d.bank", "/personal/checking", "thin_link"),
    ]);
    expect(rankPlatformPaths(learned, [])).toEqual(["/fee-schedule"]);
  });

  it("drops a seeded path whose links Rosetta rules out or that are dead", () => {
    const learned = facts([
      link("a.bank", "/disclosures", "wrong_document"),
      link("b.bank", "/disclosures", "dead_link"),
      link("c.bank", "/fees", "produced_live_fees", 9),
      link("d.bank", "/fees", "produced_live_fees", 11),
    ]);
    expect(rankPlatformPaths(learned, ["/disclosures", "/schedule-of-fees"])).toEqual(["/fees", "/schedule-of-fees"]);
  });

  it("ranks peer hints nationwide by live fees, skipping platform paths and bank-specific paths", () => {
    const learned = facts([
      link("a.bank", "/fees", "produced_live_fees", 9),
      link("b.bank", "/fees", "produced_live_fees", 11),
      link("c.bank", "/documents/truth-in-savings.pdf", "produced_live_fees", 22),
      link("d.bank", "/resources/fee-schedule", "produced_live_fees", 6),
      link("e.bank", "/uploads/2024/03/fees.pdf", "produced_live_fees", 30),
      link("f.bank", "/rates", "thin_link"),
    ]);
    const platform = rankPlatformPaths(learned, []);
    expect(platform).toEqual(["/fees"]);
    expect(rankPeerPaths(learned, platform, null)).toEqual(["/documents/truth-in-savings.pdf", "/resources/fee-schedule"]);
    // A bank is never hinted its own failing link.
    expect(rankPeerPaths(learned, platform, "/resources/fee-schedule")).toEqual(["/documents/truth-in-savings.pdf"]);
  });

  it("learns from companion schedules once the ledger has judged them", () => {
    const companion = (host: string, path: string, kind: string | null, live: number | null = null): PathFactRow => ({
      ...link(host, path, kind, live),
      companion: true,
    });
    const learned = facts([
      // A schedule a person or the paid search added beside two banks' links, both live.
      companion("a.bank", "/disclosures/fee-schedule", "produced_live_fees", 21),
      companion("b.bank", "/disclosures/fee-schedule", "produced_live_fees", 26),
      // Not read yet: teaches nothing either way.
      companion("c.bank", "/rates-and-fees", null),
      companion("d.bank", "/rates-and-fees", null),
      // Added by hand and wrong: counts against its path.
      companion("e.bank", "/schedule-of-fees", "wrong_document"),
    ]);
    expect(rankPlatformPaths(learned, ["/schedule-of-fees"])).toEqual(["/disclosures/fee-schedule"]);
    expect(learned.found.has("/rates-and-fees")).toBe(false);
  });

  it("reads judged companion schedules on the platform with the ledger", async () => {
    const statements: string[] = [];
    const db = vi.fn(async (strings: TemplateStringsArray) => {
      const text = strings.join("?");
      statements.push(text);
      if (text.includes("to_regclass")) return [{ ready: true }];
      if (text.includes("FROM platform_registry")) return [{ fee_paths: [] }];
      if (text.includes("FROM institution_additional_sources")) {
        return [
          { ...link("a.bank", "/disclosures/fee-schedule", "produced_live_fees", 21), companion: true },
          { ...link("b.bank", "/disclosures/fee-schedule", "produced_live_fees", 26), companion: true },
        ];
      }
      if (text.includes("FROM institution_sources")) return [];
      return [];
    });
    const learner = createPlatformLearner(db as never);
    expect(await learner.platformPaths("q2")).toEqual(["/disclosures/fee-schedule"]);
    const companionQuery = statements.find((text) => text.includes("FROM institution_additional_sources"))!;
    expect(companionQuery).toContain("document_role = 'consumer_supplement'");
  });

  it("reads the ledger when the shared store exists, and still learns without it", async () => {
    const rows = [
      { id: 1, ...link("a.bank", "/fees", "produced_live_fees", 9) },
      { id: 2, ...link("b.bank", "/fees", "produced_live_fees", 5) },
      { id: 3, ...link("c.bank", "/docs/fee-schedule.pdf", "produced_live_fees", 12) },
    ];
    for (const ready of [true, false]) {
      const statements: string[] = [];
      const db = vi.fn(async (strings: TemplateStringsArray) => {
        const text = strings.join("?");
        statements.push(text);
        if (text.includes("to_regclass")) return [{ ready }];
        if (text.includes("FROM platform_registry")) return [{ fee_paths: [] }];
        if (text.includes("FROM institution_sources")) return ready ? rows : rows.map((row) => ({ id: row.id, url: row.url, rejected: row.rejected }));
        return [];
      });
      const learner = createPlatformLearner(db as never);
      expect(await learner.platformPaths("q2")).toEqual(["/fees"]);
      expect(await learner.peerPaths("q2", "TX", 99)).toEqual(ready ? ["/docs/fee-schedule.pdf"] : []);
      expect(statements.some((text) => text.includes("FROM pipeline_feedback"))).toBe(ready);
    }
  });
});
