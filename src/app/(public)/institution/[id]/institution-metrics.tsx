import Link from "next/link";
import { WORKSPACE_SEAT_LIMIT } from "@/lib/hamilton/workspace-seats";
import { ArrowRight } from "lucide-react";
import { InfoTip } from "@/components/public/info-tip";
import { REPORT_PRICE_INLINE } from "@/lib/constants";
import { TrackLink } from "@/components/track-link";
import { DEMO_REQUEST_NAV, PRO_PLANS_NAV } from "@/components/nav-items";
import { COMPETITIVE_FEE_POSITION_REPORT } from "./profile-copy";

/**
 * The one ask on a bank's page (James, 2026-10-15: Pro is the goal, the report is a lead): Pro
 * for anyone who isn't on it yet, with the one-off report as the quieter second path.
 */
export function InstitutionOfferBand({
  institutionName,
  reportOfferHref,
  plansHref,
  correctSourceHref,
  isPro = false,
}: {
  institutionName: string;
  reportOfferHref: string;
  /** The Pro plans opened on this institution's tier (buildPublicInstitutionProfileLinks). */
  plansHref: string;
  correctSourceHref: string;
  isPro?: boolean;
}) {
  return (
    <section className="@container border border-border bg-white px-4 py-4 sm:px-5">
      {/* Side by side only when the card itself is wide enough: in the narrow profile column
          the heading stacks above the actions instead of squeezing to a word per line. */}
      <div className="flex flex-col gap-3 @2xl:flex-row @2xl:items-center @2xl:justify-between">
        <div className="min-w-0 @2xl:min-w-[16rem] @2xl:flex-1">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <p>
              {isPro
                ? `Work at ${institutionName}? Put every fee in a board-ready report.`
                : `Work at ${institutionName}? See every fee against your competitors in Hamilton.`}
            </p>
            <InfoTip label={isPro ? "About the report" : "About Hamilton"}>
              {isPro ? (
                <>
                  The {COMPETITIVE_FEE_POSITION_REPORT.name}, {COMPETITIVE_FEE_POSITION_REPORT.price.toLowerCase()}.
                </>
              ) : (
                <>
                  Hamilton, the Fee Insight Pro workspace: your fees against your market, for up to {WORKSPACE_SEAT_LIMIT} people.
                </>
              )}
            </InfoTip>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {isPro ? (
            <Link
              href={reportOfferHref}
              className="inline-flex items-center gap-2 rounded-md bg-ink px-3.5 py-2 text-sm font-semibold text-on-ink transition-opacity hover:opacity-90"
            >
              Request the report
              <ArrowRight className="h-4 w-4" />
            </Link>
          ) : (
            <>
              <TrackLink
                event="upgrade_click"
                eventProps={{ placement: "institution_offer" }}
                href={plansHref}
                className="inline-flex items-center gap-2 rounded-md bg-ink px-3.5 py-2 text-sm font-semibold text-on-ink transition-opacity hover:opacity-90"
              >
                {PRO_PLANS_NAV.label}
                <ArrowRight className="h-4 w-4" />
              </TrackLink>
              <TrackLink
                event="contact_sales"
                eventProps={{ placement: "institution_offer_demo" }}
                href={DEMO_REQUEST_NAV.href}
                className="text-xs font-semibold text-brick underline underline-offset-2"
              >
                {DEMO_REQUEST_NAV.label}
              </TrackLink>
              <Link
                href={reportOfferHref}
                className="text-xs font-semibold text-ink-muted underline-offset-2 hover:text-brick hover:underline"
              >
                Or a one-off report, {REPORT_PRICE_INLINE}
              </Link>
            </>
          )}
          <Link
            href={correctSourceHref}
            className="text-xs font-semibold text-ink-muted underline-offset-2 hover:text-brick hover:underline"
          >
            Correct or add a fee source
          </Link>
        </div>
      </div>
    </section>
  );
}
