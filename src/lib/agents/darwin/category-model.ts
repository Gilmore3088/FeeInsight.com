import type { sql } from "@/lib/data-store/connection";

type SqlTag = typeof sql;

/**
 * Darwin v2, layer 2: a learned check on the category Knox gave a fee. A naive Bayes
 * model over the words of fee names, trained on the live published catalog, so it
 * improves as wrong fees are taken down and right ones stay live. No model call.
 *
 * It runs in shadow first: its opinion is recorded as its own attempt
 * (verify.category_model) and never changes Darwin's decision. Measured on the
 * 43 hand-checked Texas schedules (2026-10-06), a dispute threshold of 0.05 flagged
 * 20 of 61 approvals whose category was wrong and 16 of 268 that were right.
 */

export const DARWIN_CATEGORY_MODEL_STRATEGY = { strategy: "verify.category_model", version: 1 } as const;

/** Below this probability for Knox's category, the model disputes it. */
export const CATEGORY_DISPUTE_THRESHOLD = 0.05;

/** A name repeated across many banks counts at most this many times in training. */
const MAX_NAME_WEIGHT = 5;
const SMOOTHING = 0.1;
const CACHE_MS = 60 * 60 * 1000;

const STOP_WORDS = new Set(
  "a an the of for to and or per each fee fees charge charges in on at by with is be may will your you our we this that if any item items".split(" "),
);

export interface CategoryExample {
  name: string;
  categoryKey: string;
  count: number;
}

export interface CategoryModel {
  categories: string[];
  logPrior: Map<string, number>;
  tokenCounts: Map<string, Map<string, number>>;
  tokenTotals: Map<string, number>;
  vocabularySize: number;
  examples: number;
}

export interface CategoryOpinion {
  disputed: boolean;
  /** Probability the model gives Knox's category. */
  probability: number;
  suggested: string;
  suggestedProbability: number;
}

/** Word stems (first six letters) plus adjacent pairs, so "wire outgoing" differs from "wire incoming". */
export function categoryTokens(name: string): string[] {
  const words = (name.toLowerCase().match(/[a-z]+/g) ?? [])
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word))
    .map((word) => word.slice(0, 6));
  const pairs = words.slice(1).map((word, index) => `${words[index]}_${word}`);
  return Array.from(new Set([...words, ...pairs]));
}

export function trainCategoryModel(examples: CategoryExample[]): CategoryModel {
  const prior = new Map<string, number>();
  const tokenCounts = new Map<string, Map<string, number>>();
  const vocabulary = new Set<string>();
  for (const example of examples) {
    const weight = Math.min(Math.max(example.count, 1), MAX_NAME_WEIGHT);
    prior.set(example.categoryKey, (prior.get(example.categoryKey) ?? 0) + weight);
    let counts = tokenCounts.get(example.categoryKey);
    if (!counts) tokenCounts.set(example.categoryKey, (counts = new Map()));
    for (const token of categoryTokens(example.name)) {
      counts.set(token, (counts.get(token) ?? 0) + weight);
      vocabulary.add(token);
    }
  }
  const total = Array.from(prior.values()).reduce((sum, value) => sum + value, 0);
  const logPrior = new Map(Array.from(prior, ([key, value]) => [key, Math.log(value / total)]));
  const tokenTotals = new Map(
    Array.from(tokenCounts, ([key, counts]) => [key, Array.from(counts.values()).reduce((sum, value) => sum + value, 0)]),
  );
  return {
    categories: Array.from(prior.keys()),
    logPrior,
    tokenCounts,
    tokenTotals,
    vocabularySize: vocabulary.size,
    examples: examples.length,
  };
}

/** Probability of each category for a fee name. */
export function scoreCategories(model: CategoryModel, name: string): Map<string, number> {
  const tokens = categoryTokens(name);
  const logScores = new Map<string, number>();
  for (const category of model.categories) {
    const counts = model.tokenCounts.get(category);
    const denominator = (model.tokenTotals.get(category) ?? 0) + SMOOTHING * model.vocabularySize;
    let score = model.logPrior.get(category) ?? -Infinity;
    for (const token of tokens) score += Math.log(((counts?.get(token) ?? 0) + SMOOTHING) / denominator);
    logScores.set(category, score);
  }
  const max = Math.max(...logScores.values());
  const exp = new Map(Array.from(logScores, ([key, value]) => [key, Math.exp(value - max)]));
  const sum = Array.from(exp.values()).reduce((total, value) => total + value, 0);
  return new Map(Array.from(exp, ([key, value]) => [key, value / sum]));
}

/** The model's view of Knox's category, or null when it has never seen that category or the name has no words. */
export function categoryOpinion(model: CategoryModel, name: string, categoryKey: string): CategoryOpinion | null {
  if (!model.logPrior.has(categoryKey) || categoryTokens(name).length === 0) return null;
  const scores = scoreCategories(model, name);
  let suggested = categoryKey;
  for (const [key, value] of scores) if (value > (scores.get(suggested) ?? 0)) suggested = key;
  const probability = scores.get(categoryKey) ?? 0;
  return {
    disputed: probability < CATEGORY_DISPUTE_THRESHOLD,
    probability,
    suggested,
    suggestedProbability: scores.get(suggested) ?? 0,
  };
}

let cached: { model: CategoryModel; loadedAt: number } | null = null;

/** Trains on live published fees, one row per distinct (name, category). Cached for an hour per instance. */
export async function loadCategoryModel(db: SqlTag, now = Date.now()): Promise<CategoryModel | null> {
  if (cached && now - cached.loadedAt < CACHE_MS) return cached.model;
  const rows: Array<{ name: string; category_key: string; count: number | string }> = await db`
    SELECT LOWER(fee_name) AS name, canonical_fee_key AS category_key, COUNT(*) AS count
      FROM published_fee_catalog
     WHERE canonical_fee_key IS NOT NULL
       AND fee_name IS NOT NULL
     GROUP BY 1, 2`;
  if (rows.length === 0) return null;
  const model = trainCategoryModel(
    rows.map((row) => ({ name: row.name, categoryKey: row.category_key, count: Number(row.count) })),
  );
  cached = { model, loadedAt: now };
  return model;
}

export function resetCategoryModelCache(): void {
  cached = null;
}
