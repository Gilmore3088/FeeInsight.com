import { describe, expect, it, vi } from "vitest";
import { cityRepairDetail, displayCity, HAND_CITY_REPAIRS, runCityRepair, summarizeCityRepair } from "./city-repair";

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
  it("#1213: restores the three cuts the branch file cannot, only while they still read as cut", async () => {
    expect(HAND_CITY_REPAIRS.map((h) => [h.institutionId, h.newCity])).toEqual([
      [7011, "North Little Rock"],
      [5738, "Palm Beach Gardens"],
      [6714, "Saratoga Springs"],
    ]);
    for (const h of HAND_CITY_REPAIRS) {
      expect(h.oldCity.length).toBe(15);
      expect(h.newCity.toUpperCase().startsWith(h.oldCity.toUpperCase())).toBe(true);
    }
    const handRow = { id: 6714, state_code: "NY", old_city: "Saratoga Spring", new_city: "Saratoga Springs", choices: 1 };
    const { db, calls } = mockDb([handRow], [{ id: 6714 }]);
    const result = await runCityRepair({ db, live: true });
    expect(result.repaired.map((c) => [c.institutionId, c.newCity])).toEqual([[6714, "Saratoga Springs"]]);
    // The hand list is read only where the stored city is still the cut, and the branch file skips its ids.
    expect(calls[0]).toContain("WHERE btrim(i.city) = h.old_city");
    expect(calls[0]).toContain("i.id <> ALL(");
  });

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
