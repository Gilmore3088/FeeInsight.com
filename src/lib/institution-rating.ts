/**
 * Institution rating engine for consumer decision pages.
 *
 * Locked thresholds (D-01, never change without explicit decision):
 *   overdraft ≤ $20   → green  "Consumer-Friendly"
 *   overdraft $20.01-$36 → yellow "Average Fee Structure"
 *   overdraft > $36   → red   "Above-Average Fees"
 *
 * The verdict keys on the paid-item overdraft charge (NSF / returned-item as a
 * fallback). Overdraft-family rows that are not a paid-item charge — transfer
 * sweeps, protection enrolment, continuous/daily fees — never drive it, and when
 * no paid-item overdraft or NSF fee is verified there is no verdict at all
 * (callers render "Overdraft fee not published").
 *
 * Security (T-30.1-01): fee amounts are validated as finite, non-negative
 * before any comparison.
 */

import type { IndexEntry } from "./data-store/fee-index";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OVERDRAFT_GREEN_MAX = 20;    // ≤ $20 → green
const OVERDRAFT_YELLOW_MAX = 36;   // $20.01–$36 → yellow; > $36 → red

const BONUS_SIGNALS = ["cap", "de minimis", "balance threshold", "maximum", "limit"];

// Typical fee count range for context copy (hardcoded per spec §4): CU floor, bank ceiling
const TYPICAL_BANK_MAX = 50;
const TYPICAL_CU_MIN = 25;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RatingInput {
  id: number;
  fee_name: string;
  amount: number | null;
  fee_category?: string | null;
  conditions?: string | null;
}

export interface RatingResult {
  label: string;
  color: "green" | "yellow" | "red";
  bullets: string[];
}

export interface StrengthsWatch {
  strengths: string[];
  watch: string[];
}

export interface InterpretationParams {
  rating: RatingResult;
  feeCount: number;
  overdraftAmount: number | null;
  charterType: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Clamp a number to a safe, finite value >= 0 (T-30.1-01). */
function safeAmount(amount: number | null | undefined): number | null {
  if (amount === null || amount === undefined) return null;
  if (!isFinite(amount) || isNaN(amount)) return null;
  return Math.max(0, amount);
}

function hasBonusSignal(conditions: string | null | undefined): boolean {
  if (!conditions) return false;
  const lower = conditions.toLowerCase();
  return BONUS_SIGNALS.some((s) => lower.includes(s));
}

function buildIndexMap(nationalIndex: IndexEntry[]): Map<string, IndexEntry> {
  return new Map(nationalIndex.map((e) => [e.fee_category, e]));
}

/** Overdraft-family rows that are not a paid-item charge; excluded from detection. */
export const NON_PAID_ITEM_OVERDRAFT_PATTERN =
  /transfer|protection|line of credit|continuous|daily|sweep|extended|sustained/i;
const OVERDRAFT_NAME_PATTERN = /overdraft/i;
const NSF_NAME_PATTERN = /\b(nsf|non-?sufficient|insufficient funds|returned item)\b/i;

export interface PaidItemFee {
  amount: number;
  conditions: string | null;
  kind: "overdraft" | "nsf";
}

function isPaidItemCandidate(fee: RatingInput): boolean {
  return !NON_PAID_ITEM_OVERDRAFT_PATTERN.test(fee.fee_name);
}

const overdraftByCategory = (fee: RatingInput) => isPaidItemCandidate(fee) && fee.fee_category === "overdraft";
const overdraftByName = (fee: RatingInput) => isPaidItemCandidate(fee) && OVERDRAFT_NAME_PATTERN.test(fee.fee_name);
const nsfByCategory = (fee: RatingInput) => fee.fee_category === "nsf";
const nsfByName = (fee: RatingInput) => NSF_NAME_PATTERN.test(fee.fee_name);

/**
 * The verified paid-item overdraft fee, falling back to the NSF / returned-item fee.
 * Category match first, then name match; non-paid-item overdraft rows never qualify.
 */
export function detectPaidItemFee(fees: RatingInput[]): PaidItemFee | null {
  const pick = (predicate: (fee: RatingInput) => boolean, kind: PaidItemFee["kind"]) => {
    for (const fee of fees) {
      if (!predicate(fee)) continue;
      const amount = safeAmount(fee.amount);
      if (amount !== null && amount > 0) return { amount, conditions: fee.conditions ?? null, kind };
    }
    return null;
  };
  // Within each kind a category match beats a name match, whatever the row order, so the
  // bullet names the same row as the profile's overdraft callout (which picks by category).
  return (
    pick(overdraftByCategory, "overdraft") ??
    pick(overdraftByName, "overdraft") ??
    pick(nsfByCategory, "nsf") ??
    pick(nsfByName, "nsf")
  );
}

function overdraftColor(amount: number): "green" | "yellow" | "red" {
  if (amount <= OVERDRAFT_GREEN_MAX) return "green";
  if (amount <= OVERDRAFT_YELLOW_MAX) return "yellow";
  return "red";
}

/** Format a dollar amount for display in bullets. */
function fmt(amount: number): string {
  return `$${amount % 1 === 0 ? amount.toFixed(0) : amount.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// computeInstitutionRating
// ---------------------------------------------------------------------------

/**
 * Compute an institution's fee rating.
 *
 * Strategy (per D-01 through D-03):
 * 1. Find the paid-item overdraft fee (NSF fallback); non-paid-item rows are ignored.
 * 2. Apply locked thresholds.
 * 3. Apply bonus signals that can improve yellow-border cases.
 * Returns null when no paid-item overdraft/NSF fee is verified — no verdict is
 * better than a verdict keyed on the wrong fee.
 */
export function computeInstitutionRating(
  fees: RatingInput[],
  nationalIndex: IndexEntry[]
): RatingResult | null {
  if (fees.length === 0) return null;

  const paidItem = detectPaidItemFee(fees);
  if (paidItem === null) return null;

  const bullets: string[] = [];
  const feeCount = fees.length;
  const base = overdraftColor(paidItem.amount);
  const hasBonus = hasBonusSignal(paidItem.conditions);
  const feeLabel = paidItem.kind === "overdraft" ? "Overdraft fee" : "NSF fee";

  bullets.push(`${feeLabel}: ${fmt(paidItem.amount)}`);

  if (hasBonus) {
    bullets.push("Overdraft fee cap or limit policy detected — fewer surprise charges");
  }

  // D-02: can upgrade yellow→green in 20-25 range with cap
  let color: "green" | "yellow" | "red" = base;
  if (base === "yellow" && hasBonus && paidItem.amount <= 25) {
    color = "green";
  }

  const benchmark = nationalIndex.find((e) => e.fee_category === paidItem.kind);
  if (benchmark?.median_amount) {
    const delta = paidItem.amount - benchmark.median_amount;
    const pct = Math.round((delta / benchmark.median_amount) * 100);
    const noun = paidItem.kind === "overdraft" ? "overdraft" : "NSF";
    if (Math.abs(pct) >= 5) {
      bullets.push(
        pct < 0
          ? `${Math.abs(pct)}% below the national median ${noun} fee`
          : `${Math.abs(pct)}% above the national median ${noun} fee`
      );
    } else {
      bullets.push(`${feeLabel} is aligned with the national median`);
    }
  }

  if (feeCount < TYPICAL_CU_MIN) {
    bullets.push(`Total fees: ${feeCount} — leaner than most institutions`);
  } else if (feeCount <= TYPICAL_BANK_MAX) {
    bullets.push(`Total fees: ${feeCount}`);
  } else {
    bullets.push(`Total fees: ${feeCount} — broader fee menu than most`);
  }

  const label =
    color === "green"
      ? "Consumer-Friendly"
      : color === "yellow"
        ? "Average Fee Structure"
        : "Above-Average Fees";

  return { label, color, bullets: bullets.slice(0, 3) };
}

/** Shown in place of a verdict when no paid-item overdraft/NSF fee is verified. */
export const NO_VERDICT_LABEL = "Overdraft fee not published";

// ---------------------------------------------------------------------------
// deriveStrengthsAndWatch
// ---------------------------------------------------------------------------

/**
 * Derive up to 2 strengths and 2 watch items from fee data (D-09).
 *
 * Strengths: fees >10% below national median, low fee count.
 * Watch: fees >10% above national median, high fee count.
 */
export function deriveStrengthsAndWatch(
  fees: RatingInput[],
  nationalIndex: IndexEntry[]
): StrengthsWatch {
  if (fees.length === 0) return { strengths: [], watch: [] };

  const indexMap = buildIndexMap(nationalIndex);
  const strengths: string[] = [];
  const watch: string[] = [];

  for (const fee of fees) {
    if (strengths.length >= 2 && watch.length >= 2) break;

    const safe = safeAmount(fee.amount);
    if (safe === null) continue;

    const entry = indexMap.get(fee.fee_category ?? "");
    if (!entry || entry.median_amount === null || entry.median_amount === 0) continue;

    const delta = (safe - entry.median_amount) / entry.median_amount;

    const displayName = fee.fee_category
      ? toDisplayName(fee.fee_category)
      : fee.fee_name;

    if (delta < -0.1 && strengths.length < 2) {
      const pct = Math.round(Math.abs(delta) * 100);
      strengths.push(`${displayName}: ${fmt(safe)} — ${pct}% below the national median`);
    } else if (delta > 0.1 && watch.length < 2) {
      const pct = Math.round(delta * 100);
      watch.push(`${displayName}: ${fmt(safe)} — ${pct}% above the national median`);
    }
  }

  return { strengths, watch };
}

/** Simple display name fallback (avoids importing full taxonomy to keep this module lean). */
function toDisplayName(category: string): string {
  return category
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ---------------------------------------------------------------------------
// generateInterpretation
// ---------------------------------------------------------------------------

/**
 * Generate 2-3 plain English sentences summarising the institution's fee profile.
 *
 * Per D-08: always renders even with null overdraftAmount.
 * No jargon, no hedging, no AI-sounding language (Phase 29 voice standards).
 */
export function generateInterpretation(params: InterpretationParams): string {
  const { rating, feeCount, overdraftAmount, charterType } = params;
  const sentences: string[] = [];

  const institutionType =
    charterType === "credit_union" ? "credit union" : charterType === "bank" ? "bank" : "institution";

  // Sentence 1: overall rating narrative
  if (rating.color === "green") {
    sentences.push(
      `This ${institutionType} charges lower-than-average fees for most customers.`
    );
  } else if (rating.color === "yellow") {
    sentences.push(
      `This ${institutionType} has a fairly typical fee structure — close to what you'd find at most peers.`
    );
  } else {
    sentences.push(
      `This ${institutionType} charges higher-than-average fees in one or more key areas.`
    );
  }

  // Sentence 2: overdraft specifics or fee count context
  if (overdraftAmount !== null) {
    const safe = safeAmount(overdraftAmount);
    if (safe !== null) {
      if (safe <= OVERDRAFT_GREEN_MAX) {
        sentences.push(
          `The overdraft fee of ${fmt(safe)} is well below the national average, which is a meaningful benefit for customers who occasionally overdraw.`
        );
      } else if (safe <= OVERDRAFT_YELLOW_MAX) {
        sentences.push(
          `The overdraft fee of ${fmt(safe)} is in the normal range — not a standout in either direction.`
        );
      } else {
        sentences.push(
          `The overdraft fee of ${fmt(safe)} is higher than what most banks and credit unions charge, so customers who overdraw frequently may want to take note.`
        );
      }
    }
  } else if (feeCount > 0) {
    const isLow = feeCount < TYPICAL_CU_MIN;
    const isHigh = feeCount > TYPICAL_BANK_MAX;
    if (isLow) {
      sentences.push(
        `With only ${feeCount} fees on record, it has a simpler fee structure than most institutions — which generally means fewer ways to be charged unexpectedly.`
      );
    } else if (isHigh) {
      sentences.push(
        `With ${feeCount} fees on file, it has more line items than most — worth reviewing the full schedule before opening an account.`
      );
    } else {
      sentences.push(
        `It has ${feeCount} fees on record, which is in line with the typical range for a ${institutionType}.`
      );
    }
  } else {
    sentences.push(
      "Complete fee data isn't available yet — check back as the schedule is updated."
    );
  }

  // Sentence 3: actionable close (only for red or data-rich cases)
  if (rating.color === "red" && overdraftAmount !== null) {
    sentences.push(
      "If you're choosing between this and another option, it's worth comparing the overdraft and maintenance fees directly."
    );
  } else if (rating.color === "green" && feeCount > 0) {
    sentences.push(
      "Overall, the fee structure here is one of the more consumer-friendly ones in the index."
    );
  }

  return sentences.join(" ");
}
