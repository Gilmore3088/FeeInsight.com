/**
 * The bounded narrative (narrative-bound.ts, #981 H06-T06) applied to Hamilton's written answer:
 * the Analyze screen's streamed prose and the buffered report path.
 *
 * The evidence is what the answer already has: the tool outputs the model wrote from. An
 * institution profile (`getInstitution`) carries each published fee with its catalog row and its
 * stored schedule, so those amounts are records a sentence can bind to. Benchmarks (medians,
 * bands), financials and fees still in review carry no record, so a sentence that states them is
 * Hamilton's reading and is shown under `INTERPRETATION_LABEL`. A sentence the records contradict
 * (another bank's fee as this one's, a rate fee as dollars, advice) is left out.
 *
 * The profile's fees carry no reporting period, product audience or schedule date, so the evidence
 * contract derives no gap or change from them (`deriveDifference` needs both periods): a gap or a
 * year stated in a written answer is never shown as a supported fact, but lands under the label
 * rather than being left out.
 *
 * With no fee record in the tool outputs there is nothing to bind to, so no binding is made and
 * the answer is shown as before, with its untraced figures called out. Pure: no read, no write,
 * no model call; safe to import from the browser.
 */
import {
  HAMILTON_EVIDENCE_CONTRACT_VERSION,
  STORED_SNAPSHOT_LIMITATION,
  type HamiltonEvidenceBundle,
  type HamiltonEvidenceFact,
} from "./evidence-contract";
import { bindNarrative, INTERPRETATION_LIMITATION, NARRATIVE_BINDING_VERSION, type NarrativeBinding, type OmitReason } from "./narrative-bound";

/** The prose sections of a written answer, as `parseAnalyzeResponse` returns them. */
export interface WrittenAnswerSections {
  hamiltonView: string;
  whatThisMeans: string;
  whyItMatters: string[];
}

/** The lead when every figure sentence of the view is Hamilton's reading. */
export const READING_ONLY_LEAD =
  "The figures in this answer are not tied to a saved fee record, so Hamilton's reading of them is shown below.";
/** The lead when the view was left out but other sentences of the answer remain. */
export const PART_LEFT_OUT_LEAD =
  "Part of this answer was left out because a figure in it did not match its fee record.";
/** The lead when every sentence of the view was left out. */
export const ALL_LEFT_OUT_LEAD =
  "Hamilton left this answer out because its figures did not match the fee records. Ask again, or name one fee to compare.";

/** The text the binding reads: each section on its own line, as the screen shows them. */
export function writtenAnswerProse(sections: WrittenAnswerSections): string {
  return [sections.hamiltonView, sections.whatThisMeans, ...sections.whyItMatters].filter((part) => part.trim()).join("\n");
}

const NAME_SUFFIX = /,?\s+(?:national association|n\.\s?a\.?|inc\.?|fsb|ssb)$/i;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

const positiveInt = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;

function profileFact(institutionId: number, fee: Record<string, unknown>, index: number): HamiltonEvidenceFact | null {
  const amount = fee.amount;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) return null;
  const recordId = positiveInt(fee.record_id);
  const documentId = positiveInt(fee.source_document_id);
  const text = (key: string) => (typeof fee[key] === "string" && (fee[key] as string).trim() ? (fee[key] as string) : null);
  return {
    id: recordId !== null ? `fee:published:${recordId}` : `fee:profile:${institutionId}:${index}`,
    kind: "observed",
    scope: {
      institutionId,
      feeCategory: text("fee_category"),
      product: text("fee_name"),
      reportingDate: null,
      effectiveDate: null,
      accountApplicability: "unknown",
    },
    value: amount,
    // The profile reads the dollar catalog; a rate fee is never among these rows.
    unit: "usd",
    currency: "USD",
    frequency: text("frequency"),
    conditions: null,
    // A fee still in review, or a row from before the catalog, is never a published record.
    status: fee.status === "verified" && !fee.pipeline_stage ? "published" : "provisional",
    source: {
      label: "Published fee catalog",
      table: "published_fee_catalog",
      recordId,
      sourceDocumentIds: documentId !== null ? [documentId] : [],
      urls: text("source_url") ? [text("source_url") as string] : [],
      asOf: null,
      verificationEventId: null,
    },
  };
}

/**
 * The fee records and institution names in a written answer's tool outputs. Null when the outputs
 * hold no fee amount at all.
 */
export function writtenAnswerEvidence(toolOutputs: readonly unknown[]): { evidence: HamiltonEvidenceBundle; names: Map<number, string> } | null {
  const facts = new Map<string, HamiltonEvidenceFact>();
  const names = new Map<number, string>();
  const name = (id: number | null, value: unknown) => {
    if (id === null || typeof value !== "string" || !value.trim() || names.has(id)) return;
    names.set(id, value.trim().replace(NAME_SUFFIX, ""));
  };
  const visit = (value: unknown, depth: number) => {
    if (depth > 6) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    const obj = record(value);
    if (!obj) return;
    const identity = record(obj.identity);
    const fees = record(obj.fees);
    const profileId = positiveInt(identity?.id);
    if (identity && fees && profileId !== null) {
      name(profileId, identity.name);
      const rows = [...(Array.isArray(fees.verified) ? fees.verified : []), ...(Array.isArray(fees.provisional) ? fees.provisional : [])];
      rows.forEach((row, index) => {
        const fee = record(row);
        const fact = fee ? profileFact(profileId, fee, index) : null;
        if (fact && !facts.has(fact.id)) facts.set(fact.id, fact);
      });
      return;
    }
    // An institution listed by another lookup is named, so its fee is never read as another's.
    if (typeof obj.institution_name === "string") name(positiveInt(obj.institution_id), obj.institution_name);
    else if (typeof obj.name === "string" && ("charter_type" in obj || "state" in obj)) name(positiveInt(obj.id), obj.name);
    for (const child of Object.values(obj)) if (child && typeof child === "object") visit(child, depth + 1);
  };
  for (const output of toolOutputs) visit(output, 0);
  if (facts.size === 0) return null;
  return {
    evidence: {
      version: HAMILTON_EVIDENCE_CONTRACT_VERSION,
      generatedAt: new Date(0).toISOString(),
      facts: [...facts.values()],
      derivations: [],
      limitations: [STORED_SNAPSHOT_LIMITATION],
    },
    names,
  };
}

/** The binding for a written answer, or null when its tool outputs hold no fee record. */
export function bindWrittenAnswer(input: { sections: WrittenAnswerSections; toolOutputs: readonly unknown[]; question?: string }): NarrativeBinding | null {
  const found = writtenAnswerEvidence(input.toolOutputs);
  if (!found) return null;
  const text = writtenAnswerProse(input.sections);
  if (!text.trim()) return null;
  return bindNarrative({ text, evidence: found.evidence, names: found.names, question: input.question });
}

const OMIT_REASONS = new Set<OmitReason>([
  "advice", "instruction_text", "no_evidence", "wrong_institution", "gap_as_fee",
  "wrong_direction", "wrong_period", "wrong_unit", "conflicting_sources",
]);

const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");

/** A saved or sent binding, read defensively: anything malformed reads as no binding. */
export function readNarrativeBinding(value: unknown): NarrativeBinding | null {
  const obj = record(value);
  if (!obj || obj.version !== NARRATIVE_BINDING_VERSION) return null;
  if (!strings(obj.interpretation) || !strings(obj.limitations) || !Array.isArray(obj.supported) || !Array.isArray(obj.omitted)) return null;
  const supported = obj.supported.map(record);
  const omitted = obj.omitted.map(record);
  if (supported.some((s) => !s || typeof s.text !== "string" || !strings(s.factIds))) return null;
  if (omitted.some((o) => !o || typeof o.text !== "string" || !OMIT_REASONS.has(o.reason as OmitReason))) return null;
  return {
    version: NARRATIVE_BINDING_VERSION,
    supported: supported.map((s) => ({ text: s!.text as string, factIds: s!.factIds as string[] })),
    interpretation: obj.interpretation,
    omitted: omitted.map((o) => ({ text: o!.text as string, reason: o!.reason as OmitReason })),
    limitations: obj.limitations,
  };
}

const LIST_MARKER = /^(\s*(?:[-*+]|\d+\.)\s+|\s*>\s*)/;

/**
 * Text without the given sentences, split the way the binding splits them (citation-gate.ts):
 * line by line, then at sentence ends. Line breaks and list markers stay; an emptied line goes.
 */
export function withoutSentences(text: string, drop: ReadonlySet<string>): string {
  if (drop.size === 0 || !text) return text;
  const lines: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const marker = line.match(LIST_MARKER)?.[0] ?? "";
    const prose = line.slice(marker.length);
    const parts = prose.trim().split(/(?<=[.!?])\s+(?=[A-Z("'])/);
    const kept = parts.filter((part) => !drop.has(part.trim()));
    if (kept.length === parts.length) {
      lines.push(line);
      continue;
    }
    const rest = kept.join(" ").trim();
    if (rest) lines.push(`${marker}${rest}`);
  }
  return lines.join("\n");
}

function sectionsWithout<T extends WrittenAnswerSections>(sections: T, drop: ReadonlySet<string>): T {
  if (drop.size === 0) return sections;
  return {
    ...sections,
    hamiltonView: withoutSentences(sections.hamiltonView, drop),
    whatThisMeans: withoutSentences(sections.whatThisMeans, drop),
    whyItMatters: sections.whyItMatters.map((item) => withoutSentences(item, drop)).filter((item) => item.trim()),
  };
}

const trimmedSet = (texts: readonly string[]) => new Set(texts.map((text) => text.trim()));

/** The sections as saved: the sentences the records contradict are left out; the rest stays as written. */
export function withoutOmitted<T extends WrittenAnswerSections>(sections: T, binding: NarrativeBinding | null | undefined): T {
  return binding ? sectionsWithout(sections, trimmedSet(binding.omitted.map((o) => o.text))) : sections;
}

/** True when the binding leaves no sentence of the prose to show, as fact or as Hamilton's reading. */
export function bindingLeavesNothing(sections: WrittenAnswerSections, binding: NarrativeBinding | null | undefined): boolean {
  if (!binding) return false;
  return !writtenAnswerProse(withoutOmitted(sections, binding)).trim();
}

export interface BoundWrittenAnswer<T extends WrittenAnswerSections> {
  /** The sections a reader sees as Hamilton's answer: supported sentences only. */
  sections: T;
  /** Sentences shown only under `INTERPRETATION_LABEL`. */
  reading: string[];
  /** Plain limitation lines for the reader; the label stands in for the interpretation line. */
  notes: string[];
}

/**
 * What the answer view shows for a bound answer. With no binding (an answer saved before it, or
 * one written with no fee record) the sections are returned as they are.
 */
export function applyNarrativeBinding<T extends WrittenAnswerSections>(sections: T, binding: NarrativeBinding | null | undefined): BoundWrittenAnswer<T> {
  if (!binding) return { sections, reading: [], notes: [] };
  const drop = trimmedSet([...binding.omitted.map((o) => o.text), ...binding.interpretation]);
  return {
    sections: sectionsWithout(sections, drop),
    reading: [...new Set(binding.interpretation.map((text) => text.trim()))],
    notes: binding.limitations.filter((line) => line !== INTERPRETATION_LIMITATION),
  };
}

/**
 * The lead for a bound answer whose view has no supported sentence left, so the answer still
 * opens on a plain line rather than on nothing. Null when the view keeps a sentence.
 */
export function boundFallbackLead(bound: BoundWrittenAnswer<WrittenAnswerSections>): string | null {
  if (bound.sections.hamiltonView.trim()) return null;
  if (bound.reading.length > 0) return READING_ONLY_LEAD;
  return writtenAnswerProse(bound.sections).trim() ? PART_LEFT_OUT_LEAD : ALL_LEFT_OUT_LEAD;
}
