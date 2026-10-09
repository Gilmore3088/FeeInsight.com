import { PRO_EXTRA_FEATURES, PRO_WORKSPACE_FEATURES } from "@/lib/hamilton/pro-features";

const SERIF = { fontFamily: "var(--font-newsreader), Georgia, serif" };

/** One federal release as the Wire lists it. */
export interface WirePreviewItem {
  source: string;
  title: string;
  topic: string | null;
  date: string | null;
}

const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * The latest real Regulatory Wire releases in the Wire's own frame, so a buyer sees the
 * product, not a description of it. Titles and dates come straight from the feed.
 */
export function WirePreview({ items }: { items: WirePreviewItem[] }) {
  return (
    <figure className="overflow-hidden rounded-xl bg-white shadow-[0_1px_2px_rgba(26,24,21,0.06),0_12px_32px_-16px_rgba(26,24,21,0.2)] ring-1 ring-[#E8E1D6]">
      <figcaption className="flex items-center justify-between gap-3 border-b border-[#EDE6DB] bg-[#FBF9F5] px-4 py-2.5">
        <span className="flex items-center gap-2 text-sm font-semibold text-[#1A1815]">
          <span aria-hidden className="h-2 w-2 rounded-full bg-[#C44B2E]" />
          Regulatory Wire
        </span>
        <span className="text-xs text-[#6B6255]">Latest federal releases</span>
      </figcaption>
      <ul className="divide-y divide-[#EDE6DB]">
        {items.map((item) => (
          <li key={`${item.source}-${item.title}`} className="px-4 py-3">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#6B6255]">
              <span className="rounded bg-[#F1ECE4] px-1.5 py-0.5 font-semibold text-[#3D3833]">{item.source}</span>
              {item.date && <span className="tabular-nums">{DATE.format(new Date(item.date))}</span>}
              {item.topic && <span>· {item.topic}</span>}
            </p>
            <p className="mt-1 text-[15px] leading-snug text-[#1A1815]">{item.title}</p>
          </li>
        ))}
      </ul>
    </figure>
  );
}

const BENEFITS = [
  {
    key: "wire",
    title: "Regulatory developments",
    body: "Federal rules and state bills that touch bank fees, in one feed.",
  },
  {
    key: "intelligence",
    title: "Competitive benchmarking",
    body: "Your published fees against the peers you choose, with the filings behind each one.",
  },
  {
    key: "analysis",
    title: "Hamilton analysis",
    body: "Ask about any institution, test a price, and take a board-ready report to committee.",
  },
] as const;

/** Three short reasons to buy; `lead` (a benefit key) goes first. */
export function ProBenefits({ lead }: { lead: string | null }) {
  const ordered = [...BENEFITS].sort((a, b) => Number(b.key === lead) - Number(a.key === lead));
  return (
    <ul className="grid gap-5 sm:grid-cols-3">
      {ordered.map((benefit) => (
        <li key={benefit.key}>
          <p className="text-base font-semibold text-[#1A1815]">{benefit.title}</p>
          <p className="mt-1 text-[15px] leading-relaxed text-[#3D3833]">{benefit.body}</p>
        </li>
      ))}
    </ul>
  );
}

/** Every screen a plan opens, named as the workspace names it. */
export function EverythingInPro() {
  const items = [...PRO_WORKSPACE_FEATURES, ...PRO_EXTRA_FEATURES];
  return (
    <section aria-labelledby="everything-heading">
      <h2 id="everything-heading" className="text-2xl text-[#1A1815]" style={SERIF}>
        Everything in Pro
      </h2>
      <dl className="mt-6 grid gap-x-10 gap-y-5 sm:grid-cols-2">
        {items.map((item) => (
          <div key={item.key}>
            <dt className="text-base font-semibold text-[#1A1815]">{item.label}</dt>
            <dd className="mt-1 text-[15px] leading-relaxed text-[#3D3833]">{item.description}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
