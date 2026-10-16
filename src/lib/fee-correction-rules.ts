/**
 * Admin fee correction rules (H03, #978) shared by the server service and the admin UI. No
 * database imports. The lifecycle is in docs/plans/hamilton-h03-corrections.md.
 */

import { FEE_FAMILIES, getDisplayName } from "@/lib/fee-taxonomy";

export const FEE_CORRECTION_CHECK = "admin.fee_correction";
/** Marks the quarantine on a published row a correction replaced. Not an admin hold. */
export const ADMIN_CORRECTION_PREFIX = "admin_correction:";
export const CORRECTION_BATCH_PREFIX = "admin-correction-";

export const MIN_CORRECTION_REASON = 5;
export const MAX_CORRECTION_REASON = 500;
export const MIN_EXCERPT = 6;
export const MAX_EXCERPT = 2000;
export const MIN_LOCATION = 3;
export const MAX_LOCATION = 300;
export const MAX_FEE_NAME = 200;
export const MAX_CONDITIONS = 1000;
/** No real bank fee in the catalog is above this; a typo of an extra zero or two is caught. */
export const MAX_CORRECTED_AMOUNT = 10_000;

/** The fee types an operator may file a fee under: the 50-type taxonomy (plus any James added). */
export const CORRECTION_CATEGORIES: readonly string[] = Object.values(FEE_FAMILIES).flat();

/** How often a fee is charged, as the catalog stores it. Null means the schedule states none. */
export const CORRECTION_FREQUENCIES = [
  "per_item",
  "per_transaction",
  "per_occurrence",
  "one_time",
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "semi_annual",
  "annual",
  "hourly",
] as const;

export interface FeeCorrectionActor {
  id: number;
  name: string;
  role: string;
}

/** Only an admin may correct or reverse (James, 2026-10-16). Analysts may still hold. */
export function canCorrectFees(role: string | null | undefined): boolean {
  return role === "admin";
}

export interface FeeCorrectionInput {
  feePublishedId: number;
  /** The version the editor saw: 0 for a fee never corrected. A stale value is refused. */
  expectedVersion: number;
  /** One per opened form; a retry with the same key returns the first result. */
  idempotencyKey: string;
  canonicalFeeKey: string;
  feeName: string;
  amount: number;
  frequency: string | null;
  conditions: string | null;
  sourceDocumentId: number;
  sourceExcerpt: string;
  sourceLocation: string;
  reason: string;
}

export interface FeeReversalInput {
  feePublishedId: number;
  expectedVersion: number;
  idempotencyKey: string;
  reason: string;
}

export type CorrectionField = keyof FeeCorrectionInput;

export type Validated<T> = { ok: true; value: T } | { ok: false; errors: Partial<Record<string, string>> };

function oneLine(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function positiveId(value: unknown): number | null {
  const id = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function version(value: unknown): number | null {
  const v = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isSafeInteger(v) && v >= 0 ? v : null;
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,100}$/;

/** A dollar amount with at most two decimals, from a number or typed text ("$1,234.50"). Pure. */
export function parseCorrectedAmount(value: unknown): number | null {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.replace(/[$,\s]/g, "") : "";
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const amount = Number(text);
  return Number.isFinite(amount) && amount >= 0 && amount <= MAX_CORRECTED_AMOUNT ? amount : null;
}

function common(raw: Record<string, unknown>, errors: Partial<Record<string, string>>) {
  const feePublishedId = positiveId(raw.feePublishedId);
  if (!feePublishedId) errors.feePublishedId = "Choose a fee.";
  const expectedVersion = version(raw.expectedVersion);
  if (expectedVersion == null) errors.expectedVersion = "Reload the page and try again.";
  const idempotencyKey = typeof raw.idempotencyKey === "string" ? raw.idempotencyKey : "";
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) errors.idempotencyKey = "Reload the page and try again.";
  const reason = oneLine(raw.reason);
  if (reason.length < MIN_CORRECTION_REASON || reason.length > MAX_CORRECTION_REASON) {
    errors.reason = `Give a reason of ${MIN_CORRECTION_REASON} to ${MAX_CORRECTION_REASON} characters.`;
  }
  return { feePublishedId: feePublishedId ?? 0, expectedVersion: expectedVersion ?? 0, idempotencyKey, reason };
}

/** Server-side validation of a correction form. Never trusts the browser's checks. Pure. */
export function validateCorrectionInput(raw: Record<string, unknown>): Validated<FeeCorrectionInput> {
  const errors: Partial<Record<string, string>> = {};
  const base = common(raw, errors);
  const canonicalFeeKey = oneLine(raw.canonicalFeeKey);
  if (!CORRECTION_CATEGORIES.includes(canonicalFeeKey)) errors.canonicalFeeKey = "Choose one of the 50 fee types.";
  const feeName = oneLine(raw.feeName);
  if (feeName.length < 2 || feeName.length > MAX_FEE_NAME) errors.feeName = `Give the fee's name as the schedule prints it (2 to ${MAX_FEE_NAME} characters).`;
  const amount = parseCorrectedAmount(raw.amount);
  if (amount == null) errors.amount = `Give a dollar amount from $0 to $${MAX_CORRECTED_AMOUNT.toLocaleString()}, at most two decimals.`;
  const frequencyText = oneLine(raw.frequency);
  const frequency = frequencyText === "" ? null : frequencyText;
  if (frequency != null && !(CORRECTION_FREQUENCIES as readonly string[]).includes(frequency)) errors.frequency = "Choose how often it is charged.";
  const conditionsText = oneLine(raw.conditions);
  if (conditionsText.length > MAX_CONDITIONS) errors.conditions = `Keep conditions under ${MAX_CONDITIONS} characters.`;
  const sourceDocumentId = positiveId(raw.sourceDocumentId);
  if (!sourceDocumentId) errors.sourceDocumentId = "Choose the source document the value is read from.";
  const sourceExcerpt = typeof raw.sourceExcerpt === "string" ? raw.sourceExcerpt.trim() : "";
  if (sourceExcerpt.length < MIN_EXCERPT || sourceExcerpt.length > MAX_EXCERPT) {
    errors.sourceExcerpt = `Paste the schedule's own words for this fee (${MIN_EXCERPT} to ${MAX_EXCERPT} characters).`;
  }
  const sourceLocation = oneLine(raw.sourceLocation);
  if (sourceLocation.length < MIN_LOCATION || sourceLocation.length > MAX_LOCATION) {
    errors.sourceLocation = "Say where it sits in the document (page, section or row).";
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      ...base,
      canonicalFeeKey,
      feeName,
      amount: amount as number,
      frequency,
      conditions: conditionsText === "" ? null : conditionsText,
      sourceDocumentId: sourceDocumentId as number,
      sourceExcerpt,
      sourceLocation,
    },
  };
}

export function validateReversalInput(raw: Record<string, unknown>): Validated<FeeReversalInput> {
  const errors: Partial<Record<string, string>> = {};
  const base = common(raw, errors);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: base };
}

/** Text compared loosely: case, whitespace, table pipes and curly quotes ignored. Pure. */
export function looseText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[|•·]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The excerpt the operator pasted is in the stored text of that document. Pure. */
export function excerptInText(excerpt: string, text: string | null | undefined): boolean {
  if (!text) return false;
  const needle = looseText(excerpt);
  return needle.length > 0 && looseText(text).includes(needle);
}

/** The quarantine reason on the row a correction version replaced. Pure. */
export function correctionQuarantineReason(version: number, newFeePublishedId: number): string {
  return `${ADMIN_CORRECTION_PREFIX} superseded by correction version ${version} (fee #${newFeePublishedId})`;
}

export interface FeeValues {
  canonicalFeeKey: string;
  feeName: string;
  amount: number | null;
  frequency: string | null;
  conditions: string | null;
}

/** A fee name with punctuation, spacing and case ignored, as the publish match reads it. Pure. */
export function feeNameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** True when the new values change nothing the operator can edit. Pure. */
export function sameFeeValues(a: FeeValues, b: FeeValues): boolean {
  return a.canonicalFeeKey === b.canonicalFeeKey
    && feeNameKey(a.feeName) === feeNameKey(b.feeName)
    && (a.amount == null ? b.amount == null : b.amount != null && Math.abs(a.amount - b.amount) < 0.005)
    && (a.frequency ?? null) === (b.frequency ?? null)
    && looseText(a.conditions ?? "") === looseText(b.conditions ?? "");
}

/**
 * A fee's stored treatment (from its lineage) must agree with the corrected amount: a charged fee
 * is above $0, a no-charge or eliminated fee is $0. The published row inherits the treatment, so
 * the database would refuse the write anyway; this says why first. Pure.
 */
export function treatmentConflict(treatment: string | null | undefined, amount: number): string | null {
  if (treatment === "charged" && amount <= 0) return "This fee's source line is a charged fee, so it cannot be corrected to $0. Hold it instead.";
  if ((treatment === "no_charge" || treatment === "eliminated") && amount > 0) {
    return "This fee's source line says there is no charge, so it cannot be corrected to a price. Hold it instead.";
  }
  return null;
}

export function categoryLabel(key: string): string {
  return getDisplayName(key);
}

export type FeeCorrectionResult =
  | {
      ok: true;
      correctionId: number;
      version: number;
      feePublishedId: number;
      previousFeePublishedId: number;
      institutionId: number;
      runId: number | null;
      indexRefreshed: boolean;
      /** A retry of a request already saved: nothing new was written. */
      replay: boolean;
    }
  | { ok: false; error: string; errors?: Partial<Record<string, string>>; code?: "forbidden" | "stale" | "invalid" | "unavailable" | "evidence" };

export interface FeeCorrectionVersion {
  id: number;
  feeChainId: number;
  version: number;
  action: "correct" | "reverse";
  status: "current" | "superseded";
  createdAt: string;
  feePublishedId: number;
  previousFeePublishedId: number;
  before: FeeValues;
  after: FeeValues;
  sourceDocumentId: number | null;
  sourceExcerpt: string | null;
  sourceLocation: string | null;
  reason: string;
  actorName: string;
  agentRunId: number | null;
}

export interface FeeCorrectionConflict {
  id: number;
  feeChainId: number;
  correctionId: number;
  createdAt: string;
  feeVerifiedId: number;
  sourceDocumentId: number | null;
  canonicalFeeKey: string;
  feeName: string;
  amount: number | null;
  frequency: string | null;
  /** What the current correction says, for the side-by-side. */
  current: FeeValues;
}

export interface InstitutionCorrections {
  /** False until the migration has added the tables. */
  enabled: boolean;
  /** The current version per live published row (fee_published_id to version). */
  versions: Record<number, number>;
  history: FeeCorrectionVersion[];
  conflicts: FeeCorrectionConflict[];
}
