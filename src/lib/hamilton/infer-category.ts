import { DISPLAY_NAMES } from "@/lib/fee-taxonomy";

/**
 * Short names a reader or Hamilton uses for each fee category, from the
 * taxonomy display names: "NSF / Returned Item" gives "NSF" and "Returned
 * Item"; "Overdraft (OD)" gives "Overdraft" and "OD" (too short, dropped).
 */
const ALIASES: Array<{ category: string; pattern: RegExp }> = Object.entries(DISPLAY_NAMES).flatMap(
  ([category, display]) =>
    display
      .replace(/\(([^)]*)\)/g, "/$1")
      .split("/")
      .map((part) => part.trim())
      .filter((part) => part.length >= 3)
      .map((part) => ({
        category,
        // Acronyms match case-sensitively ("ATM", "NSF"); words do not.
        pattern: new RegExp(
          `\\b${part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
          part === part.toUpperCase() ? "" : "i",
        ),
      })),
);

/**
 * The fee category a piece of text is about: the one named earliest. Returns
 * null when no category is named, so callers fall back to no category rather
 * than guessing.
 */
export function inferFeeCategory(text: string): string | null {
  let best: { category: string; index: number; length: number } | null = null;
  for (const { category, pattern } of ALIASES) {
    const match = pattern.exec(text);
    if (!match) continue;
    if (
      !best ||
      match.index < best.index ||
      (match.index === best.index && match[0].length > best.length)
    ) {
      best = { category, index: match.index, length: match[0].length };
    }
  }
  return best?.category ?? null;
}
