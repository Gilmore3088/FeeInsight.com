import Link from "next/link";
import { WORKSPACE_SEAT_LIMIT } from "@/lib/hamilton/workspace-seats";
import { ArrowRight } from "lucide-react";
import { InfoTip } from "@/components/public/info-tip";
import { REPORT_PRICE_INLINE } from "@/lib/constants";
import { formatCompactDollars } from "@/lib/format";
import { PRO_PLANS_HREF } from "@/components/public/pro-next-step";
import { COMPETITIVE_FEE_POSITION_REPORT } from "./profile-copy";

export function Metric({
  label,
  value,
  tone,
  framed = false,
}: {
  label: string;
  value: string;
  tone?: "verified" | "review";
  framed?: boolean;
}) {
  const valueClass =
    tone === "verified"
      ? "text-emerald-700"
      : tone === "review"
        ? "text-amber-800"
        : "text-ink";

  return (
    <div className={`min-w-0 px-3 py-3 sm:px-4 ${framed ? "border border-border bg-surface-0" : ""}`}>
      <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-ink-muted sm:text-[11px] sm:tracking-[0.12em]">{label}</p>
      <p className={`mt-1 break-words text-lg font-semibold tabular-nums ${valueClass}`}>
        {value}
      </p>
    </div>
  );
}

export interface InstitutionMetricRowProps {
  /** Headline categories published, out of headlineTotal; null when the count could not be read. */
  headlineCategories: number | null;
  headlineTotal: number;
  verifiedCount: number;
  underReviewCount: number;
  assetsDollars: number | null;
}

/** Counts and context for the profile, below the fee schedule and the alert control. */
export function InstitutionMetricRow({
  headlineCategories,
  headlineTotal,
  verifiedCount,
  underReviewCount,
  assetsDollars,
}: InstitutionMetricRowProps) {
  return (
    <section aria-label="Profile facts" className="overflow-hidden border border-border bg-surface-0">
      <div className="grid grid-cols-2 gap-px bg-border *:bg-surface-0 sm:grid-cols-4">
        <Metric
          label="Headline fees published"
          value={headlineCategories === null ? "N/A" : `${headlineCategories} of ${headlineTotal}`}
        />
        <Metric label="Published fees" value={verifiedCount.toLocaleString("en-US")} />
        <Metric
          label="Under review"
          value={underReviewCount.toLocaleString("en-US")}
          tone={underReviewCount > 0 ? "review" : undefined}
        />
        <Metric label="Assets" value={assetsDollars ? formatCompactDollars(assetsDollars) : "N/A"} />
      </div>
    </section>
  );
}

/**
 * The one ask on a bank's page (James, 2026-10-15: Pro is the goal, the report is a lead): Pro
 * for anyone who isn't on it yet, with the one-off report as the quieter second path.
 */
export function InstitutionOfferBand({
  institutionName,
  reportOfferHref,
  correctSourceHref,
  isPro = false,
}: {
  institutionName: string;
  reportOfferHref: string;
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
                  The {COMPETITIVE_FEE_POSITION_REPORT.name}: every fee on this page benchmarked against a
                  verified peer set, in a board-ready document. {COMPETITIVE_FEE_POSITION_REPORT.price}:{" "}
                  {COMPETITIVE_FEE_POSITION_REPORT.nextStep.toLowerCase()}.
                </>
              ) : (
                <>
                  Hamilton, the Fee Insight Pro workspace, gives up to {WORKSPACE_SEAT_LIMIT} people your fees against
                  your market, a watchlist of the competitors you pick, and cited reports for the board.
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
              <Link
                href={PRO_PLANS_HREF}
                className="inline-flex items-center gap-2 rounded-md bg-ink px-3.5 py-2 text-sm font-semibold text-on-ink transition-opacity hover:opacity-90"
              >
                See Hamilton plans
                <ArrowRight className="h-4 w-4" />
              </Link>
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
