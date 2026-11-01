import { LIMIT_GUARD_REASON, limitGuardVerdict, type LimitGuardCode } from "@/lib/agents/hamilton/limit-guard";
import type { LimitRow, LimitTakedownRow } from "./types";

/**
 * The shadow lab's `excerpt-at-publish` experiment (`shadow-lab/variants.ts`): Hamilton's publish-time
 * limit guard (`limitGuardVerdict`) reads Knox's excerpt. It maps to no live switch. The publish step
 * selects no `conditions` into its verified row (`publish.ts`), so the guard at publish never sees the
 * excerpt; only the live limit sweep (`rollBackLimitsPublishedAsFees`) reads it, after publication.
 * Turning it on is a code change (select the raw row's audit text into the publish row), not a flag.
 *
 * What it would change, counted two ways. Pure:
 * - live fees the guard holds with the excerpt and passes without it (they are live today and the
 *   sweep has not yet taken them down: a second look pending, or not yet reached);
 * - fees the live sweep took down with a reading only the excerpt gives (`transaction_amount`,
 *   `source_states_limit`) and that are still down: each went live first and would have been held at
 *   publish instead. A fee live again (the same institution, category, name and amount republished)
 *   is left out and counted on its own.
 */

/** The guard's readings that need Knox's excerpt; every other reading uses the name or amount. */
export const EXCERPT_ONLY_CODES: readonly LimitGuardCode[] = ["transaction_amount", "source_states_limit"];

export interface ExcerptHold {
  feePublishedId: number;
  institutionId: number;
  institutionName: string | null;
  sourceDocumentId: number | null;
  canonicalFeeKey: string;
  feeName: string;
  amount: number | null;
  code: LimitGuardCode;
  detail: string;
}

export interface ExcerptAtPublishSummary {
  liveChecked: number;
  liveHeld: number;
  liveByCode: Partial<Record<LimitGuardCode, number>>;
  liveSamples: ExcerptHold[];
  takenDown: number;
  /** Excerpt-only takedowns whose fee is live again: not counted in `takenDown`. */
  republished: number;
  takenDownByCode: Partial<Record<LimitGuardCode, number>>;
  takenDownSamples: Array<{ feePublishedId: number; institutionId: number; institutionName: string | null; canonicalFeeKey: string; feeName: string; amount: number | null; code: LimitGuardCode }>;
}

const amountOf = (value: number | string | null): number | null => (value == null || value === "" ? null : Number(value));

/** The guard's verdict with the excerpt when it is a hold the guard does not make without it. */
export function excerptOnlyHold(row: LimitRow): ExcerptHold | null {
  const input = { canonical_fee_key: row.canonical_fee_key, fee_name: row.fee_name, amount: row.amount };
  const withExcerpt = limitGuardVerdict({ ...input, conditions: row.conditions });
  if (!withExcerpt || limitGuardVerdict({ ...input, conditions: null })) return null;
  return {
    feePublishedId: Number(row.fee_published_id),
    institutionId: Number(row.institution_id),
    institutionName: row.institution_name,
    sourceDocumentId: row.source_document_id == null ? null : Number(row.source_document_id),
    canonicalFeeKey: row.canonical_fee_key,
    feeName: row.fee_name,
    amount: amountOf(row.amount),
    code: withExcerpt.code,
    detail: withExcerpt.detail,
  };
}

/** The reading a limit takedown recorded (`limit_as_fee:<code>: ...`), when it is excerpt-only. */
export function excerptOnlyTakedownCode(reason: string): LimitGuardCode | null {
  const match = reason.match(new RegExp(`^${LIMIT_GUARD_REASON}:([a-z_]+):`));
  const code = match?.[1] as LimitGuardCode | undefined;
  return code && EXCERPT_ONLY_CODES.includes(code) ? code : null;
}

export function summarizeExcerptAtPublish(
  live: readonly LimitRow[],
  takedowns: readonly LimitTakedownRow[],
  sampleCap: number,
): ExcerptAtPublishSummary {
  const summary: ExcerptAtPublishSummary = {
    liveChecked: live.length,
    liveHeld: 0,
    liveByCode: {},
    liveSamples: [],
    takenDown: 0,
    republished: 0,
    takenDownByCode: {},
    takenDownSamples: [],
  };
  for (const row of live) {
    const hold = excerptOnlyHold(row);
    if (!hold) continue;
    summary.liveHeld += 1;
    summary.liveByCode[hold.code] = (summary.liveByCode[hold.code] ?? 0) + 1;
    if (summary.liveSamples.length < sampleCap) summary.liveSamples.push(hold);
  }
  const seen = new Set<number>();
  for (const row of takedowns) {
    const code = excerptOnlyTakedownCode(row.rolled_back_reason);
    const id = Number(row.fee_published_id);
    if (!code || seen.has(id)) continue;
    seen.add(id);
    if (row.republished) {
      summary.republished += 1;
      continue;
    }
    summary.takenDown += 1;
    summary.takenDownByCode[code] = (summary.takenDownByCode[code] ?? 0) + 1;
    if (summary.takenDownSamples.length < sampleCap) {
      summary.takenDownSamples.push({
        feePublishedId: id,
        institutionId: Number(row.institution_id),
        institutionName: row.institution_name,
        canonicalFeeKey: row.canonical_fee_key,
        feeName: row.fee_name,
        amount: amountOf(row.amount),
        code,
      });
    }
  }
  return summary;
}
