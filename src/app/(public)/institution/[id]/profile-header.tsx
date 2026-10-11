import Link from "next/link";
import { Building2, CalendarCheck, ExternalLink, FileText, Landmark, MapPin, type LucideIcon } from "lucide-react";
import { InfoTip } from "@/components/public/info-tip";
import type { FeePublicationStatus } from "@/lib/institution-quality";
import { getPublicStatusLabel } from "./enum-labels";
import { STATUS_COPY } from "./profile-copy";

const STATUS_TONE: Record<FeePublicationStatus, string> = {
  verified: "border-emerald-200 bg-emerald-50 text-emerald-800",
  provisional: "border-[#C44B2E]/25 bg-[#FDF0ED] text-[#8E2A17]",
  under_review: "border-[#C44B2E]/25 bg-[#FDF0ED] text-[#8E2A17]",
  unavailable: "border-[#E0D7C9] bg-white text-[#6B6255]",
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
  financialsAsOf: string | null;
}

function FactTag({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/70 px-2.5 py-1 text-xs text-[#3D3830] ring-1 ring-[#E8E1D6] backdrop-blur">
      <Icon className="h-3.5 w-3.5 text-[#8A8072]" aria-hidden="true" />
      {children}
    </span>
  );
}

export interface LocationPart {
  label: string;
  href: string | null;
}

const TAG_LINK_CLASS = "underline decoration-[#D5CBBF] underline-offset-2 hover:text-[#A93D25] hover:decoration-[#C44B2E]";

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
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-white/70 px-4 py-2 text-sm font-semibold text-[#1A1815] ring-1 ring-[#E8E1D6] backdrop-blur transition-colors duration-200 hover:bg-white hover:text-[#A93D25] hover:ring-[#C44B2E]/40";

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
  financialsAsOf,
}: ProfileHeaderProps) {
  return (
    <header className="fi-reveal mb-5">
      <div className="grid gap-5 pb-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <StatusBadge status={status} />
            <InfoTip label="What this status means">{STATUS_COPY[status]}</InfoTip>
            {segmentLabel && (
              <span className="rounded-full bg-white/70 px-2.5 py-1 text-[11px] font-semibold text-[#5A5347] ring-1 ring-[#E8E1D6]">
                {segmentLabel}
              </span>
            )}
          </div>
          <h1
            className="max-w-4xl break-words text-4xl font-bold leading-[1.08] tracking-tight text-[#1A1815] sm:text-5xl"
          >
            {name}
          </h1>
          {/* Every key fact as a small tag: no separate facts box, no sentences. */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {location && location.length > 0 ? (
              <FactTag icon={MapPin}>
                {location.map((part, i) => (
                  <span key={part.label}>
                    {i > 0 && ", "}
                    <TagText {...part} />
                  </span>
                ))}
              </FactTag>
            ) : (
              locationLabel && <FactTag icon={MapPin}>{locationLabel}</FactTag>
            )}
            <FactTag icon={Building2}>{charterLabel}</FactTag>
            {districtName && (
              <FactTag icon={Landmark}>
                <TagText label={`${districtName} Fed district`} href={districtHref ?? null} />
              </FactTag>
            )}
            {collectedOn && <FactTag icon={CalendarCheck}>Fees collected {collectedOn}</FactTag>}
            {financialsAsOf && <FactTag icon={CalendarCheck}>Financials {financialsAsOf}</FactTag>}
          </div>
        </div>

        {(websiteUrl || feeScheduleUrl) && (
          <div className="flex flex-wrap gap-2 lg:justify-end">
            {websiteUrl && (
              <a href={websiteUrl} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
                Website
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
            {feeScheduleUrl && (
              <a href={feeScheduleUrl} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
                Published fee schedule
                <FileText className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
