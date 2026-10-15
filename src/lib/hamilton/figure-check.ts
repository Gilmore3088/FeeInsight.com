/**
 * Numerical consistency check for dollar amounts and percentages in an AI narrative.
 * This is not claim verification: it does not bind a number to its institution, fee,
 * reporting period, source, or the direction stated in the surrounding sentence.
 *
 * A figure matches when it equals a payload number, or a difference / percent
 * difference between two payload numbers (the deltas a narrative naturally states),
 * within the rounding its own precision implies ("$35" covers 34.50–35.49).
 * Two kinds of figure are not the data's to trace (#1425): one the reader's own question names,
 * and an asset-tier bound stated as a size ("banks with $1 billion to $10 billion in assets"). Anything else is reported as unmatched so the caller can regenerate or refuse.
 */

export interface NarrativeFigure {
  raw: string;
  kind: "usd" | "pct";
  value: number;
  /** Half a unit of the figure's last stated digit. */
  tolerance: number;
  /** Where the figure starts in the text. */
  index: number;
}

export interface FigureCheckOptions {
  /** The reader's own question: a figure it names may be restated. */
  question?: string;
}

export interface FigureCheckResult {
  checked: number;
  unmatched: string[];
}

// Report payloads carry the institution, state peers and exhibits; keep them all in view.
const MAX_PAYLOAD_NUMBERS = 1000;
const SCALE: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, b: 1e9, billion: 1e9 };

const USD_PATTERN = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*(k|m|b|thousand|million|billion)?\b/gi;
const PCT_PATTERN = /(-?\d+)(?:\.(\d+))?\s?(?:%|percent\b)/gi;

function toleranceFor(decimals: string | undefined, scale: number): number {
  const places = decimals ? decimals.length : 0;
  return 0.5 * 10 ** -places * scale + 1e-9;
}

export function extractFigures(text: string): NarrativeFigure[] {
  const figures: NarrativeFigure[] = [];
  for (const match of text.matchAll(USD_PATTERN)) {
    const scale = match[3] ? SCALE[match[3].toLowerCase()] ?? 1 : 1;
    const value = Number(`${match[1].replace(/,/g, "")}${match[2] ? `.${match[2]}` : ""}`) * scale;
    figures.push({ raw: match[0].trim(), kind: "usd", value, tolerance: toleranceFor(match[2], scale), index: match.index ?? 0 });
  }
  for (const match of text.matchAll(PCT_PATTERN)) {
    const value = Number(`${match[1]}${match[2] ? `.${match[2]}` : ""}`);
    figures.push({ raw: match[0].trim(), kind: "pct", value, tolerance: toleranceFor(match[2], 1), index: match.index ?? 0 });
  }
  return figures;
}

const MONEY_KEY = /amount|median|mean|avg|average|p\d\d|min|max|fee|price|cost|charge|income|revenue|deposit|asset|delta|cap|total|value/i;
const RATE_KEY = /pct|percent|ratio|rate|share|roa|roe|margin|yield|change|growth|delta/i;
const NOT_A_FIGURE = /(^|_)(id|ids|count|counts|year|quarter|district|rank|version|step|limit)$/i;

interface PayloadNumber {
  key: string;
  value: number;
}

/** Every finite number in the payload with the key it sits under (numeric strings included). */
export function collectPayloadNumbers(data: unknown): PayloadNumber[] {
  const found: PayloadNumber[] = [];
  const visit = (value: unknown, key: string) => {
    if (found.length >= MAX_PAYLOAD_NUMBERS) return;
    if (typeof value === "number" && Number.isFinite(value)) found.push({ key, value });
    else if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) found.push({ key, value: Number(value) });
    else if (Array.isArray(value)) value.forEach((item) => visit(item, key));
    else if (value && typeof value === "object") {
      for (const [childKey, child] of Object.entries(value)) visit(child, childKey);
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
function candidateValues(numbers: PayloadNumber[], kind: NarrativeFigure["kind"]): number[] {
  const usable = numbers.filter((n) => !NOT_A_FIGURE.test(n.key));
  const money = usable.filter((n) => MONEY_KEY.test(n.key)).map((n) => n.value);
  const candidates = new Set<number>();
  if (kind === "usd") {
    for (const a of money) {
      candidates.add(Math.abs(a));
      for (const b of money) if (a !== b) candidates.add(Math.abs(a - b));
    }
  } else {
    for (const n of usable.filter((item) => RATE_KEY.test(item.key))) {
      candidates.add(Math.abs(n.value));
      if (Math.abs(n.value) <= 1) candidates.add(Math.abs(n.value) * 100);
    }
    for (const a of money) {
      for (const b of money) if (a !== b && b !== 0) candidates.add(Math.abs(((a - b) / b) * 100));
    }
  }
  return [...candidates];
}

const near = (figure: NarrativeFigure, value: number) => Math.abs(Math.abs(figure.value) - value) <= figure.tolerance;

/** The bounds of Hamilton's asset tiers, in dollars: the FDIC tiers and the peer-set tiers. */
export const ASSET_TIER_BOUNDS: readonly number[] = [100e6, 300e6, 1e9, 10e9, 50e9, 250e9];

const isTierBound = (figure: NarrativeFigure) => figure.kind === "usd" && ASSET_TIER_BOUNDS.some((bound) => near(figure, bound));
/** Words that make a size phrase after the figure: "in assets", "in total assets", "asset tier", "tier". */
const SIZE_AFTER = /^\s*(?:in\s+(?:total\s+)?assets?\b|of\s+(?:total\s+)?assets\b|asset\b|assets\b|tier\b|in\s+size\b)/i;
/** A comparison that makes a single bound a threshold: "under $1 billion", "assets above $10B". */
const THRESHOLD_BEFORE = /\b(?:under|over|above|below|more\s+than|less\s+than|at\s+least|up\s+to|exceeding)\s*$/i;
const ASSETS_THRESHOLD_BEFORE = /\bassets?\s+(?:of\s+)?(?:under|over|above|below|more\s+than|less\s+than|at\s+least|up\s+to|exceeding)\s*$/i;
const RANGE_JOIN = /^\s*(?:to|-|–|—|and)\s*$/i;

/**
 * An asset-tier bound stated as a size, not as money: two bounds as a range followed by a size
 * phrase ("$1 billion to $10 billion in assets", "the $300M to $1B tier"), or one bound as a
 * threshold ("under $1 billion in assets", "assets above $10 billion"). A bound that only shares
 * a sentence with the word "assets" ("earned $1 billion in fees, with assets of ...") still traces.
 */
function tierBoundsAsSize(text: string, figures: NarrativeFigure[]): Set<NarrativeFigure> {
  const accepted = new Set<NarrativeFigure>();
  const ordered = [...figures].sort((a, b) => a.index - b.index);
  for (let i = 0; i < ordered.length; i++) {
    const a = ordered[i];
    if (!isTierBound(a)) continue;
    const aEnd = a.index + a.raw.length;
    const b = ordered[i + 1];
    if (b && isTierBound(b) && RANGE_JOIN.test(text.slice(aEnd, b.index))) {
      if (SIZE_AFTER.test(text.slice(b.index + b.raw.length, b.index + b.raw.length + 30))) {
        accepted.add(a);
        accepted.add(b);
      }
      i++;
      continue;
    }
    const before = text.slice(Math.max(0, a.index - 40), a.index);
    const after = text.slice(aEnd, aEnd + 30);
    if (ASSETS_THRESHOLD_BEFORE.test(before) || (THRESHOLD_BEFORE.test(before) && SIZE_AFTER.test(after))) accepted.add(a);
  }
  return accepted;
}

export function checkNarrativeFigures(narrative: string, data: unknown, options: FigureCheckOptions = {}): FigureCheckResult {
  const figures = extractFigures(narrative);
  if (figures.length === 0) return { checked: 0, unmatched: [] };
  const numbers = collectPayloadNumbers(data);
  const byKind = {
    usd: candidateValues(numbers, "usd"),
    pct: candidateValues(numbers, "pct"),
  };
  const asked = options.question ? extractFigures(options.question) : [];
  const sizes = tierBoundsAsSize(narrative, figures);
  const traced = (figure: NarrativeFigure) =>
    byKind[figure.kind].some((value) => near(figure, value))
    || asked.some((q) => q.kind === figure.kind && near(figure, Math.abs(q.value)))
    || sizes.has(figure);
  const unmatched = figures
    .filter((figure) => !traced(figure))
    .map((figure) => figure.raw);
  return { checked: figures.length, unmatched: [...new Set(unmatched)] };
}

/**
 * Figure check for a streamed assistant message: its text against the outputs of the
 * tools it called (the only data the model saw). Works on AI SDK UI message parts.
 */
export function checkMessageFigures(parts: ReadonlyArray<{ type: string; text?: string; output?: unknown }>): FigureCheckResult {
  const text = parts.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n");
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
