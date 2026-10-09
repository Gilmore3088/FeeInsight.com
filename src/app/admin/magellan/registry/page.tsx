import { Breadcrumbs } from "@/components/breadcrumbs";
import { requireAuth } from "@/lib/auth";
import { REGISTRY_SOURCES } from "@/lib/agents/magellan/registry";
import { registryPartitionsBySource } from "@/lib/agents/registry-scheduler";
import { STATE_BILLS_SOURCE } from "@/lib/agents/magellan/registry/state-bills";
import { STATE_BILL_JURISDICTIONS } from "@/lib/regulatory/open-states";
import {
  getIdentityLinksNeedingReview,
  getRegistryPartitionStats,
  getStateBillCoverage,
  type IdentityReviewItem,
  type RegistryPartitionStats,
} from "@/lib/data-store/registry-profile";
import { decideIdentityLinksAction } from "./actions";
import { QueueRegistryButton } from "./queue-button";

export const dynamic = "force-dynamic";

function formatWhen(iso: string | null): string {
  if (!iso) return "Never";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export default async function RegistryPage() {
  await requireAuth("view");
  const [stats, review, stateBills] = await Promise.all([
    getRegistryPartitionStats().catch((): RegistryPartitionStats[] => []),
    getIdentityLinksNeedingReview(200).catch((): IdentityReviewItem[] => []),
    getStateBillCoverage().catch(() => null),
  ]);
  const bySource = new Map(stats.map((row) => [row.source, row]));
  const expected = new Map(registryPartitionsBySource(new Date()).map((entry) => [entry.source, entry.partitions.length]));

  return (
    <div className="space-y-7">
      <header>
        <Breadcrumbs items={[{ label: "Atlas", href: "/admin" }, { label: "Magellan", href: "/admin/magellan" }, { label: "Regulatory registry" }]} />
        <p className="admin-eyebrow mt-3">Agent · Published regulator data</p>
        <h1 className="admin-display-title mt-1">Regulatory registry</h1>
        <p className="admin-lede mt-2">
          FDIC, NCUA, CFPB, SEC, and Federal Reserve data, loaded one partition per run by the cron tick. Each run is in
          the run ledger; nothing here calls a paid provider. Partitions loaded counts loaded or empty partitions (a
          quarter, a year, a batch, or one &quot;current&quot; pull) against the partitions the scheduler expects today; state
          fee bills count states instead.
        </p>
      </header>

      <section className="admin-card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-[#6B6255]">
            <tr>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2 text-right">Partitions loaded</th>
              <th className="px-3 py-2 text-right">Retrying</th>
              <th className="px-3 py-2 text-right">Rows (latest pass)</th>
              <th className="px-3 py-2 text-right">Unmatched</th>
              <th className="px-3 py-2">Last fetched</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {REGISTRY_SOURCES.map((definition) => {
              const row = bySource.get(definition.source);
              const total = expected.get(definition.source) ?? 0;
              const done = (row?.succeeded ?? 0) + (row?.empty ?? 0);
              return (
                <tr key={definition.source} className="border-t border-black/5 align-top">
                  <td className="px-3 py-2">
                    <p className="font-medium">{definition.title}</p>
                    <p className="text-xs text-[#6B6255]">{definition.stepKey}</p>
                    {row?.lastError && <p className="mt-1 text-xs text-red-700">{row.lastError}</p>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {definition.source === STATE_BILLS_SOURCE ? (
                      stateBills ? (
                        <>
                          {stateBills.statesRead} / {STATE_BILL_JURISDICTIONS.length} states read
                          <span className="block text-xs text-[#6B6255]">{stateBills.withBills} with fee bills</span>
                        </>
                      ) : (
                        "Not read"
                      )
                    ) : (
                      <>
                        {done.toLocaleString("en-US")} / {total.toLocaleString("en-US")}
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{row?.retrying ?? 0}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{(row?.rowsLoaded ?? 0).toLocaleString("en-US")}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{(row?.unmatched ?? 0).toLocaleString("en-US")}</td>
                  <td className="px-3 py-2 text-xs">{formatWhen(row?.lastFetchedAt ?? null)}</td>
                  <td className="px-3 py-2">
                    <QueueRegistryButton source={definition.source} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="admin-card">
        <h2 className="text-base font-semibold">Identity matches waiting for review ({review.length})</h2>
        <p className="mt-1 text-sm text-[#6B6255]">
          CFPB company names and SEC filers that could be more than one institution. They are not used for any data
          until accepted. Tick the rows, then choose once for all of them.
        </p>
        {review.length === 0 ? (
          <p className="mt-3 text-sm text-[#6B6255]">Nothing waiting.</p>
        ) : (
          <form action={decideIdentityLinksAction} className="mt-3">
            <div className="flex gap-2">
              <button type="submit" name="decision" value="accepted" className="rounded-md border border-[var(--admin-border,#E0D7C9)] px-2 py-1 text-xs font-medium hover:bg-black/5">
                Same bank
              </button>
              <button type="submit" name="decision" value="rejected" className="rounded-md border border-[var(--admin-border,#E0D7C9)] px-2 py-1 text-xs font-medium hover:bg-black/5">
                Not a match
              </button>
            </div>
            <table className="mt-3 w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-[#6B6255]">
                <tr>
                  <th className="px-3 py-2" />
                  <th className="px-3 py-2">External name</th>
                  <th className="px-3 py-2">Best candidate</th>
                  <th className="px-3 py-2">Type</th>
                </tr>
              </thead>
              <tbody>
                {review.map((item) => (
                  <tr key={`${item.link_type}:${item.external_key}`} className="border-t border-black/5">
                    <td className="px-3 py-2">
                      <input type="checkbox" name="link" value={`${item.link_type}|${item.external_key}`} aria-label={`Select ${item.external_name ?? item.external_key}`} />
                    </td>
                    <td className="px-3 py-2">{item.external_name ?? item.external_key}</td>
                    <td className="px-3 py-2">
                      {item.institution_id ? <a className="underline" href={`/admin/institution/${item.institution_id}`}>{item.institution_name ?? `#${item.institution_id}`}</a> : "None"}
                    </td>
                    <td className="px-3 py-2 text-xs">{item.link_type === "sec_cik" ? "SEC" : "CFPB"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </form>
        )}
      </section>
    </div>
  );
}
