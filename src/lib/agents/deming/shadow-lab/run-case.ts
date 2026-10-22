import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { STAGE_IDS, type CaseTrace, type PipelineVariant, type PublishedFee, type ShadowCase, type StageFee, type StageId } from "./types";

type Clock = () => number;

const defaultClock: Clock = () => performance.now();

function emptyTrace(c: ShadowCase): CaseTrace {
  const stage = () => ({ passed: [] as StageFee[], dropped: [] as StageFee[] });
  return {
    caseKey: c.caseKey,
    scenario: c.scenario,
    stages: { document_gate: stage(), extract: stage(), verify: stage(), publish_gate: stage() },
    published: [],
    documentAccepted: null,
    durationsMs: Object.fromEntries(STAGE_IDS.map((id) => [id, 0])) as Record<StageId, number>,
  };
}

function attribute(fee: StageFee, text: string): PublishedFee {
  const source = checkFeeAgainstSource(text, fee.feeName ?? "", (fee.amountCents ?? 0) / 100, ".", fee.canonicalFeeKey);
  return { ...fee, sourceLine: source.ok ? source.sourceLine : null, attributed: source.ok };
}

/** One frozen case through every stage of one variant, keeping what each stage passed and dropped. */
export function runCase(variant: PipelineVariant, c: ShadowCase, clock: Clock = defaultClock): CaseTrace {
  const trace = emptyTrace(c);
  if (c.status !== "ok") return trace;
  const timed = <T>(stage: StageId, work: () => T): T => {
    const started = clock();
    try {
      return work();
    } finally {
      trace.durationsMs[stage] += clock() - started;
    }
  };

  const gate = timed("document_gate", () => variant.documentGate(c));
  trace.documentAccepted = gate.accepted;
  const text = c.document.text;
  if (!gate.accepted || text == null) return trace;

  trace.stages.extract = timed("extract", () => variant.extract(text));
  for (const fee of trace.stages.extract.passed) {
    const verified = timed("verify", () => variant.verify(fee, text));
    if (!verified.ok) {
      trace.stages.verify.dropped.push({ ...fee, reason: verified.reason });
      continue;
    }
    trace.stages.verify.passed.push(verified.fee);
    const live = trace.stages.publish_gate.passed;
    const decision = timed("publish_gate", () => variant.publishGate(verified.fee, text, live));
    if (decision.publish) live.push(verified.fee);
    else trace.stages.publish_gate.dropped.push({ ...verified.fee, reason: decision.reason });
  }
  trace.published = trace.stages.publish_gate.passed.map((fee) => attribute(fee, text));
  return trace;
}

/** Every case through one variant; traces come back in case-key order whatever the input order. */
export function runAll(variant: PipelineVariant, cases: ShadowCase[], clock: Clock = defaultClock): CaseTrace[] {
  return cases
    .map((c) => runCase(variant, c, clock))
    .sort((a, b) => (a.caseKey < b.caseKey ? -1 : a.caseKey > b.caseKey ? 1 : 0));
}

/** A trace without its timings, which vary run to run. */
export function stripTiming(trace: CaseTrace): Omit<CaseTrace, "durationsMs"> {
  const { durationsMs: _durations, ...rest } = trace;
  return rest;
}
