/** Fee names as they read in a sentence. Client-safe. */

import { getDisplayName } from "@/lib/fee-taxonomy";

/** "Overdraft (OD)" -> "overdraft"; "NSF / Returned Item" -> "NSF / returned item". */
export function proseFeeName(feeCategory: string): string {
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
