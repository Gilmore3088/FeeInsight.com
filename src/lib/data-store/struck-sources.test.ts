import { describe, expect, it } from "vitest";
import {
  areaRowServedSql,
  DROPPED_FDIC_RATE_SERIES_IDS,
  DROPPED_FRED_INDICATORS,
  FED_INDICATOR_CUTOVER,
  fedIndicatorServedSql,
  notYetFromPublisherReason,
  STRUCK_AREA_SERIES_KEYS,
  STRUCK_FRED_SERIES,
} from "./struck-sources";

// The rules below were also run against Postgres (PGlite 0.2.17) on sample rows when written:
// FRED-era rows served before the cutover, then per series until a publisher row lands.

describe("fed_economic_indicators served rule (per series, 2026-10-18)", () => {
  const rule = fedIndicatorServedSql();

  it("never serves a struck or dropped series, including the ones with no publisher file", () => {
    for (const id of [...DROPPED_FDIC_RATE_SERIES_IDS, ...DROPPED_FRED_INDICATORS, "UMCSENT"]) expect(STRUCK_FRED_SERIES).toContain(id);
    expect(rule).toContain(`series_id <> ALL(ARRAY[${STRUCK_FRED_SERIES.map((id) => `'${id}'`).join(", ")}]::text[])`);
  });

  it("serves everything else until the first publisher run records a cutover", () => {
    expect(rule).toContain(`(SELECT (cut.detail->>'${FED_INDICATOR_CUTOVER.detailKey}')::timestamptz FROM registry_ingest_partitions cut WHERE cut.source = 'fred' AND cut.partition_key = 'current') IS NULL`);
  });

  it("keeps a series on its FRED-era rows only while it is publisher-loaded and has no publisher row yet", () => {
    expect(rule).toContain("OR fetched_at >= (SELECT");
    expect(rule).toContain(`series_id IN (SELECT jsonb_array_elements_text(COALESCE(cut.detail->'${FED_INDICATOR_CUTOVER.seriesKey}', '[]'::jsonb))`);
    expect(rule).toContain("series_id NOT IN (SELECT DISTINCT pub.series_id FROM fed_economic_indicators pub WHERE pub.fetched_at >= (SELECT");
  });

  it("always serves other loaders' NYFED_ and OFR_ series", () => {
    expect(rule.startsWith("(series_id ~ '^(NYFED|OFR)_' OR (")).toBe(true);
  });

  it("qualifies the outer columns with the alias, never the publisher subquery's", () => {
    const aliased = fedIndicatorServedSql("e");
    expect(aliased).toContain("e.series_id <> ALL(");
    expect(aliased).toContain("OR e.fetched_at >= (SELECT");
    expect(aliased).toContain("e.series_id NOT IN (SELECT DISTINCT pub.series_id");
    expect(aliased).not.toContain("e.pub");
  });
});

describe("area_statistics served rule (2026-10-18)", () => {
  it("drops struck URLs, and keeps a FRED-era row only while its key is not struck and has no Board row", () => {
    const rule = areaRowServedSql("a");
    expect(rule).toContain("COALESCE(a.source_url, '') NOT ILIKE ALL(ARRAY['%frbservices.org%', '%stlouisfed.org%']::text[])");
    expect(rule).toContain("a.source_url ILIKE '%stlouisfed.org%'");
    expect(rule).toContain(`a.series_key <> ALL(ARRAY[${STRUCK_AREA_SERIES_KEYS.map((k) => `'${k}'`).join(", ")}]::text[])`);
    expect(rule).toContain("NOT EXISTS (SELECT 1 FROM area_statistics board WHERE board.source = a.source AND board.series_key = a.series_key");
  });

  it("uses the table name when the query has no alias", () => {
    expect(areaRowServedSql()).toContain("board.series_key = area_statistics.series_key");
  });
});

describe("refusal reasons", () => {
  it("says a dropped series is not yet from its publisher, and leaves struck ones to the non-commercial reason", () => {
    for (const key of ["natl_fdic_rate_savings", "SNDR", "QBPQYTNIYSRVDP", "DRCBLACBS"]) {
      expect(notYetFromPublisherReason(key), key).toBe("This series is not published from its original source yet.");
    }
    for (const key of ["natl_pmms_30y_fixed", "UMCSENT", "laus_unemployment_rate"]) expect(notYetFromPublisherReason(key), key).toBeNull();
  });
});
