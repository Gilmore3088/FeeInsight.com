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
 * Filing figures bind too (#1077, claim contract step 2): the caller passes the claim facts built
 * from the same server-observed reads (claim-evidence.ts), and a filed fee income, balance or
 * peer median binds only to the fact of the institution, metric, quarter and basis the sentence
 * states. With neither a fee record nor a claim fact there is nothing to bind to, so no binding is
 * made and the answer is shown as before, with its untraced figures called out. Pure: no read, no
 * write, no model call; safe to import from the browser.
 */
import {
  HAMILTON_EVIDENCE_CONTRACT_VERSION,
  STORED_SNAPSHOT_LIMITATION,
  type HamiltonEvidenceBundle,
  type HamiltonEvidenceFact,
} from "./evidence-contract";
import { HELD_ANSWER_MESSAGE } from "./answer-gate";
import { bindNarrative, INTERPRETATION_LIMITATION, NARRATIVE_BINDING_VERSION, type NarrativeBinding, type OmitReason } from "./narrative-bound";
import { extractFigures } from "./figure-check";
import { proseFeeName } from "./workspace/names";
import { STATE_NAMES, VALID_US_CODES } from "../us-states";

/** The prose sections of a written answer, as `parseAnalyzeResponse` returns them. */
export interface WrittenAnswerSections {
  hamiltonView: string;
  whatThisMeans: string;
  whyItMatters: string[];
}

/** The lead when every figure sentence of the view is Hamilton's reading. */
export const READING_ONLY_LEAD =
  "Hamilton's reading is below. Its figures are not tied to a fee record, so check them before you use them.";
/** The lead when the view was left out but other sentences of the answer remain. */
export const PART_LEFT_OUT_LEAD =
  "Part of this answer was left out because a figure in it did not match its fee record.";
/** The lead when every sentence of the view was left out. */
export const ALL_LEFT_OUT_LEAD =
  HELD_ANSWER_MESSAGE ?? "This answer didn't pass Hamilton's source check, so it isn't shown. Ask again, or name one fee to compare.";

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
export function writtenAnswerFeeEvidence(toolOutputs: readonly unknown[]): { evidence: HamiltonEvidenceBundle; names: Map<number, string> } | null {
  const { facts, names } = feeFactsAndNames(toolOutputs);
  if (facts.length === 0) return null;
  return {
    evidence: {
      version: HAMILTON_EVIDENCE_CONTRACT_VERSION,
      generatedAt: new Date(0).toISOString(),
      facts,
      derivations: [],
      limitations: [STORED_SNAPSHOT_LIMITATION],
    },
    names,
  };
}

/** The fee records and the institution names the tool outputs give, names kept even with no fee. */
function feeFactsAndNames(toolOutputs: readonly unknown[]): { facts: HamiltonEvidenceFact[]; names: Map<number, string> } {
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
    else if (typeof obj.name === "string" && ("charter_type" in obj || "state" in obj)) name(positiveInt(obj.id) ?? positiveInt(obj.institution_id), obj.name);
    for (const child of Object.values(obj)) if (child && typeof child === "object") visit(child, depth + 1);
  };
  for (const output of toolOutputs) visit(output, 0);
  return { facts: [...facts.values()], names };
}

/**
 * One index statistic a written answer's tools returned (searchIndex, getNationalIndex): a fee
 * type's median or quartile across a stated group of institutions. It is a benchmark, not a fee
 * record, so a sentence that states it stays Hamilton's reading; the basis line says where the
 * figure comes from (#981 H06-T04).
 */
export interface IndexStatistic {
  feeCategory: string;
  statistic: "median" | "p25" | "p75";
  value: number;
  institutionCount: number;
  /** "national", or the filters in words ("TX banks"). */
  scope: string;
  /** The filters the statistic was read with; every one null for the national index. */
  group: IndexGroup;
}

export interface IndexGroup {
  state: string | null;
  charter: "bank" | "credit_union" | null;
  district: string | null;
}

const NATIONAL_GROUP: IndexGroup = { state: null, charter: null, district: null };

const STATISTIC_WORDS: Record<IndexStatistic["statistic"], RegExp> = {
  // "Middle" alone is not the median: "the middle 50%" is the band between the quartiles.
  median: /\b(?:median|midpoint)\b/i,
  p25: /\b(?:25th percentile|lower quartile|first quartile|p25)\b|\bmiddle (?:50%|50 percent|half)/i,
  p75: /\b(?:75th percentile|upper quartile|third quartile|p75)\b|\bmiddle (?:50%|50 percent|half)/i,
};

function indexGroup(filters: Record<string, unknown> | null): IndexGroup {
  if (!filters) return NATIONAL_GROUP;
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
  return {
    state: text(filters.state)?.toUpperCase() ?? null,
    charter: filters.charter === "bank" || filters.charter === "credit_union" ? filters.charter : null,
    district: text(filters.district),
  };
}

function indexScope(group: IndexGroup): string {
  const charter = group.charter === "bank" ? "banks" : group.charter === "credit_union" ? "credit unions" : null;
  const district = group.district ? `Fed district ${group.district}` : null;
  const parts = [group.state, district, charter].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "national";
}

const isNationalGroup = (group: IndexGroup) => !group.state && !group.charter && !group.district;

// Longest names first, each blanked once read, so "West Virginia" is never also read as Virginia.
const STATE_BY_NAME = Object.entries(STATE_NAMES)
  .map(([code, name]) => ({ code, pattern: new RegExp(`\\b${name.replace(/ /g, "\\s+")}\\b`, "i"), length: name.length }))
  .sort((a, b) => b.length - a.length);

// "National" inside a bank's name ("First National Bank", "National Bank of Commerce",
// "Citizens National") names that bank, not the national index. A capitalised word other than a
// sentence opener before it, or a capitalised word after it, makes it part of a name.
const NAME_WORD = "(?!(?:The|A|An|And|At|Across|As|But|By|For|In|Its|On|Our|Than|That|This|To|While|With)\\b)[A-Z][\\w&'.-]*";
const NATIONAL_IN_NAME = new RegExp(`(?:\\b${NAME_WORD}\\s+)+National\\b|\\bNational(?:\\s+(?:of\\s+)?[A-Z][\\w&'.-]*)+`, "g");
// A title-case statistic ("National Median: $29", "National Overdraft Median", "U.S. National
// median") is the national index, though its capitalised neighbours look like a bank's name.
// Lowercasing it first keeps NATIONAL_IN_NAME from blanking it; a word such as Bank in between
// still makes it a name ("National Bank Median").
const INSTITUTION_WORD = "(?:Bank|Banks|Bancorp|Trust|Association|Credit|Union|Savings|Financial|Federal)\\b";
const NATIONAL_STATISTIC = new RegExp(
  `\\bNational((?:\\s+(?!${INSTITUTION_WORD})[A-Z][\\w&'.-]*)*?\\s+(?:[Mm]edian|[Aa]verage|[Mm]ean|[Ii]ndex|[Bb]enchmark|[Pp]ercentile)s?\\b)`,
  "g",
);
const NATIONAL_SCOPE = /\b(?:national(?:ly)?|nationwide|across the (?:country|nation|u\.?s\.?))\b/i;

/** The groups a sentence names: states, charters, Fed districts, or the nation as a whole. */
function namedGroups(sentence: string) {
  let rest = sentence;
  const states = new Set<string>();
  for (const { code, pattern } of STATE_BY_NAME) {
    if (pattern.test(rest)) {
      states.add(code);
      rest = rest.split(pattern).join(" ");
    }
  }
  // A postal code only in capitals, so "in" or "me" in prose is never read as a state.
  for (const code of rest.match(/\b[A-Z]{2}\b/g) ?? []) if (VALID_US_CODES.has(code)) states.add(code);
  const charters = new Set<string>();
  if (/\bbanks\b/i.test(sentence)) charters.add("bank");
  if (/\bcredit unions\b/i.test(sentence)) charters.add("credit_union");
  const districts = new Set((sentence.match(/\bdistrict\s+(\d{1,2})\b/gi) ?? []).map((m) => m.replace(/\D/g, "")));
  const unnamed = sentence.replace(NATIONAL_STATISTIC, "national$1").replace(NATIONAL_IN_NAME, " ");
  const national = NATIONAL_SCOPE.test(unnamed);
  return { states, charters, districts, national };
}

type NamedGroups = ReturnType<typeof namedGroups>;

/**
 * How far a statistic's group is from the one the sentence names: the count of its filters the
 * sentence leaves unnamed. Null when the sentence names a group the statistic does not cover, or
 * calls the figure national when the statistic is filtered.
 */
function groupMisfit(group: IndexGroup, named: NamedGroups): number | null {
  // "National" may sit beside a state ("Texas is above the national median"): it covers the
  // national index whatever else the sentence names.
  if (named.national && isNationalGroup(group)) return 0;
  const dims: Array<[string | null, Set<string>]> = [
    [group.state, named.states],
    [group.charter, named.charters],
    [group.district, named.districts],
  ];
  let unnamed = 0;
  for (const [value, names] of dims) {
    if (names.size > 0 && (value === null || !names.has(value))) return null;
    if (names.size === 0 && value !== null) unnamed += 1;
  }
  if (named.national && unnamed > 0) return null;
  return unnamed;
}

/**
 * The statistic a figure is: same fee, statistic and amount, from the group the sentence names.
 * Null when none fits, or when the closest fits come from different groups.
 */
function statisticFor(sentence: string, figure: { value: number; tolerance: number }, stats: readonly IndexStatistic[], named: NamedGroups): IndexStatistic | null {
  const lower = sentence.toLowerCase();
  let best: IndexStatistic[] = [];
  let bestMisfit = Number.POSITIVE_INFINITY;
  for (const stat of stats) {
    if (Math.abs(stat.value - figure.value) > Math.max(figure.tolerance, 0.005)) continue;
    if (!STATISTIC_WORDS[stat.statistic].test(sentence)) continue;
    if (!lower.includes(proseFeeName(stat.feeCategory).toLowerCase())) continue;
    const misfit = groupMisfit(stat.group, named);
    if (misfit === null || misfit > bestMisfit) continue;
    if (misfit < bestMisfit) best = [];
    bestMisfit = misfit;
    best.push(stat);
  }
  if (best.length === 0 || best.some((stat) => stat.scope !== best[0].scope)) return null;
  return best[0];
}

/** The index statistics in a written answer's tool outputs, as each tool returned them. */
export function writtenAnswerIndexStats(toolOutputs: readonly unknown[]): IndexStatistic[] {
  const stats: IndexStatistic[] = [];
  for (const output of toolOutputs) {
    const obj = record(output);
    if (!obj || !Array.isArray(obj.data)) continue;
    const group = obj.scope === "filtered" ? indexGroup(record(obj.filters)) : NATIONAL_GROUP;
    const scope = indexScope(group);
    for (const item of obj.data) {
      const row = record(item);
      const count = positiveInt(row?.institution_count);
      if (!row || typeof row.category !== "string" || count === null) continue;
      for (const statistic of ["median", "p25", "p75"] as const) {
        const value = row[statistic];
        if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
          stats.push({ feeCategory: row.category, statistic, value, institutionCount: count, scope, group });
        }
      }
    }
  }
  return stats;
}

const STATISTIC_LABEL: Record<IndexStatistic["statistic"], string> = { median: "median", p25: "25th percentile", p75: "75th percentile" };

/**
 * The basis line for a sentence of Hamilton's reading whose figure is an index statistic the
 * tools returned: the sentence names that fee, the statistic and its group, and the figure equals
 * it to the cent. Null when no figure in the sentence is one; a sentence that names a group no
 * statistic covers gets no line rather than another group's.
 */
export function indexBasisFor(sentence: string, stats: readonly IndexStatistic[]): string | null {
  const named = namedGroups(sentence);
  const lines: string[] = [];
  for (const figure of extractFigures(sentence)) {
    if (figure.kind !== "usd") continue;
    const match = statisticFor(sentence, figure, stats, named);
    if (!match) continue;
    const scope = match.scope === "national" ? "national index" : `index for ${match.scope}`;
    const line = `${proseFeeName(match.feeCategory)} ${STATISTIC_LABEL[match.statistic]} from the ${scope}, ${match.institutionCount.toLocaleString("en-US")} institutions`;
    if (!lines.includes(line)) lines.push(line);
  }
  return lines.length > 0 ? `Basis: ${lines.join("; ")}.` : null;
}

export interface BindWrittenAnswerInput {
  sections: WrittenAnswerSections;
  toolOutputs: readonly unknown[];
  question?: string;
  /** The filing and filed-peer facts from the same server-observed reads (claimEvidenceFacts). */
  claims?: HamiltonEvidenceBundle | null;
  /** The reader's own institution, which "your" in a sentence means. */
  accountInstitutionId?: number | null;
  /** The research subject, which a sentence naming no institution is about. */
  researchInstitutionId?: number | null;
}

/** The binding for a written answer, or null when its tool outputs hold no fee record and no claim fact. */
export function bindWrittenAnswer(input: BindWrittenAnswerInput): NarrativeBinding | null {
  const { facts, names } = feeFactsAndNames(input.toolOutputs);
  const claimFacts = input.claims?.facts ?? [];
  const claimDerivations = input.claims?.derivations ?? [];
  if (facts.length + claimFacts.length + claimDerivations.length === 0) return null;
  const text = writtenAnswerProse(input.sections);
  if (!text.trim()) return null;
  const evidence: HamiltonEvidenceBundle = {
    version: HAMILTON_EVIDENCE_CONTRACT_VERSION,
    generatedAt: new Date(0).toISOString(),
    facts: [...facts, ...claimFacts],
    derivations: claimDerivations,
    limitations: [STORED_SNAPSHOT_LIMITATION, ...(input.claims?.limitations ?? [])],
  };
  const binding = bindNarrative({ text, evidence, names, question: input.question,
    accountInstitutionId: input.accountInstitutionId, researchInstitutionId: input.researchInstitutionId });
  const stats = writtenAnswerIndexStats(input.toolOutputs);
  const readingBasis = stats.length > 0
    ? binding.interpretation.flatMap((sentence) => {
      const basis = indexBasisFor(sentence, stats);
      return basis ? [{ text: sentence, basis }] : [];
    })
    : [];
  return readingBasis.length > 0 ? { ...binding, readingBasis } : binding;
}

const OMIT_REASONS = new Set<OmitReason>([
  "advice", "instruction_text", "no_evidence", "wrong_institution", "gap_as_fee",
  "wrong_direction", "wrong_period", "wrong_unit", "conflicting_sources", "median_as_fee",
  "wrong_basis", "account_as_subject", "premise_contradicted", "premise_unsupported",
]);

/** True for an omit reason a saved binding or saved claims may carry. */
export function isOmitReason(value: unknown): value is OmitReason {
  return typeof value === "string" && OMIT_REASONS.has(value as OmitReason);
}

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
  const basis = Array.isArray(obj.readingBasis)
    ? obj.readingBasis.map(record).filter((b): b is Record<string, unknown> => !!b && typeof b.text === "string" && typeof b.basis === "string")
    : [];
  return {
    version: NARRATIVE_BINDING_VERSION,
    supported: supported.map((s) => ({ text: s!.text as string, factIds: s!.factIds as string[] })),
    interpretation: obj.interpretation,
    omitted: omitted.map((o) => ({ text: o!.text as string, reason: o!.reason as OmitReason })),
    limitations: obj.limitations,
    ...(basis.length > 0 ? { readingBasis: basis.map((b) => ({ text: b.text as string, basis: b.basis as string })) } : {}),
    ...(strings(obj.corrections) && obj.corrections.length > 0 ? { corrections: obj.corrections } : {}),
  };
}

/**
 * A binding as a reader-facing response sends it: each left-out sentence by its reason only.
 * `readNarrativeBinding` cannot read it back (it rejects an omitted entry with no text), so it is
 * never for a saved row; the Analyze screen reads a sent one with `readSentNarrativeBinding`.
 */
export interface ReaderNarrativeBinding extends Omit<NarrativeBinding, "omitted"> {
  omitted: Array<{ reason: OmitReason }>;
}

/**
 * One sentence as both splitters see it, for comparing a gate cut with a binding sentence. The
 * gate's split (`gateSentences`) strips a list marker or a blockquote marker; the binding's
 * (`splitIntoSentences`) strips a list marker and then a blockquote marker, so on a `- > ...` line
 * their texts differ. Every leading list and blockquote marker goes here, on both sides.
 */
export function sentenceMatchKey(text: string): string {
  return text.trim().replace(/^(?:(?:[-*+]|\d+\.)\s+|>\s*)+/, "").trim();
}

/**
 * The binding a buffered JSON response may carry (#1077 follow-up). It never holds the text of a
 * sentence the reader's view left out: the binding's omitted sentences keep their reason and their
 * count but lose their text, and a sentence the gate cut from the view (`cut`) is dropped from the
 * supported, reading and basis lists (matched by `sentenceMatchKey`). Keys keep the binding's own
 * order, so a binding with nothing omitted or cut serialises exactly as before. The saved row keeps
 * the full binding (reports read it server side). A held streamed Analyze answer sends it too, with
 * text that no longer holds the left-out sentences; a stream that is not held (no held line, or no
 * mode) still sends the full binding, since its text streams before the binding is known.
 */
export function readerNarrativeBinding(binding: NarrativeBinding, cut: Iterable<string> = []): ReaderNarrativeBinding {
  const drop = new Set([...cut].map(sentenceMatchKey));
  const kept = (text: string) => !drop.has(sentenceMatchKey(text));
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(binding)) {
    if (key === "supported") out[key] = binding.supported.filter((s) => kept(s.text));
    else if (key === "interpretation") out[key] = binding.interpretation.filter(kept);
    else if (key === "omitted") out[key] = binding.omitted.map((o) => ({ reason: o.reason }));
    else if (key === "readingBasis") out[key] = (binding.readingBasis ?? []).filter((b) => kept(b.text));
    else out[key] = value;
  }
  return out as unknown as ReaderNarrativeBinding;
}

/**
 * A binding the route sent to the screen (#1077 follow-up): a full binding, or the reader binding
 * of a held streamed answer, whose omitted entries carry only a reason. Each such entry reads with
 * empty text, which drops nothing (`trimmedSet` skips it), so its reason and count stay. Anything
 * else malformed reads as no binding, as with `readNarrativeBinding`.
 */
export function readSentNarrativeBinding(value: unknown): NarrativeBinding | null {
  const obj = record(value);
  if (!obj || !Array.isArray(obj.omitted)) return readNarrativeBinding(value);
  const omitted = obj.omitted.map((entry) => {
    const item = record(entry);
    return item && item.text === undefined ? { text: "", ...item } : entry;
  });
  return readNarrativeBinding({ ...obj, omitted });
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

/** The texts to drop, trimmed; an empty text (a sent binding's left-out entry) drops nothing. */
const trimmedSet = (texts: readonly string[]) => new Set(texts.map((text) => text.trim()).filter(Boolean));

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
  /** The basis line for each reading sentence whose figure is an index statistic, by sentence. */
  basis: Record<string, string>;
}

function basisBySentence(binding: NarrativeBinding | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of binding?.readingBasis ?? []) out[item.text.trim()] = item.basis;
  return out;
}

/**
 * What the answer view shows for a bound answer. With no binding (an answer saved before it, or
 * one written with no fee record) the sections are returned as they are.
 */
export function applyNarrativeBinding<T extends WrittenAnswerSections>(sections: T, binding: NarrativeBinding | null | undefined): BoundWrittenAnswer<T> {
  if (!binding) return { sections, reading: [], notes: [], basis: {} };
  const drop = trimmedSet([...binding.omitted.map((o) => o.text), ...binding.interpretation]);
  return {
    sections: sectionsWithout(sections, drop),
    reading: [...new Set(binding.interpretation.map((text) => text.trim()))],
    notes: binding.limitations.filter((line) => line !== INTERPRETATION_LIMITATION),
    basis: basisBySentence(binding),
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

/** The sentence binding a saved answer carries: a written answer's own, else its memo's. */
export function savedAnswerBinding(analysis: { narrativeBinding?: unknown; memo?: { narrativeBinding?: unknown } | null }): NarrativeBinding | null {
  return readNarrativeBinding(analysis.narrativeBinding) ?? readNarrativeBinding(analysis.memo?.narrativeBinding);
}

/** A saved answer as an export prints it (#981 H06-T08, #980 H05-T07). */
export interface ExportedAnswer {
  /** The opening line: the first supported sentence of the view, or the plain lead when none is left. */
  hamiltonView: string;
  whatThisMeans: string;
  whyItMatters: string[];
  /** Sentences printed only under `INTERPRETATION_LABEL`, as the screen shows them. */
  reading: string[];
  /** The basis line under a reading sentence whose figure is an index statistic, by sentence. */
  readingBasis: Record<string, string>;
}

/**
 * The saved answer the way the screen shows it, for the PDF and the board brief: sentences the
 * records contradict are left out, Hamilton's reading moves under its label, and a view with no
 * supported sentence opens on the same plain lead the screen uses. An answer with no binding
 * (saved before it, or written with no fee record) is printed as saved.
 */
export function exportedAnswer(analysis: WrittenAnswerSections & { narrativeBinding?: unknown; memo?: { narrativeBinding?: unknown } | null }): ExportedAnswer {
  const binding = savedAnswerBinding(analysis);
  const sections = { hamiltonView: analysis.hamiltonView ?? "", whatThisMeans: analysis.whatThisMeans ?? "", whyItMatters: analysis.whyItMatters ?? [] };
  const bound = applyNarrativeBinding(sections, binding);
  const lead = binding ? boundFallbackLead(bound) : null;
  return {
    hamiltonView: lead ?? bound.sections.hamiltonView,
    whatThisMeans: bound.sections.whatThisMeans,
    whyItMatters: bound.sections.whyItMatters,
    reading: bound.reading,
    readingBasis: bound.basis,
  };
}
