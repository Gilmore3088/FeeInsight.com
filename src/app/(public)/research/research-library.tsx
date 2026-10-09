import Link from "next/link";
import { ProLock } from "@/components/public/pro-lock";
import { formatAbsoluteDate } from "@/lib/public-stats";
import type { ArticleSummary } from "@/lib/data-store/articles";
import { SectionHeading } from "./research-hero";

/** Headings and figures in the page font (Plus Jakarta Sans), as on /subscribe. */
const SERIF = { fontWeight: 600, letterSpacing: "-0.015em" };

interface Study {
  href: string;
  kicker: string;
  title: string;
  body: string;
  pro: boolean;
  /** Tiny drawn motif for the card face; decoration only. */
  motif: "bars" | "grid" | "book" | "sources";
}

const STUDIES: Study[] = [
  {
    href: "/research/fee-revenue-analysis",
    kicker: "Study",
    title: "Fee-to-revenue analysis",
    body: "How published fee schedules line up with the service charge income reported in FDIC call reports.",
    pro: true,
    motif: "bars",
  },
  {
    href: "/research/market-concentration",
    kicker: "Study",
    title: "Market concentration & fees",
    body: "Deposit market competition (HHI) across U.S. metro areas from FDIC Summary of Deposits data, set against fees.",
    pro: true,
    motif: "grid",
  },
  {
    href: "/guides",
    kicker: "Guides",
    title: "Consumer fee guides",
    body: "Plain-language guides to overdraft, NSF, ATM, wire and maintenance fees, with live benchmarks.",
    pro: false,
    motif: "book",
  },
  {
    href: "/research/data-sources",
    kicker: "Reference",
    title: "Data sources",
    body: "Where every input comes from: fee schedules, call reports, NCUA 5300 data and the Beige Book.",
    pro: false,
    motif: "sources",
  },
];

function Motif({ kind }: { kind: Study["motif"] }) {
  const ink = "#1A1815";
  const accent = "#C44B2E";
  return (
    <svg aria-hidden="true" viewBox="0 0 120 64" className="h-16 w-full">
      {kind === "bars" &&
        [18, 30, 24, 42, 36, 52].map((h, i) => (
          <rect key={i} x={6 + i * 19} y={60 - h} width="12" height={h} rx="2" fill={i === 5 ? accent : ink} fillOpacity={i === 5 ? 1 : 0.14} />
        ))}
      {kind === "grid" &&
        Array.from({ length: 24 }).map((_, i) => (
          <rect key={i} x={6 + (i % 8) * 14} y={6 + Math.floor(i / 8) * 18} width="11" height="14" rx="2" fill={[3, 10, 11, 18].includes(i) ? accent : ink} fillOpacity={[3, 10, 11, 18].includes(i) ? 0.9 : 0.1} />
        ))}
      {kind === "book" && (
        <g fill="none" stroke={ink} strokeOpacity="0.35" strokeWidth="2">
          <path d="M60 14c-10-6-24-6-34-2v40c10-4 24-4 34 2 10-6 24-6 34-2V12c-10-4-24-4-34 2z" />
          <path d="M60 14v40" />
          <path d="M34 24h16M34 32h16M70 24h16M70 32h12" stroke={accent} strokeOpacity="0.9" />
        </g>
      )}
      {kind === "sources" && (
        <g>
          {[0, 1, 2, 3].map((i) => (
            <g key={i}>
              <circle cx="14" cy={10 + i * 15} r="4" fill={ink} fillOpacity="0.2" />
              <path d={`M20 ${10 + i * 15} C 60 ${10 + i * 15}, 70 32, 100 32`} stroke={ink} strokeOpacity="0.2" strokeWidth="1.5" fill="none" />
            </g>
          ))}
          <circle cx="104" cy="32" r="7" fill={accent} />
        </g>
      )}
    </svg>
  );
}

export function ResearchLibrary({ articles }: { articles: ArticleSummary[] }) {
  return (
    <section id="library" className="scroll-mt-28">
      <SectionHeading eyebrow="Studies & guides" title="Go deeper">
        Original studies that connect fees to revenue and competition, plus guides written for consumers.
      </SectionHeading>

      <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STUDIES.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="group flex flex-col overflow-hidden rounded-2xl bg-white/70 ring-1 ring-[#E8E1D6]/80 shadow-[0_8px_32px_-12px_rgba(26,24,21,0.22),inset_0_1px_0_rgba(255,255,255,0.7)] backdrop-blur-xl transition-all hover:-translate-y-0.5 hover:border-[#C44B2E]/30 hover:shadow-lg hover:shadow-[#C44B2E]/5"
          >
            <div className="border-b border-[#F1EBE1] bg-[#FAF7F2] px-5 py-4">
              <Motif kind={s.motif} />
            </div>
            <div className="flex flex-1 flex-col px-5 py-4">
              <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8A8072]">
                {s.kicker}
                {s.pro && <ProLock />}
              </p>
              <h3 className="mt-1.5 text-[17px] font-semibold leading-snug text-[#1A1815] group-hover:text-[#A93D25]" style={SERIF}>
                {s.title}
              </h3>
              <p className="mt-1.5 flex-1 text-[13px] leading-relaxed text-[#6B6255]">{s.body}</p>
              <span className="mt-3 text-[12px] font-semibold text-[#A93D25]">
                Open <span className="inline-block transition-transform group-hover:translate-x-0.5">&rarr;</span>
              </span>
            </div>
          </Link>
        ))}
      </div>

      {articles.length > 0 && (
        <div className="mt-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6B6255]">Latest analysis</p>
          <ul className="mt-3 divide-y divide-[#F1EBE1] rounded-2xl bg-white/70 ring-1 ring-[#E8E1D6]/80 shadow-[0_8px_32px_-12px_rgba(26,24,21,0.22),inset_0_1px_0_rgba(255,255,255,0.7)] backdrop-blur-xl">
            {articles.map((a) => (
              <li key={a.slug}>
                <Link href={`/research/articles/${a.slug}`} className="group flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-3.5 hover:bg-[#FAF7F2]">
                  <span className="text-[11px] [font-variant-numeric:tabular-nums] text-[#8A8072] sm:w-24">{formatAbsoluteDate(a.published_at) ?? ""}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-semibold text-[#1A1815] group-hover:text-[#A93D25]">{a.title}</span>
                    {a.subtitle && <span className="block truncate text-[12px] text-[#6B6255]">{a.subtitle}</span>}
                  </span>
                  <span className="text-[12px] font-semibold text-[#A93D25]">Read &rarr;</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
