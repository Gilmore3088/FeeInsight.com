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
import { MemoHeader, MemoPage, SERIF } from "@/components/hamilton/memo/memo";

export const metadata: Metadata = {
  title: "Fee categories",
};

/** Tier badges in the memo palette: terracotta for the spotlight fees, warm neutrals below. */
const TIER_BADGES: Record<string, { label: string; className: string }> = {
  spotlight: {
    label: "Spotlight",
    className: "border-terra/30 bg-terra-soft text-terra-text",
  },
  core: {
    label: "Core",
    className: "border-warm-400 bg-warm-150 text-warm-800",
  },
  extended: {
    label: "Extended",
    className: "border-warm-300 bg-warm-50 text-warm-700",
  },
  comprehensive: {
    label: "Comprehensive",
    className: "border-warm-200 bg-warm-50 text-warm-600",
  },
};

/** My fees for one fee category. */
function myFeesHref(category: string): string {
  return `/pro/research?fee=${encodeURIComponent(category)}`;
}

export default async function ProCategoriesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?from=/pro/categories");
  if (!canAccessPremium(user)) redirect("/subscribe?from=/pro/categories");

  const summaries = await getCachedFeeCategorySummaries();
  const summaryMap = new Map(summaries.map((s) => [s.fee_category, s]));
  const familyNames = Object.keys(FEE_FAMILIES);

  return (
    <MemoPage>
      <MemoHeader
        kicker="Reference"
        title="Fee categories"
        dek={
          <>
            All {TAXONOMY_COUNT} fee categories in {familyNames.length} families, each with its national median and
            how many institutions publish it. Open one to see it in My fees.
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {familyNames.map((family) => {
          const categories = FEE_FAMILIES[family];
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
            <section key={family} className="flex flex-col rounded-lg border border-warm-300 bg-warm-50 p-5">
              <h2 className="text-xl text-warm-900" style={SERIF}>
                {family}
              </h2>
              <dl className="mt-3 grid grid-cols-3 gap-3 border-b border-warm-200 pb-4">
                <div className="min-w-0">
                  <dt className="text-xs font-medium uppercase tracking-[0.08em] text-warm-600">Categories</dt>
                  <dd className="mt-0.5 text-lg text-warm-900 [font-variant-numeric:tabular-nums]" style={SERIF}>
                    {categories.length}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs font-medium uppercase tracking-[0.08em] text-warm-600">Fees on file</dt>
                  <dd className="mt-0.5 text-lg text-warm-900 [font-variant-numeric:tabular-nums]" style={SERIF}>
                    {familyObservations.toLocaleString()}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs font-medium uppercase tracking-[0.08em] text-warm-600">With a median</dt>
                  <dd className="mt-0.5 text-lg text-warm-900 [font-variant-numeric:tabular-nums]" style={SERIF}>
                    {withData} of {categories.length}
                  </dd>
                </div>
              </dl>

              <ul className="mt-2 flex flex-col">
                {categories.map((cat) => {
                  const s = summaryMap.get(cat);
                  const tierInfo = TIER_BADGES[getFeeTier(cat)];

                  return (
                    <li key={cat}>
                      <Link
                        href={myFeesHref(cat)}
                        className="group -mx-2 flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-0.5 rounded-md px-2 py-2 text-sm no-underline hover:bg-warm-150"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="text-warm-900 group-hover:text-terra-text">{getDisplayName(cat)}</span>
                          {tierInfo ? (
                            <span className={`shrink-0 rounded border px-1.5 py-px text-xs ${tierInfo.className}`}>
                              {tierInfo.label}
                            </span>
                          ) : null}
                        </span>
                        <span className="shrink-0 text-xs text-warm-600 [font-variant-numeric:tabular-nums]">
                          {s?.median_amount != null ? (
                            <>
                              <span className="text-sm text-warm-900">{formatAmount(s.median_amount)}</span> ·{" "}
                              {s.institution_count.toLocaleString()} institutions
                            </>
                          ) : (
                            "Fewer than 5 institutions publish it"
                          )}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </MemoPage>
  );
}
