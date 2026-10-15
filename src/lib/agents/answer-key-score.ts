import { sql } from "@/lib/data-store/connection";
import {
  ANSWER_KEY_SCORER_VERSION,
  ANSWER_KEY_SCORER_VERSIONS,
  answerKeySchemaReady,
  getConfirmedAnswerKey,
  type AnswerKeyScorerVersion,
  type AnswerKeyAmountKind,
  type AnswerKeyDocumentType,
  type ConfirmedAnswerKeyEntry,
} from "@/lib/data-store/answer-key";
import { getFeeFamily } from "@/lib/fee-taxonomy";

/**
 * Atlas's score-answer-key step: compares the pipeline against the hand-checked
 * answer key, stage by stage, for every confirmed institution. Deterministic and
 * read-only over the pipeline tables (it writes one answer_key_score_runs row);
 * never calls a model.
 *
 *   magellan  found the right document: normalized URL match, or the same content hash
 *   rosetta   produced a completed text of that right document
 *   knox      raw rows (canonical hint + amount within 1 cent)
 *   darwin    verified rows filed under the right category with the right amount
 *   hamilton  live published_fee_catalog rows with the right amount (end to end); from v3
 *             also published_fee_rate_catalog rows (fees stated as a rate)
 *
 * Document stages score per institution (precision: right / any found; recall:
 * right / confirmed institutions). Fee stages score per fee (precision: matching
 * distinct (category, amount) predictions / all predictions; recall: expected fees
 * found / expected fees). "Overall" is the Hamilton stage: what readers see.
 *
 * Three scorer versions run side by side, each stored as its own series (#1280):
 *   v1  Magellan is the bank's newest stored document; Rosetta its newest text; the
 *       fee stages compare every row at the bank with the key's one document.
 *   v2  Magellan is the bank's link (`fee_schedule_url`) or its stored copy; Rosetta a
 *       completed text of the key's document; the fee stages score only rows read
 *       from the key's document (same URL or same bytes). Rows from the bank's other
 *       documents, and rows with no document, are counted on their own and not scored.
 *   v3  v2, plus Hamilton's fees published as a rate (`published_fee_rate_catalog`,
 *       src/lib/percent-fees.ts). A rate is never compared with a dollar amount: it can
 *       match only a key fee keyed as "varies" in the same category, and counts as its own
 *       prediction (category + rate).
 */

type SqlTag = typeof sql;

export { ANSWER_KEY_SCORER_VERSION, ANSWER_KEY_SCORER_VERSIONS, type AnswerKeyScorerVersion };

export const SCORED_STAGES = ["magellan", "rosetta", "knox", "darwin", "hamilton"] as const;
export type ScoredStage = (typeof SCORED_STAGES)[number];
const FEE_STAGES = ["knox", "darwin", "hamilton"] as const;
type FeeStage = (typeof FEE_STAGES)[number];

const AMOUNT_TOLERANCE = 0.01 + 1e-9;

/** Same document regardless of scheme, www., case, trailing slash, fragment or tracking params. */
export function normalizeDocumentUrl(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const params = [...url.searchParams.entries()]
      .filter(([key]) => !/^(utm_|gclid$|fbclid$|mc_)/i.test(key))
      .sort(([a], [b]) => a.localeCompare(b));
    const query = params.length ? `?${new URLSearchParams(params).toString()}` : "";
    const path = decodeURIComponent(url.pathname).replace(/\/+$/, "").toLowerCase();
    return `${host}${path}${query}`;
  } catch {
    return raw.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[#].*$/, "").replace(/\/+$/, "");
  }
}

export interface PipelineDocument {
  id: number;
  url: string | null;
  contentHash: string | null;
}

export interface PipelineText {
  sourceDocumentId: number;
  status: string;
  charCount: number;
}

export interface PipelineFee {
  canonicalKey: string;
  amount: number | null;
  /** Set when the fee is published as a rate ("1% of the transaction"); amount is then null (v3). */
  ratePercent?: number | null;
  /** The stored document the row was read from (v2 scores only the key's document). */
  sourceDocumentId?: number | null;
}

/** Everything the pipeline holds for one answer-key institution. */
export interface BankEvidence {
  institutionId: number;
  feeScheduleUrl: string | null;
  /** Every stored document, newest first. The first is the one Magellan currently holds. */
  documents: PipelineDocument[];
  /** Rosetta's newest text for the institution, if any (v1). */
  latestText: PipelineText | null;
  /** Rosetta's newest text of each stored document (v2). */
  texts?: PipelineText[];
  knox: PipelineFee[];
  darwin: PipelineFee[];
  hamilton: PipelineFee[];
  /** Hamilton's live fees published as a rate, from published_fee_rate_catalog (v3). */
  hamiltonRates?: PipelineFee[];
}

export interface PrecisionRecall {
  expected: number;
  predicted: number;
  /** Expected items the stage got right (recall numerator). */
  matched: number;
  /** Predictions that were right (precision numerator). */
  correct: number;
  precision: number | null;
  recall: number | null;
  /** v2 fee stages: distinct predictions from the bank's other documents (not scored). */
  otherDocument?: number;
  /** v2 fee stages: distinct predictions with no stored document (not scored). */
  noDocument?: number;
}

export interface BankStageResult {
  right: boolean | null;
  matched?: number;
  expected?: number;
  predicted?: number;
  correct?: number;
  otherDocument?: number;
  noDocument?: number;
}

export interface BankScore {
  institution_id: number;
  document_type: AnswerKeyDocumentType;
  precision: number | null;
  recall: number | null;
  stages: Record<ScoredStage, BankStageResult>;
  missing: string[];
  extra: string[];
}

export interface AnswerKeyScore {
  scorerVersion: AnswerKeyScorerVersion;
  banksScored: number;
  feesExpected: number;
  overall: PrecisionRecall;
  byStage: Record<ScoredStage, PrecisionRecall>;
  byCategory: Record<string, PrecisionRecall & { family: string | null }>;
  byDocumentType: Record<string, { banks: number; stages: Record<ScoredStage, PrecisionRecall> }>;
  banks: BankScore[];
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 10_000 : null;
}

function emptyCounts(): PrecisionRecall {
  return { expected: 0, predicted: 0, matched: 0, correct: 0, precision: null, recall: null };
}

function finish(counts: PrecisionRecall): PrecisionRecall {
  return { ...counts, precision: ratio(counts.correct, counts.predicted), recall: ratio(counts.matched, counts.expected) };
}

type Counts = Pick<PrecisionRecall, "expected" | "predicted" | "matched" | "correct" | "otherDocument" | "noDocument">;

function add(target: PrecisionRecall, delta: Counts) {
  target.expected += delta.expected;
  target.predicted += delta.predicted;
  target.matched += delta.matched;
  target.correct += delta.correct;
  if (delta.otherDocument != null) target.otherDocument = (target.otherDocument ?? 0) + delta.otherDocument;
  if (delta.noDocument != null) target.noDocument = (target.noDocument ?? 0) + delta.noDocument;
}

type ExpectedFee = ConfirmedAnswerKeyEntry["fees"][number];

/** Does a pipeline amount satisfy an answer-key fee? */
export function amountMatches(expected: { amount: number | null; amountKind: AnswerKeyAmountKind }, actual: number | null): boolean {
  if (expected.amountKind === "varies") return true;
  if (actual == null) return false;
  const target = expected.amountKind === "free" ? 0 : expected.amount;
  return target != null && Math.abs(actual - target) <= AMOUNT_TOLERANCE;
}

/**
 * Does a pipeline fee satisfy an answer-key fee? A rate never meets a dollar amount: it
 * matches only a key fee keyed as "varies" (the key has no rate kind).
 */
export function predictionMatches(expected: ExpectedFee, prediction: PipelineFee): boolean {
  if (expected.canonicalKey !== prediction.canonicalKey) return false;
  if (prediction.ratePercent != null) return expected.amountKind === "varies";
  return amountMatches(expected, prediction.amount);
}

/** Distinct (category, cents) or (category, rate) predictions, so a fee extracted twice counts once. */
function distinctPredictions(fees: PipelineFee[]): PipelineFee[] {
  const seen = new Map<string, PipelineFee>();
  for (const fee of fees) {
    if (!fee.canonicalKey) continue;
    if (fee.ratePercent != null) {
      const rate = Math.round(fee.ratePercent * 10_000) / 10_000;
      const key = `${fee.canonicalKey}|rate:${rate}`;
      if (!seen.has(key)) seen.set(key, { canonicalKey: fee.canonicalKey, amount: null, ratePercent: rate });
      continue;
    }
    const amount = fee.amount == null ? null : Math.round(fee.amount * 100) / 100;
    const key = `${fee.canonicalKey}|${amount ?? "null"}`;
    if (!seen.has(key)) seen.set(key, { canonicalKey: fee.canonicalKey, amount });
  }
  return [...seen.values()];
}

interface FeeComparison {
  matchedExpected: boolean[];
  correctPredicted: boolean[];
  predictions: PipelineFee[];
}

function compareFees(expected: ExpectedFee[], actual: PipelineFee[]): FeeComparison {
  const predictions = distinctPredictions(actual);
  return {
    predictions,
    matchedExpected: expected.map((fee) => predictions.some((prediction) => predictionMatches(fee, prediction))),
    correctPredicted: predictions.map((prediction) => expected.some((fee) => predictionMatches(fee, prediction))),
  };
}

function formatFee(fee: { canonicalKey: string; amount: number | null; ratePercent?: number | null }): string {
  if (fee.ratePercent != null) return `${fee.canonicalKey} ${fee.ratePercent}%`;
  return fee.amount == null ? fee.canonicalKey : `${fee.canonicalKey} $${fee.amount.toFixed(2)}`;
}

/** Which stored documents are the right one: URL match, or the same bytes as the right one. */
function rightDocumentIds(entry: ConfirmedAnswerKeyEntry, evidence: BankEvidence): Set<number> {
  const target = normalizeDocumentUrl(entry.documentUrl);
  const hashes = new Set<string>();
  if (entry.contentHash) hashes.add(entry.contentHash);
  for (const doc of evidence.documents) {
    if (doc.contentHash && normalizeDocumentUrl(doc.url) === target) hashes.add(doc.contentHash);
  }
  return new Set(
    evidence.documents
      .filter((doc) => normalizeDocumentUrl(doc.url) === target || (doc.contentHash != null && hashes.has(doc.contentHash)))
      .map((doc) => doc.id),
  );
}

function textCompleted(text: PipelineText | null | undefined): text is PipelineText {
  return text != null && text.status === "completed" && text.charCount > 0;
}

/** Magellan and Rosetta for one bank, as 0/1 counts, under the given scorer version. */
function documentStages(
  version: AnswerKeyScorerVersion,
  entry: ConfirmedAnswerKeyEntry,
  evidence: BankEvidence,
  rightIds: Set<number>,
): { magellan: Counts; rosetta: Counts } {
  const target = normalizeDocumentUrl(entry.documentUrl);
  const one = (predicted: boolean, right: boolean): Counts =>
    ({ expected: 1, predicted: predicted ? 1 : 0, matched: right ? 1 : 0, correct: right ? 1 : 0 });
  if (version === 1) {
    // v1: the document it holds now (newest stored, else the fee URL it chose).
    const current = evidence.documents[0] ?? null;
    const magellanRight = current
      ? rightIds.has(current.id)
      : evidence.feeScheduleUrl
        ? normalizeDocumentUrl(evidence.feeScheduleUrl) === target
        : false;
    const text = evidence.latestText;
    const completed = textCompleted(text);
    return {
      magellan: one(current != null || Boolean(evidence.feeScheduleUrl), magellanRight),
      rosetta: one(completed, completed && rightIds.has(text.sourceDocumentId)),
    };
  }
  // v2: the bank's link, or a stored copy of it, is the key's document.
  const link = normalizeDocumentUrl(evidence.feeScheduleUrl);
  const linkIds = new Set(evidence.documents.filter((doc) => link != null && normalizeDocumentUrl(doc.url) === link).map((doc) => doc.id));
  const magellanRight = link != null && (link === target || [...linkIds].some((id) => rightIds.has(id)));
  // Rosetta: a completed text of the key's document; a text only of a wrong link is a wrong prediction.
  const completed = (evidence.texts ?? []).filter(textCompleted);
  const rosettaRight = completed.some((text) => rightIds.has(text.sourceDocumentId));
  const rosettaPredicted = rosettaRight || completed.some((text) => linkIds.has(text.sourceDocumentId));
  return { magellan: one(link != null, magellanRight), rosetta: one(rosettaPredicted, rosettaRight) };
}

/** v2: only rows read from the key's document are scored; the rest are counted. */
function scopeFees(version: AnswerKeyScorerVersion, fees: PipelineFee[], rightIds: Set<number>) {
  if (version === 1) return { scored: fees, otherDocument: undefined, noDocument: undefined };
  const scored = fees.filter((fee) => fee.sourceDocumentId != null && rightIds.has(fee.sourceDocumentId));
  const other = fees.filter((fee) => fee.sourceDocumentId != null && !rightIds.has(fee.sourceDocumentId));
  const none = fees.filter((fee) => fee.sourceDocumentId == null);
  return {
    scored,
    otherDocument: distinctPredictions(other).length,
    noDocument: distinctPredictions(none).length,
  };
}

/** Pure: scores the pipeline against the confirmed answer key under one scorer version. */
export function scoreAnswerKey(
  entries: ConfirmedAnswerKeyEntry[],
  evidenceById: Map<number, BankEvidence>,
  version: AnswerKeyScorerVersion = ANSWER_KEY_SCORER_VERSION,
): AnswerKeyScore {
  const byStage = Object.fromEntries(SCORED_STAGES.map((stage) => [stage, emptyCounts()])) as Record<ScoredStage, PrecisionRecall>;
  const byCategory: Record<string, PrecisionRecall & { family: string | null }> = {};
  const byDocumentType: AnswerKeyScore["byDocumentType"] = {};
  const banks: BankScore[] = [];
  let feesExpected = 0;

  const category = (key: string) => {
    byCategory[key] ??= { ...emptyCounts(), family: getFeeFamily(key) };
    return byCategory[key];
  };

  for (const entry of entries) {
    const evidence = evidenceById.get(entry.institutionId) ?? {
      institutionId: entry.institutionId,
      feeScheduleUrl: null,
      documents: [],
      latestText: null,
      knox: [],
      darwin: [],
      hamilton: [],
    };
    feesExpected += entry.fees.length;
    const docType = (byDocumentType[entry.documentType] ??= {
      banks: 0,
      stages: Object.fromEntries(SCORED_STAGES.map((stage) => [stage, emptyCounts()])) as Record<ScoredStage, PrecisionRecall>,
    });
    docType.banks += 1;

    const rightIds = rightDocumentIds(entry, evidence);
    const { magellan, rosetta } = documentStages(version, entry, evidence, rightIds);
    const magellanRight = magellan.matched === 1;
    const rosettaRight = rosetta.matched === 1;

    add(byStage.magellan, magellan);
    add(byStage.rosetta, rosetta);
    add(docType.stages.magellan, magellan);
    add(docType.stages.rosetta, rosetta);

    const stages = {
      magellan: { right: magellanRight },
      rosetta: { right: rosettaRight },
    } as Record<ScoredStage, BankStageResult>;
    let missing: string[] = [];
    let extra: string[] = [];

    for (const stage of FEE_STAGES) {
      // v3: Hamilton's rate fees join its dollar fees as their own predictions.
      const rows = stage === "hamilton" && version >= 3
        ? [...evidence.hamilton, ...(evidence.hamiltonRates ?? [])]
        : evidence[stage as FeeStage];
      const scope = scopeFees(version, rows, rightIds);
      const comparison = compareFees(entry.fees, scope.scored);
      const counts: Counts = {
        expected: entry.fees.length,
        predicted: comparison.predictions.length,
        matched: comparison.matchedExpected.filter(Boolean).length,
        correct: comparison.correctPredicted.filter(Boolean).length,
        ...(scope.otherDocument == null ? {} : { otherDocument: scope.otherDocument, noDocument: scope.noDocument }),
      };
      add(byStage[stage], counts);
      add(docType.stages[stage], counts);
      stages[stage] = {
        right: counts.expected > 0 ? counts.matched === counts.expected && counts.correct === counts.predicted : null,
        ...counts,
      };
      if (stage === "hamilton") {
        entry.fees.forEach((fee, index) => {
          const bucket = category(fee.canonicalKey);
          bucket.expected += 1;
          if (comparison.matchedExpected[index]) bucket.matched += 1;
        });
        comparison.predictions.forEach((prediction, index) => {
          const bucket = category(prediction.canonicalKey);
          bucket.predicted += 1;
          if (comparison.correctPredicted[index]) bucket.correct += 1;
        });
        missing = entry.fees
          .filter((_, index) => !comparison.matchedExpected[index])
          .map((fee) => formatFee(fee));
        extra = comparison.predictions
          .filter((_, index) => !comparison.correctPredicted[index])
          .map((fee) => formatFee(fee));
      }
    }

    const hamilton = stages.hamilton;
    banks.push({
      institution_id: entry.institutionId,
      document_type: entry.documentType,
      precision: ratio(hamilton.correct ?? 0, hamilton.predicted ?? 0),
      recall: ratio(hamilton.matched ?? 0, hamilton.expected ?? 0),
      stages,
      missing: missing.slice(0, 40),
      extra: extra.slice(0, 40),
    });
  }

  const finishedStages = Object.fromEntries(
    SCORED_STAGES.map((stage) => [stage, finish(byStage[stage])]),
  ) as Record<ScoredStage, PrecisionRecall>;
  return {
    scorerVersion: version,
    banksScored: entries.length,
    feesExpected,
    overall: finishedStages.hamilton,
    byStage: finishedStages,
    byCategory: Object.fromEntries(
      Object.entries(byCategory)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, counts]) => [key, { ...finish(counts), family: counts.family }]),
    ),
    byDocumentType: Object.fromEntries(
      Object.entries(byDocumentType).map(([type, value]) => [
        type,
        {
          banks: value.banks,
          stages: Object.fromEntries(SCORED_STAGES.map((stage) => [stage, finish(value.stages[stage])])) as Record<ScoredStage, PrecisionRecall>,
        },
      ]),
    ),
    banks,
  };
}

function parseFlags(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
  if (typeof value === "string") {
    try {
      return parseFlags(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return [];
}

/** Knox's category for a raw row: the canonical hint it wrote into the flags or conditions. */
export function rawCanonicalHint(outlierFlags: unknown, conditions: string | null): string | null {
  const fromFlag = parseFlags(outlierFlags)
    .find((flag) => flag.startsWith("canonical_hint:"))
    ?.slice("canonical_hint:".length)
    .trim();
  const hint = fromFlag || conditions?.match(/canonical_hint=([a-z0-9_]+)/i)?.[1] || null;
  return hint && hint !== "none" ? hint : null;
}

function amountOf(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Reads what each stage holds for the given institutions. Read-only. */
export async function gatherBankEvidence(institutionIds: number[], db: SqlTag = sql): Promise<Map<number, BankEvidence>> {
  const evidence = new Map<number, BankEvidence>();
  if (institutionIds.length === 0) return evidence;
  for (const id of institutionIds) {
    evidence.set(id, { institutionId: id, feeScheduleUrl: null, documents: [], latestText: null, texts: [], knox: [], darwin: [], hamilton: [], hamiltonRates: [] });
  }
  const ids = institutionIds;
  const [institutions, documents, texts, raw, verified, published, publishedRates] = await Promise.all([
    db`SELECT id, fee_schedule_url FROM institution_sources WHERE id = ANY(${ids}::bigint[])`,
    db`
      SELECT id, institution_id, document_url, content_hash
        FROM source_documents
       WHERE institution_id = ANY(${ids}::bigint[])
         AND status <> 'failed'
       ORDER BY institution_id, crawled_at DESC, id DESC
    `,
    db`
      SELECT DISTINCT ON (institution_id, source_document_id) id, institution_id, source_document_id, status, char_count, updated_at
        FROM agent_source_texts
       WHERE institution_id = ANY(${ids}::bigint[])
       ORDER BY institution_id, source_document_id, updated_at DESC, id DESC
    `,
    db`
      SELECT institution_id, source_document_id, amount, outlier_flags, conditions
        FROM raw_fee_observations
       WHERE institution_id = ANY(${ids}::int[])
         AND NOT (COALESCE(outlier_flags, '[]'::jsonb) ?| array['superseded_by_reread', 'superseded_by_newer_copy'])
    `,
    db`
      SELECT fv.institution_id, fr.source_document_id, fv.canonical_fee_key, fv.amount
        FROM verified_fee_observations fv
        LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE fv.institution_id = ANY(${ids}::int[])
         AND fv.review_status IN ('verified', 'approved')
    `,
    db`
      SELECT institution_id, source_document_id, canonical_fee_key, amount
        FROM published_fee_catalog
       WHERE institution_id = ANY(${ids}::int[])
    `,
    db`
      SELECT institution_id, source_document_id, canonical_fee_key, rate_percent
        FROM published_fee_rate_catalog
       WHERE institution_id = ANY(${ids}::int[])
         AND rate_percent IS NOT NULL
    `,
  ]);
  for (const row of institutions) {
    const bank = evidence.get(Number(row.id));
    if (bank) bank.feeScheduleUrl = (row.fee_schedule_url as string | null) ?? null;
  }
  for (const row of documents) {
    evidence.get(Number(row.institution_id))?.documents.push({
      id: Number(row.id),
      url: (row.document_url as string | null) ?? null,
      contentHash: (row.content_hash as string | null) ?? null,
    });
  }
  // Newest text per document (v2); the bank's newest text overall is v1's latestText.
  const newest = new Map<number, { at: number; id: number }>();
  for (const row of texts) {
    const bank = evidence.get(Number(row.institution_id));
    if (!bank) continue;
    const text: PipelineText = {
      sourceDocumentId: Number(row.source_document_id),
      status: String(row.status),
      charCount: Number(row.char_count ?? 0),
    };
    bank.texts?.push(text);
    const at = new Date(row.updated_at as string | Date).getTime() || 0;
    const id = Number(row.id);
    const best = newest.get(bank.institutionId);
    if (!best || at > best.at || (at === best.at && id > best.id)) {
      newest.set(bank.institutionId, { at, id });
      bank.latestText = text;
    }
  }
  const docId = (value: unknown) => (value == null ? null : Number(value));
  for (const row of raw) {
    const hint = rawCanonicalHint(row.outlier_flags, (row.conditions as string | null) ?? null);
    if (hint) {
      evidence.get(Number(row.institution_id))?.knox.push({
        canonicalKey: hint,
        amount: amountOf(row.amount),
        sourceDocumentId: docId(row.source_document_id),
      });
    }
  }
  for (const row of verified) {
    evidence.get(Number(row.institution_id))?.darwin.push({
      canonicalKey: String(row.canonical_fee_key),
      amount: amountOf(row.amount),
      sourceDocumentId: docId(row.source_document_id),
    });
  }
  for (const row of published) {
    evidence.get(Number(row.institution_id))?.hamilton.push({
      canonicalKey: String(row.canonical_fee_key),
      amount: amountOf(row.amount),
      sourceDocumentId: docId(row.source_document_id),
    });
  }
  for (const row of publishedRates) {
    const rate = amountOf(row.rate_percent);
    if (rate == null) continue;
    evidence.get(Number(row.institution_id))?.hamiltonRates?.push({
      canonicalKey: String(row.canonical_fee_key),
      amount: null,
      ratePercent: rate,
      sourceDocumentId: docId(row.source_document_id),
    });
  }
  return evidence;
}

export interface AnswerKeyScoreRunResult {
  schemaReady: boolean;
  /** The current version's stored row. */
  scoreRunId: number | null;
  /** The current version's score (what the scoreboard and admin read). */
  score: AnswerKeyScore | null;
  /** Every version scored on this run, each stored as its own row, oldest version first. */
  series?: Array<{ scorerVersion: AnswerKeyScorerVersion; scoreRunId: number | null; score: AnswerKeyScore }>;
  dryRun: boolean;
}

/**
 * Scores every confirmed institution under each scorer version and stores one row
 * per version (not on a dry run), so v1's history stays its own readable series.
 */
export async function runAnswerKeyScore({
  runId,
  dryRun = false,
  db = sql,
}: {
  runId: number | null;
  dryRun?: boolean;
  db?: SqlTag;
}): Promise<AnswerKeyScoreRunResult> {
  if (!(await answerKeySchemaReady(db))) return { schemaReady: false, scoreRunId: null, score: null, dryRun };
  const entries = await getConfirmedAnswerKey(db);
  const evidence = await gatherBankEvidence(entries.map((entry) => entry.institutionId), db);
  const series: NonNullable<AnswerKeyScoreRunResult["series"]> = [];
  for (const version of ANSWER_KEY_SCORER_VERSIONS) {
    const score = scoreAnswerKey(entries, evidence, version);
    let scoreRunId: number | null = null;
    if (!dryRun && entries.length > 0) {
      const [row] = await db`
        INSERT INTO answer_key_score_runs
          (agent_run_id, scorer_version, banks_scored, fees_expected, precision, recall,
           by_stage, by_category, by_document_type, by_bank)
        VALUES
          (${runId}, ${score.scorerVersion}, ${score.banksScored}, ${score.feesExpected},
           ${score.overall.precision}, ${score.overall.recall},
           ${JSON.stringify(score.byStage)}::jsonb, ${JSON.stringify(score.byCategory)}::jsonb,
           ${JSON.stringify(score.byDocumentType)}::jsonb, ${JSON.stringify(score.banks)}::jsonb)
        RETURNING id
      `;
      scoreRunId = Number(row.id);
    }
    series.push({ scorerVersion: version, scoreRunId, score });
  }
  const current = series.find((entry) => entry.scorerVersion === ANSWER_KEY_SCORER_VERSION)!;
  return { schemaReady: true, scoreRunId: current.scoreRunId, score: current.score, series, dryRun };
}

function percent(value: number | null): string {
  return value == null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

/** One sentence for the step summary. */
export function summarizeAnswerKeyScore(result: AnswerKeyScoreRunResult): string {
  if (!result.schemaReady) return "Atlas skipped the answer-key score: the answer-key migration is not applied yet.";
  const score = result.score;
  if (!score || score.banksScored === 0) return "Atlas found no confirmed answer-key institutions to score yet.";
  const stages = SCORED_STAGES
    .map((stage) => `${stage} ${percent(score.byStage[stage].precision)}/${percent(score.byStage[stage].recall)}`)
    .join(", ");
  const older = (result.series ?? [])
    .filter((entry) => entry.scorerVersion !== score.scorerVersion)
    .map((entry) => ` Scorer v${entry.scorerVersion}: precision ${percent(entry.score.overall.precision)}, recall ${percent(entry.score.overall.recall)}.`)
    .join("");
  return `Atlas scored ${score.banksScored} answer-key institution${score.banksScored === 1 ? "" : "s"} (${score.feesExpected} fees) with scorer v${score.scorerVersion}: precision ${percent(score.overall.precision)}, recall ${percent(score.overall.recall)}. By stage (precision/recall): ${stages}.${older}`;
}
