"use server";

import { getIndexRowsCached } from "@/lib/data-store/public-cached-reads";
import { getSpotlightCategories } from "@/lib/fee-taxonomy";
import { readAhead } from "./landing-index";

/**
 * The hero card's institution marker: one institution's published value for each card fee it
 * asks for, in cents, from the same cached index rows the card's chart counts (getIndexRowsCached,
 * then the explorer's institutionsFor through readAhead), so the marker always matches the bars.
 *
 * It returns one institution's own published fees, which its public page already shows; it
 * never lists institutions. Only a positive integer id and the card's own free fees (the
 * spotlight tier) are accepted. A fee with no published row is left out, never zero-filled,
 * and any failed read returns null, so the card shows no marker rather than a wrong one.
 */
export async function institutionCardFees(institutionId: unknown, feeKeys: unknown): Promise<Record<string, number> | null> {
  if (typeof institutionId !== "number" || !Number.isSafeInteger(institutionId) || institutionId < 1) return null;
  if (!Array.isArray(feeKeys)) return null;
  const allowed = new Set(getSpotlightCategories());
  const fees = [...new Set(feeKeys.filter((k): k is string => typeof k === "string" && allowed.has(k)))];
  if (fees.length === 0) return null;
  try {
    const rows = await Promise.all(fees.map(async (fee) => [fee, await getIndexRowsCached(fee)] as const));
    return readAhead(new Map(rows), [institutionId])[0]?.fees ?? {};
  } catch (error) {
    console.error("[home] institution card fees read failed; card shown without a marker", error);
    return null;
  }
}
