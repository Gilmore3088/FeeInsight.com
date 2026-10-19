/** Literal special charging units. None is converted to another numeric price. Pure/client-safe. */
export const SPECIAL_UNIT_FREQUENCIES = [
  "hourly", "per_page", "per_document", "per_image", "per_statement",
  "per_half_hour", "per_quarter_hour", "per_minute",
] as const;

export type SpecialUnitFrequency = typeof SPECIAL_UNIT_FREQUENCIES[number];

const SPECIAL_UNITS: ReadonlySet<string> = new Set(SPECIAL_UNIT_FREQUENCIES);
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghijklmnopqrstuvwxyz";
// ECMAScript trim whitespace, spelled explicitly for PostgreSQL btrim character semantics.
const SQL_TRIM = "U&'\\0009\\000A\\000B\\000C\\000D\\0020\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000\\FEFF'";

/** ASCII vocabulary only; unsupported Unicode case transformations cannot become unit codes. */
export function normalizedUnitFrequency(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = value.trim().replace(/[A-Z]/g, char => char.toLowerCase());
  return normalized || null;
}

export function isSpecialUnitFrequency(value: string | null | undefined): boolean {
  return SPECIAL_UNITS.has(normalizedUnitFrequency(value) ?? "");
}

/** Exact SQL twin of normalizedUnitFrequency + the finite supported-unit set. */
export function specialUnitSql(alias: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new Error("Invalid fee-unit table alias");
  const values = SPECIAL_UNIT_FREQUENCIES.map(value => `'${value}'`).join(", ");
  return `COALESCE(translate(btrim(${alias}.frequency, ${SQL_TRIM}), '${UPPER}', '${LOWER}') IN (${values}), false)`;
}

export const UNIT_LABELS: Readonly<Record<SpecialUnitFrequency, string>> = {
  hourly: "per hour",
  per_page: "per page",
  per_document: "per document",
  per_image: "per image",
  per_statement: "per statement",
  per_half_hour: "per half hour",
  per_quarter_hour: "per quarter hour",
  per_minute: "per minute",
};

export function specialUnitReason(value: string | null | undefined): string | null {
  const key = normalizedUnitFrequency(value);
  return key && SPECIAL_UNITS.has(key) ? `Charged ${UNIT_LABELS[key as SpecialUnitFrequency]}; comparison unavailable` : null;
}

const UNIT_AFTER_PRICE = /^\s*\(?\s*(?:per\s+|each\s+|every\s+|\/\s*)(half[ -](?:an?\s+)?(?:hour|hr)|1\/2\s*(?:hour|hr)|30\s*(?:minutes?|mins?)|thirty\s*(?:minutes?|mins?)|quarter[ -](?:an?\s+)?(?:hour|hr)|15\s*(?:minutes?|mins?)|fifteen\s*(?:minutes?|mins?)|minutes?|mins?|hours?|hrs?|pages?|documents?|images?|statements?)(?![a-z0-9])/i;

/** Only a unit immediately attached to its own price; a minimum alone never states a basis. */
export function specialUnitAfterPrice(words: string): SpecialUnitFrequency | null {
  let suffix = words;
  // A bounded own qualifier can precede the unit ("$10 (Consumer Only) per statement").
  // Keep that complete qualifier in source evidence; never read its minimum/delay as a unit.
  for (let count = 0; count < 2; count++) {
    const qualifier = /^\s*\(([^()$%]{1,120})\)\s*/.exec(suffix);
    if (!qualifier || UNIT_AFTER_PRICE.test(suffix)) break;
    suffix = suffix.slice(qualifier[0].length);
  }
  const match = UNIT_AFTER_PRICE.exec(suffix);
  if (!match) return null;
  const alternative = /^\s*\)?\s*(?:or|and)\s+/i.exec(suffix.slice(match[0].length));
  if (alternative && UNIT_AFTER_PRICE.test(suffix.slice(match[0].length + alternative[0].length))) return null;
  const unit = match[1].toLowerCase();
  if (/^(?:half|1\/2|30|thirty)/.test(unit)) return "per_half_hour";
  if (/^(?:quarter|15|fifteen)/.test(unit)) return "per_quarter_hour";
  if (/^(?:minute|min)/.test(unit)) return "per_minute";
  if (/^(?:hour|hr)/.test(unit)) return "hourly";
  if (/^page/.test(unit)) return "per_page";
  if (/^document/.test(unit)) return "per_document";
  if (/^image/.test(unit)) return "per_image";
  return "per_statement";
}

/** Conflicting explicit unit clauses cannot fall back to an older single-unit reader. */
export function conflictingSpecialUnits(words: string): boolean {
  const scan = new RegExp(`(?:^|[^a-z0-9])${UNIT_AFTER_PRICE.source.slice(1)}`, "gi");
  const units = [...words.matchAll(scan)].map(match => specialUnitAfterPrice(match[0].replace(/^[^a-z(/]+/i, "")));
  return new Set(units.filter(Boolean)).size > 1;
}

const MONEY = /\$\s*(\d[\d,]*(?:\.\d{1,2})?|\.\d{1,2})(?![\d.])/g;

/** An exact terminal parenthetical unit, never a minimum or turnaround-time note. */
export function specialUnitInName(label: string): SpecialUnitFrequency | null {
  const match = /\(([^()]*)\)\s*$/.exec(label.trim());
  if (!match) return null;
  const words = match[1].trim();
  const bare = /^(?:hours?|hrs?|pages?|documents?|images?|statements?|half hour|quarter hour|minutes?|15 minutes?|30 minutes?)$/i.test(words);
  return specialUnitAfterPrice(words)
    ?? (bare ? specialUnitAfterPrice(`per ${words}`) : /^hourly$/i.test(words) ? "hourly" : null);
}

/** A unique price's literal suffix; used only to retain an already source-owned unit. */
export function specialUnitOnPriceLine(line: string | null | undefined, amount: number | null): SpecialUnitFrequency | null {
  if (!line || amount == null) return null;
  if (conflictingSpecialUnits(line)) return null;
  const prices = [...line.matchAll(MONEY)];
  if (prices.length !== 1 || Number(prices[0][1].replace(/,/g, "")) !== amount) return null;
  const suffix = specialUnitAfterPrice(line.slice((prices[0].index ?? 0) + prices[0][0].length).replace(/^\s*\|\s*/, " "));
  const prefix = specialUnitInName(line.slice(0, prices[0].index).replace(/[|\s]+$/, ""));
  if (prefix && suffix && prefix !== suffix) return null;
  return suffix ?? prefix;
}
