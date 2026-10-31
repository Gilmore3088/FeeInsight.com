/**
 * Numbers written as words (#975 go-live, #1899): the figures a written answer states without
 * digits, read as the dollar amounts and percentages the figure check already traces
 * (figure-check.ts), under the same units rule as digits. A word number is a figure only when it
 * carries a unit the check reads, so ordinary words never become figures:
 *
 * - dollars: a cardinal before "dollars" ("twenty-five dollars", "two million dollars"), the
 *   digit rule's "$". "dollar" in the singular counts only before a fee or price word or at the end
 *   of a clause ("a hundred-dollar fee", "a thirty dollar median", "it costs one dollar."), so "one
 *   dollar axis" and "two dollar figures" stay words. "a dollar" on its own is not a figure.
 * - percent: a cardinal before "percent" or "per cent" ("fifteen percent"), the digit rule's "%".
 * - digits with the unit in words, read the same way: "25 dollars", "2.5 million dollars", "30 per
 *   cent", and a range's first end ("25 to 30 percent"). A "$" or "%" figure is the digit rule's
 *   alone ("$25 dollars" is $25 once), and a year is a basis, not an amount ("in 2025 dollars").
 * - shares, read as a percentage: "three in ten", "one out of four" (words or digits, the first no
 *   larger than the second, never followed by a unit of time or a scale word), and a fraction of a
 *   group: "half of peers", "half the banks", "a third of credit unions", "two thirds of members".
 *   A share counts only directly before a plural group of institutions or people, with at most one
 *   describing word from a fixed list ("of local banks"): "half of what peers charge", "half the
 *   fee", "a third of the median", "of the year", "half an hour" are not figures. "half" after a
 *   position word ("the bottom half of peers") is a position, and "Rank 3 in 10", "Step 2 in 5",
 *   "Day 1 in 30" or "top 10 in 50 states" are ranks and steps, not shares.
 * - decimals in words: "one point five percent" is 1.5%, "two and a half dollars" $2.50. A decimal
 *   said aloud with digits in it is one figure too: "1 point 5 percent", "1 point 5%", "one point 5
 *   percent", "1 and a half percent" are 1.5%, "2 point 25 percent" 2.25%, "$1 point 5 million" and
 *   "one point five million dollars" $1.5 million, never a "1" and a "5 percent" (#975).
 * - cents after dollars: "35 dollars and 50 cents" is $35.50, to the cent.
 *
 * Never figures here: "one of the banks", "no one", "a single fee", "first" and other ordinals,
 * "once", "one" as a pronoun. A count of institutions, branches or complaints ("a dozen
 * institutions", "twelve banks", "12 institutions") is read by count-figures.ts and traced as a
 * count, never as a dollar amount or a percentage; "a dozen" is read here only where it carries a
 * unit ("a dozen dollars").
 *
 * Tolerance follows the digit rule: half a unit of the last stated place ("twenty-five dollars"
 * covers 24.50 to 25.49, "two million dollars" covers 1.5 to 2.5 million, as "$2 million" does). A
 * share is read as the whole percent it names: 0.5 of a point when that is a whole number ("three in
 * ten" is 30%, as "30%" is), one point when it is not ("two thirds" covers 66% and 67%). A hedge
 * before a share widens it by up to 5 points in the direction the hedge gives (`hedgedShare`):
 * "about half" covers 45% to 55%, "nearly half" 45% to 50%, "more than half" 50% to 55%.
 * `raw` is the exact characters of the figure in the text, so a hold or cut replaces just them.
 */

const UNIT_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS_WORDS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALE_WORDS: Record<string, number> = { thousand: 1e3, million: 1e6, billion: 1e9 };

const FIRST_WORD = `(?:${[...Object.keys(UNIT_WORDS), ...Object.keys(TENS_WORDS)].join("|")})`;
const ANY_WORD = `(?:${[...Object.keys(UNIT_WORDS), ...Object.keys(TENS_WORDS), "hundred", "dozen", ...Object.keys(SCALE_WORDS)].join("|")})`;
/** Words between number words: a space or hyphen, and "and" only after hundred or a scale word ("a hundred and five"). */
const JOIN = String.raw`(?:(?<=(?:hundred|thousand|million|billion))\s+and)?[\s-]+`;
/** A cardinal in words: it opens with a unit or tens word, or "a"/"an" before hundred, dozen or a scale word. */
export const CARDINAL = String.raw`(?:\ban?[\s-]+(?=(?:hundred|dozen|thousand|million|billion)\b)|\b(?=${FIRST_WORD}\b))${ANY_WORD}(?:${JOIN}${ANY_WORD})*\b`;

export interface ParsedCardinal {
  value: number;
  /** The scale of the last stated place: 1, or a thousand, million or billion when the words end on one. */
  place: number;
}

/** A cardinal in words ("twenty-five", "a hundred and five", "two million"), or null when the words do not form one. */
export function parseCardinal(words: string): ParsedCardinal | null {
  const tokens = words.toLowerCase().split(/[\s-]+/).filter((token) => token && token !== "and");
  if (tokens.length === 0) return null;
  let total = 0;
  let current = 0;
  let open = false;
  let place = 1;
  let lastScale = Infinity;
  for (const [i, token] of tokens.entries()) {
    if (token === "a" || token === "an") {
      if (i !== 0) return null;
      current = 1; open = true; continue;
    }
    if (token in UNIT_WORDS) {
      // A unit follows only a tens word, hundred or a scale word: "twenty-five", never "five six" or "twelve three".
      if (open && (current % 10 !== 0 || current % 100 >= 10 && current % 100 < 20 || tokens[i - 1] === "a" || tokens[i - 1] === "an")) return null;
      if (open && current % 100 !== 0 && UNIT_WORDS[token] >= 10) return null;
      current += UNIT_WORDS[token]; open = true; place = 1; continue;
    }
    if (token in TENS_WORDS) {
      if (open && current % 100 !== 0) return null;
      if (open && (tokens[i - 1] === "a" || tokens[i - 1] === "an")) return null;
      current += TENS_WORDS[token]; open = true; place = 1; continue;
    }
    if (token === "hundred") {
      if (!open || current < 1 || current > 9) return null;
      current *= 100; place = 1; continue;
    }
    if (token === "dozen") {
      if (!open || current < 1 || current > 99) return null;
      current *= 12; place = 1; continue;
    }
    const scale = SCALE_WORDS[token];
    if (scale === undefined || !open || current === 0 || scale >= lastScale) return null;
    total += current * scale;
    current = 0; open = false; place = scale; lastScale = scale;
  }
  return { value: total + current, place };
}

export interface SpelledFigure {
  raw: string;
  kind: "usd" | "pct";
  value: number;
  tolerance: number;
  index: number;
}

/** What may follow a singular "dollar" for it to be an amount: a fee or price word within two words, or the clause's end. */
const SINGULAR_DOLLAR_AFTER = String.raw`(?=(?:[\s-]+[\w'’-]+){0,2}?[\s-]+(?:fees?|charges?|surcharges?|prices?|costs?|minimums?|maximums?|medians?|averages?|caps?|balances?|amounts?|overdrafts?|increases?|decreases?|differences?|gaps?|premiums?|discounts?|rises?|drops?|cuts?)\b|\s*(?:[.,;:!?)]|$))`;
/**
 * A number in digits that takes its unit in words ("25 dollars", "2.5 million dollars", "30 per cent").
 * Never one a "$" opens ("$25 dollars" is the digit rule's "$25") or one inside a longer number.
 */
const WHOLE_DIGITS = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)`;
const DIGIT_START = String.raw`(?<![\w$.,])(?<!\$\s)`;
const DIGITS = String.raw`${DIGIT_START}${WHOLE_DIGITS}(?:\.\d+)?(?:\s*(?:thousand|million|billion)\b)?`;
/**
 * A decimal said aloud after a whole number in words or digits: "one point five", "twelve point two
 * five", "two and a half", and the mixed forms "1 point 5", "2 point 25", "one point 5", "1 point
 * five", "1 and a half" (#975). The whole phrase is one figure: "1 point 5 percent" is 1.5%, never a
 * "1" and a "5 percent". A scale word may follow ("1 point 5 million dollars").
 */
const DIGIT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const WORD_DECIMAL = String.raw`(?:\s+point(?:(?:\s+(?:${DIGIT_WORDS.join("|")})\b)+|\s+\d+\b(?![.,]\d))|\s+and\s+a\s+half\b)`;
const DECIMAL_SCALE = String.raw`(?:\s+(?:thousand|million|billion)\b)?`;
const AMOUNT = String.raw`(?:${DIGIT_START}${WHOLE_DIGITS}${WORD_DECIMAL}${DECIMAL_SCALE}|${DIGITS}|${CARDINAL}(?:${WORD_DECIMAL}${DECIMAL_SCALE})?)`;
/** Cents after dollars ("35 dollars and 50 cents", "thirty-five dollars and fifty cents"): read with the dollars, to the cent. */
const CENTS_TAIL = String.raw`\s+and\s+(?:\d{1,2}|${CARDINAL})\s+cents?\b`;
const DOLLARS = new RegExp(String.raw`(${AMOUNT})[\s-]+(?:dollars?(?=${CENTS_TAIL})|dollars\b|dollar\b${SINGULAR_DOLLAR_AFTER})(${CENTS_TAIL})?`, "gi");
/** "percent" or "per cent" after any amount, and "%" after a decimal said aloud ("1 point 5%"), which the digit rule would read as "5%". */
const PERCENT = new RegExp(String.raw`(${AMOUNT})(?:[\s-]+percent\b|\s+per\s+cent\b|(?<=${WORD_DECIMAL})\s?%)`, "gi");
/**
 * A "$" before a decimal said aloud ("$1 point 5 million", "$2 and a half"): the digit rule reads only
 * "$1" or "$2" there, so the whole phrase is read here and replaces it (figure-check.ts).
 */
const DOLLAR_SIGN_DECIMAL = new RegExp(String.raw`(?<![\w$.,])\$\s?(${WHOLE_DIGITS}${WORD_DECIMAL}${DECIMAL_SCALE})`, "gi");
/** The first figure of a range that shares the unit of the second ("ten to twenty dollars", "25 to 30 percent"). */
const RANGE_LEAD = new RegExp(String.raw`(${AMOUNT})[\s-]*(?:to|and|or|through|-|–)[\s-]*$`, "i");
/** The tail of a decimal in words: a figure that starts after "point" is the decimal's end, never a number of its own. */
const AFTER_POINT = /\bpoint\s+$/i;
const DIGIT_AMOUNT = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?:\s*(thousand|million|billion))?$/i;
/** A year ("in 2025 dollars") is a basis, not an amount. */
const YEAR = /^(?:19|20)\d{2}$/;

interface ReadAmount { offset: number; value: number; place: number; decimals: number; year: boolean }

const DECIMAL_POINT_END = /\s+point\s+(\d+|[a-z]+(?:\s+[a-z]+)*)$/i;
const DECIMAL_HALF_END = /\s+and\s+a\s+half$/i;

/** A number in digits (with an optional scale word) or in words, with where it starts in `words`. */
function readAmount(words: string): ReadAmount | null {
  const digits = DIGIT_AMOUNT.exec(words.trim());
  if (digits) {
    const place = digits[3] ? SCALE_WORDS[digits[3].toLowerCase()] : 1;
    return { offset: words.length - words.trimStart().length, value: Number(`${digits[1].replace(/,/g, "")}${digits[2] ? `.${digits[2]}` : ""}`) * place,
      place, decimals: digits[2]?.length ?? 0, year: !digits[2] && !digits[3] && YEAR.test(digits[1]) };
  }
  // A scale word after a decimal said aloud ("1 point 5 million"): the decimal times the scale, to its last stated place.
  const scaled = /\s+(thousand|million|billion)$/i.exec(words);
  if (scaled) {
    const before = words.slice(0, scaled.index);
    if (DECIMAL_POINT_END.test(before) || DECIMAL_HALF_END.test(before)) {
      const decimal = readAmount(before);
      if (!decimal || decimal.place !== 1) return null;
      const scale = SCALE_WORDS[scaled[1].toLowerCase()];
      return { ...decimal, value: decimal.value * scale, place: scale };
    }
  }
  const point = DECIMAL_POINT_END.exec(words);
  const half = DECIMAL_HALF_END.exec(words);
  const whole = point ? words.slice(0, point.index) : half ? words.slice(0, half.index) : words;
  // The whole part of a decimal said aloud may be digits ("1 point 5") or words ("one point 5").
  const wholeDigits = (point || half) ? /^(\s*)(\d{1,3}(?:,\d{3})+|\d+)$/.exec(whole) : null;
  const tail = wholeDigits
    ? { offset: wholeDigits[1].length, parsed: { value: Number(wholeDigits[2].replace(/,/g, "")), place: 1 } }
    : cardinalTail(whole);
  if (!tail) return null;
  if (point) {
    const fraction = /^\d+$/.test(point[1]) ? point[1]
      : point[1].trim().toLowerCase().split(/\s+/).map((word) => DIGIT_WORDS.indexOf(word));
    if (Array.isArray(fraction) && fraction.some((digit) => digit < 0)) return null;
    if (tail.parsed.place !== 1) return null;
    const stated = Array.isArray(fraction) ? fraction.join("") : fraction;
    return { offset: tail.offset, value: Number(`${tail.parsed.value}.${stated}`), place: 1, decimals: stated.length, year: false };
  }
  if (half) {
    if (tail.parsed.place !== 1) return null;
    return { offset: tail.offset, value: tail.parsed.value + 0.5, place: 1, decimals: 1, year: false };
  }
  return { offset: tail.offset, value: tail.parsed.value, place: tail.parsed.place, decimals: 0, year: false };
}

/** The cents of a "dollars and N cents" tail, or null when it is not a whole number of cents below 100. */
function readCents(tail: string): number | null {
  const words = /and\s+(.+?)\s+cents?$/i.exec(tail.trim())?.[1];
  if (!words) return null;
  const cents = /^\d+$/.test(words) ? Number(words) : parseCardinal(words)?.value ?? null;
  return cents !== null && Number.isInteger(cents) && cents >= 0 && cents < 100 ? cents : null;
}

/** Half a unit of the last stated place: a dollar figure's place includes its scale word, a percent's never does. */
const amountTolerance = (kind: "usd" | "pct", amount: Pick<ReadAmount, "place" | "decimals">) =>
  0.5 * 10 ** -amount.decimals * (kind === "usd" ? amount.place : 1) + 1e-9;

const SHARE_NUMBER = String.raw`(?:${CARDINAL}|\b\d{1,3}\b)`;
/**
 * The groups a share is of: institutions and the people they serve, in the plural. Never a fee, a
 * price, an amount or a pronoun: "half of what peers charge", "half the fee", "a third of the
 * median" are ratios of a price, not shares of a group (review of #975).
 */
const GROUP = String.raw`(?:banks|credit\s+unions|institutions|peers|competitors|lenders|filers|CUs|members|customers|consumers|households|respondents|account\s+holders)\b(?!['’])`;
/** The one describing word a group may take ("of local banks", "the peer institutions"). */
export const GROUP_ADJECTIVE = String.raw`(?:local|peer|nearby|large|larger|small|smaller|community|regional|national|similar|comparable|other|area|state|federal)`;
export const DETERMINER = String.raw`(?:the|its|their|your|our|all|these|those)`;
const GROUP_PHRASE = String.raw`(?:${GROUP_ADJECTIVE}\s+)?${GROUP}`;
/** A rank, step, page or item number: "Rank 3 in 10", "Step 2 in 5", "Day 1 in 30", "No. 4 in 9". */
const RANK_BEFORE = String.raw`(?<!\b(?:rank|ranks|ranked|ranking|top|step|steps|day|days|page|pages|item|items|number|no\.?|#)\s*)`;
/** "x in y" or "x out of y" is a share only directly before a group: "three in ten banks", "one in four local peers". */
const SHARE = new RegExp(String.raw`${RANK_BEFORE}(?<![\d$.,#])(${SHARE_NUMBER})\s+(?:in|out\s+of)\s+(${SHARE_NUMBER})(?=\s+${GROUP_PHRASE})`, "gi");

const DENOMINATORS: Record<string, number> = {
  half: 2, halves: 2, third: 3, thirds: 3, quarter: 4, quarters: 4, fourth: 4, fourths: 4, fifth: 5, fifths: 5,
  sixth: 6, sixths: 6, seventh: 7, sevenths: 7, eighth: 8, eighths: 8, ninth: 9, ninths: 9, tenth: 10, tenths: 10,
};
const FRACTION_NUMERATORS: Record<string, number> = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
/** "of" and the group ("of peers", "of the local banks"), or for "half", the group straight after a determiner ("half the banks"). */
const OF_GROUP = String.raw`[\s-]+of\s+(?:${DETERMINER}\s+)?${GROUP_PHRASE}`;
const DET_GROUP = String.raw`\s+${DETERMINER}\s+${GROUP_PHRASE}`;
/** "the bottom half", "the first half": a position or a period, never a share. */
const POSITION_BEFORE = String.raw`(?<!\b(?:first|second|last|other|top|bottom|upper|lower|latter|former|front|back)[\s-]+)`;
const FRACTION = new RegExp(
  String.raw`${POSITION_BEFORE}\b(?:(a|one|two|three|four|five|six|seven|eight|nine)[\s-]+(halves|half|thirds?|quarters?|fourths?|fifths?|sixths?|sevenths?|eighths?|ninths?|tenths?)(?=${OF_GROUP})`
  + String.raw`|(half)(?=${OF_GROUP}|${DET_GROUP}))\b`, "gi");

const roundTolerance = (value: number) => (Number.isInteger(value) ? 0.5 : 1) + 1e-9;

/**
 * A hedge before a share widens it (#975): "about", "around", "roughly", "approximately" take the
 * evidence within 5 points either way; "nearly", "almost", "close to", "just under", "under", "less
 * than" up to 5 points below and never above; "more than", "over", "just over" up to 5 points
 * above and never below. The figure's value is the middle of that band and its tolerance half the
 * band, so every reader of `value` and `tolerance` sees the same band. An unhedged share stays strict.
 */
const HEDGE_BEFORE = /\b(about|around|roughly|approximately|nearly|almost|close\s+to|just\s+under|just\s+over|under|less\s+than|more\s+than|over)\s+$/i;
const HEDGE_BAND = 5;

function hedgedShare(value: number, before: string): { value: number; tolerance: number } {
  const hedge = HEDGE_BEFORE.exec(before)?.[1].toLowerCase().replace(/\s+/g, " ");
  if (!hedge) return { value, tolerance: roundTolerance(value) };
  if (["about", "around", "roughly", "approximately"].includes(hedge)) return { value, tolerance: HEDGE_BAND + 1e-9 };
  const below = ["nearly", "almost", "close to", "just under", "under", "less than"].includes(hedge);
  return { value: value + (below ? -1 : 1) * HEDGE_BAND / 2, tolerance: HEDGE_BAND / 2 + 1e-9 };
}

function shareNumber(text: string): number | null {
  if (/^\d+$/.test(text)) return Number(text);
  return parseCardinal(text)?.value ?? null;
}

/**
 * The longest run of words at the end of `words` that forms a cardinal, with where it starts:
 * "ten-twenty" gives "twenty", so a run the reader would not read as one number still yields its
 * last figure rather than none.
 */
export function cardinalTail(words: string): { offset: number; parsed: ParsedCardinal } | null {
  for (const token of words.matchAll(/[a-z]+/gi)) {
    if (/^and$/i.test(token[0])) continue;
    const offset = token.index ?? 0;
    const parsed = parseCardinal(words.slice(offset));
    if (parsed) return { offset, parsed };
  }
  return null;
}

/**
 * The dollar amounts, percentages and shares a text states in words. `skip` is any span already
 * read another way (a per-$10,000-of-assets denominator: "per ten thousand dollars of assets").
 */
export function extractSpelledFigures(text: string, skip: ReadonlyArray<{ start: number; end: number }> = []): SpelledFigure[] {
  const out: SpelledFigure[] = [];
  const taken = (start: number, end: number) => [...skip, ...out.map((f) => ({ start: f.index, end: f.index + f.raw.length }))]
    .some((span) => start < span.end && end > span.start);
  const push = (figure: SpelledFigure) => {
    if (!taken(figure.index, figure.index + figure.raw.length)) out.push(figure);
  };
  for (const match of text.matchAll(DOLLAR_SIGN_DECIMAL)) {
    const amount = readAmount(match[1]);
    if (amount) push({ raw: match[0], kind: "usd", value: amount.value, tolerance: amountTolerance("usd", amount), index: match.index ?? 0 });
  }
  for (const [pattern, kind] of [[DOLLARS, "usd"], [PERCENT, "pct"]] as const) {
    for (const match of text.matchAll(pattern)) {
      const read = readAmount(match[1]);
      if (!read || (kind === "usd" && read.year)) continue;
      const index = (match.index ?? 0) + read.offset;
      if (AFTER_POINT.test(text.slice(Math.max(0, index - 10), index))) continue;
      // "35 dollars and 50 cents" is $35.50, to the cent; cents after a decimal or a scale word are not read with it.
      const centsTail = kind === "usd" ? match[2] : undefined;
      const cents = centsTail && read.decimals === 0 && read.place === 1 ? readCents(centsTail) : null;
      const amount = cents === null ? read : { ...read, value: read.value + cents / 100, decimals: 2 };
      const raw = match[0].slice(read.offset, centsTail && cents === null ? match[0].length - centsTail.length : undefined);
      const window = text.slice(Math.max(0, index - 80), index);
      const lead = RANGE_LEAD.exec(window);
      const first = lead ? readAmount(lead[1]) : null;
      const leadStart = lead && first ? index - window.length + (lead.index ?? 0) + first.offset : 0;
      if (lead && first && !(kind === "usd" && first.year) && !AFTER_POINT.test(text.slice(Math.max(0, leadStart - 10), leadStart))) {
        // "two to five million dollars": the first takes the second's scale.
        const scale = first.place === 1 && amount.place > 1 ? amount.place : 1;
        push({ raw: lead[1].slice(first.offset).trimEnd(), kind, value: first.value * scale,
          tolerance: amountTolerance(kind, { place: Math.max(first.place, scale), decimals: first.decimals }), index: leadStart });
      }
      push({ raw, kind, value: amount.value, tolerance: amountTolerance(kind, amount), index });
    }
  }
  for (const match of text.matchAll(SHARE)) {
    const part = shareNumber(match[1]);
    const whole = shareNumber(match[2]);
    if (part === null || whole === null || whole < 2 || part > whole) continue;
    const index = match.index ?? 0;
    push({ raw: match[0], kind: "pct", ...hedgedShare((part / whole) * 100, text.slice(Math.max(0, index - 40), index)), index });
  }
  for (const match of text.matchAll(FRACTION)) {
    const denominator = DENOMINATORS[(match[2] ?? match[3]).toLowerCase()];
    const numerator = match[1] ? FRACTION_NUMERATORS[match[1].toLowerCase()] : 1;
    // A singular fraction takes "a" or "one", a plural one a count above one: "a third", "two thirds".
    const plural = /s$/i.test(match[2] ?? "");
    if (match[2] && (plural ? numerator < 2 : numerator !== 1)) continue;
    if (numerator > denominator) continue;
    const index = match.index ?? 0;
    push({ raw: match[0], kind: "pct", ...hedgedShare((numerator / denominator) * 100, text.slice(Math.max(0, index - 40), index)), index });
  }
  return out.sort((a, b) => a.index - b.index);
}
