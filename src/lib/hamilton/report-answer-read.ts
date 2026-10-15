/**
 * The answer page of a Hamilton report, for the paid answer eval (#1079): the same inputs
 * (`assembleReportInputs`), section call (`generateVerifiedSection`) and partner review as the
 * Reports screen, for one institution as the reader's own, with the Peer Benchmarking template.
 *
 * Only the answer page is written (the page a buyer reads first; the other two sections pass the
 * same figure check), and only its first verified draft: the live report rewrites once when the
 * partner review finds problems, which would not fit the eval's 300 s run. So the form rate this
 * gives is a floor for the live answer page. Nothing is saved. Server only.
 */

import { getFeeValuesForInstitutions } from "@/lib/data-store/fee-index";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { isProviderLimitError } from "@/lib/ai-provider";
import { generateVerifiedSection, type SectionTracking } from "./generate";
import { reviewAnswerPage } from "./partner-review";
import { HAMILTON_PAUSED_MESSAGE } from "./provider-paused";
import { extractFigures } from "./figure-check";
import { assembleReportInputs } from "./report-inputs";
import type { SelectedInstitutionFeeDelta } from "./report-evidence";
import type { SectionInput } from "./types";

/** A report answer page ready to write: the section input and what the review and tie-out need. */
export interface PreparedReportAnswer {
  institutionId: number;
  institutionName: string;
  input: SectionInput;
  deltas: SelectedInstitutionFeeDelta[];
  competitorNames: string[];
}

/** The window the Reports screen offers by default: the last three months. */
function defaultPeriod(now: Date): { dateFrom: string; dateTo: string } {
  const from = new Date(now);
  from.setMonth(from.getMonth() - 3);
  return { dateFrom: from.toISOString().slice(0, 10), dateTo: now.toISOString().slice(0, 10) };
}

/**
 * Reads only: the answer page's input for the institution, or null when the Reports screen would
 * write no paid report for it (not found, or too little evidence for a comparison).
 */
export async function prepareReportAnswer(institutionId: number, institutionName: string, now = new Date()): Promise<PreparedReportAnswer | null> {
  const assembled = await assembleReportInputs({
    params: { templateType: "peer_benchmarking", institutionId, ...defaultPeriod(now) },
    // No reader: the institution's default peers, and no saved peer group.
    userId: null,
    loadAccountContext: async () => ({ status: "identified", institution: { id: institutionId, name: institutionName }, profileLabel: null }),
    resolveFindings: async () => [],
  });
  if (assembled.kind !== "ready") return null;
  return {
    institutionId,
    institutionName: assembled.institutionName,
    input: assembled.sectionInputs[0],
    deltas: assembled.selectedFeeDeltas,
    competitorNames: assembled.exhibitSet.data.local_market?.comparisons.flatMap((row) => row.competitors.map((c) => c.name)) ?? [],
  };
}

export type ReportAnswerResult =
  | {
      status: "written";
      narrative: string;
      /** True when every figure traces to the section's data and the partner review found nothing. */
      passed: boolean;
      /** Untraced figures and partner-review problems; empty when passed. */
      problems: string[];
    }
  | { status: "unavailable"; reason: string };

export type ReportAnswerWriter = (prepared: PreparedReportAnswer, tracking: SectionTracking) => Promise<ReportAnswerResult>;

/** One paid answer page (up to two calls: the draft and its figure-check retry). */
export const writeReportAnswer: ReportAnswerWriter = async (prepared, tracking) => {
  try {
    const result = await generateVerifiedSection(prepared.input, tracking);
    const review = reviewAnswerPage({
      institutionName: prepared.institutionName,
      feeNames: prepared.deltas.map((d) => getDisplayName(d.fee_category)),
      competitorNames: prepared.competitorNames,
      narrative: result.section.narrative,
    });
    const untraced = result.status === "needs_review" ? [`figures not in the report data: ${result.unmatched.join(", ")}`] : [];
    const problems = [...untraced, ...review];
    return { status: "written", narrative: result.section.narrative, passed: problems.length === 0, problems };
  } catch (error) {
    if (isProviderLimitError(error) || isProviderLimitError((error as { cause?: unknown })?.cause)) {
      return { status: "unavailable", reason: HAMILTON_PAUSED_MESSAGE };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { status: "unavailable", reason: /budget|usage limit/i.test(message) ? "Hamilton's writing budget for today is used up." : "Hamilton's writer could not be reached." };
  }
};

/** Reads the institution's own live fees, by category; null when the catalog could not be read. */
export type OwnFeeReader = (institutionId: number, categories: string[]) => Promise<Map<string, number> | null>;

export const liveOwnFees: OwnFeeReader = async (institutionId, categories) => {
  const values = await getFeeValuesForInstitutions([institutionId], categories).catch(() => null);
  return values ? values.get(institutionId) ?? new Map() : null;
};

/**
 * Correctness of an answer page: each of the bank's own verified fee amounts the page states is
 * still the live `published_fee_catalog` value. Peer statistics come from the peer index, which the
 * figure check already ties to the section's data; provisional fees have no published row to check.
 */
export async function reconcileReportAnswer(
  prepared: PreparedReportAnswer,
  narrative: string,
  read: OwnFeeReader = liveOwnFees,
): Promise<{ checked: boolean; figures: number; failures: string[] }> {
  const stated = extractFigures(narrative).filter((f) => f.kind === "usd").map((f) => f.value);
  const own = prepared.deltas.filter((d) => d.evidence_tier === "verified" && stated.some((v) => Math.abs(v - d.institution_amount) < 0.005));
  if (own.length === 0) return { checked: false, figures: 0, failures: [] };
  const live = await read(prepared.institutionId, own.map((d) => d.fee_category));
  if (!live) return { checked: false, figures: 0, failures: [] };
  const failures: string[] = [];
  for (const d of own) {
    const value = live.get(d.fee_category);
    if (value === undefined) failures.push(`${getDisplayName(d.fee_category)}: the report uses $${d.institution_amount.toFixed(2)}, and the catalog has no live row`);
    else if (Math.abs(value - d.institution_amount) >= 0.005) failures.push(`${getDisplayName(d.fee_category)}: the report uses $${d.institution_amount.toFixed(2)}, the catalog has $${value.toFixed(2)}`);
  }
  return { checked: true, figures: own.length, failures };
}
