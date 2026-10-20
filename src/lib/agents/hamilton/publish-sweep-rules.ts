import { sql } from "@/lib/data-store/connection";
import { inSavepoint } from "@/lib/agents/savepoint";
import { BUSINESS_SCHEDULE_REASON, businessScheduleFeesSql } from "@/lib/agents/hamilton/business-schedule";
import {
  OTHER_BANK_DOCUMENT_REASON,
  UNCONFIRMED_HOST_REASON,
  otherBankFeesSql,
  unconfirmedHostFeesSql,
} from "@/lib/agents/hamilton/other-bank-document";
import { DOCUMENT_OWNER_REASON, documentOwnerRefusalsSql } from "@/lib/agents/darwin/document-owner";
import { readPublicationEvidence } from "./publication-evidence";

type SqlTag = typeof sql;

/**
 * #1069 step 2: the publish step reads each row it is about to publish with the same rule as
 * three sweeps that take fees down hours or days later, so a fee those sweeps would take down is
 * never live in between (7 days to Oct 16, prod: 434 unconfirmed-host, 276 business-schedule
 * and 84 other-bank takedowns of fees live under 7 days).
 * - Another bank's document (`otherBankFeesSql`, `retireOtherBankDocumentFees`).
 * - A document on an unconfirmed host that does not name the bank (`unconfirmedHostFeesSql`).
 * - A business schedule's fee beside the bank's live consumer fee in its category
 *   (`businessScheduleFeesSql`, `retireBusinessScheduleFees`). A footnote-only business fee is
 *   still the sweep's: telling one apart needs the page read.
 *
 * The sweeps and this check call the same SQL builders, in their `"verified"` scope here, so the
 * rule is one function with two callers: the sweep cleans up live history, publish refuses. The
 * live re-check is the sweeps themselves, unchanged; this check takes no live fee down.
 *
 * On (James's OK, 2026-10-17): the step refuses those rows. Set it to false to only count what it
 * would refuse (`publish_sweep_check` in the publish step's detail).
 *
 * A fourth rule (takedowns at the source, 2026-10-17): Darwin's document-owner verdict
 * (`darwin/document-owner.ts`, #1455). A row whose (institution, document) pair Darwin's latest
 * read judged `other_bank`, at the document's current text, is refused with Darwin's own reason
 * (`document_owner: names institution <id>`). Darwin now reads pairs whose verified rows are not
 * live yet, first, so the verdict is usually on record before publish. Until then the check judged
 * only live pairs: all 246 fees on the 20 `other_bank` pairs (prod, Oct 17) went live first. The
 * live re-check is Darwin's, unchanged.
 */
export const PUBLISH_REFUSE_SWEEP_RULES_LIVE = true;
export const PUBLISH_SWEEP_REFUSE_REASON_PREFIX = "Refused at publish, a sweep would take it down: ";

export type PublishSweepRule = "other_bank_document" | "unconfirmed_document_host" | "business_schedule" | "document_owner";

export interface PublishSweepRefusal {
  rule: PublishSweepRule;
  /** The sweep's own `rolled_back_reason` for this fee, e.g. `other_bank_document: peoplesbank-wa.com`. */
  sweepReason: string;
}

/** One row of a host read (`otherBankFeesSql`, `unconfirmedHostFeesSql`). */
export interface HostVerdictRow {
  fee_verified_id: number | string;
  document_host: string;
  names_own_bank: boolean | string | null;
}

/** One row of the business-schedule read (`businessScheduleFeesSql`). */
export interface BusinessVerdictRow {
  fee_verified_id: number | string;
  consumer_fee_id: number | string | null;
}

/** One row of the document-owner read (`documentOwnerRefusalsSql`): the pair was judged `other_bank`. */
export interface OwnerVerdictRow {
  fee_verified_id: number | string;
  named_other_id: number | string | null;
}

function truthy(value: boolean | string | null | undefined): boolean {
  return value === true || String(value ?? "").toLowerCase() === "true" || value === "t";
}

/**
 * Pure: the rows the sweeps would take down, by verified id, from the three reads. The sweeps'
 * own tests: a host row fails when its text does not name the bank; another bank's host wins
 * over an unconfirmed host for the same row; a business row fails only beside a consumer fee.
 * Darwin's document-owner verdict comes after the three sweeps: a row any of them refuses keeps
 * that sweep's reason.
 */
export function publishSweepRefusals(
  otherBank: HostVerdictRow[],
  unconfirmedHost: HostVerdictRow[],
  business: BusinessVerdictRow[],
  owner: OwnerVerdictRow[] = [],
): Map<number, PublishSweepRefusal> {
  const refusals = new Map<number, PublishSweepRefusal>();
  for (const row of otherBank) {
    if (truthy(row.names_own_bank)) continue;
    refusals.set(Number(row.fee_verified_id), {
      rule: "other_bank_document",
      sweepReason: `${OTHER_BANK_DOCUMENT_REASON}: ${row.document_host}`,
    });
  }
  for (const row of unconfirmedHost) {
    const id = Number(row.fee_verified_id);
    if (truthy(row.names_own_bank) || refusals.has(id)) continue;
    refusals.set(id, { rule: "unconfirmed_document_host", sweepReason: `${UNCONFIRMED_HOST_REASON}: ${row.document_host}` });
  }
  for (const row of business) {
    const id = Number(row.fee_verified_id);
    if (row.consumer_fee_id == null || refusals.has(id)) continue;
    refusals.set(id, {
      rule: "business_schedule",
      sweepReason: `${BUSINESS_SCHEDULE_REASON}: consumer fee #${Number(row.consumer_fee_id)}`,
    });
  }
  for (const row of owner) {
    const id = Number(row.fee_verified_id);
    const other = row.named_other_id == null || row.named_other_id === "" ? null : Number(row.named_other_id);
    if (other == null || !Number.isFinite(other) || refusals.has(id)) continue;
    refusals.set(id, { rule: "document_owner", sweepReason: `${DOCUMENT_OWNER_REASON}: names institution ${other}` });
  }
  return refusals;
}

export interface PublishSweepReads {
  refusals: Map<number, PublishSweepRefusal>;
  /** Positive refusals remain usable; failed reads never prove no match. */
  unavailable: PublishSweepRule[];
  /** Fixed check codes only, safe for the run ledger. */
  error: string | null;
}

/**
 * The four reads over the rows a publish step is about to decide. Each read runs on its own;
 * one that fails is unavailable and the others still count. Never throws.
 */
export async function selectPublishSweepRefusals(db: SqlTag, feeVerifiedIds: number[]): Promise<PublishSweepReads> {
  if (feeVerifiedIds.length === 0) return { refusals: new Map(), unavailable: [], error: null };
  const unavailable: PublishSweepRule[] = [];
  const read = async <T>(label: PublishSweepRule, query: string, params: unknown[]): Promise<T[]> => {
    const result = await readPublicationEvidence(label, () => inSavepoint(db, (scope) => scope.unsafe<T[]>(query, params as never[])));
    if (result.state === "available") return result.value;
    unavailable.push(label);
    return [];
  };
  const otherBank = await read<HostVerdictRow>("other_bank_document", otherBankFeesSql("verified"), [feeVerifiedIds]);
  const unconfirmed = await read<HostVerdictRow>("unconfirmed_document_host", unconfirmedHostFeesSql("verified"), [feeVerifiedIds]);
  // The live footnoted business fees are left to the sweep (it reads their pages each step), so
  // none is passed here: a live fee marked business only by a footnote counts as a consumer fee
  // beside a row until the sweep takes it down. So it may refuse a business row the sweep would
  // leave live when that footnoted fee is the only "consumer" fee beside it; it never publishes
  // one the sweep would take down.
  const business = await read<BusinessVerdictRow>("business_schedule", businessScheduleFeesSql("verified"), [feeVerifiedIds, []]);
  const owner = await read<OwnerVerdictRow>("document_owner", documentOwnerRefusalsSql(), [feeVerifiedIds]);
  return {
    refusals: publishSweepRefusals(otherBank, unconfirmed, business, owner), unavailable,
    error: unavailable.length ? `Publication evidence unavailable: ${unavailable.join(", ")}` : null,
  };
}

export interface PublishSweepCheck {
  /** True when the step refuses these rows. */
  live: boolean;
  /** Rows about to publish that a sweep would take down. */
  wouldRefuse: number;
  refused: number;
  byRule: Partial<Record<PublishSweepRule, number>>;
  samples: Array<{ fee_verified_id: number; fee_published_id: number | null; rule: PublishSweepRule; sweep_reason: string; fee_name: string; amount: number | null }>;
  error: string | null;
}
