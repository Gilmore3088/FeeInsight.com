import { describe, expect, it, vi } from "vitest";
import { cityRepairDetail, displayCity, runCityRepair, summarizeCityRepair } from "./city-repair";

type Row = Record<string, unknown>;

/** A tagged-template db mock: the candidate read returns `candidates`, the update returns `written`. */
function mockDb(candidates: Row[], written: Row[]) {
  const calls: string[] = [];
  const db = vi.fn((strings: TemplateStringsArray) => {
    const text = strings.join(" ");
    calls.push(text);
    if (text.includes("UPDATE institution_sources")) return Promise.resolve(written);
    return Promise.resolve(candidates);
  });
  return { db: db as unknown as NonNullable<Parameters<typeof runCityRepair>[0]>["db"], calls };
}

// Real cuts from prod (#1317): ids from the 2026-10-14 read.
const COLORADO = { id: 101, state_code: "CO", old_city: "Colorado Spring", new_city: "COLORADO SPRINGS", choices: 1 };
const LITTLE_ROCK = { id: 102, state_code: "AR", old_city: "NORTH LITTLE RO", new_city: "North Little Rock", choices: 1 };
const TWO_NAMES = { id: 103, state_code: "NY", old_city: "Saratoga Spring", new_city: "Saratoga Springs", choices: 2 };

describe("displayCity", () => {
  it("title-cases a name the branch file wrote in capitals", () => {
    expect(displayCity("DEFUNIAK SPRINGS")).toBe("Defuniak Springs");
    expect(displayCity("SAULT SAINTE MARIE")).toBe("Sault Sainte Marie");
    expect(displayCity("O'FALLON HEIGHTS")).toBe("O'Fallon Heights");
  });
  it("keeps a mixed-case name as the regulator wrote it", () => {
    expect(displayCity("North Little Rock")).toBe("North Little Rock");
  });
});

describe("runCityRepair", () => {
  it("restores each cut with one longer office city and leaves two-name credit unions alone", async () => {
    const { db, calls } = mockDb([COLORADO, LITTLE_ROCK, TWO_NAMES], [{ id: 101 }, { id: 102 }]);
    const result = await runCityRepair({ db, live: true });
    expect(result.candidates.map((c) => [c.institutionId, c.newCity])).toEqual([
      [101, "Colorado Springs"],
      [102, "North Little Rock"],
    ]);
    expect(result.ambiguous).toBe(1);
    expect(result.repaired).toHaveLength(2);
    // Only rows still holding the cut name are written, so a second run changes nothing.
    expect(calls[1]).toContain("btrim(s.city) = c.old_city");
    expect(summarizeCityRepair(result)).toBe(
      "Atlas restored 2 of 2 credit union cities cut at 15 characters from NCUA's branch file. 1 left for a person (two possible names).",
    );
  });

  it("writes nothing on a dry run and lists what it would change", async () => {
    const { db, calls } = mockDb([COLORADO], []);
    const result = await runCityRepair({ db, live: true, dryRun: true });
    expect(calls).toHaveLength(1);
    expect(result.repaired).toEqual([]);
    expect(cityRepairDetail(result)).toMatchObject({
      candidates: 1,
      repaired: 0,
      changes: [{ id: 101, state: "CO", old_city: "Colorado Spring", new_city: "Colorado Springs" }],
    });
    expect(summarizeCityRepair(result)).toContain("changed none (dry run)");
  });

  it("writes nothing when switched off", async () => {
    const { db, calls } = mockDb([COLORADO], []);
    const result = await runCityRepair({ db, live: false });
    expect(calls).toHaveLength(1);
    expect(summarizeCityRepair(result)).toContain("changed none (switched off)");
  });

  it("counts only the rows the update actually changed", async () => {
    const { db } = mockDb([COLORADO, LITTLE_ROCK], [{ id: 102 }]);
    const result = await runCityRepair({ db, live: true });
    expect(result.repaired.map((c) => c.institutionId)).toEqual([102]);
  });

  it("says so when nothing is left to restore", async () => {
    const { db, calls } = mockDb([], []);
    const result = await runCityRepair({ db, live: true });
    expect(calls).toHaveLength(1);
    expect(summarizeCityRepair(result)).toBe("Atlas found no credit union city cut at 15 characters that the branch file can restore.");
  });
});
