import Link from "next/link";
import { AlertTriangle, ClipboardCheck, Clock3, Database, FileText, type LucideIcon } from "lucide-react";
import { InfoTip } from "@/components/public/info-tip";
import type { FeePublicationStatus } from "@/lib/institution-quality";
import { NO_VERDICT_LABEL, type RatingResult } from "@/lib/institution-rating";
import { formatFeeAmount } from "@/lib/format";
import { getPublicStatusLabel } from "./enum-labels";
import { STATUS_COPY } from "./profile-copy";

const STATUS_TONE: Record<FeePublicationStatus, string> = {
  verified: "border-emerald-200 bg-emerald-50 text-emerald-800",
  provisional: "border-amber-200 bg-amber-50 text-amber-900",
  under_review: "border-amber-200 bg-amber-50 text-amber-900",
  unavailable: "border-border bg-white text-ink-soft",
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
    <section className={`fi-reveal fi-reveal-delay-2 mb-6 border px-4 py-4 sm:px-5 ${STATUS_TONE[status]}`}>
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
              className="inline-flex items-center justify-center gap-2 rounded-md bg-brick px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-brick-ink"
            >
              <FileText className="h-3.5 w-3.5" />
              Send us the fee schedule
            </Link>
            <Link
              href={claimHref}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-border bg-white px-3 py-2 text-xs font-semibold text-ink transition-colors hover:border-brick hover:text-brick"
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
    <section className="border border-border bg-white p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-muted">
            {factsOnly ? "Headline fees vs. national median" : "Verified Fee Profile"}
          </p>
          <div className="mt-2 flex items-center gap-1.5">
            <h2 className="text-xl font-semibold text-ink">
              {factsOnly ? "How the headline fees compare" : rating.label}
            </h2>
            {factsOnly && (
              <InfoTip label="About this comparison">
                Each published fee against the national median.
              </InfoTip>
            )}
          </div>
          {!factsOnly && (
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-soft">{interpretation}</p>
          )}
        </div>
        {overdraftAmount !== null && (
          <div className="rounded-lg border border-border bg-paper px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-muted">Overdraft</p>
            <p
              className="font-semibold mt-1 text-3xl text-ink"
              style={{ fontFamily: "var(--fi-font-sans)" }}
            >
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
              className="rounded-md border border-border bg-surface-0 px-3 py-2 text-sm text-ink-soft"
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
    <section className="border border-border bg-white p-5">
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-muted">
        Verified Fee Profile
      </p>
      <h2 className="mt-2 text-xl font-semibold text-ink">{NO_VERDICT_LABEL}</h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-soft">
        {verifiedCount} verified fees, but no paid-item overdraft or NSF fee, so no verdict.
      </p>
    </section>
  );
}
