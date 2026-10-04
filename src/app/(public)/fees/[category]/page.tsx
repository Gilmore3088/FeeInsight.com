export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getFeeCategoryDetail,
  getDataFreshness,
} from "@/lib/data-store";
import { computeStats } from "@/lib/data-store";
import {
  getDisplayName,
  getFeeFamily,
  getFamilyColor,
  getFeeTier,
  FEE_FAMILIES,
  DISPLAY_NAMES,
} from "@/lib/fee-taxonomy";
import { DISTRICT_NAMES, FDIC_TIER_LABELS } from "@/lib/fed-districts";
import { formatFeeAmount } from "@/lib/format";
import { BreadcrumbJsonLd } from "@/components/breadcrumb-jsonld";
import { DataFreshness } from "@/components/data-freshness";
import { DistributionChart } from "@/components/public/distribution-chart";
import { STATE_NAMES } from "@/lib/us-states";
import { SITE_NAME, SITE_URL } from "@/lib/constants";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { UpgradeGate } from "@/components/upgrade-gate";

interface PageProps {
  params: Promise<{ category: string }>;
}

const EYEBROW = "text-[11px] font-bold uppercase tracking-[0.12em] text-[#6B6255]";
const SERIF = { fontFamily: "var(--font-newsreader), Georgia, serif" };

/** Thousands-separated dollars ("$5,000", "$2.50"); "-" when unavailable. */
const money = (value: number | null | undefined) => formatFeeAmount(value) ?? "-";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { category } = await params;
  const name = getDisplayName(category);
  const family = getFeeFamily(category);

  return {
    title: `${name} Fee - National Benchmarks & Analysis`,
    description: `National benchmarking data for ${name.toLowerCase()} fees. See median, P25/P75, distribution, and breakdowns by bank vs. credit union, asset tier, Fed district, and state.`,
    openGraph: {
      title: `${name} Fee Benchmarks`,
      description: `How much do banks charge for ${name.toLowerCase()}? National median, distribution, and peer comparisons.`,
    },
    keywords: [
      `${name.toLowerCase()} fee`,
      `average ${name.toLowerCase()} fee`,
      `bank ${name.toLowerCase()} fee`,
      family ? `${family.toLowerCase()} fees` : "bank fees",
    ],
  };
}

export async function generateStaticParams() {
  const { hasData } = await import("@/lib/data-store/connection");
  if (!(await hasData())) return [];
  return Object.keys(DISPLAY_NAMES).map((category) => ({ category }));
}

function WarmTable({
  headers,
  children,
  minWidth = "min-w-[560px]",
}: {
  headers: string[];
  children: React.ReactNode;
  minWidth?: string;
}) {
  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-[#E8DFD1]/80 bg-white/70 backdrop-blur-sm">
      <div className="table-scroll">
        <table className={`w-full text-left text-sm ${minWidth}`}>
          <thead>
            <tr className="border-b border-[#E8DFD1]/60 bg-[#FAF7F2]/60">
              {headers.map((h, i) => (
                <th
                  key={h}
                  scope="col"
                  className={`px-4 py-2.5 ${EYEBROW} ${i > 0 ? "text-right" : ""}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E8DFD1]/40">{children}</tbody>
        </table>
      </div>
    </div>
  );
}

export default async function FeeCategoryPage({ params }: PageProps) {
  const { category } = await params;

  if (!DISPLAY_NAMES[category]) {
    notFound();
  }

  const user = await getCurrentUser();
  const isPro = canAccessPremium(user);

  const name = getDisplayName(category);
  const family = getFeeFamily(category);
  const familyColor = family ? getFamilyColor(family) : null;
  const tier = getFeeTier(category);
  const detail = await getFeeCategoryDetail(category);
  const freshness = await getDataFreshness();

  // N and M share one basis: verified fees with a stated amount, and the
  // distinct institutions those fees came from.
  const pricedFees = detail.fees.filter((f) => f.amount !== null && f.amount > 0);
  const amounts = pricedFees.map((f) => f.amount!);
  const verifiedFeeCount = amounts.length;
  const institutionCount = new Set(pricedFees.map((f) => f.institution_id)).size;
  const stats = computeStats(amounts);

  const familyMembers = family
    ? (FEE_FAMILIES[family] ?? []).filter((c) => c !== category)
    : [];

  return (
    <div className="mx-auto max-w-7xl px-6 py-14">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", href: "/" },
          { name: "Fee Index", href: "/fees" },
          { name: name, href: `/fees/${category}` },
        ]}
      />

      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-[12px] text-[#6B6255] mb-6">
        <Link href="/" className="hover:text-[#1A1815] transition-colors">
          Home
        </Link>
        <span className="text-[#D4C9BA]">/</span>
        <Link href="/fees" className="hover:text-[#1A1815] transition-colors">
          Fee Index
        </Link>
        <span className="text-[#D4C9BA]">/</span>
        <span className="text-[#5A5347]">{name}</span>
      </nav>

      {/* Header */}
      <div className="flex items-center gap-2">
        {family && familyColor && (
          <span
            className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] ${familyColor.bg} ${familyColor.text}`}
          >
            {family}
          </span>
        )}
        <span className="rounded-full bg-[#E8DFD1]/40 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[#6B6255]">
          {tier}
        </span>
      </div>

      <h1
        className="mt-3 text-[1.75rem] sm:text-[2.25rem] leading-[1.12] tracking-[-0.02em] text-[#1A1815]"
        style={SERIF}
      >
        {name} Fee
      </h1>
      <p className="mt-2 text-[14px] text-[#6B6255]">
        Based on {verifiedFeeCount.toLocaleString()} verified fees from{" "}
        {institutionCount.toLocaleString()} institutions.
      </p>
      <div className="mt-1">
        <DataFreshness />
      </div>

      {/* Stat cards */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Median", value: money(stats.median) },
          { label: "25th Percentile", value: money(stats.p25) },
          { label: "75th Percentile", value: money(stats.p75) },
          {
            label: "Range",
            value: `${money(stats.min)} \u2013 ${money(stats.max)}`,
          },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-[#E8DFD1]/80 bg-white/70 backdrop-blur-sm px-4 py-3.5"
          >
            <p className={EYEBROW}>
              {s.label}
            </p>
            <p
              className="mt-1 text-[22px] font-light tabular-nums text-[#1A1815]"
              style={SERIF}
            >
              {s.value}
            </p>
          </div>
        ))}
      </div>

      {/* Distribution */}
      <section className="mt-10">
        <h2
          className="text-[16px] font-medium text-[#1A1815]"
          style={SERIF}
        >
          Fee Distribution
        </h2>
        <div className="mt-3 rounded-xl border border-[#E8DFD1]/80 bg-white/70 backdrop-blur-sm p-5">
          <DistributionChart
            amounts={amounts}
            median={stats.median}
          />
        </div>
      </section>

      {/* Premium gate */}
      {!isPro && (
        <div className="mt-8">
          <UpgradeGate message={`Detailed ${name} breakdown by charter, tier, and state`} />
        </div>
      )}

      {/* Bank vs. Credit Union */}
      {isPro && detail.by_charter_type.length > 0 && (
        <section className="mt-10">
          <h2
            className="text-[16px] font-medium text-[#1A1815]"
            style={SERIF}
          >
            Bank vs. Credit Union
          </h2>
          <WarmTable headers={["Type", "Median", "Range", "Count"]}>
            {detail.by_charter_type.map((row) => (
              <tr
                key={row.dimension_value}
                className="hover:bg-[#FAF7F2]/60 transition-colors"
              >
                <td className="px-4 py-2.5 font-medium text-[#1A1815]">
                  {row.dimension_value}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums font-medium text-[#1A1815]">
                  {money(row.median_amount)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-[#6B6255]">
                  {money(row.min_amount)} &ndash;{" "}
                  {money(row.max_amount)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-[#6B6255]">
                  {row.count.toLocaleString()}
                </td>
              </tr>
            ))}
          </WarmTable>
        </section>
      )}

      {/* Asset tier */}
      {isPro && detail.by_asset_tier.length > 0 && (
        <section className="mt-10">
          <h2
            className="text-[16px] font-medium text-[#1A1815]"
            style={SERIF}
          >
            By Asset Tier
          </h2>
          <WarmTable headers={["Tier", "Median", "Range", "Count"]}>
            {detail.by_asset_tier.map((row) => (
              <tr
                key={row.dimension_value}
                className="hover:bg-[#FAF7F2]/60 transition-colors"
              >
                <td className="px-4 py-2.5 font-medium text-[#1A1815]">
                  {FDIC_TIER_LABELS[row.dimension_value] ?? row.dimension_value}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums font-medium text-[#1A1815]">
                  {money(row.median_amount)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-[#6B6255]">
                  {money(row.min_amount)} &ndash;{" "}
                  {money(row.max_amount)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-[#6B6255]">
                  {row.count.toLocaleString()}
                </td>
              </tr>
            ))}
          </WarmTable>
        </section>
      )}

      {/* Fed district */}
      {detail.by_fed_district.length > 0 && (
        <section className="mt-10">
          <h2
            className="text-[16px] font-medium text-[#1A1815]"
            style={SERIF}
          >
            By Federal Reserve District
          </h2>
          <WarmTable headers={["District", "Median", "Range", "Count"]}>
            {detail.by_fed_district.map((row) => {
              const distNum = parseInt(
                row.dimension_value.replace("District ", "")
              );
              const distName =
                DISTRICT_NAMES[distNum] ?? row.dimension_value;
              return (
                <tr
                  key={row.dimension_value}
                  className="hover:bg-[#FAF7F2]/60 transition-colors"
                >
                  <td className="px-4 py-2.5 font-medium text-[#1A1815]">
                    {distName}{" "}
                    <span className="text-[#6B6255]">
                      ({row.dimension_value})
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium text-[#1A1815]">
                    {money(row.median_amount)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-[#6B6255]">
                    {money(row.min_amount)} &ndash;{" "}
                    {money(row.max_amount)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-[#6B6255]">
                    {row.count.toLocaleString()}
                  </td>
                </tr>
              );
            })}
          </WarmTable>
        </section>
      )}

      {/* State breakdown */}
      {isPro && detail.by_state.length > 0 && (
        <section className="mt-10">
          <h2
            className="text-[16px] font-medium text-[#1A1815]"
            style={SERIF}
          >
            By State
            <span className="ml-2 text-[12px] font-normal text-[#6B6255]">
              Top {detail.by_state.length} by observation count
            </span>
          </h2>
          <WarmTable headers={["State", "Median", "Avg", "Count"]}>
            {detail.by_state.map((row) => (
              <tr
                key={row.dimension_value}
                className="hover:bg-[#FAF7F2]/60 transition-colors"
              >
                <td className="px-4 py-2.5 font-medium text-[#1A1815]">
                  {STATE_NAMES[row.dimension_value] ?? row.dimension_value}
                  <span className="ml-1.5 text-[#6B6255]">
                    ({row.dimension_value})
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums font-medium text-[#1A1815]">
                  {money(row.median_amount)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-[#6B6255]">
                  {money(row.avg_amount)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-[#6B6255]">
                  {row.count.toLocaleString()}
                </td>
              </tr>
            ))}
          </WarmTable>
        </section>
      )}

      {/* Related fees */}
      {familyMembers.length > 0 && (
        <section className="mt-10">
          <div className="flex items-center gap-3 mb-4">
            <h2
              className="text-[16px] font-medium text-[#1A1815]"
              style={SERIF}
            >
              Related Fees in {family}
            </h2>
            <span className="h-px flex-1 bg-[#E8DFD1]" />
          </div>
          <div className="flex flex-wrap gap-2">
            {familyMembers.map((cat) => (
              <Link
                key={cat}
                href={`/fees/${cat}`}
                className="rounded-full border border-[#E8DFD1] px-3.5 py-1.5 text-[12px] font-medium text-[#5A5347] hover:border-[#C44B2E]/30 hover:text-[#A93D25] transition-colors no-underline"
              >
                {getDisplayName(cat)}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Methodology */}
      <section className="mt-12 rounded-xl border border-[#E8DFD1] bg-[#FAF7F2]/50 p-6">
        <h3 className={EYEBROW}>
          Methodology
        </h3>
        <p className="mt-2 text-[13px] leading-relaxed text-[#6B6255]">
          Based on {verifiedFeeCount.toLocaleString()} verified fees from{" "}
          {institutionCount.toLocaleString()} US banks and credit unions, read from their published
          fee schedules. Fees the software is not sure about are held for a person to check and are
          not counted here. Institutions are identified via FDIC and NCUA regulatory databases.
        </p>
      </section>

      {/* JSON-LD */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Article",
            headline: `${name} Fee - National Benchmarks`,
            description: `National ${name.toLowerCase()} fee: median ${money(stats.median)}, based on ${verifiedFeeCount} verified fees from ${institutionCount} institutions.`,
            url: `${SITE_URL}/fees/${category}`,
            dateModified: freshness.last_crawl_at ?? undefined,
            publisher: {
              "@type": "Organization",
              name: SITE_NAME,
              url: SITE_URL,
            },
          }).replace(/</g, "\\u003c"),
        }}
      />
    </div>
  );
}
