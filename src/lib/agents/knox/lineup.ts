import { amountsIn } from "@/lib/agents/knox/rules";

/**
 * A checking account's lineup facts, read with its monthly maintenance fee: the product's
 * name, the balance that avoids the fee, the deposit needed to open it, and the waiver
 * wording. Pure.
 *
 * Every value is grounded in the source text the way amounts are: a dollar figure must
 * appear in the text, and the product name and waiver text must be found in the text once
 * case and whitespace are normalized. A value that is not there is stored as null, never
 * guessed.
 */
export interface AccountLineup {
  productName: string | null;
  minBalanceToAvoid: number | null;
  minOpeningDeposit: number | null;
  waiverText: string | null;
}

/** The only category that carries lineup fields. */
export const LINEUP_CATEGORY = "monthly_maintenance";
const MAX_PRODUCT_NAME_CHARS = 80;
const MAX_WAIVER_CHARS = 240;
const MAX_THRESHOLD = 10_000_000;

function squash(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function comparable(value: string): string {
  return squash(value.toLowerCase().replace(/[‘’ʼ`]/g, "'").replace(/[“”]/g, '"'));
}

function groundedPhrase(value: unknown, haystack: string, maxChars: number): string | null {
  if (typeof value !== "string") return null;
  const phrase = squash(value);
  if (phrase.length < 3 || phrase.length > maxChars) return null;
  return haystack.includes(comparable(phrase)) ? phrase : null;
}

function figureText(value: number): string[] {
  const fixed = value.toFixed(2);
  const whole = Number.isInteger(value) ? String(value) : fixed;
  const comma = (text: string) => text.replace(/\B(?=(\d{3})+(?!\d))/, ",");
  return Array.from(new Set([fixed, whole, comma(fixed), comma(whole)]));
}

function groundedFigure(value: unknown, text: string): number | null {
  if (value == null || value === "") return null;
  const figure = typeof value === "number" ? value : Number(String(value).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(figure) || figure < 0 || figure > MAX_THRESHOLD) return null;
  const rounded = Math.round(figure * 100) / 100;
  if (amountsIn(text).some((found) => found.value === rounded)) return rounded;
  // "a minimum daily balance of 1,500": the figure without its dollar sign.
  const bare = figureText(rounded).some((form) => new RegExp(`(^|[^\\d.,])${form.replace(".", "\\.")}(?![\\d]|[.,]\\d)`).test(text));
  return bare ? rounded : null;
}

/** Lineup values checked against the text; null when none of them is stated there. */
export function groundLineup(
  values: { productName?: unknown; minBalanceToAvoid?: unknown; minOpeningDeposit?: unknown; waiverText?: unknown },
  text: string,
): AccountLineup | null {
  const haystack = comparable(text);
  const lineup: AccountLineup = {
    productName: groundedPhrase(values.productName, haystack, MAX_PRODUCT_NAME_CHARS),
    minBalanceToAvoid: groundedFigure(values.minBalanceToAvoid, text),
    minOpeningDeposit: groundedFigure(values.minOpeningDeposit, text),
    waiverText: groundedPhrase(values.waiverText, haystack, MAX_WAIVER_CHARS),
  };
  return Object.values(lineup).some((value) => value !== null) ? lineup : null;
}
