import { frequencyFamily, perEventFrequency, settledFrequency } from "@/lib/fee-frequency";

/**
 * Darwin's verified frequency, pure, so Knox can ask it before keeping a read (v147, re-review of
 * 70d2d09). Moved unchanged from `verify.ts` and `hourly-frequency-check.ts`, which re-export both.
 */

/** A period in the name besides the hour: the fee's basis is not clear from the name alone. */
export const HOURLY_PERIOD_WORD = /\b(?:monthly|per\s+month|annual(?:ly)?|yearly|per\s+year|quarterly|per\s+quarter|daily|per\s+day|weekly|per\s+week)\b/i;

/**
 * The frequency Darwin verifies a fee at, from Knox's excerpt of its own line. Pure.
 * #1456 (Oct 21): an hourly price on the fee's own line ("$25.00 per hour") is read here, so the fee
 * is hourly when it publishes; the live hourly re-check (`hourly-frequency-check.ts`) stays as the
 * safety net for fees published before. Categories never charged by the hour stay as they were.
 * Measured in the shadow lab (#2536, experiment `hourly-at-verify`): hourly charges published as
 * flat 9 -> 0 of 27, no fee lost.
 * #1196: an NSF fee is charged per item; a period on one is a misread, so it is never verified.
 */
export function verifiedFrequency(line: string | null, amount: number | null, stated: string | null, canonicalFeeKey: string | null): string | null {
  // As the live re-check (`hourlyVerdict`): a stated period, or a period printed on the line, is
  // left to a person (stated_period, period_word), never turned into hourly.
  const hourly = (stated == null || frequencyFamily(stated) === "per_item") && !HOURLY_PERIOD_WORD.test(line ?? "");
  const settled = amount == null ? stated : settledFrequency(line, amount, stated, canonicalFeeKey, { hourly });
  return perEventFrequency(canonicalFeeKey, settled, line, amount);
}
