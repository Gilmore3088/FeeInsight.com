import type { SelectedInstitutionFeeDelta } from "@/lib/hamilton/report-evidence";
import type { ReportSummaryResponse } from "@/lib/hamilton/types";

export const REPORT_BANNED_GENERIC_PHRASES = [
  "strategic void",
  "must establish leadership",
  "deploying systematic intelligence",
  "data-sophisticated rivals",
  "revenue leakage",
  "willingness-to-pay",
  "dual strategy",
  "create sustainable competitive advantage",
  "sustainable competitive advantage",
  "market intelligence superiority",
  "precision pricing",
  "competitive positioning superiority",
] as const;

export type ReportArtifactQualityResult =
  | { ok: true }
  | { ok: false; error: string };

export interface ReportArtifactQualityInput {
  report: ReportSummaryResponse;
  selectedInstitutionId?: number | null;
  selectedFeeDeltas?: Pick<SelectedInstitutionFeeDelta, "evidence_tier">[];
  canGenerateVerifiedBenchmarkConclusions?: boolean;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function joinReportText(report: ReportSummaryResponse): string {
  return [
    report.title,
    ...report.executiveSummary,
    report.strategicRationale,
    report.recommendation,
    ...report.snapshot.flatMap((row) => [row.label, row.current, row.proposed]),
    ...report.tradeoffs.flatMap((row) => [row.label, row.value]),
    ...report.implementationNotes,
    ...(report.watchlist ?? []),
    ...(report.answer?.decisions.map((decision) => decision.confidenceReason) ?? []),
  ]
    .map(normalizeText)
    .filter(Boolean)
    .join("\n");
}

function joinClaimText(report: ReportSummaryResponse): string {
  return [
    ...report.executiveSummary,
    report.strategicRationale,
    report.recommendation,
    ...report.snapshot.flatMap((row) => [row.label, row.current, row.proposed]),
    ...report.tradeoffs.flatMap((row) => [row.label, row.value]),
    ...(report.watchlist ?? []),
  ]
    .map(normalizeText)
    .filter(Boolean)
    .join("\n");
}

function hasUnsupportedVerifiedBenchmarkClaim(text: string): boolean {
  const verifiedBenchmarkClaim =
    /\bverified\s+benchmark\s+(score|scores|scoring|conclusion|conclusions|position|positions|recommendation|recommendations|rank|ranking|standing)\b/i;
  const negatingContext =
    /\b(exclude|excludes|excluded|excluding|cannot|can't|do not|don't|must not|not|without|no)\b/i;

  return text
    .split(/[.!?]\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .some(
      (sentence) =>
        verifiedBenchmarkClaim.test(sentence) && !negatingContext.test(sentence),
    );
}

function hasLabeledSelectedSnapshot(report: ReportSummaryResponse): boolean {
  return report.snapshot.some((row) =>
    /\b(verified|provisional)\b/i.test(`${row.current} ${row.proposed}`),
  );
}

export function validateHamiltonReportArtifact(
  input: ReportArtifactQualityInput,
): ReportArtifactQualityResult {
  const { report } = input;
  const selectedFeeDeltas = input.selectedFeeDeltas ?? [];
  const hasSelectedInstitution = Boolean(input.selectedInstitutionId);
  const canGenerateVerifiedBenchmarkConclusions = Boolean(
    input.canGenerateVerifiedBenchmarkConclusions,
  );
  const fullText = joinReportText(report);
  const claimText = joinClaimText(report);

  if (!normalizeText(report.title)) {
    return { ok: false, error: "Report artifact failed quality gate: missing title." };
  }
  if (!report.executiveSummary.some((paragraph) => normalizeText(paragraph))) {
    return {
      ok: false,
      error: "Report artifact failed quality gate: missing executive summary.",
    };
  }
  if (!normalizeText(report.strategicRationale)) {
    return {
      ok: false,
      error: "Report artifact failed quality gate: missing strategic rationale.",
    };
  }
  if (!normalizeText(report.recommendation)) {
    return {
      ok: false,
      error: "Report artifact failed quality gate: missing recommendation.",
    };
  }
  if (!report.implementationNotes.some((note) => normalizeText(note))) {
    return {
      ok: false,
      error: "Report artifact failed quality gate: missing implementation notes.",
    };
  }

  const lowerText = fullText.toLowerCase();
  const bannedPhrase = REPORT_BANNED_GENERIC_PHRASES.find((phrase) =>
    lowerText.includes(phrase),
  );
  if (bannedPhrase) {
    return {
      ok: false,
      error: `Report artifact failed quality gate: generic phrase "${bannedPhrase}" is not allowed.`,
    };
  }

  if (!hasSelectedInstitution) return { ok: true };

  if (selectedFeeDeltas.length > 0 && report.snapshot.length === 0) {
    return {
      ok: false,
      error:
        "Report artifact failed quality gate: selected-institution reports with fee deltas need snapshot rows.",
    };
  }

  if (selectedFeeDeltas.length > 0 && !hasLabeledSelectedSnapshot(report)) {
    return {
      ok: false,
      error:
        "Report artifact failed quality gate: selected-institution snapshot rows must label verified or provisional evidence.",
    };
  }

  if (
    selectedFeeDeltas.length > 0 &&
    !report.implementationNotes.some((note) =>
      /verified benchmark conclusions exclude provisional/i.test(note),
    )
  ) {
    return {
      ok: false,
      error:
        "Report artifact failed quality gate: missing verified-benchmark caveat for selected-institution evidence.",
    };
  }

  if (!canGenerateVerifiedBenchmarkConclusions && selectedFeeDeltas.length > 0) {
    if (!/\bprovisional\b/i.test(claimText)) {
      return {
        ok: false,
        error:
          "Report artifact failed quality gate: provisional-only selected-institution reports must label conclusions as provisional.",
      };
    }
    if (hasUnsupportedVerifiedBenchmarkClaim(claimText)) {
      return {
        ok: false,
        error:
          "Report artifact failed quality gate: provisional-only evidence cannot be presented as a verified benchmark conclusion.",
      };
    }
  }

  return { ok: true };
}
