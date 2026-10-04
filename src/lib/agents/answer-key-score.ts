import { sql } from "@/lib/data-store/connection";
import {
  answerKeySchemaReady,
  getConfirmedAnswerKey,
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
 *   hamilton  live published_fee_catalog rows with the right amount (end to end)
 *
 * Document stages score per institution (precision: right / any found; recall:
 * right / confirmed institutions). Fee stages score per fee (precision: matching
 * distinct (category, amount) predictions / all predictions; recall: expected fees
 * found / expected fees). "Overall" is the Hamilton stage: what readers see.
 */

type SqlTag = typeof sql;

/** Bump when the scoring rules change, so trends can be read across versions. */
export const ANSWER_KEY_SCORER_VERSION = 1;

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
}

/** Everything the pipeline holds for one answer-key institution. */
export interface BankEvidence {
  institutionId: number;
  feeScheduleUrl: string | null;
  /** Every stored document, newest first. The first is the one Magellan currently holds. */
  documents: PipelineDocument[];
  /** Rosetta's newest text for the institution, if any. */
  latestText: PipelineText | null;
  knox: PipelineFee[];
  darwin: PipelineFee[];
  hamilton: PipelineFee[];
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
}

export interface BankStageResult {
  right: boolean | null;
  matched?: number;
  expected?: number;
  predicted?: number;
  correct?: number;
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
  scorerVersion: number;
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

function add(target: PrecisionRecall, delta: Pick<PrecisionRecall, "expected" | "predicted" | "matched" | "correct">) {
  target.expected += delta.expected;
  target.predicted += delta.predicted;
  target.matched += delta.matched;
  target.correct += delta.correct;
}

type ExpectedFee = ConfirmedAnswerKeyEntry["fees"][number];

/** Does a pipeline amount satisfy an answer-key fee? */
export function amountMatches(expected: { amount: number | null; amountKind: AnswerKeyAmountKind }, actual: number | null): boolean {
  if (expected.amountKind === "varies") return true;
  if (actual == null) return false;
  const target = expected.amountKind === "free" ? 0 : expected.amount;
  return target != null && Math.abs(actual - target) <= AMOUNT_TOLERANCE;
}

/** Distinct (category, cents) predictions, so a fee extracted twice counts once. */
function distinctPredictions(fees: PipelineFee[]): PipelineFee[] {
  const seen = new Map<string, PipelineFee>();
  for (const fee of fees) {
    if (!fee.canonicalKey) continue;
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
    matchedExpected: expected.map((fee) =>
      predictions.some((prediction) => prediction.canonicalKey === fee.canonicalKey && amountMatches(fee, prediction.amount))),
    correctPredicted: predictions.map((prediction) =>
      expected.some((fee) => fee.canonicalKey === prediction.canonicalKey && amountMatches(fee, prediction.amount))),
  };
}

function formatFee(fee: { canonicalKey: string; amount: number | null }): string {
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

/** Pure: scores the pipeline against the confirmed answer key. */
export function scoreAnswerKey(entries: ConfirmedAnswerKeyEntry[], evidenceById: Map<number, BankEvidence>): AnswerKeyScore {
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

    // Magellan: the document it holds now (newest stored, else the fee URL it chose).
    const rightIds = rightDocumentIds(entry, evidence);
    const current = evidence.documents[0] ?? null;
    const target = normalizeDocumentUrl(entry.documentUrl);
    const foundAny = current != null || Boolean(evidence.feeScheduleUrl);
    const magellanRight = current
      ? rightIds.has(current.id)
      : evidence.feeScheduleUrl
        ? normalizeDocumentUrl(evidence.feeScheduleUrl) === target
        : false;
    const magellan = { expected: 1, predicted: foundAny ? 1 : 0, matched: magellanRight ? 1 : 0, correct: magellanRight ? 1 : 0 };

    // Rosetta: a completed, non-empty text of the right document.
    const text = evidence.latestText;
    const textCompleted = text != null && text.status === "completed" && text.charCount > 0;
    const rosettaRight = textCompleted && rightIds.has(text.sourceDocumentId);
    const rosetta = { expected: 1, predicted: textCompleted ? 1 : 0, matched: rosettaRight ? 1 : 0, correct: rosettaRight ? 1 : 0 };

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
      const comparison = compareFees(entry.fees, evidence[stage as FeeStage]);
      const counts = {
        expected: entry.fees.length,
        predicted: comparison.predictions.length,
        matched: comparison.matchedExpected.filter(Boolean).length,
        correct: comparison.correctPredicted.filter(Boolean).length,
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
    scorerVersion: ANSWER_KEY_SCORER_VERSION,
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
    evidence.set(id, { institutionId: id, feeScheduleUrl: null, documents: [], latestText: null, knox: [], darwin: [], hamilton: [] });
  }
  const ids = institutionIds;
  const [institutions, documents, texts, raw, verified, published] = await Promise.all([
    db`SELECT id, fee_schedule_url FROM institution_sources WHERE id = ANY(${ids}::bigint[])`,
    db`
      SELECT id, institution_id, document_url, content_hash
        FROM source_documents
       WHERE institution_id = ANY(${ids}::bigint[])
         AND status <> 'failed'
       ORDER BY institution_id, crawled_at DESC, id DESC
    `,
    db`
      SELECT DISTINCT ON (institution_id) institution_id, source_document_id, status, char_count
        FROM agent_source_texts
       WHERE institution_id = ANY(${ids}::bigint[])
       ORDER BY institution_id, updated_at DESC, id DESC
    `,
    db`
      SELECT institution_id, amount, outlier_flags, conditions
        FROM raw_fee_observations
       WHERE institution_id = ANY(${ids}::int[])
         AND NOT (COALESCE(outlier_flags, '[]'::jsonb) ? 'superseded_by_reread')
    `,
    db`
      SELECT institution_id, canonical_fee_key, amount
        FROM verified_fee_observations
       WHERE institution_id = ANY(${ids}::int[])
         AND review_status IN ('verified', 'approved')
    `,
    db`
      SELECT institution_id, canonical_fee_key, amount
        FROM published_fee_catalog
       WHERE institution_id = ANY(${ids}::int[])
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
  for (const row of texts) {
    const bank = evidence.get(Number(row.institution_id));
    if (bank) {
      bank.latestText = {
        sourceDocumentId: Number(row.source_document_id),
        status: String(row.status),
        charCount: Number(row.char_count ?? 0),
      };
    }
  }
  for (const row of raw) {
    const hint = rawCanonicalHint(row.outlier_flags, (row.conditions as string | null) ?? null);
    if (hint) evidence.get(Number(row.institution_id))?.knox.push({ canonicalKey: hint, amount: amountOf(row.amount) });
  }
  for (const row of verified) {
    evidence.get(Number(row.institution_id))?.darwin.push({ canonicalKey: String(row.canonical_fee_key), amount: amountOf(row.amount) });
  }
  for (const row of published) {
    evidence.get(Number(row.institution_id))?.hamilton.push({ canonicalKey: String(row.canonical_fee_key), amount: amountOf(row.amount) });
  }
  return evidence;
}

export interface AnswerKeyScoreRunResult {
  schemaReady: boolean;
  scoreRunId: number | null;
  score: AnswerKeyScore | null;
  dryRun: boolean;
}

/** Scores every confirmed institution and stores the run (not on a dry run). */
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
  const score = scoreAnswerKey(entries, evidence);
  if (dryRun || entries.length === 0) return { schemaReady: true, scoreRunId: null, score, dryRun };
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
  return { schemaReady: true, scoreRunId: Number(row.id), score, dryRun };
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
  return `Atlas scored ${score.banksScored} answer-key institution${score.banksScored === 1 ? "" : "s"} (${score.feesExpected} fees): precision ${percent(score.overall.precision)}, recall ${percent(score.overall.recall)}. By stage (precision/recall): ${stages}.`;
}
