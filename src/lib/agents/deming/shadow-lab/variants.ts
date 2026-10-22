import { runFreeSpecialists } from "@/lib/agents/knox/specialists";
import { passesDarwinChecks } from "@/lib/agents/knox/layout";
import { refileCategory, checkFeeCategory } from "@/lib/fee-category-guard";
import { foldContext } from "@/lib/fee-fold";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { limitGuardVerdict } from "@/lib/agents/hamilton/limit-guard";
import { ruleFor } from "@/lib/agents/hamilton/eval-verdicts";
import { isProductPage } from "@/lib/agents/hamilton/product-page";
import {
  decidePriorFee,
  HAMILTON_PUBLISH_DEFAULT_MIN_CONFIDENCE,
  publishNameHold,
  publishSkipReason,
  sameValueLinesApart,
  type PriorPublishedFeeRow,
} from "@/lib/agents/hamilton/publish";
import { toCents, toDollars, verifiedRow } from "./rows";
import type { PipelineVariant, ShadowCase, StageFee, StageOutput, VerifyResult } from "./types";

/**
 * The stages wired from today's pure functions, mirroring the free pipe in
 * `hamilton/rules-recheck.ts` (`reproducibleReads`) and the publish step's own order
 * (category guard, name hold, skip reason, prior-fee decision). An experiment only passes
 * different arguments to the same functions; no production code changes.
 */
export interface ExperimentConfig {
  id: string;
  description: string;
  /** Verify also requires the shared source check (`checkFeeAgainstSource`) to pass. */
  requireSourceCheck: boolean;
}

const CURRENT_CONFIG: ExperimentConfig = {
  id: "current",
  description: "Today's free Knox read, Darwin's rule checks and Hamilton's publish gate.",
  requireSourceCheck: false,
};

export const DEFAULT_EXPERIMENT = "source-check-gate";

export const EXPERIMENTS: Readonly<Record<string, ExperimentConfig>> = {
  [DEFAULT_EXPERIMENT]: {
    id: DEFAULT_EXPERIMENT,
    description: "Every fee must pass the shared source check (checkFeeAgainstSource) before it publishes.",
    requireSourceCheck: true,
  },
};

export function selectExperiment(env: Readonly<Record<string, string | undefined>> = process.env): ExperimentConfig {
  const name = env.SHADOW_LAB_EXPERIMENT || DEFAULT_EXPERIMENT;
  const config = EXPERIMENTS[name];
  if (!config) {
    throw new Error(`unknown SHADOW_LAB_EXPERIMENT "${name}"; known: ${Object.keys(EXPERIMENTS).join(", ")}`);
  }
  return config;
}

/** The fixed document id every replayed line shares: one case is one stored document. */
const REPLAY_DOCUMENT_ID = 1;
const REPLAY_PUBLISHED_AT = "2026-01-01T00:00:00.000Z";

function filedAs(text: string, hint: string, name: string, amount: number): string {
  return refileCategory(hint, name, foldContext(text, name, amount)) ?? hint;
}

function readText(text: string): StageOutput {
  const result = runFreeSpecialists(text);
  const passed: StageFee[] = result.candidates.map((candidate) => ({
    canonicalFeeKey: filedAs(text, candidate.canonicalHint, candidate.feeName, candidate.amount),
    feeName: candidate.feeName,
    amountCents: toCents(candidate.amount),
    frequency: candidate.frequency ?? null,
    excerpt: candidate.excerpt ?? null,
    reason: null,
  }));
  const dropped: StageFee[] = [];
  for (const held of result.held) {
    const fee: StageFee = {
      canonicalFeeKey: held.canonicalHint ? filedAs(text, held.canonicalHint, held.feeName, held.amount ?? 0) : null,
      feeName: held.feeName,
      amountCents: toCents(held.amount),
      frequency: held.frequency ?? null,
      excerpt: held.excerpt ?? null,
      reason: null,
    };
    // A stated $0 with a category is a fee the free pipe keeps (`reproducibleReads`).
    if (held.shape === "zero" && fee.canonicalFeeKey) passed.push({ ...fee, amountCents: 0 });
    else dropped.push({ ...fee, reason: `held:${held.shape}` });
  }
  return { passed, dropped };
}

function verifyFee(config: ExperimentConfig, fee: StageFee, text: string): VerifyResult {
  const key = fee.canonicalFeeKey;
  const name = fee.feeName ?? "";
  const amount = (fee.amountCents ?? 0) / 100;
  if (!key) return { ok: false, reason: "no_category" };
  if (!passesDarwinChecks(key, name, amount)) return { ok: false, reason: "darwin_checks" };
  const limit = limitGuardVerdict({
    canonical_fee_key: key,
    fee_name: name,
    amount,
    conditions: `Knox deterministic extraction. excerpt="${fee.excerpt ?? ""}"`,
  });
  if (limit) return { ok: false, reason: `limit_guard:${limit.code}` };
  const rule = ruleFor(key, name, amount, fee.excerpt);
  if (rule) return { ok: false, reason: `eval_rule:${rule}` };
  if (config.requireSourceCheck) {
    const source = checkFeeAgainstSource(text, name, amount, ".", key);
    if (!source.ok) return { ok: false, reason: `source_check:${source.reason}` };
  }
  return { ok: true, fee };
}

function priorRow(fee: StageFee, index: number): PriorPublishedFeeRow {
  return {
    fee_published_id: index + 1,
    amount: toDollars(fee.amountCents),
    fee_name: fee.feeName ?? "",
    frequency: fee.frequency ?? null,
    published_at: REPLAY_PUBLISHED_AT,
    source_document_id: REPLAY_DOCUMENT_ID,
  } as PriorPublishedFeeRow;
}

function gateFee(fee: StageFee, text: string, live: StageFee[]) {
  const key = fee.canonicalFeeKey ?? "";
  const name = fee.feeName ?? "";
  const category = checkFeeCategory(key, name);
  if (!category.ok) return { publish: false, reason: `category_guard:${category.code}` };
  const hold = publishNameHold(name, key, fee.amountCents == null ? null : fee.amountCents / 100);
  if (hold) return { publish: false, reason: `name_hold:${hold.code}` };
  const row = verifiedRow(
    { canonical_fee_key: key, fee_name: name, amount: toDollars(fee.amountCents) ?? "0.00", source_document_id: REPLAY_DOCUMENT_ID },
    { frequency: fee.frequency ?? null },
  );
  const skip = publishSkipReason(row, HAMILTON_PUBLISH_DEFAULT_MIN_CONFIDENCE);
  if (skip) return { publish: false, reason: `skip:${skip}` };
  const sameKey = live.filter((prior) => prior.canonicalFeeKey === key).map(priorRow);
  const apart = sameValueLinesApart(row, sameKey, text);
  const decision = decidePriorFee(row, sameKey, (prior) => apart.has(prior));
  if (decision.kind === "identical" || decision.kind === "older_document") {
    return { publish: false, reason: `prior:${decision.kind}` };
  }
  return { publish: true, reason: null };
}

function buildVariant(config: ExperimentConfig): PipelineVariant {
  return {
    id: config.id,
    description: config.description,
    documentGate(c: ShadowCase) {
      if (c.document.url && isProductPage(c.document.url)) return { accepted: false, reason: "product_page" };
      return { accepted: true, reason: null };
    },
    extract: readText,
    verify: (fee, text) => verifyFee(config, fee, text),
    publishGate: gateFee,
  };
}

export const currentVariant: PipelineVariant = buildVariant(CURRENT_CONFIG);

export function experimentalVariant(config: ExperimentConfig): PipelineVariant {
  return buildVariant(config);
}
