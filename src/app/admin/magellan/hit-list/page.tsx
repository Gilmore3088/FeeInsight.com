import { Breadcrumbs } from "@/components/breadcrumbs";
import { requireAuth } from "@/lib/auth";
import {
  getHitList,
  HIT_LIST_REASON_TEXT,
  type HitList,
  type HitListView,
} from "@/lib/data-store/hit-list";
import { HitListLinkForm } from "./link-form";

export const dynamic = "force-dynamic";

const VIEWS: Array<{ view: HitListView; label: string }> = [
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

function hrefFor(view: HitListView, state: string | null): string {
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
  const view: HitListView = params.view === "no_overdraft" ? "no_overdraft" : "no_fees";
  const state = params.state && /^[A-Za-z]{2}$/.test(params.state) ? params.state.toUpperCase() : null;
  const list = await getHitList({ view, stateCode: state }).catch((): HitList => ({ rows: [], total: 0 }));

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

      <p className="text-sm text-[#6B6255]">
        {list.total.toLocaleString("en-US")} {view === "no_fees" ? "institutions with no live fees" : "live institutions with no overdraft fee"}
        {state ? ` in ${state}` : ""}. Showing the largest {list.rows.length.toLocaleString("en-US")}.
      </p>

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
              <span className="shrink-0 text-xs text-[#6B6255]">{row.stateCode ?? "—"}</span>
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
