import Link from "next/link";
import type { HamiltonContextSource } from "@/lib/hamilton/context-source";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";
import { DISTRICT_NAMES } from "@/lib/fed-districts";
import { STATE_NAMES } from "@/lib/us-states";
import { getSegmentLabel } from "@/app/(public)/institution/[id]/enum-labels";

interface InstitutionContext {
  name: string | null;
  type: string | null;
  assetTier: string | null;
  fedDistrict: number | null;
  city?: string | null;
  stateCode?: string | null;
  /** When the bank's own fee schedule was last read */
  feesCheckedAt?: string | null;
  /** Set when this bank is only being browsed: the link that makes it the user's bank */
  makeDefaultHref?: string | null;
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

function formatCheckedDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/**
 * The facts under the bank's name, in words a banker uses:
 * "Community bank, under $300M · Lufkin, Texas · Dallas Fed district · Fee schedule read Feb 17, 2026".
 * No database codes, no selection source, no verified/provisional counts.
 */
export function institutionFacts(context: InstitutionContext): string[] {
  const facts: string[] = [];
  const tier = assetTierDisplayLabel(context.assetTier, context.type);
  if (tier) {
    facts.push(tier);
  } else if (context.type) {
    facts.push(context.type === "credit_union" ? "Credit union" : context.type === "bank" ? "Bank" : context.type.replace(/_/g, " "));
  }
  const state = context.stateCode ? STATE_NAMES[context.stateCode.toUpperCase()] ?? context.stateCode : null;
  const place = [context.city, state].filter(Boolean).join(", ");
  if (place) facts.push(place);
  if (context.fedDistrict) {
    const district = DISTRICT_NAMES[context.fedDistrict];
    facts.push(district ? `${district} Fed district` : `Fed district ${context.fedDistrict}`);
  }
  const checked = formatCheckedDate(context.feesCheckedAt);
  if (checked) facts.push(`Fee schedule read ${checked}`);
  return facts;
}

/**
 * HamiltonContextBar - Server component. One line naming the bank every
 * Hamilton page is working on, in plain words.
 */
export function HamiltonContextBar({
  institutionContext,
  selectedInstitutionId = null,
}: HamiltonContextBarProps) {
  const { name } = institutionContext;
  const settingsHref = hrefWithInstitutionContext("/pro/settings", selectedInstitutionId);
  const facts = name ? institutionFacts(institutionContext) : [];

  return (
    <div
      className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b px-4 py-3 sm:px-6 lg:px-10"
      style={{
        backgroundColor: "var(--hamilton-surface-container-lowest, #ffffff)",
        borderColor: "rgba(216,194,184,0.25)",
        minHeight: "48px",
      }}
    >
      {name ? (
        <>
          <span className="min-w-0 text-sm font-semibold" style={{ color: "var(--hamilton-text-primary)" }}>
            {name}
          </span>
          {facts.length > 0 && (
            <span className="min-w-0 text-xs" style={{ color: "var(--hamilton-text-secondary)" }}>
              {facts.join(" · ")}
            </span>
          )}
          {institutionContext.makeDefaultHref ? (
            <span className="ml-auto flex items-baseline gap-3 text-xs">
              <span style={{ color: "var(--hamilton-text-secondary)" }}>Browsing; your saved bank is unchanged.</span>
              <Link
                href={institutionContext.makeDefaultHref}
                className="font-medium no-underline hover:underline"
                style={{ color: "var(--hamilton-text-accent)" }}
              >
                Make this my bank
              </Link>
            </span>
          ) : (
            <Link
              href={settingsHref}
              className="ml-auto text-xs font-medium no-underline hover:underline"
              style={{ color: "var(--hamilton-text-accent)" }}
            >
              Change bank
            </Link>
          )}
        </>
      ) : (
        <>
          <span className="text-sm" style={{ color: "var(--hamilton-text-secondary)" }}>
            Hamilton works best with your bank chosen.
          </span>
          <Link
            href={settingsHref}
            className="text-sm font-semibold no-underline hover:underline"
            style={{ color: "var(--hamilton-text-accent)" }}
          >
            Choose your bank
          </Link>
        </>
      )}
    </div>
  );
}
