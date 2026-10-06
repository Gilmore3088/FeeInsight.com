export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { searchInstitutions } from "@/lib/data-store/search";
import { getPublicStats, getDataFreshness } from "@/lib/data-store";
import { getStatesWithFeeData } from "@/lib/data-store";
import { FDIC_TIER_LABELS } from "@/lib/fed-districts";
import { STATE_NAMES } from "@/lib/us-states";
import { TAXONOMY_COUNT } from "@/lib/fee-taxonomy";

export const metadata: Metadata = {
  title: "Data Explorer",
};

interface PageProps {
  searchParams: Promise<{
    q?: string;
    state?: string;
    charter?: string;
    tier?: string;
    page?: string;
  }>;
}

export default async function ProDataPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const returnParams = new URLSearchParams();
  for (const key of ["q", "state", "charter", "tier", "page"] as const) {
    const value = params[key];
    if (value) returnParams.set(key, value);
  }
  const returnPath = returnParams.toString()
    ? `/pro/data?${returnParams.toString()}`
    : "/pro/data";

  const user = await getCurrentUser();
  if (!user) redirect(`/login?from=${encodeURIComponent(returnPath)}`);
  if (!canAccessPremium(user)) redirect(`/subscribe?from=${encodeURIComponent(returnPath)}`);

  const query = params.q || "";
  const stateCode = params.state || "";
  const charterType = params.charter || "";
  const page = parseInt(params.page || "1", 10);
  const pageSize = 50;

  const stats = await getPublicStats();
  const freshness = await getDataFreshness();
  const statesData = await getStatesWithFeeData();

  const results = await searchInstitutions({
    query: query || undefined,
    state_code: stateCode || undefined,
    charter_type: charterType || undefined,
    page,
    pageSize,
  });

  const totalPages = Math.ceil(results.total / pageSize);
  const lastUpdated = freshness.last_crawl_at
    ? new Date(freshness.last_crawl_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "---";

  function buildUrl(overrides: Record<string, string>) {
    const p = new URLSearchParams();
    if (overrides.q ?? query) p.set("q", overrides.q ?? query);
    if (overrides.state ?? stateCode) p.set("state", overrides.state ?? stateCode);
    if (overrides.charter ?? charterType) p.set("charter", overrides.charter ?? charterType);
    if (overrides.page) p.set("page", overrides.page);
    return `/pro/data?${p.toString()}`;
  }

  return (
    <div>
    <div className="mx-auto max-w-7xl px-6 py-14">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <span className="h-px w-8 bg-terra/40" />
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-terra/60">
          Data Explorer
        </span>
      </div>

      <h1
        className="text-[1.75rem] sm:text-[2.25rem] leading-[1.12] tracking-[-0.02em] text-warm-900"
        style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
      >
        Institution Database
      </h1>
      <p className="mt-2 text-[14px] text-warm-600">
        Browse the complete Bank Fee Index dataset. {stats.total_institutions.toLocaleString()} institutions
        with {stats.total_observations.toLocaleString()} fee observations across {TAXONOMY_COUNT} categories.
        <span className="ml-2 text-warm-500">Updated {lastUpdated}</span>
      </p>

      {/* Stat cards */}
      <div className="mt-6 grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: "Institutions", value: stats.total_institutions.toLocaleString() },
          { label: "Observations", value: stats.total_observations.toLocaleString() },
          { label: "States", value: String(statesData.length) },
          { label: "Fee Categories", value: String(stats.total_categories) },
          { label: "Showing", value: `${results.total.toLocaleString()} results` },
        ].map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-warm-200/80 bg-white/70 backdrop-blur-sm px-4 py-3"
          >
            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-warm-500">
              {card.label}
            </p>
            <p
              className="mt-1 text-[18px] font-light [font-variant-numeric:tabular-nums] text-warm-900"
              style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
            >
              {card.value}
            </p>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <form className="mt-6 flex flex-wrap items-center gap-3" action="/pro/data" method="get">
        <div className="relative flex-1 min-w-[200px]">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-warm-500"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <label htmlFor="pro-data-q" className="sr-only">Search institutions by name</label>
          <input
            id="pro-data-q"
            type="text"
            name="q"
            defaultValue={query}
            placeholder="Search by name..."
            className="w-full rounded-xl border border-warm-200 bg-white pl-10 pr-4 py-2.5 text-[13px] text-warm-900 placeholder:text-warm-500 focus:outline-none focus:ring-2 focus:ring-terra/30 focus:border-transparent"
          />
        </div>

        <label htmlFor="pro-data-state" className="sr-only">Filter by state</label>
        <select
          id="pro-data-state"
          name="state"
          defaultValue={stateCode}
          className="rounded-xl border border-warm-200 bg-white px-3 py-2.5 text-[13px] text-warm-900 focus:outline-none focus:ring-2 focus:ring-terra/30"
        >
          <option value="">All States</option>
          {Object.entries(STATE_NAMES)
            .sort(([, a], [, b]) => a.localeCompare(b))
            .map(([code, name]) => (
              <option key={code} value={code}>{name}</option>
            ))}
        </select>

        <label htmlFor="pro-data-charter" className="sr-only">Filter by charter type</label>
        <select
          id="pro-data-charter"
          name="charter"
          defaultValue={charterType}
          className="rounded-xl border border-warm-200 bg-white px-3 py-2.5 text-[13px] text-warm-900 focus:outline-none focus:ring-2 focus:ring-terra/30"
        >
          <option value="">All Charters</option>
          <option value="bank">Banks</option>
          <option value="credit_union">Credit Unions</option>
        </select>

        <button
          type="submit"
          className="rounded-xl bg-terra px-5 py-2.5 text-[13px] font-semibold text-white hover:bg-terra-dark transition-colors"
        >
          Filter
        </button>

        {(query || stateCode || charterType) && (
          <Link
            href="/pro/data"
            className="text-[12px] text-warm-500 hover:text-terra transition-colors"
          >
            Clear
          </Link>
        )}
      </form>

      {/* Results table */}
      <div className="mt-6 rounded-xl border border-warm-200/80 bg-white/70 backdrop-blur-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-warm-200/60 bg-warm-100/60">
                <th className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-warm-500">
                  Institution
                </th>
                <th className="hidden sm:table-cell px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-warm-500">
                  State
                </th>
                <th className="hidden md:table-cell px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-warm-500">
                  Charter
                </th>
                <th className="hidden lg:table-cell px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-warm-500">
                  Asset Tier
                </th>
                <th className="px-4 py-2.5 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-warm-500">
                  Published Fees
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-warm-200/40">
              {results.rows.map((r) => (
                <tr key={r.id} className="hover:bg-warm-100/60 transition-colors">
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/pro/analyze?instId=${r.id}&intent=institution`}
                      className="font-medium text-warm-900 hover:text-terra transition-colors"
                    >
                      {r.institution_name}
                    </Link>
                    <span className="sm:hidden ml-2 text-[11px] text-warm-500">
                      {r.state_code}
                    </span>
                  </td>
                  <td className="hidden sm:table-cell px-4 py-2.5 text-warm-600">
                    {r.state_code ? (
                      <Link
                        href={`/research/state/${r.state_code}`}
                        className="hover:text-terra transition-colors"
                      >
                        {STATE_NAMES[r.state_code] ?? r.state_code}
                      </Link>
                    ) : (
                      <span className="text-warm-300">--</span>
                    )}
                  </td>
                  <td className="hidden md:table-cell px-4 py-2.5 text-warm-600">
                    {r.charter_type === "bank" ? "Bank" : "Credit Union"}
                  </td>
                  <td className="hidden lg:table-cell px-4 py-2.5 text-warm-600">
                    {r.asset_size_tier ? (
                      <span className="text-[11px]">
                        {FDIC_TIER_LABELS[r.asset_size_tier] ?? r.asset_size_tier}
                      </span>
                    ) : (
                      <span className="text-warm-300">--</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right [font-variant-numeric:tabular-nums]">
                    {r.fee_count > 0 ? (
                      <span className="font-medium text-warm-900">{r.fee_count}</span>
                    ) : (
                      <span className="text-warm-300">--</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-6">
          {page > 1 && (
            <Link
              href={buildUrl({ page: String(page - 1) })}
              className="rounded-full border border-warm-200 px-4 py-1.5 text-[12px] font-medium text-warm-700 hover:border-terra/30 hover:text-terra transition-colors no-underline"
            >
              Previous
            </Link>
          )}
          <span className="text-[12px] text-warm-500 [font-variant-numeric:tabular-nums]">
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <Link
              href={buildUrl({ page: String(page + 1) })}
              className="rounded-full border border-warm-200 px-4 py-1.5 text-[12px] font-medium text-warm-700 hover:border-terra/30 hover:text-terra transition-colors no-underline"
            >
              Next
            </Link>
          )}
        </div>
      )}

      {/* Quick nav */}
      <div className="mt-14">
        <div className="flex items-center gap-3 mb-5">
          <h2
            className="text-[16px] font-medium text-warm-900"
            style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
          >
            Explore the Dataset
          </h2>
          <span className="h-px flex-1 bg-warm-200" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Fee Index", desc: `All ${TAXONOMY_COUNT} categories`, href: "/fees" },
            { label: "National Benchmarks", desc: "Medians & percentiles", href: "/research/national-fee-index" },
            { label: "Hamilton", desc: "Analysis workspace", href: "/pro/analyze" },
            { label: "State Reports", desc: `${statesData.length} states`, href: "/research" },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="group rounded-xl border border-warm-200/80 bg-white/70 px-5 py-4 transition-all duration-300 hover:border-terra/20 hover:shadow-md hover:shadow-terra/5 no-underline"
            >
              <span className="text-[13px] font-medium text-warm-900 group-hover:text-terra transition-colors">
                {item.label}
              </span>
              <span className="block mt-0.5 text-[11px] text-warm-500">{item.desc}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
    </div>
  );
}
