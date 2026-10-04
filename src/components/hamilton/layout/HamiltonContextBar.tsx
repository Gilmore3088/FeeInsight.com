import Link from "next/link";
import {
  getHamiltonContextSourceLabel,
  type HamiltonContextSource,
} from "@/lib/hamilton/context-source";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";

interface InstitutionContext {
  name: string | null;
  type: string | null;
  assetTier: string | null;
  fedDistrict: number | null;
  feePublicationLabel?: string | null;
  publishedFeeCount?: number | null;
  provisionalFeeCount?: number | null;
  selectedSource?: HamiltonContextSource;
  selectedFromUrl?: boolean;
}

interface HamiltonContextBarProps {
  institutionContext: InstitutionContext;
  selectedInstitutionId?: string | null;
}

/**
 * HamiltonContextBar - Server component.
 * Matches HTML prototype: Institution selector + Horizon dropdown + Analysis Focus pills.
 * Per D-07 and D-14: institution context flows from user profile.
 */
export function HamiltonContextBar({
  institutionContext,
  selectedInstitutionId = null,
}: HamiltonContextBarProps) {
  const {
    name,
    type,
    assetTier,
    fedDistrict,
    feePublicationLabel,
    publishedFeeCount,
    provisionalFeeCount,
    selectedSource,
    selectedFromUrl,
  } = institutionContext;
  const hasInstitution = !!name;
  const institutionName = name ?? "Global Private Bank";
  const sourceLabel = getHamiltonContextSourceLabel(selectedSource, selectedFromUrl);
  const settingsHref = hrefWithInstitutionContext("/pro/settings", selectedInstitutionId);

  return (
    <div
      className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b px-4 py-3 sm:px-6 lg:px-10"
      style={{
        backgroundColor: "var(--hamilton-surface-container-lowest, #ffffff)",
        borderColor: "rgba(216,194,184,0.1)",
        minHeight: "52px",
      }}
    >
      {/* Institution selector */}
      <div className="flex min-w-0 flex-[1_1_260px] flex-col">
        <span
          className="text-[9px] uppercase tracking-[0.1em] font-bold mb-0.5"
          style={{ color: "var(--hamilton-text-tertiary)" }}
        >
          Institution
        </span>
        {hasInstitution ? (
          <span
            className="min-w-0 text-xs font-bold"
            style={{ color: "var(--hamilton-text-primary)" }}
          >
            <span className="inline-block max-w-full truncate align-bottom">{institutionName}</span>
            {type && (
              <span className="font-normal ml-1.5" style={{ color: "var(--hamilton-text-secondary)" }}>
                - {type}
              </span>
            )}
            {sourceLabel && (
              <span
                className="ml-2 rounded px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em]"
                style={{
                  backgroundColor: "var(--hamilton-accent-subtle)",
                  color: "var(--hamilton-text-accent)",
                }}
              >
                {sourceLabel}
              </span>
            )}
          </span>
        ) : (
          <Link
            href={settingsHref}
            className="text-xs font-bold no-underline transition-colors hover:opacity-80"
            style={{ color: "var(--hamilton-text-accent)" }}
          >
            Configure institution
          </Link>
        )}
      </div>

      {/* Divider */}
      <div className="hidden h-6 w-px sm:block" style={{ backgroundColor: "rgba(216,194,184,0.3)" }} />

      {/* Evidence state */}
      {feePublicationLabel && (
        <>
          <div className="flex min-w-0 flex-[1_1_220px] flex-col">
            <span
              className="text-[9px] uppercase tracking-[0.1em] font-bold mb-0.5"
              style={{ color: "var(--hamilton-text-tertiary)" }}
            >
              Evidence
            </span>
            <span className="min-w-0 text-xs font-bold" style={{ color: "var(--hamilton-text-primary)" }}>
              <span className="inline-block max-w-full truncate align-bottom">{feePublicationLabel}</span>
              <span className="font-normal ml-1.5" style={{ color: "var(--hamilton-text-secondary)" }}>
                {publishedFeeCount ?? 0} verified / {provisionalFeeCount ?? 0} provisional
              </span>
            </span>
          </div>

          <div className="hidden h-6 w-px sm:block" style={{ backgroundColor: "rgba(216,194,184,0.3)" }} />
        </>
      )}

      {/* Data horizon (fixed; not a selector) */}
      <div className="flex flex-col" title="Benchmarks use the latest published fee schedules">
        <span
          className="text-[9px] uppercase tracking-[0.1em] font-bold mb-0.5"
          style={{ color: "var(--hamilton-text-tertiary)" }}
        >
          Data
        </span>
        <span className="text-xs" style={{ color: "var(--hamilton-text-primary)" }}>
          Latest published
        </span>
      </div>

      {/* Asset tier / district chips */}
      {(assetTier || fedDistrict) && (
        <div className="flex min-w-0 flex-wrap items-center gap-2 lg:ml-auto">
          {assetTier && (
            <span
              className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded"
              style={{
                backgroundColor: "var(--hamilton-accent-subtle)",
                color: "var(--hamilton-text-accent)",
              }}
            >
              {assetTier}
            </span>
          )}
          {fedDistrict && (
            <span
              className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded"
              style={{
                backgroundColor: "var(--hamilton-accent-subtle)",
                color: "var(--hamilton-text-accent)",
              }}
            >
              District {fedDistrict}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
