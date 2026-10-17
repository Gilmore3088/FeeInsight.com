import type { EdgarSourceContract } from "./contract";
import { EDGAR_SOURCES_00 } from "./sources-00";
import { EDGAR_SOURCES_01 } from "./sources-01";
import { EDGAR_SOURCES_02 } from "./sources-02";
import { EDGAR_SOURCES_03 } from "./sources-03";

/**
 * Every registry source's contract, in registry order (`REGISTRY_SOURCES`). The slices are only
 * there to keep each file short; `sources.test.ts` checks there is exactly one contract per
 * registry source.
 */
export const EDGAR_SOURCES: readonly EdgarSourceContract[] = [
  ...EDGAR_SOURCES_00,
  ...EDGAR_SOURCES_01,
  ...EDGAR_SOURCES_02,
  ...EDGAR_SOURCES_03,
];

const BY_SOURCE = new Map(EDGAR_SOURCES.map((contract) => [contract.source, contract]));

export function edgarSourceContract(source: string): EdgarSourceContract | null {
  return BY_SOURCE.get(source) ?? null;
}
