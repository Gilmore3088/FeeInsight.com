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
import { Figure, MemoHeader, MemoPage, MemoSection, SERIF } from "@/components/hamilton/memo/memo";

export const metadata: Metadata = {
  title: "Find an institution",
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
    : "Not recorded";

  function buildUrl(overrides: Record<string, string>) {
    const p = new URLSearchParams();
    if (overrides.q ?? query) p.set("q", overrides.q ?? query);
    if (overrides.state ?? stateCode) p.set("state", overrides.state ?? stateCode);
    if (overrides.charter ?? charterType) p.set("charter", overrides.charter ?? charterType);
    if (overrides.page) p.set("page", overrides.page);
    return `/pro/data?${p.toString()}`;
  }

  const fieldClass =
    "w-full rounded-md border border-warm-300 bg-white px-3 py-2 text-sm text-warm-900 focus:border-terra focus:outline-none focus:ring-1 focus:ring-terra";
  const pagerClass =
    "rounded-md border border-warm-300 bg-warm-50 px-3.5 py-2 text-sm font-medium text-warm-800 no-underline hover:border-warm-500";
  const filtered = Boolean(query || stateCode || charterType);

  return (
    <MemoPage>
      <MemoHeader
        kicker="Institutions"
        title="Find any bank or credit union"
        dek={
          <>
            {stats.total_institutions.toLocaleString()} institutions have{" "}
            {stats.total_observations.toLocaleString()} verified, published fees in the Bank Fee Index.
            Open any one to see its fees beside its peers.
          </>
        }
      />

      <div className="grid grid-cols-2 gap-x-6 gap-y-5 border-b border-warm-200 pb-6 sm:grid-cols-4">
        <Figure label="Institutions" value={stats.total_institutions.toLocaleString()} note="with published fees" />
        <Figure label="Published fees" value={stats.total_observations.toLocaleString()} />
        <Figure label="States" value={String(statesData.length)} note={`${stats.total_categories} fee categories`} />
        <Figure label="Last schedule checked" value={lastUpdated} />
      </div>

      <form
        className="grid gap-4 rounded-lg border border-warm-300 bg-warm-50 p-5 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
        action="/pro/data"
        method="get"
      >
        <label htmlFor="pro-data-q" className="flex flex-col gap-1 text-sm text-warm-800">
          Name
          <input
            id="pro-data-q"
            type="text"
            name="q"
            defaultValue={query}
            placeholder="For example, First National"
            className={fieldClass}
          />
        </label>
        <label htmlFor="pro-data-state" className="flex flex-col gap-1 text-sm text-warm-800">
          State
          <select id="pro-data-state" name="state" defaultValue={stateCode} className={fieldClass}>
            <option value="">All states</option>
            {Object.entries(STATE_NAMES)
              .sort(([, a], [, b]) => a.localeCompare(b))
              .map(([code, name]) => (
                <option key={code} value={code}>{name}</option>
              ))}
          </select>
        </label>
        <label htmlFor="pro-data-charter" className="flex flex-col gap-1 text-sm text-warm-800">
          Charter
          <select id="pro-data-charter" name="charter" defaultValue={charterType} className={fieldClass}>
            <option value="">Banks and credit unions</option>
            <option value="bank">Banks</option>
            <option value="credit_union">Credit unions</option>
          </select>
        </label>
        <div className="flex items-end gap-3">
          <button
            type="submit"
            className="rounded-md bg-terra px-3.5 py-2 text-sm font-medium text-white hover:bg-terra-dark"
          >
            Search
          </button>
          {filtered && (
            <Link
              href="/pro/data"
              className="py-2 text-sm font-medium text-terra-text underline decoration-terra/40 underline-offset-2 hover:decoration-terra"
            >
              Clear
            </Link>
          )}
        </div>
      </form>

      <MemoSection
        title={filtered ? "Matching institutions" : "All institutions"}
        note={
          <>
            <span className="[font-variant-numeric:tabular-nums]">{results.total.toLocaleString()}</span>{" "}
            {results.total === 1 ? "institution" : "institutions"}
            {totalPages > 1 ? `, ${pageSize} to a page` : ""}. Published fees counts only fees checked against
            the bank&apos;s own schedule.
          </>
        }
      >
        <div className="overflow-hidden rounded-lg border border-warm-300 bg-warm-50">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-warm-300 bg-warm-150 text-warm-700">
                  <th scope="col" className="px-4 py-2.5 font-medium">Institution</th>
                  <th scope="col" className="hidden px-4 py-2.5 font-medium sm:table-cell">State</th>
                  <th scope="col" className="hidden px-4 py-2.5 font-medium md:table-cell">Charter</th>
                  <th scope="col" className="hidden px-4 py-2.5 font-medium lg:table-cell">Asset size</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Published fees</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-warm-200">
                {results.rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-warm-700">
                      No institutions match. Try a shorter name or clear the filters.
                    </td>
                  </tr>
                ) : (
                  results.rows.map((r) => (
                    <tr key={r.id} className="hover:bg-warm-100">
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/pro/analyze?instId=${r.id}&intent=institution`}
                          className="font-medium text-warm-900 hover:text-terra-text"
                        >
                          {r.institution_name}
                        </Link>
                        <span className="ml-2 text-xs text-warm-600 sm:hidden">{r.state_code}</span>
                      </td>
                      <td className="hidden px-4 py-2.5 text-warm-700 sm:table-cell">
                        {r.state_code ? (
                          <Link href={`/research/state/${r.state_code}`} className="hover:text-terra-text">
                            {STATE_NAMES[r.state_code] ?? r.state_code}
                          </Link>
                        ) : (
                          <span className="text-warm-600">Not recorded</span>
                        )}
                      </td>
                      <td className="hidden px-4 py-2.5 text-warm-700 md:table-cell">
                        {r.charter_type === "bank" ? "Bank" : "Credit union"}
                      </td>
                      <td className="hidden px-4 py-2.5 text-warm-700 lg:table-cell">
                        {r.asset_size_tier ? (
                          FDIC_TIER_LABELS[r.asset_size_tier] ?? r.asset_size_tier
                        ) : (
                          <span className="text-warm-600">Not recorded</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right [font-variant-numeric:tabular-nums]">
                        {r.published_fee_count > 0 ? (
                          <span className="text-warm-900">{r.published_fee_count}</span>
                        ) : (
                          <span className="text-warm-600">None yet</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {totalPages > 1 && (
          <nav aria-label="Pages" className="flex items-center justify-center gap-3">
            {page > 1 && (
              <Link href={buildUrl({ page: String(page - 1) })} className={pagerClass}>
                Previous
              </Link>
            )}
            <span className="text-sm text-warm-700 [font-variant-numeric:tabular-nums]">
              Page {page} of {totalPages}
            </span>
            {page < totalPages && (
              <Link href={buildUrl({ page: String(page + 1) })} className={pagerClass}>
                Next
              </Link>
            )}
          </nav>
        )}
      </MemoSection>

      <MemoSection title="More ways into the data">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Fee categories", desc: `All ${TAXONOMY_COUNT} fee types`, href: "/fees" },
            { label: "National benchmarks", desc: "Medians and ranges", href: "/research/national-fee-index" },
            { label: "Ask Hamilton", desc: "Questions about any institution", href: "/pro/analyze" },
            { label: "State reports", desc: `${statesData.length} states`, href: "/research" },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="group rounded-lg border border-warm-300 bg-warm-50 px-4 py-3 no-underline hover:border-warm-500"
            >
              <span className="block text-base text-warm-900 group-hover:text-terra-text" style={SERIF}>
                {item.label}
              </span>
              <span className="mt-0.5 block text-sm text-warm-600">{item.desc}</span>
            </Link>
          ))}
        </div>
      </MemoSection>
    </MemoPage>
  );
}
