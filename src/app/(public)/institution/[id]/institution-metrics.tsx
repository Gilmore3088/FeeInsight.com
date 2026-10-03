import Link from "next/link";
import { ArrowRight } from "lucide-react";
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
        : "text-[#1A1815]";

  return (
    <div className={`min-w-0 px-4 py-3 ${framed ? "border border-[#E0D7C9] bg-[#FDFBF8]" : ""}`}>
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#6B6255]">{label}</p>
      <p className={`mt-1 break-words text-lg font-semibold tabular-nums ${valueClass}`}>
        {value}
      </p>
    </div>
  );
}

export interface InstitutionMetricRowProps {
  verifiedCount: number;
  underReviewCount: number;
  assetsDollars: number | null;
  financialsAsOf: string | null;
}

/** Counts and context for the profile, below the fee schedule and the alert control. */
export function InstitutionMetricRow({
  verifiedCount,
  underReviewCount,
  assetsDollars,
  financialsAsOf,
}: InstitutionMetricRowProps) {
  return (
    <section aria-label="Profile facts" className="overflow-hidden border border-[#E0D7C9] bg-[#FDFBF8]">
      <div className="grid grid-cols-2 divide-y divide-[#E0D7C9] sm:grid-cols-4 sm:divide-x sm:divide-y-0">
        <Metric label="Verified fees" value={verifiedCount.toLocaleString("en-US")} tone="verified" />
        <Metric
          label="Under review"
          value={underReviewCount.toLocaleString("en-US")}
          tone={underReviewCount > 0 ? "review" : undefined}
        />
        <Metric label="Assets" value={assetsDollars ? formatCompactDollars(assetsDollars) : "N/A"} />
        <Metric label="Financials as of" value={financialsAsOf ?? "N/A"} />
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
    <section className="border border-[#E0D7C9] bg-white px-4 py-4 sm:px-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#1A1815]">
            Work at {institutionName}? Get your {COMPETITIVE_FEE_POSITION_REPORT.name} — {COMPETITIVE_FEE_POSITION_REPORT.price}, delivered in {COMPETITIVE_FEE_POSITION_REPORT.turnaround}.
          </p>
          <p className="mt-1 text-sm text-[#5A5347]">
            Every fee on this page benchmarked against a verified peer set, in a board-ready document.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-2 sm:flex-row sm:items-center">
          <Link
            href={reportOfferHref}
            className="inline-flex items-center gap-2 rounded-md bg-[#C44B2E] px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#A93D25]"
          >
            Get your free report
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href={correctSourceHref}
            className="text-xs font-semibold text-[#6B6255] underline-offset-2 hover:text-[#A93D25] hover:underline"
          >
            Correct or add a fee source
          </Link>
        </div>
      </div>
    </section>
  );
}
