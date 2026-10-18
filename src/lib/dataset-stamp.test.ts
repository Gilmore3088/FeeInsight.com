import { describe, expect, it } from "vitest";
import { formatStamp, makeStamp, stampDifferences, stampId, toIsoTime, toRunId, type DatasetStampInput } from "./dataset-stamp";

const POPULATION = [
  { key: "sourced", label: "Only fees traced to a stored copy of the institution's own fee schedule" },
  { key: "consumer_audience", label: "Consumer fees, fees for both consumers and businesses, and fees whose schedule names no audience; business-only fees left out" },
];

/**
 * The three overdraft counts of Oct 2026 (2,495 / 2,503 / 2,505), as stamps:
 * the Market page's cached snapshot, the Overview's live read, and the public site's live
 * per-charter count (method 14 is the count-once switch off).
 */
const marketSnapshot: DatasetStampInput = {
  dataset: "fee_index_cache",
  derivedFrom: "published_fee_catalog",
  mode: "cached",
  readAt: "2026-10-17T02:00:00Z",
  runId: 9001,
  newestRecordAt: null,
  methodVersion: 13,
  counting: "counted_once",
  filters: POPULATION,
};
const overviewLive: DatasetStampInput = {
  dataset: "published_fee_catalog",
  mode: "live",
  readAt: "2026-10-18T14:00:00Z",
  runId: null,
  newestRecordAt: "2026-10-18T09:30:00Z",
  methodVersion: 13,
  counting: "counted_once",
  filters: POPULATION,
};
const publicPerCharter: DatasetStampInput = {
  ...overviewLive,
  methodVersion: 14,
  counting: "per_charter",
};

describe("makeStamp and stampId", () => {
  it("normalises Postgres values: Date and string times, bigint string run ids", () => {
    const stamp = makeStamp({
      ...marketSnapshot,
      readAt: new Date("2026-10-17T02:00:00Z") as unknown as string,
      runId: "9001" as unknown as number,
      newestRecordAt: "2026-10-17 01:59:00+00",
    });
    expect(stamp.readAt).toBe("2026-10-17T02:00:00.000Z");
    expect(stamp.runId).toBe(9001);
    expect(stamp.newestRecordAt).toBe("2026-10-17T01:59:00.000Z");
    expect(toRunId(BigInt(42))).toBe(42);
    expect(toRunId("not a run")).toBeNull();
    expect(toIsoTime("nonsense")).toBeNull();
  });

  it("gives a stable id: same read, same id, whatever the filter order or record time", () => {
    const a = makeStamp(overviewLive);
    const b = makeStamp({ ...overviewLive, filters: [...POPULATION].reverse(), newestRecordAt: null, readAt: "2026-10-18T14:00:00.000Z" });
    expect(a.id).toBe(b.id);
    expect(a.id).toMatch(/^ds_[0-9a-z]+$/);
    expect(stampId(a)).toBe(a.id);
    expect(makeStamp(marketSnapshot).id).not.toBe(a.id);
    expect(makeStamp(publicPerCharter).id).not.toBe(a.id);
    // Pinned so a change to the id recipe is a deliberate one.
    expect(a.id).toBe("ds_28pc8yybq27");
  });

  it("drops a duplicate filter key", () => {
    expect(makeStamp({ ...overviewLive, filters: [...POPULATION, POPULATION[0]] }).filters).toHaveLength(2);
  });
});

describe("formatStamp", () => {
  it("formats a snapshot with its run and method", () => {
    const stamp = makeStamp(marketSnapshot);
    const { short, detail } = formatStamp(stamp);
    expect(short).toBe("National index snapshot, snapshot computed 2026-10-17 02:00 UTC");
    expect(detail).toEqual([
      "Dataset: National index snapshot",
      "Computed from: Published dollar fees",
      "Snapshot computed: 2026-10-17 02:00 UTC",
      "Built by run 9001",
      "Statistics method version 13",
      "Counting: Sibling charters that share one fee schedule count as one institution",
      `Filter: ${POPULATION[0].label}`,
      `Filter: ${POPULATION[1].label}`,
      `Stamp ${stamp.id}`,
    ]);
  });

  it("formats a live read with the newest record and no run", () => {
    const { short, detail } = formatStamp(makeStamp(overviewLive));
    expect(short).toBe("Published dollar fees, read live 2026-10-18 14:00 UTC");
    expect(detail).toContain("Read live: 2026-10-18 14:00 UTC");
    expect(detail).toContain("Newest fee record: 2026-10-18 09:30 UTC");
    expect(detail.some((line) => line.startsWith("Built by run"))).toBe(false);
  });

  it("never prints an em dash or a pipeline agent's name", () => {
    const text = [marketSnapshot, overviewLive, publicPerCharter]
      .flatMap((s) => { const f = formatStamp(makeStamp(s)); return [f.short, ...f.detail]; })
      .join("\n");
    expect(text).not.toMatch(/\u2014/);
    expect(text).not.toMatch(/\b(Atlas|Magellan|Rosetta|Knox|Darwin|Hoovie)\b/);
    expect(text).not.toMatch(/Hamilton Pro/);
  });
});

describe("stampDifferences: why 2,495, 2,503 and 2,505 differ", () => {
  const market = makeStamp(marketSnapshot);
  const overview = makeStamp(overviewLive);
  const publicSite = makeStamp(publicPerCharter);

  it("is empty for the same read", () => {
    expect(stampDifferences(overview, makeStamp(overviewLive))).toEqual([]);
  });

  it("names the snapshot against the live read: dataset, time and run", () => {
    expect(stampDifferences(market, overview)).toEqual([
      "Dataset: National index snapshot vs Published dollar fees",
      "Computed from: Published dollar fees vs none",
      "Read: snapshot computed 2026-10-17 02:00 UTC vs read live 2026-10-18 14:00 UTC",
      "Run: 9001 vs none",
    ]);
  });

  it("names count-once against per-charter counting", () => {
    expect(stampDifferences(overview, publicSite)).toEqual([
      "Statistics method version: 13 vs 14",
      "Counting: Sibling charters that share one fee schedule count as one institution vs Every charter counts as its own institution",
    ]);
  });

  it("names an added scope filter, and a removed one the other way round", () => {
    const peers = makeStamp({ ...overviewLive, filters: [...POPULATION, { key: "peers:fed_districts:7", label: "Peers: Fed district 7" }] });
    expect(stampDifferences(overview, peers)).toEqual(["Filter added: Peers: Fed district 7"]);
    expect(stampDifferences(peers, overview)).toEqual(["Filter removed: Peers: Fed district 7"]);
  });

  it("names a later live read by its time", () => {
    const later = makeStamp({ ...overviewLive, readAt: "2026-10-18T15:30:00Z" });
    expect(stampDifferences(overview, later)).toEqual(["Read time: 2026-10-18 14:00 UTC vs 2026-10-18 15:30 UTC"]);
  });
});
