export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import { formatAbsoluteDate } from "@/lib/public-stats";
import { notFound } from "next/navigation";
import { GUIDES, getGuide } from "@/lib/guides";
import {
  getFeeCategorySummaries,
  getFeeCategoryDetail,
  getDataFreshness,
  getPublicStats,
} from "@/lib/data-store";
import { getDisplayName, TAXONOMY_COUNT } from "@/lib/fee-taxonomy";
import { formatAmount } from "@/lib/format";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { DistributionChart } from "@/components/public/distribution-chart";
import { SITE_URL } from "@/lib/constants";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return GUIDES.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const guide = getGuide(slug);
  if (!guide) return { title: "Guide Not Found" };

  return {
    title: guide.title,
    description: guide.description,
    keywords: guide.feeCategories.map((c) => `${getDisplayName(c)} guide`),
  };
}

export default async function GuidePage({ params }: PageProps) {
  const { slug } = await params;
  const guide = getGuide(slug);
  if (!guide) notFound();

  const allSummaries = await getFeeCategorySummaries();
  const relevantFees = allSummaries.filter((s) =>
    guide.feeCategories.includes(s.fee_category)
  );

  const freshness = await getDataFreshness();
  const stats = await getPublicStats();

  const primaryCategory = guide.feeCategories[0];
  const primaryDetail = await getFeeCategoryDetail(primaryCategory);
  const primaryAmounts = primaryDetail.institution_values;
  const primarySummary = relevantFees.find(
    (f) => f.fee_category === primaryCategory
  );

  // One row per institution (its lowest listed amount), so a bank with several
  // rows can't fill a list, and the two lists never overlap.
  const lowestByInstitution = new Map<number, (typeof primaryDetail.fees)[number]>();
  for (const f of primaryDetail.fees) {
    if (f.amount === null || f.amount < 0) continue;
    const current = lowestByInstitution.get(f.institution_id);
    if (!current || f.amount < (current.amount ?? Infinity)) lowestByInstitution.set(f.institution_id, f);
  }
  const sortedFees = [...lowestByInstitution.values()].sort((a, b) => (a.amount ?? 0) - (b.amount ?? 0));
  const cheapest = sortedFees.slice(0, 5);
  const mostExpensive = sortedFees.slice(Math.max(cheapest.length, sortedFees.length - 5)).reverse();
  const zeroFeeCount = sortedFees.filter((f) => f.amount === 0).length;

  return (
    <div className="mx-auto max-w-7xl px-6 py-14">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Guides", href: "/guides" },
          { name: guide.title.split(":")[0], href: `/guides/${slug}` },
        ]}
      />

      {/* ── Breadcrumb — sticky on mobile ── */}
      <nav className="flex items-center gap-2 text-[12px] text-[#6B6255] mb-8 sticky top-14 z-30 -mx-6 px-6 py-2 bg-[#FAF7F2]/95 backdrop-blur-sm sm:static sm:mx-0 sm:px-0 sm:py-0 sm:bg-transparent sm:backdrop-blur-none">
        <Link href="/" className="hover:text-[#1A1815] transition-colors">
          Home
        </Link>
        <span className="text-[#D4C9BA]">/</span>
        <Link href="/guides" className="hover:text-[#1A1815] transition-colors">
          Guides
        </Link>
        <span className="text-[#D4C9BA]">/</span>
        <span className="text-[#5A5347] truncate">{guide.title.split(":")[0]}</span>
      </nav>

      {/* ── HERO ── */}
      <div className="max-w-3xl">
        <div className="flex items-center gap-2 mb-4">
          <span className="h-px w-8 bg-[#C44B2E]/40" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#A93D25]/60">
            Consumer Guide
          </span>
        </div>

        <h1
          className="text-[1.75rem] sm:text-[2.25rem] leading-[1.12] tracking-[-0.02em] text-[#1A1815]"
          style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
        >
          {guide.title.split(":")[0]}
        </h1>

        <p className="mt-4 text-[15px] leading-relaxed text-[#6B6255]">
          {guide.description}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[#6B6255]">
          <span>
            Data from{" "}
            <span className="font-medium text-[#5A5347] tabular-nums">
              {stats.total_institutions.toLocaleString()}
            </span>{" "}
            institutions
          </span>
          {freshness.last_crawl_at && (
            <>
              <span className="h-3 w-px bg-[#D4C9BA]" />
              <span>
                Updated{" "}
                {formatAbsoluteDate(freshness.last_crawl_at)}
              </span>
            </>
          )}
        </div>
      </div>

      {/* ── LIVE DATA CARDS ── */}
      {relevantFees.length > 0 && (
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {relevantFees.slice(0, 4).map((fee, i) => (
            <Link
              key={fee.fee_category}
              href={`/fees/${fee.fee_category}`}
              className="group relative rounded-xl border border-[#E8DFD1]/80 bg-white/70 backdrop-blur-sm px-5 py-4 transition-all duration-400 hover:border-[#C44B2E]/20 hover:shadow-md hover:shadow-[#C44B2E]/5 no-underline overflow-hidden"
            >
              <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#C44B2E]/0 to-transparent group-hover:via-[#C44B2E]/30 transition-all duration-700" />
              <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#6B6255] group-hover:text-[#A93D25]/70 transition-colors">
                {getDisplayName(fee.fee_category)}
              </p>
              <p
                className="mt-2 text-[28px] font-light tracking-tight text-[#1A1815] tabular-nums"
                style={{
                  fontFamily: "var(--font-newsreader), Georgia, serif",
                }}
              >
                {formatAmount(fee.median_amount)}
                <span className="ml-2 text-[11px] font-sans font-normal text-[#6B6255]">
                  median
                </span>
              </p>
              <p className="mt-1 text-[11px] tabular-nums text-[#6B6255]">
                {formatAmount(fee.min_amount)} &ndash;{" "}
                {formatAmount(fee.max_amount)}
                <span className="mx-1.5 text-[#D4C9BA]">&middot;</span>
                {fee.institution_count.toLocaleString()} institutions
              </p>
            </Link>
          ))}
        </div>
      )}

      {/* ── ACTION LINKS ── */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Link
          href="/fees"
          className="inline-flex items-center gap-1.5 rounded-full border border-[#E8DFD1] bg-white/80 px-4 py-2 text-[12px] font-medium text-[#5A5347] transition-all hover:border-[#C44B2E]/30 hover:text-[#A93D25] no-underline"
        >
          View full fee index
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </Link>
        {relevantFees[0] && (
          <Link
            href={`/fees/${relevantFees[0].fee_category}`}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#C44B2E] px-4 py-2 text-[12px] font-medium text-white shadow-sm shadow-[#C44B2E]/15 transition-all hover:shadow-md hover:shadow-[#C44B2E]/25 no-underline"
          >
            {getDisplayName(relevantFees[0].fee_category)} analysis
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </Link>
        )}
      </div>

      {/* ── MAIN + SIDEBAR ── */}
      <div className="mt-12 grid grid-cols-1 gap-10 xl:grid-cols-[1fr_300px]">
        {/* Main column */}
        <div>
          {/* ── Distribution chart ── */}
          {primaryAmounts.length >= 5 && primarySummary && (
            <section className="mb-12">
              <h2
                className="text-[18px] font-medium tracking-[-0.01em] text-[#1A1815]"
                style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
              >
                {getDisplayName(primaryCategory)} Fee Distribution
              </h2>
              <p className="mt-1.5 text-[13px] text-[#6B6255]">
                How {primaryAmounts.length.toLocaleString()} institutions price
                this fee. National median:{" "}
                <span className="font-medium text-[#1A1815]">
                  {formatAmount(primarySummary.median_amount)}
                </span>
              </p>
              <div className="mt-4 rounded-xl border border-[#E8DFD1]/80 bg-white/70 backdrop-blur-sm p-5">
                <DistributionChart
                  amounts={primaryAmounts}
                  median={primarySummary.median_amount}
                  bucketCount={16}
                />
              </div>
              <div className="mt-2.5 flex justify-end">
                <Link
                  href={`/fees/${primaryCategory}`}
                  className="text-[12px] font-medium text-[#A93D25]/70 hover:text-[#A93D25] transition-colors"
                >
                  Full analysis with breakdowns &rarr;
                </Link>
              </div>
            </section>
          )}

          {/* ── Guide sections ── */}
          <div className="space-y-10">
            {guide.sections.map((section, i) => (
              <section key={i} id={`section-${i}`} className="scroll-mt-20">
                <h2
                  className="text-[20px] font-medium tracking-[-0.01em] text-[#1A1815] mb-3"
                  style={{
                    fontFamily: "var(--font-newsreader), Georgia, serif",
                  }}
                >
                  {section.heading}
                </h2>
                <p className="text-[15px] leading-[1.85] text-[#5A5347]">
                  {section.content}
                </p>
                {i < guide.sections.length - 1 && (
                  <div className="mt-10 h-px bg-gradient-to-r from-[#E8DFD1] via-[#E8DFD1]/40 to-transparent" />
                )}
              </section>
            ))}
          </div>

          {/* ── Explore the Data ── */}
          <section className="mt-14">
            <div className="flex items-center gap-3 mb-5">
              <h2
                className="text-[16px] font-medium text-[#1A1815]"
                style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
              >
                Explore the Data
              </h2>
              <span className="h-px flex-1 bg-[#E8DFD1]" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {relevantFees.map((fee) => (
                <Link
                  key={`deep-${fee.fee_category}`}
                  href={`/fees/${fee.fee_category}`}
                  className="group flex items-center gap-3.5 rounded-xl border border-[#E8DFD1]/80 bg-white/70 px-5 py-4 transition-all duration-300 hover:border-[#C44B2E]/20 hover:shadow-md hover:shadow-[#C44B2E]/5 no-underline"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#C44B2E]/8 text-[#C44B2E]">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                    </svg>
                  </div>
                  <div>
                    <span className="text-[13px] font-medium text-[#1A1815] group-hover:text-[#A93D25] transition-colors">
                      {getDisplayName(fee.fee_category)} Deep Dive
                    </span>
                    <span className="block text-[11px] text-[#6B6255]">
                      Distribution, breakdowns by charter, state, tier
                    </span>
                  </div>
                </Link>
              ))}
              <Link
                href="/research/national-fee-index"
                className="group flex items-center gap-3.5 rounded-xl border border-[#E8DFD1]/80 bg-white/70 px-5 py-4 transition-all duration-300 hover:border-[#C44B2E]/20 hover:shadow-md hover:shadow-[#C44B2E]/5 no-underline"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/8 text-emerald-600">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
                  </svg>
                </div>
                <div>
                  <span className="text-[13px] font-medium text-[#1A1815] group-hover:text-[#A93D25] transition-colors">
                    National Fee Index
                  </span>
                  <span className="block text-[11px] text-[#6B6255]">
                    All {TAXONOMY_COUNT} fee categories benchmarked
                  </span>
                </div>
              </Link>
              <Link
                href="/research"
                className="group flex items-center gap-3.5 rounded-xl border border-[#E8DFD1]/80 bg-white/70 px-5 py-4 transition-all duration-300 hover:border-[#C44B2E]/20 hover:shadow-md hover:shadow-[#C44B2E]/5 no-underline"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/8 text-violet-600">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" />
                  </svg>
                </div>
                <div>
                  <span className="text-[13px] font-medium text-[#1A1815] group-hover:text-[#A93D25] transition-colors">
                    State & District Reports
                  </span>
                  <span className="block text-[11px] text-[#6B6255]">
                    Fee analysis by geography
                  </span>
                </div>
              </Link>
            </div>
          </section>

          {/* ── More Guides ── */}
          <section className="mt-14">
            <div className="flex items-center gap-3 mb-5">
              <h2
                className="text-[16px] font-medium text-[#1A1815]"
                style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
              >
                More Guides
              </h2>
              <span className="h-px flex-1 bg-[#E8DFD1]" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {GUIDES.filter((g) => g.slug !== slug).map((g) => (
                <Link
                  key={g.slug}
                  href={`/guides/${g.slug}`}
                  className="group rounded-xl border border-[#E8DFD1]/80 bg-white/70 px-5 py-4 transition-all duration-300 hover:border-[#C44B2E]/20 hover:shadow-md hover:shadow-[#C44B2E]/5 no-underline"
                >
                  <span
                    className="text-[14px] font-medium text-[#1A1815] group-hover:text-[#A93D25] transition-colors"
                    style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
                  >
                    {g.title.split(":")[0]}
                  </span>
                  <span className="mt-1 block text-[12px] text-[#6B6255] line-clamp-2">
                    {g.description}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        </div>

        {/* ── SIDEBAR ── */}
        <aside className="space-y-5 xl:sticky xl:top-20 xl:self-start">
          {/* Live benchmarks */}
          {relevantFees.length > 0 && (
            <div className="rounded-xl border border-[#E8DFD1] bg-white/80 backdrop-blur-sm px-5 py-5 overflow-hidden relative">
              <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#C44B2E]/30 to-transparent" />
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#A93D25]/60">
                Live National Benchmarks
              </p>
              <div className="mt-4 space-y-4">
                {relevantFees.map((fee) => (
                  <div
                    key={fee.fee_category}
                    className="border-b border-[#E8DFD1]/60 pb-3.5 last:border-0 last:pb-0"
                  >
                    <Link
                      href={`/fees/${fee.fee_category}`}
                      className="text-[13px] font-medium text-[#1A1815] hover:text-[#A93D25] transition-colors"
                      style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
                    >
                      {getDisplayName(fee.fee_category)}
                    </Link>
                    <div className="mt-1.5 flex items-baseline gap-2">
                      <span
                        className="text-[22px] font-light tracking-tight text-[#1A1815] tabular-nums"
                        style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
                      >
                        {formatAmount(fee.median_amount)}
                      </span>
                      <span className="text-[10px] text-[#6B6255]">median</span>
                    </div>
                    <div className="mt-1 text-[11px] tabular-nums text-[#6B6255]">
                      P25: {formatAmount(fee.p25_amount)} &middot; P75:{" "}
                      {formatAmount(fee.p75_amount)}
                    </div>
                    <div className="mt-2 flex gap-1.5">
                      <Link
                        href={`/fees/${fee.fee_category}`}
                        className="rounded-full bg-[#FAF7F2] border border-[#E8DFD1]/60 px-2.5 py-0.5 text-[10px] font-medium text-[#6B6255] hover:border-[#C44B2E]/30 hover:text-[#A93D25] transition-colors no-underline"
                      >
                        Distribution
                      </Link>
                      <Link
                        href={`/fees/${fee.fee_category}`}
                        className="rounded-full bg-[#FAF7F2] border border-[#E8DFD1]/60 px-2.5 py-0.5 text-[10px] font-medium text-[#6B6255] hover:border-[#C44B2E]/30 hover:text-[#A93D25] transition-colors no-underline"
                      >
                        By state
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Cheapest institutions */}
          {cheapest.length > 0 && (
            <div className="rounded-xl border border-emerald-200/60 bg-emerald-50/20 px-5 py-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-emerald-600/80">
                Lowest {getDisplayName(primaryCategory)} Fees
              </p>
              {zeroFeeCount > 0 && (
                <p className="mt-1.5 text-[12px] text-emerald-700">
                  {zeroFeeCount} institution{zeroFeeCount !== 1 ? "s" : ""} charge{zeroFeeCount === 1 ? "s" : ""}{" "}
                  <span className="font-bold">$0</span>
                </p>
              )}
              <div className="mt-3 space-y-1.5">
                {cheapest.map((f, i) => (
                  <div
                    key={f.id}
                    className="flex items-center justify-between text-[12px]"
                  >
                    <span className="text-[#5A5347] truncate mr-2">
                      <span className="text-[#6B6255] tabular-nums mr-1">
                        {i + 1}.
                      </span>
                      {f.institution_name}
                    </span>
                    <span className="tabular-nums font-semibold text-emerald-700 shrink-0">
                      {formatAmount(f.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Most expensive */}
          {mostExpensive.length > 0 && (
            <div className="rounded-xl border border-red-200/60 bg-red-50/20 px-5 py-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-red-500/80">
                Highest {getDisplayName(primaryCategory)} Fees
              </p>
              <div className="mt-3 space-y-1.5">
                {mostExpensive.map((f, i) => (
                  <div
                    key={f.id}
                    className="flex items-center justify-between text-[12px]"
                  >
                    <span className="text-[#5A5347] truncate mr-2">
                      <span className="text-[#6B6255] tabular-nums mr-1">
                        {i + 1}.
                      </span>
                      {f.institution_name}
                    </span>
                    <span className="tabular-nums font-semibold text-red-600 shrink-0">
                      {formatAmount(f.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quick nav */}
          <div className="rounded-xl border border-[#E8DFD1] bg-white/80 px-5 py-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#6B6255]">
              In This Guide
            </p>
            <nav className="mt-3 space-y-2">
              {guide.sections.map((section, i) => (
                <a
                  key={i}
                  href={`#section-${i}`}
                  className="flex items-center gap-2 text-[13px] text-[#6B6255] hover:text-[#A93D25] transition-colors"
                >
                  <span className="h-1 w-1 rounded-full bg-[#D4C9BA] shrink-0" />
                  {section.heading}
                </a>
              ))}
            </nav>
          </div>

          {/* CTA */}
          <div className="rounded-xl border border-[#1A1815] bg-[#1A1815] px-5 py-6 text-center overflow-hidden relative">
            <div className="absolute inset-0 opacity-[0.04]" style={{
              backgroundImage: "linear-gradient(rgba(255,255,255,.3) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.3) 1px, transparent 1px)",
              backgroundSize: "24px 24px",
            }} />
            <div className="relative">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#A09788]">
                For Professionals
              </p>
              <p
                className="mt-2.5 text-[16px] font-medium text-white"
                style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
              >
                Need deeper analysis?
              </p>
              <p className="mt-1.5 text-[12px] text-[#6B6255]">
                API access, custom datasets, and research reports.
              </p>
              <Link
                href="/api-docs"
                className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white px-5 py-2 text-[12px] font-semibold text-[#1A1815] transition-all hover:shadow-md no-underline"
              >
                View API docs
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
          </div>
        </aside>
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Article",
            headline: guide.title,
            description: guide.description,
            url: `${SITE_URL}/guides/${slug}`,
            mainEntity: {
              "@type": "FAQPage",
              mainEntity: guide.sections.map((s) => ({
                "@type": "Question",
                name: s.heading,
                acceptedAnswer: {
                  "@type": "Answer",
                  text: s.content,
                },
              })),
            },
          }).replace(/</g, "\\u003c"),
        }}
      />
    </div>
  );
}
