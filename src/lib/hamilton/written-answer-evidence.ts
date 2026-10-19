import { deriveNcuaAnswerEvidence, type NcuaAnswerDerivation, type NcuaDerivationInput } from "./answer-derivations";
import type { HamiltonBriefingEvidence } from "./institution-briefing";
import { profileQuarterCalculations, type ProfileQuarterCalculation } from "./profile-quarter-evidence";
import { filedPeerIncomeEvidence } from "./filed-peer-evidence";

/** Server-observed tool reads, never calculations supplied by a model or browser. */
export interface AnswerToolEvidence {
  toolName?: string;
  input?: unknown;
  output: unknown;
}

export interface WrittenAnswerEvidenceContext {
  briefingEvidence?: readonly HamiltonBriefingEvidence[];
  toolResults?: readonly AnswerToolEvidence[];
  institutionId?: number | null;
}

interface EvidenceStep {
  toolResults: readonly AnswerToolEvidence[];
}

export const WRITTEN_CALCULATION_MAX_CHARS = 16_000;
export const WRITTEN_CALCULATION_MAX_FACTS = 40;

/** One bounded ledger is used both before generation and by the final validator. */
function calculationLedger(reads: readonly AnswerToolEvidence[]) {
  const all = deriveNcuaAnswerEvidence(ncuaReads(reads));
  const facts = new Map<string, NcuaDerivationInput>();
  const retained: NcuaAnswerDerivation[] = [];
  const projected: Array<Omit<NcuaAnswerDerivation, "inputs"> & { input_refs: string[] }> = [];
  const key = (fact: NcuaDerivationInput) => `${fact.institution_id}:${fact.measure}:${fact.report_date}`;
  for (const derived of all.derivations) {
    if (retained.length >= WRITTEN_CALCULATION_MAX_FACTS) break;
    const candidateFacts = new Map(facts);
    for (const input of derived.inputs) candidateFacts.set(key(input), input);
    const { inputs, ...value } = derived;
    const candidate = { ...value, input_refs: inputs.map(key) };
    if (JSON.stringify({ input_facts: Object.fromEntries(candidateFacts), derivations: [...projected, candidate], limitations: all.limitations }).length > WRITTEN_CALCULATION_MAX_CHARS - 400) continue;
    for (const [id, fact] of candidateFacts) facts.set(id, fact);
    retained.push(derived);
    projected.push(candidate);
  }
  const limitations = [...all.limitations];
  const profiles: ProfileQuarterCalculation[] = [];
  for (const calculation of profileQuarterCalculations(reads)) {
    if (retained.length + profiles.length >= WRITTEN_CALCULATION_MAX_FACTS
      || JSON.stringify({ input_facts: Object.fromEntries(facts), derivations: [...projected, ...profiles, calculation], limitations }).length > WRITTEN_CALCULATION_MAX_CHARS - 400) break;
    profiles.push(calculation);
  }
  if (retained.length < all.derivations.length) limitations.push("The calculation ledger was bounded. State only calculations included here; request a narrower filing window for other calculations.");
  return { retained: [...retained, ...profiles], prompt: { input_facts: Object.fromEntries(facts), derivations: [...projected, ...profiles], limitations } };
}

/** Repeated derivation inputs are provenance, not additional numerical candidates. */
function withoutEmbeddedDerivations(value: unknown, depth = 0): unknown {
  if (depth > 12) return null;
  if (typeof value === "string") {
    const text = value.trim();
    if (text.length <= 1_000_000 && (text.startsWith("{") || text.startsWith("["))) {
      try { return withoutEmbeddedDerivations(JSON.parse(text), depth + 1); } catch { /* Plain text. */ }
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => withoutEmbeddedDerivations(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "derived_facts")
      .map(([key, child]) => [key, withoutEmbeddedDerivations(child, depth + 1)]));
  }
  return value;
}

function ncuaReads(reads: readonly AnswerToolEvidence[]) {
  return reads.filter((read) => read.toolName === "queryData");
}

/** The same dated facts in the prompt, plus derivations recomputed from the actual reads. */
export function writtenAnswerEvidence(
  toolOutputs: readonly unknown[],
  context: WrittenAnswerEvidenceContext = {},
): unknown {
  const calculated = calculationLedger(context.toolResults ?? []);
  return {
    selected_institution_id: context.institutionId ?? null,
    briefing_evidence: context.briefingEvidence ?? [],
    // Full input provenance remains in the tool results/model context. These candidates are
    // re-created by our deterministic reader, rather than trusting a returned calculation.
    validated_calculations: calculated.prompt.derivations,
    validated_filed_peer_income: filedPeerIncomeEvidence(context.toolResults ?? [], context.institutionId ?? null),
    tool_evidence: context.toolResults?.length
      ? context.toolResults.map((read) => ({ ...read, output: withoutEmbeddedDerivations(read.output) }))
      : toolOutputs.map((output) => withoutEmbeddedDerivations(output)),
  };
}

/** AI SDK prepareStep supplies completed steps before the model writes the next one. */
export function writtenAnswerStepSystemPrompt(systemPrompt: string, steps: readonly EvidenceStep[] = []): string {
  const reads = steps.flatMap((step) => step.toolResults);
  const calculated = calculationLedger(reads);
  if (calculated.retained.length === 0 && calculated.prompt.limitations.length === 0) return systemPrompt;
  return `${systemPrompt}\n\nVALIDATED FINANCIAL CALCULATIONS FROM THIS ANSWER'S READS\n`
    + "These calculations were computed from the cited tool rows. Preserve the institution, metric, reporting dates, unit, denominator and period basis. "
    + "A calculation supports its stated arithmetic only, never a cause, a price recommendation, cash paid, member counts from accounts, or a comparison of changing peer populations. "
    + "Use the exact values before rounding; show inputs for a calculation you state. Do not calculate additional unsupported ratios or growth from peer medians.\n"
    + JSON.stringify(calculated.prompt)
    + "\nEND VALIDATED FINANCIAL CALCULATIONS.\n";
}
