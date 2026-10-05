"use client";

import Link from "next/link";
import { CTA_HIERARCHY } from "@/lib/hamilton/navigation";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";
import { AddToReportButton } from "@/components/hamilton/basket/AddToReportButton";
import type { ReportBasketItem } from "@/lib/hamilton/report-basket";

interface AnalyzeCTABarProps {
  /** Only show after analysis completes */
  isVisible: boolean;
  institutionId?: string | null;
  /** Called when user clicks Export PDF */
  onExportPdf?: () => void;
  /** True while PDF is being generated */
  isExporting?: boolean;
  /** Fee category the analysis is about, carried into Simulate when known */
  feeCategory?: string | null;
  /** Switches Analyze to the Risk lens with a risk question ready to send */
  onViewRiskDrivers?: () => void;
  /** This answer as a report-basket finding */
  basketItem?: Omit<ReportBasketItem, "addedAt"> | null;
}

/**
 * AnalyzeCTABar — CTA hierarchy for the Analyze screen.
 * Matches HTML prototype: burnished primary + outlined secondary buttons.
 * Primary: "Simulate a Change" → /pro/simulate, carrying the fee category when known
 * Secondary: "Show Peer Distribution" → Benchmark (where each fee sits among peers);
 * "View Risk Drivers" → the Risk lens of this same screen.
 * Export PDF: outlined secondary button, triggers onExportPdf callback (ANL-05)
 * No "Recommended Position" — analyze only (ARCH-05).
 */
export function AnalyzeCTABar({
  isVisible,
  institutionId = null,
  onExportPdf,
  isExporting,
  feeCategory = null,
  onViewRiskDrivers,
  basketItem = null,
}: AnalyzeCTABarProps) {
  if (!isVisible) return null;

  const { primary, secondary } = CTA_HIERARCHY["Analyze"];
  const simulateHref = hrefWithInstitutionContext(
    feeCategory ? `/pro/simulate?category=${encodeURIComponent(feeCategory)}` : "/pro/simulate",
    institutionId,
  );
  const secondaryActions = secondary.map((label) => {
    if (label === "Show Peer Distribution") {
      return { label, href: hrefWithInstitutionContext("/pro/hamilton", institutionId), onClick: undefined };
    }
    if (label === "View Risk Drivers") {
      return {
        label,
        href: hrefWithInstitutionContext("/pro/analyze?intent=risk", institutionId),
        onClick: onViewRiskDrivers,
      };
    }
    return { label, href: hrefWithInstitutionContext("/pro/analyze", institutionId), onClick: undefined };
  });

  return (
    <div className="flex flex-wrap items-center gap-3 pb-2">
      <Link
        href={simulateHref}
        className="burnished-cta px-6 py-2.5 rounded text-[10px] uppercase tracking-widest font-bold no-underline transition-opacity hover:opacity-90"
        style={{ boxShadow: "0 2px 8px rgba(138,76,39,0.25)" }}
      >
        {primary}
      </Link>

      {basketItem && <AddToReportButton item={basketItem} />}

      {secondaryActions.map((action) => (
        <Link
          key={action.label}
          href={action.href}
          onClick={(e) => {
            if (action.onClick) {
              e.preventDefault();
              action.onClick();
            }
          }}
          className="px-5 py-2.5 rounded text-[10px] uppercase tracking-widest font-bold border transition-all"
          style={{
            borderColor: "var(--hamilton-outline-variant, #d8c2b8)",
            backgroundColor: "var(--hamilton-surface-container-lowest, #ffffff)",
            color: "var(--hamilton-text-secondary)",
            textDecoration: "none",
            boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
          }}
          onMouseEnter={(e) => {
            const el = e.currentTarget as HTMLAnchorElement;
            el.style.borderColor = "var(--hamilton-primary)";
            el.style.color = "var(--hamilton-primary)";
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget as HTMLAnchorElement;
            el.style.borderColor = "var(--hamilton-outline-variant, #d8c2b8)";
            el.style.color = "var(--hamilton-text-secondary)";
          }}
        >
          {action.label}
        </Link>
      ))}

      {onExportPdf && (
        <button
          onClick={onExportPdf}
          disabled={isExporting}
          className="px-5 py-2.5 rounded text-[10px] uppercase tracking-widest font-bold border transition-all disabled:opacity-50"
          style={{
            borderColor: "var(--hamilton-outline-variant, #d8c2b8)",
            backgroundColor: "var(--hamilton-surface-container-lowest, #ffffff)",
            color: "var(--hamilton-text-secondary)",
            cursor: isExporting ? "wait" : "pointer",
            boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
          }}
          onMouseEnter={(e) => {
            if (!isExporting) {
              const el = e.currentTarget as HTMLButtonElement;
              el.style.borderColor = "var(--hamilton-primary)";
              el.style.color = "var(--hamilton-primary)";
            }
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget as HTMLButtonElement;
            el.style.borderColor = "var(--hamilton-outline-variant, #d8c2b8)";
            el.style.color = "var(--hamilton-text-secondary)";
          }}
        >
          {isExporting ? "Exporting..." : "Export PDF"}
        </button>
      )}
    </div>
  );
}
