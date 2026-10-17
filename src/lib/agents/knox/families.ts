import { CELL_SEPARATOR } from "@/lib/agents/rosetta/html-dom";
import { retiredKeysInFamilies } from "@/lib/fee-fold";
import { CANONICAL_KEY_MAP, FEE_FAMILIES } from "@/lib/fee-taxonomy";
import {
  AMOUNT_PATTERN,
  classifyPatternKey,
  confidenceFor,
  detectFrequency,
  isConditionAmount,
  nearestFeeText,
  notAZeroPrice,
  RANGE_JOINER,
  WAIVER_LANGUAGE,
  type ExtractionRulesResult,
} from "@/lib/agents/knox/rules";
import {
  cleanFeeName,
  composableTail,
  inPriceFirstRun,
  looksLikeHeading,
  nameAfterPrice,
  qualifiesName,
  passesDarwinChecks,
  QUALIFIER,
  runsOn,
  splitCapsHeading,
  statesItsPriceVaries,
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
  patterns: Array<{ key: string; pattern: RegExp; needsPeriod?: boolean }>;
}

// A family still reads the categories folded out of it into the top 50; `refileCategory`
// places those reads among the 50 before Darwin and Hamilton see them.
function familyKeys(...families: string[]): ReadonlySet<string> {
  return new Set([...families.flatMap((family) => FEE_FAMILIES[family] ?? []), ...retiredKeysInFamilies(families)]);
}

/** The five fee families with their own expert; every other family goes to `services`. */
const EXPERT_FAMILIES = ["Overdraft & NSF", "Wire Transfers", "ATM & Card", "Account Maintenance", "Check Services"];

export const FAMILY_EXPERTS: readonly FamilyExpert[] = [
  {
    family: "overdraft_nsf",
    strategy: "extract.family.overdraft_nsf",
    version: 5,
    keys: familyKeys("Overdraft & NSF"),
    patterns: [
      { key: "od_protection_transfer", pattern: /\b(overdraft|OD)\b.{0,40}\bfrom (savings|shares?|money market|line)\b/i },
      { key: "overdraft", pattern: /\b(overdraft privilege|courtesy pay|paid items?|bounce)\b/i },
    ],
  },
  { family: "wires", strategy: "extract.family.wires", version: 4, keys: familyKeys("Wire Transfers"), patterns: [] },
  { family: "atm_card", strategy: "extract.family.atm_card", version: 4, keys: familyKeys("ATM & Card"), patterns: [] },
  {
    family: "account",
    strategy: "extract.family.account",
    // v5 (#1100): a low-balance charge named with no fee word ("Low balance $ 5.00 per month",
    // "Savings Balance Less than $300.00 ... $6.00 per month", "Money Market minimum balance
    // violation* $9.00 per month", "Savvy Spending - Minimum Balance $4.95/Month if ...") is the
    // minimum balance fee when its own line charges it by the period.
    version: 5,
    keys: familyKeys("Account Maintenance"),
    patterns: [
      {
        key: "minimum_balance",
        pattern: /\b(falls? below|low balance|below minimum|minimum balance)\b.{0,40}\b(fee|charge)\b|\b(fee|charge)\b.{0,40}\b(falls? below|below (the )?minimum)\b/i,
      },
      {
        key: "minimum_balance",
        pattern: /^\s*low[- ]balance\s*\*?\s*$|\bminimum balance violation\b|[-–]\s*minimum balance\s*$|^\s*(?:savings|share|checking|account|average daily|daily)?\s*balance\s+(?:less than|below|under|falls below)\s*$/i,
        needsPeriod: true,
      },
    ],
  },
  { family: "checks", strategy: "extract.family.checks", version: 4, keys: familyKeys("Check Services"), patterns: [] },
  {
    family: "services",
    strategy: "extract.family.services",
    version: 4,
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
  /** v42: the nearest line above, with no price, that names a fee ("Paid Consumer & Business NSF Items"). */
  feeLine?: string | null;
  lineIndex: number;
  excerpt: string;
  /** #1827: the name is the whole cell after a price-first row's price, never a tail of prose. */
  priceFirst?: boolean;
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
  let feeLine: { name: string; lineIndex: number } | null = null;

  lines.forEach((line, lineIndex) => {
    if (windows.length >= MAX_WINDOWS) return;
    const values = valuesIn(line);
    if (values.length === 0) {
      // "(for each overdraft item paid)" under "Overdraft Item Fee": the name stays the one above.
      if (!(pending != null && qualifiesName(line))) pending = line.length <= 160 ? line : null;
      // A table row with no price ("Check Printing Fee | Prices vary") is a fee, not a heading.
      if (looksLikeHeading(line) && !line.includes(CELL_SEPARATOR)) heading = line;
      if (/^[A-Z]/.test(line) && !line.includes(CELL_SEPARATOR) && line.length <= 120 && classifyPatternKey(line)) {
        feeLine = { name: line, lineIndex };
      }
      return;
    }
    let nameStart = 0;
    let afterCondition: number | null = null;
    let priceFirstLine = false;
    // "... a fee of $25.00 on the 7th day. This fee is in addition to any Overdraft Fees. | $25.00":
    // a row's price cell repeating the price before it, in the same cell, is the same fee.
    const lastCell = line.lastIndexOf(CELL_SEPARATOR);
    const priceCellAt = lastCell >= 0 && /^\s*\$?\s?\d[\d,]*(?:\.\d{1,2})?\s*$/.test(line.slice(lastCell + CELL_SEPARATOR.length))
      ? lastCell
      : -1;
    values.forEach((value, index) => {
      if (priceCellAt >= 0 && index > 0 && value.start > priceCellAt && !value.zero && value.amount === values[index - 1].amount &&
        line.lastIndexOf(CELL_SEPARATOR, priceCellAt - 1) < values[index - 1].start) {
        nameStart = value.end;
        return;
      }
      let own = line.slice(nameStart, value.start);
      // After a threshold, a fresh name ("Up to $29 Rush Card Replacement $25") starts
      // the next fee; otherwise the threshold stays part of this fee's name
      // ("for balances below $2,500 ..... $10").
      if (afterCondition != null) {
        const fresh = line.slice(afterCondition, value.start);
        if ((fresh.match(/[a-z]{2,}/gi) ?? []).length >= 2) own = fresh;
      }
      const nextStart = values[index + 1]?.start ?? line.length;
      const after = line.slice(value.end, Math.min(nextStart, value.end + 80));
      const condition = !value.zero && isConditionAmount(line, value);
      const qualifier = after.match(QUALIFIER)?.[0] ?? "";
      const opensLine = index === 0 && !/[a-z]/i.test(own);
      // #1827: a price that opens a table row with a name after it ("| **$20** | Key Deposit |",
      // Valley Strong CU) is that name's, and so is one with a name after it under a name that says
      // its price varies ("Mortgage satisfaction fee (varies)" / "$1,000.00 Mortgage modification",
      // Citadel FCU). Read as stacked, every row took the next row's price. A bare price under a
      // "varies" name is still that name's ("Skip-A-Payment Fee (Varies with payment)" / "$25.00").
      // A name above that runs on keeps the price ("Inactivity Fee - Savings Account per" / "$5 |
      // Cross-border transaction fee": a two-column page), and so does one over a lone price-first
      // row (`inPriceFirstRun`: "Overdraft Fee" / "$35.00 | Stop Payment Fee").
      const priceFirst = opensLine && values.length === 1 && !value.zero && !(pending != null && runsOn(pending)) &&
        ((line.includes(CELL_SEPARATOR) && (pending == null || !/[a-z]{2,}/i.test(pending) || inPriceFirstRun(lines, lineIndex))) ||
          (pending != null && statesItsPriceVaries(pending)))
        ? nameAfterPrice(line.slice(value.end + qualifier.length))
        : null;
      // A price at the start of a line belongs to the name on the line above.
      const stacked = !priceFirst && opensLine && pending != null;
      const rawName = priceFirst ?? (stacked ? `${pending} ${own}` : own);
      if (priceFirst) priceFirstLine = true;
      windows.push({
        rawName,
        amount: value.amount,
        zero: value.zero,
        condition,
        before: line.slice(Math.max(0, value.start - 40), value.start),
        after,
        heading,
        feeLine: feeLine && lineIndex - feeLine.lineIndex <= 3 ? feeLine.name : null,
        lineIndex,
        ...(priceFirst ? { priceFirst: true } : {}),
        excerpt: priceFirst
          ? line.slice(0, 280)
          : `${stacked ? `${pending} / ` : ""}${line.slice(value.start - own.length, value.end + qualifier.length)}`.trim().slice(-280),
      });
      if (condition) {
        afterCondition = value.end + qualifier.length;
      } else {
        nameStart = value.end + qualifier.length;
        afterCondition = null;
      }
    });
    const tail = line.slice(nameStart).trim();
    // A price-first row's name is its own price's, never the next line's.
    pending = !priceFirstLine && /[a-z]/i.test(tail) && tail.length <= 160 ? tail : null;
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
/** A cap named after its figure: "$25 per item ($50 maximum per day)". */
const CAP_NAMED_AFTER = /^\s*(?:max(?:imum)?|cap)\s+(?:per|a|each)\s+(?:business\s+)?day\b/i;
const THRESHOLD_ROW = /^(?:per|each)\s+(?:item|check|transaction|occurrence|presentment)s?\s+(?:greater|more|over|above|exceeding|less|under|below)\b/i;
/** v5 (#1100): "... a low balance fee of" / "... impose a maintenance fee of" right before the price. */
const SENTENCE_ACCOUNT_FEE = /\b(?:an?|the)\s+((?:low[- ]balance|maintenance|monthly (?:service|maintenance)|minimum balance)\s+(?:fee|charge))\s+of\s*$/i;
/** ... charged by the statement cycle or month right after the price. */
const STATEMENT_CYCLE_AFTER = /^\s*(?:will be (?:imposed|charged|assessed)\s+)?(?:(?:once\s+)?(?:during|every|each|per)\s+(?:the\s+)?(?:monthly\s+)?(?:statement cycle|month|cycle)|per month|monthly)\b/i;
const NEGATIVE_NAME = /\b(no (?:[a-z]+ ){0,2}(?:fee|charge)s?|not charged|without charge)\b/i;

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

function classifyFor(expert: FamilyExpert, name: string, periodic = false): string | null {
  const text = name.replace(/[‘’ʼ`]/g, "'");
  // A name the general rules file under another family is not this family's fee
  // ("Photocopy of paid item" is a copy fee, not an overdraft).
  const general = classifyPatternKey(text);
  if (general && !expert.keys.has(CANONICAL_KEY_MAP[general] ?? "")) return null;
  const key = expert.patterns.find((entry) => (!entry.needsPeriod || periodic) && entry.pattern.test(text))?.key ?? general;
  const canonical = key ? CANONICAL_KEY_MAP[key] : null;
  return canonical && expert.keys.has(canonical) ? canonical : null;
}

function matchFor(expert: FamilyExpert, name: string, heading: string | null, periodic = false): FamilyMatch | null {
  const hint = classifyFor(expert, name, periodic);
  if (hint) return { hint, feeName: name };
  // A name the rules already file elsewhere never borrows this family's heading.
  if (!heading || !composableTail(name) || classifyPatternKey(name)) return null;
  const headed = classifyFor(expert, `${heading} ${name}`);
  return headed ? { hint: headed, feeName: `${heading}: ${name}` } : null;
}

/** One family expert over the document's price windows. */
export function runFamilyExpert(expert: FamilyExpert, windows: PriceWindow[]): ExtractionRulesResult {
  const result: ExtractionRulesResult = { candidates: [], held: [] };
  let last: (FamilyMatch & { lineIndex: number }) | null = null;

  windows.forEach((window, index) => {
    // In a flattened table row the cell nearest the price names it.
    const ownText = window.rawName.includes(CELL_SEPARATOR) ? nearestFeeText(window.rawName) : window.rawName;
    const split = splitCapsHeading(ownText.replace(AMOUNT_PATTERN, " ").trim());
    const heading = split.heading ?? window.heading;
    const cleaned = cleanFeeName(split.name);
    // The fee's own name ends right before its price; earlier lowercase terms belong
    // to the fee before it.
    const tail = cleaned && !window.priceFirst ? titleTail(cleaned) : null;
    // v28: a fee named after the previous fee's note ("Check printing – (fee depends on
    // style) Temporary check – $.20") is the words after the note.
    const afterNote = cleanFeeName(split.name.match(/\)\s*([A-Z][^()]*?)\s*[–—-]?\s*$/)?.[1] ?? "");
    // v5 (#1100): an account's low-balance or maintenance fee stated in a sentence ("... – A low
    // balance fee of $6.95 will be imposed every statement cycle if ...", "we will impose a
    // maintenance fee of $7.50 once during the statement cycle") is named by its own words.
    const sentenceFee = expert.family === "account" && STATEMENT_CYCLE_AFTER.test(window.after)
      ? SENTENCE_ACCOUNT_FEE.exec(window.rawName)?.[1] ?? null
      : null;
    const name = sentenceFee
      ? sentenceFee.charAt(0).toUpperCase() + sentenceFee.slice(1).toLowerCase()
      : afterNote && classifyPatternKey(afterNote) ? afterNote
        // v5 (#1100): in the account family, a capitalized tail after prose ("... is not met Enriched
        // Spending - Minimum Balance $6.95/Month") names the fee even when no general rule files it.
        : tail && (classifyPatternKey(tail) || (expert.family === "account" && /^[a-z]/.test(cleaned ?? ""))) ? tail : cleaned;
    const recent = last && window.lineIndex - last.lineIndex <= 2 ? last : null;
    const detail = `${window.rawName} ${window.after}`;
    const frequency = detectFrequency(detail);

    // A daily cap on overdraft or NSF fees, stated in dollars.
    if (window.condition) {
      if (
        expert.family === "overdraft_nsf" &&
        ((CAP_BEFORE.test(window.before) && CAP_AFTER.test(window.after)) || CAP_NAMED_AFTER.test(window.after)) &&
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
    // A name that opens mid-sentence is prose from an agreement, not a fee row.
    if (!name || NEGATIVE_NAME.test(name) || /^[a-z]/.test(name)) return;

    // A tier row under the fee above it: "1st item $25" after "Overdraft fee".
    // A charge by the period, stated right after the price ("$5.00 per month").
    const periodic = /^\s*(?:per\s+(?:month|statement(?:\s+cycle)?|quarter)|\/\s*(?:mo|month)\b|monthly\b|a month\b)/i.test(window.after);
    let match = matchFor(expert, name, heading, periodic);
    if (!match && recent && TIER_LABEL.test(name) && !classifyPatternKey(name)) {
      match = { hint: recent.hint, feeName: `${tierBase(recent.feeName)} (${name})` };
    }
    // v42: a price row named only by its threshold ("Per Item greater than $10.01 | $30") under a
    // fee line with no price ("Paid Consumer & Business NSF Items", NIH FCU) is that fee's.
    if (!match && window.feeLine && THRESHOLD_ROW.test(name) && !classifyPatternKey(name)) {
      const hint = classifyFor(expert, window.feeLine);
      const feeLineName = cleanFeeName(window.feeLine.replace(/\s*[-–]\s*[a-z]\S*$/, ""));
      if (hint && feeLineName) match = { hint, feeName: feeLineName };
    }
    if (!match) return;
    last = { ...match, lineIndex: window.lineIndex };

    if (window.zero) {
      if (passesDarwinChecks(match.hint, match.feeName, 0) && !notAZeroPrice(match.hint, match.feeName)) {
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
