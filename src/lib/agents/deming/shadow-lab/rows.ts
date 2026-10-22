import type { VerifiedFeeRow } from "@/lib/agents/hamilton/publish";

const CENTS_PER_DOLLAR = 100;

/** Dollars (number or decimal string) to whole cents; null when there is no amount. */
export function toCents(amount: number | string | null | undefined): number | null {
  if (amount == null || amount === "") return null;
  const value = typeof amount === "number" ? amount : Number(amount);
  return Number.isFinite(value) ? Math.round(value * CENTS_PER_DOLLAR) : null;
}

export function toDollars(cents: number | null): string | null {
  return cents == null ? null : (cents / CENTS_PER_DOLLAR).toFixed(2);
}

/** A verified row as the publish step reads it, for one line of a stored document. */
export function verifiedRow(
  input: { canonical_fee_key: string; fee_name: string; amount: string; source_document_id: number },
  extra: Partial<VerifiedFeeRow> = {},
): VerifiedFeeRow {
  return {
    fee_verified_id: 1,
    fee_raw_id: 1,
    institution_id: 1,
    source_url: "https://bank.example/fees",
    document_r2_key: null,
    extraction_confidence: 0.95,
    canonical_fee_key: input.canonical_fee_key,
    variant_type: null,
    outlier_flags: ["agentic_darwin_verified"],
    verified_by_agent_event_id: "00000000-0000-4000-8000-000000000001",
    fee_name: input.fee_name,
    amount: input.amount,
    frequency: null,
    raw_agent_event_id: null,
    source_document_id: input.source_document_id,
    fee_audience: "unknown",
    ...extra,
  };
}
