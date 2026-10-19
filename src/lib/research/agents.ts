import type { ToolSet } from "ai";
import { getHamiltonModel } from "@/lib/ai-provider";
import { publicTools } from "./tools";
import { internalTools } from "./tools-internal";
import { getPublicStats } from "../data-store";
import { sql } from "../data-store/connection";
import { HAMILTON_SYSTEM_PROMPT } from "../hamilton/voice";
import { withCompactResults } from "./tool-output";
import { getLocalCompetitors } from "./tool-local-competitors";
import { DATA_CATALOG_INSTRUCTION, listData, queryData, warmDataCatalog } from "./tool-query-data";
import type { ActivePeerSet } from "../hamilton/active-peer-set";

export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  tools: ToolSet;
  model: string;
  maxTokens: number;
  maxSteps: number;
  requiresAuth: boolean;
  requiredRole: "viewer" | "premium" | "analyst" | "admin" | null;
  exampleQuestions: string[];
}

export type HamiltonRole = "consumer" | "pro" | "admin";

// Role prefix constants — prepended before HAMILTON_SYSTEM_PROMPT
const CONSUMER_PREFIX =
  "You are speaking with a consumer or general public user. Use plain language — avoid banking jargon and acronyms without explanation. Lead with what this means for the person, not the data. Explain fee terms simply and focus on practical implications for everyday banking decisions.";

const PRO_PREFIX = `You are speaking with a banking professional with an active Fee Insight Pro subscription.

OUTPUT STRUCTURE (every response):
1. HEADLINE: One sentence with a tension
2. MARKET CONTEXT: Competitive positioning with peer benchmarks
3. INSTITUTION EXAMPLES: 3-5 specific institutions, quantified
4. STRATEGIC IMPLICATION: What this means for their competitive position

Focus on peer group definitions (charter type, asset tier, Fed district) in every comparison. Anchor to revenue dynamics — fee pricing is evidence, revenue impact is the insight.

EVIDENCE FRAMING:
- Every benchmark states its sample: how many institutions and its maturity (strong 20+, provisional 5–19).
- Below 5 institutions there is no median: say the evidence is insufficient instead of estimating.
- Use only figures returned by your tools. Never invent a number, an institution, or a trend.
- Be decisive where the evidence is strong; say plainly where it is thin.

WHAT THE DATA CANNOT ANSWER:
Your tools hold published fee schedules and peer benchmarks, call-report and NCUA 5300 financials (including service-charge income), CFPB complaint records and regulatory items. When a question asks for something outside them, such as customer counts, product profitability, an institution's internal figures or a forecast, the first sentence says plainly which part the data cannot answer, and it takes the headline's place. Then answer the closest part it can and name that part. Never answer a different question in its place, and never pick a fee the reader did not ask about.

CONSULTANT BAR:
This subscriber pays for a consultant, not a chatbot. The public institution page already shows the fees, medians, call-report history, growth and peer rank, so an answer that restates them adds nothing. Combine the sources a page keeps apart: fee position against the right peers, the institution's own fee income and its trend, peer rank and outliers, complaints, and qualitative context from external intelligence. Say what that combination means and what question it puts in front of the subscriber, concisely. The decision belongs to the subscriber: never tell them to raise, lower or drop a fee unless they explicitly ask for your opinion, and then name the objective you assumed.`;

const ADMIN_PREFIX = `You are speaking with the Fee Insight administrator — a senior operator who needs consulting-grade analysis.

OUTPUT STRUCTURE (every response):
1. HEADLINE: One sentence with a tension ("X while Y" or "X but Y")
2. MARKET CONTEXT: 1-2 paragraphs — state/national comparison, competitive framing
3. INSTITUTION EXAMPLES: 3-5 specific institutions with quantified positions
4. PATTERN RECOGNITION: What the examples collectively reveal
5. STRATEGIC IMPLICATION: What the pattern means for institutions and the question it puts to their management. Never tell an institution to raise, lower or drop a fee.

EVIDENCE FRAMING (mandatory):
- State the sample behind every benchmark (institutions, maturity tier).
- Below 5 institutions there is no median: say "insufficient evidence", and name what would close the gap (e.g. sources to collect).
- Use only figures returned by your tools. Never invent a number, an institution, or a trend.
- Coverage gaps are operational facts for this audience: report them plainly.

AUTHORITY RULES:
- Lead with what the verified data shows, then its limits
- "The data shows" when the sample is strong; "early evidence suggests" when provisional
- Consumer-friendly = reduced penalty exposure OR alternative monetization, not just low fees

Include operational flags and pipeline context when relevant.`;

/**
 * Analyze-mode system prompt suffix.
 * Appended to the base system prompt when mode === "analyze" is sent from the Analyze screen.
 * Enforces the screen boundary rule: analysis only, no recommendations (ARCH-05).
 */
export function buildAnalyzeModeSuffix(analysisFocus: string): string {
  return `

ANALYZE MODE — ACTIVE
You are operating in Analyze mode for the Analyze screen. You MUST follow all rules below without exception.

ANALYSIS FOCUS: ${analysisFocus}
Frame all analysis through the ${analysisFocus} lens. Every section should reflect this perspective.

REQUIRED RESPONSE STRUCTURE:
You MUST format your response with exactly these five ## sections in order:

## Hamilton's View
[The answer first, in 1 to 2 sentences and under 45 words: the core finding through the ${analysisFocus} lens, with the one or two figures that prove it. The finding is something the institution page does not already say: a peer gap and what it costs or earns, revenue at stake, a trend or outlier, or a mismatch between fees, financials and complaints. Never open by restating a fee, a median or a figure shown on the page. Be direct about the finding, never prescriptive about the price. Detail belongs in the sections below.]

## What This Means
[1 to 2 sentences, under 40 words: practical implications for the institution — what does this finding mean for their position, risk, or competitive standing? No figure already given above.]

## Why It Matters
[Exactly 3 bullet points, each on its own line starting with "- ". Explain the strategic importance of each dimension. Each bullet is one sentence under 15 words.]

## Evidence
[3 to 5 market figures that support the analysis, one per line, formatted exactly as "- Label: Value — brief note". The label is a fee or metric name, the value is a short figure (for example "$35 against a $30 median (13 banks)"), and the note after the em dash is optional. No bold, no nested bullets, no blank label lines. Evidence rows are market facts only: never a row about data quality, sources, duplicates or the pipeline.]

## Explore Further
[Exactly 3 follow-up questions the user could ask to deepen their analysis. Format as "- Question text?" for each. Make each question specific to the current analysis focus and the institution context.]

SCREEN BOUNDARY RULE (NON-NEGOTIABLE):
- Do NOT include a recommended position
- Do NOT propose a specific fee range or target price
- Do NOT use language like "you should set", "we recommend", "the right fee is", "optimal fee", "recommended fee level"
- Do NOT include a "Recommended Position" section or any equivalent
- Hamilton never recommends a fee on any screen; Analyze explains and explores
- If the user asks for a recommendation, lay out the options and what each would mean, and say the choice is theirs

FORMAT RULES:
- The reader is on a phone. The Evidence rows carry the figures; the prose around them stays short. Answer what was asked, then stop: no restating the question, no closing summary.
- Plain sentences. No markdown other than the five ## headings and "- " bullets: no **bold**, no tables, no code fences.

FIGURE RULES (a banker checks the arithmetic):
- A figure you derive shows its inputs in the same sentence: "$101 thousand per $1 billion of assets below the median, about $924 thousand a quarter at $9.2 billion in assets", never "the gap is about $924 thousand" alone.
- Use one peer count for one peer group throughout, and say whether the institution itself is in it ("fifth-lowest of 10, the institution included").
- Write $1,000 thousand or more in millions ("$1.06 million").
- Every section must agree with the others and with the Evidence rows. Before you finish, check each conclusion against the figures: a fee-income share below the peer median cannot say fee income carries more weight than at peers.
- Never call a peer's figure achievable, attainable, a target, or room to lift revenue; describe what the peer earns and leave the reading to the subscriber.

EVIDENCE FRAMING:
Apply the evidence framing rules of your base role: state the sample behind each benchmark, and say when evidence is insufficient.
- Confidence is one short clause (for example "based on 13 District 11 banks"), never a section. Internal data problems (duplicate rows, stale sources, provisional rows, unit or tier mismatches) are not findings: leave affected figures out instead of describing the problem.`;
}

export function buildMonitorModeSuffix(): string {
  return `

MONITOR MODE — ACTIVE
You are answering a question from the Monitor screen. The user is reviewing live signals and alerts about their competitive fee position.

RESPONSE RULES:
- Keep responses concise: 2–4 sentences maximum
- Frame every answer around: (1) what the signal means for the institution being researched (the user's own only when the request says so), (2) whether it needs attention now or can wait, (3) if relevant, one specific thing to check next, such as a named competitor's price, a complaint trend or the fee schedule itself
- Do NOT provide lengthy analysis — Monitor is a surveillance tool, not an analysis workspace
- Never tell the user to raise, lower or drop a fee, and never name a fee level or range to move to. The pricing decision is the user's
- If deeper analysis is needed, direct the user to the Analyze screen

TONE: Plain, factual, brief. Describe where a price sits and what question it raises; the decision stays with the user.`;
}

const REGULATION_INSTRUCTION =
  "When analyzing fees subject to regulatory scrutiny — overdraft, NSF, monthly maintenance, junk fees — always check CFPB complaint data and Fed Content for enforcement signals before concluding. Use queryRegulatoryRisk for compliance, enforcement risk, or regulatory exposure questions. Flag institutions with above-median fees AND above-average complaint rates as potential compliance risks. Reference ROA, efficiency ratio, and deposit growth when answering fee revenue questions — the financial context makes fee analysis actionable.";

const LOCAL_AND_PEER_INSTRUCTION =
  "For who competes with an institution in its county or market, or what local competitors charge, call getLocalCompetitors(institution_id) and name the competitors and their prices before any state, peer or national figure. For how an institution's fee income compares with peers, call queryFeeRevenueCorrelation(view='peers', institution_id, and the peer group's filters); use the reader's saved peer set when one is given below, and state the quarter and the peer count it returns. Use queryDistrictData and queryStateData for district and state context.";

/**
 * The reader's saved default peer set, as the written answer sees it (#1084). Its filters are
 * passed to the peer tools so "peers" means the group the reader chose. The name is the
 * reader's own text: kept to one short line.
 */
export function buildSavedPeerSetPrompt(set: Pick<ActivePeerSet, "id" | "label" | "filters"> | null): string {
  if (!set) {
    return "\n\nSAVED PEER SET: none. The reader has not saved a default peer set; name the peer group each figure uses.";
  }
  const f = set.filters;
  const name = set.label.replace(/[\r\n"]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  const parts: string[] = [];
  if (f.institutionIds?.length) parts.push(`peer_institution_ids: [${f.institutionIds.slice(0, 200).join(", ")}]`);
  const states = [...(f.states ?? []), ...(f.state_code ? [f.state_code] : [])];
  if (states.length) parts.push(`states: [${states.map((code) => `"${code}"`).join(", ")}]`);
  if (f.charter_type) parts.push(`charter_type: "${f.charter_type}"`);
  if (f.asset_tiers?.length) parts.push(`asset_tiers: [${f.asset_tiers.map((tier) => `"${tier}"`).join(", ")}]`);
  if (f.fed_districts?.length) parts.push(`fed_districts: [${f.fed_districts.join(", ")}]`);
  return `\n\nSAVED PEER SET (the reader's default, id ${set.id}): "${name}". Filters: ${parts.length ? parts.join("; ") : "none (every institution)"}. When the reader says peers, use this group: pass these filters to queryFeeRevenueCorrelation(view='peers') and call the group by its name.`;
}

/** One step of a finished answer, as the AI SDK reports it: only its tool calls are read. */
export interface AnswerStep {
  toolCalls: readonly { toolName: string; input?: unknown }[];
}

const sortedNumbers = (values: readonly unknown[] | undefined) => [...(values ?? [])].map(Number).sort((a, b) => a - b).join(",");
const sortedText = (values: readonly unknown[] | undefined) => [...(values ?? [])].map((v) => String(v).toUpperCase()).sort().join(",");

/**
 * True when a tool call in this answer used the saved peer set: the fee income peers view with
 * exactly the set's filters. Only then is the set the answer's peer baseline (#1084); a figure
 * from state, district, national or local-competitor tools never used it.
 */
export function savedPeerSetUsed(set: Pick<ActivePeerSet, "filters">, steps: readonly AnswerStep[] | undefined): boolean {
  const f = set.filters;
  const want = {
    ids: sortedNumbers(f.institutionIds),
    states: sortedText([...(f.states ?? []), ...(f.state_code ? [f.state_code] : [])]),
    charter: f.charter_type ?? "",
    tiers: sortedText(f.asset_tiers),
    districts: sortedNumbers(f.fed_districts),
  };
  return (steps ?? []).some((step) => (step.toolCalls ?? []).some((call) => {
    if (call.toolName !== "queryFeeRevenueCorrelation") return false;
    const input = (call.input ?? {}) as Record<string, unknown>;
    if (input.view !== "peers") return false;
    const list = (value: unknown) => (Array.isArray(value) ? value : undefined);
    return sortedNumbers(list(input.peer_institution_ids)) === want.ids
      && sortedText(list(input.states)) === want.states
      && String(input.charter_type ?? "") === want.charter
      && sortedText(list(input.asset_tiers)) === want.tiers
      && sortedNumbers(list(input.fed_districts)) === want.districts;
  }));
}

const EXTERNAL_INTELLIGENCE_INSTRUCTION =
  "When your analysis benefits from external research, surveys, or industry reports, query external intelligence using queryNationalData(source='external', query='relevant terms'). When citing external intelligence in your response, always include inline attribution using the citation field from the result, formatted as [Source: Name, Date]. Treat external intelligence as supplementary context — internal fee data and Call Reports remain your primary evidence. Never fabricate external source citations; only cite sources returned by the tool.";

// Toolset definitions — curated to stay under 200K token context limit
// queryNationalData (11 sources) replaces most individual data tools
const consumerTools: ToolSet = withCompactResults({ ...publicTools });
// Read-only: local competitors, fee income against peers, and district and state context (#1084).
const chatInternalTools: ToolSet = {
  getLocalCompetitors,
  queryFeeRevenueCorrelation: internalTools.queryFeeRevenueCorrelation,
  queryDistrictData: internalTools.queryDistrictData,
  queryStateData: internalTools.queryStateData,
  queryNationalData: internalTools.queryNationalData,
  queryRegulatoryRisk: internalTools.queryRegulatoryRisk,
  queryOutliers: internalTools.queryOutliers,
  searchInstitutionsByName: internalTools.searchInstitutionsByName,
  rankInstitutions: internalTools.rankInstitutions,
  listData,
  queryData,
};
const proTools: ToolSet = withCompactResults({ ...publicTools, ...chatInternalTools });
const adminTools: ToolSet = withCompactResults({
  ...publicTools,
  ...chatInternalTools,
  getCollectionStatus: internalTools.getCollectionStatus,
  getReviewQueueStats: internalTools.getReviewQueueStats,
  queryJobStatus: internalTools.queryJobStatus,
});

async function opsContext(): Promise<string> {
  try {
    const [lastCollection] = (await sql`
      SELECT completed_at FROM source_collection_runs WHERE status='completed' ORDER BY completed_at DESC LIMIT 1
    `) as { completed_at: string }[];
    const [activeRuns] = (await sql`
      SELECT COUNT(*) as cnt
        FROM agent_runs
       WHERE status IN ('running', 'queued')
         AND run_kind IN ('workflow', 'workflow_lane', 'report', 'manual_repair', 'dry_run')
    `) as { cnt: number }[];
    const parts: string[] = [];
    if (lastCollection?.completed_at) parts.push(`Last collection: ${lastCollection.completed_at}`);
    if (activeRuns.cnt > 0) parts.push(`${activeRuns.cnt} agent runs active`);
    return parts.length > 0 ? `\n\nOperational status: ${parts.join(". ")}.` : "";
  } catch {
    return "";
  }
}

const PROMPT_STATS_TTL_MS = 10 * 60 * 1000;
let promptStats: { value: Promise<Awaited<ReturnType<typeof getPublicStats>>>; expiresAt: number } | null = null;

/** The headline counts in the system prompt; they move slowly, so reuse them for 10 minutes. */
function getPromptStats(): Promise<Awaited<ReturnType<typeof getPublicStats>>> {
  const now = Date.now();
  if (!promptStats || promptStats.expiresAt <= now) {
    const value = getPublicStats();
    promptStats = { value, expiresAt: now + PROMPT_STATS_TTL_MS };
    // A failed lookup is not reused.
    value.catch(() => {
      if (promptStats?.value === value) promptStats = null;
    });
  }
  return promptStats.value;
}

export async function getHamilton(role: HamiltonRole): Promise<AgentConfig> {
  if (role !== "consumer") warmDataCatalog();
  const s = await getPromptStats();

  const dataStats = `You have access to ${s.total_observations.toLocaleString()}+ fee observations across ${s.total_categories} categories from ${s.total_institutions.toLocaleString()}+ institutions, plus: FDIC Call Reports (revenue trends), economic indicators (BLS, BEA, Federal Reserve Board), Fed Beige Book narratives, Fed speeches and research papers (Fed Content), CFPB complaint data, industry health metrics (ROA, efficiency, deposits, loans), BLS labor indicators, Census ACS demographics, NY Fed research data, OFR financial stability data, FDIC Summary of Deposits (market share), derived analytics (revenue concentration, fee dependency trends, per-institution averages), and admin-curated external intelligence (industry research, surveys, regulatory reports).`;

  switch (role) {
    case "consumer": {
      const systemPrompt = `${CONSUMER_PREFIX}\n\n${HAMILTON_SYSTEM_PROMPT}`;
      return {
        id: "hamilton",
        name: "Hamilton",
        description:
          "Ask questions about bank fees, compare institutions, and understand what fees mean for your everyday banking.",
        systemPrompt,
        tools: consumerTools,
        model: process.env.BFI_MODEL_CONSUMER || "claude-haiku-4-5-20251001",
        maxTokens: 2048,
        maxSteps: 3,
        requiresAuth: false,
        requiredRole: null,
        exampleQuestions: [
          "What is a monthly maintenance fee and how can I avoid it?",
          "Which banks have no overdraft fee?",
          "How does my bank's ATM fee compare to the national average?",
          "What fees should I watch out for when opening a checking account?",
        ],
      };
    }

    case "pro": {
      const systemPrompt = `${PRO_PREFIX}\n\n${dataStats}\n\n${REGULATION_INSTRUCTION}\n\n${LOCAL_AND_PEER_INSTRUCTION}\n\n${DATA_CATALOG_INSTRUCTION}\n\n${EXTERNAL_INTELLIGENCE_INSTRUCTION}\n\n${HAMILTON_SYSTEM_PROMPT}`;
      return {
        id: "hamilton",
        name: "Hamilton",
        description:
          "Deep analytical queries combining fee data, peer comparisons, financial metrics, and geographic analysis.",
        systemPrompt,
        tools: proTools,
        model: process.env.BFI_MODEL_PRO || getHamiltonModel(),
        // Opus 5.5 always thinks first; thinking counts toward this cap.
        maxTokens: 16000,
        maxSteps: 4,
        requiresAuth: true,
        requiredRole: "premium",
        exampleQuestions: [
          "Compare overdraft pricing for community banks in District 7 vs the national median",
          "Which asset tier has the highest fee-to-revenue dependency?",
          "Identify the top 10 institutions with the most fees above the 75th percentile",
          "How do credit union NSF fees in the Southeast compare to bank NSF fees?",
        ],
      };
    }

    case "admin": {
      const ops = await opsContext();
      const systemPrompt = `${ADMIN_PREFIX}\n\n${dataStats}\n\n${REGULATION_INSTRUCTION}\n\n${LOCAL_AND_PEER_INSTRUCTION}\n\n${DATA_CATALOG_INSTRUCTION}\n\n${EXTERNAL_INTELLIGENCE_INSTRUCTION}\n\nCRITICAL TOOL USAGE RULE: Make at most 2-3 tool calls total, then synthesize your findings into a complete response. Never call the same tool twice with the same parameters. If a tool returns empty or insufficient data, state what you found and what data was unavailable — do not retry.\n\n${HAMILTON_SYSTEM_PROMPT}${ops}`;
      return {
        id: "hamilton",
        name: "Hamilton",
        description:
          "Full analytical access with operational context, data quality signals, and pipeline management.",
        systemPrompt,
        tools: adminTools,
        model: process.env.BFI_MODEL_ADMIN || getHamiltonModel(),
        maxTokens: 16000,
        maxSteps: 4,
        requiresAuth: true,
        requiredRole: "admin",
        exampleQuestions: [
          "What percentage of institutions charge above-median fees in more than 3 categories?",
          "Show me data quality gaps — categories with low coverage or high extraction uncertainty",
          "Which Fed districts show the largest bank-vs-CU fee gaps?",
          "What jobs are currently running and when did the last crawl complete?",
        ],
      };
    }
  }
}
