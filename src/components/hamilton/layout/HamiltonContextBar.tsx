import Link from "next/link";
import type { HamiltonContextSource } from "@/lib/hamilton/context-source";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";
import { DISTRICT_NAMES } from "@/lib/fed-districts";
import { getSegmentLabel } from "@/app/(public)/institution/[id]/enum-labels";

/** Plain-language asset tier for display; never shows a raw database key. */
export function assetTierDisplayLabel(
  tier: string | null | undefined,
  charterType: string | null | undefined = null,
): string | null {
  if (!tier) return null;
  const segment = getSegmentLabel(tier, charterType);
  if (segment) return segment;
  // Already a display label (the layout passes assetTierLabel when it has one).
  if (!/_/.test(tier) && tier !== tier.toLowerCase()) return tier;
  const words = tier.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "23 verified fees, 23 provisional" — counts in words, without the status label repeated. */
export function evidenceSummary(published: number | null | undefined, provisional: number | null | undefined): string | null {
  const verified = published ?? 0;
  const pending = provisional ?? 0;
  if (verified === 0 && pending === 0) return null;
  const parts: string[] = [];
  if (verified > 0) parts.push(`${verified.toLocaleString()} verified ${verified === 1 ? "fee" : "fees"}`);
  if (pending > 0) parts.push(`${pending.toLocaleString()} provisional`);
  return parts.join(", ");
}

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
  } = institutionContext;
  const hasInstitution = !!name;
  const institutionName = name ?? "Global Private Bank";
  const tierLabel = assetTierDisplayLabel(assetTier, type);
  const evidenceText = evidenceSummary(publishedFeeCount, provisionalFeeCount);
  const districtLabel = fedDistrict
    ? DISTRICT_NAMES[fedDistrict]
      ? `${DISTRICT_NAMES[fedDistrict]} Fed district`
      : `Fed district ${fedDistrict}`
    : null;
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
                · {type === "credit_union" ? "Credit union" : type === "bank" ? "Bank" : type.replace(/_/g, " ")}
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
            <span
              className="min-w-0 truncate text-xs font-semibold"
              style={{ color: "var(--hamilton-text-primary)" }}
              title={feePublicationLabel}
            >
              {evidenceText ?? feePublicationLabel}
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
      {(tierLabel || districtLabel) && (
        <div className="flex min-w-0 flex-wrap items-center gap-2 lg:ml-auto">
          {tierLabel && (
            <span
              className="px-2 py-0.5 text-[11px] font-medium rounded"
              style={{
                backgroundColor: "var(--hamilton-accent-subtle)",
                color: "var(--hamilton-text-accent)",
              }}
            >
              {tierLabel}
            </span>
          )}
          {districtLabel && (
            <span
              className="px-2 py-0.5 text-[11px] font-medium rounded"
              style={{
                backgroundColor: "var(--hamilton-accent-subtle)",
                color: "var(--hamilton-text-accent)",
              }}
            >
              {districtLabel}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
