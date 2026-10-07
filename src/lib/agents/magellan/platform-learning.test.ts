import { describe, expect, it, vi } from "vitest";

import { addPathFacts, createPlatformLearner, rankPeerPaths, rankPlatformPaths, type PathFactRow } from "./platform-learning";

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
