import { describe, expect, it } from "vitest";
import { SOURCE_STALE_AFTER_DAYS, STALE_SOURCE_LABEL, isStaleSource, staleSourceLabel } from "./source-age";

const now = new Date("2026-10-17T12:00:00Z");

describe("when a Hamilton source counts as old", () => {
  it("uses one rule: more than a year before today", () => {
    expect(SOURCE_STALE_AFTER_DAYS).toBe(365);
    expect(STALE_SOURCE_LABEL).toBe("Source over a year old");
  });
  it("leaves a recent source unlabeled", () => {
    expect(isStaleSource("2026-06-30", now)).toBe(false);
    expect(staleSourceLabel("2026-09-01T00:00:00Z", now)).toBeNull();
    // Exactly 365 days back is still within a year.
    expect(isStaleSource("2025-10-17", now)).toBe(false);
  });
  it("labels a source more than a year old, from a date or a timestamp", () => {
    expect(isStaleSource("2025-10-16", now)).toBe(true);
    expect(staleSourceLabel("2024-01-15T00:00:00Z", now)).toBe("Source over a year old");
  });
  it("never labels a missing, unreadable or future date", () => {
    for (const value of [null, undefined, "", "Q2 2024", "2024", "not a date", "2024-13-45"]) {
      expect(isStaleSource(value, now)).toBe(false);
      expect(staleSourceLabel(value, now)).toBeNull();
    }
    expect(isStaleSource("2027-01-01", now)).toBe(false);
  });
});
