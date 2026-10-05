export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { getCachedFeeCategorySummaries } from "@/lib/data-store/fee-cache";
import {
  getDisplayName,
  getFeeTier,
  FEE_FAMILIES,
  TAXONOMY_COUNT,
} from "@/lib/fee-taxonomy";
import { formatAmount } from "@/lib/format";

export const metadata: Metadata = {
  title: "Fee Categories",
};

const TIER_BADGES: Record<string, { label: string; className: string }> = {
  spotlight: {
    label: "Spotlight",
    className: "bg-amber-50 text-amber-700 border border-amber-200",
  },
  core: {
    label: "Core",
    className: "bg-blue-50 text-blue-700 border border-blue-200",
  },
  extended: {
    label: "Extended",
    className: "bg-gray-50 text-gray-500 border border-gray-200",
  },
  comprehensive: {
    label: "Comp.",
    className: "bg-gray-50 text-gray-400 border border-gray-100",
  },
};

const FAMILY_DOT_COLORS: Record<string, string> = {
  "Account Maintenance": "#3B82F6",
  "Overdraft & NSF": "#EF4444",
  "ATM & Card": "#F59E0B",
  "Wire Transfers": "#8B5CF6",
  "Check Services": "#64748B",
  "Digital & Electronic": "#06B6D4",
  "Cash & Deposit": "#10B981",
  "Account Services": "#6366F1",
  "Lending Fees": "#F97316",
};

export default async function ProCategoriesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?from=/pro/categories");
  if (!canAccessPremium(user)) redirect("/subscribe?from=/pro/categories");

  const summaries = await getCachedFeeCategorySummaries();
  const summaryMap = new Map(summaries.map((s) => [s.fee_category, s]));
  const familyNames = Object.keys(FEE_FAMILIES);

  return (
    <div>
    <div className="mx-auto max-w-7xl px-6 py-10">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <span className="h-px w-8 bg-terra/40" />
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-terra/60">
          Fee Categories
        </span>
      </div>

      <h1
        className="text-[2rem] leading-[1.1] tracking-[-0.02em] text-warm-900"
        style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
      >
        Complete Fee Taxonomy
      </h1>
      <p className="mt-3 max-w-lg text-[14px] leading-relaxed text-warm-600">
        All {TAXONOMY_COUNT} fee categories across {familyNames.length} families,
        with statistical distributions and institutional coverage.
      </p>

      {/* Family grid — matches districts card layout */}
      <div className="mt-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {familyNames.map((family) => {
          const categories = FEE_FAMILIES[family];
          const dotColor = FAMILY_DOT_COLORS[family] ?? "#9CA3AF";
          const familyStats = categories
            .map((cat) => summaryMap.get(cat))
            .filter(Boolean);
          const familyObservations = familyStats.reduce(
            (acc, s) => acc + (s?.total_observations ?? 0),
            0
          );
          const withData = familyStats.filter(
            (s) => s && s.median_amount !== null
          ).length;

          return (
            <div
              key={family}
              className="rounded-xl border border-warm-200/80 bg-white/70 backdrop-blur-sm p-5"
            >
              {/* Family header */}
              <div className="flex items-center gap-3 mb-4">
                <span
                  className="flex items-center justify-center h-8 w-8 rounded-lg"
                  style={{ backgroundColor: `${dotColor}15` }}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: dotColor }}
                  />
                </span>
                <h2
                  className="text-[15px] font-semibold text-warm-900"
                  style={{
                    fontFamily: "var(--font-newsreader), Georgia, serif",
                  }}
                >
                  {family}
                </h2>
              </div>

              {/* Metrics row */}
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-warm-500">
                    Categories
                  </p>
                  <p
                    className="mt-0.5 text-lg font-light text-warm-900 tabular-nums"
                    style={{
                      fontFamily: "var(--font-newsreader), Georgia, serif",
                    }}
                  >
                    {categories.length}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-warm-500">
                    Observations
                  </p>
                  <p
                    className="mt-0.5 text-lg font-light text-warm-900 tabular-nums"
                    style={{
                      fontFamily: "var(--font-newsreader), Georgia, serif",
                    }}
                  >
                    {familyObservations.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-warm-500">
                    Coverage
                  </p>
                  <p
                    className="mt-0.5 text-lg font-light text-warm-900 tabular-nums"
                    style={{
                      fontFamily: "var(--font-newsreader), Georgia, serif",
                    }}
                  >
                    {withData}/{categories.length}
                  </p>
                </div>
              </div>

              {/* Category list */}
              <div className="pt-3 border-t border-warm-200/40 space-y-1">
                {categories.map((cat) => {
                  const s = summaryMap.get(cat);
                  const tier = getFeeTier(cat);
                  const tierInfo = TIER_BADGES[tier];

                  return (
                    <Link
                      key={cat}
                      href={`/pro/simulate?category=${cat}`}
                      className="flex items-center justify-between rounded-lg px-2.5 py-1.5 -mx-1 hover:bg-warm-100/80 transition-colors no-underline group"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[12px] text-warm-900 group-hover:text-terra transition-colors truncate">
                          {getDisplayName(cat)}
                        </span>
                        {tierInfo && (
                          <span
                            className={`shrink-0 px-1 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${tierInfo.className}`}
                          >
                            {tierInfo.label}
                          </span>
                        )}
                      </div>
                      <span className="shrink-0 ml-2 text-[11px] tabular-nums text-warm-500">
                        {s?.median_amount != null
                          ? `${formatAmount(s.median_amount)} · n=${s.institution_count}`
                          : <span title="Fewer than 5 institutions publish this fee">Too few</span>}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
    </div>
  );
}
