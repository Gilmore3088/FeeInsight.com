/** Explicit source units only. These helpers do not infer a currency or a scale from a value. */
const normalized = (unit: unknown): string | null => typeof unit === "string"
  ? unit.toLowerCase().split(/[;,]/, 1)[0].replace(/[_()]/g, " ").replace(/\s+/g, " ").trim() : null;

export function dollarUnitScale(unit: unknown): number | null {
  const text = normalized(unit);
  if (!text) return null;
  const scales = text.match(/\b(?:thousands?|millions?|billions?)\b/g) ?? [];
  const factors = new Set(scales.map(value => value.startsWith("thousand") ? 1e3 : value.startsWith("million") ? 1e6 : 1e9));
  if (factors.size > 1) return null;
  const factor = [...factors][0] ?? 1;
  // The Fed also publishes real GDP in a named year's chained dollars.
  if (/^(?:thousands?|millions?|billions?) of chained \d{4} (?:u\.?s\.? )?dollars?$/.test(text)) return factor;
  const currency = text.replace(/\b(?:thousands?|millions?|billions?|of|in|amounts?|whole|current)\b/g, " ").replace(/\s+/g, " ").trim();
  return /^(?:usd|u\.?s\.?\s*dollars?|dollars?|us\$|\$)(?: per (?:hour|year|month|person))?$/.test(currency) ? factor : null;
}

export function percentageUnitScale(unit: unknown): number | null {
  const text = normalized(unit);
  if (text && /^(?:%|pct|percent|percentage|percentage points)$/.test(text)) return 1;
  if (text && /^(?:fraction|ratio)$/.test(text)) return 100;
  if (text && /^basis points?$/.test(text)) return 0.01;
  return null;
}

/** Numeric literals, including formatted numeric strings; never numbers mined from prose. */
export function numericPayloadValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!/^-?\$?(?:\d+(?:\.\d+)?|\d{1,3}(?:,\d{3})+(?:\.\d+)?)$/.test(text)) return null;
  const number = Number(text.replace(/[$,]/g, ""));
  return Number.isFinite(number) ? number : null;
}

export function dollarsFromUnit(value: unknown, unit: unknown): number | null {
  const number = numericPayloadValue(value);
  const scale = dollarUnitScale(unit);
  if (number === null || scale === null) return null;
  const dollars = number * scale;
  return Number.isFinite(dollars) ? dollars : null;
}
