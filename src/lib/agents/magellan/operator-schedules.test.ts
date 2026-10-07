import { describe, expect, it, vi } from "vitest";

import { addOperatorSchedules, OPERATOR_SCHEDULES, type OperatorSchedule } from "./operator-schedules";

type DbMock = ReturnType<typeof vi.fn>;
const text = (strings: unknown) => (Array.isArray(strings) ? strings.join(" ") : String(strings));
const asDb = (db: DbMock) => db as unknown as NonNullable<Parameters<typeof addOperatorSchedules>[0]["db"]>;

const chase: OperatorSchedule = {
  institutionId: 1,
  institutionName: "JPMorgan Chase Bank, National Association",
  url: "https://www.chase.com/content/dam/chase-ux/documents/personal/checking/ABSF-en.pdf",
  givenBy: "James, 2026-10-07 00:51",
};

function createDb(held: Array<{ institution_id: number; url: string | null }>, insertReturns = [{ id: 7 }]): DbMock {
  return vi.fn((strings: TemplateStringsArray) => {
    const sqlText = text(strings);
    if (sqlText.includes("UNION ALL")) return Promise.resolve(held);
    if (sqlText.includes("INSERT INTO institution_additional_sources")) return Promise.resolve(insertReturns);
    return Promise.resolve([]);
  });
}
const inserts = (db: DbMock) => db.mock.calls.filter((call) => text(call[0]).includes("INSERT INTO institution_additional_sources"));
const attempts = (db: DbMock) => db.mock.calls.filter((call) => text(call[0]).includes("INSERT INTO pipeline_attempts"));

describe("schedules James found by hand", () => {
  it("adds a schedule the bank does not hold as a consumer companion, with its attempt", async () => {
    const db = createDb([{ institution_id: 1, url: "https://www.jpmorganchase.com/ir/news/2021/press-release" }]);
    const result = await addOperatorSchedules({ db: asDb(db), runId: 5, schedules: [chase] });
    expect(result.added).toEqual([{ institutionId: 1, url: chase.url }]);
    const [insert] = inserts(db);
    expect(text(insert[0])).toContain("'consumer_supplement'");
    expect(insert).toContain(chase.url);
    expect(insert).toContain("pdf");
    expect(attempts(db)).toHaveLength(1);
    expect(db.mock.calls.some((call) => text(call[0]).includes("UPDATE institution_sources"))).toBe(false);
  });

  it("leaves a schedule the bank already holds, and an institution that does not exist", async () => {
    const held = createDb([{ institution_id: 1, url: chase.url }]);
    expect((await addOperatorSchedules({ db: asDb(held), runId: 5, schedules: [chase] })).added).toEqual([]);
    expect(inserts(held)).toHaveLength(0);

    const missing = createDb([]);
    expect((await addOperatorSchedules({ db: asDb(missing), runId: 5, schedules: [chase] })).added).toEqual([]);
    expect(inserts(missing)).toHaveLength(0);
  });

  it("records nothing when the companion row already existed", async () => {
    const db = createDb([{ institution_id: 1, url: null }], []);
    expect((await addOperatorSchedules({ db: asDb(db), runId: 5, schedules: [chase] })).added).toEqual([]);
    expect(attempts(db)).toHaveLength(0);
  });

  it("lists each bank once, Chase and Citi first, with https links", () => {
    const ids = OPERATOR_SCHEDULES.map((schedule) => schedule.institutionId);
    expect(ids.slice(0, 2)).toEqual([1, 3]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const schedule of OPERATOR_SCHEDULES) expect(new URL(schedule.url).protocol).toBe("https:");
  });
});
