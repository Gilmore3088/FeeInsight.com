export const dynamic = "force-dynamic";

import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { searchInstitutions } from "@/lib/data-store/search";
import { getLocalMarketAnswer, type LocalMarketAnswer } from "@/lib/hamilton/local-market-answer";
import { LocalMarketView } from "@/components/hamilton/analyze/local-market";
import { COVERED_SHARE, getSellableMarkets, type SellableMarkets } from "@/lib/data-store/competitor-coverage";

function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** Bank size bands for the covered-markets list, by the bank's own SOD deposits (thousands). */
const SIZES = [
  { key: "all", label: "All sizes", min: null, max: null },
  { key: "mid", label: "$500M to $2B", min: 500_000, max: 2_000_000 },
  { key: "small", label: "Under $500M", min: null, max: 500_000 },
  { key: "large", label: "$2B and up", min: 2_000_000, max: null },
] as const;

/** Deposits are in thousands of dollars. */
function formatDeposits(thousands: number): string {
  if (thousands >= 1_000_000) return `${(thousands / 1_000_000).toFixed(1)}B`;
  return `${Math.round(thousands / 1_000)}M`;
}

/**
 * One institution's local market, the same answer a Pro customer gets from Hamilton: who has
 * branches in its counties, each one's deposit share, their published fees beside its own, and
 * the footprint map. Pick a bank or credit union by name.
 */
export default async function MarketPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; institution?: string; size?: string }>;
}) {
  await requireAuth("view");
  const params = await searchParams;
  const query = (params.q ?? "").trim();
  const institutionId = Number(params.institution);

  const size = SIZES.find((option) => option.key === params.size) ?? SIZES[1];
  const showCovered = query.length < 2 && !(Number.isInteger(institutionId) && institutionId > 0);
  const covered: SellableMarkets | null = showCovered
    ? await getSellableMarkets(undefined, { minDeposits: size.min, maxDeposits: size.max, limit: 50 }).catch(() => null)
    : null;

  const matches = query.length >= 2 ? (await searchInstitutions({ query, pageSize: 8 })).rows : [];

  let answer: LocalMarketAnswer | null = null;
  let failed = false;
  if (Number.isInteger(institutionId) && institutionId > 0) {
    try {
      answer = await getLocalMarketAnswer(institutionId);
    } catch (error) {
      console.error("[admin-market] local market failed", error);
      failed = true;
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-gray-900 dark:text-gray-100">Local market</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Pick a bank or credit union to see who competes in its counties, their deposit share and their fees.
        </p>
      </div>

      <form action="/admin/market" className="flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Bank or credit union name"
          aria-label="Bank or credit union name"
          className="min-h-11 flex-1 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 sm:min-h-0 sm:py-1.5 dark:border-white/[0.12] dark:bg-[oklch(0.18_0_0)] dark:text-gray-100"
        />
        <button
          type="submit"
          className="min-h-11 rounded-md bg-gray-900 px-4 text-sm font-medium text-white hover:bg-gray-800 sm:min-h-0 sm:py-1.5 dark:bg-gray-100 dark:text-gray-900"
        >
          Find
        </button>
      </form>

      {query.length >= 2 ? (
        matches.length > 0 ? (
          <ul className="admin-card divide-y divide-gray-100 dark:divide-white/[0.06]">
            {matches.map((m) => (
              <li key={m.id}>
                <Link
                  href={`/admin/market?institution=${m.id}`}
                  prefetch={false}
                  className="flex min-h-11 items-center justify-between gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-white/[0.03]"
                >
                  <span className="font-medium text-gray-900 dark:text-gray-100">{m.institution_name}</span>
                  <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
                    {[m.city, m.state_code].filter(Boolean).join(", ")}
                    {m.charter_type === "credit_union" ? " · CU" : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400">No bank or credit union matches &ldquo;{query}&rdquo;.</p>
        )
      ) : null}

      {failed ? (
        <p className="text-sm text-red-700 dark:text-red-400">The market could not be loaded just now.</p>
      ) : answer ? (
        <>
          {answer.coverage && answer.coverage.competitors > 0 ? (
            <p className="text-sm text-gray-600 dark:text-gray-300">
              <span className="font-semibold text-gray-900 dark:text-gray-100">
                {answer.coverage.withFees.toLocaleString("en-US")} of {answer.coverage.competitors.toLocaleString("en-US")}
              </span>{" "}
              competitors in this market show live fees ({answer.coverage.withOverdraft.toLocaleString("en-US")} with an overdraft fee)
              {answer.coverage.depositShare !== null
                ? `. They hold ${percent(answer.coverage.depositShare)} of the competitors' bank deposits here (${percent(answer.coverage.depositShareOverdraft ?? 0)} with an overdraft fee).`
                : "."}
            </p>
          ) : null}
          <LocalMarketView data={answer} />
        </>
      ) : institutionId > 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">No branch market is on file for this institution yet.</p>
      ) : null}

      {showCovered ? (
        <section className="space-y-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Covered markets</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Banks whose competitors with live fees hold {percent(COVERED_SHARE)} or more of the competitor deposits in the
              bank&rsquo;s branch counties, so a market report for them would show most of the competition. Largest first.
              {covered ? ` FDIC Summary of Deposits ${covered.sodYear}; credit unions report no deposits by branch, and national online banks are left out.` : ""}
            </p>
          </div>
          <nav className="flex flex-wrap gap-2 text-sm">
            {SIZES.map((option) => (
              <Link
                key={option.key}
                href={`/admin/market?size=${option.key}`}
                prefetch={false}
                className={`rounded-full border px-3 py-1 ${option.key === size.key ? "border-current font-semibold text-gray-900 dark:text-gray-100" : "border-gray-300 text-gray-500 dark:border-white/[0.12] dark:text-gray-400"}`}
              >
                {option.label}
              </Link>
            ))}
          </nav>
          {covered ? (
            <>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                <span className="font-semibold text-gray-900 dark:text-gray-100">{covered.total.toLocaleString("en-US")}</span> banks
                {size.key === "all" ? "" : ` at ${size.label}`}. Showing the largest {covered.rows.length.toLocaleString("en-US")}.
              </p>
              <ul className="admin-card divide-y divide-gray-100 dark:divide-white/[0.06]">
                {covered.rows.map((row) => (
                  <li key={row.institutionId}>
                    <Link
                      href={`/admin/market?institution=${row.institutionId}`}
                      prefetch={false}
                      className="flex min-h-11 items-center justify-between gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-white/[0.03]"
                    >
                      <span className="min-w-0">
                        <span className="block font-medium text-gray-900 dark:text-gray-100">{row.name}</span>
                        <span className="block text-xs text-gray-500 dark:text-gray-400">
                          {row.stateCode ?? "—"} · {formatDeposits(row.deposits)} deposits · {row.counties.toLocaleString("en-US")}{" "}
                          {row.counties === 1 ? "county" : "counties"}
                          {row.ownFeesLive ? "" : " · own fees not live yet"}
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-xs text-gray-500 dark:text-gray-400">
                        <span className="block font-semibold text-gray-900 dark:text-gray-100">{percent(row.share)} covered</span>
                        {percent(row.shareOverdraft)} overdraft
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-red-700 dark:text-red-400">Covered markets could not be counted just now.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
