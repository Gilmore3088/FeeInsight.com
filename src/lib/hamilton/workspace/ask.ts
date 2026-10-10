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
import { DISPLAY_NAMES } from "@/lib/fee-taxonomy";
import { buildFeeAnswer, type ExhibitFocus } from "./answer";
import { proseFeeName } from "./names";
import { annualItemsQuestion, buildScenario, MIN_PEERS_FOR_POSITION, waiverRateQuestion } from "./scenario";
import { parseSegment, SEGMENT_AMOUNTS } from "./segment";
import { rateVolumeQuestion } from "./rates";
import { asksAboutStructure } from "./storyline";
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

/** Words people use for a fee that its display name does not carry. Longest phrase wins. */
const FEE_SYNONYMS: Record<string, string[]> = {
  overdraft: ["overdraft", "overdrafts", "od fee", "od fees", "courtesy pay", "bounce protection", "paid item"],
  nsf: ["nsf", "non-sufficient funds", "nonsufficient funds", "insufficient funds", "returned item", "bounced check"],
  continuous_od: ["continuous overdraft", "extended overdraft", "sustained overdraft", "daily overdraft"],
  od_protection_transfer: ["overdraft protection transfer", "overdraft transfer", "od transfer", "od protection"],
  monthly_maintenance: ["monthly maintenance", "maintenance fee", "monthly service fee", "monthly fee"],
  atm_non_network: ["atm fee", "atm", "out-of-network atm", "foreign atm", "non-network atm"],
  wire_domestic_outgoing: ["wire", "wire fee", "outgoing wire", "domestic wire"],
  wire_domestic_incoming: ["incoming wire"],
  wire_intl_outgoing: ["international wire", "foreign wire"],
  stop_payment: ["stop payment"],
  card_foreign_txn: ["foreign transaction", "international atm", "atm abroad"],
  cashiers_check: ["cashier's check", "cashiers check", "official check"],
  paper_statement: ["paper statement"],
};

function phrasesFor(category: string): string[] {
  const display = (DISPLAY_NAMES[category] ?? "").toLowerCase();
  const fromDisplay = display
    .replace(/\(([^)]*)\)/g, "/$1")
    .split("/")
    .map((p) => p.trim())
    .filter((p) => p.length >= 4);
  return [...new Set([...(FEE_SYNONYMS[category] ?? []), display.replace(/\s*\([^)]*\)/g, "").trim(), ...fromDisplay].filter(Boolean))];
}

const PHRASES: { category: string; phrase: string }[] = Object.keys(DISPLAY_NAMES)
  .flatMap((category) => phrasesFor(category).map((phrase) => ({ category, phrase })))
  .sort((a, b) => b.phrase.length - a.phrase.length);

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
const OPINION = /what would you do|what do you (recommend|suggest|advise)|\bshould (we|i)\b(?! (know|be aware|understand|note|keep in mind|watch))|your (opinion|recommendation|advice|view)|which (price|option|scenario|one) (is|was|would be) best|best (price|option)/i;
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

/** "What regulation applies", "regulatory risk", "is this compliant", "what does the CFPB say". */
const REGULATION_QUESTION = /\b(regulat\w*|rules?|laws?|legal|complian\w*|CFPB|OCC|FDIC|NCUA|examin\w*|Reg [A-Z]{1,2})\b/i;

export function parseAsk(question: string, fallbackCategory: string | null = null): AskIntent {
  const segment = parseSegment(question);
  return {
    feeCategory: matchFeeCategory(question) ?? fallbackCategory,
    segment,
    // Asset sizes ("$10B") are not prices.
    tested: segment ? pricesIn(question.replace(SEGMENT_AMOUNTS, " ")) : pricesIn(question),
    wantsOpinion: OPINION.test(question),
    focus: segment || COMPETITORS.test(question) ? "competitors" : TREND.test(question) ? "trend" : "position",
    structure: asksAboutStructure(question),
    regulation: REGULATION_QUESTION.test(question),
  };
}

/**
 * A question about a segment ("all institutions above $10 billion") that names no fee is
 * answered for overdraft, the fee segments are most often compared on, instead of asking back;
 * the answer names the fee in its first line.
 */
export const SEGMENT_DEFAULT_FEE = "overdraft";

export function withSegmentDefault(intent: AskIntent): AskIntent {
  return !intent.feeCategory && intent.segment ? { ...intent, feeCategory: SEGMENT_DEFAULT_FEE } : intent;
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

export function testedPricesQuestion(feeCategory: string): ClarifyingQuestion {
  return {
    prompt: `Which ${proseFeeName(feeCategory)} prices should I compare?`,
    inputKind: "text",
    fieldKey: `fee.${feeCategory}.tested_prices`,
  };
}

function currentAmountQuestion(feeCategory: string, subject?: { subjectName?: string }): ClarifyingQuestion {
  return {
    prompt: `${subject?.subjectName ? `What does ${subject.subjectName}` : "What do you"} charge for one ${proseFeeName(feeCategory)} item today?`,
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

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

export function scenariosFor(research: FeeResearch, current: number, tested: number[], facts: InstitutionFeeFacts | null): Scenario[] {
  const peers = research.peers.map((p) => p.amount);
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
      ? `At ${money(s.tested)}, ${subjectPossessive(subject, false)} ${name} fee would sit at the ${ordinal(s.positionAfter)} percentile of ${s.n.toLocaleString("en-US")} peers, against the ${ordinal(s.positionBefore)} today.`
      : `At ${money(s.tested)}, ${s.peersMore} of ${s.n} peers would charge more and ${s.peersLess} less.`;
  return `${position} ${revenueSentence(s)}`;
}

/**
 * The strongest tested price for the objective the reader picked. Given only on an
 * explicit ask; it names the objective and compares only prices the reader tested.
 */
export function buildOpinion(scenarios: Scenario[], objective: AskObjective, subject?: { subjectName?: string }): (HamiltonOpinion & { chosen: Scenario }) | null {
  if (scenarios.length === 0) return null;
  const name = proseFeeName(scenarios[0].feeCategory);
  const count = scenarios.length === 1 ? "the one price you tested" : `the ${scenarios.length} prices you tested`;
  let best: Scenario;
  let why: string;
  if (objective === "revenue") {
    const withDollars = scenarios.filter((s) => s.revenueEffect);
    best = (withDollars.length > 0 ? withDollars : scenarios).reduce((a, b) =>
      (b.revenueEffect?.high ?? b.per1000ItemsDelta) > (a.revenueEffect?.high ?? a.per1000ItemsDelta) ? b : a,
    );
    why = revenueSentence(best);
  } else if (objective === "customer_treatment") {
    best = scenarios.reduce((a, b) => (b.tested < a.tested ? b : a));
    why = best.positionAfter !== null ? `It would sit at the ${ordinal(best.positionAfter)} percentile of ${best.n} peers.` : `${best.peersMore} of ${best.n} peers would charge more.`;
  } else {
    const ranked = scenarios.filter((s) => s.positionAfter !== null);
    if (ranked.length === 0) return null;
    best = ranked.reduce((a, b) => (Math.abs((b.positionAfter as number) - 50) < Math.abs((a.positionAfter as number) - 50) ? b : a));
    why = `It keeps ${subjectName(subject)} closest to the middle of ${best.n} peers, at the ${ordinal(best.positionAfter as number)} percentile.`;
  }
  return {
    opinion: `If your objective is ${OBJECTIVE_LABELS[objective]}, ${money(best.tested)} was the strongest of ${count} for the ${name} fee. ${why} The decision stays with you.`,
    assumedObjective: objective,
    scenariosCompared: scenarios.map((s) => s.tested),
    chosen: best,
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
  if (!intent.feeCategory || !research) return clarify(feeQuestion());
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
    story: { tested: intent.tested, wantsDecision: intent.wantsOpinion || !!input.objective, structure: intent.structure, regulation: intent.regulation },
  });
  const section = intent.focus === "competitors" ? "competitors" : intent.focus === "trend" ? "economy" : "position";
  return {
    kind: "research",
    shortAnswer: answer.headline,
    pageChange: { screen: "research", feeCategory: fee, section },
    facts: answer.claims,
    question: answer.question ?? undefined,
    answer,
  };
}
