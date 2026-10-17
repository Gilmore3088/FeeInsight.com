/** Formatting shared by the city page's server and client parts. Pure, with no server imports. */

/** A dollar amount as the city page prints it: "$36", "$2.50". */
export function money(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

/** "an overdraft", "a monthly maintenance", "an NSF / returned item": acronyms keep their case. */
export function lowerLabel(label: string): string {
  return label.replace(/\b[A-Z][a-z]+/g, (w) => w.toLowerCase());
}

/** How the institution table can be ordered; branches here is the default. */
export const CITY_SORTS = [
  { key: "branches", label: "Branches here" },
  { key: "low", label: "Lowest fee" },
  { key: "high", label: "Highest fee" },
  { key: "name", label: "Name" },
] as const;

export type CitySort = (typeof CITY_SORTS)[number]["key"];

export function sortOf(value: string | undefined): CitySort {
  return CITY_SORTS.some((s) => s.key === value) ? (value as CitySort) : "branches";
}

/** Sent by the opening's link: the table switches to that fee and order and scrolls into view. */
export const FEE_SELECT_EVENT = "fi:city-fee-select";

export interface FeeSelectDetail {
  fee: string;
  sort: CitySort;
}
