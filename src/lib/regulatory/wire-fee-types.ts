/**
 * Fee-type tags for Regulatory Wire items, from keywords in the headline. Deterministic,
 * no model: the same pattern tags an item in code and filters the Federal view in SQL
 * (Postgres `~*`), so a chip's list and an item's tag always agree.
 *
 * The pattern is written to mean the same thing in JavaScript and in Postgres regular
 * expressions: a word list between non-alphanumeric edges, no lookbehind and no `\b`.
 */

export type FeeType = "overdraft" | "atm" | "maintenance" | "wire" | "card" | "other";

interface FeeTypeDefinition {
  key: Exclude<FeeType, "other">;
  label: string;
  words: string[];
}

const SPECIFIC: FeeTypeDefinition[] = [
  {
    key: "overdraft",
    label: "Overdraft & NSF",
    words: [
      "overdraft", "overdrafts", "nsf", "non-sufficient funds", "nonsufficient funds",
      "insufficient funds", "returned item", "returned items", "bounced check", "bounced checks",
      "courtesy pay",
    ],
  },
  {
    key: "atm",
    label: "ATM",
    words: ["atm", "atms", "automated teller", "automated teller machine", "out-of-network"],
  },
  {
    key: "maintenance",
    label: "Maintenance",
    words: [
      "maintenance fee", "maintenance fees", "monthly fee", "monthly fees", "monthly service",
      "service charge", "service charges", "minimum balance", "account fee", "account fees",
      "paper statement", "paper statements",
    ],
  },
  {
    key: "wire",
    label: "Wire",
    words: ["wire transfer", "wire transfers", "wire fee", "wire fees", "remittance", "remittances"],
  },
  {
    key: "card",
    label: "Card & interchange",
    words: [
      "interchange", "swipe fee", "swipe fees", "debit card", "debit cards", "credit card",
      "credit cards", "card fee", "card fees", "late fee", "late fees", "durbin",
    ],
  },
];

/** Fee words that make an item about fees when no specific type matches. */
const OTHER_WORDS = ["fee", "fees", "junk fee", "junk fees", "surcharge", "surcharges"];

export const FEE_TYPES: { key: FeeType; label: string }[] = [
  ...SPECIFIC.map(({ key, label }) => ({ key, label })),
  { key: "other", label: "Other fees" },
];

export const FEE_TYPE_LABELS: Record<FeeType, string> = Object.fromEntries(
  FEE_TYPES.map((t) => [t.key, t.label]),
) as Record<FeeType, string>;

export function parseFeeType(value: string | undefined): FeeType | undefined {
  return FEE_TYPES.some((t) => t.key === value) ? (value as FeeType) : undefined;
}

const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Words between edges that are not letters or digits; valid in JS and Postgres ARE. */
function wordPattern(words: string[]): string {
  return `(^|[^a-z0-9])(${words.map(escape).join("|")})([^a-z0-9]|$)`;
}

const SPECIFIC_PATTERNS = SPECIFIC.map((t) => ({ key: t.key, source: wordPattern(t.words) }));
const ANY_SPECIFIC_SOURCE = wordPattern(SPECIFIC.flatMap((t) => t.words));
const OTHER_SOURCE = wordPattern(OTHER_WORDS);

const SPECIFIC_REGEX = SPECIFIC_PATTERNS.map((p) => ({ key: p.key, regex: new RegExp(p.source, "i") }));
const OTHER_REGEX = new RegExp(OTHER_SOURCE, "i");

/** Every fee type a headline names; "other" only when it is about fees but no type matches. */
export function feeTypesOf(title: string): FeeType[] {
  const found: FeeType[] = SPECIFIC_REGEX.filter((p) => p.regex.test(title)).map((p) => p.key);
  if (found.length === 0 && OTHER_REGEX.test(title)) found.push("other");
  return found;
}

export function hasFeeType(title: string, fee: FeeType): boolean {
  return feeTypesOf(title).includes(fee);
}

/**
 * The SQL test for one fee type: `title ~* include` and, for "other", `title !~* exclude`.
 * Both are bind parameters, never SQL text.
 */
export function feeTypeSql(fee: FeeType): { include: string; exclude: string | null } {
  if (fee === "other") return { include: OTHER_SOURCE, exclude: ANY_SPECIFIC_SOURCE };
  const pattern = SPECIFIC_PATTERNS.find((p) => p.key === fee)!;
  return { include: pattern.source, exclude: null };
}
