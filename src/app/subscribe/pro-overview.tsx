import type { ReactNode } from "react";
import { SITE_NAME } from "@/lib/constants";
import { PRO_EXTRA_FEATURES, PRO_WORKSPACE_FEATURES } from "@/lib/hamilton/pro-features";

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
 * Real Regulatory Wire items in the Wire's own frame (James, 9 Oct 2026: show the product,
 * not a list of features). The lead item is opened up the way the Wire opens it, with the
 * published fee figures behind it; nothing here is written for the preview. Phones show only
 * the lead so the purchase card follows straight after it.
 */
export function WirePreview({ lead, items }: { lead: WirePreviewLead | null; items: WirePreviewItem[] }) {
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
              <p className="mt-2 text-xs leading-relaxed text-[#6B6255]">
                Market context from published fee schedules, not an estimate of the bill&apos;s effect.
              </p>
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

      {items.length > 0 && (
        <ul className="hidden divide-y divide-[#EDE6DB] border-t border-[#EDE6DB] sm:block">
          {items.map((item) => (
            <li key={`${item.source}-${item.title}`} className="px-4 py-3 sm:px-5">
              <ItemMeta item={item} />
              <p className="mt-1 text-[15px] leading-snug text-[#1A1815]">
                <SourceLink url={item.url}>{item.title}</SourceLink>
              </p>
            </li>
          ))}
        </ul>
      )}

      <p className="border-t border-[#EDE6DB] bg-[#FBF9F5] px-4 py-2.5 text-xs leading-relaxed text-[#6B6255] sm:px-5">
        In Pro: the full feed, filtered by topic, agency, state or fee type, with published fee figures beside items that name a fee.
      </p>
    </figure>
  );
}

const PILLARS = [
  {
    title: "Benchmark",
    body: "See how published fees compare against selected competitors, markets and peer groups.",
  },
  {
    title: "Analyze",
    body: "Use Hamilton to investigate pricing structures and try illustrative fee scenarios.",
  },
  {
    title: "Monitor",
    body: "Track competitor fee changes and the regulatory developments in Regulatory Wire.",
  },
  {
    title: "Report",
    body: "Produce source-backed research for pricing committees, management and the board.",
  },
] as const;

/** Pro as one platform in four parts (James, 9 Oct 2026); Regulatory Wire sits under Monitor. */
export function ProPillars() {
  return (
    <ul className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
      {PILLARS.map((pillar) => (
        <li key={pillar.title} className="border-t-2 border-[#C44B2E] pt-3">
          <p className="text-base font-semibold text-[#1A1815]">{pillar.title}</p>
          <p className="mt-1 text-[15px] leading-relaxed text-[#3D3833]">{pillar.body}</p>
        </li>
      ))}
    </ul>
  );
}

/** What Pro covers in four groups (James, 9 Oct 2026); each opens to the screens it names. */
const GROUPS: { title: string; included: string; keys: string[] }[] = [
  { title: "Regulatory intelligence", included: "Regulatory Wire: federal releases, rules and state bills", keys: ["wire"] },
  { title: "Competitive benchmarking", included: "Peer comparisons, institution research, fee analysis", keys: ["benchmarking", "my_fees"] },
  { title: "Hamilton", included: "Ask questions, try a price, build reports", keys: ["analysis", "scenario_modeling", "reports"] },
  { title: "Monitoring and exports", included: "Fee-change alerts, downloadable comparisons", keys: ["market_monitor", "csv"] },
];

/** Every screen a plan opens, grouped, named as the workspace names it. */
export function EverythingInPro() {
  const byKey = new Map([...PRO_WORKSPACE_FEATURES, ...PRO_EXTRA_FEATURES].map((item) => [item.key, item]));
  return (
    <section aria-labelledby="everything-heading">
      <h2 id="everything-heading" className="text-2xl text-[#1A1815]" style={SERIF}>
        One subscription. The full {SITE_NAME} platform.
      </h2>
      <div className="mt-5 divide-y divide-[#E8E1D6] border-y border-[#E8E1D6]">
        {GROUPS.map((group) => (
          <details key={group.title} className="group">
            <summary className="flex min-h-14 cursor-pointer list-none items-center gap-4 py-3 marker:content-none [&::-webkit-details-marker]:hidden">
              <span className="grid flex-1 gap-0.5 sm:grid-cols-[14rem_1fr] sm:items-baseline sm:gap-6">
                <span className="text-base font-semibold text-[#1A1815]">{group.title}</span>
                <span className="text-[15px] text-[#3D3833]">{group.included}</span>
              </span>
              <span aria-hidden className="text-lg text-[#6B6255] transition-transform group-open:rotate-45">+</span>
            </summary>
            <dl className="grid gap-4 pb-5 sm:ml-[15.5rem] sm:grid-cols-2 sm:gap-x-8">
              {group.keys.flatMap((key) => {
                const item = byKey.get(key);
                return item
                  ? [
                      <div key={item.key}>
                        <dt className="text-sm font-semibold text-[#1A1815]">{item.label}</dt>
                        <dd className="mt-0.5 text-sm leading-relaxed text-[#3D3833]">{item.description}</dd>
                      </div>,
                    ]
                  : [];
              })}
            </dl>
          </details>
        ))}
      </div>
    </section>
  );
}
