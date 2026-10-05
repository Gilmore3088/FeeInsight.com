import type { FeePublicationStatus } from "@/lib/institution-quality";

/**
 * Public-facing labels for internal enum values. Everything on the institution
 * profile and directory that reaches a reader passes through this map so raw
 * database vocabulary (community_small, per_occurrence, ...) never leaks.
 */

export type PublicFeeStatusLabel = "Fees published" | "Under review" | "No published schedule found";

const PUBLIC_STATUS_LABELS: Record<FeePublicationStatus, PublicFeeStatusLabel> = {
  // Not "Verified": any published fee sets this status, which says nothing about completeness.
  verified: "Fees published",
  provisional: "Under review",
  under_review: "Under review",
  unavailable: "No published schedule found",
};

export function getPublicStatusLabel(status: FeePublicationStatus | null | undefined): PublicFeeStatusLabel {
  return PUBLIC_STATUS_LABELS[status ?? "unavailable"];
}

const SEGMENT_LABELS: Record<string, { bank: string; credit_union: string }> = {
  community_small: {
    bank: "Community bank, under $300M",
    credit_union: "Community credit union, under $300M",
  },
  community_mid: {
    bank: "Community bank, $300M to $1B",
    credit_union: "Community credit union, $300M to $1B",
  },
  community_large: {
    bank: "Community bank, $1B to $10B",
    credit_union: "Community credit union, $1B to $10B",
  },
  regional: {
    bank: "Regional bank, $10B to $50B",
    credit_union: "Regional credit union, $10B to $50B",
  },
  large_regional: {
    bank: "Large regional bank, $50B to $250B",
    credit_union: "Large regional credit union, $50B to $250B",
  },
  super_regional: {
    bank: "National bank, over $250B",
    credit_union: "National credit union, over $250B",
  },
  micro: { bank: "Community bank, under $100M", credit_union: "Community credit union, under $100M" },
  community: { bank: "Community bank, $100M to $1B", credit_union: "Community credit union, $100M to $1B" },
  midsize: { bank: "Mid-size bank, $1B to $10B", credit_union: "Mid-size credit union, $1B to $10B" },
  mega: { bank: "National bank, over $250B", credit_union: "National credit union, over $250B" },
};

export function getSegmentLabel(
  tier: string | null | undefined,
  charterType: string | null | undefined,
): string | null {
  if (!tier) return null;
  const entry = SEGMENT_LABELS[tier];
  if (!entry) return null;
  return charterType === "credit_union" ? entry.credit_union : entry.bank;
}

const FREQUENCY_LABELS: Record<string, string> = {
  per_occurrence: "per item",
  monthly: "per month",
  annual: "per year",
  quarterly: "per quarter",
  daily: "per day",
  one_time: "one time",
  other: "varies",
  source_url: "",
};

export function getFrequencyLabel(frequency: string | null | undefined): string {
  if (!frequency) return "";
  const key = frequency.trim().toLowerCase();
  if (key in FREQUENCY_LABELS) return FREQUENCY_LABELS[key];
  return key.replace(/_/g, " ");
}

export function getCharterLabel(charterType: string | null | undefined): string {
  return charterType === "bank" ? "Bank" : "Credit Union";
}

const SMALL_WORDS = new Set(["of", "and", "the", "on", "at", "in", "by", "de", "la", "del"]);

/** Title-cases ALL-CAPS strings only; mixed-case input is returned unchanged. */
export function toTitleCase(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed !== trimmed.toUpperCase()) return trimmed;
  return trimmed
    .toLowerCase()
    .split(/(\s+|-|\/)/)
    .map((part, index) => {
      if (!part || /^(\s+|-|\/)$/.test(part)) return part;
      if (index > 0 && SMALL_WORDS.has(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join("");
}
