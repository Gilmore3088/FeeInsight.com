import { describe, expect, it } from "vitest";
import {
  DEFAULT_WIRE_RANGE,
  billProgress,
  formatWireDate,
  likePattern,
  pageWindow,
  parseWireParams,
  rangePhrase,
  rangeSince,
  wireHref,
} from "./wire";

const NOW = new Date("2026-10-08T15:30:00Z");
const isState = (code: string) => ["CO", "NY", "KS"].includes(code);

describe("wire params", () => {
  it("reads the shared params and falls back to safe defaults", () => {
    expect(parseWireParams({}, isState)).toEqual({
      view: "federal",
      range: DEFAULT_WIRE_RANGE,
      q: "",
      page: 1,
      source: undefined,
      topic: undefined,
      state: undefined,
      kind: undefined,
    });
    expect(
      parseWireParams({ view: "states", state: "co", kind: "press", range: "week", q: "  paycheck   advance ", page: "3" }, isState),
    ).toMatchObject({ view: "states", state: "CO", kind: "press", range: "week", q: "paycheck advance", page: 3 });
    expect(parseWireParams({ state: "ZZ", kind: "memes", range: "decade", page: "-2" }, isState)).toMatchObject({
      state: undefined,
      kind: undefined,
      range: DEFAULT_WIRE_RANGE,
      page: 1,
    });
  });

  it("builds short links that keep the window and search", () => {
    const params = parseWireParams({ view: "states", state: "CO", q: "overdraft", range: "month", page: "2" }, isState);
    expect(wireHref(params)).toBe("/pro/news?view=states&state=CO&q=overdraft&range=month&page=2");
    expect(wireHref(params, { kind: "bills", page: 1 })).toBe("/pro/news?view=states&state=CO&kind=bills&q=overdraft&range=month");
    // Switching to Federal keeps the range and search, not the state.
    expect(wireHref(params, { view: "federal", page: 1 })).toBe("/pro/news?q=overdraft&range=month");
    expect(wireHref(parseWireParams({}, isState))).toBe("/pro/news");
    // The fee-type chip is shared by both views and survives a view switch.
    const fee = parseWireParams({ fee: "overdraft", q: "cap" }, isState);
    expect(fee.fee).toBe("overdraft");
    expect(wireHref(fee, { view: "states", page: 1 })).toBe("/pro/news?view=states&fee=overdraft&q=cap");
    expect(parseWireParams({ fee: "lattes" }, isState).fee).toBeUndefined();
  });
});

describe("time range", () => {
  it("starts Today at midnight UTC and counts the rest back from now", () => {
    expect(rangeSince("today", NOW)).toBe("2026-10-08T00:00:00.000Z");
    expect(rangeSince("week", NOW)).toBe("2026-10-01T15:30:00.000Z");
    expect(rangeSince("month", NOW)).toBe("2026-09-08T15:30:00.000Z");
    expect(rangeSince("year", NOW)).toBe("2025-10-08T15:30:00.000Z");
    expect(rangeSince("all", NOW)).toBeNull();
    expect(rangePhrase("today", NOW)).toBe("since 00:00 UTC on Oct 8, 2026");
  });
});

describe("pagination", () => {
  it("shows X–Y of Z and clamps a page past the end", () => {
    expect(pageWindow(1, 60)).toEqual({ page: 1, pageCount: 3, offset: 0, from: 1, to: 25, total: 60 });
    expect(pageWindow(3, 60)).toEqual({ page: 3, pageCount: 3, offset: 50, from: 51, to: 60, total: 60 });
    expect(pageWindow(9, 60)).toMatchObject({ page: 3, offset: 50 });
    expect(pageWindow(2, 0)).toEqual({ page: 1, pageCount: 1, offset: 0, from: 0, to: 0, total: 0 });
  });
});

describe("search pattern", () => {
  it("matches anywhere and takes LIKE wildcards literally", () => {
    expect(likePattern("Fraud")).toBe("%Fraud%");
    expect(likePattern("100%_off\\")).toBe("%100\\%\\_off\\\\%");
    expect(likePattern("   ")).toBeNull();
    expect(likePattern(undefined)).toBeNull();
  });
});

describe("dates", () => {
  it("gives the absolute UTC day, and relative words only within a week", () => {
    expect(formatWireDate("2026-10-07T21:10:00Z", NOW)).toEqual({ absolute: "Oct 7, 2026", relative: "yesterday", iso: "2026-10-07" });
    expect(formatWireDate("2026-10-08", NOW)).toMatchObject({ absolute: "Oct 8, 2026", relative: "today" });
    expect(formatWireDate("2026-10-03", NOW)).toMatchObject({ absolute: "Oct 3, 2026", relative: "5 days ago" });
    expect(formatWireDate("2026-03-31", NOW)).toMatchObject({ absolute: "Mar 31, 2026", relative: null });
    expect(formatWireDate("Tue, 07 Oct 2026 14:00:00 GMT", NOW)).toMatchObject({ absolute: "Oct 7, 2026" });
    expect(formatWireDate(null, NOW)).toBeNull();
    expect(formatWireDate("not a date", NOW)).toBeNull();
  });
});

describe("bill stage stepper", () => {
  it("maps each Open States stage onto Introduced → Committee → Passed a chamber → Enacted", () => {
    expect(billProgress("introduced")).toMatchObject({ reached: 1, end: null });
    expect(billProgress("in_committee")).toMatchObject({ reached: 2, end: null });
    expect(billProgress("passed_chamber")).toMatchObject({ reached: 3, end: null, label: "Passed one chamber" });
    expect(billProgress("passed_legislature")).toMatchObject({ reached: 3, end: null, label: "Passed the legislature" });
    expect(billProgress("signed")).toMatchObject({ reached: 4, end: null, label: "Signed into law" });
  });

  it("shows a veto or a failure as an end state, and an unknown stage as unknown", () => {
    expect(billProgress("vetoed")).toEqual({ reached: 3, end: "vetoed", label: "Vetoed" });
    expect(billProgress("failed")).toEqual({ reached: 1, end: "failed", label: "Failed" });
    expect(billProgress(null)).toEqual({ reached: 0, end: null, label: "Stage not recorded" });
    expect(billProgress("pending_signature")).toMatchObject({ reached: 0, label: "pending signature" });
  });
});
