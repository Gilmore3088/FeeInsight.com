import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";

const DISPLAY = { fontFamily: "var(--font-jakarta), ui-sans-serif, system-ui, sans-serif" };

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
      <span className="rounded bg-[#F3EEE6] px-1.5 py-0.5 font-semibold text-[#3D3833]">{item.source}</span>
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
    <figure className="overflow-hidden rounded-2xl bg-white/70 backdrop-blur-xl ring-1 ring-[#E8E1D6]/80 shadow-[0_8px_32px_-12px_rgba(26,24,21,0.22),inset_0_1px_0_rgba(255,255,255,0.7)]">
      <figcaption className="flex items-center justify-between gap-3 border-b border-[#E8E1D6]/80 bg-white/50 px-4 py-2.5">
        <span className="flex items-center gap-2 text-sm font-semibold text-[#1A1815]">
          <span aria-hidden className="h-2 w-2 rounded-full bg-[#C44B2E]" />
          Regulatory Wire
        </span>
        <span className="text-xs text-[#6B6255]">Federal releases and state bills</span>
      </figcaption>

      {lead && (
        <div className="px-4 py-4 sm:px-5">
          <ItemMeta item={lead} />
          <p className="mt-1.5 text-lg leading-snug text-[#1A1815] font-semibold tracking-tight" style={DISPLAY}>
            <SourceLink url={lead.url}>{lead.title}</SourceLink>
          </p>
          {lead.officialTitle && lead.officialTitle !== lead.title && (
            <p className="mt-0.5 text-xs text-[#6B6255]">Official title: {lead.officialTitle}</p>
          )}
          {lead.figures.length > 0 && (
            <div className="mt-3 rounded-lg bg-[#FAF7F2] px-3 py-2.5 ring-1 ring-[#E8E1D6]">
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
              Read the source<ArrowUpRight aria-hidden className="ml-0.5 h-3.5 w-3.5" />
            </a>
          )}
        </div>
      )}

    </figure>
  );
}
