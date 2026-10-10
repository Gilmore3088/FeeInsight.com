/**
 * Hamilton's written memo over a storyline: the model turns the deterministic storyline
 * into the prose a consulting partner would hand a client, for both readers.
 *
 * The model sees only the storyline. Every dollar figure and percentage in what it writes
 * must trace to that storyline (figure-check.ts), and no line may recommend raising,
 * lowering or dropping a fee. A memo that fails either check is retried once with the
 * failures named, then withheld; it is never shown unchecked.
 */

import { getAnthropicMessagesClient, extractAnthropicText, getHamiltonModel, hasAnthropicApiKey, isProviderLimitError } from "@/lib/ai-provider";
import { HAMILTON_PAUSED_MESSAGE } from "./provider-paused";
import { trackAnthropicRequest } from "@/lib/ai-provider-usage";
import { checkNarrativeFigures, extractFigures } from "./figure-check";
import type { HamiltonEvidenceBundle } from "./evidence-contract";
import { HAMILTON_VOICE } from "./voice";
import { PIPELINE_TERMS, RECOMMENDATION } from "./workspace/four-roles";
import type { Storyline, StorylineMemo, StorylineMemoResult } from "./workspace/storyline-types";

/**
 * Room for the JSON memo with headroom: at 1,800 both attempts of a live overdraft memo
 * (Oct 8) stopped mid-JSON at the cap, so neither parsed and the memo was withheld.
 */
const MAX_TOKENS = 4_000;
const REQUEST_TIMEOUT_MS = 90_000;
const MAX_ATTEMPTS = 2;
/** The Ask memo spends against the Hamilton chat route's budget. */
export const MEMO_ROUTE_ID = "api.hamilton.chat";

const MEMO_INSTRUCTIONS = `You are writing the memo that sits on top of a Hamilton storyline for one bank or credit union.
The storyline in DATA was built from verified fee schedules and regulatory filings. Write for two readers at once:
a CFO taking a pricing decision to the board, and a product or marketing manager comparing competitors.

Return only JSON, no prose around it:
{"summary": string, "board": string, "market": string, "questions": string[], "evidence_fact_ids": string[]}

- summary: three or four sentences. Open with what DATA shows that bears on the question, then why it holds, then the decision it raises.
  When DATA cannot answer part of the question, say so once, after a finding and never as the first sentence.
- board: one paragraph of at most 110 words on money at stake, risk, regulation and what the board would need to see.
- market: one paragraph of at most 110 words on positioning, the claims competitors can make, and how the market is moving.
- questions: two or three questions the reader should be able to answer before deciding, each ending in "?".
- evidence_fact_ids: when DATA.fact_evidence exists, list the IDs of the observed/derived evidence records that support the memo's concrete findings. Use only IDs present in DATA.fact_evidence. When no fact_evidence exists, return [].

Hard rules:
- Use only figures that appear in DATA, written as DATA writes them. Never compute a new dollar figure or percentage.
- Name institutions only as DATA names them.
- Never recommend raising, lowering, cutting, dropping or removing a fee, and never say what the bank should do. Lay out what each path means.
- Where DATA says a figure is missing, say it is missing; never fill it in.
- An exhibit with "own": null means the bank's own fee is not in the index yet. It never means the bank charges no fee:
  never call it a no-fee position, a $0 fee, or a claim the bank can make.
- A fee changed only where DATA lists the change (a change_timeline exhibit or a dated change line). Never infer a
  price change from anything else. When DATA lists none, say the change history is still building.
- Plain language, short sentences, no jargon, no internal system names.`;

/** Price position is "lower" or "higher", never "cheapest". */
const CHEAP_WORDING = /\bcheap(?:er|est)?\b/i;
/** Phrases that treat a fee missing from the index as a fee the bank does not charge. */
const NO_FEE_CLAIM = /\bno-[a-z]+ (?:position|claim|policy|stance)\b|\bno-fee\b|\bschedule shows no\b|\bcharges? no [a-z/ ]{0,30}fee\b/i;
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
export function memoPayload(storyline: Storyline, factEvidence?: HamiltonEvidenceBundle | null): Record<string, unknown> {
  const text = JSON.stringify(storyline);
  const figures = extractFigures(text);
  return {
    storyline,
    ...(factEvidence ? { fact_evidence: factEvidence } : {}),
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
    const draft = {
      summary: str(parsed.summary),
      board: str(parsed.board),
      market: str(parsed.market),
      questions: Array.isArray(parsed.questions) ? parsed.questions.map(str).filter((q) => q.endsWith("?")).slice(0, 3) : [],
      ...(evidenceFactIds ? { evidenceFactIds } : {}),
    };
    return draft.summary && draft.board && draft.market ? draft : null;
  } catch {
    return null;
  }
}

/** What is wrong with a draft: untraced figures, advice, internal names. Empty when it passes. */
export function memoProblems(draft: MemoDraft, payload: unknown): { problems: string[]; figureCheck: { checked: number; unmatched: string[] } } {
  const all = [draft.summary, draft.board, draft.market, ...draft.questions].join("\n");
  const figureCheck = checkNarrativeFigures(all, payload);
  const problems: string[] = [];
  if (figureCheck.unmatched.length > 0) problems.push(`These figures are not in DATA: ${figureCheck.unmatched.join(", ")}.`);
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
  const advice = all.match(RECOMMENDATION);
  if (advice) problems.push(`This reads as advice: "${advice[0]}". Lay out the paths without choosing.`);
  const internal = all.match(PIPELINE_TERMS);
  if (internal) problems.push(`Internal name in the text: "${internal[0]}".`);
  const noFee = ownFeeMissing(payload) ? all.match(NO_FEE_CLAIM) : null;
  if (noFee) problems.push(`"${noFee[0]}" reads as if the bank charges no fee. Its fee is not in the index yet; say that instead.`);
  const cheap = all.match(CHEAP_WORDING);
  if (cheap) problems.push(`"${cheap[0]}" is not house wording. Say "lower" or "higher" price.`);
  const opening = firstSentence(draft.summary).match(LIMIT_OPENING);
  if (opening) problems.push(`The summary opens with a limit ("${opening[0]}"). Open with what DATA shows; state the limit after.`);
  return { problems, figureCheck };
}

export interface MemoClient {
  create(input: { system: string; user: string; model: string }): Promise<string>;
}

function anthropicMemoClient(institutionId: number | null): MemoClient {
  const client = getAnthropicMessagesClient("Hamilton storyline memo", "hamilton");
  return {
    async create({ system, user, model }) {
      const response = await trackAnthropicRequest(
        { model, agent: "hamilton", operation: "storyline_memo", routeId: MEMO_ROUTE_ID, metadata: { institution_id: institutionId } },
        () =>
          client.messages.create(
            { model, max_tokens: MAX_TOKENS, system, messages: [{ role: "user", content: user }] },
            { timeout: REQUEST_TIMEOUT_MS },
          ),
      );
      return extractAnthropicText(response);
    },
  };
}

export async function writeStorylineMemo(
  storyline: Storyline,
  question: string,
  options: { institutionId?: number | null; client?: MemoClient; model?: string; now?: Date; factEvidence?: HamiltonEvidenceBundle | null } = {},
): Promise<StorylineMemoResult> {
  if (!options.client && !hasAnthropicApiKey("hamilton")) {
    return { status: "unavailable", reason: "Hamilton's writer is not configured." };
  }
  const model = options.model ?? getHamiltonModel();
  const payload = memoPayload(storyline, options.factEvidence);
  let client: MemoClient;
  try {
    client = options.client ?? anthropicMemoClient(options.institutionId ?? null);
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
    } catch (error) {
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
    const { problems, figureCheck } = memoProblems(draft, payload);
    if (problems.length === 0) {
      const memo: StorylineMemo = { ...draft, model, generatedAt: (options.now ?? new Date()).toISOString(), figureCheck };
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
