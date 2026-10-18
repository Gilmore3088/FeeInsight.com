import { describe, expect, it } from "vitest";
import { makeStamp, type DatasetStampInput } from "./dataset-stamp";
import { datasetNoteWords, noteTime } from "./dataset-note";

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
    expect(words?.summary).toBe("Published fee schedules, read live 18 Oct 2026 14:10 UTC. Sibling charters sharing one schedule count once.");
    expect(words?.details).toEqual([
      "Source: Published dollar fees",
      "Read live: 18 Oct 2026 14:10 UTC",
      "Newest fee record: 18 Oct 2026 09:30 UTC",
      "Statistics method: version 13",
      "Counting: Sibling charters that share one fee schedule count as one institution",
      `Reference: ${stamp.id}`,
    ]);
    expect(words?.filters).toEqual([POPULATION[0].label]);
    expect(words?.differences).toBeNull();
  });

  it("names a snapshot's computed time and run", () => {
    const words = datasetNoteWords([{ label: "National medians", stamp: makeStamp(snapshot) }]);
    expect(words?.summary).toBe("Snapshot of published fee schedules, computed 17 Oct 2026 02:00 UTC. Sibling charters sharing one schedule count once.");
    expect(words?.details).toContain("Computed from: Published dollar fees");
    expect(words?.details).toContain("Snapshot run: 9001");
  });

  it("says each charter counts on its own when count-once is off", () => {
    const words = datasetNoteWords([{ label: "All", stamp: makeStamp({ ...live, counting: "per_charter", methodVersion: 14 }) }]);
    expect(words?.summary).toMatch(/Each charter counts on its own\.$/);
  });

  it("says how two figures on one screen differ, in their own names", () => {
    const state = makeStamp({ ...live, filters: [...POPULATION, { key: "peers:state:TX", label: "Peers: TX" }] });
    const national = makeStamp(live);
    const words = datasetNoteWords([{ label: "Texas", stamp: state }, { label: "the U.S. reference", stamp: national }]);
    expect(words?.differences).toEqual({ heading: "How Texas and the U.S. reference differ", lines: ["Only Texas: Peers: TX"] });
    const other = datasetNoteWords([{ label: "the U.S. reference", stamp: national }, { label: "Texas", stamp: state }]);
    expect(other?.differences?.lines).toEqual(["Only Texas: Peers: TX"]);
  });

  it("explains a snapshot against a live read, and stays quiet when every figure shares one stamp", () => {
    const words = datasetNoteWords([{ label: "Market", stamp: makeStamp(snapshot) }, { label: "Overview", stamp: makeStamp(live) }]);
    expect(words?.differences?.lines).toEqual([
      "Dataset: National index snapshot vs Published dollar fees",
      "Computed from: Published dollar fees vs none",
      "Read: snapshot computed 2026-10-17 02:00 UTC vs read live 2026-10-18 14:10 UTC",
      "Run: 9001 vs none",
    ]);
    const same = makeStamp(live);
    expect(datasetNoteWords([{ label: "A", stamp: same }, { label: "B", stamp: same }])?.differences).toBeNull();
    expect(datasetNoteWords([])).toBeNull();
  });
});
