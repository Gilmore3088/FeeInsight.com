import { gateReadKey } from "@/lib/agents/knox/answer-key-gate";
import { publishedFeeName } from "@/lib/agents/hamilton/publish";
import { nameMatches } from "./names";
import { SCENARIO_IDS, STAGE_IDS, type CaseTrace, type ExcludedKey, type FeeRef, type ScenarioId, type ShadowCase, type StageFee, type StageId } from "./types";

/**
 * Scores one variant's traces against the cases' expectations. Every failed expectation is
 * charged to the first stage that got it wrong, so the report shows where fees go wrong, not
 * only how many.
 */

export type FailureStage = StageId | "passed_every_stage";
export type FailureKind = "missed" | "false_publication" | "duplicate" | "wrong_document" | "wrong_name";

export interface Failure {
  caseKey: string;
  scenario: ScenarioId;
  kind: FailureKind;
  stage: FailureStage;
  fee: FeeRef;
  reason: string | null;
}

export interface Rate {
  rate: number | null;
}

export interface VariantMetrics {
  cases: { ok: number; corrupt: number; notReplayable: number };
  recall: { expected: number; found: number } & Rate;
  /** Recall on the answer-key documents alone (`missed_fees`). */
  answerKeyRecall: { expected: number; found: number } & Rate;
  falsePublication: { forbidden: number; published: number } & Rate;
  duplicatePrevention: { cases: number; correct: number } & Rate;
  sourceAttribution: { published: number; attributed: number } & Rate;
  documentGate: { cases: number; correct: number };
  /** Published fees with an expected name whose published name matches it (`names.ts`). */
  names: { expected: number; matched: number } & Rate;
  unexpectedPublications: number;
  /** Answer-key fees left out of every recall count because they can never be found, by case. */
  excludedKeys: Array<ExcludedKey & { caseKey: string }>;
  failuresByStage: Record<FailureStage, number>;
  byScenario: Record<ScenarioId, ScenarioScore>;
  failures: Failure[];
  providerCalls: number;
  costMicrousd: number;
}

export interface ScenarioScore {
  cases: number;
  failures: number;
  expected: number;
  found: number;
  forbidden: number;
  published: number;
}

const ratio = (part: number, whole: number): number | null => (whole === 0 ? null : part / whole);

/** Category as Knox's answer-key gate compares it (its equivalences applied). */
function gateCategory(key: string | null): string | null {
  if (key == null) return null;
  const { normalized } = gateReadKey(`${key}:0`);
  return normalized.slice(0, normalized.lastIndexOf(":"));
}

export function matches(ref: FeeRef, fee: StageFee): boolean {
  if (gateCategory(ref.canonicalFeeKey) !== gateCategory(fee.canonicalFeeKey)) return false;
  if (ref.amountCents != null && ref.amountCents !== fee.amountCents) return false;
  if (ref.frequency == null) return true;
  return ref.frequency.startsWith("!") ? fee.frequency !== ref.frequency.slice(1) : fee.frequency === ref.frequency;
}

/** How a missed fee's line was read when no stage dropped it at its category and price. */
export const MISS_REASONS = {
  heldUnclassified: "held_unclassified",
  otherCategory: "read_other_category",
  otherAmount: "read_other_amount",
  otherLine: "other_line_same_price",
  notRead: "not_read",
} as const;

/** Words that state a price rather than name a fee ("eStatements FREE FREE"). */
const PRICE_WORDS = new Set(["free", "none"]);

function plainLine(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function lineWords(text: string): string {
  return (plainLine(text).match(/[a-z]+/g) ?? []).filter((word) => !PRICE_WORDS.has(word)).join(" ");
}

/**
 * True when a read's line is the key's own line: the same text, or the same words in the same
 * order once prices, punctuation and layout are set aside ("Direct Checking FREE FREE $10" read
 * as "Direct Checking | $10"). A line with no words ("$20.00") is the key's only when equal.
 * Sharing a word or a price is not enough: "Bill Payer | Free" is not "Cashier Checks 3 Free".
 */
export function isKeyLine(keyLine: string | null | undefined, readLine: string | null | undefined): boolean {
  if (!keyLine || !readLine) return false;
  if (plainLine(keyLine) === plainLine(readLine)) return true;
  const words = lineWords(keyLine);
  return words !== "" && words === lineWords(readLine);
}

/** The read is on the key's line, by its excerpt or the line its price traced to. */
const onKeyLine = (ref: FeeRef, fee: StageFee): boolean =>
  isKeyLine(ref.sourceLine, fee.excerpt) || isKeyLine(ref.sourceLine, fee.sourceLine);

/** Where an expected fee that never published was lost: the latest stage it reached. */
function whereMissed(ref: FeeRef, trace: CaseTrace): { stage: StageId; reason: string | null } {
  const gated = trace.stages.publish_gate.dropped.find((fee) => matches(ref, fee));
  if (gated) return { stage: "publish_gate", reason: gated.reason };
  const refused = trace.stages.verify.dropped.find((fee) => matches(ref, fee));
  if (refused) return { stage: "verify", reason: refused.reason };
  const held = trace.stages.extract.dropped.find((fee) => matches(ref, fee));
  if (held) return { stage: "extract", reason: held.reason };
  const samePrice = (fee: StageFee) => ref.amountCents != null && fee.amountCents === ref.amountCents;
  // Knox read the key's own line at its price but held it with no category, so it could never match.
  if (trace.stages.extract.dropped.some((fee) => fee.canonicalFeeKey == null && samePrice(fee) && onKeyLine(ref, fee))) {
    return { stage: "extract", reason: MISS_REASONS.heldUnclassified };
  }
  // Published reads carry the line their price traced to; Knox's reads carry their excerpt.
  const read = [...trace.stages.extract.passed, ...trace.published];
  // Without a stored line the lab cannot tell one line from another, so the price alone decides.
  const misfiled = (fee: StageFee) => samePrice(fee) && (!ref.sourceLine || onKeyLine(ref, fee));
  if (read.some(misfiled)) return { stage: "extract", reason: MISS_REASONS.otherCategory };
  if (read.some((fee) => matches({ ...ref, amountCents: null }, fee))) return { stage: "extract", reason: MISS_REASONS.otherAmount };
  // A read at the price on another line is a coincidence of price, not a misfile of this fee.
  if (read.some(samePrice)) return { stage: "extract", reason: MISS_REASONS.otherLine };
  return { stage: "extract", reason: MISS_REASONS.notRead };
}

/**
 * Where a same-dollar group came out wrong; null when the count is right. A group Knox never read
 * is a missed fee, not a duplicate decision.
 */
function whereDuplicate(
  target: NonNullable<ShadowCase["expected"]["publishCount"]>,
  trace: CaseTrace,
): { kind: FailureKind; stage: StageId } | null {
  const ref: FeeRef = { canonicalFeeKey: target.canonicalFeeKey, feeName: null, amountCents: target.amountCents };
  const count = (fees: StageFee[]) => fees.filter((fee) => matches(ref, fee)).length;
  const extracted = count(trace.stages.extract.passed);
  if (extracted === 0) return { kind: "missed", stage: "extract" };
  const published = count(trace.published);
  if (published === target.count) return null;
  // Published fees are a subset of extracted ones, so too many always began with Knox reading too many.
  if (published > target.count) return { kind: "duplicate", stage: "extract" };
  if (count(trace.stages.verify.passed) >= target.count) return { kind: "duplicate", stage: "publish_gate" };
  return { kind: "duplicate", stage: extracted >= target.count ? "verify" : "extract" };
}

/** The name the fee would go live under, as Hamilton's publish step sets it. */
function publishedName(fee: StageFee): string {
  return publishedFeeName(fee.feeName ?? "", fee.canonicalFeeKey ?? "");
}

export function scoreRun(cases: ShadowCase[], traces: CaseTrace[], providerCalls: number): VariantMetrics {
  const byKey = new Map(traces.map((trace) => [trace.caseKey, trace]));
  const failures: Failure[] = [];
  const m: VariantMetrics = {
    cases: { ok: 0, corrupt: 0, notReplayable: 0 },
    recall: { expected: 0, found: 0, rate: null },
    answerKeyRecall: { expected: 0, found: 0, rate: null },
    falsePublication: { forbidden: 0, published: 0, rate: null },
    duplicatePrevention: { cases: 0, correct: 0, rate: null },
    sourceAttribution: { published: 0, attributed: 0, rate: null },
    documentGate: { cases: 0, correct: 0 },
    names: { expected: 0, matched: 0, rate: null },
    unexpectedPublications: 0,
    excludedKeys: [],
    failuresByStage: Object.fromEntries([...STAGE_IDS, "passed_every_stage"].map((id) => [id, 0])) as Record<FailureStage, number>,
    byScenario: Object.fromEntries(
      SCENARIO_IDS.map((id) => [id, { cases: 0, failures: 0, expected: 0, found: 0, forbidden: 0, published: 0 }]),
    ) as VariantMetrics["byScenario"],
    failures,
    providerCalls,
    costMicrousd: 0,
  };
  const fail = (c: ShadowCase, kind: FailureKind, stage: FailureStage, fee: FeeRef, reason: string | null) =>
    failures.push({ caseKey: c.caseKey, scenario: c.scenario, kind, stage, fee, reason });
  // A fee published at the right price under a name that does not match is a name failure.
  const scoreName = (c: ShadowCase, ref: FeeRef, expected: string, found: StageFee[]) => {
    m.names.expected += 1;
    if (found.some((fee) => nameMatches(expected, publishedName(fee)))) m.names.matched += 1;
    else fail(c, "wrong_name", "passed_every_stage", ref, publishedName(found[0]));
  };

  for (const c of cases) {
    if (c.status === "corrupt") m.cases.corrupt += 1;
    if (c.status === "not_replayable") m.cases.notReplayable += 1;
    const trace = byKey.get(c.caseKey);
    if (c.status !== "ok" || !trace) continue;
    m.cases.ok += 1;
    m.byScenario[c.scenario].cases += 1;

    if (c.expected.documentIsSchedule !== undefined) {
      m.documentGate.cases += 1;
      if (trace.documentAccepted === c.expected.documentIsSchedule) m.documentGate.correct += 1;
      else fail(c, "wrong_document", "document_gate", { canonicalFeeKey: null, feeName: c.document.url, amountCents: null }, null);
    }
    if (c.document.text == null) continue;
    for (const key of c.expected.excluded ?? []) m.excludedKeys.push({ caseKey: c.caseKey, ...key });

    const answerKey = c.scenario === "missed_fees";
    const scenario = m.byScenario[c.scenario];
    for (const ref of c.expected.publish) {
      m.recall.expected += 1;
      scenario.expected += 1;
      if (answerKey) m.answerKeyRecall.expected += 1;
      const found = trace.published.filter((fee) => matches(ref, fee));
      if (found.length > 0) {
        m.recall.found += 1;
        scenario.found += 1;
        if (answerKey) m.answerKeyRecall.found += 1;
        if (ref.expectedName) scoreName(c, ref, ref.expectedName, found);
      } else {
        const lost = whereMissed(ref, trace);
        fail(c, "missed", lost.stage, ref, lost.reason);
      }
    }
    for (const ref of c.expected.forbid) {
      m.falsePublication.forbidden += 1;
      scenario.forbidden += 1;
      if (trace.published.some((fee) => matches(ref, fee))) {
        m.falsePublication.published += 1;
        scenario.published += 1;
        fail(c, "false_publication", "passed_every_stage", ref, null);
      }
    }
    const target = c.expected.publishCount;
    if (target) {
      const wrong = whereDuplicate(target, trace);
      if (wrong?.kind !== "missed") m.duplicatePrevention.cases += 1;
      if (wrong == null) m.duplicatePrevention.correct += 1;
      else fail(c, wrong.kind, wrong.stage, { canonicalFeeKey: target.canonicalFeeKey, feeName: null, amountCents: target.amountCents }, null);
    }
    if (c.scenario === "missed_fees") {
      m.unexpectedPublications += trace.published.filter((fee) => !c.expected.publish.some((ref) => matches(ref, fee))).length;
    }
    m.sourceAttribution.published += trace.published.length;
    m.sourceAttribution.attributed += trace.published.filter((fee) => fee.attributed).length;
  }

  for (const failure of failures) {
    m.failuresByStage[failure.stage] += 1;
    m.byScenario[failure.scenario].failures += 1;
  }
  m.recall.rate = ratio(m.recall.found, m.recall.expected);
  m.answerKeyRecall.rate = ratio(m.answerKeyRecall.found, m.answerKeyRecall.expected);
  m.falsePublication.rate = ratio(m.falsePublication.published, m.falsePublication.forbidden);
  m.duplicatePrevention.rate = ratio(m.duplicatePrevention.correct, m.duplicatePrevention.cases);
  m.sourceAttribution.rate = ratio(m.sourceAttribution.attributed, m.sourceAttribution.published);
  m.names.rate = ratio(m.names.matched, m.names.expected);
  return m;
}
