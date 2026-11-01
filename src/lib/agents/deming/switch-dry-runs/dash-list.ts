import { runCase } from "@/lib/agents/deming/shadow-lab/run-case";
import { toCents, toDollars, verifiedRow } from "@/lib/agents/deming/shadow-lab/rows";
import type { PublishedFee, ShadowCase } from "@/lib/agents/deming/shadow-lab/types";
import { currentVariant, EXPERIMENTS, experimentalVariant } from "@/lib/agents/deming/shadow-lab/variants";
import { decidePriorFee, normalizedFeeName, publishedFeeName, sameValueLinesApart, type PriorFeeDecision } from "@/lib/agents/hamilton/publish";
import { dashListRuns } from "@/lib/agents/knox/dash-list-rows";
import type { DocumentRow, LiveFeeRow } from "./types";

/**
 * `DASH_LIST_ROWS_LIVE` (#2834, Knox v148): what the full dash-list rewrite changes on live documents.
 * Each document's newest stored text is replayed through the shadow lab's stages (Knox's free read
 * `runFreeSpecialists`, Darwin's per-row verify checks, Hamilton's publish gate), once as today
 * (`currentVariant`) and once with the switch on (the `dash-list-rows` experiment). Two counts:
 * - live fees on the document that today's reading reads and the switch-on reading no longer does,
 *   matched on category, amount and Hamilton's normalized name (`normalizedFeeName`);
 * - switch-on reads today's reading does not make that Hamilton's `decidePriorFee` would publish
 *   beside a live fee of the same name and category at another price.
 * Not replayed (DB-bound): Knox's learned lessons and paid reads, Darwin's peer check and audience
 * admission, and Hamilton's later same-line and duplicate refusals. Pure.
 */

const fullRewrite = experimentalVariant(EXPERIMENTS["dash-list-rows"]);

/** Hamilton's identity of a single check, State key 10272's known wrong live fee (#2834). */
export const WATCH_NAME = "stop payment single check";
export const WATCH_CENTS = 3500;

export interface ReadRef {
  canonicalFeeKey: string;
  feeName: string;
  amountCents: number;
  frequency: string | null;
}

export interface LiveRef {
  feePublishedId: number;
  institutionId: number;
  institutionName: string | null;
  sourceDocumentId: number | null;
  canonicalFeeKey: string;
  feeName: string;
  amountCents: number | null;
}

export interface BesideRead extends ReadRef {
  institutionId: number;
  institutionName: string | null;
  sourceDocumentId: number;
  decision: PriorFeeDecision["kind"];
  /** The live fees of the same name and category at another price. */
  sameNamed: LiveRef[];
}

export interface WatchEntry {
  live: LiveRef;
  readToday: boolean;
  readSwitchOn: boolean;
  /** Prices the switch-on reading gives the same name and category. */
  switchOnCents: number[];
}

export interface DashDocumentResult {
  sourceDocumentId: number;
  runs: number;
  changed: boolean;
  lost: LiveRef[];
  /** Live fees on the document neither reading matches (older reads; not the switch's doing). */
  unmatchedLive: number;
  added: ReadRef[];
  addedByDecision: Partial<Record<PriorFeeDecision["kind"], number>>;
  beside: BesideRead[];
  watch: WatchEntry[];
}

const nameOf = (name: string | null | undefined): string => normalizedFeeName(name ?? "");

function asRead(fee: PublishedFee): ReadRef | null {
  if (!fee.canonicalFeeKey || fee.amountCents == null) return null;
  return { canonicalFeeKey: fee.canonicalFeeKey, feeName: fee.feeName ?? "", amountCents: fee.amountCents, frequency: fee.frequency ?? null };
}

const readKey = (read: ReadRef): string => `${read.canonicalFeeKey}|${read.amountCents}|${nameOf(read.feeName)}`;

function liveRef(live: LiveFeeRow): LiveRef {
  return {
    feePublishedId: Number(live.fee_published_id),
    institutionId: Number(live.institution_id),
    institutionName: live.institution_name,
    sourceDocumentId: live.source_document_id == null ? null : Number(live.source_document_id),
    canonicalFeeKey: live.canonical_fee_key,
    feeName: live.fee_name,
    amountCents: toCents(live.amount),
  };
}

/** The live fee's names as Hamilton compares them: published, and as Knox read it. */
function liveNames(live: LiveFeeRow): Set<string> {
  return new Set([nameOf(live.fee_name), nameOf(live.raw_fee_name)].filter(Boolean));
}

/** A read names the live fee: same category, same amount, same normalized name. */
export function readMatchesLive(read: ReadRef, live: LiveFeeRow): boolean {
  if (read.canonicalFeeKey !== live.canonical_fee_key || read.amountCents !== toCents(live.amount)) return false;
  const names = liveNames(live);
  return names.has(nameOf(read.feeName)) || names.has(nameOf(publishedFeeName(read.feeName, read.canonicalFeeKey)));
}

function sameNamedOtherPrice(read: ReadRef, live: readonly LiveFeeRow[]): LiveFeeRow[] {
  const name = nameOf(read.feeName);
  return live.filter((fee) => fee.canonical_fee_key === read.canonicalFeeKey && liveNames(fee).has(name) && toCents(fee.amount) !== read.amountCents);
}

function replay(doc: DocumentRow, text: string, variant: typeof currentVariant): ReadRef[] {
  const shadowCase: ShadowCase = {
    caseKey: `doc:${doc.source_document_id}`,
    scenario: "missed_fees",
    provenance: { fixture: "production", fixtureCaseKey: String(doc.source_document_id), textHash: null, issue: "1092" },
    document: { url: doc.document_url, text },
    expected: { publish: [], forbid: [] },
    status: "ok",
  };
  return runCase(variant, shadowCase).published.map(asRead).filter((read): read is ReadRef => read != null);
}

/** Hamilton's decision for a switch-on read against the institution's live fees of its category. */
function priorDecision(read: ReadRef, doc: DocumentRow, text: string, live: readonly LiveFeeRow[]): PriorFeeDecision {
  const row = verifiedRow(
    { canonical_fee_key: read.canonicalFeeKey, fee_name: read.feeName, amount: toDollars(read.amountCents) ?? "0.00", source_document_id: Number(doc.source_document_id) },
    {
      institution_id: Number(doc.institution_id),
      frequency: read.frequency,
      source_url: doc.document_url,
      document_url: doc.document_url,
      document_crawled_at: doc.crawled_at,
      document_stream: doc.document_stream,
    },
  );
  // As `selectLivePublishedFees` narrows them: same category, variant (a read has none) and frequency.
  const priors = live.filter(
    (fee) => fee.canonical_fee_key === read.canonicalFeeKey && !fee.variant_type && (fee.frequency ?? "") === (read.frequency ?? ""),
  );
  const apart = sameValueLinesApart(row, priors, text);
  return decidePriorFee(row, priors, (prior) => apart.has(prior));
}

/** One document: both readings, the live fees the switch stops reading, and the reads it adds. */
export function replayDashDocument(doc: DocumentRow, text: string, institutionLive: readonly LiveFeeRow[]): DashDocumentResult {
  const documentId = Number(doc.source_document_id);
  const runs = dashListRuns(text).length;
  const empty: DashDocumentResult = { sourceDocumentId: documentId, runs, changed: false, lost: [], unmatchedLive: 0, added: [], addedByDecision: {}, beside: [], watch: [] };
  if (runs === 0) return empty;
  const today = replay(doc, text, currentVariant);
  const switchOn = replay(doc, text, fullRewrite);
  const todayKeys = new Set(today.map(readKey));
  const onKeys = new Set(switchOn.map(readKey));
  const changed = todayKeys.size !== onKeys.size || [...todayKeys].some((key) => !onKeys.has(key));
  const onDocument = institutionLive.filter((fee) => fee.source_document_id != null && Number(fee.source_document_id) === documentId);
  const readsLive = (reads: ReadRef[], fee: LiveFeeRow) => reads.some((read) => readMatchesLive(read, fee));
  const lost = onDocument.filter((fee) => readsLive(today, fee) && !readsLive(switchOn, fee)).map(liveRef);
  const unmatchedLive = onDocument.filter((fee) => !readsLive(today, fee) && !readsLive(switchOn, fee)).length;
  const added = switchOn.filter((read) => !todayKeys.has(readKey(read)));
  const addedByDecision: DashDocumentResult["addedByDecision"] = {};
  const beside: BesideRead[] = [];
  for (const read of added) {
    const decision = priorDecision(read, doc, text, institutionLive).kind;
    addedByDecision[decision] = (addedByDecision[decision] ?? 0) + 1;
    const sameNamed = sameNamedOtherPrice(read, institutionLive);
    if ((decision === "additional_line" || decision === "new") && sameNamed.length > 0) {
      beside.push({
        ...read,
        institutionId: Number(doc.institution_id),
        institutionName: doc.institution_name,
        sourceDocumentId: documentId,
        decision,
        sameNamed: sameNamed.map(liveRef),
      });
    }
  }
  const watch = onDocument
    .filter((fee) => nameOf(fee.fee_name) === WATCH_NAME && toCents(fee.amount) === WATCH_CENTS)
    .map((fee) => ({
      live: liveRef(fee),
      readToday: readsLive(today, fee),
      readSwitchOn: readsLive(switchOn, fee),
      switchOnCents: switchOn.filter((read) => read.canonicalFeeKey === fee.canonical_fee_key && nameOf(read.feeName) === WATCH_NAME).map((read) => read.amountCents),
    }));
  return { sourceDocumentId: documentId, runs, changed, lost, unmatchedLive, added, addedByDecision, beside, watch };
}

export interface DashListSummary {
  documentsRead: number;
  documentsWithRuns: number;
  documentsChanged: number;
  lost: number;
  unmatchedLive: number;
  added: number;
  addedByDecision: Partial<Record<PriorFeeDecision["kind"], number>>;
  beside: number;
  lostSamples: LiveRef[];
  besideSamples: BesideRead[];
  /** Every live "Stop Payment (single check)" $35 on a document read (State key 10272's wrong fee). */
  watch: WatchEntry[];
}

export function emptyDashListSummary(): DashListSummary {
  return { documentsRead: 0, documentsWithRuns: 0, documentsChanged: 0, lost: 0, unmatchedLive: 0, added: 0, addedByDecision: {}, beside: 0, lostSamples: [], besideSamples: [], watch: [] };
}

export function addDashDocument(summary: DashListSummary, result: DashDocumentResult, sampleCap: number): DashListSummary {
  summary.documentsRead += 1;
  if (result.runs > 0) summary.documentsWithRuns += 1;
  if (result.changed) summary.documentsChanged += 1;
  summary.lost += result.lost.length;
  summary.unmatchedLive += result.unmatchedLive;
  summary.added += result.added.length;
  summary.beside += result.beside.length;
  for (const [kind, count] of Object.entries(result.addedByDecision) as Array<[PriorFeeDecision["kind"], number]>) {
    summary.addedByDecision[kind] = (summary.addedByDecision[kind] ?? 0) + count;
  }
  summary.lostSamples.push(...result.lost.slice(0, Math.max(0, sampleCap - summary.lostSamples.length)));
  summary.besideSamples.push(...result.beside.slice(0, Math.max(0, sampleCap - summary.besideSamples.length)));
  summary.watch.push(...result.watch);
  return summary;
}
