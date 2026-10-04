/**
 * Figure check: every dollar amount and percentage in an AI narrative must trace to
 * the DATA payload the model was given.
 *
 * A figure matches when it equals a payload number, or a difference / percent
 * difference between two payload numbers (the deltas a narrative naturally states),
 * within the rounding its own precision implies ("$35" covers 34.50–35.49).
 * Anything else is reported as unmatched so the caller can regenerate or refuse.
 */

export interface NarrativeFigure {
  raw: string;
  kind: "usd" | "pct";
  value: number;
  /** Half a unit of the figure's last stated digit. */
  tolerance: number;
}

export interface FigureCheckResult {
  checked: number;
  unmatched: string[];
}

const MAX_PAYLOAD_NUMBERS = 400;
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
    figures.push({ raw: match[0].trim(), kind: "usd", value, tolerance: toleranceFor(match[2], scale) });
  }
  for (const match of text.matchAll(PCT_PATTERN)) {
    const value = Number(`${match[1]}${match[2] ? `.${match[2]}` : ""}`);
    figures.push({ raw: match[0].trim(), kind: "pct", value, tolerance: toleranceFor(match[2], 1) });
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

export function checkNarrativeFigures(narrative: string, data: unknown): FigureCheckResult {
  const figures = extractFigures(narrative);
  if (figures.length === 0) return { checked: 0, unmatched: [] };
  const numbers = collectPayloadNumbers(data);
  const byKind = {
    usd: candidateValues(numbers, "usd"),
    pct: candidateValues(numbers, "pct"),
  };
  const unmatched = figures
    .filter((figure) => !byKind[figure.kind].some((value) => Math.abs(Math.abs(figure.value) - value) <= figure.tolerance))
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

/** The confidence an analysis earns from its figure check. */
export function confidenceFromFigureCheck(check: FigureCheckResult): { level: "high" | "medium" | "low"; basis: string[] } {
  if (check.unmatched.length > 0) {
    return { level: "low", basis: [`Not traced to Hamilton's data: ${check.unmatched.join(", ")}`] };
  }
  if (check.checked > 0) {
    return { level: "high", basis: [`${check.checked} figure${check.checked === 1 ? "" : "s"} traced to Hamilton's data`] };
  }
  return { level: "medium", basis: ["Qualitative analysis; no figures stated"] };
}
