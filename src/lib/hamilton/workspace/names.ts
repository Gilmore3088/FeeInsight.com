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
