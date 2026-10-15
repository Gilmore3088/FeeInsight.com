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

export type NonDepositDocumentKind = "brokerage" | "loan";

/** One normalisation step: a global replace (JS `$n`, Postgres `\n` back-references), or lower-casing. */
type NormalizeStep = { pattern: string; js: string; pg: string } | "lower";

/** Date, number and revision tokens that do not change what a segment names. */
const NOISE = "[0-9]+[a-z]{0,2}|v[0-9]+|rev[0-9]*|final|updated|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)[0-9]{0,4}";

/** The steps shared by an address's path and a title (see `PATH_STEPS`). */
const TEXT_STEPS: NormalizeStep[] = [
  { pattern: "%[0-9A-Fa-f]{2}", js: " ", pg: " " },
  { pattern: "[.][A-Za-z0-9]{1,5}(?=/|$)", js: "", pg: "" },
  { pattern: "([a-z])([A-Z])", js: "$1 $2", pg: "\\1 \\2" },
  "lower",
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

/** A deposit document: a deposit word anywhere in the address or title wins over any other. */
export const DEPOSIT_TOKEN = "[ /](?:checking|savings|share drafts?|money market|deposits?|truth in savings|overdrafts?|nsf|cds?|certificates? of deposit)[ /]";

/**
 * A brokerage, wealth or investment segment: one that starts with "wealth", "invest(ing|ment|ments)",
 * "brokerage" or "self directed", or holds "brokerage", "wealth management", "wealth advisory",
 * "private wealth", "investment management", "self directed" or "trust and investment(s)".
 */
export const BROKERAGE_SEGMENT = "/(?:(?:wealth|invest|investing|investments?|brokerage|self directed)(?: [^/]*)?|(?:[^/]* )?(?:brokerage|wealth management|wealth advisory|private wealth|investment management|self directed|trust and invest(?:ing|ments?)|invest(?:ing|ments?) and trust)(?: [^/]*)?)/";

/** Words naming a loan, card, mortgage, HELOC or rate page, as the whole of one segment. */
const LOAN_CORE = [
  "(?:(?:personal|consumer|auto|vehicle|car|boat|rv|home|student|signature|installment|mortgage|equity|real estate|land|construction|share secured|secured) )?(?:loans?|lending)",
  "borrow(?:ing)?",
  "(?:home )?mortgages?(?: (?:loans?|lending|center|services))?",
  "helocs?",
  "home equity(?: (?:loans?|lines? of credit|heloc))?",
  "(?:personal )?lines? of credit",
  "(?:(?:visa|mastercard|platinum|gold|classic|rewards?|signature|secured|student) )*credit cards?(?: (?:accounts?|cardholder))?",
  "cardholder",
  "(?:current|todays|today s|our) rates",
  "rates? sheets?",
].join("|");
/** What may follow a loan word in the same segment: "rates", "agreement", "fee schedule"... */
const LOAN_TAIL = "rates?|agreements?|disclosures?|terms(?: and conditions)?|sheets?|fees?|fee schedule|schedule of fees|pricing|page|information|info|application|and rates|and lines of credit|and credit cards";
/** A loan, card, mortgage, HELOC or rate segment ("current rates", "auto loans", "credit card agreement"). */
export const LOAN_SEGMENT = `/(?:${LOAN_CORE})(?: (?:${LOAN_TAIL}))*/`;
/** The same, as the address's last segment. */
export const LOAN_LAST_SEGMENT = `${LOAN_SEGMENT}$`;
/** The address's last segment names a fee document ("fee schedule", "fees", "schedule of charges", "pricing"). */
export const FEE_LAST_SEGMENT = "(?:^|/)(?:[^/]* )?(?:fees?|charges?|schedule|pricing)(?: [^/]*)?/$";

/** Host first labels that name a brokerage or wealth site ("wealth.bank.com"). */
export const BROKERAGE_HOST_LABELS = ["wealth", "invest", "investing", "investments", "brokerage"] as const;

/**
 * Brokerage, investment and wealth words for link text (Magellan's companion filter, which
 * already skips loan and card words the same way). Word-bounded in JS only.
 */
export const BROKERAGE_LINK_WORDS = "brokerage|invest(?:ing|ments?)?|wealth|self directed|trust (?:and|&) invest(?:ing|ments?)";

const re = (source: string) => new RegExp(source);
const BUSINESS_RE = re(BUSINESS_TOKEN);
const DEPOSIT_RE = re(DEPOSIT_TOKEN);
const BROKERAGE_RE = re(BROKERAGE_SEGMENT);
const LOAN_RE = re(LOAN_SEGMENT);
const LOAN_LAST_RE = re(LOAN_LAST_SEGMENT);
const FEE_LAST_RE = re(FEE_LAST_SEGMENT);
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

/** Pure: the kind from a normalised path (and optional title segment and host label). */
function kindOf(path: string, titleSegment: string | null, hostLabel: string): NonDepositDocumentKind | null {
  const texts = titleSegment ? [path, titleSegment] : [path];
  if (texts.some((text) => BUSINESS_RE.test(text) || DEPOSIT_RE.test(text))) return null;
  if (BROKERAGE_RE.test(path) || (titleSegment != null && BROKERAGE_RE.test(titleSegment))) return "brokerage";
  if ((BROKERAGE_HOST_LABELS as readonly string[]).includes(hostLabel)) return "brokerage";
  if (LOAN_LAST_RE.test(path) || (LOAN_RE.test(path) && !FEE_LAST_RE.test(path))) return "loan";
  if (titleSegment != null && LOAN_RE.test(titleSegment)) return "loan";
  return null;
}

/**
 * Pure: "brokerage" or "loan" when the document's address (or its title, when given) names it as
 * a brokerage/wealth/investment page or a loan/card/mortgage/HELOC/rate page; null otherwise,
 * and always null for a business or deposit document. See the module note.
 */
export function nonDepositDocumentKind(url: string | null | undefined, title?: string | null): NonDepositDocumentKind | null {
  const titleSegment = title != null && title.trim() !== "" ? documentTitleSegment(title) : null;
  return kindOf(documentPathSegments(url), titleSegment, documentHostLabel(url));
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
 * 'brokerage', 'loan' or NULL.
 */
export function nonDepositKindSql(path: string, host: string): string {
  const hosts = BROKERAGE_HOST_LABELS.map(pgLiteral).join(", ");
  return `CASE
    WHEN ${path} ~ ${pgLiteral(BUSINESS_TOKEN)} OR ${path} ~ ${pgLiteral(DEPOSIT_TOKEN)} THEN NULL
    WHEN ${path} ~ ${pgLiteral(BROKERAGE_SEGMENT)} OR ${host} IN (${hosts}) THEN 'brokerage'
    WHEN ${path} ~ ${pgLiteral(LOAN_LAST_SEGMENT)} OR (${path} ~ ${pgLiteral(LOAN_SEGMENT)} AND ${path} !~ ${pgLiteral(FEE_LAST_SEGMENT)}) THEN 'loan'
    ELSE NULL
  END`;
}
