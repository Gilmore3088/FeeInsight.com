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
    status: "Published so far: fee levels beside service-charge income, by asset size and by charter. No headline finding yet.",
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

/** Original studies, placed right after the key findings so the research is found before the coverage. */
export function ResearchLibrary({ articles, asOf }: { articles: ArticleSummary[]; asOf: string | null }) {
  return (
    <section id="studies" className="scroll-mt-28">
      <SectionHeading eyebrow="Original research" title="Studies">
        Each study asks one question of the published fees and public financial data. Where a result isn&apos;t ready,
        the card says so.
      </SectionHeading>

      <div className="mt-7 grid gap-4 md:grid-cols-2">
        {STUDIES.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="group flex flex-col rounded-2xl border border-border bg-white px-5 py-5 transition-all hover:-translate-y-0.5 hover:border-brick/30 hover:shadow-lg hover:shadow-[#b23a32]/5"
          >
            <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
              Study
              {s.pro ? <ProLock /> : <span>Free</span>}
            </p>
            <h3 className="mt-1.5 text-[18px] font-bold leading-snug text-ink group-hover:text-brick" style={SERIF}>
              {s.question}
            </h3>
            <p className="mt-2 flex-1 text-[13px] leading-relaxed text-ink-soft">{s.status}</p>
            <p className="mt-3 text-[11px] text-ink-muted">{s.data(asOf)}</p>
            <span className="mt-3 text-[12px] font-semibold text-brick">
              Open the study <span className="inline-block transition-transform group-hover:translate-x-0.5">&rarr;</span>
            </span>
          </Link>
        ))}
      </div>

      {articles.length > 0 && (
        <div className="mt-8">
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

      <p className="mt-5 text-[13px] text-ink-muted">
        Also here:{" "}
        <Link href="/guides" className="font-semibold text-ink underline decoration-border underline-offset-2 hover:decoration-ink">
          consumer fee guides
        </Link>{" "}
        and{" "}
        <Link href="/research/data-sources" className="font-semibold text-ink underline decoration-border underline-offset-2 hover:decoration-ink">
          where every input comes from
        </Link>
        .
      </p>
    </section>
  );
}
