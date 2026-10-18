import { describe, expect, it } from "vitest";
import { makeStamp, type DatasetStampInput } from "./dataset-stamp";
import { datasetCitation, datasetNoteWords, datasetPassage, noteTime, readStampedFigures, uniqueStampedFigures } from "./dataset-note";

const POPULATION = [{ key: "sourced", label: "Only fees traced to a stored copy of the institution's own fee schedule" }];

const live: DatasetStampInput = {
  dataset: "published_fee_catalog",
  mode: "live",
  readAt: "2026-10-18T14:10:00Z",
  runId: null,
  newestRecordAt: "2026-10-18T09:30:00Z",
  methodVersion: 13,
  counting: "counted_once",
  filters: POPULATION,
};
const snapshot: DatasetStampInput = {
  ...live,
  dataset: "fee_index_cache",
  derivedFrom: "published_fee_catalog",
  mode: "cached",
  readAt: "2026-10-17T02:00:00Z",
  runId: 9001,
  newestRecordAt: null,
};

describe("dataset note words (#1924 step 2)", () => {
  it("writes the time in one fixed format on server and client", () => {
    expect(noteTime("2026-10-08T04:05:00Z")).toBe("8 Oct 2026 04:05 UTC");
    expect(noteTime("2026-10-18 14:10:00+00")).toBe("18 Oct 2026 14:10 UTC");
    expect(noteTime(null)).toBe("an unknown time");
  });

  it("says a live read's source, time and counting rule in one line, with the details and filters behind it", () => {
    const stamp = makeStamp(live);
    const words = datasetNoteWords([{ label: "Texas", stamp }]);
    expect(words?.summary).toBe("Published fee schedules, read live 18 Oct 2026 14:10 UTC. Institutions sharing one fee schedule count once.");
    expect(words?.details).toEqual([
      "Source: Published dollar fees",
      "Read live: 18 Oct 2026 14:10 UTC",
      "Newest fee record: 18 Oct 2026 09:30 UTC",
      "Method version: 13",
      "Counting: Institutions that share one fee schedule count as one institution",
      `Data reference (for support): ${stamp.id}`,
    ]);
    expect(words?.filters).toEqual([POPULATION[0].label]);
    expect(words?.differences).toBeNull();
  });

  it("names a snapshot's computed time and run", () => {
    const words = datasetNoteWords([{ label: "National medians", stamp: makeStamp(snapshot) }]);
    expect(words?.summary).toBe("Snapshot of published fee schedules, computed 17 Oct 2026 02:00 UTC. Institutions sharing one fee schedule count once.");
    expect(words?.details).toContain("Computed from: Published dollar fees");
    expect(words?.details.some((d) => d.includes("9001"))).toBe(false);
  });

  it("says each charter counts on its own when count-once is off", () => {
    const words = datasetNoteWords([{ label: "All", stamp: makeStamp({ ...live, counting: "per_charter", methodVersion: 14 }) }]);
    expect(words?.summary).toMatch(/Each charter counts on its own\.$/);
  });

  it("says how two figures on one screen differ, in their own names", () => {
    const state = makeStamp({ ...live, filters: [...POPULATION, { key: "peers:state:TX", label: "Institutions in Texas" }] });
    const national = makeStamp(live);
    const words = datasetNoteWords([{ label: "Texas", stamp: state }, { label: "the U.S. reference", stamp: national }]);
    expect(words?.differences).toEqual({ heading: "How Texas and the U.S. reference differ", lines: ["Applies only to Texas: Institutions in Texas"] });
    const other = datasetNoteWords([{ label: "the U.S. reference", stamp: national }, { label: "Texas", stamp: state }]);
    expect(other?.differences?.lines).toEqual(["Applies only to Texas: Institutions in Texas"]);
  });

  it("names each reason once when three or more figures differ from the first", () => {
    const state = makeStamp({ ...live, filters: [...POPULATION, { key: "peers:state:TX", label: "Institutions in Texas" }] });
    const words = datasetNoteWords([
      { label: "Texas", stamp: state },
      { label: "National", stamp: makeStamp(live) },
      { label: "Fed district 11", stamp: makeStamp({ ...live, filters: [...POPULATION, { key: "peers:fed_districts:11", label: "Fed district 11" }] }) },
      { label: "Banks, $1B to $10B in assets", stamp: makeStamp({ ...live, filters: [...POPULATION, { key: "peers:charter:bank", label: "Banks only" }] }) },
    ]);
    expect(words?.differences?.heading).toBe("Why these figures can differ");
    expect(words?.differences?.lines.filter((l) => l === "Applies only to Texas: Institutions in Texas")).toHaveLength(1);
    expect(new Set(words?.differences?.lines).size).toBe(words?.differences?.lines.length);
  });

  it("explains a snapshot against a live read, and stays quiet when every figure shares one stamp", () => {
    const words = datasetNoteWords([{ label: "Market", stamp: makeStamp(snapshot) }, { label: "Overview", stamp: makeStamp(live) }]);
    expect(words?.differences?.lines).toEqual([
      "Dataset: Bank Fee Index national snapshot vs Published dollar fees",
      "Computed from: Published dollar fees vs none",
      "Read: snapshot computed 2026-10-17 02:00 UTC vs read live 2026-10-18 14:10 UTC",
      "Run: 9001 vs none",
    ]);
    const same = makeStamp(live);
    expect(datasetNoteWords([{ label: "A", stamp: same }, { label: "B", stamp: same }])?.differences).toBeNull();
    expect(datasetNoteWords([])).toBeNull();
  });
});

describe("saved stamps and tool citations (#1924 step 3)", () => {
  it("reads saved figures back exactly as saved, after a JSON round trip", () => {
    const figures = [{ label: "Peers", stamp: makeStamp(live) }, { label: "National medians", stamp: makeStamp(snapshot) }];
    expect(readStampedFigures(JSON.parse(JSON.stringify(figures)))).toEqual(figures);
  });

  it("gives none for an older record, and drops entries that are not a whole stamp", () => {
    expect(readStampedFigures(undefined)).toEqual([]);
    expect(readStampedFigures({ label: "Peers" })).toEqual([]);
    const stamp = makeStamp(live);
    const noId: Record<string, unknown> = { ...stamp };
    delete noId.id;
    expect(readStampedFigures([{ label: "Peers", stamp: noId }, { label: "Peers", stamp: { ...stamp, mode: "guessed" } }, { stamp }, null])).toEqual([]);
  });

  it("names each stamp once", () => {
    const stamp = makeStamp(live);
    expect(uniqueStampedFigures([{ label: "Peers", stamp }, null, { label: "National", stamp }])).toEqual([{ label: "Peers", stamp }]);
  });

  it("hands a tool's model the stamp id, the one line and the filters", () => {
    const stamp = makeStamp(live);
    expect(datasetCitation(stamp)).toEqual({
      stamp_id: stamp.id,
      summary: "Published fee schedules, read live 18 Oct 2026 14:10 UTC. Institutions sharing one fee schedule count once.",
      filters: [POPULATION[0].label],
    });
  });
});

describe("dataset passage (#1924 step 4)", () => {
  const base = { dataset: "published_fee_catalog" as const, mode: "live" as const, readAt: "2026-10-18T14:10:00Z", runId: null, newestRecordAt: null, methodVersion: 13, counting: "counted_once" as const };
  const leftOut = { key: "exclude:institution:1", label: "The institution being compared left out" };

  it("says all institutions but the one compared when only that filter sets the group", () => {
    const passage = datasetPassage([{ label: "National", stamp: makeStamp({ ...base, filters: [leftOut] }) }], "see the report");
    expect(passage).toContain("Who is counted: all institutions except the institution being compared, under the index's standard rules (see the report).");
  });

  it("names each figure's limits once, in one clause, and skips a limit its name already says", () => {
    const peers = makeStamp({ ...base, filters: [{ key: "peers:state:TN", label: "Institutions in Tennessee" }, { key: "peers:charter:credit_union", label: "Credit unions only" }, leftOut] });
    const district = makeStamp({ ...base, filters: [{ key: "peers:fed_districts:6", label: "Fed district 6" }, leftOut] });
    const passage = datasetPassage([
      { label: "your peer group", stamp: peers },
      { label: "National", stamp: makeStamp({ ...base, filters: [leftOut] }) },
      { label: "Fed district 6 (Atlanta)", stamp: district },
    ], "see the report");
    const differ = passage?.find((s) => s.startsWith("Why these figures can differ"));
    expect(differ).toBe("Why these figures can differ: only your peer group is limited to institutions in Tennessee and credit unions.");
    expect(passage?.[1]).toMatch(/^Who is counted for your peer group: institutions in Tennessee, credit unions only, with the institution/);
  });
});
