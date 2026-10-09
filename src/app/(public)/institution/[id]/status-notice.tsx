import Link from "next/link";
import { AlertTriangle, ClipboardCheck, Clock3, Database, FileText, type LucideIcon } from "lucide-react";
import { InfoTip } from "@/components/public/info-tip";
import type { FeePublicationStatus } from "@/lib/institution-quality";
import { NO_VERDICT_LABEL, type RatingResult } from "@/lib/institution-rating";
import { formatFeeAmount } from "@/lib/format";
import { getPublicStatusLabel } from "./enum-labels";
import { STATUS_COPY } from "./profile-copy";
import { GLASS_SOFT } from "@/components/public/site-look";

const STATUS_TONE: Record<FeePublicationStatus, string> = {
  verified: "border-emerald-200 bg-emerald-50 text-emerald-800",
  provisional: "border-[#C44B2E]/25 bg-[#FDF0ED] text-[#8E2A17]",
  under_review: "border-[#C44B2E]/25 bg-[#FDF0ED] text-[#8E2A17]",
  unavailable: "border-[#E0D7C9] bg-white text-[#5A5347]",
};

const STATUS_ICON: Record<FeePublicationStatus, LucideIcon> = {
  verified: AlertTriangle,
  provisional: AlertTriangle,
  under_review: Clock3,
  unavailable: Database,
};

/** Notice shown for anything other than a fully verified profile. */
export function StatusNotice({
  status,
  needsSource,
  correctSourceHref,
  claimHref,
}: {
  status: FeePublicationStatus;
  needsSource: boolean;
  correctSourceHref: string;
  claimHref: string;
}) {
  if (status === "verified") return null;
  const Icon = STATUS_ICON[status];

  return (
    <section className={`fi-reveal fi-reveal-delay-2 mb-6 rounded-2xl border px-5 py-4 backdrop-blur-xl sm:px-6 ${STATUS_TONE[status]}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 gap-3">
          <Icon className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-bold">{getPublicStatusLabel(status)}</p>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed">{STATUS_COPY[status]}</p>
          </div>
        </div>
        {needsSource && (
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row lg:flex-col">
            <Link
              href={correctSourceHref}
              className="inline-flex items-center justify-center gap-2 min-h-11 rounded-lg bg-[#C44B2E] px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#A93D25]"
            >
              <FileText className="h-3.5 w-3.5" />
              Send us the fee schedule
            </Link>
            <Link
              href={claimHref}
              className="inline-flex items-center justify-center gap-2 min-h-11 rounded-lg border border-[#D5CBBF] bg-white px-3 py-2 text-xs font-semibold text-[#1A1815] transition-colors hover:border-[#C44B2E] hover:text-[#A93D25]"
            >
              <ClipboardCheck className="h-3.5 w-3.5" />
              Claim or validate
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}

/** Benchmark narrative; the caller only renders this once enough verified fees exist. */
export function FeeProfileSummary({
  rating,
  interpretation,
  overdraftAmount,
  factsOnly = false,
}: {
  rating: RatingResult;
  interpretation: string;
  overdraftAmount: number | null;
  /** Public profiles: show fee facts vs. the national median without an adjective verdict. */
  factsOnly?: boolean;
}) {
  return (
    <section className={`p-6 ${GLASS_SOFT}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#A93D25]">
            {factsOnly ? "Headline fees vs. national median" : "Verified Fee Profile"}
          </p>
          <div className="mt-2 flex items-center gap-1.5">
            <h2 className="text-xl font-semibold tracking-tight text-[#1A1815]">
              {factsOnly ? "How the headline fees compare" : rating.label}
            </h2>
            {factsOnly && (
              <InfoTip label="About this comparison">
                Each figure below is the published fee set against the national median. The commissioned
                report benchmarks every fee against a verified peer set instead.
              </InfoTip>
            )}
          </div>
          {!factsOnly && (
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#5A5347]">{interpretation}</p>
          )}
        </div>
        {overdraftAmount !== null && (
          <div className="rounded-xl bg-[#F3EEE6]/80 px-4 py-3 ring-1 ring-[#E8E1D6]">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#5A5347]">Overdraft</p>
            <p className="mt-1 text-3xl font-semibold text-[#1A1815] [font-variant-numeric:tabular-nums]">
              {formatFeeAmount(overdraftAmount)}
            </p>
          </div>
        )}
      </div>
      {rating.bullets.length > 0 && (
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {rating.bullets.map((bullet) => (
            <div
              key={bullet}
              className="h-full rounded-xl bg-white/70 px-3 py-2 text-sm text-[#3D3830] ring-1 ring-[#E8E1D6]"
            >
              {bullet}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Shown instead of a verdict when enough fees are verified but no paid-item overdraft/NSF fee is. */
export function FeeProfileNoVerdict({ verifiedCount }: { verifiedCount: number }) {
  return (
    <section className={`p-6 ${GLASS_SOFT}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#A93D25]">
        Verified Fee Profile
      </p>
      <h2 className="mt-2 text-xl font-semibold text-[#1A1815]">{NO_VERDICT_LABEL}</h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#5A5347]">
        {verifiedCount} verified fees are on record, but none is a paid-item overdraft or NSF charge,
        so no benchmark verdict is given. Transfer and protection fees do not stand in for it.
      </p>
    </section>
  );
}
