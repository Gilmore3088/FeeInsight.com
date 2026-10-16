import Link from "next/link";
import { FileText } from "lucide-react";
import { InfoTip } from "@/components/public/info-tip";
import { PAGE_HEADER } from "@/components/public/page-header";
import type { FeePublicationStatus } from "@/lib/institution-quality";
import { getPublicStatusLabel } from "./enum-labels";
import { STATUS_COPY } from "./profile-copy";

const STATUS_TONE: Record<FeePublicationStatus, string> = {
  verified: "border-emerald-200 bg-emerald-50 text-emerald-800",
  provisional: "border-amber-200 bg-amber-50 text-amber-900",
  under_review: "border-amber-200 bg-amber-50 text-amber-900",
  unavailable: "border-border bg-white text-ink-muted",
};

export function StatusBadge({ status }: { status: FeePublicationStatus }) {
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-1 text-[11px] font-semibold ${STATUS_TONE[status]}`}>
      {getPublicStatusLabel(status)}
    </span>
  );
}

export interface ProfileHeaderProps {
  name: string;
  status: FeePublicationStatus;
  segmentLabel: string | null;
  locationLabel: string | null;
  /** The location tag's parts, each linked to its fee page; `locationLabel` is shown when absent. */
  location?: LocationPart[];
  charterLabel: string;
  districtName: string | null;
  districtHref?: string | null;
  websiteUrl: string | null;
  feeScheduleUrl: string | null;
  collectedOn: string | null;
}

export interface LocationPart {
  label: string;
  href: string | null;
}

const TAG_LINK_CLASS = "underline decoration-border underline-offset-2 hover:text-brick hover:decoration-brick";

function TagText({ label, href }: LocationPart) {
  return href ? (
    <Link href={href} className={TAG_LINK_CLASS}>
      {label}
    </Link>
  ) : (
    <>{label}</>
  );
}

const LINK_CLASS =
  "inline-flex items-center gap-2 rounded-full border border-control-border bg-surface-0 px-4 py-2 text-[14px] font-semibold text-ink transition-colors hover:border-ink";

export function ProfileHeader({
  name,
  status,
  segmentLabel,
  locationLabel,
  location,
  charterLabel,
  districtName,
  districtHref,
  websiteUrl,
  feeScheduleUrl,
  collectedOn,
  publishedCount,
  assetsLabel,
  regulatorFacts = [],
}: ProfileHeaderProps & {
  publishedCount: number;
  /** Total assets, e.g. "$4.4B". */
  assetsLabel: string | null;
  /** Regulator, charter agency, holding company and status, from the registry. */
  regulatorFacts?: Array<{ label: string; value: string }>;
}) {
  const facts: Array<{ label: string; value: React.ReactNode }> = [];
  if (location && location.length > 0) {
    facts.push({
      label: "Location",
      value: location.map((part, i) => (
        <span key={part.label}>
          {i > 0 && ", "}
          <TagText {...part} />
        </span>
      )),
    });
  } else if (locationLabel) {
    facts.push({ label: "Location", value: locationLabel });
  }
  facts.push({ label: "Type", value: charterLabel });
  if (assetsLabel) facts.push({ label: "Total assets", value: assetsLabel });
  else if (segmentLabel) facts.push({ label: "Size", value: segmentLabel });
  if (districtName) {
    facts.push({ label: "Fed district", value: <TagText label={districtName} href={districtHref ?? null} /> });
  }
  for (const fact of regulatorFacts) facts.push(fact);

  return (
    <header className={`fi-reveal pb-6 pt-2 sm:pb-8 ${PAGE_HEADER}`}>
      <div className="flex items-center justify-center gap-1.5 sm:justify-start">
        <StatusBadge status={status} />
        <InfoTip label="What this status means">{STATUS_COPY[status]}</InfoTip>
      </div>
      <h1 className="mx-auto mt-3 max-w-4xl break-words text-[34px] font-semibold leading-[1.02] tracking-[-0.035em] text-ink sm:mx-0 sm:text-[52px]">
        {name}
      </h1>
      <dl className="mt-5 grid text-left grid-cols-2 gap-x-5 gap-y-4 rounded-xl border border-border bg-surface-0 p-4 sm:grid-cols-4 sm:p-5">
        {facts.map((fact) => (
          <div key={fact.label} className="min-w-0">
            <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">{fact.label}</dt>
            <dd className="mt-1 break-words text-[14px] font-medium leading-5 text-ink">{fact.value}</dd>
          </div>
        ))}
      </dl>
      {(feeScheduleUrl || websiteUrl || collectedOn) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 sm:justify-start">
          {feeScheduleUrl && (
            <a href={feeScheduleUrl} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
              <FileText className="h-4 w-4" aria-hidden="true" />
              Its fee schedule
            </a>
          )}
          <p className="text-[13px] text-ink-muted">
            {publishedCount > 0 && `${publishedCount.toLocaleString("en-US")} published fees`}
            {publishedCount > 0 && collectedOn && " · "}
            {collectedOn && `read ${collectedOn}`}
            {websiteUrl && (
              <>
                {" · "}
                <a href={websiteUrl} target="_blank" rel="noopener noreferrer" className="underline decoration-border underline-offset-2 hover:text-ink">
                  Website
                </a>
              </>
            )}
          </p>
        </div>
      )}
    </header>
  );
}
