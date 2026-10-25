/**
 * The Ask bar: one question in, one AskResponse out. Pure and deterministic; the route
 * (api/hamilton/ask) loads the research, the bank's memory and the decision's earlier
 * scenarios, then calls buildAskResponse.
 *
 * What comes back:
 * - research: the four-roles answer for the fee (headline, claims, drivers, exhibit).
 * - scenario: the prices the question names, modeled at the best evidence on hand.
 * - opinion: only on an explicit ask, only with an objective, naming that objective.
 * - clarifying_question: the one thing Hamilton needs before it can answer.
 *
 * Hamilton never picks a price on its own; every tested price is the reader's.
 */

import { subjectPossessive, subjectName } from "./subject";
import { formatDollarsInWords, formatFeeAmount } from "@/lib/format";
import { FEE_PHRASES } from "./fee-phrases";
import { buildFeeAnswer, type ExhibitFocus } from "./answer";
import { feeItem, proseFeeName } from "./names";
import { annualItemsQuestion, buildScenario, countedPeerAmounts, MIN_PEERS_FOR_POSITION, placeAmong, waiverRateQuestion } from "./scenario";
import { parseSegment, SEGMENT_AMOUNTS } from "./segment";
import { rateVolumeQuestion } from "./rates";
import { asksAboutStructure } from "./storyline";
import { asksWholeSchedule } from "./schedule";
import { asksIncome, asksIncomeWhy } from "./why";
import type {
  AskObjective,
  AskSegment,
  AskResponse,
  ClarifyingQuestion,
  ClientFactRef,
  FeeResearch,
  HamiltonOpinion,
  InstitutionFeeFacts,
  MemoryFact,
  Scenario,
} from "./types";

/** Most prices one question can test. */
export const MAX_TESTED_PRICES = 5;
/** Highest fee amount a question can test. */
const MAX_PRICE = 10_000;

/** Fee names and synonyms, longest first (fee-phrases.ts, shared with the output gate). */
const PHRASES = FEE_PHRASES;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The fee a question is about, by the longest name or synonym it contains. */
export function matchFeeCategory(question: string): string | null {
  const text = question.toLowerCase().replace(/[’`]/g, "'");
  for (const { category, phrase } of PHRASES) {
    if (new RegExp(`(^|[^a-z])${escapeRe(phrase)}($|[^a-z])`).test(text)) return category;
  }
  return null;
}

// "What should I know about ..." asks for facts, not a decision.
const OPINION = /what would you do|what (?:do|would) you (recommend|suggest|advise)|\bshould (we|i)\b(?! (know|be aware|understand|note|keep in mind|watch))|your (opinion|recommendation|advice|view)|which (price|option|scenario|one) (is|was|would be) best|best (price|option)/i;
const COMPETITORS = /competitor|competition|compet(e|ing)|local|nearby|down the street|who charges|in (our|my) market/i;
const TREND = /trend|over time|history|historical|income|revenue|earn/i;
const ELIMINATE = /\b(eliminat\w*|remov\w*|get rid of|scrap\w*|drop(ping)? (it|the fee)|go to (zero|\$0)|no fee|free)\b/i;

export interface AskIntent {
  feeCategory: string | null;
  /** The slice of the market the question names ("$10B and up"), or null. */
  segment: AskSegment | null;
  /** Prices the question names, in the order given (0 when it asks about eliminating the fee). */
  tested: number[];
  wantsOpinion: boolean;
  focus: ExhibitFocus;
  /** The question is about caps, transfers or how the fee is charged, not only its price. */
  structure?: boolean;
  /** The question asks about rules, regulators or compliance. */
  regulation?: boolean;
  /** The question asks for a list ("list peers' overdraft fees"), so the answer is the named rows (#2033). */
  list?: boolean;
}

/** Dollar amounts a question names: "$25", "$32.50", "25 dollars". */
export function pricesIn(question: string): number[] {
  const out: number[] = [];
  const re = /\$\s?(\d{1,5}(?:\.\d{1,2})?)\b|\b(\d{1,5}(?:\.\d{1,2})?)\s?(?:dollars|bucks)\b/gi;
  for (const m of question.matchAll(re)) {
    const value = Number(m[1] ?? m[2]);
    if (Number.isFinite(value) && value >= 0 && value <= MAX_PRICE && !out.includes(value)) out.push(value);
  }
  if (ELIMINATE.test(question) && !out.includes(0)) out.push(0);
  return out.slice(0, MAX_TESTED_PRICES);
}

/**
 * A request for the rows themselves (#2033): "list peers' overdraft fees", "show me every peer's
 * NSF fee", "show me peers' overdraft fees", "which of our peers charge a wire fee", "what are our
 * peers' NSF fees", "what do our competitors charge". A comparison ("compare to all of our
 * peers") or a change ("which banks have eliminated NSF fees") is not a list.
 */
const LIST_QUESTION = new RegExp(
  [
    String.raw`\blist(?:s|ing)?\b(?! price)`,
    String.raw`\bshow (?:me )?(?:all|every|each)\b`,
    String.raw`\bshow (?:me )?(?:our |my |the )?(?:peers|competitors)['’]`,
    String.raw`\bwhich (?:of (?:our|my|the) )?(?:banks|credit unions|institutions|peers|competitors) (?:charge|publish|still charge)\b`,
    String.raw`\bname (?:the|our|my|all|every) (?:peers|competitors)\b`,
    String.raw`\b(?:each|every) (?:peer|competitor)['’]s\b`,
    String.raw`\ball (?:of )?(?:our |my |the )?(?:peers|competitors)['’](?:\s|$)`,
    String.raw`\bwhat (?:are|do|does) (?:our |my |the )?(?:peers|competitors)(?:['’]s?\s| (?:charge|charging)\b)`,
  ].join("|"),
  "i",
);

/** "What regulation applies", "regulatory risk", "is this compliant", "what does the CFPB say". */
const REGULATION_QUESTION = /\b(regulat\w*|rules?|laws?|legal|complian\w*|CFPB|OCC|FDIC|NCUA|examin\w*|Reg [A-Z]{1,2})\b/i;

/**
 * A question about something other than one fee: every fee, or fee income and fee share. The fee
 * an open decision carries is never put in such a question's place (#1077): "which credit unions
 * run a fee share below 4%?" asked after an overdraft question is about fee share, not overdraft.
 */
export function asksOtherSubject(question: string): boolean {
  return asksWholeSchedule(question) || asksIncome(question) || asksIncomeWhy(question);
}

/**
 * Words that point back at the fee already on screen: "it", "that", "this fee", "ours", "the same",
 * "what about", "why". "This week" or "that year" point at a time, not the fee.
 */
const REFERS_BACK = /\b(?:it|its|ours|same|what about|how about|and for|why|(?:this|that|these|those)(?! (?:week|month|year|quarter|morning|afternoon|evening)\b))\b/i;

/**
 * Words that can only point at the fee on screen ("it", "that", "the same"), so they hold even in a
 * question about income: "how would that affect our revenue?" is still about the fee. "Ours", "this"
 * and asking what to do don't: "what should we do about our falling fee income?" is about income.
 */
const POINTS_AT_FEE = /\b(?:it|its|same|that(?! (?:week|month|year|quarter|morning|afternoon|evening)\b))\b/i;

/**
 * The fee a question is about: the one it names, else the open decision's fee (`carriedCategory`)
 * only for a follow-up on that fee, one that tests a price, asks what to do, or points back at it
 * ("what if we charged $30?", "should we raise it?", "how does that compare nationally?"). Any other
 * question that names no fee keeps none (#1077): "talk to me about institutions above $10B" or
 * "which credit unions run a fee share below 4%?" is never answered with the open decision's fee.
 */
function questionFee(question: string, carriedCategory: string | null, tested: number[]): string | null {
  const named = matchFeeCategory(question);
  if (named) return named;
  if (!carriedCategory) return null;
  if (tested.length > 0) return carriedCategory;
  if (asksWholeSchedule(question)) return null;
  // A question about income keeps the fee only when it points at it ("how would that affect revenue?").
  if (asksOtherSubject(question)) return POINTS_AT_FEE.test(question) ? carriedCategory : null;
  return OPINION.test(question) || REFERS_BACK.test(question) ? carriedCategory : null;
}

export function parseAsk(question: string, carriedCategory: string | null = null): AskIntent {
  const segment = parseSegment(question);
  // Asset sizes ("$10B") are not prices.
  const tested = segment ? pricesIn(question.replace(SEGMENT_AMOUNTS, " ")) : pricesIn(question);
  return {
    feeCategory: questionFee(question, carriedCategory, tested),
    segment,
    tested,
    wantsOpinion: OPINION.test(question),
    focus: segment || COMPETITORS.test(question) ? "competitors" : TREND.test(question) ? "trend" : "position",
    structure: asksAboutStructure(question),
    regulation: REGULATION_QUESTION.test(question),
    // A question that also asks what to do ("which banks charge more, and should we raise ours?")
    // gets the decision, and one about every fee ("list all our fees vs peers") the schedule overview.
    list: LIST_QUESTION.test(question) && !OPINION.test(question) && (matchFeeCategory(question) !== null || !asksWholeSchedule(question)),
  };
}

/**
 * Every fee a question names, by name or synonym ("both NSF and monthly maintenance" names two).
 * The answer eval uses it to tell an answer about a fee the question asked for from one about a
 * fee put in its place (#1077). A question that names no fee is never answered for a fee chosen
 * for it: it gets the whole-schedule or income answer when it asks for one, otherwise Hamilton
 * asks which fee.
 */
export function feeCategoriesIn(question: string): string[] {
  const text = question.toLowerCase().replace(/[’`]/g, "'");
  const out = new Set<string>();
  for (const { category, phrase } of PHRASES) {
    if (new RegExp(`(^|[^a-z])${escapeRe(phrase)}($|[^a-z])`).test(text)) out.add(category);
  }
  return [...out];
}

// ─── Questions Hamilton asks back ────────────────────────────────────────────

export const OBJECTIVE_LABELS: Record<AskObjective, string> = {
  revenue: "revenue",
  customer_treatment: "customer treatment",
  competitive_position: "competitive position",
};

export function objectiveQuestion(): ClarifyingQuestion {
  return {
    prompt: "Which objective should I weigh the options against: revenue, customer treatment or competitive position?",
    inputKind: "text",
    fieldKey: "decision.objective",
  };
}

export function feeQuestion(): ClarifyingQuestion {
  return { prompt: "Which fee do you want to look at?", inputKind: "text", fieldKey: "ask.fee_category" };
}

/** What Hamilton answers from the data it holds, in the words every out-of-scope answer uses. */
export const ANSWERABLE =
  "Hamilton answers from published fee schedules and filed fee income: how one fee compares with peers or a market segment, what a new price would do to fee income, where every fee sits against its peer median, and how fee income compares with peers.";

/**
 * The answer to a question Hamilton cannot answer from the data it holds (#1077). It says so
 * plainly and says what it can answer; it never answers a different subject in the question's
 * place, and never asks "which fee?" of a question about something else. The question it carries
 * keeps the page's one-tap fee charts; its prompt offers them, it does not ask which fee was meant.
 */
export function cannotAnswer(question: string, segment: AskSegment | null): AskResponse {
  const lead =
    asksIncome(question) || asksIncomeWhy(question)
      ? "Hamilton can't answer that from the data it holds: it has no filed fee income to compare for this institution and its peers."
      : asksWholeSchedule(question)
        ? "Hamilton can't answer that from the data it holds: it could not place this institution's published fees against its peers."
        : segment
          ? `Hamilton can't answer that from the data it holds. It read a question about ${segment.label}, but not one about a fee or fee income.`
          : "Hamilton can't answer that from the data it holds.";
  return {
    kind: "clarifying_question",
    shortAnswer: `${lead} ${ANSWERABLE}`,
    pageChange: { screen: "none" },
    question: { prompt: "Pick one fee to see how it compares with peers.", inputKind: "text", fieldKey: "ask.fee_category" },
  };
}

export function testedPricesQuestion(feeCategory: string): ClarifyingQuestion {
  return {
    prompt: `Which ${proseFeeName(feeCategory)} prices should I compare?`,
    inputKind: "text",
    fieldKey: `fee.${feeCategory}.tested_prices`,
  };
}

function currentAmountQuestion(feeCategory: string, subject?: { subjectName?: string }): ClarifyingQuestion {
  return {
    prompt: `${subject?.subjectName ? `What does ${subject.subjectName}` : "What do you"} charge for one ${feeItem(proseFeeName(feeCategory))} today?`,
    inputKind: "number",
    fieldKey: `fee.${feeCategory}.current_amount`,
  };
}

/** Asks again when an answer could not be read for its key. */
export function clarifyAgain(fieldKey: string, research?: { subjectName?: string }): AskResponse {
  const fee = fieldKey.match(/^fee\.([a-z0-9_]+)\./)?.[1] ?? null;
  const question: ClarifyingQuestion =
    fieldKey === "decision.objective"
      ? objectiveQuestion()
      : fee && fieldKey.endsWith(".current_amount")
        ? currentAmountQuestion(fee, research)
        : fee && fieldKey.endsWith(".annual_items")
          ? annualItemsQuestion(fee, research?.subjectName)
          : fee && fieldKey.endsWith(".waiver_rate")
            ? waiverRateQuestion(fee, research?.subjectName)
            : fee && fieldKey.endsWith(".annual_volume")
              ? rateVolumeQuestion(fee)
              : feeQuestion();
  return { kind: "clarifying_question", shortAnswer: `Hamilton could not read that as an answer. ${question.prompt}`, pageChange: { screen: "none" }, question };
}

/** Reads "revenue", "customer treatment", "competitive position" (or close) from an answer. */
export function parseObjective(text: string): AskObjective | null {
  const t = text.toLowerCase();
  if (/revenue|income|earn|profit|money/.test(t)) return "revenue";
  if (/customer|treatment|member|fair|complain|consumer/.test(t)) return "customer_treatment";
  if (/compet|position|market|peer|match/.test(t)) return "competitive_position";
  return null;
}

// ─── The bank's own figures ──────────────────────────────────────────────────

function numeric(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/[,$%\s]/g, "")) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** The newest current fact for each key (memory rows newest first or not, the latest wins). */
function latestByKey(memory: MemoryFact[]): Map<string, MemoryFact> {
  const out = new Map<string, MemoryFact>();
  for (const fact of memory) {
    const seen = out.get(fact.fieldKey);
    if (!seen || seen.createdAt < fact.createdAt) out.set(fact.fieldKey, fact);
  }
  return out;
}

function ref(fact: MemoryFact): ClientFactRef {
  return { factId: fact.id, fieldKey: fact.fieldKey, value: fact.value, givenBy: fact.givenBy, givenAt: fact.createdAt };
}

/** Item counts and waiver rate the bank gave for one fee, with who gave them and when. */
export function institutionFactsFrom(memory: MemoryFact[], feeCategory: string): InstitutionFeeFacts | null {
  const latest = latestByKey(memory);
  const items = latest.get(`fee.${feeCategory}.annual_items`);
  const waiver = latest.get(`fee.${feeCategory}.waiver_rate`);
  const annualItems = items ? numeric(items.value) : null;
  let waiverRate = waiver ? numeric(waiver.value) : null;
  // "12" or "12%" means 12 percent; 0.12 is already a share.
  if (waiverRate !== null && waiverRate > 1) waiverRate = waiverRate / 100;
  if (annualItems === null && waiverRate === null) return null;
  return {
    ...(annualItems !== null && annualItems >= 0 ? { annualItems } : {}),
    ...(waiverRate !== null && waiverRate >= 0 && waiverRate <= 1 ? { waiverRate } : {}),
    refs: [items, waiver].filter((f): f is MemoryFact => Boolean(f)).map(ref),
  };
}

/** The bank's own stated fee when its schedule has none on file. */
function statedCurrent(memory: MemoryFact[], feeCategory: string): { amount: number; fact: MemoryFact } | null {
  const fact = latestByKey(memory).get(`fee.${feeCategory}.current_amount`);
  const amount = fact ? numeric(fact.value) : null;
  return fact && amount !== null && amount >= 0 ? { amount, fact } : null;
}

// ─── Scenarios and the opinion ───────────────────────────────────────────────

function money(n: number): string {
  return formatFeeAmount(n) ?? `$${n}`;
}

export function scenariosFor(research: FeeResearch, current: number, tested: number[], facts: InstitutionFeeFacts | null): Scenario[] {
  const peers = countedPeerAmounts(research);
  return tested.map((price) =>
    buildScenario({
      feeCategory: research.feeCategory,
      subjectName: research.subjectName,
      current,
      tested: price,
      peers,
      peerLabel: research.peerLabel,
      revenueLine: research.revenueLine,
      institutionFacts: facts,
      generatedAt: research.provenance.generatedAt,
      feesAsOf: research.provenance.dataAsOf.fees ?? null,
    }),
  );
}

const EVIDENCE_WORDS: Record<Scenario["evidenceLevel"], string> = {
  market: "market data only",
  working_estimate: "a working estimate from the institution’s filed income",
  institution: "the figures you gave",
};

function revenueSentence(s: Scenario): string {
  if (s.revenueEffect) {
    const { low, high } = s.revenueEffect;
    const dir = high <= 0 ? "less" : low >= 0 ? "more" : null;
    const range =
      low === high
        ? formatDollarsInWords(Math.abs(low))
        : `${formatDollarsInWords(Math.abs(dir === "less" ? high : low))} to ${formatDollarsInWords(Math.abs(dir === "less" ? low : high))}`;
    return dir
      ? `That is ${range} a year ${dir} in fee income, based on ${EVIDENCE_WORDS[s.evidenceLevel]}.`
      : `Fee income would change by ${formatDollarsInWords(low)} to ${formatDollarsInWords(high)} a year, based on ${EVIDENCE_WORDS[s.evidenceLevel]}.`;
  }
  const delta = s.per1000ItemsDelta;
  if (delta === 0) return "Fee income per item would not change.";
  return `Every 1,000 items charged would bring ${formatDollarsInWords(Math.abs(delta))} ${delta > 0 ? "more" : "less"} in fee income, based on ${EVIDENCE_WORDS[s.evidenceLevel]}.`;
}

/** One or two short sentences for a modeled price. */
export function scenarioSummary(s: Scenario, subject?: { subjectName?: string }): string {
  const name = proseFeeName(s.feeCategory);
  const position =
    s.positionAfter !== null && s.positionBefore !== null
      ? `At ${money(s.tested)}, ${subjectPossessive(subject, false)} ${name} fee would sit ${placeAmong(s.positionAfter, s.n)}; today it sits ${placeAmong(s.positionBefore, s.n, true)}.`
      : `At ${money(s.tested)}, ${s.peersMore} of ${s.n} peers would charge more and ${s.peersLess} less.`;
  return `${position} ${revenueSentence(s)}`;
}

/**
 * How each tested price measures against the objective the reader picked. Given only on an explicit
 * ask; it names the objective, covers only prices the reader tested, in the order tested, and never
 * picks one: Hamilton gives no pricing advice.
 */
export function buildOpinion(scenarios: Scenario[], objective: AskObjective, subject?: { subjectName?: string }): (HamiltonOpinion & { chosen: Scenario }) | null {
  if (scenarios.length === 0) return null;
  if (objective === "competitive_position" && scenarios.every((s) => s.positionAfter === null)) return null;
  const name = proseFeeName(scenarios[0].feeCategory);
  const measure = (s: Scenario): string => {
    if (objective === "revenue") return revenueSentence(s);
    if (objective === "customer_treatment") return `${s.peersMore} of ${s.n} peers would charge more.`;
    return s.positionAfter !== null
      ? `${subjectName(subject)} would sit ${placeAmong(s.positionAfter, s.n)}.`
      : `Fewer than ${MIN_PEERS_FOR_POSITION} peers publish this fee, so it cannot be placed.`;
  };
  const lines = scenarios.map((s) => `At ${money(s.tested)}: ${measure(s)}`);
  return {
    opinion: `For ${OBJECTIVE_LABELS[objective]}, here is how ${scenarios.length === 1 ? "the price you tested" : `the ${scenarios.length} prices you tested`} for the ${name} fee measure up. ${lines.join(" ")} Hamilton does not pick a price; the decision stays with you.`,
    assumedObjective: objective,
    scenariosCompared: scenarios.map((s) => s.tested),
    chosen: scenarios[0],
  };
}

// ─── The response ────────────────────────────────────────────────────────────

export interface AskInput {
  question: string;
  intent: AskIntent;
  /** Null when the question names no fee and none is in context. */
  research: FeeResearch | null;
  memory: MemoryFact[];
  objective?: AskObjective | null;
  /** Prices tested earlier in the same decision, oldest first. */
  priorTested?: number[];
}

function clarify(question: ClarifyingQuestion, pageChange: AskResponse["pageChange"] = { screen: "none" }): AskResponse {
  return { kind: "clarifying_question", shortAnswer: question.prompt, pageChange, question };
}

export function buildAskResponse(input: AskInput): AskResponse {
  const response = respond(input);
  const segment = input.research?.segment;
  return segment ? { ...response, segment } : response;
}

function respond(input: AskInput): AskResponse {
  const { intent, research, memory } = input;
  // No fee to answer for: say what Hamilton can and can't answer, never another subject (#1077).
  if (!intent.feeCategory || !research) return cannotAnswer(input.question, intent.segment);
  const fee = research.feeCategory;
  const facts = institutionFactsFrom(memory, fee);
  const stated = research.current === null ? statedCurrent(memory, fee) : null;
  const current = research.current ?? stated?.amount ?? null;

  if (intent.wantsOpinion) {
    if (!input.objective) return clarify(objectiveQuestion(), { screen: "research", feeCategory: fee });
    const tested = [...new Set([...(input.priorTested ?? []), ...intent.tested])].slice(-MAX_TESTED_PRICES);
    if (tested.length === 0) return clarify(testedPricesQuestion(fee), { screen: "model", feeCategory: fee, tested: [] });
    if (current === null) return clarify(currentAmountQuestion(fee, research), { screen: "research", feeCategory: fee });
    const scenarios = scenariosFor(research, current, tested, facts);
    const opinion = buildOpinion(scenarios, input.objective, research);
    if (!opinion) {
      return {
        kind: "research",
        shortAnswer: `Fewer than ${MIN_PEERS_FOR_POSITION} peers publish this fee, so no tested price can be placed against the market.`,
        pageChange: { screen: "model", feeCategory: fee, tested },
        answer: buildFeeAnswer(research, { story: { tested, wantsDecision: true } }),
      };
    }
    const { chosen, ...rest } = opinion;
    return {
      kind: "opinion",
      shortAnswer: rest.opinion,
      pageChange: { screen: "model", feeCategory: fee, tested },
      opinion: rest,
      scenario: chosen,
    };
  }

  if (intent.tested.length > 0) {
    if (current === null) return clarify(currentAmountQuestion(fee, research), { screen: "research", feeCategory: fee });
    const scenarios = scenariosFor(research, current, intent.tested, facts);
    const first = scenarios[0];
    return {
      kind: "scenario",
      shortAnswer: scenarios.map((scenario) => scenarioSummary(scenario, research)).join(" "),
      pageChange: { screen: "model", feeCategory: fee, tested: intent.tested },
      scenario: first,
      question: first.missingInput ?? undefined,
    };
  }

  const answer = buildFeeAnswer(research, {
    focus: intent.focus,
    story: { tested: intent.tested, wantsDecision: intent.wantsOpinion || !!input.objective, structure: intent.structure, regulation: intent.regulation, list: intent.list },
  });
  const section = intent.focus === "competitors" ? "competitors" : intent.focus === "trend" ? "economy" : "position";
  return {
    kind: "research",
    // A list answer leads with its count, as the page does (#2033).
    shortAnswer: answer.storyline?.kind === "list" ? answer.storyline.governingThought : answer.headline,
    pageChange: { screen: "research", feeCategory: fee, section },
    facts: answer.claims,
    question: answer.question ?? undefined,
    answer,
  };
}
