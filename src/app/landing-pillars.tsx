import Link from "next/link";
import { Tag } from "@/brand/components";
import { HAMILTON_MODES, PRODUCT_NAME, REPORT_OFFER, REPORT_PRICE_INLINE, SITE_NAME } from "@/lib/constants";
import type { FeeCategorySummary } from "@/lib/data-store/fees";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/maturity";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { formatCount, type PublicStatsSummary } from "@/lib/public-stats";
import {
  NationalRange,
  REPORT_REQUEST_HREF,
  SECTION_INNER,
  SectionHeading,
  TEXT_LINK,
  money,
  type RangeEntry,
} from "./landing-shared";

/** The three national rows brief 08 §A.2 scene 3 names. */
const TABLE_CATEGORIES = ["overdraft", "nsf", "monthly_maintenance"] as const;

type PillarSummary = Pick<PublicStatsSummary, "categoriesLabel" | "freshnessLabel">;

/** Brief 08 §B.6: every fee, with live national medians. */
export function LandingEveryFee({
  categories,
  summary,
}: {
  categories: FeeCategorySummary[];
  summary: PillarSummary;
}) {
  const rows = TABLE_CATEGORIES.map((key) => categories.find((c) => c.fee_category === key)).filter(
    (row): row is FeeCategorySummary & { median_amount: number } => row?.median_amount != null,
  );
  return (
    <section className="border-b border-border bg-paper">
      <div className={`${SECTION_INNER} grid gap-10 py-14 sm:py-16 lg:grid-cols-2 lg:items-center`}>
        <div className="min-w-0">
          <SectionHeading eyebrow="Every fee" title="Your competitors' fees, from their own schedules" />
          <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
            The {PRODUCT_NAME} reads each institution&apos;s published fee schedule and keeps every fee with
            the document, page and date it came from. When a board member quotes a national average from
            the press, you can answer with the schedules of the banks your customers can walk into. Fees
            stated as a rate, such as a percentage of a transaction, are kept apart from dollar fees.
          </p>
          <p className="mt-5 text-[14px]">
            <Link href="/methodology" className={TEXT_LINK}>
              How we read a fee schedule
            </Link>
          </p>
        </div>
        {rows.length > 0 ? (
          <figure className="min-w-0">
            <div className="overflow-x-auto">
              <table className="fi-table">
                <caption className="sr-only">National medians from the {PRODUCT_NAME}</caption>
                <thead>
                  <tr>
                    <th scope="col">Fee</th>
                    <th scope="col" className="num">National median</th>
                    <th scope="col" className="num">Institutions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.fee_category}>
                      <td>{getDisplayName(row.fee_category)}</td>
                      <td className="num">{money(row.median_amount)}</td>
                      <td className="num">{formatCount(row.institution_count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <figcaption className="mt-3 text-[13px] leading-5 text-ink-muted">
              {PRODUCT_NAME} · {summary.categoriesLabel} fee categories with published fees ·{" "}
              {summary.freshnessLabel}
            </figcaption>
          </figure>
        ) : null}
      </div>
    </section>
  );
}

/**
 * Brief 08 §B.7: every market. Only the national row is live today, so only the national
 * row is drawn; the other four layers wait for an approved example institution (08 §C.1).
 */
export function LandingEveryMarket({
  overdraft,
  summary,
}: {
  overdraft: RangeEntry | null;
  summary: PillarSummary;
}) {
  return (
    <section className="border-b border-border bg-surface-0">
      <div className={`${SECTION_INNER} grid gap-10 py-14 sm:py-16 lg:grid-cols-2 lg:items-center`}>
        <div className="min-w-0">
          <SectionHeading eyebrow="Every market" title="See each fee in five markets at once" />
          <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
            Each of your fees sits against your market (institutions with branches in your counties), your
            state, your Fed district, your peer group (same charter and asset size, nationwide) and the
            nation. You see the median, the middle half and who charges $0, and whether your fee is above,
            inside or below the range. A market with fewer than {MIN_INSTITUTIONS_FOR_MEDIAN} institutions
            is marked thin and gets no median.
          </p>
          <p className="mt-5 text-[14px]">
            <Link href="/reports" className={TEXT_LINK}>
              Read the free national and Fed district reports
            </Link>
          </p>
        </div>
        {overdraft ? (
          <div className="min-w-0 rounded-lg border border-border bg-paper p-5 sm:p-6">
            <NationalRange row={overdraft} label="The nation" freshnessLabel={summary.freshnessLabel} />
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** Brief 08 §B.8: one workspace, then James's funnel (plans, one report, or a demo). */
export function LandingOneWorkspace() {
  return (
    <section className="border-b border-border bg-paper">
      <div className={`${SECTION_INNER} py-14 sm:py-16`}>
        <div className="max-w-3xl">
          <SectionHeading eyebrow="One workspace" title="Ask, compare and take a report to committee" />
          <p className="mt-4 text-[16px] leading-relaxed text-ink-soft">
            Hamilton, the {SITE_NAME} Pro workspace, puts the index and the markets in one place. Ask
            Hamilton a question and each answer cites its source. Add the findings you want to keep, and
            Hamilton writes a sourced report, such as a Peer Brief or a Competitive Positioning report. Try
            a price shows any amount side by side, including $0, before you decide. Hamilton shows the
            position and the options; the decision stays with your institution.
          </p>
          <ul className="mt-5 flex flex-wrap items-center gap-2" aria-label="Hamilton tabs">
            {HAMILTON_MODES.map((mode) => (
              <li key={mode}>
                <Tag>{mode}</Tag>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[13px] text-ink-muted">Ask Hamilton on every screen.</p>

          <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">
            <Link href="/subscribe" className="fi-btn fi-btn-secondary">
              See Hamilton plans
            </Link>
            <Link href="/contact?source=demo" className={`text-[14px] ${TEXT_LINK}`}>
              Or ask for a demo
            </Link>
          </div>
          <p className="mt-5 text-[14px] leading-6 text-ink-soft">
            Prefer one document? We build a{" "}
            <Link href={REPORT_REQUEST_HREF} className={TEXT_LINK}>
              {REPORT_OFFER.name}
            </Link>{" "}
            for your institution, {REPORT_PRICE_INLINE}.
          </p>
        </div>
      </div>
    </section>
  );
}
