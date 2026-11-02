import { darwinAudience } from "@/lib/agents/darwin/audience";
import { withSectionPath } from "@/lib/section-path";
import type { DocumentRow, LiveFeeRow } from "./types";

/**
 * `SECTION_PATH_LIVE` (#1092): what reading each line's section path changes for live fees. Each live
 * dollar fee is read against its own document's newest stored text twice, switch off and on, by
 * Darwin's audience decision (`darwinAudience`, its own-price clause on): a fee whose decision changes.
 * The audience relabel writes it only from `unknown`, or from `both` when the new source is a title
 * (`TITLE_SOURCES` in `darwin/audience-relabel.ts`, which `section_path` is not yet in). The switch
 * holds and refuses nothing (its retired-section half was dropped), so there is no takedown count.
 * A rate or no-amount fee is not read. Pure.
 */

export interface SectionPathFee {
  feePublishedId: number;
  institutionId: number;
  institutionName: string | null;
  sourceDocumentId: number;
  canonicalFeeKey: string;
  feeName: string;
  amount: number;
  feeAudience: string;
}

export interface SectionPathRelabel extends SectionPathFee {
  /** Darwin's decision with the switch off, then on ("unknown" when it decides none). */
  off: string;
  on: string;
  evidence: string | null;
  /** Whether the relabel would write it: from `unknown`, or from `both` to a title source. */
  relabelWrites: boolean;
}

export interface SectionPathDocumentResult {
  feesRead: number;
  relabels: SectionPathRelabel[];
}

export interface SectionPathSummary {
  documents: number;
  documentsChanged: number;
  feesRead: number;
  relabels: number;
  /** Relabels by published audience, then switch-on decision ("unknown->business"). */
  relabelsByChange: Record<string, number>;
  relabelsWritten: number;
  relabelSamples: SectionPathRelabel[];
}

export function emptySectionPathSummary(): SectionPathSummary {
  return { documents: 0, documentsChanged: 0, feesRead: 0, relabels: 0, relabelsByChange: {}, relabelsWritten: 0, relabelSamples: [] };
}

const asNumber = (value: number | string | null | undefined): number | null => (value == null || value === "" ? null : Number(value));

function decision(fee: LiveFeeRow, amount: number, text: string, on: boolean) {
  return withSectionPath(on, () =>
    darwinAudience({ fee_audience: "unknown", source_url: fee.source_url, fee_name: fee.raw_fee_name ?? fee.fee_name }, amount, text, { ownPriceClause: true }),
  );
}

/** One document's live fees, switch off and on. */
export function replaySectionPathDocument(doc: DocumentRow, text: string, live: readonly LiveFeeRow[]): SectionPathDocumentResult {
  const result: SectionPathDocumentResult = { feesRead: 0, relabels: [] };
  for (const fee of live) {
    const amount = asNumber(fee.amount);
    if (Number(fee.source_document_id) !== Number(doc.source_document_id) || amount == null || fee.amount_kind === "percent") continue;
    result.feesRead += 1;
    const base: SectionPathFee = {
      feePublishedId: Number(fee.fee_published_id),
      institutionId: Number(fee.institution_id),
      institutionName: fee.institution_name,
      sourceDocumentId: Number(doc.source_document_id),
      canonicalFeeKey: fee.canonical_fee_key,
      feeName: fee.fee_name,
      amount,
      feeAudience: fee.fee_audience ?? "unknown",
    };
    const off = decision(fee, amount, text, false);
    const on = decision(fee, amount, text, true);
    const offAudience = off?.feeAudience ?? "unknown";
    const onAudience = on?.feeAudience ?? "unknown";
    if (offAudience === onAudience) continue;
    const from = base.feeAudience;
    const relabelWrites = onAudience !== "unknown" && onAudience !== from && from === "unknown";
    result.relabels.push({ ...base, off: offAudience, on: onAudience, evidence: on?.audienceEvidence ?? null, relabelWrites });
  }
  return result;
}

export function addSectionPathDocument(summary: SectionPathSummary, result: SectionPathDocumentResult, sampleCap: number): void {
  summary.documents += 1;
  summary.feesRead += result.feesRead;
  if (result.relabels.length > 0) summary.documentsChanged += 1;
  summary.relabels += result.relabels.length;
  for (const relabel of result.relabels) {
    const change = `${relabel.feeAudience}->${relabel.on}`;
    summary.relabelsByChange[change] = (summary.relabelsByChange[change] ?? 0) + 1;
    if (relabel.relabelWrites) summary.relabelsWritten += 1;
  }
  summary.relabelSamples.push(...result.relabels.slice(0, Math.max(0, sampleCap - summary.relabelSamples.length)));
}
