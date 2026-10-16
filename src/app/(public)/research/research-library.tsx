import Link from "next/link";
import { ProLock } from "@/components/public/pro-lock";
import { formatAbsoluteDate } from "@/lib/public-stats";
import type { ArticleSummary } from "@/lib/data-store/articles";
import { MARKET_CONCENTRATION_YEAR } from "@/lib/data-store/financial";
import { SectionHeading } from "./research-hero";

const SERIF = { fontFamily: "var(--fi-font-sans)" };

interface Study {
  href: string;
  /** The question the study asks. */
  question: string;
  /** What the study shows today, said plainly; no finding is claimed before one is published. */
  status: string;
  /** Which data the study reads and how current it is. */
  data: (asOf: string | null) => string;
  pro: boolean;
}

const STUDIES: Study[] = [
  {
    href: "/research/fee-revenue-analysis",
    question: "Do institutions that publish higher fees earn more service-charge income?",
    status: "Published so far: fee levels beside service-charge income, by asset size and by charter.",
    data: (asOf) => `Fees as of ${asOf ?? "the latest refresh"}; income from each institution's latest call report.`,
    pro: true,
  },
  {
    href: "/research/market-concentration",
    question: "Are fees higher where fewer banks compete for deposits?",
    status: "Published so far: deposit concentration (HHI) for U.S. metro areas. The comparison with fees isn't published yet.",
    data: () => `Deposits from the FDIC Summary of Deposits, ${MARKET_CONCENTRATION_YEAR}.`,
    pro: true,
  },
];

/** Studies without a published result yet, kept small and near the bottom so they don't interrupt the findings. */
export function ResearchLibrary({ articles, asOf }: { articles: ArticleSummary[]; asOf: string | null }) {
  return (
    <section id="in-progress" className="scroll-mt-28">
      <SectionHeading eyebrow="Further research" title="Research in progress">
        Each study sets the published fees beside public financial data to answer one question. Each page shows what is published so far.
      </SectionHeading>

      <ul className="mt-5 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-white">
        {STUDIES.map((s) => (
          <li key={s.href}>
            <Link href={s.href} className="group block px-5 py-4 hover:bg-paper">
              <span className="flex items-start justify-between gap-3">
                <span className="text-[15px] font-semibold leading-snug text-ink group-hover:text-brick" style={SERIF}>
                  {s.question}
                </span>
                {s.pro && <ProLock className="mt-0.5 shrink-0" />}
              </span>
              <span className="mt-1 block text-[13px] leading-relaxed text-ink-soft">{s.status}</span>
              <span className="mt-1 block text-[11px] text-ink-muted">{s.data(asOf)}</span>
            </Link>
          </li>
        ))}
      </ul>

      {articles.length > 0 && (
        <div className="mt-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">Latest analysis</p>
          <ul className="mt-3 divide-y divide-surface-200 rounded-2xl border border-border bg-white">
            {articles.map((a) => (
              <li key={a.slug}>
                <Link href={`/research/articles/${a.slug}`} className="group flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-3.5 hover:bg-paper">
                  <span className="text-[11px] tabular-nums text-ink-muted sm:w-24">{formatAbsoluteDate(a.published_at) ?? ""}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-semibold text-ink group-hover:text-brick">{a.title}</span>
                    {a.subtitle && <span className="block truncate text-[12px] text-ink-muted">{a.subtitle}</span>}
                  </span>
                  <span className="text-[12px] font-semibold text-brick">Read &rarr;</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-4 text-[13px] text-ink-muted">
        Also:{" "}
        <Link href="/guides" className="font-semibold text-ink underline decoration-border underline-offset-2 hover:decoration-ink">
          consumer fee guides
        </Link>{" "}
        and{" "}
        <Link href="/research/data-sources" className="font-semibold text-ink underline decoration-border underline-offset-2 hover:decoration-ink">
          where the data comes from
        </Link>
        .
      </p>
    </section>
  );
}
