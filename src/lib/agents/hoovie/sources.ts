import type { HoovieSourceContract } from "./contract";
import { HOOVIE_SOURCES_00 } from "./sources-00";
import { HOOVIE_SOURCES_01 } from "./sources-01";
import { HOOVIE_SOURCES_02 } from "./sources-02";
import { HOOVIE_SOURCES_03 } from "./sources-03";

/**
 * Every registry source's contract, in registry order (`REGISTRY_SOURCES`). The slices are only
 * there to keep each file short; `sources.test.ts` checks there is exactly one contract per
 * registry source.
 */
export const HOOVIE_SOURCES: readonly HoovieSourceContract[] = [
  ...HOOVIE_SOURCES_00,
  ...HOOVIE_SOURCES_01,
  ...HOOVIE_SOURCES_02,
  ...HOOVIE_SOURCES_03,
];

const BY_SOURCE = new Map(HOOVIE_SOURCES.map((contract) => [contract.source, contract]));

export function hoovieSourceContract(source: string): HoovieSourceContract | null {
  return BY_SOURCE.get(source) ?? null;
}
