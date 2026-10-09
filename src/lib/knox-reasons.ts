/**
 * Reading a Knox rejection for a human reviewer.
 *
 * Every Knox `reject` message on prod stores its reasons as `payload.reasons`, an array of
 * check results written by Knox's rules (`payload.reason`, a single string, is read too for
 * older shapes). Some entries are why Knox said no; others are checks that passed or were
 * skipped and only give context. This module turns each entry into plain words, picks the
 * group a rejection belongs to so the queue can be worked in coherent batches, and says
 * what an amount is: a dollar fee, a free ($0) fee, a percentage, or not known.
 *
 * The SQL in `src/lib/data-store/knox-reviews.ts` (`knoxReasonGroupCase`) mirrors
 * `knoxReasonGroup` below; keep the two in sync.
 */

import { formatAmount } from "@/lib/format";
import { formatRateFee, isPercentFee, type RateFields } from "@/lib/percent-fees";

export const KNOX_REASON_GROUPS = ["zero_amount", "above_peers", "unrecognized"] as const;
export type KnoxReasonGroup = (typeof KNOX_REASON_GROUPS)[number];

export const KNOX_REASON_GROUP_LABELS: Record<KnoxReasonGroup, string> = {
  zero_amount: "$0 or missing amount",
  above_peers: "Above peer range",
  unrecognized: "Unrecognized reason",
};

export type KnoxReasonCode =
  | "zero_without_free_wording"
  | "above_peer_median"
  | "within_peer_median"
  | "too_few_peers"
  | "no_peer_median"
  | "unrecognized";

export interface InterpretedKnoxReason {
  code: KnoxReasonCode;
  /** True when this check is a reason Knox rejected; false when it passed or was skipped. */
  blocking: boolean;
  label: string;
  detail: string;
  /** The text exactly as Knox stored it. */
  raw: string;
}

const ZERO_WITHOUT_FREE = /amount=([\d.]+) but fee_name has no free-fee wording(?: \(searched: (.*)\))?/i;
const EXCEEDS_PEERS = /amount=([\d.]+) exceeds ([\d.]+)x peer_median=([\d.]+) \(n=(\d+)\)/i;
const WITHIN_PEERS = /amount=([\d.]+) within ([\d.]+)x peer_median=([\d.]+) \(n=(\d+)\)/i;
const TOO_FEW_PEERS = /^peer_count=(\d+) below min (\d+)/i;
const NO_PEER_MEDIAN = /^no valid peer median/i;

function money(value: string): string {
  return formatAmount(Number(value));
}

function multiple(value: string): string {
  return `${Number(value)}x`;
}

function searchedWords(list: string | undefined): string | null {
  if (!list) return null;
  const words = [...list.matchAll(/'([^']+)'/g)].map((match) => `"${match[1]}"`);
  return words.length > 0 ? words.join(", ") : null;
}

/**
 * One stored reason in plain words. `amountRecorded` is whether the fee itself has an
 * amount: Knox's zero check reads a missing amount as $0, so the words say which it was.
 */
export function interpretKnoxReason(
  raw: string,
  options: { amountRecorded?: boolean | null } = {},
): InterpretedKnoxReason {
  const text = raw.trim();
  let match = text.match(ZERO_WITHOUT_FREE);
  if (match) {
    const words = searchedWords(match[2]);
    const amountWords =
      options.amountRecorded === false
        ? "No amount is recorded for this fee, and Knox's check read it as $0.00"
        : `Knox read the amount as ${money(match[1])}`;
    return {
      code: "zero_without_free_wording",
      blocking: true,
      label: "$0 or missing amount, not marked free",
      detail: `${amountWords}, but the fee name does not say it is free${words ? ` (it looked for ${words})` : ""}.`,
      raw: text,
    };
  }
  match = text.match(EXCEEDS_PEERS);
  if (match) {
    return {
      code: "above_peer_median",
      blocking: true,
      label: "Above peer range",
      detail: `${money(match[1])} is more than ${multiple(match[2])} the peer median of ${money(match[3])} (${match[4]} peer fees).`,
      raw: text,
    };
  }
  match = text.match(WITHIN_PEERS);
  if (match) {
    return {
      code: "within_peer_median",
      blocking: false,
      label: "Peer check passed",
      detail: `${money(match[1])} is within ${multiple(match[2])} the peer median of ${money(match[3])} (${match[4]} peer fees).`,
      raw: text,
    };
  }
  match = text.match(TOO_FEW_PEERS);
  if (match) {
    return {
      code: "too_few_peers",
      blocking: false,
      label: "Peer check skipped",
      detail: `Only ${match[1]} peer fees (at least ${match[2]} needed), so the amount was not compared with peers.`,
      raw: text,
    };
  }
  if (NO_PEER_MEDIAN.test(text)) {
    return {
      code: "no_peer_median",
      blocking: false,
      label: "Peer check skipped",
      detail: "No usable peer median, so the amount was not compared with peers.",
      raw: text,
    };
  }
  return {
    code: "unrecognized",
    blocking: true,
    label: "Unrecognized reason",
    detail: text,
    raw: text,
  };
}

/** The reasons stored on a Knox reject payload, in order. */
export function knoxPayloadReasons(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  const out: string[] = [];
  if (Array.isArray(record.reasons)) {
    for (const item of record.reasons) {
      if (typeof item === "string" && item.trim()) out.push(item.trim());
    }
  }
  if (typeof record.reason === "string" && record.reason.trim()) out.push(record.reason.trim());
  return out;
}

/** Every stored reason, interpreted, with the reasons Knox rejected on listed first. */
export function interpretKnoxReasons(
  payload: unknown,
  options: { amountRecorded?: boolean | null } = {},
): InterpretedKnoxReason[] {
  const all = knoxPayloadReasons(payload).map((raw) => interpretKnoxReason(raw, options));
  return [...all.filter((r) => r.blocking), ...all.filter((r) => !r.blocking)];
}

/**
 * The group a rejection is worked in: the zero-amount check wins over the peer check, and a
 * rejection with neither (or no stored reason) is unrecognized.
 */
export function knoxReasonGroup(payload: unknown): KnoxReasonGroup {
  const codes = new Set(knoxPayloadReasons(payload).map((raw) => interpretKnoxReason(raw).code));
  if (codes.has("zero_without_free_wording")) return "zero_amount";
  if (codes.has("above_peer_median")) return "above_peers";
  return "unrecognized";
}

export function isKnoxReasonGroup(value: string | null | undefined): value is KnoxReasonGroup {
  return (KNOX_REASON_GROUPS as readonly string[]).includes(value ?? "");
}

export interface AmountFields extends RateFields {
  amount?: number | string | null;
  conditions?: string | null;
}

export type AmountDisplayKind = "flat" | "free" | "percent" | "unknown";

export interface AmountDisplay {
  kind: AmountDisplayKind;
  /** Short value for a table cell. */
  label: string;
  /** A note for the detail view, or null. */
  note: string | null;
}

const PERCENT_IN_TEXT = /(\d+(?:\.\d+)?)\s*%/;

/**
 * What a fee's amount is: a dollar fee, a free ($0) fee, a percentage, or not known.
 * A percentage fee carries amount_kind 'percent' and rate_percent (`percent-fees.ts`).
 * An unknown amount whose conditions state a percentage says so, since that is often why
 * the dollar amount is missing.
 */
export function describeFeeAmount(row: AmountFields): AmountDisplay {
  if (isPercentFee(row)) {
    const rate = formatRateFee(row);
    if (rate) return { kind: "percent", label: rate, note: "Percentage fee; not a dollar amount." };
    return { kind: "unknown", label: "Unknown", note: "Marked as a percentage fee, but no rate is recorded." };
  }
  const value = row.amount == null || row.amount === "" ? null : Number(row.amount);
  if (value != null && Number.isFinite(value)) {
    if (value === 0) return { kind: "free", label: "Free ($0)", note: "Recorded as a $0 fee." };
    return { kind: "flat", label: formatAmount(value), note: null };
  }
  const stated = row.conditions?.match(PERCENT_IN_TEXT);
  return {
    kind: "unknown",
    label: "Unknown",
    note: stated
      ? `No amount recorded. The conditions state a rate (${stated[1]}%), but the fee is not recorded as a percentage fee.`
      : "No amount recorded.",
  };
}

/** promote_to_tier3 only counts a Darwin accept posted within this many days. */
export const DARWIN_ACCEPT_WINDOW_DAYS = 30;

/**
 * What the reviewer actions on a Knox rejection actually do, in one line. Override
 * (`overrideRejection`) records the verdict, a human-attested Knox accept and an audit
 * event, then calls promote_to_tier3, which publishes only when Darwin posted an accept
 * for the fee within the last 30 days. No agent reads overrides afterwards, so an override
 * that cannot publish at once never publishes the fee by itself. Confirm records the
 * verdict only.
 */
export function knoxReviewActionsExplanation(
  darwinAcceptAt: string | Date | null | undefined,
  now: Date = new Date(),
): string {
  const confirm = "Confirm rejection records your verdict only and changes no fee record.";
  const recorded = "Override records your note, a human-attested Knox accept and an audit event";
  const later = "No later pass reads overrides, so the override alone never publishes it.";
  const at = darwinAcceptAt == null ? null : new Date(darwinAcceptAt);
  if (at && Number.isFinite(at.getTime())) {
    const day = at.toISOString().slice(0, 10);
    const ageDays = (now.getTime() - at.getTime()) / 86_400_000;
    if (ageDays <= DARWIN_ACCEPT_WINDOW_DAYS) {
      return `${confirm} ${recorded}, then tries to publish this fee at once: Darwin accepted it on ${day}, inside the ${DARWIN_ACCEPT_WINDOW_DAYS}-day window publishing needs.`;
    }
    return `${confirm} ${recorded}, but cannot publish this fee: publishing needs a Darwin accept from the last ${DARWIN_ACCEPT_WINDOW_DAYS} days and Darwin last accepted it on ${day}. ${later}`;
  }
  return `${confirm} ${recorded}, but cannot publish this fee: publishing needs a Darwin accept from the last ${DARWIN_ACCEPT_WINDOW_DAYS} days and Darwin has never accepted it. ${later}`;
}
