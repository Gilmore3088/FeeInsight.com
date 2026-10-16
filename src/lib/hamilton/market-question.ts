/**
 * Questions about a market rather than one institution's fee ("talk to me about Florida: fee
 * pricing, revenue, complaints"). They get a market brief: the published evidence for the place and
 * topics asked, across the five intelligence lenses, with no provider call (HP3 #1077). Questions
 * about the reader's own institution, a price to test, a list of institutions, an opinion or a follow-up
 * to an earlier answer stay with
 * the Ask engine, which owns those paths.
 */
import type { LandingResearchHandoff, ResearchStateCode } from "./landing-research-handoff";
import { RESEARCH_STATE_CODES } from "./landing-research-handoff";
import { resolveLocalMarketCategories } from "./local-market-request";
import { STATE_NAMES } from "@/lib/us-states";
import { charterIn, parseSegment, SEGMENT_AMOUNTS, stateIn } from "./workspace/segment";
import { feeCategoriesIn, pricesIn } from "./workspace/ask";
import { isPeerListContinuationQuestion, isPeerListQuestion, parsePeerListQuestion } from "./peer-list";
import type { AskSegment } from "./workspace/types";

export const INTELLIGENCE_LENSES = [
  { id: "fees", label: "Fee landscape" },
  { id: "financials", label: "Financials" },
  { id: "economy", label: "Economy" },
  { id: "complaints", label: "Complaints" },
  { id: "regulation", label: "Regulation" },
] as const;
export type Lens = (typeof INTELLIGENCE_LENSES)[number]["id"];

/** The default fee set for Overview, Research and market briefs: overdraft first, the fees boards and regulators ask about. */
export const MARKET_BRIEF_CATEGORIES = ["overdraft", "nsf", "monthly_maintenance", "wire_domestic_outgoing", "atm_non_network"];

const NATIONAL = /\b(national(ly)?|nationwide|across the (country|u\.?s\.?)|the u\.?s\.?|united states|u\.s\.|america)\b/i;
const OWN = /\b(our|my|we|us|i)\b/i;
/** "How does that compare nationally?" follows up an earlier answer; the conversation keeps it. */
const FOLLOW_UP = /\b(that|those|this|these|it|them|they|there)\b/i;
const LIST = /^\s*(which|who|list|name|rank|show me (the|which))\b/i;
const OPINION = /\bshould\b|\brecommend|\badvi[sc]e|\bwhat would you\b|\bbest (price|option)\b/i;
const TOPICS: Array<{ lens: Lens; re: RegExp }> = [
  { lens: "fees", re: /\bfees?\b|pric(e|es|ing)|charges?\b/i },
  { lens: "financials", re: /revenue|income|service[- ]charge|earn|financ|call report|profit/i },
  { lens: "economy", re: /econom|unemploy|jobs|payroll|inflation|cpi|interest rates?|fed funds|federal funds|beige book|fomc/i },
  { lens: "complaints", re: /complain|cfpb/i },
  { lens: "regulation", re: /regulat|\brules?\b|\blaws?\b|enforcement|compliance|legislat|\bbills?\b/i },
];

export interface MarketQuestion {
  selection: LandingResearchHandoff;
  lenses: Lens[];
  /** The asset-size slice the question named, applied to the institution table only. */
  segment: AskSegment | null;
  place: string;
}

export function parseMarketQuestion(question: string): MarketQuestion | null {
  const text = question.trim();
  if (!text || LIST.test(text) || OWN.test(text) || OPINION.test(text) || FOLLOW_UP.test(text)) return null;
  // A list of institutions ("Florida institutions above 5 billion") or a follow-up to one ("Only show
  // the California ones") belongs to the peer list in the conversation, not a market brief.
  // Only a question the peer list can answer as written gives way; "Give me a brief on Ohio credit
  // unions over $500M" still gets its brief. A follow-up that names a fee stays a market question.
  if (isPeerListQuestion(text) && parsePeerListQuestion(text)?.problems.length === 0) return null;
  if (isPeerListContinuationQuestion(text) && feeCategoriesIn(text).length === 0) return null;
  const segment = parseSegment(text);
  if (pricesIn(segment ? text.replace(SEGMENT_AMOUNTS, " ") : text).length > 0) return null;
  const stateCode = stateIn(text);
  const state = stateCode && (RESEARCH_STATE_CODES as readonly string[]).includes(stateCode) ? (stateCode as ResearchStateCode) : null;
  if (!state && !NATIONAL.test(text)) return null;

  const named = feeCategoriesIn(text);
  let categories = MARKET_BRIEF_CATEGORIES;
  if (named.length) {
    try { categories = resolveLocalMarketCategories(named.slice(0, 5)); } catch { categories = MARKET_BRIEF_CATEGORIES; }
  }
  const asked = TOPICS.filter(t => t.re.test(text)).map(t => t.lens);
  const lenses: Lens[] = asked.length ? [...new Set<Lens>([...(named.length ? ["fees" as const] : []), ...asked])] : INTELLIGENCE_LENSES.map(l => l.id);
  const charter = charterIn(text);
  return {
    selection: { version: 1, task: "compare", scope: state ? { kind: "state", stateCode: state } : { kind: "national" }, categories, charter: charter ?? "all" },
    lenses: INTELLIGENCE_LENSES.map(l => l.id).filter(id => lenses.includes(id)),
    segment: segment && (segment.minAssets !== null || segment.maxAssets !== null) ? segment : null,
    place: state ? STATE_NAMES[state] ?? state : "the United States",
  };
}

/** The Ask page link that shows a market brief for a question; the server parses it again. */
export function marketBriefHref(question: string, instId?: string | null): string {
  return `/pro/analyze?${new URLSearchParams({ brief: question.trim().slice(0, 500), ...(instId ? { instId } : {}) })}`;
}
