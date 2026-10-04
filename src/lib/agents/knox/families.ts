import { CANONICAL_KEY_MAP, FEE_FAMILIES } from "@/lib/fee-taxonomy";
import {
  AMOUNT_PATTERN,
  classifyPatternKey,
  confidenceFor,
  detectFrequency,
  isConditionAmount,
  RANGE_JOINER,
  WAIVER_LANGUAGE,
  type ExtractionRulesResult,
} from "@/lib/agents/knox/rules";
import {
  cleanFeeName,
  composableTail,
  looksLikeHeading,
  passesDarwinChecks,
  QUALIFIER,
  splitCapsHeading,
  titleTail,
} from "@/lib/agents/knox/layout";

/**
 * Knox pass 2b: fee-family experts. Pure.
 *
 * Each expert reads the whole document as a stream of price windows: every price (or
 * explicit FREE/NONE) with the words between it and the previous price, across line
 * breaks and inside PDFs flattened to one long line. An expert keeps only windows that
 * name a fee of its own family, and reads the phrasing that family uses: tiers ("1st
 * item $25, 2nd item $35"), daily caps ("maximum of $175 per day"), thresholds ("for
 * balances below $2,500 ... $10"), waivers, ranges and free fees. Each expert is its
 * own strategy in the attempt log. Five experts cover overdraft/NSF, wires, ATM and
 * card, account maintenance and statements, and checks; `services` covers every other
 * canonical family (safe deposit, garnishments, notary, lending, IRA, ...).
 *
 * Like the table specialist, an expert emits a fee only when Darwin's category guard
 * and amount envelope would accept it (`passesDarwinChecks`).
 */

export interface FamilyExpert {
  family: string;
  strategy: string;
  version: number;
  keys: ReadonlySet<string>;
  /** Phrasings this family uses that the pass 1 patterns do not cover. Checked first. */
  patterns: Array<{ key: string; pattern: RegExp }>;
}

function familyKeys(...families: string[]): ReadonlySet<string> {
  return new Set(families.flatMap((family) => FEE_FAMILIES[family] ?? []));
}

/** The five fee families with their own expert; every other family goes to `services`. */
const EXPERT_FAMILIES = ["Overdraft & NSF", "Wire Transfers", "ATM & Card", "Account Maintenance", "Check Services"];

export const FAMILY_EXPERTS: readonly FamilyExpert[] = [
  {
    family: "overdraft_nsf",
    strategy: "extract.family.overdraft_nsf",
    version: 1,
    keys: familyKeys("Overdraft & NSF"),
    patterns: [
      { key: "od_protection_transfer", pattern: /\b(overdraft|OD)\b.{0,40}\bfrom (savings|shares?|money market|line)\b/i },
      { key: "overdraft", pattern: /\b(overdraft privilege|courtesy pay|paid items?|bounce)\b/i },
    ],
  },
  { family: "wires", strategy: "extract.family.wires", version: 1, keys: familyKeys("Wire Transfers"), patterns: [] },
  { family: "atm_card", strategy: "extract.family.atm_card", version: 1, keys: familyKeys("ATM & Card"), patterns: [] },
  {
    family: "account",
    strategy: "extract.family.account",
    version: 1,
    keys: familyKeys("Account Maintenance"),
    patterns: [
      {
        key: "minimum_balance",
        pattern: /\b(falls? below|low balance|below minimum|minimum balance)\b.{0,40}\b(fee|charge)\b|\b(fee|charge)\b.{0,40}\b(falls? below|below (the )?minimum)\b/i,
      },
    ],
  },
  { family: "checks", strategy: "extract.family.checks", version: 1, keys: familyKeys("Check Services"), patterns: [] },
  {
    family: "services",
    strategy: "extract.family.services",
    version: 1,
    keys: familyKeys(...Object.keys(FEE_FAMILIES).filter((family) => !EXPERT_FAMILIES.includes(family))),
    patterns: [],
  },
];

/** One price in the document and the words that name it. */
export interface PriceWindow {
  /** Raw text between the previous price (or the line start) and this one. */
  rawName: string;
  amount: number;
  zero: boolean;
  /** Threshold, cap or rate base rather than a price. */
  condition: boolean;
  /** Text right before the price (inside the line), used to read caps. */
  before: string;
  /** Text right after the price, up to the next price or 80 characters. */
  after: string;
  heading: string | null;
  lineIndex: number;
  excerpt: string;
}

const ZERO_TOKEN = /\b(FREE|NONE|No Charge|NO CHARGE|N\/C)\b/g;
const LEADER_AMOUNT = /(?:(?:\.\s?){3,}|…+)\s*(\d{1,4}\.\d{2})(?![\d%])/g;
const MAX_WINDOWS = 600;

interface ValueAt {
  amount: number;
  zero: boolean;
  start: number;
  end: number;
}

function valuesIn(line: string): ValueAt[] {
  const values: ValueAt[] = [];
  for (const match of line.matchAll(AMOUNT_PATTERN)) {
    const value = Number(match[1].replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    const start = match.index ?? 0;
    values.push({ amount: Math.round(value * 100) / 100, zero: false, start, end: start + match[0].length });
  }
  // "Stop Payment ........ 30.00": PDFs often drop the dollar sign after a dot leader.
  for (const match of line.matchAll(LEADER_AMOUNT)) {
    const value = Number(match[1].replace(/,/g, ""));
    const start = (match.index ?? 0) + match[0].length - match[1].length;
    if (Number.isFinite(value)) values.push({ amount: Math.round(value * 100) / 100, zero: false, start, end: start + match[1].length });
  }
  for (const match of line.matchAll(ZERO_TOKEN)) {
    const start = match.index ?? 0;
    values.push({ amount: 0, zero: true, start, end: start + match[0].length });
  }
  return values.sort((a, b) => a.start - b.start);
}

/** The document as price windows, in reading order. Exported for tests. */
export function priceWindows(text: string): PriceWindow[] {
  const lines = text.split(/\n+/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const windows: PriceWindow[] = [];
  let heading: string | null = null;
  let pending: string | null = null;

  lines.forEach((line, lineIndex) => {
    if (windows.length >= MAX_WINDOWS) return;
    const values = valuesIn(line);
    if (values.length === 0) {
      pending = line.length <= 160 ? line : null;
      if (looksLikeHeading(line)) heading = line;
      return;
    }
    let nameStart = 0;
    let afterCondition: number | null = null;
    values.forEach((value, index) => {
      let own = line.slice(nameStart, value.start);
      // After a threshold, a fresh name ("Up to $29 Rush Card Replacement $25") starts
      // the next fee; otherwise the threshold stays part of this fee's name
      // ("for balances below $2,500 ..... $10").
      if (afterCondition != null) {
        const fresh = line.slice(afterCondition, value.start);
        if ((fresh.match(/[a-z]{2,}/gi) ?? []).length >= 2) own = fresh;
      }
      // A price at the start of a line belongs to the name on the line above.
      const stacked = index === 0 && !/[a-z]/i.test(own) && pending != null;
      const rawName = stacked ? `${pending} ${own}` : own;
      const nextStart = values[index + 1]?.start ?? line.length;
      const after = line.slice(value.end, Math.min(nextStart, value.end + 80));
      const condition = !value.zero && isConditionAmount(line, value);
      const qualifier = after.match(QUALIFIER)?.[0] ?? "";
      windows.push({
        rawName,
        amount: value.amount,
        zero: value.zero,
        condition,
        before: line.slice(Math.max(0, value.start - 40), value.start),
        after,
        heading,
        lineIndex,
        excerpt: `${stacked ? `${pending} / ` : ""}${line.slice(value.start - own.length, value.end + qualifier.length)}`.trim().slice(-280),
      });
      if (condition) {
        afterCondition = value.end + qualifier.length;
      } else {
        nameStart = value.end + qualifier.length;
        afterCondition = null;
      }
    });
    const tail = line.slice(nameStart).trim();
    pending = /[a-z]/i.test(tail) && tail.length <= 160 ? tail : null;
  });
  return windows;
}

const TIER_UNIT = "(?:items?|withdrawals?|presentments?|occurrences?|overdrafts?|nsfs?|times?|transactions?)";
const TIER_LABEL = new RegExp(
  `^(?:(?:\\d+(?:st|nd|rd|th)|first|second|third|fourth|fifth|each additional|additional|subsequent)\\b.{0,20}\\b${TIER_UNIT}\\b|` +
    `(?:\\d+\\s*(?:-|–|to)\\s*\\d+|\\d+\\+|over \\d+|after \\d+)\\s+${TIER_UNIT}\\b).{0,30}$`,
  "i",
);
const CAP_BEFORE = /\b(max(?:imum)?|cap(?:ped)?|up to|not to exceed|limit(?:ed)?)\b[^$]{0,30}$/i;
const CAP_AFTER = /^\s*\)?\s*(?:per|a|each)\s+(?:business\s+)?day\b|^\s*\)?\s*daily\b/i;
const NEGATIVE_NAME = /\b(no (?:[a-z]+ )?(?:fee|charge)s?|not charged|without charge)\b/i;

/** "Overdraft fee 1st item" → "Overdraft fee": the fee a later tier row belongs to. */
function tierBase(feeName: string): string {
  const base = feeName
    .replace(/\s*\([^)]*\)$/, "")
    .replace(/\s*[-–,(]?\s*\b(?:\d+(?:st|nd|rd|th)|first|second|third|each|per)\b.*$/i, "")
    .trim();
  return base.length >= 3 ? base : feeName;
}

interface FamilyMatch {
  hint: string;
  feeName: string;
}

function classifyFor(expert: FamilyExpert, name: string): string | null {
  const text = name.replace(/[‘’ʼ`]/g, "'");
  const key = expert.patterns.find((entry) => entry.pattern.test(text))?.key ?? classifyPatternKey(text);
  const canonical = key ? CANONICAL_KEY_MAP[key] : null;
  return canonical && expert.keys.has(canonical) ? canonical : null;
}

function matchFor(expert: FamilyExpert, name: string, heading: string | null): FamilyMatch | null {
  const hint = classifyFor(expert, name);
  if (hint) return { hint, feeName: name };
  if (!heading || !composableTail(name)) return null;
  const headed = classifyFor(expert, `${heading} ${name}`);
  return headed ? { hint: headed, feeName: `${heading}: ${name}` } : null;
}

/** One family expert over the document's price windows. */
export function runFamilyExpert(expert: FamilyExpert, windows: PriceWindow[]): ExtractionRulesResult {
  const result: ExtractionRulesResult = { candidates: [], held: [] };
  let last: (FamilyMatch & { lineIndex: number }) | null = null;

  windows.forEach((window, index) => {
    const split = splitCapsHeading(window.rawName.replace(AMOUNT_PATTERN, " ").trim());
    const heading = split.heading ?? window.heading;
    const cleaned = cleanFeeName(split.name);
    // The fee's own name ends right before its price; earlier lowercase terms belong
    // to the fee before it.
    const tail = cleaned ? titleTail(cleaned) : null;
    const name = tail && classifyPatternKey(tail) ? tail : cleaned;
    const recent = last && window.lineIndex - last.lineIndex <= 2 ? last : null;
    const detail = `${window.rawName} ${window.after}`;
    const frequency = detectFrequency(detail);

    // A daily cap on overdraft or NSF fees, stated in dollars.
    if (window.condition) {
      if (
        expert.family === "overdraft_nsf" &&
        CAP_BEFORE.test(window.before) &&
        CAP_AFTER.test(window.after) &&
        recent &&
        (recent.hint === "overdraft" || recent.hint === "nsf")
      ) {
        const hint = recent.hint === "overdraft" ? "od_daily_cap" : "nsf_daily_cap";
        const feeName = `${recent.feeName} daily maximum`;
        if (passesDarwinChecks(hint, feeName, window.amount)) {
          result.candidates.push({
            feeName,
            amount: window.amount,
            frequency: "daily",
            canonicalHint: hint,
            confidence: confidenceFor(window.excerpt) - 0.04,
            excerpt: window.excerpt,
            waivable: false,
          });
        }
      }
      return;
    }
    if (!name || NEGATIVE_NAME.test(name)) return;

    // A tier row under the fee above it: "1st item $25" after "Overdraft fee".
    let match = matchFor(expert, name, heading);
    if (!match && recent && TIER_LABEL.test(name)) {
      match = { hint: recent.hint, feeName: `${tierBase(recent.feeName)} (${name})` };
    }
    if (!match) return;
    last = { ...match, lineIndex: window.lineIndex };

    if (window.zero) {
      if (passesDarwinChecks(match.hint, match.feeName, 0)) {
        result.held.push({ shape: "zero", feeName: match.feeName, amount: 0, amountMax: null, percent: null, frequency, canonicalHint: match.hint, excerpt: window.excerpt });
      }
      return;
    }
    const next = windows[index + 1];
    if (next && next.lineIndex === window.lineIndex && !next.zero && RANGE_JOINER.test(next.rawName)) {
      result.held.push({
        shape: "range",
        feeName: match.feeName,
        amount: Math.min(window.amount, next.amount),
        amountMax: Math.max(window.amount, next.amount),
        percent: null,
        frequency,
        canonicalHint: match.hint,
        excerpt: window.excerpt,
      });
      return;
    }
    if (window.after.trimStart().startsWith("%") || window.amount <= 0) return;
    if (!passesDarwinChecks(match.hint, match.feeName, window.amount)) return;
    result.candidates.push({
      feeName: match.feeName,
      amount: window.amount,
      frequency,
      canonicalHint: match.hint,
      confidence: confidenceFor(window.excerpt),
      excerpt: window.excerpt,
      waivable: WAIVER_LANGUAGE.test(window.after),
    });
  });
  return result;
}
