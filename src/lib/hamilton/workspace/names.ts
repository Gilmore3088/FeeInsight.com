/** Fee names as they read in a sentence. Client-safe. */

import { getDisplayName } from "@/lib/fee-taxonomy";

/** Wires differ only in their bracketed direction, so they keep it in words. */
const PROSE_NAMES: Record<string, string> = {
  wire_domestic_outgoing: "outgoing domestic wire",
  wire_domestic_incoming: "incoming domestic wire",
  wire_intl_outgoing: "outgoing international wire",
  wire_intl_incoming: "incoming international wire",
};

/** A wire's heading name, keeping its direction: "Outgoing Domestic Wire". Null for other fees. */
export function directionalTitle(feeCategory: string): string | null {
  const named = PROSE_NAMES[feeCategory];
  return named ? named.replace(/\b\w/g, (c) => c.toUpperCase()) : null;
}

/** "Overdraft (OD)" -> "overdraft"; "NSF / Returned Item" -> "NSF / returned item". */
export function proseFeeName(feeCategory: string): string {
  const named = PROSE_NAMES[feeCategory];
  if (named) return named;
  return getDisplayName(feeCategory)
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .trim()
    .split(/\s+/)
    .map((w) => (w.length > 1 && w === w.toUpperCase() ? w : w.toLowerCase()))
    .join(" ");
}

/** A competitor's name as a reader says it: no ", National Association"; "Federal Credit Union" as "FCU". */
export function plainName(name: string): string {
  return name
    .replace(/,?\s+(National Association|N\.A\.)$/i, "")
    .replace(/\s+Federal Credit Union$/i, " FCU")
    .trim();
}

/** "overdraft item", or "NSF / returned item" as it is: never "returned item item" (#2035). */
export function feeItem(name: string, plural = false): string {
  const base = /\bitem$/i.test(name) ? name : `${name} item`;
  return plural ? `${base}s` : base;
}
