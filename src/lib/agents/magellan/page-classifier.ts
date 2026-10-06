import type { sql } from "@/lib/data-store/connection";
import { scoreFeePage } from "@/lib/agents/learning/fee-page";
import { feedbackSchemaReady } from "@/lib/agents/learning/feedback";
import { LINK_YIELD_CHECK } from "@/lib/agents/magellan/outcomes";
import { inSavepoint } from "@/lib/agents/savepoint";

type SqlTag = typeof sql;

/**
 * MG-4: a learned fee-page classifier, trained on what Magellan's links actually
 * produced. Labels come from the outcome ledger (`magellan.link_yield` rows in
 * `pipeline_feedback`): a link with 3+ live fees is a fee page, a thin or rejected
 * link is not, a dead link is left out. The text is the stored text Rosetta read.
 *
 * The model is a Bernoulli naive Bayes over word stems, address words and the
 * rule check's own counts. A Magellan step retrains it when the stored copy is older
 * than `RETRAIN_AFTER_MS` and writes the weights to `magellan_page_classifier`, so
 * it is reinforced as the ledger grows (James, Oct 6: "Consistently reinforced").
 *
 * It runs in SHADOW: every candidate Magellan opens gets `page_p` (the model's
 * probability it is a fee page) on its trail entry, and nothing it says changes which
 * page is accepted. Letting it decide waits for James's review.
 */

export const PAGE_CLASSIFIER_VERSION = 1;
export const PAGE_CLASSIFIER_TABLE = "magellan_page_classifier";
export const RETRAIN_AFTER_MS = 6 * 60 * 60 * 1000;
/** Training needs at least this many examples of each label. */
export const MIN_EXAMPLES_PER_LABEL = 30;
/** Examples read per label per training: keeps the read bounded. */
export const MAX_EXAMPLES_PER_LABEL = 300;
/** Characters of each text the model sees, in training and in shadow scoring alike. */
export const TEXT_CHARS = 8_000;
const MIN_DOC_FREQUENCY = 3;
const MAX_FEATURES = 2_000;
const SMOOTHING = 1;

const STOP_WORDS = new Set(
  "the and for with you your our are this that from will may any not have has can all its per but who was were been their they them".split(" "),
);

export interface PageExample {
  text: string;
  url: string | null;
  feePage: boolean;
  /** Stable id (the source document), used for the holdout split. */
  id: number;
}

export interface PageClassifier {
  version: number;
  /** Log-odds of a page with none of the features. */
  bias: number;
  /** Log-odds change when a feature is present. */
  weights: Record<string, number>;
  positives: number;
  negatives: number;
  trainedAt: string | null;
}

export interface HoldoutScore {
  examples: number;
  accuracy: number | null;
  precision: number | null;
  recall: number | null;
  /** The rule check (scoreFeePage) on the same holdout: fee_page or uncertain counts as yes. */
  ruleAccuracy: number | null;
  /** Holdout pages the rule check would let through that the model calls not a fee page, and were not. */
  modelCatchesRuleMisses: number;
  /** Holdout fee pages the model would turn away. */
  modelMissesFeePages: number;
}

function bucket(value: number, edges: number[]): string {
  const index = edges.findIndex((edge) => value < edge);
  return index === -1 ? `${edges[edges.length - 1]}+` : String(index === 0 ? 0 : edges[index - 1]);
}

/** The features a page shows: word stems, address words and the rule check's counts. */
export function pageFeatures(text: string, url: string | null | undefined): Set<string> {
  const head = text.slice(0, TEXT_CHARS);
  const features = new Set<string>();
  for (const word of head.toLowerCase().match(/[a-z]{3,}/g) ?? []) {
    if (STOP_WORDS.has(word)) continue;
    features.add(`w:${word.slice(0, 7)}`);
  }
  if (url) {
    try {
      for (const word of new URL(url).pathname.toLowerCase().match(/[a-z]{3,}/g) ?? []) features.add(`u:${word.slice(0, 7)}`);
      if (/\.pdf$/i.test(new URL(url).pathname)) features.add("u:.pdf");
    } catch {
      // An unreadable address adds no address features.
    }
  }
  const rule = scoreFeePage(head, url);
  features.add(`s:fee_lines_${bucket(rule.feeLines, [1, 3, 10, 25])}`);
  features.add(`s:dollars_${bucket(rule.dollarAmounts, [1, 3, 10, 30])}`);
  features.add(`s:rates_${bucket(rule.rateTerms, [1, 4, 12])}`);
  features.add(`s:rule_${rule.verdict}`);
  return features;
}

/** Train on labelled pages. Null when either label has too few examples. */
export function trainPageClassifier(examples: PageExample[], trainedAt: string | null = null): PageClassifier | null {
  const positives = examples.filter((example) => example.feePage).length;
  const negatives = examples.length - positives;
  if (positives < MIN_EXAMPLES_PER_LABEL || negatives < MIN_EXAMPLES_PER_LABEL) return null;

  const counts = new Map<string, { pos: number; neg: number }>();
  for (const example of examples) {
    for (const feature of pageFeatures(example.text, example.url)) {
      const entry = counts.get(feature) ?? { pos: 0, neg: 0 };
      if (example.feePage) entry.pos += 1;
      else entry.neg += 1;
      counts.set(feature, entry);
    }
  }

  const scored = [...counts.entries()]
    .filter(([, entry]) => entry.pos + entry.neg >= MIN_DOC_FREQUENCY)
    .map(([feature, entry]) => {
      const p = (entry.pos + SMOOTHING) / (positives + 2 * SMOOTHING);
      const q = (entry.neg + SMOOTHING) / (negatives + 2 * SMOOTHING);
      const present = Math.log(p / q);
      const absent = Math.log((1 - p) / (1 - q));
      return { feature, present, absent };
    })
    .sort((a, b) => Math.abs(b.present - b.absent) - Math.abs(a.present - a.absent))
    .slice(0, MAX_FEATURES);

  let bias = Math.log(positives / negatives);
  const weights: Record<string, number> = {};
  for (const { feature, present, absent } of scored) {
    bias += absent;
    weights[feature] = Math.round((present - absent) * 10_000) / 10_000;
  }
  return { version: PAGE_CLASSIFIER_VERSION, bias: Math.round(bias * 10_000) / 10_000, weights, positives, negatives, trainedAt };
}

/** The model's probability that this page is the bank's fee schedule. */
export function classifyPage(model: PageClassifier, text: string, url: string | null | undefined): number {
  let logit = model.bias;
  for (const feature of pageFeatures(text, url)) logit += model.weights[feature] ?? 0;
  // Naive Bayes over-counts correlated words; clamp so the logistic stays finite.
  const clamped = Math.max(-30, Math.min(30, logit));
  return 1 / (1 + Math.exp(-clamped));
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : Math.round((numerator / denominator) * 1000) / 1000;
}

/** Every fifth document (by id) is held out to score the model against the rule check. */
export function isHoldout(example: PageExample): boolean {
  return example.id % 5 === 0;
}

export function scoreHoldout(model: PageClassifier, holdout: PageExample[]): HoldoutScore {
  let right = 0;
  let truePositives = 0;
  let predictedPositives = 0;
  let ruleRight = 0;
  let catches = 0;
  let misses = 0;
  for (const example of holdout) {
    const yes = classifyPage(model, example.text, example.url) >= 0.5;
    const ruleYes = scoreFeePage(example.text.slice(0, TEXT_CHARS), example.url).verdict !== "wrong_document";
    if (yes === example.feePage) right += 1;
    if (ruleYes === example.feePage) ruleRight += 1;
    if (yes) predictedPositives += 1;
    if (yes && example.feePage) truePositives += 1;
    if (ruleYes && !yes && !example.feePage) catches += 1;
    if (!yes && example.feePage) misses += 1;
  }
  const positives = holdout.filter((example) => example.feePage).length;
  return {
    examples: holdout.length,
    accuracy: ratio(right, holdout.length),
    precision: ratio(truePositives, predictedPositives),
    recall: ratio(truePositives, positives),
    ruleAccuracy: ratio(ruleRight, holdout.length),
    modelCatchesRuleMisses: catches,
    modelMissesFeePages: misses,
  };
}

const readyCache = new WeakMap<object, boolean>();

/** True once `magellan_page_classifier` exists. Only a positive answer is cached. */
export async function pageClassifierSchemaReady(db: SqlTag): Promise<boolean> {
  if (readyCache.get(db)) return true;
  const [row] = await db`SELECT to_regclass('public.magellan_page_classifier') IS NOT NULL AS ready`;
  const ready = row?.ready === true;
  if (ready) readyCache.set(db, true);
  return ready;
}

interface StoredModelRow {
  trained_at: Date | string;
  model: { bias?: number; weights?: Record<string, number> } | string | null;
  positives: number | string;
  negatives: number | string;
}

/** The newest stored model of this version, or null (no table, no model yet, or a read error). */
export async function loadPageClassifier(db: SqlTag): Promise<PageClassifier | null> {
  try {
    if (!(await pageClassifierSchemaReady(db))) return null;
    const [row] = (await db`
      SELECT trained_at, model, positives, negatives
        FROM magellan_page_classifier
       WHERE version = ${PAGE_CLASSIFIER_VERSION}
       ORDER BY trained_at DESC
       LIMIT 1
    `) as unknown as StoredModelRow[];
    if (!row) return null;
    const model = typeof row.model === "string" ? JSON.parse(row.model) : row.model;
    if (!model || typeof model.bias !== "number" || !model.weights) return null;
    return {
      version: PAGE_CLASSIFIER_VERSION,
      bias: model.bias,
      weights: model.weights,
      positives: Number(row.positives),
      negatives: Number(row.negatives),
      trainedAt: new Date(row.trained_at).toISOString(),
    };
  } catch {
    return null;
  }
}

export interface ClassifierRefresh {
  status: "trained" | "fresh" | "too_few_labels" | "not_ready" | "dry_run" | "error";
  positives: number;
  negatives: number;
  features: number;
  holdout: HoldoutScore | null;
  trainedAt: string | null;
  error?: string;
}

interface TrainingRow {
  document_id: number | string;
  kind: string;
  source_url: string | null;
  text: string | null;
}

/** Labelled texts from the ledger: links with live fees vs. thin or rejected links. */
export async function loadTrainingExamples(db: SqlTag, perLabel = MAX_EXAMPLES_PER_LABEL): Promise<PageExample[]> {
  const rows = (await db`
    WITH labels AS (
      SELECT COALESCE(NULLIF(f.evidence->>'last_document_id', '')::bigint, f.source_document_id) AS document_id,
             f.kind, f.source_url
        FROM pipeline_feedback f
       WHERE f.check_name = ${LINK_YIELD_CHECK}
         AND f.kind IN ('produced_live_fees', 'thin_link', 'wrong_document')
    ),
    picked AS (
      (SELECT * FROM labels WHERE kind = 'produced_live_fees' AND document_id IS NOT NULL
        ORDER BY md5(document_id::text) LIMIT ${perLabel})
      UNION ALL
      (SELECT * FROM labels WHERE kind <> 'produced_live_fees' AND document_id IS NOT NULL
        ORDER BY md5(document_id::text) LIMIT ${perLabel})
    )
    SELECT picked.document_id, picked.kind, COALESCE(texts.source_url, picked.source_url) AS source_url,
           left(texts.normalized_text, ${TEXT_CHARS}) AS text
      FROM picked
      JOIN agent_source_texts texts ON texts.source_document_id = picked.document_id
     WHERE texts.normalized_text IS NOT NULL AND length(texts.normalized_text) > 0
  `) as unknown as TrainingRow[];
  return rows
    .filter((row) => row.text)
    .map((row) => ({
      id: Number(row.document_id),
      text: String(row.text),
      url: row.source_url,
      feePage: row.kind === "produced_live_fees",
    }));
}

/**
 * Retrain and store the model when the stored one is older than `RETRAIN_AFTER_MS`.
 * Runs inside the discover step; it never throws, so the step's own work stands.
 */
export async function refreshPageClassifier(
  db: SqlTag,
  options: { runId: number; dryRun?: boolean; now?: Date },
): Promise<ClassifierRefresh> {
  const empty = { positives: 0, negatives: 0, features: 0, holdout: null, trainedAt: null };
  if (options.dryRun) return { status: "dry_run", ...empty };
  const now = options.now ?? new Date();
  try {
    return await inSavepoint(db, async (scope) => {
      if (!(await pageClassifierSchemaReady(scope)) || !(await feedbackSchemaReady(scope))) {
        return { status: "not_ready", ...empty };
      }
      const current = await loadPageClassifier(scope);
      if (current?.trainedAt && now.getTime() - new Date(current.trainedAt).getTime() < RETRAIN_AFTER_MS) {
        return {
          status: "fresh",
          positives: current.positives,
          negatives: current.negatives,
          features: Object.keys(current.weights).length,
          holdout: null,
          trainedAt: current.trainedAt,
        };
      }
      const examples = await loadTrainingExamples(scope);
      const positives = examples.filter((example) => example.feePage).length;
      const negatives = examples.length - positives;
      const train = examples.filter((example) => !isHoldout(example));
      const holdout = examples.filter(isHoldout);
      const trial = trainPageClassifier(train);
      const model = trainPageClassifier(examples, now.toISOString());
      if (!model) return { status: "too_few_labels", ...empty, positives, negatives };
      const holdoutScore = trial && holdout.length > 0 ? scoreHoldout(trial, holdout) : null;
      await scope`
        INSERT INTO magellan_page_classifier (version, trained_at, agent_run_id, positives, negatives, model, holdout, mode)
        VALUES (
          ${PAGE_CLASSIFIER_VERSION},
          ${now},
          ${options.runId},
          ${positives},
          ${negatives},
          ${JSON.stringify({ bias: model.bias, weights: model.weights })}::jsonb,
          ${JSON.stringify(holdoutScore)}::jsonb,
          'shadow'
        )
      `;
      return {
        status: "trained",
        positives,
        negatives,
        features: Object.keys(model.weights).length,
        holdout: holdoutScore,
        trainedAt: model.trainedAt,
      };
    });
  } catch (error) {
    return { status: "error", ...empty, error: error instanceof Error ? error.message : String(error) };
  }
}
