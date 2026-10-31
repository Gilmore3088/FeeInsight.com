import { ASSET_TIER_BOUND_VALUES } from "./asset-tier-facts";
import { messageText } from "./message-text";
import { extractSpelledFigures } from "./spelled-figures";
import { dollarUnitScale, dollarsFromUnit, numericPayloadValue, percentageUnitScale } from "./monetary-units";

/**
 * Numerical consistency check for dollar amounts and percentages in an AI narrative.
 * This is not claim verification: it does not bind a number to its institution, fee,
 * reporting period, source, or the direction stated in the surrounding sentence.
 *
 * A figure matches when it equals a payload number, or a difference / percent
 * difference between two payload numbers (the deltas a narrative naturally states),
 * within the rounding its own precision implies ("$35" covers 34.50–35.49).
 * Two kinds of figure are not the data's to trace (#1425): one the reader's own question names
 * (with or without a "$": "under 10B" names $10 billion, #1077), and an asset-tier bound stated as a
 * size ("banks with $1 billion to $10 billion in assets"). A tier the evidence names traces as typed
 * dollar facts (asset-tier-facts.ts). Anything else is reported as unmatched so the caller can regenerate or refuse.
 */

export interface NarrativeFigure {
  raw: string;
  kind: "usd" | "pct";
  value: number;
  /** Half a unit of the figure's last stated digit. */
  tolerance: number;
  /** Where the figure starts in the text. */
  index: number;
  /** A dollar/account figure is a different quantity from a total dollar figure. */
  denominatorUnit?: "account" | "employee" | "ten_thousand_assets";
}

export interface FigureCheckOptions {
  /** The reader's own question: a figure it names may be restated. */
  question?: string;
  /** Written NCUA answers use observed values and server-validated arithmetic, not pooled-number guesses. */
  explicitFinancialDerivations?: boolean;
}

export interface FigureCheckResult {
  checked: number;
  unmatched: string[];
}

// Report payloads carry the institution, state peers and exhibits; keep them all in view.
const MAX_PAYLOAD_NUMBERS = 1000;
const SCALE: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mn: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9 };

const USD_PATTERN = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*(k|mn|m|bn|b|thousand|million|billion)?\b/gi;
/**
 * An asset size a question gives with no "$" ("credit unions < 10B", "over 250 billion"): a number
 * in billions. Thousands and millions are not read: "2 million members" and "30k members" are
 * counts, and reading them as dollars would exempt "$2 million" or "$30,000" in the answer.
 */
const UNITLESS_SCALED_PATTERN = /(?<![\w$.,])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*(bn|b|billion)\b/gi;
const PCT_PATTERN = /(-?\d+)(?:\.(\d+))?\s?(?:%|percent\b)/gi;

function toleranceFor(decimals: string | undefined, scale: number): number {
  const places = decimals ? decimals.length : 0;
  return 0.5 * 10 ** -places * scale + 1e-9;
}

/**
 * The fixed denominator of an asset-intensity quantity, parsed as one unit (#1077): a rate word
 * ("per", "for every", "for each", "each", "/"), ten thousand dollars ("$10,000", "$10K", "$10k",
 * "$10 thousand", "ten thousand dollars") and assets ("of assets", "in assets", "of total assets",
 * or bare "assets"). The "$10,000" inside is part of the unit, never a reported dollar total, and
 * the figure it divides traces only to a value the evidence types as income per $10,000 of assets.
 */
const PER_ASSETS_DENOMINATOR = new RegExp(
  String.raw`(?:(?<![\w$])(?:per|for\s+(?:every|each)|each)\s+|\/\s*)`
  + String.raw`(?:\$\s?10(?:,000|000)(?:\.00)?(?![\d,])|\$\s?10\s?(?:k|thousand)\b|ten[- ]thousand\s+dollars\b)`
  + String.raw`\s*(?:(?:of|in)\s+)?(?:total\s+)?assets\b`, "gi");
/**
 * What may join a leading "per $10,000 of assets" to the figure it introduces, on one line and in
 * one sentence: a colon or equals sign, a linking verb directly ("was", "is"), or an income
 * subject and then a linking verb (", fee income was"). Any other words, a fee word above all
 * ("the overdraft fee is") or a bare "at"/"of" ("at $35 per overdraft"), mean the figure is not the ratio.
 */
const DENOMINATOR_LEAD = new RegExp(
  String.raw`^[ \t]*(?:[:=]|,?[ \t]*(?:(?:the[ \t]+)?(?:(?:fee|service[ \t]+charge|non-?interest)[ \t]+)?income[ \t]+)?`
  + String.raw`(?:was|is|were|are|stood[ \t]+at|came[ \t]+to|averaged|equals?)[ \t]*:?)?[ \t]*$`, "i");
/** A figure followed by a rate unit of its own ("$35 per overdraft", "$12 a month") is not a per-assets ratio. */
const OWN_RATE_UNIT = /^[ \t]*(?:per\b|\/|each\b|every\b|for[ \t]+(?:each|every)\b|an?[ \t]+(?:month|year|quarter|week|day|item|overdraft|transaction|account|statement|check)\b)/i;

interface DenominatorSpan { start: number; end: number }

function figureDenominator(text: string, start: number, end: number): NarrativeFigure["denominatorUnit"] {
  const after = text.slice(end, end + 100).replace(/[*_`]/g, "");
  const suffix = /^\s*(?:per\s+|\/\s*)(?:(?:share[- ]draft|checking)\s+)?(account|employee)s?\b/i.exec(after);
  if (suffix) return suffix[1].toLowerCase() as NarrativeFigure["denominatorUnit"];
  const before = text.slice(Math.max(0, start - 120), start).replace(/[*_`]/g, "");
  const prefix = /\bper[- ]+(?:(?:share[- ]draft|checking)[- ]+)?(account|employee)s?\s*(?:(?:balance|ratio|figure|amount|was|is|of|at|equals?|averages?|:)\s*){0,5}$/i.exec(before);
  return prefix ? prefix[1].toLowerCase() as NarrativeFigure["denominatorUnit"] : undefined;
}

const MARKDOWN_MARK = /[*_`]/;

/**
 * A span read from the text with its markdown emphasis blanked, widened over the markers right
 * around it when a marker sits inside it ("**twenty-five** dollars", "Two **thirds**"), so a
 * hold or cut that replaces the span never leaves an unpaired marker behind (review of #975).
 */
function markdownBalanced(text: string, start: number, end: number): { start: number; end: number } {
  if (!MARKDOWN_MARK.test(text.slice(start, end))) return { start, end };
  let from = start;
  let to = end;
  while (from > 0 && MARKDOWN_MARK.test(text[from - 1])) from -= 1;
  while (to < text.length && MARKDOWN_MARK.test(text[to])) to += 1;
  return { start: from, end: to };
}

export function extractFigures(text: string): NarrativeFigure[] {
  const figures: NarrativeFigure[] = [];
  // Markdown emphasis becomes spaces, so every index still points into the original text.
  const plain = text.replace(/[*_`]/g, " ");
  const spans: DenominatorSpan[] = [...plain.matchAll(PER_ASSETS_DENOMINATOR)]
    .map((m) => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
  // Numbers written as words, or in digits with a unit in words (spelled-figures.ts), are read from the
  // same plain text; `raw` is the original characters. One the digit rules already read ("25 percent",
  // the "30%" of "30% percent") is not read twice.
  const digitSpans = [...text.matchAll(USD_PATTERN), ...text.matchAll(PCT_PATTERN)]
    .map((m) => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
  const spelled = extractSpelledFigures(plain)
    .filter((f) => !digitSpans.some((s) => f.index < s.end && f.index + f.raw.length > s.start))
    .map((f) => {
      const span = markdownBalanced(text, f.index, f.index + f.raw.length);
      return { ...f, index: span.start, raw: text.slice(span.start, span.end) };
    });
  const usd = [
    ...[...text.matchAll(USD_PATTERN)].map((match) => {
      const scale = match[3] ? SCALE[match[3].toLowerCase()] ?? 1 : 1;
      const value = Number(`${match[1].replace(/,/g, "")}${match[2] ? `.${match[2]}` : ""}`) * scale;
      return { raw: match[0].trim(), value, tolerance: toleranceFor(match[2], scale), index: match.index ?? 0 };
    }),
    ...spelled.filter((f) => f.kind === "usd"),
  ].sort((a, b) => a.index - b.index).map((figure) => {
    const end = figure.index + figure.raw.length;
    const span = spans.find((s) => figure.index >= s.start && figure.index < s.end);
    return { ...figure, end, span };
  });
  // A figure takes the denominator right after it ("$15.14 per $10,000 in assets"), or else one that
  // leads into it with only a linking verb between ("for every $10,000 of assets, fee income was $15.14").
  // Only the one figure beside the denominator takes it: a second figure in a list ("$35.10 and $12.00
  // per $10,000 of assets") stays a dollar figure and holds, since a list can cross clauses.
  const ratioOf = new Map<number, DenominatorSpan>();
  const taken = new Set<DenominatorSpan>();
  usd.forEach((figure, i) => {
    if (figure.span) return;
    const span = spans.find((s) => s.start >= figure.end && /^[ \t]*$/.test(plain.slice(figure.end, s.start)));
    if (span) { ratioOf.set(i, span); taken.add(span); }
  });
  usd.forEach((figure, i) => {
    if (figure.span || ratioOf.has(i) || OWN_RATE_UNIT.test(plain.slice(figure.end, figure.end + 40))) return;
    const lead = spans.findLast((s) => s.end <= figure.index && !taken.has(s)
      && DENOMINATOR_LEAD.test(plain.slice(s.end, figure.index)));
    if (lead) { ratioOf.set(i, lead); taken.add(lead); }
  });
  usd.forEach(({ raw, value, tolerance, index, end, span }, i) => {
    // The "$10,000" of a denominator a figure took is that figure's unit, not a dollar total.
    // A denominator no figure took ("Income per $10,000 of assets rose.") stays a figure to trace.
    if (span && taken.has(span) && value === 10000) return;
    const denominatorUnit = ratioOf.has(i) ? "ten_thousand_assets" as const : figureDenominator(text, index, end);
    figures.push({ raw, kind: "usd", value, tolerance, index, ...(denominatorUnit ? { denominatorUnit } : {}) });
  });
  const pct = [
    ...[...text.matchAll(PCT_PATTERN)].map((match) => ({
      raw: match[0].trim(), value: Number(`${match[1]}${match[2] ? `.${match[2]}` : ""}`), tolerance: toleranceFor(match[2], 1), index: match.index ?? 0,
    })),
    ...spelled.filter((f) => f.kind === "pct"),
  ].sort((a, b) => a.index - b.index);
  for (const { raw, value, tolerance, index } of pct) figures.push({ raw, kind: "pct", value, tolerance, index });
  return figures;
}

/**
 * The figures a reader's question names: its dollar figures and percentages, plus a scaled size it
 * gives in billions without a "$" ("< 10B", "5B", "250 billion"), read as dollars (#1077).
 */
export function extractQuestionFigures(question: string): NarrativeFigure[] {
  const figures = extractFigures(question);
  for (const match of question.matchAll(UNITLESS_SCALED_PATTERN)) {
    const scale = SCALE[match[3].toLowerCase()];
    const value = Number(`${match[1].replace(/,/g, "")}${match[2] ? `.${match[2]}` : ""}`) * scale;
    figures.push({ raw: match[0].trim(), kind: "usd", value, tolerance: toleranceFor(match[2], scale), index: match.index ?? 0 });
  }
  return figures;
}

const MONEY_KEY = /amount|median|mean|avg|average|p\d\d|min|max|fee|price|cost|charge|income|revenue|deposit|asset|delta|cap|total|value/i;
const RATE_KEY = /pct|percent|ratio|rate|share|roa|roe|margin|yield|change|growth|delta/i;
const NOT_A_FIGURE = /(^|_)(id|ids|count|counts|year|quarter|district|rank|version|step|limit)$/i;
/** A fee category slug as a fee map's key ("overdraft", "wire_domestic_outgoing"); never a year or a number. */
const FEE_CATEGORY_KEY = /^[a-z][a-z0-9_]*$/i;
const plainObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const assetIntensityUnit = (unit: unknown) => typeof unit === "string" && /^USD income per 10,?000 USD assets$/i.test(unit.trim());

interface PayloadNumber {
  key: string;
  value: number;
  /** Base dollars, null for explicit nonmoney, absent for legacy unannotated values. */
  dollars?: number | null;
  /** Percent multiplier, null for explicit nonrates, absent for legacy named ratios/rates. */
  rateMultiplier?: number | null;
  /** In written answers these source-bound figures support direct values, not implicit pairwise arithmetic. */
  ncuaFinancial?: boolean;
  implicitArithmeticAllowed?: boolean;
  denominatorUnit?: NarrativeFigure["denominatorUnit"];
  /** An explicit per-field currency unit supports fields such as health's `absolute`. */
  explicitDollarField?: boolean;
}

/** Every finite number in the payload with the key it sits under (numeric strings included). */
export function collectPayloadNumbers(data: unknown): PayloadNumber[] {
  const found: PayloadNumber[] = [];
  // The local competitor read's fee maps keyed by category: a plain object under `your_fees`, or
  // under `fees` in an item of a `competitors` array (T5, #1726). An array named `fees` is not one.
  const competitorItems = new WeakSet<object>();
  const feeMaps = new WeakSet<object>();
  const visit = (value: unknown, key: string, unit: unknown = undefined, depth = 0,
    ncuaFinancial = false, implicitArithmeticAllowed = true, denominatorUnit?: NarrativeFigure["denominatorUnit"], explicitDollarField = false) => {
    if (found.length >= MAX_PAYLOAD_NUMBERS || depth > 12) return;
    const number = numericPayloadValue(value);
    if (number !== null) {
      const assetIntensity = assetIntensityUnit(unit);
      const scale = assetIntensity ? 1 : unit === undefined ? undefined : dollarUnitScale(unit);
      // A container's financial caption describes its dollar fields, not its named ratios.
      const rateField = typeof unit === "string" && /dollar amounts/i.test(unit) && RATE_KEY.test(key);
      if (typeof value === "string" && value.includes("$") && scale === null) return;
      found.push({
        key, value: number,
        ...(unit !== undefined ? { dollars: assetIntensity ? number : dollarsFromUnit(number, unit), rateMultiplier: percentageUnitScale(unit) } : {}),
        ...(rateField && scale !== null ? { dollars: null, rateMultiplier: undefined } : {}),
        ...(ncuaFinancial ? { ncuaFinancial: true } : {}),
        ...(!implicitArithmeticAllowed ? { implicitArithmeticAllowed: false } : {}),
        ...(assetIntensity ? { denominatorUnit: "ten_thousand_assets" as const } : denominatorUnit ? { denominatorUnit } : {}),
        ...(explicitDollarField ? { explicitDollarField: true } : {}),
      });
    } else if (typeof value === "string") {
      const text = value.trim();
      if (text.length <= 1_000_000 && (text.startsWith("{") || text.startsWith("["))) {
        try {
          visit(JSON.parse(text), key, unit, depth + 1, ncuaFinancial, implicitArithmeticAllowed, denominatorUnit);
        } catch { /* Plain or malformed text is not numeric evidence. */ }
      }
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (found.length >= MAX_PAYLOAD_NUMBERS) break;
        if (key === "competitors" && plainObject(item)) competitorItems.add(item);
        visit(item, key, unit, depth + 1, ncuaFinancial, implicitArithmeticAllowed, denominatorUnit);
      }
    } else if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      const own = Object.hasOwn(record, "unit") ? record.unit
        : Object.hasOwn(record, "units") ? record.units : unit;
      const feeRecord = record.period_basis === "fee_schedule" || (typeof record.measure === "string" && record.measure.startsWith("fee:"));
      const source = typeof record.source === "string" ? record.source.toLowerCase() : "";
      const ownNcua = !feeRecord && (ncuaFinancial || source === "ncua" || source === "ncua-extras"
        || (typeof record.measure === "string" && /^call:acct_/.test(record.measure)));
      const ownArithmetic = implicitArithmeticAllowed && record.numeric_arithmetic_allowed !== false;
      const ownDenominator = record.denominator_unit === "account" || record.denominator_unit === "employee" || record.denominator_unit === "ten_thousand_assets"
        ? record.denominator_unit : denominatorUnit;
      const fieldUnits = record.field_units && typeof record.field_units === "object" && !Array.isArray(record.field_units)
        ? record.field_units as Record<string, unknown> : {};
      // A fee map's prices sit under keys that name only the fee, so each keeps the map's money key.
      const feeMap = feeMaps.has(record);
      for (const [childKey, child] of Object.entries(record)) {
        if (found.length >= MAX_PAYLOAD_NUMBERS) break;
        if (plainObject(child) && (childKey === "your_fees" || (childKey === "fees" && competitorItems.has(record)))) feeMaps.add(child);
        const fieldUnit = typeof fieldUnits[childKey] === "string" ? fieldUnits[childKey] : undefined;
        const priceKey = feeMap && numericPayloadValue(child) !== null && FEE_CATEGORY_KEY.test(childKey) && !NOT_A_FIGURE.test(childKey)
          ? `${key}.${childKey}` : childKey;
        visit(child, priceKey, fieldUnit ?? own, depth + 1, ownNcua, ownArithmetic, ownDenominator,
          fieldUnit !== undefined && (dollarUnitScale(fieldUnit) !== null || assetIntensityUnit(fieldUnit)));
      }
    }
  };
  visit(data, "");
  return found;
}

/**
 * Values a narrative may legitimately state. Dollar figures: money fields and the
 * differences between them. Percentages: rate fields (ratios also as x100) and the
 * percent change between money fields. Ids, counts and years never qualify.
 */
function candidateValues(numbers: PayloadNumber[], kind: NarrativeFigure["kind"], options: FigureCheckOptions,
  denominatorUnit?: NarrativeFigure["denominatorUnit"]): number[] {
  const usable = numbers.filter((n) => !NOT_A_FIGURE.test(n.key));
  const sameQuantity = (n: PayloadNumber) => n.denominatorUnit === denominatorUnit
    // Existing fee prices can be described "per account" without being a calculated
    // balance/account ratio. Preserve legacy sources; NCUA totals require the typed ratio.
    || ((denominatorUnit === "account" || denominatorUnit === "employee") && n.denominatorUnit === undefined && !(options.explicitFinancialDerivations && n.ncuaFinancial));
  const money = usable.filter((n) => (MONEY_KEY.test(n.key) || n.explicitDollarField) && n.dollars !== null && sameQuantity(n));
  const arithmetic = money.filter((n) => !n.denominatorUnit && n.implicitArithmeticAllowed !== false && !(options.explicitFinancialDerivations && n.ncuaFinancial));
  const candidates = new Set<number>();
  if (kind === "usd") {
    for (const number of money) candidates.add(Math.abs(number.dollars ?? number.value));
    for (const first of arithmetic) {
      const a = first.dollars ?? first.value;
      for (const second of arithmetic) {
        const b = second.dollars ?? second.value;
        if (a !== b) candidates.add(Math.abs(a - b));
      }
    }
  } else {
    for (const n of usable) {
      if (n.rateMultiplier !== undefined) {
        if (n.rateMultiplier !== null) candidates.add(Math.abs(n.value) * n.rateMultiplier);
      } else if (RATE_KEY.test(n.key)) {
        candidates.add(Math.abs(n.value));
        if (Math.abs(n.value) <= 1) candidates.add(Math.abs(n.value) * 100);
      }
    }
    for (const first of arithmetic) {
      const a = first.dollars ?? first.value;
      for (const second of arithmetic) {
        const b = second.dollars ?? second.value;
        if (a !== b && b !== 0) candidates.add(Math.abs(((a - b) / b) * 100));
      }
    }
  }
  return [...candidates];
}

const near = (figure: NarrativeFigure, value: number) => Math.abs(Math.abs(figure.value) - value) <= figure.tolerance;

/** The bounds of Hamilton's asset tiers, in dollars: the FDIC tiers and the peer-set tiers. */
export const ASSET_TIER_BOUNDS: readonly number[] = ASSET_TIER_BOUND_VALUES;

const isTierBound = (figure: NarrativeFigure) => figure.kind === "usd" && ASSET_TIER_BOUNDS.some((bound) => near(figure, bound));
/** Words that make a size phrase after the figure: "in assets", "in total assets", "asset tier", "tier". */
const SIZE_AFTER = /^\s*(?:in\s+(?:total\s+)?assets?\b|of\s+(?:total\s+)?assets\b|asset\b|assets\b|tier\b|in\s+size\b)/i;
/** A comparison that makes a single bound a threshold: "under $1 billion", "assets above $10B". */
const THRESHOLD_BEFORE = /\b(?:under|over|above|below|more\s+than|less\s+than|at\s+least|up\s+to|exceeding)\s*$/i;
const ASSETS_THRESHOLD_BEFORE = /\bassets?\s+(?:of\s+)?(?:under|over|above|below|more\s+than|less\s+than|at\s+least|up\s+to|exceeding)\s*$/i;
const RANGE_JOIN = /^\s*(?:to|-|–|—|and)\s*$/i;
const EXCLUSIVE_UPPER_JOIN = /^\s*(?:to|and)\s+under\s*$/i;
const EXCLUSIVE_RANGE_JOIN = /^\s*up to\s*,?\s*but not including\s*,?\s*$/i;
const ASSETS_RANGE_BEFORE = /\bassets?\s+(?:(?:ranging\s+)?from|(?:of\s+)?at least)\s*$/i;

/**
 * An asset-tier bound stated as a size, not as money: two bounds as a range followed by a size
 * phrase ("$1 billion to $10 billion in assets", "the $300M to $1B tier"), or one bound as a
 * threshold ("under $1 billion in assets", "assets above $10 billion"). A bound that only shares
 * a sentence with the word "assets" ("earned $1 billion in fees, with assets of ...") still traces.
 */
export function tierBoundsAsSize(text: string, figures: NarrativeFigure[]): Set<NarrativeFigure> {
  const accepted = new Set<NarrativeFigure>();
  const definedRanges = new Set<string>();
  const references: Array<{ a: NarrativeFigure; b: NarrativeFigure; range: string }> = [];
  const ordered = [...figures].sort((a, b) => a.index - b.index);
  for (let i = 0; i < ordered.length; i++) {
    const a = ordered[i];
    if (!isTierBound(a)) continue;
    const aEnd = a.index + a.raw.length;
    const b = ordered[i + 1];
    const assetsRange = ASSETS_RANGE_BEFORE.test(text.slice(Math.max(0, a.index - 50), a.index));
    if (b && isTierBound(b) && (RANGE_JOIN.test(text.slice(aEnd, b.index))
      || (a.value < b.value && EXCLUSIVE_UPPER_JOIN.test(text.slice(aEnd, b.index)))
      || (assetsRange && a.value < b.value && EXCLUSIVE_RANGE_JOIN.test(text.slice(aEnd, b.index))))) {
      const after = text.slice(b.index + b.raw.length, b.index + b.raw.length + 30);
      const range = `${a.value}:${b.value}`;
      if (SIZE_AFTER.test(after) || assetsRange) {
        accepted.add(a);
        accepted.add(b);
        definedRanges.add(range);
      } else if (/^\s*group\b/i.test(after)
        && /\bpeers?\s+(?:in|within)\s+(?:the\s+)?$/i.test(text.slice(Math.max(0, a.index - 40), a.index))) {
        references.push({ a, b, range });
      }
      i++;
      continue;
    }
    const before = text.slice(Math.max(0, a.index - 40), a.index);
    const after = text.slice(aEnd, aEnd + 30);
    if (ASSETS_THRESHOLD_BEFORE.test(before) || (THRESHOLD_BEFORE.test(before) && SIZE_AFTER.test(after))) accepted.add(a);
  }
  // A repeated peer-group name keeps its previously stated asset dimension.
  // This never turns the same bound used as fee income or a fee price into data.
  for (const { a, b, range } of references) {
    if (definedRanges.has(range)) { accepted.add(a); accepted.add(b); }
  }
  return accepted;
}

export function checkNarrativeFigures(narrative: string, data: unknown, options: FigureCheckOptions = {}): FigureCheckResult {
  const { figures, untraced } = traceFigures(narrative, data, options);
  return { checked: figures.length, unmatched: [...new Set(untraced.map((figure) => figure.raw))] };
}

/**
 * The figures the check could not trace, each with its own place in the text, so a hold replaces
 * that figure and not every figure that reads the same ("half" twice, one traced) (review of #975).
 */
export function untracedFigures(narrative: string, data: unknown, options: FigureCheckOptions = {}): NarrativeFigure[] {
  return traceFigures(narrative, data, options).untraced;
}

function traceFigures(narrative: string, data: unknown, options: FigureCheckOptions): { figures: NarrativeFigure[]; untraced: NarrativeFigure[] } {
  const figures = extractFigures(narrative);
  if (figures.length === 0) return { figures, untraced: [] };
  const numbers = collectPayloadNumbers(data);
  const candidates = new Map<string, number[]>();
  const valuesFor = (figure: NarrativeFigure) => {
    const key = `${figure.kind}:${figure.denominatorUnit ?? "total"}`;
    if (!candidates.has(key)) candidates.set(key, candidateValues(numbers, figure.kind, options, figure.denominatorUnit));
    return candidates.get(key)!;
  };
  const asked = options.question ? extractQuestionFigures(options.question) : [];
  const sizes = tierBoundsAsSize(narrative, figures);
  const traced = (figure: NarrativeFigure) =>
    valuesFor(figure).some((value) => near(figure, value))
    || asked.some((q) => q.kind === figure.kind && q.denominatorUnit === figure.denominatorUnit && near(figure, Math.abs(q.value)))
    || sizes.has(figure);
  return { figures, untraced: figures.filter((figure) => !traced(figure)) };
}

/**
 * Figure check for a streamed assistant message: its text against the outputs of the
 * tools it called (the only data the model saw). Works on AI SDK UI message parts. The text is
 * the one the reader sees (messageText, the joinTextParts join), the same text the route checks
 * (answerText), so a figure split from its lead across two parts reads the same here and there.
 */
export function checkMessageFigures(parts: ReadonlyArray<{ type: string; text?: string; output?: unknown }>): FigureCheckResult {
  const text = messageText({ parts });
  const toolOutputs = parts.filter((part) => "output" in part && part.output !== undefined).map((part) => part.output);
  return checkNarrativeFigures(text, toolOutputs);
}

/** A numerical match alone cannot verify the surrounding claim. */
export const FIGURE_CHECK_LIMITATION =
  "Numerical consistency only; institution, fee category, reporting date, source attribution and direction of change are not verified by this check.";

/**
 * Compatibility rating for saved answers. A figure-only check never earns high confidence:
 * even a matching number may belong to another institution or period, or be only a delta.
 * Keep unmatched figures low; matched and number-free answers remain unverified.
 */
export function confidenceFromFigureCheck(check: FigureCheckResult): { level: "high" | "medium" | "low"; basis: string[] } {
  if (check.unmatched.length > 0) {
    return { level: "low", basis: [`No numerical match in Hamilton's data: ${check.unmatched.join(", ")}`, FIGURE_CHECK_LIMITATION] };
  }
  if (check.checked > 0) {
    return {
      level: "medium",
      basis: [
        `${check.checked} figure${check.checked === 1 ? "" : "s"} numerically matched values or arithmetic differences in Hamilton's data.`,
        FIGURE_CHECK_LIMITATION,
      ],
    };
  }
  return { level: "medium", basis: ["No dollar amounts or percentages to check; qualitative claims have not been verified.", FIGURE_CHECK_LIMITATION] };
}
