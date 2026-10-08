import { sql } from "@/lib/data-store/connection";
import { STATS_ROW_FILTER, STRONG_INSTITUTION_COUNT, summarizeFees } from "@/lib/data-store/fee-stats";
import { contentSchemaReady, insertContentDraft } from "@/lib/data-store/content-drafts";
import { unbackedNumbers } from "@/lib/agents/marketing/facts";
import { PRODUCT_NAME, RESEARCH_IMPRINT, SITE_URL } from "@/lib/constants";
import { STATE_NAMES, US_STATES_ONLY } from "@/lib/us-states";

/**
 * Ernest's weekly "fees by state" article (build plan 2.9 and 2.10, free, no model). Each
 * week takes the next fee in FEE_TOPICS that has no article this month, starting with
 * overdraft: each state's median from published schedules against the national median,
 * written as a research article draft (`research_articles`, status draft) and filed in the
 * growth queue for James. Nothing publishes: James publishes the article from
 * /admin/hamilton/research/articles.
 *
 * Statistics follow `fee-stats.ts`: sourced consumer rows, one value per institution,
 * overdraft at its highest tier, $0 counts. A state is listed only with
 * STRONG_INSTITUTION_COUNT institutions behind its median. No institution is named, and
 * the wording stays neutral ("lower" / "higher").
 */

type SqlTag = typeof sql;

/** The workflow name predates the other topics; kept so the cadence counts every draft. */
export const OD_BY_STATE_WORKFLOW = "ernest-od-by-state";
export const OD_CATEGORY = "overdraft";
/** States shown at each end of the ranking. */
export const ENDS = 5;
/** A run within this many days of the last draft skips: one article a week. */
export const CADENCE_DAYS = 6;

export interface FeeTopic {
  category: string;
  /** "overdraft fee": lower case except acronyms, used mid-sentence. */
  noun: string;
  /** "Overdraft fees": the title's start. */
  titlePlural: string;
  /** How an institution with several amounts is counted. No numbers. */
  method: string;
}

/** Article topics in the order they are written each month. */
export const FEE_TOPICS: readonly FeeTopic[] = [
  {
    category: OD_CATEGORY,
    noun: "overdraft fee",
    titlePlural: "Overdraft fees",
    method: "An institution that charges different overdraft fees by amount or by count is counted at its standard (highest) fee, and a free overdraft counts as $0.",
  },
  {
    category: "nsf",
    noun: "NSF fee",
    titlePlural: "NSF fees",
    method: "An institution that lists several NSF amounts is counted at the middle of its own amounts, and a free NSF item counts as $0.",
  },
  {
    category: "monthly_maintenance",
    noun: "monthly maintenance fee",
    titlePlural: "Monthly maintenance fees",
    method: "An institution with several checking accounts is counted at the middle of its own monthly fees, and an account with no monthly fee counts as $0.",
  },
  {
    category: "atm_non_network",
    noun: "out-of-network ATM fee",
    titlePlural: "Out-of-network ATM fees",
    method: "An institution that lists several amounts is counted at the middle of its own amounts, and a free out-of-network withdrawal counts as $0.",
  },
];

export const OVERDRAFT_TOPIC = FEE_TOPICS[0];

export interface OdRow {
  institution_id: number | string;
  state_code: string;
  amount: number | string;
}

export interface StateOd {
  code: string;
  name: string;
  institutions: number;
  median: number;
}

export interface OdSummary {
  national: { institutions: number; median: number } | null;
  states: StateOd[];
  /** States with some data for the fee but too few institutions to list. */
  thinStates: number;
}

export function summarizeOdByState(rows: OdRow[], category: string = OD_CATEGORY): OdSummary {
  // The national median counts every institution, territories included, as the National report does.
  const nationalStats = summarizeFees(rows.map((row) => ({ ...row, fee_category: category })));
  const byState = new Map<string, OdRow[]>();
  for (const row of rows) {
    if (!US_STATES_ONLY.has(row.state_code) && row.state_code !== "DC") continue;
    const list = byState.get(row.state_code);
    if (list) list.push(row);
    else byState.set(row.state_code, [row]);
  }
  const states: StateOd[] = [];
  let thinStates = 0;
  for (const [code, list] of byState) {
    const stats = summarizeFees(list.map((row) => ({ ...row, fee_category: category })));
    if (stats.institution_count < STRONG_INSTITUTION_COUNT || stats.median_amount === null) {
      thinStates += 1;
      continue;
    }
    states.push({ code, name: STATE_NAMES[code] ?? code, institutions: stats.institution_count, median: stats.median_amount });
  }
  states.sort((a, b) => a.median - b.median || a.name.localeCompare(b.name));
  return {
    national:
      nationalStats.median_amount === null ? null : { institutions: nationalStats.institution_count, median: nationalStats.median_amount },
    states,
    thinStates,
  };
}

export function dollars(value: number): string {
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

function monthLabel(asOf: Date): string {
  return asOf.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function articleSlug(asOf: Date, topic: FeeTopic = OVERDRAFT_TOPIC): string {
  return `${topic.category.replace(/_/g, "-")}-fees-by-state-${asOf.toISOString().slice(0, 7)}`;
}

function stateLine(state: StateOd, national: number): string {
  const vs = state.median === national ? "the same as the national median" : state.median < national ? "lower than the national median" : "higher than the national median";
  return `- [${state.name}](${SITE_URL}/research/state/${state.code}): ${dollars(state.median)} across ${state.institutions} institutions, ${vs}`;
}

export interface OdArticle {
  slug: string;
  title: string;
  subtitle: string;
  content: string;
}

export function draftOdArticle(summary: OdSummary, asOf: Date, topic: FeeTopic = OVERDRAFT_TOPIC): OdArticle | null {
  if (!summary.national || summary.states.length < ENDS * 2) return null;
  const national = summary.national.median;
  const lower = summary.states.slice(0, ENDS);
  const higher = summary.states.slice(-ENDS).reverse();
  const month = monthLabel(asOf);
  const content = [
    `The national median ${topic.noun} is ${dollars(national)}, from the published fee schedules of ${summary.national.institutions.toLocaleString("en-US")} banks and credit unions. Across the ${summary.states.length} states with enough data to report, the typical ${topic.noun} runs from ${dollars(summary.states[0].median)} to ${dollars(summary.states[summary.states.length - 1].median)}.`,
    `## States with the lowest median ${topic.noun}`,
    lower.map((state) => stateLine(state, national)).join("\n"),
    `## States with the highest median ${topic.noun}`,
    higher.map((state) => stateLine(state, national)).join("\n"),
    `## Every state with enough data`,
    summary.states.map((state) => stateLine(state, national)).join("\n"),
    `## How these numbers are built`,
    [
      `Each figure comes from the ${PRODUCT_NAME}, built from each institution's own published fee schedule. Every institution counts once. ${topic.method}`,
      `A state is listed only when at least ${STRONG_INSTITUTION_COUNT} institutions in it publish ${/^[aeiou]/i.test(topic.noun) || topic.noun.startsWith("NSF") ? "an" : "a"} ${topic.noun}; ${summary.thinStates} states had fewer and are left out. Business-only schedules are left out.`,
      `To see every fee for a state, open its [state fee report](${SITE_URL}/research). To compare one institution with its state, look it up [here](${SITE_URL}/institutions).`,
    ].join("\n\n"),
    `As of ${month}.`,
  ].join("\n\n");
  return {
    slug: articleSlug(asOf, topic),
    title: `${topic.titlePlural} by state, ${month}`,
    subtitle: `The median ${topic.noun} in each state, from published bank and credit union fee schedules, against the national median of ${dollars(national)}.`,
    content,
  };
}

/** Every number the article may carry. */
export function allowedOdNumbers(summary: OdSummary, asOf: Date): Set<string> {
  const values: Array<number | string> = [ENDS, STRONG_INSTITUTION_COUNT, summary.thinStates, summary.states.length, asOf.getUTCFullYear(), 0];
  if (summary.national) values.push(summary.national.institutions, summary.national.median, dollars(summary.national.median).slice(1));
  for (const state of summary.states) values.push(state.institutions, state.median, dollars(state.median).slice(1));
  return new Set(values.map(String));
}

export async function loadOdRows(db: SqlTag = sql, category: string = OD_CATEGORY): Promise<OdRow[]> {
  const rows = await db.unsafe(
    `SELECT ef.institution_id, s.state_code, ef.amount
       FROM published_fee_catalog ef
       JOIN institution_sources s ON s.id = ef.institution_id
      WHERE ${STATS_ROW_FILTER}
        AND ef.fee_category = $1
        AND ef.amount IS NOT NULL AND ef.amount >= 0
        AND s.state_code IS NOT NULL`,
    [category],
  );
  return rows as unknown as OdRow[];
}

/** The first topic in FEE_TOPICS whose article for this month isn't written yet. */
export function nextTopic(existingSlugs: Set<string>, asOf: Date): FeeTopic | null {
  return FEE_TOPICS.find((topic) => !existingSlugs.has(articleSlug(asOf, topic))) ?? null;
}

export interface OdByStateResult {
  schemaReady: boolean;
  dryRun: boolean;
  category: string | null;
  statesListed: number;
  nationalMedian: number | null;
  slug: string | null;
  articleId: number | null;
  draftId: number | null;
  reason: string | null;
}

export async function runOdByState(input: { db?: SqlTag; runId: number | null; now?: Date; dryRun: boolean }): Promise<OdByStateResult> {
  const db = input.db ?? sql;
  const now = input.now ?? new Date();
  const base: OdByStateResult = { schemaReady: false, dryRun: input.dryRun, category: null, statesListed: 0, nationalMedian: null, slug: null, articleId: null, draftId: null, reason: null };
  if (!(await contentSchemaReady(db))) return { ...base, reason: "content_drafts table is missing" };

  const [{ lately }] = await db`
    SELECT count(*)::int AS lately FROM content_drafts
     WHERE workflow = ${OD_BY_STATE_WORKFLOW} AND created_at >= now() - make_interval(days => ${CADENCE_DAYS}::int)
  `;
  if (Number(lately) > 0) return { ...base, schemaReady: true, reason: "drafted one this week already; this article runs weekly" };
  const slugs = FEE_TOPICS.map((topic) => articleSlug(now, topic));
  const existing = await db`SELECT slug FROM research_articles WHERE slug = ANY(${slugs})`;
  const topic = nextTopic(new Set(existing.map((row) => String(row.slug))), now);
  if (!topic) return { ...base, schemaReady: true, reason: "every fee-by-state article for this month is written" };

  const summary = summarizeOdByState(await loadOdRows(db, topic.category), topic.category);
  const result: OdByStateResult = {
    ...base,
    schemaReady: true,
    category: topic.category,
    statesListed: summary.states.length,
    nationalMedian: summary.national?.median ?? null,
    slug: articleSlug(now, topic),
  };
  const article = draftOdArticle(summary, now, topic);
  if (!article) return { ...result, reason: `fewer than ${ENDS * 2} states have ${STRONG_INSTITUTION_COUNT} institutions with ${topic.noun} data` };
  const unbacked = unbackedNumbers(`${article.title}\n${article.subtitle}\n${article.content.replace(/\]\([^)]*\)/g, "]")}`, allowedOdNumbers(summary, now));
  if (unbacked.length) return { ...result, reason: `article carries numbers not in the facts: ${unbacked.join(", ")}` };
  if (input.dryRun) return { ...result, reason: "dry run: nothing written" };

  const [row] = await db`
    INSERT INTO research_articles (slug, title, subtitle, content, category, tags, author, generated_by)
    VALUES (${article.slug}, ${article.title}, ${article.subtitle}, ${article.content}, 'analysis',
            ${JSON.stringify([topic.category, "states"])}, ${RESEARCH_IMPRINT}, 'growth:ernest')
    RETURNING id
  `;
  const articleId = Number(row.id);
  const draftId = await insertContentDraft(
    {
      agent: "ernest",
      kind: "article",
      channel: "site",
      workflow: OD_BY_STATE_WORKFLOW,
      subjectKey: article.slug,
      title: article.title,
      caption: `${article.subtitle}\n\nThe article is a draft. Read and publish it at ${SITE_URL}/admin/hamilton/research/articles; it goes live at ${SITE_URL}/research/articles/${article.slug}.`,
      facts: {
        kind: "article",
        article_id: articleId,
        slug: article.slug,
        fee_category: topic.category,
        national_median: summary.national?.median ?? null,
        national_institutions: summary.national?.institutions ?? null,
        states: summary.states,
        thin_states: summary.thinStates,
        method: `published_fee_catalog, sourced consumer rows only; one value per institution (overdraft at its highest tier, others at their middle amount); $0 counts; a state needs ${STRONG_INSTITUTION_COUNT}+ institutions`,
      },
      asOf: now,
      agentRunId: input.runId,
    },
    db,
  );
  return { ...result, articleId, draftId };
}

export function summarizeOdByStateResult(result: OdByStateResult): string {
  if (!result.schemaReady) return "Content queue table is missing; nothing drafted.";
  if (result.draftId !== null) {
    return `Drafted a fees-by-state article (${result.slug}): ${result.statesListed} states against a national median of ${dollars(result.nationalMedian ?? 0)}.`;
  }
  return `No fees-by-state article drafted (${result.reason ?? "unknown"}).`;
}
