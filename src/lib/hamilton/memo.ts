/**
 * Hamilton's written memo over a storyline: the model turns the deterministic storyline
 * into the prose a consulting partner would hand a client, for both readers.
 *
 * The model sees only the storyline. Every dollar figure and percentage in what it writes
 * must trace to that storyline (figure-check.ts), and no line may recommend raising,
 * lowering or dropping a fee. A memo that fails either check is retried once with the
 * failures named, then withheld; it is never shown unchecked.
 */

import { withRawProviderResponseOperation } from "@/lib/ai-response-budget";

import { getAnthropicMessagesClient, extractAnthropicText, getHamiltonModel, hasAnthropicApiKey, isProviderLimitError } from "@/lib/ai-provider";
import { HAMILTON_PAUSED_MESSAGE } from "./provider-paused";
import { trackAnthropicRequest, assertCompletedAnthropicTextResponse, incompleteProviderResponse } from "@/lib/ai-provider-usage";
import { extractFigures } from "./figure-check";
import { checkAnswerEvidence } from "./answer-gate";
import type { HamiltonEvidenceBundle } from "./evidence-contract";
import { bindNarrative, type NarrativeBinding } from "./narrative-bound";
import { HAMILTON_VOICE } from "./voice";
import type { Storyline, StorylineMemo, StorylineMemoResult } from "./workspace/storyline-types";
import type { HamiltonIdentitySnapshot } from "./account-context";

/**
 * Room for the JSON memo with headroom: at 1,800 both attempts of a live overdraft memo
 * (Oct 8) stopped mid-JSON at the cap, so neither parsed and the memo was withheld.
 */
const MAX_TOKENS = 4_000;
const REQUEST_TIMEOUT_MS = 90_000;
const MAX_ATTEMPTS = 2;
/** Institution rows a table gives the memo: the institution and the 12 the page shows first. */
const MEMO_MATRIX_ROWS = 13;
/** The Ask memo's own line in provider spend and its own budget row (#1080, #1125). */
export const MEMO_ROUTE_ID = "api.hamilton.ask.memo";

/** Model calls a memo made and their tokens, so the caller can count them in the Pro quota (#1080). */
export interface MemoUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

const MEMO_INSTRUCTIONS = `You are writing the memo that sits on top of a Hamilton storyline for one bank or credit union.
The storyline in DATA was built from verified fee schedules and regulatory filings. Write for two readers at once:
a CFO taking a pricing decision to the board, and a product or marketing manager comparing competitors.

Return only JSON, no prose around it:
{"summary": string, "board": string, "market": string, "questions": string[], "evidence_fact_ids": string[]}

- summary: two or three short sentences, at most 60 words. Open with what DATA shows that bears on the question, then the decision it raises.
  Name the institution once; after that say "it".
  When DATA cannot answer part of the question, say so once, after a finding and never as the first sentence.
- board: one paragraph of at most 110 words on money at stake, risk, regulation and what the board would need to see.
- market: one paragraph of at most 110 words on positioning, the claims competitors can make, and how the market is moving.
- questions: two or three questions the reader should be able to answer before deciding, each ending in "?".
- evidence_fact_ids: when DATA.fact_evidence exists, list the IDs of the observed/derived evidence records that support the memo's concrete findings. Use only IDs present in DATA.fact_evidence. When no fact_evidence exists, return [].

Hard rules:
- Use only figures that appear in DATA, written as DATA writes them. Never compute a new dollar figure or percentage.
- Name institutions only as DATA names them.
- DATA.identityContext is server-derived reference context. The research institution owns the storyline's figures.
  The account institution is separate. Refer to each institution by its DATA name; never call the research institution "your institution".
  Account identity alone provides no evidence about its fees or financials. Compare it only when the storyline states sourced account-institution figures.
- Never recommend raising, lowering, cutting, dropping or removing a fee, and never say what the bank should do. Lay out what each path means.
- Where DATA says a figure is missing, say it is missing; never fill it in.
- An exhibit with "own": null means no price for the bank's own fee is in the index. Say it as DATA's claims word it
  (for example "its schedule lists no such fee", or "not in the index yet"). It never means the bank charges no fee:
  never call it a no-fee position, a $0 fee, or a claim the bank can make.
- A fee changed only where DATA lists the change (a change_timeline exhibit or a dated change line). Never infer a
  price change from anything else. When DATA lists none, say the change history is still building.
- Every sentence names what it is about. Never open a sentence with "That one", "This one", "Those" or "These"
  pointing back at an earlier sentence; name the institution or fee again.
- Plain language, short sentences, no jargon, no internal system names. DATA is this prompt's name for the payload:
  never write the word in the memo; say "the filings", "the index" or "the schedule" instead.`;

/** "DATA does not show" read on screen as a system leaking through (Space Coast review, 2026-10-15). */
function withoutPayloadName(text: string): string {
  return text.replace(/(^|[.!?]\s+)(?:[Tt]he\s+)?DATA\b/g, "$1The data").replace(/\b(?:the\s+)?DATA\b/g, "the data");
}

/** Phrases that treat a fee missing from the index as a fee the bank does not charge. */
const NO_FEE_CLAIM = /\bno-[a-z]+ (?:position|claim|policy|stance)\b|\bno-fee\b|\bschedule shows no\b|\bcharges? no [a-z/ ]{0,30}fee\b/i;
/** A sentence that points back instead of naming its subject: "That one is Bank of America at $10." (#2036) */
const POINTING_OPENER = /(?:^|[.!?]["')\]]*\s+|;\s+)((?:[Tt]hat|[Tt]his) ones?\b(?!-)|(?:Those|These) (?:are|were|charge|include|sit)\b)[^.!?\n]{0,40}/m;
/** An opening sentence that leads with what the data lacks. */
const LIMIT_OPENING = /^(?:the data|DATA|hamilton|we|this (?:data|index))\b[^.]{0,40}\b(?:cannot|can't|does not|doesn't|has no|holds no|lacks)\b/i;

function firstSentence(text: string): string {
  return text.trim().split(/(?<=[.!?])\s+/)[0] ?? "";
}

/** True when the storyline has no amount for the bank's own fee. */
function ownFeeMissing(payload: unknown): boolean {
  const storyline = (payload as { storyline?: Storyline } | null)?.storyline;
  return (storyline?.exhibits ?? []).some((e) => e.exhibit.kind === "fee_position" && e.exhibit.own === null);
}

/** Everything the model may draw on: the storyline, plus every figure its sentences state. */
/** Rows folded under "Show N more" stay on the page, not in the memo's prompt (#2036). */
function memoStoryline(storyline: Storyline): Storyline {
  return {
    ...storyline,
    exhibits: storyline.exhibits.map((e) => {
      const x = e.exhibit;
      if (x.kind === "competitor_range" && x.rest) {
        const kept = { ...x };
        delete kept.rest;
        return { ...e, exhibit: kept };
      }
      if (x.kind === "structure_matrix" && x.rows.some((r) => r.own) && x.rows.length > MEMO_MATRIX_ROWS) {
        return { ...e, exhibit: { ...x, rows: [...x.rows.filter((r) => r.own), ...x.rows.filter((r) => !r.own).slice(0, MEMO_MATRIX_ROWS - 1)] } };
      }
      return e;
    }),
  };
}

export function memoPayload(
  storyline: Storyline,
  factEvidence?: HamiltonEvidenceBundle | null,
  identityContext?: HamiltonIdentitySnapshot,
): Record<string, unknown> {
  storyline = memoStoryline(storyline);
  const text = JSON.stringify(storyline);
  const figures = extractFigures(text);
  return {
    storyline,
    ...(factEvidence ? { fact_evidence: factEvidence } : {}),
    ...(identityContext ? { identityContext } : {}),
    stated_amounts: [...new Set(figures.filter((f) => f.kind === "usd").map((f) => f.value))].map((amount) => ({ amount })),
    stated_rates: [...new Set(figures.filter((f) => f.kind === "pct").map((f) => f.value))].map((rate) => ({ rate })),
    // Exhibit numbers whose keys do not name their unit, restated under keys that do.
    exhibit_amounts: storyline.exhibits.flatMap((e): Record<string, number>[] => {
      const x = e.exhibit;
      switch (x.kind) {
        case "change_timeline":
          return x.events.flatMap((ev) => [ev.from, ev.to].filter((v): v is number => v !== null).map((amount) => ({ amount })));
        case "money_at_stake":
          return x.rows.flatMap((r) => [{ income: r.low }, { income: r.high }]);
        case "segment_table":
          return x.members.flatMap((m) => {
            const out: Record<string, number>[] = [{ amount: m.amount }];
            if (m.totalAssets !== null && m.totalAssets !== undefined) out.push({ assets: m.totalAssets * 1000 });
            if (m.dailyCap !== null && m.dailyCap !== undefined) out.push({ cap: m.dailyCap });
            return out;
          });
        default:
          return [];
      }
    }),
  };
}

interface MemoDraft {
  summary: string;
  board: string;
  market: string;
  questions: string[];
  evidenceFactIds?: string[];
}

export function parseMemo(raw: string): MemoDraft | null {
  const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  try {
    const parsed = JSON.parse(json) as Partial<MemoDraft>;
    const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const evidenceFactIds = Array.isArray((parsed as Partial<MemoDraft> & { evidence_fact_ids?: unknown }).evidence_fact_ids)
      ? [...new Set((parsed as { evidence_fact_ids: unknown[] }).evidence_fact_ids.map(str).filter(Boolean))].slice(0, 50)
      : undefined;
    const prose = (v: unknown) => withoutPayloadName(str(v));
    const draft = {
      summary: prose(parsed.summary),
      board: prose(parsed.board),
      market: prose(parsed.market),
      questions: Array.isArray(parsed.questions) ? parsed.questions.map(prose).filter((q) => q.endsWith("?")).slice(0, 3) : [],
      ...(evidenceFactIds ? { evidenceFactIds } : {}),
    };
    return draft.summary && draft.board && draft.market ? draft : null;
  } catch {
    return null;
  }
}

/** Why a memo sentence was left out, in words the model can act on. */
const OMIT_FEEDBACK: Record<string, string> = {
  wrong_institution: "states another institution's figure as this one's",
  gap_as_fee: "states a gap between two fees as a fee",
  median_as_fee: "states the peer median as an institution's own fee; call it the peer median",
  wrong_direction: "states a gap or change in the wrong direction",
  wrong_period: "states a figure for the wrong year",
  wrong_unit: "states a rate fee as a dollar amount",
  conflicting_sources: "picks one of two sources that disagree; say that they disagree instead",
  instruction_text: "repeats instruction-like text from a source",
  wrong_basis: "states a year-to-date filing total as a quarter, or a quarter as year to date; say which the figure is",
  account_as_subject: "states another institution's filed figure as the reader's own; name the institution it belongs to",
};

/**
 * The memo's sentence binding (#981, H06-T06): with record evidence in DATA, each sentence's figures
 * must bind to a validated record. A sentence the records contradict is a problem; a figure the records
 * do not hold is kept as Hamilton's reading and listed in the binding. Advice is the shared gate's.
 */
export function memoBinding(draft: MemoDraft, payload: unknown, question?: string): NarrativeBinding | null {
  const evidence = (payload as { fact_evidence?: HamiltonEvidenceBundle } | null)?.fact_evidence;
  if (!evidence) return null;
  const identity = (payload as { identityContext?: HamiltonIdentitySnapshot } | null)?.identityContext;
  const names = new Map<number, string>();
  if (identity?.researchInstitutionId && identity.researchInstitutionName) names.set(identity.researchInstitutionId, identity.researchInstitutionName);
  return bindNarrative({ text: [draft.summary, draft.board, draft.market].join("\n"), evidence, names, question });
}

/** What is wrong with a draft: untraced figures, advice, internal names. Empty when it passes. */
export function memoProblems(draft: MemoDraft, payload: unknown, question?: string): { problems: string[]; figureCheck: { checked: number; unmatched: string[] }; binding: NarrativeBinding | null } {
  const all = [draft.summary, draft.board, draft.market, ...draft.questions].join("\n");
  // The shared gate every paid answer passes (answer-gate.ts); the checks below are the memo's own.
  const shared = checkAnswerEvidence(all, payload);
  const figureCheck = shared.figureCheck;
  const problems: string[] = [...shared.problems];
  const evidence = (payload as { fact_evidence?: HamiltonEvidenceBundle } | null)?.fact_evidence;
  if (evidence) {
    const allowed = new Set([...evidence.facts, ...evidence.derivations].map((fact) => fact.id));
    const referenced = draft.evidenceFactIds ?? [];
    if (allowed.size > 0 && referenced.length === 0) {
      problems.push("The memo did not identify any supporting evidence_fact_ids from DATA.fact_evidence.");
    }
    const unknown = referenced.filter((id) => !allowed.has(id));
    if (unknown.length > 0) {
      problems.push(`These evidence_fact_ids are not in DATA.fact_evidence: ${unknown.join(", ")}.`);
    }
  }
  const binding = memoBinding(draft, payload, question);
  for (const omitted of binding?.omitted ?? []) {
    const why = OMIT_FEEDBACK[omitted.reason];
    if (why) problems.push(`This sentence ${why}: "${omitted.text}"`);
  }
  for (const line of binding?.limitations ?? []) if (line.startsWith("Sources disagree")) problems.push(`State this instead of either figure: ${line}`);
  const noFee = ownFeeMissing(payload) ? all.match(NO_FEE_CLAIM) : null;
  if (noFee) problems.push(`"${noFee[0]}" reads as if the bank charges no fee. No price for its fee is in the index; say it as DATA's claims word it.`);
  const pointing = all.match(POINTING_OPENER);
  if (pointing) problems.push(`"${pointing[0].replace(/^[.!?;"')\]]*\s*/, "")}" points back at an earlier sentence. Name the institution or fee instead.`);
  const opening = firstSentence(draft.summary).match(LIMIT_OPENING);
  if (opening) problems.push(`The summary opens with a limit ("${opening[0]}"). Open with what DATA shows; state the limit after.`);
  const identity = (payload as { identityContext?: HamiltonIdentitySnapshot } | null)?.identityContext;
  if (identity?.researchInstitutionId) {
    const ambiguous = all.match(/\b(?:your|our|my)\s+(?:institution|bank|credit union|fee\b|fees\b|schedule|filing|income|market|customers?\b|deposit|shares|assets|revenue|charter|regulator|prices?|rate\b|published)/i);
    if (ambiguous) problems.push(`Ambiguous institution reference "${ambiguous[0]}". Name the research institution from DATA; the account institution is separate.`);
    const home = identity.accountInstitutionName;
    const storyline = (payload as { storyline?: Storyline }).storyline;
    const homeFacts = storyline ? [...storyline.situation, ...storyline.complication, ...storyline.lenses.finance, ...storyline.lenses.market].some((fact) => home && fact.text.includes(home)) : false;
    if (home && identity.accountInstitutionId !== identity.researchInstitutionId && all.includes(home) && !homeFacts) {
      problems.push(`The memo references ${home} without account-institution evidence in the storyline. Account identity alone supplies no fee or financial facts.`);
    }
  }
  return { problems, figureCheck, binding };
}

export interface MemoClient {
  create(input: { system: string; user: string; model: string }): Promise<string>;
}

/** Who a memo's model call is for in provider usage: the answer eval tags its own (#1079). */
export interface MemoTracking {
  operation: string;
  subjectKey?: string;
  agentRunId?: number;
}

function anthropicMemoClient(institutionId: number | null, usage?: MemoUsage, tracking?: MemoTracking): MemoClient {
  return {
    async create({ system, user, model }) {
      const response = await trackAnthropicRequest(
        {
          model,
          agent: "hamilton",
          operation: tracking?.operation ?? "storyline_memo",
          routeId: MEMO_ROUTE_ID,
          ...(tracking?.subjectKey ? { subjectKey: tracking.subjectKey } : {}),
          ...(tracking?.agentRunId ? { agentRunId: tracking.agentRunId } : {}),
          metadata: { institution_id: institutionId },
        },
        () => withRawProviderResponseOperation(REQUEST_TIMEOUT_MS, (scope) => {
          const client = getAnthropicMessagesClient("Hamilton storyline memo", "hamilton", scope);
          return (attempt) => client.messages.create(
            { model, max_tokens: MAX_TOKENS, system, messages: [{ role: "user", content: user }] },
            { ...attempt, timeout: REQUEST_TIMEOUT_MS },
          );
        }).then((response) => assertCompletedAnthropicTextResponse(response)),
      );
      if (usage) {
        usage.inputTokens += response.usage?.input_tokens ?? 0;
        usage.outputTokens += response.usage?.output_tokens ?? 0;
      }
      return extractAnthropicText(response);
    },
  };
}

export async function writeStorylineMemo(
  storyline: Storyline,
  question: string,
  options: {
    institutionId?: number | null;
    identityContext?: HamiltonIdentitySnapshot;
    client?: MemoClient;
    model?: string;
    now?: Date;
    factEvidence?: HamiltonEvidenceBundle | null;
    /** Filled with every model call the memo makes, retries included. */
    usage?: MemoUsage;
    tracking?: MemoTracking;
  } = {},
): Promise<StorylineMemoResult> {
  if (!options.client && !hasAnthropicApiKey("hamilton")) {
    return { status: "unavailable", reason: "Hamilton's writer is not configured." };
  }
  const model = options.model ?? getHamiltonModel();
  const payload = memoPayload(storyline, options.factEvidence, options.identityContext);
  let client: MemoClient;
  try {
    client = options.client ?? anthropicMemoClient(options.institutionId ?? null, options.usage, options.tracking);
  } catch (error) {
    return { status: "unavailable", reason: error instanceof Error ? error.message : String(error) };
  }
  const system = `${HAMILTON_VOICE.systemPrompt}\n\n${MEMO_INSTRUCTIONS}`;
  let feedback = "";
  let lastProblems: string[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const user = `QUESTION: ${question}\n\nDATA:\n${JSON.stringify(payload)}${feedback}`;
    let raw: string;
    try {
      raw = await client.create({ system, user, model });
      // Counted once the call returns: a call the budget refused never reached the model.
      if (options.usage) options.usage.calls += 1;
    } catch (error) {
      const incomplete = incompleteProviderResponse(error);
      if (incomplete) {
        // A known incurred call still counts toward the memo quota when no answer is saved.
        if (options.usage && incomplete.observedUsage) {
          options.usage.calls += 1;
          options.usage.inputTokens += incomplete.observedUsage.inputTokens ?? 0;
          options.usage.outputTokens += incomplete.observedUsage.outputTokens ?? 0;
        }
        return { status: "unavailable", reason: incomplete.message };
      }
      if (isProviderLimitError(error)) return { status: "unavailable", reason: HAMILTON_PAUSED_MESSAGE };
      const message = error instanceof Error ? error.message : String(error);
      return { status: "unavailable", reason: /budget|usage limit/i.test(message) ? "Hamilton's writing budget for today is used up." : "Hamilton's writer could not be reached." };
    }
    const draft = parseMemo(raw);
    if (!draft) {
      lastProblems = ["The reply was not a complete JSON object."];
      feedback = "\n\nYour last reply was not the complete JSON object asked for. Return only the JSON object, within the word limits.";
      continue;
    }
    const { problems, figureCheck, binding } = memoProblems(draft, payload, question);
    if (problems.length === 0) {
      const memo: StorylineMemo = {
        ...draft,
        model,
        generatedAt: (options.now ?? new Date()).toISOString(),
        figureCheck,
        ...(binding ? { narrativeBinding: binding } : {}),
        ...(options.identityContext ? { identityContext: options.identityContext } : {}),
      };
      return { status: "written", memo };
    }
    lastProblems = problems;
    feedback = `\n\nYour last draft had these problems. Fix them and return the JSON again:\n- ${problems.join("\n- ")}`;
  }
  return {
    status: "withheld",
    reason: "The written memo did not pass Hamilton's figure and advice checks, so only the storyline is shown.",
    problems: lastProblems,
  };
}
