import { runCase } from "@/lib/agents/deming/shadow-lab/run-case";
import { toCents, toDollars, verifiedRow } from "@/lib/agents/deming/shadow-lab/rows";
import type { PublishedFee, ShadowCase } from "@/lib/agents/deming/shadow-lab/types";
import { EXPERIMENTS, experimentalVariant } from "@/lib/agents/deming/shadow-lab/variants";
import { decidePriorFee, normalizedFeeName, publishedFeeName, sameValueLinesApart, type PriorFeeDecision, type VerifiedFeeRow } from "@/lib/agents/hamilton/publish";
import { darwinAudience } from "@/lib/agents/darwin/audience";
import { dashListRuns } from "@/lib/agents/knox/dash-list-rows";
import { feeApplicability } from "@/lib/fee-audience";
import type { DocumentRow, LiveFeeRow } from "./types";

/**
 * `DASH_LIST_ROWS_LIVE` (#2834, Knox v148): what the full dash-list rewrite changes on live documents.
 * Each document's newest stored text is replayed through the shadow lab's stages (Knox's free read
 * `runFreeSpecialists`, Darwin's per-row verify checks, Hamilton's publish gate), once as today
 * (the switch passed off, `switchOff`) and once with the switch on (the `dash-list-rows` experiment). Two counts:
 * - live fees on the document that today's reading reads and the switch-on reading no longer does,
 *   matched on category, amount and Hamilton's normalized name (`normalizedFeeName`);
 * - switch-on reads today's reading does not make that Hamilton's `decidePriorFee` would publish
 *   beside a live fee of the same name, category and audience at another price.
 * A read's audience is the one live Darwin publishes: Knox's own-line reading (`feeApplicability`,
 * as `candidateWriteFacts` writes it), then Darwin's decision on the bound text (`darwinAudience`
 * with its own-price clause), and Hamilton compares it only with live fees of that audience.
 * Steps the replay cannot run are listed in `DASH_LIST_NOT_REPLAYED`, printed with every report.
 * Pure.
 */

/** What the replay leaves out; each can change the counts, so the report prints the list. */
export const DASH_LIST_NOT_REPLAYED: readonly string[] = [
  "Knox's learned lessons (role, category and audience lessons) and Knox's paid reads",
  "Darwin's peer-outlier check, learned envelopes and same-batch duplicate check",
  "Darwin's audience admission against the locked current raw row (the audience is recomputed from the stored text)",
  "Hamilton's later refusals: exact duplicates, page copies, same-line reads and sweep rules",
  "Hamilton's product-key filter on prior rows (a replayed read carries no product)",
  "Live fees on documents the replay does not read, and live fees neither reading reproduces (counted as not assessed)",
];

const fullRewrite = experimentalVariant(EXPERIMENTS["dash-list-rows"]);
/** The reading with the switch passed off, whatever the code default (on since 2026-11-02). */
const switchOff = experimentalVariant({ ...EXPERIMENTS["dash-list-rows"], id: "dash-list-rows-off", dashListRows: false });

/** Hamilton's identity of a single check, State key 10272's known wrong live fee (#2834). */
export const WATCH_NAME = "stop payment single check";
export const WATCH_CENTS = 3500;

export interface ReadRef {
  canonicalFeeKey: string;
  feeName: string;
  amountCents: number;
  frequency: string | null;
  excerpt: string | null;
}

export interface LiveRef {
  feePublishedId: number;
  feeAudience: string;
  institutionId: number;
  institutionName: string | null;
  sourceDocumentId: number | null;
  canonicalFeeKey: string;
  feeName: string;
  amountCents: number | null;
}

export interface BesideRead extends ReadRef {
  feeAudience: string;
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
  /** Live fees on the document neither reading reproduces: the replay cannot say what the switch does to them. */
  notAssessed: LiveRef[];
  added: ReadRef[];
  addedByDecision: Partial<Record<PriorFeeDecision["kind"], number>>;
  beside: BesideRead[];
  watch: WatchEntry[];
}

const nameOf = (name: string | null | undefined): string => normalizedFeeName(name ?? "");

function asRead(fee: PublishedFee): ReadRef | null {
  if (!fee.canonicalFeeKey || fee.amountCents == null) return null;
  return { canonicalFeeKey: fee.canonicalFeeKey, feeName: fee.feeName ?? "", amountCents: fee.amountCents, frequency: fee.frequency ?? null, excerpt: fee.excerpt ?? null };
}

const readKey = (read: ReadRef): string => `${read.canonicalFeeKey}|${read.amountCents}|${nameOf(read.feeName)}`;

function liveRef(live: LiveFeeRow): LiveRef {
  return {
    feePublishedId: Number(live.fee_published_id),
    feeAudience: audienceOf(live),
    institutionId: Number(live.institution_id),
    institutionName: live.institution_name,
    sourceDocumentId: live.source_document_id == null ? null : Number(live.source_document_id),
    canonicalFeeKey: live.canonical_fee_key,
    feeName: live.fee_name,
    amountCents: toCents(live.amount),
  };
}

const audienceOf = (live: LiveFeeRow): string => live.fee_audience ?? "unknown";

/** The audience live Darwin would publish the read under (see the module note). */
export function readAudience(read: ReadRef, doc: DocumentRow, text: string): string {
  const amount = read.amountCents / 100;
  const knox = feeApplicability(read.feeName, read.excerpt, amount).feeAudience;
  const darwin = darwinAudience({ fee_audience: knox, source_url: doc.document_url, fee_name: read.feeName }, amount, text, { ownPriceClause: true });
  return darwin?.feeAudience ?? knox;
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

/** Live fees of the read's name, category and audience at another price (a rate or no amount is another price). */
function sameNamedOtherPrice(read: ReadRef, audience: string, live: readonly LiveFeeRow[]): LiveFeeRow[] {
  const name = nameOf(read.feeName);
  return live.filter((fee) =>
    fee.canonical_fee_key === read.canonicalFeeKey && audienceOf(fee) === audience && liveNames(fee).has(name) &&
    (fee.amount_kind === "percent" || toCents(fee.amount) !== read.amountCents));
}

function replay(doc: DocumentRow, text: string, variant: typeof fullRewrite): ReadRef[] {
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
function priorDecision(read: ReadRef, audience: string, doc: DocumentRow, text: string, live: readonly LiveFeeRow[]): PriorFeeDecision {
  const row = verifiedRow(
    { canonical_fee_key: read.canonicalFeeKey, fee_name: read.feeName, amount: toDollars(read.amountCents) ?? "0.00", source_document_id: Number(doc.source_document_id) },
    {
      institution_id: Number(doc.institution_id),
      frequency: read.frequency,
      source_url: doc.document_url,
      document_url: doc.document_url,
      document_crawled_at: doc.crawled_at,
      document_stream: doc.document_stream,
      fee_audience: audience as VerifiedFeeRow["fee_audience"],
    },
  );
  // As `selectLivePublishedFees` narrows them: same category, audience, variant (a read has none) and frequency.
  const priors = live.filter(
    (fee) =>
      fee.canonical_fee_key === read.canonicalFeeKey && audienceOf(fee) === audience &&
      !fee.variant_type && (fee.frequency ?? "") === (read.frequency ?? ""),
  );
  const apart = sameValueLinesApart(row, priors, text);
  return decidePriorFee(row, priors, (prior) => apart.has(prior));
}

/** One document: both readings, the live fees the switch stops reading, and the reads it adds. */
export function replayDashDocument(doc: DocumentRow, text: string, institutionLive: readonly LiveFeeRow[]): DashDocumentResult {
  const documentId = Number(doc.source_document_id);
  const runs = dashListRuns(text).length;
  const empty: DashDocumentResult = { sourceDocumentId: documentId, runs, changed: false, lost: [], notAssessed: [], added: [], addedByDecision: {}, beside: [], watch: [] };
  if (runs === 0) return empty;
  const today = replay(doc, text, switchOff);
  const switchOn = replay(doc, text, fullRewrite);
  const todayKeys = new Set(today.map(readKey));
  const onKeys = new Set(switchOn.map(readKey));
  const changed = todayKeys.size !== onKeys.size || [...todayKeys].some((key) => !onKeys.has(key));
  const onDocument = institutionLive.filter((fee) => fee.source_document_id != null && Number(fee.source_document_id) === documentId);
  const readsLive = (reads: ReadRef[], fee: LiveFeeRow) => reads.some((read) => readMatchesLive(read, fee));
  const lost = onDocument.filter((fee) => readsLive(today, fee) && !readsLive(switchOn, fee)).map(liveRef);
  const notAssessed = onDocument.filter((fee) => !readsLive(today, fee) && !readsLive(switchOn, fee)).map(liveRef);
  const added = switchOn.filter((read) => !todayKeys.has(readKey(read)));
  const addedByDecision: DashDocumentResult["addedByDecision"] = {};
  const beside: BesideRead[] = [];
  for (const read of added) {
    const audience = readAudience(read, doc, text);
    const decision = priorDecision(read, audience, doc, text, institutionLive).kind;
    addedByDecision[decision] = (addedByDecision[decision] ?? 0) + 1;
    const sameNamed = sameNamedOtherPrice(read, audience, institutionLive);
    if ((decision === "additional_line" || decision === "new") && sameNamed.length > 0) {
      beside.push({
        ...read,
        feeAudience: audience,
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
  return { sourceDocumentId: documentId, runs, changed, lost, notAssessed, added, addedByDecision, beside, watch };
}

export interface DashListSummary {
  documentsRead: number;
  documentsWithRuns: number;
  documentsChanged: number;
  lost: number;
  /** Live fees on documents read that neither reading reproduces. */
  notAssessed: number;
  added: number;
  addedByDecision: Partial<Record<PriorFeeDecision["kind"], number>>;
  beside: number;
  lostSamples: LiveRef[];
  notAssessedSamples: LiveRef[];
  besideSamples: BesideRead[];
  /** Every live "Stop Payment (single check)" $35 on a document read (State key 10272's wrong fee). */
  watch: WatchEntry[];
}

export function emptyDashListSummary(): DashListSummary {
  return {
    documentsRead: 0, documentsWithRuns: 0, documentsChanged: 0, lost: 0, notAssessed: 0, added: 0, addedByDecision: {}, beside: 0,
    lostSamples: [], notAssessedSamples: [], besideSamples: [], watch: [],
  };
}

export function addDashDocument(summary: DashListSummary, result: DashDocumentResult, sampleCap: number): DashListSummary {
  summary.documentsRead += 1;
  if (result.runs > 0) summary.documentsWithRuns += 1;
  if (result.changed) summary.documentsChanged += 1;
  summary.lost += result.lost.length;
  summary.notAssessed += result.notAssessed.length;
  summary.added += result.added.length;
  summary.beside += result.beside.length;
  for (const [kind, count] of Object.entries(result.addedByDecision) as Array<[PriorFeeDecision["kind"], number]>) {
    summary.addedByDecision[kind] = (summary.addedByDecision[kind] ?? 0) + count;
  }
  summary.lostSamples.push(...result.lost.slice(0, Math.max(0, sampleCap - summary.lostSamples.length)));
  summary.notAssessedSamples.push(...result.notAssessed.slice(0, Math.max(0, sampleCap - summary.notAssessedSamples.length)));
  summary.besideSamples.push(...result.beside.slice(0, Math.max(0, sampleCap - summary.besideSamples.length)));
  summary.watch.push(...result.watch);
  return summary;
}
