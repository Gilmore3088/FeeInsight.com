import type { sql } from "@/lib/data-store/connection";
import { contentSchemaReady, insertContentDraft } from "@/lib/data-store/content-drafts";
import { getNationalIndexCached, getStateFeeIndexes, type IndexEntry } from "@/lib/data-store/fee-index";
import { lastStepDetail, listNewRegulatorItems, recentlyCitedLinks, type RegulatorItem } from "@/lib/data-store/growth-intel";
import { STATE_NAMES } from "@/lib/us-states";
import { robotsAllows, robotsDisallows } from "@/lib/agents/magellan/site-signals";
import { fetchText, pageLines, type Fetcher } from "./contacts";

type SqlTag = typeof sql;

/**
 * SHERLOCK's daily market brief (`growth-os/agents/sherlock.md`), step `growth-intel`. Free and
 * deterministic: no model call, nothing posted, sent or contacted.
 *
 * Two sources, read once a day:
 *   1. Regulator releases and tracked bills first seen in the last day (`reg_articles`,
 *      `reg_tracker_items`, filled by Magellan's registry steps) whose title is about consumer
 *      deposit fees. Each one is paired with what our live catalog says about that fee in that
 *      state (or nationally), so DRAPER can see whether our data can answer the question it raises.
 *   2. A watch of competitors' public pages (`COMPETITOR_PAGES`): the fee-related lines on each
 *      page are compared with the previous run's, and new lines are reported with the link.
 *
 * At most `MAX_FINDINGS` findings a day; most days "nothing new" is the right answer and no brief
 * is filed. A finding our data can't support (fewer than `MIN_INSTITUTIONS` institutions) is
 * skipped, and so is one already cited in the last `REPEAT_DAYS` days. Findings land in the growth
 * queue as one `brief` from SHERLOCK for DRAPER and James to read.
 */

export const INTEL_WORKFLOW = "intel";
export const MAX_FINDINGS = 3;
export const MIN_INSTITUTIONS = 10;
export const REPEAT_DAYS = 14;
/**
 * A feed first read today can carry releases from months ago (prod, Oct 8: of 252 items first
 * seen in a day, 4 were dated October and 52 had no date). Only a release dated in the last
 * `FRESH_DAYS` days is news.
 */
export const FRESH_DAYS = 14;
const LOOKBACK_HOURS = 26;
const MAX_FETCHES = 30;
const LINES_PER_PAGE = 40;

/** Public pages of competitors and alternatives the brief watches. Their own pages only. */
export const COMPETITOR_PAGES: ReadonlyArray<{ name: string; url: string }> = [
  { name: "Moebs Services", url: "https://www.moebs.com/" },
  { name: "Curinos", url: "https://curinos.com/" },
  { name: "S&P Global RateWatch", url: "https://www.rate-watch.com/" },
  { name: "Bankrate checking survey", url: "https://www.bankrate.com/banking/checking/checking-account-survey/" },
  { name: "MoneyRates", url: "https://www.moneyrates.com/" },
];

const FEE_TOPIC =
  /overdraft|\bnsf\b|non-?sufficient|insufficient funds|junk fees?|regulation (?:e|dd)\b|\breg (?:e|dd)\b|truth in savings|service charges?|\bfees?\b[^.]{0,60}\b(?:account|consumer|deposit|checking|bank|credit union)s?\b|\b(?:account|consumer|deposit|checking|bank|credit union)s?\b[^.]{0,60}\bfees?\b/i;

/** True when a title is about consumer deposit fees. */
export function isFeeTopic(title: string): boolean {
  return FEE_TOPIC.test(title);
}

/** The catalog category a title is about: NSF when it names NSF and not overdraft, else overdraft. */
export function categoryFor(title: string): "overdraft" | "nsf" {
  return /\bnsf\b|non-?sufficient|insufficient funds/i.test(title) && !/overdraft/i.test(title) ? "nsf" : "overdraft";
}

const COMPETITOR_LINE = /\bfees?\b|overdraft|\bnsf\b|survey|benchmark|pricing|report|index|study|data/i;

/** A page's fee-related lines: short visible lines that mention fees, pricing, surveys or data. */
export function competitorLines(html: string): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const line of pageLines(html)) {
    if (line.length < 12 || line.length > 200 || !COMPETITOR_LINE.test(line) || seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
    if (lines.length >= LINES_PER_PAGE) break;
  }
  return lines;
}

export interface DataLine {
  scope: string;
  category: string;
  median: number;
  institutions: number;
}

export interface IntelFinding {
  kind: "regulator" | "competitor";
  what: string;
  link: string;
  seenOn: string | null;
  whyItMatters: string;
  ourData: DataLine | null;
  suggestedJob: string;
}

export interface CompetitorWatch {
  name: string;
  url: string;
  status: number | null;
  lines: string[];
}

export interface IntelResult {
  schemaReady: boolean;
  dryRun: boolean;
  regulatorItemsRead: number;
  feeItems: number;
  pagesFetched: number;
  findings: IntelFinding[];
  skipped: Array<{ what: string; reason: string }>;
  /** Each competitor page's fee-related lines, kept for tomorrow's comparison. */
  watch: CompetitorWatch[];
  draftId: number | null;
  reason: string | null;
}

const money = (value: number) => `$${value.toFixed(2).replace(/\.00$/, "")}`;

function entryFor(entries: IndexEntry[], category: string): IndexEntry | null {
  return entries.find((entry) => entry.fee_category === category) ?? null;
}

export type IndexReader = {
  national: () => Promise<IndexEntry[]>;
  state: (stateCode: string) => Promise<IndexEntry[]>;
};

const liveIndex: IndexReader = {
  national: () => getNationalIndexCached(),
  state: async (stateCode) => (await getStateFeeIndexes(stateCode)).all,
};

/** What the live catalog says about a regulator item's fee, in its state or nationally. */
async function dataFor(item: RegulatorItem, index: IndexReader): Promise<DataLine | null> {
  const category = categoryFor(item.title);
  const entries = item.stateCode ? await index.state(item.stateCode) : await index.national();
  const entry = entryFor(entries, category);
  if (!entry || entry.median_amount === null) return null;
  return {
    scope: item.stateCode ? STATE_NAMES[item.stateCode] ?? item.stateCode : "nationally",
    category,
    median: Number(entry.median_amount),
    institutions: entry.institution_count,
  };
}

function regulatorFinding(item: RegulatorItem, data: DataLine): IntelFinding {
  const where = item.stateCode ? `${STATE_NAMES[item.stateCode] ?? item.stateCode} institutions` : "institutions everywhere";
  return {
    kind: "regulator",
    what: `${item.source.replace(/^state:/, "State regulator ")}: ${item.title}`,
    link: item.link,
    seenOn: item.publishedOn,
    whyItMatters: `Fee owners at ${where} will be asked how their ${data.category === "nsf" ? "NSF" : "overdraft"} pricing compares when this comes up; a sourced comparison answers that.`,
    ourData: data,
    suggestedJob: item.stateCode
      ? `CARNEGIE: a talking point for ${STATE_NAMES[item.stateCode] ?? item.stateCode} prospects. ERNEST: a state finding if it holds.`
      : "ERNEST: a finding-led article. MURROW: one post linking to it.",
  };
}

export async function runMarketIntel(input: {
  db: SqlTag;
  runId: number | null;
  dryRun: boolean;
  fetcher?: Fetcher;
  index?: IndexReader;
  now?: Date;
}): Promise<IntelResult> {
  const fetcher = input.fetcher ?? fetch;
  const index = input.index ?? liveIndex;
  const now = input.now ?? new Date();
  const result: IntelResult = {
    schemaReady: false,
    dryRun: input.dryRun,
    regulatorItemsRead: 0,
    feeItems: 0,
    pagesFetched: 0,
    findings: [],
    skipped: [],
    watch: [],
    draftId: null,
    reason: null,
  };
  if (!(await contentSchemaReady(input.db))) return { ...result, reason: "content_drafts is missing" };
  result.schemaReady = true;

  const cited = await recentlyCitedLinks(INTEL_WORKFLOW, REPEAT_DAYS, input.db);

  // 1. Regulator releases and bills about consumer deposit fees.
  const items = await listNewRegulatorItems(LOOKBACK_HOURS, 500, input.db);
  result.regulatorItemsRead = items.length;
  const feeItems = items.filter((item) => isFeeTopic(item.title));
  result.feeItems = feeItems.length;
  for (const item of feeItems) {
    if (result.findings.length >= MAX_FINDINGS) break;
    const age = item.publishedOn ? (now.getTime() - Date.parse(item.publishedOn)) / 86_400_000 : null;
    if (age === null || Number.isNaN(age) || age > FRESH_DAYS) {
      result.skipped.push({ what: item.title, reason: item.publishedOn ? `released ${item.publishedOn}, not news` : "no release date" });
      continue;
    }
    if (cited.has(item.link)) {
      result.skipped.push({ what: item.title, reason: `already in a brief in the last ${REPEAT_DAYS} days` });
      continue;
    }
    const data = await dataFor(item, index);
    if (!data || data.institutions < MIN_INSTITUTIONS) {
      result.skipped.push({ what: item.title, reason: `our live data is too thin (${data?.institutions ?? 0} institutions; ${MIN_INSTITUTIONS} needed)` });
      continue;
    }
    result.findings.push(regulatorFinding(item, data));
    cited.add(item.link);
  }

  // 2. Competitors' public pages, compared with the previous run.
  const previous = await lastStepDetail("growth-intel", input.db);
  const before = new Map<string, Set<string>>();
  if (Array.isArray(previous?.watch)) {
    for (const page of previous.watch as CompetitorWatch[]) {
      if (page && typeof page.url === "string" && Array.isArray(page.lines)) before.set(page.url, new Set(page.lines));
    }
  }
  for (const page of COMPETITOR_PAGES) {
    if (result.pagesFetched + 2 > MAX_FETCHES) break;
    const robots = await fetchText(new URL("/robots.txt", page.url).href, fetcher);
    result.pagesFetched += 1;
    const path = new URL(page.url);
    if (robots.ok && !robotsAllows(`${path.pathname}${path.search}`, robotsDisallows(robots.text))) {
      result.watch.push({ name: page.name, url: page.url, status: null, lines: [] });
      result.skipped.push({ what: page.name, reason: "its robots.txt asks crawlers like ours not to read the page" });
      continue;
    }
    const fetched = await fetchText(page.url, fetcher);
    result.pagesFetched += 1;
    const lines = fetched.ok ? competitorLines(fetched.text) : [];
    result.watch.push({ name: page.name, url: page.url, status: fetched.status, lines });
    const earlier = before.get(page.url);
    // The first read of a page sets its baseline; only lines new since a previous read count.
    if (!fetched.ok || !earlier || earlier.size === 0) continue;
    const added = lines.filter((line) => !earlier.has(line));
    if (!added.length || result.findings.length >= MAX_FINDINGS) continue;
    result.findings.push({
      kind: "competitor",
      what: `${page.name} changed its public page: ${added.slice(0, 3).map((line) => `"${line}"`).join("; ")}`,
      link: fetched.url,
      seenOn: now.toISOString().slice(0, 10),
      whyItMatters: "A competitor changing what it says about fee data can change what buyers compare us against.",
      ourData: null,
      suggestedJob: "SHERLOCK: update the competitor profile from their own page. DRAPER: decide whether our positioning line still holds.",
    });
  }

  if (!result.findings.length) return result;
  if (input.dryRun) return result;

  const day = now.toISOString().slice(0, 10);
  result.draftId = await insertContentDraft(
    {
      agent: "sherlock",
      kind: "brief",
      workflow: INTEL_WORKFLOW,
      channel: "internal",
      subjectKey: `intel:${day}`,
      title: `Market brief ${day}: ${result.findings.length} finding${result.findings.length === 1 ? "" : "s"}`,
      caption: briefText(result.findings, day),
      facts: { links: result.findings.map((finding) => finding.link), findings: result.findings, source: "growth-intel" },
      asOf: now,
      agentRunId: input.runId,
    },
    input.db,
  );
  return result;
}

/** The brief as James and DRAPER read it in the queue. */
export function briefText(findings: IntelFinding[], day: string): string {
  const lines = [`SHERLOCK market brief, ${day}. Internal: nothing here is sent or posted.`, ""];
  findings.forEach((finding, i) => {
    lines.push(`${i + 1}. ${finding.what}`);
    lines.push(`   Source: ${finding.link}${finding.seenOn ? ` (${finding.seenOn})` : ""}`);
    lines.push(`   Why it matters: ${finding.whyItMatters}`);
    if (finding.ourData) {
      const { scope, category, median, institutions } = finding.ourData;
      lines.push(`   Our live data: ${category === "nsf" ? "NSF" : "overdraft"} median ${money(median)} across ${institutions} institutions ${scope === "nationally" ? "nationally" : `in ${scope}`} (live catalog, not source-checked for this brief).`);
    }
    lines.push(`   Suggested job: ${finding.suggestedJob}`);
    lines.push("");
  });
  return lines.join("\n").trim();
}

export function summarizeMarketIntel(result: IntelResult): string {
  if (!result.schemaReady) return `Wrote no brief: ${result.reason ?? "queue not ready"}.`;
  const pages = result.watch.filter((page) => page.lines.length > 0).length;
  const read = `Read ${result.regulatorItemsRead} new regulator item${result.regulatorItemsRead === 1 ? "" : "s"} (${result.feeItems} about fees) and ${pages} of ${result.watch.length} competitor pages`;
  if (!result.findings.length) return `${read}; nothing new worth a brief.`;
  return `${read}; ${result.dryRun ? "would file" : "filed"} a brief with ${result.findings.length} finding${result.findings.length === 1 ? "" : "s"}.`;
}
