import { describe, expect, it } from "vitest";

import { documentKind } from "./document-kind";
import { asText, KIND_FIXTURES, KIND_FIXTURES_SECOND, KIND_HOLDOUT } from "./document-kind.fixtures";

describe("documentKind (#1094)", () => {
  it.each([...KIND_FIXTURES, ...KIND_FIXTURES_SECOND, ...KIND_HOLDOUT].map((fixture) => [fixture.id, fixture]))("production text %i", (_id, fixture) => {
    const result = documentKind({ text: asText(fixture), url: fixture.url, feeSchedule: fixture.feeLink });
    expect({ kind: result.kind, url: fixture.url }).toEqual({ kind: fixture.classified ?? fixture.kind, url: fixture.url });
  });

  it("lists its known misses: 2 of the first 40, 4 of the second 30, 4 of the 30 held out", () => {
    const misses = (fixtures: typeof KIND_FIXTURES) => fixtures.filter((fixture) => fixture.classified && fixture.classified !== fixture.kind).map((fixture) => fixture.id);
    expect(misses(KIND_FIXTURES)).toEqual([16747, 31244]);
    expect(misses(KIND_FIXTURES_SECOND)).toEqual([26427, 19245, 30249, 30314]);
    // The holdout: 26 of 30 right, graded before any rule saw it.
    expect(misses(KIND_HOLDOUT)).toEqual([12672, 24282, 22255, 30985]);
  });
});
