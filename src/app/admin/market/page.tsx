export const dynamic = "force-dynamic";

import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { searchInstitutions } from "@/lib/data-store/search";
import { getLocalMarketAnswer, type LocalMarketAnswer } from "@/lib/hamilton/local-market-answer";
import { LocalMarketView } from "@/components/hamilton/analyze/local-market";

function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/**
 * One institution's local market, the same answer a Pro customer gets from Hamilton: who has
 * branches in its counties, each one's deposit share, their published fees beside its own, and
 * the footprint map. Pick a bank or credit union by name.
 */
export default async function MarketPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; institution?: string }>;
}) {
  await requireAuth("view");
  const params = await searchParams;
  const query = (params.q ?? "").trim();
  const institutionId = Number(params.institution);

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
    </div>
  );
}
