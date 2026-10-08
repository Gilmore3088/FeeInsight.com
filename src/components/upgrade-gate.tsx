import { TrackLink } from "@/components/track-link";
import { headers } from "next/headers";
import { getPublicStatsSummary } from "@/lib/public-stats";
import { SITE_NAME } from "@/lib/constants";

interface UpgradeGateProps {
  message?: string;
  compact?: boolean;
  /**
   * How many more categories a Pro seat unlocks. Callers pass a computed value
   * (categories with data minus categories shown); it is capped to the live
   * category count so it can never overstate the index.
   */
  count?: number;
  /**
   * "consumer": shown on free reader pages. Says what the professional tier is for and
   * sells nothing a consumer would not use (no exports, no API).
   */
  audience?: "consumer" | "professional";
  /**
   * The page the reader is on, so pricing can send them back after they subscribe.
   * Defaults to the current request path, which the proxy stamps on every page request.
   */
  from?: string;
  /** One sentence naming exactly what sits behind this gate; replaces the generic Pro pitch. */
  locked?: string;
}

/** Internal paths only: a gate never builds a return link to another site. */
export function gateReturnPath(path: string | null | undefined): string | null {
  if (!path || !path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return null;
  return path;
}

async function currentPath(): Promise<string | null> {
  try {
    return (await headers()).get("x-pathname");
  } catch {
    // Outside a request (tests, static render): no return path rather than a failure.
    return null;
  }
}

const PRO_LABEL = `${SITE_NAME} Pro`;

/**
 * Shown when a free user encounters a premium-only feature.
 * `compact` renders inline (for table rows). Default renders a card.
 */
export async function UpgradeGate({
  message,
  compact = false,
  count,
  audience = "professional",
  from,
  locked,
}: UpgradeGateProps) {
  const summary = await getPublicStatsSummary();
  const returnPath = gateReturnPath(from ?? (await currentPath()));
  const pricingHref = returnPath ? `/subscribe?from=${encodeURIComponent(returnPath)}#pro` : "/subscribe#pro";
  const eventProps = { from: returnPath ?? "unknown", audience, compact };
  const moreCount = count && count > 0 ? Math.min(count, summary.categories) : 0;
  if (compact) {
    return (
      <div className="text-center py-6 px-4 border-t border-[#E8DFD1] bg-gradient-to-r from-[#FAF7F2] to-white">
        <div className="text-sm text-[#6B6255]">
          {moreCount ? `${moreCount} more available` : message || "Premium feature"}
          {" "}with {PRO_LABEL}
        </div>
        <TrackLink
          event="upgrade_click"
          eventProps={eventProps}
          href={pricingHref}
          className="inline-block mt-2 text-sm font-bold text-[#A93D25] hover:underline"
        >
          See pricing &rarr;
        </TrackLink>
      </div>
    );
  }

  return (
    <div className="bg-[#FFFDF9] border border-[#E8DFD1] rounded-xl p-6 text-center">
      <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-[#FFF0ED] mb-3">
        <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-[#C44B2E]" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0110 0v4" />
        </svg>
      </div>
      <h3
        className="text-lg font-normal text-[#1A1815] mb-1"
        style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
      >
        {message || "Unlock full access"}
      </h3>
      <p className="text-sm text-[#6B6255] mb-4">
        {locked
          ? locked
          : audience === "consumer"
          ? `These breakdowns are part of ${PRO_LABEL}, built for banks, credit unions and researchers who benchmark fee schedules. Everything above stays free.`
          : moreCount
          ? `${moreCount} more fee categories, peer benchmarks by charter, size and district, CSV exports, and the Hamilton workspace.`
          : `Unlock all ${summary.categoriesLabel} fee categories, peer benchmarks by charter, size and district, CSV exports, and the Hamilton workspace.`}
      </p>
      <div className="text-[12px] text-[#6B6255] mt-2 mb-4">
        Based on {summary.observationsLabel} published fee entries from {summary.institutionsLabel} institutions
      </div>
      <TrackLink
        event="upgrade_click"
        eventProps={eventProps}
        href={pricingHref}
        className="inline-flex items-center gap-1.5 rounded-md bg-[#C44B2E] px-5 py-2.5 text-sm font-medium text-white shadow-sm shadow-[#C44B2E]/15 hover:bg-[#A93D25] hover:shadow-md hover:shadow-[#C44B2E]/25 transition-all"
      >
        See pricing
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4" aria-hidden="true">
          <path fillRule="evenodd" d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z" clipRule="evenodd" />
        </svg>
      </TrackLink>
    </div>
  );
}

/** Lock icon badge for quick action tiles. */
export function PremiumBadge() {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold bg-[#FFF0ED] text-[#A93D25] uppercase tracking-wider ml-1">
      Pro
    </span>
  );
}
