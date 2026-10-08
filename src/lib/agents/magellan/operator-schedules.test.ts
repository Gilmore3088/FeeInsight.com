import { describe, expect, it, vi } from "vitest";

import {
  addHandFoundLink,
  addOperatorSchedules,
  OPERATOR_SCHEDULE_STRATEGY,
  OPERATOR_SCHEDULES,
  type OperatorSchedule,
} from "./operator-schedules";

type DbMock = ReturnType<typeof vi.fn>;
const text = (strings: unknown) => (Array.isArray(strings) ? strings.join(" ") : String(strings));
const asDb = (db: DbMock) => db as unknown as NonNullable<Parameters<typeof addOperatorSchedules>[0]["db"]>;

const chase: OperatorSchedule = {
  institutionId: 1,
  institutionName: "JPMorgan Chase Bank, National Association",
  url: "https://www.chase.com/content/dam/chase-ux/documents/personal/checking/ABSF-en.pdf",
  givenBy: "James, 2026-10-07 00:51",
};

function createDb(held: Array<{ institution_id: number; url: string | null; institution_name?: string | null }>, insertReturns = [{ id: 7 }]): DbMock {
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
    const db = createDb([{ institution_id: 1, url: "https://www.jpmorganchase.com/ir/news/2021/press-release", institution_name: chase.institutionName }]);
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
    const held = createDb([{ institution_id: 1, url: chase.url, institution_name: chase.institutionName }]);
    expect((await addOperatorSchedules({ db: asDb(held), runId: 5, schedules: [chase] })).added).toEqual([]);
    expect(inserts(held)).toHaveLength(0);

    const missing = createDb([]);
    expect((await addOperatorSchedules({ db: asDb(missing), runId: 5, schedules: [chase] })).added).toEqual([]);
    expect(inserts(missing)).toHaveLength(0);
  });

  it("leaves a bank whose stored name does not match the listed one", async () => {
    const other = createDb([{ institution_id: 1, url: null, institution_name: "Maple Test Bank" }]);
    expect((await addOperatorSchedules({ db: asDb(other), runId: 5, schedules: [chase] })).added).toEqual([]);
    expect(inserts(other)).toHaveLength(0);
  });

  it("records nothing when the companion row already existed", async () => {
    const db = createDb([{ institution_id: 1, url: null, institution_name: chase.institutionName }], []);
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

describe("links pasted on the hit list", () => {
  function pasteDb(name: string | null, insertReturns = [{ id: 9 }]): DbMock {
    return vi.fn((strings: TemplateStringsArray) => {
      const sqlText = text(strings);
      if (sqlText.includes("SELECT institution_name")) return Promise.resolve(name ? [{ institution_name: name }] : []);
      if (sqlText.includes("INSERT INTO institution_additional_sources")) return Promise.resolve(insertReturns);
      return Promise.resolve([]);
    });
  }
  const pasteAsDb = (db: DbMock) => db as unknown as NonNullable<Parameters<typeof addHandFoundLink>[0]["db"]>;

  it("stores the link as a hand-found consumer schedule with no run, and records the attempt", async () => {
    const db = pasteDb("Old National Bank");
    const result = await addHandFoundLink({ db: pasteAsDb(db), institutionId: 41, url: " https://www.oldnational.com/fees.pdf ", givenBy: "james on the hit list" });
    expect(result).toEqual({ ok: true, institutionName: "Old National Bank" });
    const [insert] = inserts(db);
    expect(insert).toContain("https://www.oldnational.com/fees.pdf");
    expect(insert).toContain(OPERATOR_SCHEDULE_STRATEGY.strategy);
    expect(insert).toContain(null);
    expect(attempts(db)).toHaveLength(1);
  });

  it("refuses a non-link, an unknown institution and a link already on file", async () => {
    expect(await addHandFoundLink({ db: pasteAsDb(pasteDb("X")), institutionId: 41, url: "fees please", givenBy: "j" })).toMatchObject({ ok: false });
    expect(await addHandFoundLink({ db: pasteAsDb(pasteDb("X")), institutionId: 41, url: "ftp://x.com/a.pdf", givenBy: "j" })).toMatchObject({ ok: false });
    expect(await addHandFoundLink({ db: pasteAsDb(pasteDb(null)), institutionId: 41, url: "https://x.com/a.pdf", givenBy: "j" })).toEqual({ ok: false, error: "Institution not found" });
    const held = pasteDb("X", []);
    expect(await addHandFoundLink({ db: pasteAsDb(held), institutionId: 41, url: "https://x.com/a.pdf", givenBy: "j" })).toMatchObject({ ok: false });
    expect(attempts(held)).toHaveLength(0);
  });
});
