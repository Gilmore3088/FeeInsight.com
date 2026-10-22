import { gateReadKey } from "@/lib/agents/knox/answer-key-gate";
import { SCENARIO_IDS, STAGE_IDS, type CaseTrace, type FeeRef, type ScenarioId, type ShadowCase, type StageFee, type StageId } from "./types";

/**
 * Scores one variant's traces against the cases' expectations. Every failed expectation is
 * charged to the first stage that got it wrong, so the report shows where fees go wrong, not
 * only how many.
 */

export type FailureStage = StageId | "passed_every_stage";
export type FailureKind = "missed" | "false_publication" | "duplicate" | "wrong_document";

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
  falsePublication: { forbidden: number; published: number } & Rate;
  duplicatePrevention: { cases: number; correct: number } & Rate;
  sourceAttribution: { published: number; attributed: number } & Rate;
  documentGate: { cases: number; correct: number };
  unexpectedPublications: number;
  failuresByStage: Record<FailureStage, number>;
  byScenario: Record<ScenarioId, { cases: number; failures: number }>;
  failures: Failure[];
  providerCalls: number;
  costMicrousd: number;
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

/** Where an expected fee that never published was lost: the latest stage it reached. */
function whereMissed(ref: FeeRef, trace: CaseTrace): { stage: StageId; reason: string | null } {
  const gated = trace.stages.publish_gate.dropped.find((fee) => matches(ref, fee));
  if (gated) return { stage: "publish_gate", reason: gated.reason };
  const refused = trace.stages.verify.dropped.find((fee) => matches(ref, fee));
  if (refused) return { stage: "verify", reason: refused.reason };
  const held = trace.stages.extract.dropped.find((fee) => matches(ref, fee));
  return { stage: "extract", reason: held?.reason ?? "not_read" };
}

/** Where a same-dollar group came out wrong; null when the count is right. */
function whereDuplicate(target: NonNullable<ShadowCase["expected"]["publishCount"]>, trace: CaseTrace): StageId | null {
  const ref: FeeRef = { canonicalFeeKey: target.canonicalFeeKey, feeName: null, amountCents: target.amountCents };
  const count = (fees: StageFee[]) => fees.filter((fee) => matches(ref, fee)).length;
  const published = count(trace.published);
  if (published === target.count) return null;
  if (published > target.count || count(trace.stages.verify.passed) >= target.count) return "publish_gate";
  return count(trace.stages.extract.passed) >= target.count ? "verify" : "extract";
}

export function scoreRun(cases: ShadowCase[], traces: CaseTrace[], providerCalls: number): VariantMetrics {
  const byKey = new Map(traces.map((trace) => [trace.caseKey, trace]));
  const failures: Failure[] = [];
  const m: VariantMetrics = {
    cases: { ok: 0, corrupt: 0, notReplayable: 0 },
    recall: { expected: 0, found: 0, rate: null },
    falsePublication: { forbidden: 0, published: 0, rate: null },
    duplicatePrevention: { cases: 0, correct: 0, rate: null },
    sourceAttribution: { published: 0, attributed: 0, rate: null },
    documentGate: { cases: 0, correct: 0 },
    unexpectedPublications: 0,
    failuresByStage: Object.fromEntries([...STAGE_IDS, "passed_every_stage"].map((id) => [id, 0])) as Record<FailureStage, number>,
    byScenario: Object.fromEntries(SCENARIO_IDS.map((id) => [id, { cases: 0, failures: 0 }])) as VariantMetrics["byScenario"],
    failures,
    providerCalls,
    costMicrousd: 0,
  };
  const fail = (c: ShadowCase, kind: FailureKind, stage: FailureStage, fee: FeeRef, reason: string | null) =>
    failures.push({ caseKey: c.caseKey, scenario: c.scenario, kind, stage, fee, reason });

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

    for (const ref of c.expected.publish) {
      m.recall.expected += 1;
      if (trace.published.some((fee) => matches(ref, fee))) m.recall.found += 1;
      else {
        const lost = whereMissed(ref, trace);
        fail(c, "missed", lost.stage, ref, lost.reason);
      }
    }
    for (const ref of c.expected.forbid) {
      m.falsePublication.forbidden += 1;
      if (trace.published.some((fee) => matches(ref, fee))) {
        m.falsePublication.published += 1;
        fail(c, "false_publication", "passed_every_stage", ref, null);
      }
    }
    const target = c.expected.publishCount;
    if (target) {
      m.duplicatePrevention.cases += 1;
      const stage = whereDuplicate(target, trace);
      if (stage == null) m.duplicatePrevention.correct += 1;
      else fail(c, "duplicate", stage, { canonicalFeeKey: target.canonicalFeeKey, feeName: null, amountCents: target.amountCents }, null);
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
  m.falsePublication.rate = ratio(m.falsePublication.published, m.falsePublication.forbidden);
  m.duplicatePrevention.rate = ratio(m.duplicatePrevention.correct, m.duplicatePrevention.cases);
  m.sourceAttribution.rate = ratio(m.sourceAttribution.attributed, m.sourceAttribution.published);
  return m;
}
