import { formatAssets, formatCompactDollars } from "@/lib/format";
import type { ReportSummaryResponse } from "@/lib/hamilton/types";

export interface InsufficientEvidenceReportParams {
  institutionName: string;
  period: string;
  statusLabel: string;
  verifiedCount: number;
  provisionalCount: number;
  assetSize: number | null;
  latestSourceStatus: string | null;
  latestFinancial: {
    source?: string | null;
    report_date: string;
    total_assets: number | null;
    service_charge_income: number | null;
  } | null;
}

/** Call report figures are filed in thousands of dollars. */
function fromThousands(amount: number | null): number | null {
  return amount === null ? null : amount * 1000;
}

export function buildInsufficientEvidenceReport(
  params: InsufficientEvidenceReportParams,
): ReportSummaryResponse {
  const financial = params.latestFinancial;
  const financialSummary = financial && (financial.source === "fdic" || financial.source === "ncua")
    ? `Financial context is available through ${financial.report_date}: assets are ${formatCompactDollars(fromThousands(financial.total_assets))} and reported ${financial.source === "ncua" ? "year-to-date broad credit-union fee income" : "quarterly deposit service charge income"} is ${formatCompactDollars(fromThousands(financial.service_charge_income))}.`
    : "Financial context is not available in the current dataset.";

  return {
    title: `Data Readiness Brief - ${params.institutionName}`,
    executiveSummary: [
      `${params.institutionName} is tracked, but Hamilton does not have verified or provisional fee rows sufficient for a competitive fee brief.`,
      financialSummary,
      "A consulting-grade brief should start with source acquisition and validation before drawing pricing, peer-positioning, or revenue conclusions.",
    ],
    snapshot: [
      {
        label: "Fee evidence",
        current: `${params.verifiedCount} verified / ${params.provisionalCount} provisional`,
        proposed: "Needed: a verified fee schedule",
      },
      {
        label: "Publication status",
        current: params.statusLabel,
        proposed: "Needed: ready or directional",
      },
      {
        label: "Assets",
        current: params.assetSize ? formatAssets(params.assetSize) : "N/A",
        proposed: "Used to choose peers",
      },
    ],
    strategicRationale:
      `${params.institutionName} should not receive a generic competitive position when fee evidence is empty. ` +
      "The next step is to confirm its official fee schedule and read its fees, then rerun the peer comparison once enough fees are on file.",
    tradeoffs: [
      {
        label: "Use now",
        value: "Identity, asset tier, financial context, and source diligence",
      },
      {
        label: "Do not use yet",
        value: "Fee benchmark score or peer fee deltas",
      },
      {
        label: "Next diligence",
        value: "Official fee schedule URL, account type coverage, effective date, and row-level source labels",
      },
    ],
    recommendation:
      "Send us the official fee schedule. Once its fees are read and checked, rerun this report for a full competitive comparison. Until then, treat this as a readiness brief.",
    implementationNotes: [
      `Analysis period requested: ${params.period}`,
      params.latestSourceStatus ? "A fee schedule source is on file and still being read." : "No fee schedule source is on file yet.",
      "Written from the data on file, without a model-written analysis.",
    ],
    exportControls: {
      pdfEnabled: true,
      shareEnabled: false,
    },
  };
}
