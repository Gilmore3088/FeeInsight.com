import type { ReactNode } from "react";

const SERIF = { fontFamily: "var(--font-newsreader), Georgia, serif" };

/** One Regulatory Wire item as the preview lists it: a federal release or a state bill. */
export interface WirePreviewItem {
  /** "FED", or "Illinois · HB 4474" for a bill. */
  source: string;
  title: string;
  /** Topic label for a release, or the bill's stage ("In committee"). */
  detail: string | null;
  date: string | null;
  /** The release or bill at its source. */
  url: string | null;
}

/** The lead item opened up, with the fee data the Wire puts beside it. */
export interface WirePreviewLead extends WirePreviewItem {
  /** A bill's official title, shown as stored when the heading is a plain description. */
  officialTitle: string | null;
  /** "Illinois", or "the national index". */
  place: string | null;
  /** The index's own figures for the item's fee type, worded as the Wire words them. */
  figures: { label: string; text: string }[];
}

const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function ItemMeta({ item }: { item: WirePreviewItem }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#6B6255]">
      <span className="rounded bg-[#F1ECE4] px-1.5 py-0.5 font-semibold text-[#3D3833]">{item.source}</span>
      {item.date && <span className="tabular-nums">{DATE.format(new Date(item.date))}</span>}
      {item.detail && <span>· {item.detail}</span>}
    </p>
  );
}

function SourceLink({ url, children }: { url: string | null; children: ReactNode }) {
  if (!url) return <>{children}</>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="hover:underline hover:underline-offset-2">
      {children}
    </a>
  );
}

/**
 * One real Regulatory Wire item in the Wire's own frame (James, 9 Oct 2026: show the product,
 * not a list of features), opened up the way the Wire opens it, with the published fee
 * figures behind it. Nothing here is written for the preview.
 */
export function WirePreview({ lead }: { lead: WirePreviewLead | null }) {
  return (
    <figure className="overflow-hidden rounded-xl bg-white shadow-[0_1px_2px_rgba(26,24,21,0.06),0_12px_32px_-16px_rgba(26,24,21,0.2)] ring-1 ring-[#E8E1D6]">
      <figcaption className="flex items-center justify-between gap-3 border-b border-[#EDE6DB] bg-[#FBF9F5] px-4 py-2.5">
        <span className="flex items-center gap-2 text-sm font-semibold text-[#1A1815]">
          <span aria-hidden className="h-2 w-2 rounded-full bg-[#C44B2E]" />
          Regulatory Wire
        </span>
        <span className="text-xs text-[#6B6255]">Federal releases and state bills</span>
      </figcaption>

      {lead && (
        <div className="px-4 py-4 sm:px-5">
          <ItemMeta item={lead} />
          <p className="mt-1.5 text-lg leading-snug text-[#1A1815]" style={SERIF}>
            <SourceLink url={lead.url}>{lead.title}</SourceLink>
          </p>
          {lead.officialTitle && lead.officialTitle !== lead.title && (
            <p className="mt-0.5 text-xs text-[#6B6255]">Official title: {lead.officialTitle}</p>
          )}
          {lead.figures.length > 0 && (
            <div className="mt-3 rounded-lg bg-[#FBF9F5] px-3 py-2.5 ring-1 ring-[#EDE6DB]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#6B6255]">
                In the fee data · {lead.place}
              </p>
              <dl className="mt-1.5 space-y-1">
                {lead.figures.map((figure) => (
                  <div key={figure.label} className="grid gap-x-3 text-sm sm:grid-cols-[8.5rem_1fr]">
                    <dt className="font-semibold text-[#1A1815]">{figure.label}</dt>
                    <dd className="tabular-nums text-[#3D3833]">{figure.text}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-xs text-[#6B6255]">Market context, not the bill&apos;s effect.</p>
            </div>
          )}
          {lead.url && (
            <a
              href={lead.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-[#A93D25] underline underline-offset-2"
            >
              Read the source<span aria-hidden>&nbsp;↗</span>
            </a>
          )}
        </div>
      )}

    </figure>
  );
}

const PILLARS = [
  {
    title: "Benchmark",
    body: "Your fees against any peer group.",
  },
  {
    title: "Analyze",
    body: "Ask Hamilton. Try a price.",
  },
  {
    title: "Monitor",
    body: "Competitor changes and Regulatory Wire.",
  },
  {
    title: "Report",
    body: "Source-backed reports for the board.",
  },
] as const;

/** Pro as one platform in four parts (James, 9 Oct 2026); Regulatory Wire sits under Monitor. */
export function ProPillars() {
  return (
    <ul className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
      {PILLARS.map((pillar) => (
        <li key={pillar.title} className="border-t-2 border-[#C44B2E] pt-3">
          <p className="text-base font-semibold text-[#1A1815]">{pillar.title}</p>
          <p className="mt-1 text-[15px] leading-relaxed text-[#3D3833]">{pillar.body}</p>
        </li>
      ))}
    </ul>
  );
}
