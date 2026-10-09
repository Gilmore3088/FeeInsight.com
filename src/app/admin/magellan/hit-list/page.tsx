import { Breadcrumbs } from "@/components/breadcrumbs";
import { requireAuth } from "@/lib/auth";
import {
  getHitList,
  HIT_LIST_REASON_TEXT,
  type HitList,
  type HitListView,
} from "@/lib/data-store/hit-list";
import { getTopTenCoverage, type TopTenCoverage } from "@/lib/data-store/top-ten-coverage";
import { COVERED_SHARE, getMarketGaps, getNationalCompetitorCoverage, type MarketGap } from "@/lib/data-store/competitor-coverage";
import { NO_CONSUMER_SCHEDULE_IDS } from "@/lib/agents/magellan/operator-schedules";
import { HitListLinkForm } from "./link-form";

export const dynamic = "force-dynamic";

type PageView = HitListView | "top10" | "gaps";

const VIEWS: Array<{ view: PageView; label: string }> = [
  { view: "top10", label: "Top 10 per state" },
  { view: "gaps", label: "Market gaps" },
  { view: "no_fees", label: "No live fees" },
  { view: "no_overdraft", label: "No overdraft fee" },
];

/** Deposits are in thousands of dollars. */
function formatDeposits(thousands: number | null): string {
  if (thousands == null) return "Deposits unknown";
  if (thousands >= 1_000_000) return `$${(thousands / 1_000_000).toFixed(1)}B deposits`;
  return `$${Math.round(thousands / 1_000)}M deposits`;
}

function formatDay(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "never";
}

function hrefFor(view: PageView, state: string | null): string {
  const params = new URLSearchParams();
  if (view !== "no_fees") params.set("view", view);
  if (state) params.set("state", state);
  const query = params.toString();
  return `/admin/magellan/hit-list${query ? `?${query}` : ""}`;
}

export default async function HitListPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; state?: string }>;
}) {
  await requireAuth("view");
  const params = await searchParams;
  const view: PageView = params.view === "no_overdraft" || params.view === "top10" || params.view === "gaps" ? params.view : "no_fees";
  const state = params.state && /^[A-Za-z]{2}$/.test(params.state) ? params.state.toUpperCase() : null;
  const coverage: TopTenCoverage | null = view === "top10" ? await getTopTenCoverage().catch(() => null) : null;
  const gaps: MarketGap[] | null = view === "gaps" ? await getMarketGaps(undefined, 100, NO_CONSUMER_SCHEDULE_IDS).catch(() => null) : null;
  const gapBy = new Map((gaps ?? []).map((gap) => [gap.institutionId, gap]));
  const markets = view === "no_fees" ? await getNationalCompetitorCoverage().catch(() => null) : null;
  const list =
    (view === "top10" && !coverage) || (view === "gaps" && !gaps)
      ? { rows: [], total: 0 }
      : await getHitList({
          view: view === "top10" || view === "gaps" ? "no_fees" : view,
          // Top 10 slots are per state, not home state: Goldman Sachs holds a Utah slot from New York.
          stateCode: coverage ? null : state,
          institutionIds: coverage
            ? [...coverage.missing.entries()]
                .filter(([, slots]) => !state || slots.some((slot) => slot.stateCode === state))
                .map(([id]) => id)
            : gaps
              ? gaps.map((gap) => gap.institutionId)
              : null,
        }).catch((): HitList => ({ rows: [], total: 0 }));
  // Market gaps keep their own order: most competitor coverage added first.
  if (gaps) list.rows.sort((a, b) => (gapBy.get(b.institutionId)?.gain ?? 0) - (gapBy.get(a.institutionId)?.gain ?? 0));

  return (
    <div className="space-y-6">
      <header>
        <Breadcrumbs items={[{ label: "Atlas", href: "/admin" }, { label: "Magellan", href: "/admin/magellan" }, { label: "Hit list" }]} />
        <p className="admin-eyebrow mt-3">Agent · Discover</p>
        <h1 className="admin-display-title mt-1">Hit list</h1>
        <p className="admin-lede mt-2">
          The largest institutions the site does not show yet, by deposits. Paste a fee schedule link against any of
          them and Atlas fetches, reads, verifies and publishes that institution on its next tick.
        </p>
      </header>

      <nav className="flex flex-wrap items-center gap-2 text-sm">
        {VIEWS.map((option) => (
          <a
            key={option.view}
            href={hrefFor(option.view, state)}
            className={`rounded-full border px-3 py-1 ${option.view === view ? "border-current font-semibold" : "border-black/15 text-[#6B6255] dark:border-white/15"}`}
          >
            {option.label}
          </a>
        ))}
        <form action="/admin/magellan/hit-list" className="ml-auto flex items-center gap-2">
          {view !== "no_fees" && <input type="hidden" name="view" value={view} />}
          <input
            name="state"
            defaultValue={state ?? ""}
            maxLength={2}
            placeholder="State"
            aria-label="State code"
            className="w-16 rounded-md border border-black/15 bg-white px-2 py-1 text-sm uppercase dark:border-white/15 dark:bg-transparent"
          />
          <button type="submit" className="rounded-md border border-black/15 px-3 py-1 text-sm dark:border-white/15">
            Filter
          </button>
        </form>
      </nav>

      {view === "top10" ? (
        coverage ? (
          <p className="text-sm text-[#6B6255]">
            <span className="font-semibold text-current">
              {coverage.live.toLocaleString("en-US")} of {coverage.slots.toLocaleString("en-US")}
            </span>{" "}
            top-10 slots across the 50 states and DC show live fees ({coverage.liveOverdraft.toLocaleString("en-US")} with an overdraft fee).
            These {coverage.missing.size.toLocaleString("en-US")} institutions hold the rest{state ? `; ${list.total.toLocaleString("en-US")} of them in ${state}` : ""}.
          </p>
        ) : (
          <p className="text-sm text-[#9a4a1f]">The top 10 per state could not be counted just now.</p>
        )
      ) : view === "gaps" ? (
        <p className="text-sm text-[#6B6255]">
          Banks with no live fees, ordered by how much competitor coverage their fees would add across every bank&rsquo;s
          branch counties (1.0 is one whole market). Magellan&rsquo;s discovery searches the top 100 beside the market
          leaders. Credit unions report no deposits by branch, so they are not ranked here.
        </p>
      ) : (
        <p className="text-sm text-[#6B6255]">
          {list.total.toLocaleString("en-US")} {view === "no_fees" ? "institutions with no live fees" : "live institutions with no overdraft fee"}
          {state ? ` in ${state}` : ""}. Showing the largest {list.rows.length.toLocaleString("en-US")}.
        </p>
      )}
      {markets ? (
        <p className="text-sm text-[#6B6255]">
          Competitor coverage: in the median bank&rsquo;s branch counties, competitors with live fees hold{" "}
          <span className="font-semibold text-current">{Math.round(markets.medianShare * 100)}%</span> of competitor
          deposits ({Math.round(markets.medianShareOverdraft * 100)}% with an overdraft fee).{" "}
          {markets.buyersCovered.toLocaleString("en-US")} of {markets.buyers.toLocaleString("en-US")} banks have{" "}
          {Math.round(COVERED_SHARE * 100)}% or more of their market covered ({markets.buyersCoveredOverdraft.toLocaleString("en-US")} for
          overdraft). FDIC Summary of Deposits {markets.sodYear}; credit unions report no deposits by branch.
        </p>
      ) : null}

      <ol className="space-y-3">
        {list.rows.map((row, index) => (
          <li key={row.institutionId} className="admin-card p-4">
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-medium">
                <span className="mr-2 tabular-nums text-[#6B6255]">{index + 1}</span>
                <a href={`/admin/institution/${row.institutionId}`} className="underline-offset-2 hover:underline">
                  {row.name}
                </a>
              </p>
              <span className="shrink-0 text-xs text-[#6B6255]">
                {gapBy.has(row.institutionId)
                  ? `In ${gapBy.get(row.institutionId)!.markets.toLocaleString("en-US")} banks' markets · adds ${gapBy.get(row.institutionId)!.gain.toFixed(1)}`
                  : (coverage?.missing.get(row.institutionId)?.map((slot) => `${slot.stateCode} #${slot.rank}`).join(", ") ?? row.stateCode ?? "—")}
              </span>
            </div>
            <p className="mt-1 text-xs text-[#6B6255]">
              {formatDeposits(row.deposits)}
              {row.charterType === "credit_union" ? " · credit union" : ""}
              {view === "no_overdraft" ? ` · ${row.liveFeeTypes} live fee types` : ""} · last tried {formatDay(row.lastTriedAt)}
            </p>
            <p className={`mt-1 text-sm ${row.reason === "link_waiting" ? "text-emerald-700" : "text-[#9a4a1f]"}`}>
              {HIT_LIST_REASON_TEXT[row.reason]}
            </p>
            {(row.feeScheduleUrl || row.websiteUrl) && (
              <p className="mt-1 truncate text-xs">
                {row.feeScheduleUrl ? (
                  <a href={row.feeScheduleUrl} target="_blank" rel="noopener noreferrer" className="underline">
                    Link on file
                  </a>
                ) : null}
                {row.feeScheduleUrl && row.websiteUrl ? " · " : null}
                {row.websiteUrl ? (
                  <a href={row.websiteUrl} target="_blank" rel="noopener noreferrer" className="underline">
                    Website
                  </a>
                ) : null}
              </p>
            )}
            <HitListLinkForm institutionId={row.institutionId} />
          </li>
        ))}
      </ol>
    </div>
  );
}
