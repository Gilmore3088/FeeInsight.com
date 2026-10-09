import { sql } from "@/lib/data-store/connection";
import { computePercentile } from "@/lib/data-store/fees";
import { MIN_INSTITUTIONS_FOR_MEDIAN, STATS_ROW_FILTER, valuePerInstitution } from "@/lib/data-store/fee-stats";
import { contentSchemaReady, insertContentDraft } from "@/lib/data-store/content-drafts";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { CONTACT_EMAIL, PRODUCT_NAME, SITE_NAME } from "@/lib/constants";
import { STATE_NAMES } from "@/lib/us-states";
import { unbackedNumbers } from "@/lib/agents/marketing/facts";
import { themeFees } from "@/lib/agents/content/calendar";
import { failingEnds, loadEndRows } from "@/lib/agents/content/end-check";
import { asOfLabel, money } from "@/lib/agents/content/market-spread";
import { channelForKind } from "./roster";

/**
 * BERNAYS's weekly press pitches (`growth-os/agents/bernays.md`), step `growth-press`. Free and
 * deterministic: no model call, and nothing is sent. Each week it drafts `PITCHES_PER_WEEK`
 * pitches into the queue (`content_drafts`, agent `bernays`, kind `pitch`) for James to review
 * at /admin/growth and send himself.
 *
 * A pitch carries one finding from the live catalog (`published_fee_catalog`): in one state, the
 * median of one of this month's theme fees at banks and at credit unions. Only institutions whose
 * value traces to their own published schedule count (`checkFeeAgainstSource` on every row behind
 * the value, via `failingEnds`), and a median is stated only when each group has at least
 * `MIN_INSTITUTIONS_FOR_MEDIAN` verified institutions. Every number in the pitch is one of those
 * facts (`unbackedNumbers`). The words are neutral and third person, lead with Fee Insight as the
 * publisher, and never advise a fee change or offer a free report (`pitchStyleProblems`).
 *
 * The outlets are the press list in the research draft `growth/drafts/partners-events-press-2026-10.md`
 * (2026-10-08), in its order; the two due next are pitched first.
 */

type SqlTag = typeof sql;

export const PRESS_WORKFLOW = "press-pitch";
export const PITCHES_PER_WEEK = 2;
/** A week's pitches count from drafts made within this many days. */
export const CADENCE_DAYS = 6;
/** An outlet pitched within this many days is not due again (the list turns over in about 7 weeks). */
export const OUTLET_REPEAT_DAYS = 49;
/** A finding (fee and state) used within this many days is not used again. */
export const FINDING_REPEAT_DAYS = 56;
/** Findings tried, best first, before the run gives up on ones that don't verify. */
export const FINDING_TRIES = 6;

export interface PressOutlet {
  key: string;
  name: string;
  /** What they cover, for the closing question. */
  beat: string;
  /** How they take pitches, from the research draft. */
  route: string;
  routeUrl: string;
  /** A fee-related piece on their own site, for James's context. */
  article: { title: string; url: string } | null;
}

/**
 * The research draft's 16 outlets, in its order, less the two that take contributed content
 * only as paid placement (Bank Director's partner program, Independent Banker's advertorials):
 * a pitch is never paid. Routes and links are from that draft's search extracts; James confirms
 * each on the outlet's own page before sending.
 */
export const PRESS_OUTLETS: readonly PressOutlet[] = [
  {
    key: "american-banker",
    name: "American Banker",
    beat: "banking and overdraft policy",
    route: "BankThink opinion: full drafts under 1,000 words, no promotion, no charts",
    routeUrl: "https://www.americanbanker.com/bankthink-submission-guidelines",
    article: { title: "Overdraft fees take bipartisan heat at affordability hearing", url: "https://www.americanbanker.com/news/overdraft-fees-take-bipartisan-heat-at-affordability-hearing" },
  },
  {
    key: "banking-dive",
    name: "Banking Dive",
    beat: "banking news",
    route: "Submit a tip, or submit an opinion",
    routeUrl: "https://www.bankingdive.com/submit-tip/",
    article: { title: "GOP senator slams banks over deposit posting", url: "https://www.bankingdive.com/news/banks-overdraft-fees-credit-card-interest-cap-senate-banking/823661/" },
  },
  {
    key: "aba-banking-journal",
    name: "ABA Banking Journal",
    beat: "bank operations and policy",
    route: "Editorial submission: educational, not promotional, unpaid",
    routeUrl: "https://bankingjournal.aba.com/about/author-guidelines/",
    article: { title: "Ninth Circuit rules BofA can arbitrate overdraft fees dispute", url: "https://bankingjournal.aba.com/2026/06/ninth-circuit-rules-bofa-can-arbitrate-overdraft-fees-dispute/" },
  },
  {
    key: "the-financial-brand",
    name: "The Financial Brand",
    beat: "checking accounts and bank and credit union marketing",
    route: "Proposal form: 1,200+ words, exclusive, no self-promotion; they reply only if accepted",
    routeUrl: "https://thefinancialbrand.com/contact",
    article: { title: "The CFPB Confirms Overdraft Fees are Here to Stay", url: "https://thefinancialbrand.com/news/banking-trends-strategies/cfpb-confirms-overdraft-is-here-to-stay-175824" },
  },
  {
    key: "cu-times",
    name: "CU Times",
    beat: "credit union news",
    route: "Contact form (letters, editorial, general); opinion pieces welcome",
    routeUrl: "https://www.cutimes.com/static/contact-us/",
    article: { title: "Analysis Finds Higher Reliance on Overdraft Fees Among 21 Credit Unions Targeted by Sen. Warren", url: "https://www.cutimes.com/2025/12/05/analysis-finds-higher-reliance-on-overdraft-fees-among-21-credit-unions-targeted-by-sen-warren/" },
  },
  {
    key: "cutoday",
    name: "CUToday",
    beat: "credit union news",
    route: "Press releases through the contact page",
    routeUrl: "https://www.cutoday.info/site/Contact-Us",
    article: { title: "Consumers Paid $12.1B In Overdraft/NSF Fees in 2024", url: "https://www.cutoday.info/Fresh-Today/Consumers-Paid-12.1B-In-Overdraft-NSF-Fees-in-2024-Credit-Union-Members-Hit-Harder-Than-Bank-Customers" },
  },
  {
    key: "cuinsight",
    name: "CUInsight",
    beat: "credit union news",
    route: "Contributor network; pitch through the contact form",
    routeUrl: "https://www.cuinsight.com/contact/",
    article: { title: "Consumer Reports blasts credit unions for overdraft income", url: "https://www.cuinsight.com/consumer-reports-blasts-credit-unions-for-overdraft-income/" },
  },
  {
    key: "creditunions-com",
    name: "CreditUnions.com",
    beat: "credit union performance",
    route: "No public editorial inbox verified; contributed articles arranged with the Callahan team (not verified)",
    routeUrl: "https://creditunions.com/author/callahanassociates/",
    article: { title: "NCUA's New Fee-Reporting Rules: Your Questions Answered", url: "https://creditunions.com/blogs/industry-insights/ncuas-new-fee-reporting-rules-your-questions-answered/" },
  },
  {
    key: "bankrate",
    name: "Bankrate",
    beat: "checking account fees",
    route: "Press room and contact form by inquiry type",
    routeUrl: "https://www.bankrate.com/press-releases/",
    article: { title: "Checking Account and ATM Fee Study", url: "https://www.bankrate.com/banking/checking/checking-account-survey/" },
  },
  {
    key: "nerdwallet",
    name: "NerdWallet",
    beat: "consumer banking comparisons",
    route: "Press page",
    routeUrl: "https://www.nerdwallet.com/press",
    article: { title: "Overdraft Fees: Compare What Banks Charge", url: "https://www.nerdwallet.com/banking/learn/overdraft-fees-what-banks-charge" },
  },
  {
    key: "cnbc-select",
    name: "CNBC Select",
    beat: "bank fees",
    route: "News tips",
    routeUrl: "https://www.cnbc.com/news-tips/",
    article: { title: "How to avoid the most common bank fees", url: "https://www.cnbc.com/select/how-to-avoid-bank-fees/" },
  },
  {
    key: "cbs-moneywatch",
    name: "CBS News MoneyWatch",
    beat: "consumer finance",
    route: "CBS News help center: investigations inbox for story tips",
    routeUrl: "https://help.cbsnews.com/s/article/I-have-a-good-news-story-Who-do-I-contact",
    article: { title: "Americans pay billions in \"junk fees\" every year", url: "https://www.cbsnews.com/news/junk-fees-overdraft-fees-banks-cfpb/" },
  },
  {
    key: "consumer-reports",
    name: "Consumer Reports",
    beat: "bank and credit union fees",
    route: "Submit a news tip, or the media room",
    routeUrl: "https://www.consumerreports.org/consumer-protection/submit-a-tip-to-consumer-reports/",
    article: { title: "When It Comes to Junk Fees in Banking, Credit Unions Can Be Among the Worst Offenders", url: "https://www.consumerreports.org/money/bank-fines-fees/credit-unions-overdraft-and-non-sufficient-funds-fees-a7545026367/" },
  },
  {
    key: "kiplinger",
    name: "Kiplinger",
    beat: "personal finance",
    route: "Editorial feedback and media contact forms",
    routeUrl: "https://www.kiplinger.com/about-us",
    article: { title: "What the House's Vote to Repeal CFPB Bank Overdraft Fees Cap Means For You", url: "https://www.kiplinger.com/personal-finance/banking/senate-vote-repeal-cfpb-bank-overdraft-fees-cap-means-for-you" },
  },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const cents = (value: number) => Math.round(value * 100) / 100;

/** A queue row's subject: the outlet and the finding, so a skip lesson can steer both. */
export function pitchSubjectKey(outletKey: string, findingKey: string): string {
  return `${outletKey}|${findingKey}`;
}

export function parsePitchSubject(subject: string): { outlet: string; finding: string | null } {
  const [outlet, finding] = subject.split("|");
  return { outlet, finding: finding ?? null };
}

/**
 * The outlets due next, at most `count`: never pitched first (in list order), then the longest
 * since their last pitch. An outlet pitched within `OUTLET_REPEAT_DAYS`, or in a pitch James
 * skipped with a reason (a standing lesson), is not due.
 */
export function dueOutlets(
  outlets: readonly PressOutlet[],
  lastPitched: Map<string, Date>,
  avoid: Set<string>,
  now: Date,
  count: number,
): PressOutlet[] {
  const due = outlets
    .map((outlet, index) => ({ outlet, index, last: lastPitched.get(outlet.key) ?? null }))
    .filter(({ outlet, last }) => !avoid.has(outlet.key) && (!last || now.getTime() - last.getTime() >= OUTLET_REPEAT_DAYS * DAY_MS));
  due.sort((a, b) => {
    if (!a.last && !b.last) return a.index - b.index;
    if (!a.last) return -1;
    if (!b.last) return 1;
    return a.last.getTime() - b.last.getTime() || a.index - b.index;
  });
  return due.slice(0, Math.max(0, count)).map(({ outlet }) => outlet);
}

export interface StateFeeRow {
  institution_id: number | string;
  state_code: string;
  charter_type: string | null;
  fee_category: string;
  amount: number | string | null;
}

export interface FindingCandidate {
  key: string;
  feeCategory: string;
  state: string;
  /** Institutions with a value, by charter, before the source check. */
  banks: number[];
  creditUnions: number[];
}

export function findingKey(feeCategory: string, state: string): string {
  return `${feeCategory}:${state}`;
}

/**
 * Fee-and-state groups where banks and credit unions each have enough institutions for a
 * median, before the source check. Unknown charters count as neither (fee-stats rule 5).
 * Best first: the larger of the two smaller groups, then the most institutions.
 */
export function rankFindings(rows: StateFeeRow[], avoid: Set<string>): FindingCandidate[] {
  const groups = new Map<string, StateFeeRow[]>();
  for (const row of rows) {
    if (!STATE_NAMES[row.state_code]) continue;
    const key = findingKey(row.fee_category, row.state_code);
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  const candidates: FindingCandidate[] = [];
  for (const [key, list] of groups) {
    if (avoid.has(key)) continue;
    const charter = new Map<number, string | null>();
    for (const row of list) charter.set(Number(row.institution_id), row.charter_type);
    const ids = [...valuePerInstitution(list).keys()].sort((a, b) => a - b);
    const banks = ids.filter((id) => charter.get(id) === "bank");
    const creditUnions = ids.filter((id) => charter.get(id) === "credit_union");
    if (banks.length < MIN_INSTITUTIONS_FOR_MEDIAN || creditUnions.length < MIN_INSTITUTIONS_FOR_MEDIAN) continue;
    candidates.push({ key, feeCategory: list[0].fee_category, state: list[0].state_code, banks, creditUnions });
  }
  return candidates.sort(
    (a, b) =>
      Math.min(b.banks.length, b.creditUnions.length) - Math.min(a.banks.length, a.creditUnions.length) ||
      b.banks.length + b.creditUnions.length - (a.banks.length + a.creditUnions.length) ||
      a.key.localeCompare(b.key),
  );
}

export interface PressFinding {
  key: string;
  feeCategory: string;
  state: string;
  bankMedian: number;
  creditUnionMedian: number;
  /** Verified institutions behind each median. */
  banks: number;
  creditUnions: number;
  /** Credit union median less bank median. */
  difference: number;
  /** Institutions left out because a row behind their value did not trace to their schedule. */
  failing: number;
  bankIds: number[];
  creditUnionIds: number[];
}

/**
 * The finding from verified institutions only, or null when either group falls below
 * `MIN_INSTITUTIONS_FOR_MEDIAN` once the ones that don't trace are left out.
 */
export function verifiedFinding(candidate: FindingCandidate, rows: StateFeeRow[], failing: Set<number>): PressFinding | null {
  const values = valuePerInstitution(rows.filter((row) => row.state_code === candidate.state && row.fee_category === candidate.feeCategory));
  const bankIds = candidate.banks.filter((id) => !failing.has(id) && values.has(id));
  const creditUnionIds = candidate.creditUnions.filter((id) => !failing.has(id) && values.has(id));
  if (bankIds.length < MIN_INSTITUTIONS_FOR_MEDIAN || creditUnionIds.length < MIN_INSTITUTIONS_FOR_MEDIAN) return null;
  const median = (ids: number[]) => cents(computePercentile(ids.map((id) => values.get(id)!).sort((a, b) => a - b), 50));
  const bankMedian = median(bankIds);
  const creditUnionMedian = median(creditUnionIds);
  return {
    key: candidate.key,
    feeCategory: candidate.feeCategory,
    state: candidate.state,
    bankMedian,
    creditUnionMedian,
    banks: bankIds.length,
    creditUnions: creditUnionIds.length,
    difference: cents(creditUnionMedian - bankMedian),
    failing: [...candidate.banks, ...candidate.creditUnions].filter((id) => failing.has(id)).length,
    bankIds,
    creditUnionIds,
  };
}

/** "Overdraft (OD)" -> "overdraft", keeping an acronym ("NSF") as written. */
export function inSentence(label: string): string {
  return label
    .replace(/\s*\([^)]*\)/g, "")
    .split(" ")
    .map((word) => (word.length > 1 && word === word.toUpperCase() ? word : word.toLowerCase()))
    .join(" ");
}

export interface PressPitch {
  title: string;
  subject: string;
  /** The pitch James sends, guarded: neutral, third person, every number a fact. */
  body: string;
  /** The pitch, then James's notes on the route and the method (not sent). */
  caption: string;
}

export function draftPitch(outlet: PressOutlet, finding: PressFinding, asOf: Date): PressPitch {
  const fee = inSentence(getDisplayName(finding.feeCategory));
  const state = STATE_NAMES[finding.state] ?? finding.state;
  const gap = Math.abs(finding.difference);
  const comparison =
    finding.difference === 0
      ? "The two medians are the same."
      : `The credit union median is ${money(gap)} ${finding.difference < 0 ? "lower" : "higher"} than the bank median.`;
  const subject = `Data note: ${fee} fees at ${state} banks and credit unions, from published fee schedules`;
  const body = [
    `Hello ${outlet.name} team,`,
    `${SITE_NAME} publishes the ${PRODUCT_NAME}, which records each bank's and credit union's fees from its own published fee schedule and checks each figure against that schedule.`,
    `One finding from the current index: in ${state}, the median ${fee} fee is ${money(finding.bankMedian)} across ${finding.banks} banks and ${money(finding.creditUnionMedian)} across ${finding.creditUnions} credit unions. ${comparison} Each institution's fee behind these medians was checked against its own published schedule as of ${asOfLabel(asOf)}.`,
    `${SITE_NAME} can share the method and the source document behind each figure. No sponsorship or placement is attached.`,
    `Would the ${state} figures, or the same comparison for another state, be useful for coverage of ${outlet.beat}?`,
    `Founder, ${SITE_NAME}\n${CONTACT_EMAIL}`,
  ].join("\n\n");
  const notes = [
    "---",
    "For James (not part of the pitch; nothing was sent):",
    `- Route: ${outlet.route}. ${outlet.routeUrl} (from the 2026-10-08 research draft; confirm on the outlet's own page before sending).`,
    outlet.article ? `- Their fee coverage: ${outlet.article.title}. ${outlet.article.url}` : "- Their fee coverage: none found.",
    `- Method: published_fee_catalog, sourced rows only, one value per institution (overdraft at its highest tier), $0 counts; only institutions whose value traced to their own schedule (checkFeeAgainstSource) count; ${finding.failing} left out because a row did not trace. Institution ids are in the draft's facts.`,
  ].join("\n");
  return {
    title: `Pitch to ${outlet.name}: ${fee} fees at ${state} banks and credit unions`,
    subject,
    body,
    caption: `To: ${outlet.name}\nSubject: ${subject}\n\n${body}\n\n${notes}`,
  };
}

/** Numbers the pitch may carry: the finding's figures and the as-of date. */
export function allowedPitchNumbers(finding: PressFinding, asOf: Date): Set<string> {
  const allowed = new Set<string>();
  for (const figure of [finding.bankMedian, finding.creditUnionMedian, Math.abs(finding.difference), finding.banks, finding.creditUnions]) {
    allowed.add(String(figure));
    allowed.add(figure.toFixed(2));
  }
  allowed.add(String(asOf.getUTCDate()));
  allowed.add(String(asOf.getUTCFullYear()));
  return allowed;
}

/** Words a pitch never uses: first person, advice to change a fee, judgements, a free-report offer. */
const STYLE_RULES: Array<{ pattern: RegExp; problem: string }> = [
  { pattern: /\bfree (?:fee )?reports?\b/i, problem: "offers a free report" },
  { pattern: /\b(?:we|our|ours|us)\b|\bI\b|\bmy\b/i, problem: "first person" },
  { pattern: /\b(?:should|recommend\w*|advis\w*|consider\w*|raise|raising|lower (?:your|their|its)|cut (?:your|their|its)|maximi[sz]e)\b/i, problem: "advice to change a fee" },
  { pattern: /\b(?:cheapest|worst|best|gouging|predatory|junk)\b/i, problem: "a judgement, not lower or higher" },
];

/** Why a pitch body breaks the house style, or an empty list. */
export function pitchStyleProblems(body: string): string[] {
  const problems = STYLE_RULES.filter(({ pattern }) => pattern.test(body)).map(({ problem }) => problem);
  const publisher = `${SITE_NAME} publishes the ${PRODUCT_NAME}`;
  const paragraphs = body.split("\n\n");
  if (!paragraphs[1]?.startsWith(publisher)) problems.push(`does not lead with "${publisher}"`);
  return problems;
}

export async function loadStateFeeRows(fees: string[], db: SqlTag = sql): Promise<StateFeeRow[]> {
  const rows = await db.unsafe(
    `SELECT ef.institution_id, s.state_code, s.charter_type, ef.fee_category, ef.amount
       FROM published_fee_catalog ef
       JOIN institution_sources s ON s.id = ef.institution_id
      WHERE ${STATS_ROW_FILTER}
        AND ef.amount IS NOT NULL AND ef.amount >= 0
        AND s.state_code IS NOT NULL
        AND ef.fee_category = ANY($1::text[])`,
    [fees],
  );
  return rows as unknown as StateFeeRow[];
}

export interface PressHistory {
  /** Pitches drafted within `CADENCE_DAYS`. */
  thisWeek: number;
  lastPitched: Map<string, Date>;
  /** Findings used within `FINDING_REPEAT_DAYS`. */
  recentFindings: Set<string>;
}

export async function loadPressHistory(db: SqlTag, now: Date): Promise<PressHistory> {
  const rows = await db`
    SELECT subject_key, created_at FROM content_drafts WHERE workflow = ${PRESS_WORKFLOW}
  `;
  const history: PressHistory = { thisWeek: 0, lastPitched: new Map(), recentFindings: new Set() };
  for (const row of rows) {
    const at = row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at));
    const { outlet, finding } = parsePitchSubject(String(row.subject_key ?? ""));
    const age = now.getTime() - at.getTime();
    if (age < CADENCE_DAYS * DAY_MS) history.thisWeek++;
    const last = history.lastPitched.get(outlet);
    if (!last || at > last) history.lastPitched.set(outlet, at);
    if (finding && age < FINDING_REPEAT_DAYS * DAY_MS) history.recentFindings.add(finding);
  }
  return history;
}

export interface PressResult {
  schemaReady: boolean;
  dryRun: boolean;
  fees: string[];
  due: number;
  outlets: string[];
  findingsConsidered: number;
  /** Findings passed over because too few institutions traced to their schedules. */
  findingsRejected: Array<{ finding: string; failing: number }>;
  pitches: Array<{ outlet: string; finding: string; bankMedian: number; creditUnionMedian: number; banks: number; creditUnions: number; draftId: number | null }>;
  skippedLessons: string[];
  reason: string | null;
}

export async function runPressPitches(input: {
  db?: SqlTag;
  runId: number | null;
  now?: Date;
  dryRun: boolean;
  /** Subjects (outlet|finding) James skipped with a reason: both stay out while the lesson stands. */
  avoidSubjects?: Iterable<string>;
}): Promise<PressResult> {
  const db = input.db ?? sql;
  const now = input.now ?? new Date();
  const fees = themeFees(now);
  const avoidOutlets = new Set<string>();
  const avoidFindings = new Set<string>();
  const skippedLessons = [...(input.avoidSubjects ?? [])];
  for (const subject of skippedLessons) {
    const { outlet, finding } = parsePitchSubject(subject);
    avoidOutlets.add(outlet);
    if (finding) avoidFindings.add(finding);
  }
  const result: PressResult = {
    schemaReady: false,
    dryRun: input.dryRun,
    fees,
    due: 0,
    outlets: [],
    findingsConsidered: 0,
    findingsRejected: [],
    pitches: [],
    skippedLessons,
    reason: null,
  };
  if (!(await contentSchemaReady(db))) return { ...result, reason: "content_drafts table is missing" };
  result.schemaReady = true;

  const history = await loadPressHistory(db, now);
  result.due = Math.max(0, PITCHES_PER_WEEK - history.thisWeek);
  if (result.due === 0) return { ...result, reason: `this week's ${PITCHES_PER_WEEK} pitches are already drafted` };
  const outlets = dueOutlets(PRESS_OUTLETS, history.lastPitched, avoidOutlets, now, result.due);
  result.outlets = outlets.map((outlet) => outlet.key);
  if (outlets.length === 0) return { ...result, reason: "no outlet is due a pitch" };

  const rows = await loadStateFeeRows(fees, db);
  for (const finding of history.recentFindings) avoidFindings.add(finding);
  const ranked = rankFindings(rows, avoidFindings);
  result.findingsConsidered = ranked.length;

  const findings: PressFinding[] = [];
  for (const candidate of ranked.slice(0, FINDING_TRIES)) {
    if (findings.length >= outlets.length) break;
    const ids = [...candidate.banks, ...candidate.creditUnions];
    const endRows = await loadEndRows(db, candidate.feeCategory, ids);
    const loaded = new Set(endRows.map((row) => Number(row.institution_id)));
    // An institution whose rows didn't come back has nothing to trace it to.
    const failing = new Set([...failingEnds(endRows), ...ids.filter((id) => !loaded.has(id))]);
    const finding = verifiedFinding(candidate, rows, failing);
    if (finding) findings.push(finding);
    else result.findingsRejected.push({ finding: candidate.key, failing: failing.size });
  }
  if (findings.length === 0) return { ...result, reason: `no finding kept ${MIN_INSTITUTIONS_FOR_MEDIAN}+ verified banks and credit unions in the top ${result.findingsRejected.length}` };

  const problems: string[] = [];
  for (const [index, outlet] of outlets.entries()) {
    const finding = findings[index];
    if (!finding) break;
    const pitch = draftPitch(outlet, finding, now);
    const unbacked = unbackedNumbers(pitch.body, allowedPitchNumbers(finding, now));
    const style = pitchStyleProblems(pitch.body);
    if (unbacked.length || style.length) {
      problems.push(`${outlet.key}: ${[...style, ...(unbacked.length ? [`numbers not in the facts: ${unbacked.join(", ")}`] : [])].join("; ")}`);
      continue;
    }
    let draftId: number | null = null;
    if (!input.dryRun) {
      draftId = await insertContentDraft(
        {
          agent: "bernays",
          kind: "pitch",
          workflow: PRESS_WORKFLOW,
          channel: channelForKind("pitch"),
          subjectKey: pitchSubjectKey(outlet.key, finding.key),
          title: pitch.title,
          caption: pitch.caption,
          facts: {
            source: "growth-press",
            outlet: { key: outlet.key, name: outlet.name, route: outlet.route, route_url: outlet.routeUrl, article: outlet.article },
            subject: pitch.subject,
            finding: {
              fee_category: finding.feeCategory,
              fee_label: getDisplayName(finding.feeCategory),
              state: finding.state,
              bank_median: finding.bankMedian,
              credit_union_median: finding.creditUnionMedian,
              banks: finding.banks,
              credit_unions: finding.creditUnions,
              difference: finding.difference,
              failing: finding.failing,
              bank_ids: finding.bankIds,
              credit_union_ids: finding.creditUnionIds,
            },
            method:
              "published_fee_catalog, sourced rows only, one value per institution (overdraft at its highest tier), $0 counts; an institution counts only when every row behind its value passes checkFeeAgainstSource; each median needs MIN_INSTITUTIONS_FOR_MEDIAN verified institutions",
          },
          asOf: now,
          agentRunId: input.runId,
        },
        db,
      );
    }
    result.pitches.push({
      outlet: outlet.key,
      finding: finding.key,
      bankMedian: finding.bankMedian,
      creditUnionMedian: finding.creditUnionMedian,
      banks: finding.banks,
      creditUnions: finding.creditUnions,
      draftId,
    });
  }
  if (problems.length) result.reason = `held back: ${problems.join(" | ")}`;
  else if (input.dryRun) result.reason = "dry run: nothing written";
  else if (result.pitches.length < outlets.length) result.reason = `only ${findings.length} finding${findings.length === 1 ? "" : "s"} verified for ${outlets.length} outlets`;
  return result;
}

export function summarizePressPitches(result: PressResult): string {
  if (!result.schemaReady) return "Content queue table is missing; no pitches drafted.";
  const drafted = result.pitches.filter((pitch) => pitch.draftId !== null).length;
  const list = result.pitches.map((pitch) => `${pitch.outlet} (${pitch.finding})`).join(", ");
  if (drafted > 0) return `Drafted ${drafted} press pitch${drafted === 1 ? "" : "es"} for James to review: ${list}.${result.reason ? ` ${result.reason}.` : ""}`;
  if (result.pitches.length > 0) return `Would draft ${result.pitches.length} press pitch${result.pitches.length === 1 ? "" : "es"}: ${list} (${result.reason ?? "dry run"}).`;
  return `No press pitch drafted (${result.reason ?? "unknown"}).`;
}
