import Link from "next/link";
import { ProLock } from "@/components/public/pro-lock";
import { formatAbsoluteDate } from "@/lib/public-stats";
import type { ArticleSummary } from "@/lib/data-store/articles";
import { MARKET_CONCENTRATION_YEAR } from "@/lib/data-store/financial";
import { HubSection } from "./district/[id]/district-hub";

const SERIF = { fontFamily: "var(--fi-font-sans)" };

interface Study {
  href: string;
  /** The question the study asks. */
  question: string;
  /** The deliverable a reader can open today, said precisely. */
  available: string;
  /** What the study hasn't published yet; no finding is claimed before one is. */
  pending: string;
  /** Which data the study reads and how current it is. */
  data: (asOf: string | null) => string;
  pro: boolean;
}

const STUDIES: Study[] = [
  {
    href: "/research/fee-revenue-analysis",
    question: "Do institutions that publish higher fees earn more service-charge income?",
    available: "Fee levels beside service-charge income, by asset size and by charter, for Hamilton subscribers.",
    pending: "A conclusion on whether higher fees mean more income.",
    data: (asOf) => `Fees as of ${asOf ?? "the latest refresh"}; income from each institution's latest call report.`,
    pro: true,
  },
  {
    href: "/research/market-concentration",
    question: "Are fees higher where fewer banks compete for deposits?",
    available: "Deposit concentration (HHI) for each U.S. metro area, for Hamilton subscribers.",
    pending: "The comparison of concentration with fees.",
    data: () => `Deposits from the FDIC Summary of Deposits, ${MARKET_CONCENTRATION_YEAR}.`,
    pro: true,
  },
];

/** Studies without a published result yet: secondary, at the foot of the page, each saying what is available now and what isn't. */
export function ResearchLibrary({ articles, asOf }: { articles: ArticleSummary[]; asOf: string | null }) {
  return (
    <HubSection
      id="in-progress"
      title="Ongoing research"
      line="Two studies under way. Each lists the data you can open today and what hasn't been published."
      source="Published fee schedules beside FDIC and NCUA call reports and the FDIC Summary of Deposits. Each study page says what is published so far."
    >
      <div>
      <p id="studies-label" className="text-[13px] font-semibold text-ink sm:mx-0 sm:text-left">
        Studies under way
      </p>
      <ul aria-labelledby="studies-label" className="mt-3 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-white">
        {STUDIES.map((s) => (
          <li key={s.href}>
            <Link href={s.href} className="group block px-5 py-4 hover:bg-paper">
              <span className="flex items-start justify-between gap-3">
                <span className="text-[14px] font-semibold leading-snug text-ink group-hover:text-brick" style={SERIF}>
                  {s.question}
                </span>
                {s.pro && <ProLock className="mt-0.5 shrink-0" />}
              </span>
              <span className="mt-2 grid gap-1 text-[13px] leading-relaxed text-ink-soft sm:grid-cols-[7.5rem_minmax(0,1fr)]">
                <span className="text-[12px] font-semibold text-ink">Available now</span>
                <span>{s.available}</span>
                <span className="text-[12px] font-semibold text-ink-muted">Not yet published</span>
                <span className="text-ink-muted">{s.pending}</span>
              </span>
              <span className="mt-1 block text-[11px] text-ink-muted">{s.data(asOf)}</span>
            </Link>
          </li>
        ))}
      </ul>

      {articles.length > 0 && (
        <div className="mt-6">
          <h3 className="text-[15px] font-semibold text-ink">Latest analysis</h3>
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

      <p className="mt-3 flex flex-wrap items-center gap-x-5 text-[13px] text-ink-muted sm:mx-0">
        <Link href="/guides" className="inline-flex min-h-11 items-center font-semibold text-ink underline decoration-border underline-offset-2 hover:decoration-ink">
          Consumer fee guides
        </Link>
        <Link href="/research/data-sources" className="inline-flex min-h-11 items-center font-semibold text-ink underline decoration-border underline-offset-2 hover:decoration-ink">
          Where the data comes from
        </Link>
      </p>
      </div>
    </HubSection>
  );
}
