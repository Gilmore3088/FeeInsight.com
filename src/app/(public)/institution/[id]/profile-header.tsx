import Link from "next/link";
import { Building2, CalendarCheck, ExternalLink, FileText, Landmark, MapPin, type LucideIcon } from "lucide-react";
import { InfoTip } from "@/components/public/info-tip";
import { GLASS, H1, TEXT_LINK } from "@/components/public/site-look";
import type { FeePublicationStatus } from "@/lib/institution-quality";
import { getPublicStatusLabel } from "./enum-labels";
import { STATUS_COPY } from "./profile-copy";

const STATUS_TONE: Record<FeePublicationStatus, string> = {
  verified: "border-emerald-200 bg-emerald-50 text-emerald-800",
  provisional: "border-amber-200 bg-amber-50 text-amber-900",
  under_review: "border-amber-200 bg-amber-50 text-amber-900",
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
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E0D7C9] bg-white px-2.5 py-1 text-xs text-[#5A5347]">
      <Icon className="h-3.5 w-3.5 text-[#8A8072]" aria-hidden="true" />
      {children}
    </span>
  );
}

export interface LocationPart {
  label: string;
  href: string | null;
}

const TAG_LINK_CLASS = TEXT_LINK;

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
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-white/70 px-3 text-sm font-semibold text-[#1A1815] ring-1 ring-[#E8E1D6] hover:bg-white hover:text-[#A93D25] hover:ring-[#C44B2E]/40";

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
    <header className={`fi-reveal mb-6 p-5 sm:p-7 ${GLASS}`}>
      {/* One column: the name spans the full width, links sit below it (headers run across, never in a column). */}
      <div className="flex min-w-0 flex-col gap-5">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <StatusBadge status={status} />
            <InfoTip label="What this status means">{STATUS_COPY[status]}</InfoTip>
            {segmentLabel && (
              <span className="rounded-md border border-[#E0D7C9] bg-white px-2 py-1 text-[11px] font-medium text-[#6B6255]">
                {segmentLabel}
              </span>
            )}
          </div>
          <h1 className={`break-words ${H1}`}>
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
          <div className="flex flex-wrap gap-2">
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
