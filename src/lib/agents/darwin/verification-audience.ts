import { createHash } from "node:crypto";
import type { sql } from "@/lib/data-store/connection";
import { productKey } from "@/lib/fee-product";
import { isPercentFee } from "@/lib/percent-fees";
import { excerptOf } from "@/lib/agents/hamilton/frequency-fill";
import type { RawFeeRow } from "./verify";
import { darwinAudience, type DarwinAudience } from "./audience";
import { ownPriceAudience } from "./own-price-audience";
import {
  matchOriginalRawSource,
  withLockedCurrentRawSource,
  type LockedCurrentRawSourceResult,
  type LockedRawFee,
} from "./locked-raw-source";

type SqlTag = typeof sql;
const admissionBrand = Symbol("current verification audience admission");

/** Transient: callers must roll back their row savepoint and record no ordinary decision. */
export class VerificationAudienceDeferred extends Error {
  constructor(readonly reason: string) {
    super(`Verification audience deferred: ${reason}`);
  }
}

export interface VerificationAudienceAdmission {
  readonly [admissionBrand]: true;
  /** Original current raw label/evidence, before deriving an effective audience. */
  readonly row: RawFeeRow;
  readonly audience: DarwinAudience | null;
  readonly sourceText: string | null;
  readonly ownClause: "none" | "qualified" | "ambiguous";
  readonly identity: string;
  readonly sourceIdentity: string | null;
  /** Held factual context for other guards; identity/text options are never a loader. */
  readonly sourceContext: Readonly<LockedCurrentRawSourceResult>;
  /** Set only after this caller's existing verification checks accept the final category. */
  readonly admittedCategory?: string;
  /** Existing held-release line-frequency fill, separate from the original raw identity. */
  readonly writeFrequency?: string | null;
}

const numeric = (value: unknown) => value == null || value === "" ? null : Number(value);
const json = (value: unknown) => JSON.stringify(value ?? null);

/** Existing selections project pipeline evidence into conditions. Preserve that contract. */
export function rawVerificationProjection(current: LockedRawFee, selected: RawFeeRow): RawFeeRow {
  return { ...selected, ...current, conditions: current.extraction_note ?? current.conditions };
}

/** Minimal direct callers remain supported; every supplied raw fact must still be current. */
export function admittedRawMatches(selected: RawFeeRow, current: RawFeeRow): boolean {
  if (Number(selected.fee_raw_id) !== Number(current.fee_raw_id) ||
      Number(selected.institution_id) !== Number(current.institution_id) ||
      selected.fee_name !== current.fee_name ||
      isPercentFee(selected) !== isPercentFee(current) ||
      numeric(selected.amount) !== numeric(current.amount)) return false;
  for (const field of ["rate_percent", "rate_min_amount", "rate_max_amount", "source_document_id"] as const) {
    if (selected[field] !== undefined && numeric(selected[field]) !== numeric(current[field])) return false;
  }
  for (const field of ["frequency", "rate_basis", "source_url", "document_url", "document_r2_key", "fee_audience", "conditions"] as const) {
    if (selected[field] !== undefined && selected[field] !== current[field]) return false;
  }
  if (selected.product_name !== undefined && productKey(selected.product_name) !== productKey(current.product_name)) return false;
  if (selected.outlier_flags !== undefined && json(selected.outlier_flags) !== json(current.outlier_flags)) return false;
  return true;
}

function rawIdentity(row: RawFeeRow): string {
  return createHash("sha256").update(json({
    id: Number(row.fee_raw_id), institution: Number(row.institution_id), name: row.fee_name,
    amount: numeric(row.amount), kind: isPercentFee(row) ? "percent" : "flat",
    rate: numeric(row.rate_percent), min: numeric(row.rate_min_amount), max: numeric(row.rate_max_amount),
    basis: row.rate_basis ?? null, document: numeric(row.source_document_id),
    frequency: row.frequency, url: row.source_url, r2: row.document_r2_key,
    audience: row.fee_audience ?? "unknown", product: productKey(row.product_name),
    flags: row.outlier_flags, evidence: row.conditions,
  })).digest("hex");
}

/**
 * Call inside the consumer's row savepoint. Available facts stay locked even without a cue.
 * A genuinely unavailable legacy source remains a documented boundary, not proof of absence.
 */
export async function prepareVerificationAudience(
  db: SqlTag,
  selected: RawFeeRow,
  legacySourceText: string | null = null,
): Promise<VerificationAudienceAdmission> {
  try {
    return await prepareCurrentAudience(db, selected, legacySourceText);
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === "55P03" || code === "40001") {
      throw new VerificationAudienceDeferred(code === "55P03" ? "busy" : "changed");
    }
    throw error;
  }
}

async function prepareCurrentAudience(
  db: SqlTag,
  selected: RawFeeRow,
  legacySourceText: string | null,
): Promise<VerificationAudienceAdmission> {
  const context = await withLockedCurrentRawSource(db, Number(selected.fee_raw_id));
  if (context.kind === "busy" || context.kind === "changed") throw new VerificationAudienceDeferred(context.kind);
  let row: RawFeeRow;
  let sourceText: string | null;
  let sourceIdentity: string | null = null;
  let ownClause: VerificationAudienceAdmission["ownClause"] = "none";
  if (context.kind === "bound") {
    row = { ...rawVerificationProjection(context.currentRaw, selected), document_url: context.source.document.document_url };
    if (!admittedRawMatches(selected, row)) throw new VerificationAudienceDeferred("admitted_raw_changed");
    sourceText = context.source.normalizedText;
    const own = ownPriceAudience(sourceText, row.fee_name, isPercentFee(row) ? null : numeric(row.amount));
    ownClause = own.kind;
    sourceIdentity = `${context.source.documentId}:${context.source.artifactId}:${context.source.textHash}`;
    if ((!row.fee_audience || row.fee_audience === "unknown") && own.kind !== "none") {
      const original = matchOriginalRawSource(context.currentRaw, context.source);
      if (original.kind !== "matched") throw new VerificationAudienceDeferred(original.reason);
    }
  } else {
    // This is only a cue probe, never a second source loader or admission authority. The
    // source helper rolled back its prefix. Lock current raw NOWAIT and check its actual
    // linked current body before preserving the existing unavailable-source behavior.
    const [current] = await db<LockedRawFee[]>`
      SELECT fr.* FROM raw_fee_observations fr WHERE fee_raw_id=${Number(selected.fee_raw_id)} FOR UPDATE NOWAIT`;
    if (!current) throw new VerificationAudienceDeferred("missing_raw");
    row = rawVerificationProjection(current, selected);
    if (!admittedRawMatches(selected, row)) throw new VerificationAudienceDeferred("admitted_raw_changed");
    const [cue] = await db<{ normalized_text: string | null }[]>`
      SELECT ast.normalized_text FROM agent_source_texts ast
      WHERE ast.source_document_id=${row.source_document_id ?? null}
        AND ast.institution_id=${Number(row.institution_id)}`;
    const own = ownPriceAudience(cue?.normalized_text ?? "", row.fee_name, isPercentFee(row) ? null : numeric(row.amount));
    // A current raw's own retained clause can require deferral; it cannot grant a new
    // classification when the actual current source binding is unavailable.
    const retainedCue = ownPriceAudience(excerptOf(current.extraction_note ?? current.conditions) ?? "",
      row.fee_name, isPercentFee(row) ? null : numeric(row.amount));
    if ((!row.fee_audience || row.fee_audience === "unknown") && (own.kind !== "none" || retainedCue.kind !== "none")) {
      throw new VerificationAudienceDeferred(`unavailable_${context.reason}`);
    }
    sourceText = legacySourceText;
  }
  const audience = darwinAudience(row, isPercentFee(row) ? null : numeric(row.amount), sourceText,
    context.kind === "bound" ? { ownPriceClause: true } : {});
  return { [admissionBrand]: true, row, audience, sourceText, ownClause,
    identity: rawIdentity(row), sourceIdentity, sourceContext: context };
}

/** The final writer independently recomputes authority; a caller's decision is only a hint. */
export function requireSameAudienceAdmission(
  current: VerificationAudienceAdmission,
  admitted: VerificationAudienceAdmission | undefined,
  canonicalFeeKey: string,
): void {
  if (!admitted) {
    if ((!current.row.fee_audience || current.row.fee_audience === "unknown") && current.ownClause !== "none") {
      throw new VerificationAudienceDeferred("own_clause_requires_admission");
    }
    return;
  }
  if (admitted[admissionBrand] !== true || admitted.admittedCategory !== canonicalFeeKey || admitted.identity !== current.identity ||
      admitted.sourceIdentity !== current.sourceIdentity || json(admitted.audience) !== json(current.audience)) {
    throw new VerificationAudienceDeferred("audience_admission_changed");
  }
}

/** Metadata completion does not replace any price/category/peer/source check. */
export function completeAudienceAdmission(
  current: VerificationAudienceAdmission,
  canonicalFeeKey: string,
  writeFrequency: string | null = current.row.frequency,
): VerificationAudienceAdmission {
  return { ...current, admittedCategory: canonicalFeeKey, writeFrequency };
}
