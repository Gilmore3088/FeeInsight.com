/**
 * Is this document a brokerage, wealth or loan page rather than a deposit fee schedule? (#1442)
 *
 * James's catalog review (Oct 15) found live deposit-fee rows read from documents that are not
 * deposit fee schedules: brokerage and wealth pages (Northern Trust wealth, U.S. Bank's
 * self-directed investing "Research" $20) and loan, card, HELOC, mortgage and rate pages (Bank of
 * Greene's `/current-rates/` gave "Appraisal $400"). One classifier answers it for every caller:
 * Magellan's companion filter (`magellan/second-document.ts`) and Darwin's live re-check
 * (`darwin/non-deposit-document-check.ts`), whose read-only count SQL is built from the same
 * patterns below (`nonDepositKindSql`).
 *
 * Scope (James, Oct 15): brokerage, wealth/investment and loan/rate/mortgage/HELOC/card documents
 * only. Business and commercial schedules are kept on purpose (fee-stats.ts drops them from
 * medians), so any business word in the address or title returns null.
 *
 * Conservative by design: the address is cut into path segments, and a segment must name the
 * page as such a page ("current-rates", "loan-rates", "credit-card-agreement", "heloc",
 * "wealth-management", "self-directed-investing"). A loan word inside a fee's name
 * ("/fees/loan-payment-fee") never matches, and a deposit word anywhere ("checking", "savings",
 * "deposit", "overdraft", "truth in savings") wins: such a document is a deposit schedule. A
 * generic fee schedule filed under a loan section ("/loans/fee-schedule.pdf") is left alone,
 * since many banks keep their one schedule under "Rates & Loans"; a brokerage section is not
 * forgiven that way ("/wealth-management/fee-schedule.pdf" is the wealth fee schedule).
 *
 * Every pattern here is written so the same source runs as a JS RegExp and as a Postgres ARE: no
 * `\b`, `\s` or lookbehind; text is lower-cased first, tokens are split by one space and segments
 * by "/".
 */

export type NonDepositDocumentKind = "brokerage" | "loan" | "card_program";

/** One normalisation step: a global replace (JS `$n`, Postgres `\n` back-references), or lower-casing. */
type NormalizeStep = { pattern: string; js: string; pg: string } | "lower";

/** Date, number and revision tokens that do not change what a segment names. */
const NOISE = "[0-9]+[a-z]{0,2}|v[0-9]*|rev[0-9]*|final|updated|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)[0-9]{0,4}";

/** The steps shared by an address's path and a title (see `PATH_STEPS`). */
const TEXT_STEPS: NormalizeStep[] = [
  { pattern: "%[0-9A-Fa-f]{2}", js: " ", pg: " " },
  { pattern: "[.][A-Za-z0-9]{1,5}(?=/|$)", js: "", pg: "" },
  { pattern: "([a-z])([A-Z])", js: "$1 $2", pg: "\\1 \\2" },
  "lower",
  // Run-together words: "Disclosure1", "scheduleoffees", "feeschedule", "loanfeeschedule", "ScheduleLoans".
  { pattern: "([a-z])([0-9])", js: "$1 $2", pg: "\\1 \\2" },
  { pattern: "schedule ?of ?(fees?|charges)", js: "schedule of $1 ", pg: "schedule of \\1 " },
  { pattern: "(fees?) ?schedule", js: "$1 schedule", pg: "\\1 schedule" },
  { pattern: "schedule(loans?|mortgages?)", js: "schedule $1", pg: "schedule \\1" },
  { pattern: "(loans?)(fees?)", js: "$1 $2", pg: "\\1 \\2" },
  { pattern: "&", js: " and ", pg: " and " },
  { pattern: "['’]", js: "", pg: "" },
  { pattern: "[^a-z0-9/]+", js: " ", pg: " " },
  { pattern: " */ *", js: "/", pg: "/" },
  { pattern: "^ +| +$", js: "", pg: "" },
  { pattern: `(?: (?:${NOISE}))+(?=/|$)`, js: "", pg: "" },
  { pattern: `(^|/)(?:(?:${NOISE}) )+`, js: "$1", pg: "\\1" },
  { pattern: "/+", js: "/", pg: "/" },
  { pattern: "^/+|/+$", js: "", pg: "" },
];

/**
 * From a document address to its path, segment by segment: scheme and host off, query and
 * fragment off, `%xx` escapes and file extensions dropped, camelCase split, lower case, every
 * run of other characters one space, leading dates and numbers and trailing dates, numbers and
 * revision words ("final", "v2", "rev3", "2024", "jan") dropped from each segment.
 */
const PATH_STEPS: NormalizeStep[] = [
  { pattern: "^[A-Za-z][A-Za-z0-9+.-]*://[^/?#]*", js: "", pg: "" },
  { pattern: "[?#].*$", js: "", pg: "" },
  ...TEXT_STEPS,
];

/** A business, commercial or agricultural document: out of scope, kept in the catalog on purpose. */
export const BUSINESS_TOKEN = "[ /](?:business|commercial|corporate|treasury|merchants?|agricultur(?:e|al)|ag|farm|hoa|nonprofit|non profit)[ /]";

/** A deposit document: a deposit word anywhere in the address or title wins over any other (IRAs and HSAs are deposit products). */
export const DEPOSIT_TOKEN = "[ /](?:checking|savings|share drafts?|money market|deposits?|truth in savings|overdrafts?|nsf|cds?|certificates? of deposit|iras?|hsas?|individual retirement)[ /]";

/**
 * A brokerage, wealth or investment segment: one that starts with "wealth", "invest(ing|ment|ments)",
 * "brokerage" or "self directed" (not followed by "and": "investments and fees" is a combined
 * page), or holds "brokerage", "wealth management", "wealth advisory", "private wealth",
 * "investment management", "self directed", "trust and investment(s)" or "wealth and investment(s)".
 */
export const BROKERAGE_SEGMENT = "/(?:(?:wealth|invest|investing|investments?|brokerage|self directed)(?: (?!and )[^/]*)?|(?:[^/]* )?(?:brokerage|wealth management|wealth advisory|private wealth|investment management|self directed|trust and invest(?:ing|ments?)|invest(?:ing|ments?) and trust|wealth and (?:invest(?:ing|ments?)|trust)|trust and wealth)(?: [^/]*)?)/";

/** Words a loan's own name may start with ("consumer", "auto", "mortgage"...). */
const LOAN_PREFIX = "(?:(?:personal|consumer|auto|vehicle|car|boat|rv|home|student|signature|installment|mortgage|equity|real estate|land|construction|share secured|secured) )*";
/** Words naming a loan, card, mortgage, HELOC or loan-servicing page, as the start of one segment. */
const LOAN_CORE = [
  `${LOAN_PREFIX}(?:loans?|lending|mortgages?)`,
  "borrow(?:ing)?",
  "helocs?",
  "home equity",
  "(?:personal )?lines? of credit",
  // Credit card only with "credit": a bare "cardholder agreement" is often the debit card's. Any
  // words may lead ("Argent Credit Card Fees and Terms", "VISA Credit Card Agreement").
  "(?:[^/]* )?credit cards?",
  // A fee schedule named for loans: "Fee Schedule Loans", "Sch of Loan Fees", "Fees for Loans".
  `(?:fees?|fee schedule|schedule of fees|sch of)(?: for)? ${LOAN_PREFIX}(?:loans?|mortgages?|lending)`,
].join("|");
/** Words that may follow a loan word in the same segment: "rates", "agreement", "servicing fee schedule"... */
const LOAN_TAIL = "rates?|agreements?|disclosures?|solicitations?|terms|conditions|and|of|for|only|lines?|credit|sheets?|fees?|schedule|pricing|page|information|info|application|servicing|services|center|loans?|lending|heloc|accounts?|cardholder";
/**
 * A rate page's own name ("current rates", "rate sheet"). Its tail never takes fee words: many
 * credit unions publish one "Rates & Fee Schedule" PDF that holds the deposit schedule.
 */
const RATE_CORE = "(?:current|todays|today s|our) rates|rates? sheets?";
const RATE_TAIL = "rates?|sheets?|page|information|info";
/** A loan, card, mortgage, HELOC or rate segment ("current rates", "auto loans", "credit card agreement"). */
export const LOAN_SEGMENT = `/(?:(?:${LOAN_CORE})(?: (?:${LOAN_TAIL}))*|(?:${RATE_CORE})(?: (?:${RATE_TAIL}))*)/`;
/** The same, as the address's last segment. */
export const LOAN_LAST_SEGMENT = `${LOAN_SEGMENT}$`;
/**
 * A segment that names a loan, card, mortgage, HELOC or line-of-credit product (the loan half of
 * `LOAN_SEGMENT`, without the rate-page names). A "loan" document with no such segment is a rate
 * page ("current-rates", "rate-sheet"): prod showed many of those hold a credit union's whole
 * deposit schedule (#1442, #1518), so Darwin's re-check reads their fees more carefully.
 */
export const LOAN_PRODUCT_SEGMENT = `/(?:${LOAN_CORE})(?: (?:${LOAN_TAIL}))*/`;
/** The address's last segment names a fee document ("fee schedule", "fees", "schedule of charges", "pricing"). */
export const FEE_LAST_SEGMENT = "(?:^|/)(?:[^/]* )?(?:fees?|charges?|schedule|pricing)(?: [^/]*)?/$";

/**
 * A prepaid, payroll, gift or travel card program's own document, as the address's last segment
 * (#1908): SchoolsFirst's `/disclosures/payroll-card-statement-of-fees-disclosure/`, Acadia's
 * `/checking/cards/prepaid-travel-card/`, "Gift_Card_Terms_and_Conditions.pdf",
 * "PrePaidVISA-FeeSchedule.pdf", CO-OP TravelMoney card agreements. Such a card is not a deposit account, so its monthly, inactivity,
 * ATM and replacement fees are not the institution's account fees. Only the last segment counts
 * (a deposit section above it, "/checking/cards/", does not save it), and a deposit word in that
 * same segment does ("prepaid-checking-account" stays a deposit page). A loan's "prepaid finance
 * charge", "prepaid interest" or a mortgage's "prepaid items" is not a card, and a bare "pay card"
 * (often a credit card bill-pay page) is left out. It never overrides a brokerage or loan verdict:
 * it is asked only after those (or when a deposit word would otherwise make the document null),
 * so `/credit-cards/travel-card/` stays a loan page (review of #1914).
 */
const CARD_PROGRAM_WORDS = "(?:pre ?paid(?! (?:finance|interest|charges?|points?|items?|escrow|mortgage|expenses?|taxes|insurance))|payroll cards?|gift ?cards?|gift and travel cards?|travel cards?|travel ?money|reloadable(?: [a-z]+)? cards?)";
export const CARD_PROGRAM_LAST_SEGMENT = `(?:^|/)(?:[^/]* )?${CARD_PROGRAM_WORDS}(?: [^/]*)?/$`;
/**
 * A general schedule that only mentions a card program after its own fee words
 * ("fee-schedule-including-gift-cards.pdf", "/fees-and-gift-cards/", "membership-fee-schedule-prepaid"):
 * the institution's whole schedule, not the card's. A card's own schedule names the card first
 * ("visa-gift-card-fee-schedule", "PrePaidVISA-FeeSchedule").
 */
export const GENERAL_SCHEDULE_BEFORE_CARD = `(?:^|/)(?:[^/]* )?(?:fees?|schedule|charges|incl|including) (?:[^/]* )?${CARD_PROGRAM_WORDS}(?: [^/]*)?/$`;

/** Youth, teen, student and minor words, for a document's opening (`documentOpeningKind`, #1944). */
const YOUTH_WORDS = "(?:youth|teens?|kids?|juniors?|students?|minors?|young adults?)";

/** Host first labels that name a brokerage or wealth site ("wealth.bank.com"). */
export const BROKERAGE_HOST_LABELS = ["wealth", "invest", "investing", "investments", "brokerage"] as const;

/**
 * Brokerage, investment and wealth words for link text (Magellan's companion filter, which
 * already skips loan and card words the same way). Word-bounded in JS only.
 */
export const BROKERAGE_LINK_WORDS = "brokerage|invest(?:ing|ments?)?|wealth|self directed|trust (?:and|&) invest(?:ing|ments?)";

const re = (source: string) => new RegExp(source);
const BROKERAGE_LINK_RE = new RegExp(`(?:^|[^a-z0-9])(?:${BROKERAGE_LINK_WORDS})(?=$|[^a-z0-9])`);
const BUSINESS_RE = re(BUSINESS_TOKEN);
const DEPOSIT_RE = re(DEPOSIT_TOKEN);
const BROKERAGE_RE = re(BROKERAGE_SEGMENT);
const LOAN_RE = re(LOAN_SEGMENT);
const LOAN_LAST_RE = re(LOAN_LAST_SEGMENT);
const LOAN_PRODUCT_RE = re(LOAN_PRODUCT_SEGMENT);
const FEE_LAST_RE = re(FEE_LAST_SEGMENT);
const CARD_PROGRAM_LAST_RE = re(CARD_PROGRAM_LAST_SEGMENT);
const GENERAL_SCHEDULE_BEFORE_CARD_RE = re(GENERAL_SCHEDULE_BEFORE_CARD);
const COMPILED = new Map<string, RegExp>();

function applySteps(value: string, steps: NormalizeStep[]): string {
  let out = value;
  for (const step of steps) {
    if (step === "lower") {
      out = out.toLowerCase();
      continue;
    }
    let pattern = COMPILED.get(step.pattern);
    if (!pattern) {
      pattern = new RegExp(step.pattern, "g");
      COMPILED.set(step.pattern, pattern);
    }
    out = out.replace(pattern, step.js);
  }
  return out;
}

/** The address's path as "/segment/segment/", normalised (see `PATH_STEPS`). "//" for no path. */
export function documentPathSegments(url: string | null | undefined): string {
  return `/${applySteps((url ?? "").trim(), PATH_STEPS)}/`;
}

/** A title as one segment ("/credit card agreement/"); "/" never splits a title. */
export function documentTitleSegment(title: string | null | undefined): string {
  return `/${applySteps((title ?? "").replace(/\//g, " ").trim(), TEXT_STEPS)}/`;
}

/** The host's first label, lower case ("wealth" for "https://wealth.bank.com/..."). */
export function documentHostLabel(url: string | null | undefined): string {
  const host = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/?#:]*)/.exec((url ?? "").trim())?.[1] ?? "";
  return host.toLowerCase().split(".")[0] ?? "";
}

/**
 * Pure: link text (label and address words, any case) that names a brokerage, investment or
 * wealth page and no deposit product: "Wealth Builder Savings", "Investment Money Market",
 * "checking, savings and investments fee schedule" and an HSA's investments are deposit links.
 */
export function brokerageLinkText(text: string | null | undefined): boolean {
  const words = ` ${(text ?? "").toLowerCase().replace(/[^a-z0-9&]+/g, " ").trim()} `;
  return BROKERAGE_LINK_RE.test(words) && !DEPOSIT_RE.test(words);
}

/** Pure: the kind from a normalised path (and optional title segment and host label). */
function kindOf(path: string, titleSegment: string | null, hostLabel: string): NonDepositDocumentKind | null {
  const texts = titleSegment ? [path, titleSegment] : [path];
  if (texts.some((text) => BUSINESS_RE.test(text))) return null;
  // A card program page under a deposit section ("/checking/cards/prepaid-travel-card/") is
  // still the card's; the address decides here, never the title.
  if (texts.some((text) => DEPOSIT_RE.test(text))) return cardProgramLast(path) ? "card_program" : null;
  if (BROKERAGE_RE.test(path) || (titleSegment != null && BROKERAGE_RE.test(titleSegment))) return "brokerage";
  if ((BROKERAGE_HOST_LABELS as readonly string[]).includes(hostLabel)) return "brokerage";
  if (LOAN_LAST_RE.test(path) || (LOAN_RE.test(path) && !FEE_LAST_RE.test(path))) return "loan";
  if (titleSegment != null && LOAN_RE.test(titleSegment)) return "loan";
  if (cardProgramLast(path) || (titleSegment != null && cardProgramLast(titleSegment))) return "card_program";
  return null;
}

/** The text's last segment names a card program first and carries no deposit word of its own. */
function cardProgramLast(text: string): boolean {
  if (!CARD_PROGRAM_LAST_RE.test(text) || GENERAL_SCHEDULE_BEFORE_CARD_RE.test(text)) return false;
  const last = text.slice(text.lastIndexOf("/", text.length - 2));
  return !DEPOSIT_RE.test(last);
}

/**
 * Pure: "brokerage", "loan" or "card_program" when the document's address (or its title, when given) names it as
 * a brokerage/wealth/investment page, a loan/card/mortgage/HELOC/rate page, or a prepaid, payroll,
 * gift or travel card program's page (`CARD_PROGRAM_LAST_SEGMENT`); null otherwise, and always
 * null for a business or deposit document. The address never gives "youth_account": a youth or
 * student account page often carries the institution's whole schedule (GTE Financial's
 * "/go-student-checking", 27 live general fees, Oct 25), so only the document's own opening says
 * so (`documentOpeningKind`, #1944). See the module note.
 */
export function nonDepositDocumentKind(url: string | null | undefined, title?: string | null): NonDepositDocumentKind | null {
  const titleSegment = title != null && title.trim() !== "" ? documentTitleSegment(title) : null;
  return kindOf(documentPathSegments(url), titleSegment, documentHostLabel(url));
}

/**
 * Pure: a "loan" document named only as a rate page ("/current-rates", "/rate-sheet.pdf"), with
 * no segment naming a loan, card, mortgage or HELOC product. False for every other document.
 * Address only, like the Postgres mirror `ratePageSql`.
 */
export function ratePageDocument(url: string | null | undefined): boolean {
  return nonDepositDocumentKind(url) === "loan" && !LOAN_PRODUCT_RE.test(documentPathSegments(url));
}

/** A pattern as a Postgres string literal (quotes doubled; standard_conforming_strings). */
function pgLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Postgres: `column`'s address path as "/segment/segment/", by the same steps as `documentPathSegments`. */
export function documentPathSegmentsSql(column: string): string {
  let expression = `btrim(COALESCE(${column}, ''))`;
  for (const step of PATH_STEPS) {
    expression = step === "lower"
      ? `lower(${expression})`
      : `regexp_replace(${expression}, ${pgLiteral(step.pattern)}, ${pgLiteral(step.pg)}, 'g')`;
  }
  return `('/' || ${expression} || '/')`;
}

/** Postgres: `column`'s host first label, as `documentHostLabel`. */
export function documentHostLabelSql(column: string): string {
  return `split_part(lower(COALESCE(substring(btrim(COALESCE(${column}, '')) from '^[A-Za-z][A-Za-z0-9+.-]*://([^/?#:]*)'), '')), '.', 1)`;
}

/**
 * Postgres: the `CASE` that mirrors `nonDepositDocumentKind(url)` (no title) over a normalised
 * path expression `path` (from `documentPathSegmentsSql`) and host label `host`:
 * 'brokerage', 'loan', 'card_program' or NULL.
 */
export function nonDepositKindSql(path: string, host: string): string {
  const hosts = BROKERAGE_HOST_LABELS.map(pgLiteral).join(", ");
  const card = `(${path} ~ ${pgLiteral(CARD_PROGRAM_LAST_SEGMENT)} AND ${path} !~ ${pgLiteral(GENERAL_SCHEDULE_BEFORE_CARD)} AND substring(${path} from ${pgLiteral("/[^/]*/$")}) !~ ${pgLiteral(DEPOSIT_TOKEN)})`;
  return `CASE
    WHEN ${path} ~ ${pgLiteral(BUSINESS_TOKEN)} THEN NULL
    WHEN ${path} ~ ${pgLiteral(DEPOSIT_TOKEN)} THEN CASE WHEN ${card} THEN 'card_program' END
    WHEN ${path} ~ ${pgLiteral(BROKERAGE_SEGMENT)} OR ${host} IN (${hosts}) THEN 'brokerage'
    WHEN ${path} ~ ${pgLiteral(LOAN_LAST_SEGMENT)} OR (${path} ~ ${pgLiteral(LOAN_SEGMENT)} AND ${path} !~ ${pgLiteral(FEE_LAST_SEGMENT)}) THEN 'loan'
    WHEN ${card} THEN 'card_program'
    ELSE NULL
  END`;
}

/**
 * Postgres: `ratePageDocument` over a normalised path expression `path` whose kind expression is
 * `kind` (from `nonDepositKindSql`).
 */
export function ratePageSql(path: string, kind: string): string {
  return `(${kind} IS NOT DISTINCT FROM 'loan' AND ${path} !~ ${pgLiteral(LOAN_PRODUCT_SEGMENT)})`;
}

/**
 * What a document's own opening says it is (#1944). The address and link label miss documents
 * whose name gives nothing away: TD's "td-fit-account-guide-acc-en.pdf" opens "TD Fit Personal
 * Unsecured Consumer Loan Disclosure", and Arbor Financial's "Volt Disclosures 4.pdf" opens
 * "ACCOUNT-SPECIFIC DISCLOSURES / The following additional disclosures apply to the Volt Teen
 * Banking & Volt Banking accounts". Both went live as the institution's own prices (TD Fit Monthly
 * fee $0 and NSF payment fee $0; Arbor NSF $26.50, NSF ATM withdrawal $0 and overdraft transfer $0,
 * whose general prices are $35, $35 and $5).
 *
 * Only the first `OPENING_LINES` non-empty lines of the first `OPENING_SCAN_CHARS` characters are
 * read: that is where a document names itself, and it keeps a menu entry or a passing mention deep
 * in a general schedule ("does not apply to Youth Savings accounts") out. A line with a "$" is a
 * fee line, never a title. Each line is cut to lower-case words padded with one space, with ",",
 * ";" and ":" kept as a "," token so a list of accounts never reads as one name (`openingWords`).
 *
 * - "loan": a line, or two neighbouring lines read together ("VISA CREDIT CARD" / "AGREEMENT AND
 *   DISCLOSURE STATEMENT"), names a loan, card, HELOC or line-of-credit disclosure or agreement
 *   (`LOAN_OPENING`), with no deposit, general schedule or business word (`NOT_LOAN_OPENING`): an
 *   overdraft line of credit agreement is the deposit side's, and a business card agreement stays
 *   out of scope as in the address rule. A bare "Loan Application" (a menu entry) is not a title.
 * - "youth_account": one of the first two lines opens with a youth, teen, student or minor word
 *   and names a fee schedule, fees, addendum or disclosure ("Youth Member Fee Schedule (ages
 *   13-17)", `YOUTH_OPENING_TITLE`), or one of the first three says its disclosures or fees apply
 *   to a youth account by name (`YOUTH_OPENING_SUBJECT`, Arbor's Volt line), with no negation,
 *   loan, credit union or university word (`NOT_YOUTH_OPENING`: "Student Federal Credit Union" is
 *   the institution's name).
 *
 * Loan is asked first, so a "Student Loan Disclosure" is a loan document. Written once for JS and
 * Postgres (`documentOpeningKindSql`): no `\b`, `\s` or lookbehind in the patterns.
 */
export type DocumentOpeningKind = "loan" | "youth_account";
export const OPENING_SCAN_CHARS = 2000;
export const OPENING_LINES = 3;
/** A title line is short: longer is a paragraph or a whole page flattened onto one line. */
export const OPENING_LINE_MAX_CHARS = 160;
export const LOAN_OPENING = " (?:loans?|mortgages?|helocs?|home equity(?: lines? of credit)?|lines? of credit|credit cards?)(?: application)? (?:and )?(?:disclosures?|agreements?|terms|truth in lending|notes?) ";
export const NOT_LOAN_OPENING = " (?:checking|savings|shares?|share drafts?|deposits?|overdrafts?|nsf|money market|certificates?|cds?|iras?|truth in savings|fee schedule|schedule of fees|schedule of charges|business|commercial|corporate|agricultur(?:e|al)) ";
export const YOUTH_OPENING_TITLE = `^ (?:[a-z0-9]+ ){0,3}${YOUTH_WORDS} (?:[a-z0-9]+ ){0,4}(?:fee schedule|schedule of fees|schedule of charges|fees|addendum|disclosures?) `;
export const YOUTH_OPENING_SUBJECT = ` (?:disclosures?|fees?|charges|terms) (?:(?!not )[a-z0-9]+ ){0,3}appl(?:y|ies) (?:only )?to (?:the |our |your )?(?:[a-z0-9]+ ){0,5}${YOUTH_WORDS} (?:[a-z0-9]+ ){0,3}accounts? `;
export const NOT_YOUTH_OPENING = " (?:not|except|excluding|excludes?|waived|credit union|federal credit|university|loans?|scholarships?) ";
const LOAN_OPENING_RE = re(LOAN_OPENING);
const NOT_LOAN_OPENING_RE = re(NOT_LOAN_OPENING);
const YOUTH_OPENING_TITLE_RE = re(YOUTH_OPENING_TITLE);
const YOUTH_OPENING_SUBJECT_RE = re(YOUTH_OPENING_SUBJECT);
const NOT_YOUTH_OPENING_RE = re(NOT_YOUTH_OPENING);

/** The document's first `OPENING_LINES` non-empty lines, trimmed. */
export function openingLines(text: string | null | undefined): string[] {
  return (text ?? "").slice(0, OPENING_SCAN_CHARS).trim().split(/\s*\n\s*/).filter((line) => line !== "").slice(0, OPENING_LINES);
}

/** One line as lower-case words padded with a space; ",", ";" and ":" become a "," token. */
export function openingWords(line: string): string {
  return ` ${line.toLowerCase().replace(/[,;:]/g, " , ").replace(/[^a-z0-9,]+/g, " ").trim()} `;
}

/** A line that may be a title: no price, and short once cut to words. */
function titleWords(line: string): string | null {
  if (line.includes("$")) return null;
  const words = openingWords(line);
  return words.length <= OPENING_LINE_MAX_CHARS + 2 ? words : null;
}

function loanOpening(words: string): boolean {
  return LOAN_OPENING_RE.test(words) && !NOT_LOAN_OPENING_RE.test(words);
}

/** Pure: "loan" or "youth_account" when the document's opening names it so (see the note above); null otherwise. */
export function documentOpeningKind(text: string | null | undefined): DocumentOpeningKind | null {
  const titles = openingLines(text).map(titleWords);
  const pairs = titles.slice(1).map((words, i) => {
    const before = titles[i];
    return words != null && before != null ? `${before.trimEnd()}${words}` : null;
  });
  if ([...titles, ...pairs].some((words) => words != null && loanOpening(words))) return "loan";
  const youth = titles.some((words, i) =>
    words != null && !NOT_YOUTH_OPENING_RE.test(words) && ((i < 2 && YOUTH_OPENING_TITLE_RE.test(words)) || YOUTH_OPENING_SUBJECT_RE.test(words)));
  return youth ? "youth_account" : null;
}

/**
 * Postgres: `documentOpeningKind(column)` as 'loan', 'youth_account' or NULL, over a text column
 * (the read-only dry-run counts): one scalar subquery that cuts the opening lines once (`o.l`) and
 * their words once (`o.w`). The same patterns and the same line cut as the JS.
 */
export function documentOpeningKindSql(column: string): string {
  const lines = `array_remove(regexp_split_to_array(btrim(left(COALESCE(${column}, ''), ${OPENING_SCAN_CHARS}), E' \\t\\r\\n\\f\\v'), E'[[:space:]]*\\n[[:space:]]*'), '')`;
  const title = (i: number) => `(o.l[${i}] IS NOT NULL AND strpos(o.l[${i}], '$') = 0 AND length(o.w[${i}]) <= ${OPENING_LINE_MAX_CHARS + 2})`;
  const loan = (words: string) => `(${words} ~ ${pgLiteral(LOAN_OPENING)} AND ${words} !~ ${pgLiteral(NOT_LOAN_OPENING)})`;
  const indexes = Array.from({ length: OPENING_LINES }, (_, i) => i + 1);
  const loanAny = [
    ...indexes.map((i) => `(${title(i)} AND ${loan(`o.w[${i}]`)})`),
    ...indexes.slice(1).map((i) => `(${title(i - 1)} AND ${title(i)} AND ${loan(`(rtrim(o.w[${i - 1}]) || o.w[${i}])`)})`),
  ].join(" OR ");
  const youth = indexes
    .map((i) => `(${title(i)} AND o.w[${i}] !~ ${pgLiteral(NOT_YOUTH_OPENING)} AND (${i <= 2 ? `o.w[${i}] ~ ${pgLiteral(YOUTH_OPENING_TITLE)} OR ` : ""}o.w[${i}] ~ ${pgLiteral(YOUTH_OPENING_SUBJECT)}))`)
    .join(" OR ");
  return `(SELECT CASE WHEN ${loanAny} THEN 'loan' WHEN ${youth} THEN 'youth_account' END
     FROM (SELECT c.l[1:${OPENING_LINES}] AS l,
                  ARRAY(SELECT ' ' || btrim(regexp_replace(regexp_replace(lower(u.e), '[,;:]', ' , ', 'g'), '[^a-z0-9,]+', ' ', 'g')) || ' '
                          FROM unnest(c.l[1:${OPENING_LINES}]) WITH ORDINALITY AS u(e, n) ORDER BY u.n) AS w
             FROM (SELECT ${lines} AS l) c) o)`;
}
