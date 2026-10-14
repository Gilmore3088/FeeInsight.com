import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { InfoTip } from "@/components/public/info-tip";
import { REPORT_PRICE_INLINE } from "@/lib/constants";
import { formatCompactDollars } from "@/lib/format";
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

export function InstitutionOfferBand({
  institutionName,
  reportOfferHref,
  correctSourceHref,
}: {
  institutionName: string;
  reportOfferHref: string;
  correctSourceHref: string;
}) {
  return (
    <section className="@container border border-border bg-white px-4 py-4 sm:px-5">
      {/* Side by side only when the card itself is wide enough: in the narrow profile column
          the heading stacks above the actions instead of squeezing to a word per line. */}
      <div className="flex flex-col gap-3 @2xl:flex-row @2xl:items-center @2xl:justify-between">
        <div className="min-w-0 @2xl:min-w-[16rem] @2xl:flex-1">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <p>Work at {institutionName}? See every fee vs. your peers.</p>
            <InfoTip label="About the report">
              The {COMPETITIVE_FEE_POSITION_REPORT.name}: every fee on this page benchmarked against a
              verified peer set, in a board-ready document. {COMPETITIVE_FEE_POSITION_REPORT.price}:{" "}
              {COMPETITIVE_FEE_POSITION_REPORT.nextStep.toLowerCase()}.
            </InfoTip>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Link
            href={reportOfferHref}
            className="inline-flex items-center gap-2 rounded-md bg-brick px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-brick-ink"
          >
            Request the report
            <ArrowRight className="h-4 w-4" />
          </Link>
          <p className="text-xs text-ink-muted">Paid report {REPORT_PRICE_INLINE} · quote within 1 business day</p>
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
