export const dynamic = "force-dynamic";

import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { formatAdminDateTime } from "@/lib/admin-time";
import { sql } from "@/lib/data-store/connection";
import { PEER_MIN_INSTITUTIONS, type StrategyRank } from "@/lib/agents/state-expert/memory";
import { loadStateExpertPage, sizeGroupLabel, STATE_EXPERT_QUERIES, WORK_LIST_SHOWN } from "@/lib/agents/state-expert/admin-view";
import { StateNotes } from "./state-notes";

const num = (value: number) => value.toLocaleString("en-US");
const usd = (value: number) => `$${value.toFixed(2)}`;
const label = (value: string) => value.split(/[_.]/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");

function Section({ title, source, children }: { title: string; source: string; children: ReactNode }) {
  return (
    <section className="admin-card p-4">
      <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100">{title}</h2>
      <p className="mb-3 text-[11px] text-gray-400">Source: {source}</p>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-gray-500 dark:text-gray-400">{children}</p>;
}

function StrategyTable({ ranks }: { ranks: StrategyRank[] }) {
  if (ranks.length === 0) return <Empty>No attempts in this state in the last 180 days.</Empty>;
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="text-[10px] uppercase tracking-wider text-gray-400">
          <th className="py-1 pr-3">Strategy</th>
          <th className="py-1 pr-3 text-right">Attempts</th>
          <th className="py-1 pr-3 text-right">Worked</th>
          <th className="py-1 text-right">Success</th>
        </tr>
      </thead>
      <tbody>
        {ranks.map((rank) => (
          <tr key={`${rank.stage}-${rank.strategy}`} className="border-t border-gray-100 dark:border-white/[0.04]">
            <td className="py-1 pr-3 font-mono text-xs text-gray-700 dark:text-gray-300">{rank.strategy}</td>
            <td className="py-1 pr-3 text-right tabular-nums">{num(rank.attempts)}</td>
            <td className="py-1 pr-3 text-right tabular-nums">{num(rank.successes)}</td>
            <td className="py-1 text-right tabular-nums">{Math.round(rank.successRate * 100)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function StateExpertPage({ params }: { params: Promise<{ code: string }> }) {
  await requireAuth("operate");
  const { code } = await params;
  const page = await loadStateExpertPage(sql, code);
  if (!page) notFound();

  const { expert, memory } = page;
  const stateCode = expert.stateCode;
  const stateName = page.stateName ?? stateCode;
  const notOnlineTotal = page.notOnline?.reduce((sum, row) => sum + row.institutions, 0) ?? null;
  const memoryNote = memory
    ? `stored ${memory.refreshedAt ? formatAdminDateTime(memory.refreshedAt) : "at an unknown time"}`
    : "not stored yet: the state-expert lane step has not refreshed this state";

  return (
    <div className="space-y-5">
      <header>
        <Breadcrumbs
          items={[
            { label: "State Lanes", href: "/admin/states" },
            { label: "State Experts", href: "/admin/states/experts" },
            { label: stateCode },
          ]}
        />
        <h1 className="text-xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
          {expert.name}, {stateName} expert
        </h1>
        <p className="max-w-3xl text-sm text-gray-500 dark:text-gray-400">
          {expert.bio} <span className="text-gray-400">({expert.source})</span>
        </p>
        <p className="mt-1 text-[11px] text-gray-400">Memory {memoryNote}.</p>
        <div className="mt-3 flex gap-2">
          <Link
            href={`/admin/states/${stateCode}`}
            className="inline-flex rounded-md border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:border-blue-200 hover:text-blue-700 dark:border-white/[0.08] dark:text-gray-300"
          >
            {stateCode} lane
          </Link>
          <Link
            href="/admin/states/experts"
            className="inline-flex rounded-md border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:border-blue-200 hover:text-blue-700 dark:border-white/[0.08] dark:text-gray-300"
          >
            All experts
          </Link>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Regulator" source={`${STATE_EXPERT_QUERIES.memory}, regulator (from ${memory?.regulator.source ?? "no memory"})`}>
          {memory ? (
            <dl className="space-y-1 text-sm">
              <div>
                <dt className="inline text-gray-500">Banks: </dt>
                <dd className="inline text-gray-900 dark:text-gray-100">
                  {memory.regulator.website ? <a href={memory.regulator.website} className="hover:underline" rel="noreferrer" target="_blank">{memory.regulator.agency ?? "Unknown"}</a> : memory.regulator.agency ?? "Unknown"}
                </dd>
              </div>
              <div>
                <dt className="inline text-gray-500">Credit unions: </dt>
                <dd className="inline text-gray-900 dark:text-gray-100">
                  {memory.regulator.creditUnionWebsite ? <a href={memory.regulator.creditUnionWebsite} className="hover:underline" rel="noreferrer" target="_blank">{memory.regulator.creditUnionAgency ?? "Unknown"}</a> : memory.regulator.creditUnionAgency ?? "Same as banks or unknown"}
                </dd>
              </div>
            </dl>
          ) : (
            <Empty>No stored memory yet.</Empty>
          )}
        </Section>

        <Section title="Website platforms" source={`${STATE_EXPERT_QUERIES.memory}, platforms (top 10)`}>
          {memory && memory.platforms.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {memory.platforms.map((platform) => (
                <li key={platform.platform} className="flex justify-between gap-3">
                  <span className="text-gray-700 dark:text-gray-300">{platform.platform}</span>
                  <span className="tabular-nums text-gray-900 dark:text-gray-100">{num(platform.institutions)} institutions</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>{memory ? "No platform recorded for this state's institutions." : "No stored memory yet."}</Empty>
          )}
        </Section>

        <Section title="Finders that work here" source={`${STATE_EXPERT_QUERIES.memory}, strategies.finder (pipeline_attempts, discover, last 180 days)`}>
          {memory ? <StrategyTable ranks={memory.strategies.finder} /> : <Empty>No stored memory yet.</Empty>}
        </Section>

        <Section title="Readers that work here" source={`${STATE_EXPERT_QUERIES.memory}, strategies.reader (pipeline_attempts, read, last 180 days)`}>
          {memory ? <StrategyTable ranks={memory.strategies.reader} /> : <Empty>No stored memory yet.</Empty>}
        </Section>
      </div>

      <Section title="Dated notes" source={STATE_EXPERT_QUERIES.notes}>
        <StateNotes notes={page.notes} />
      </Section>

      <Section title="Coverage by size group, in work-list order" source={STATE_EXPERT_QUERIES.coverageGaps}>
        {page.coverage.length > 0 ? (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-gray-400">
                <th className="py-1 pr-3">Size group</th>
                <th className="py-1 pr-3 text-right">Institutions</th>
                <th className="py-1 pr-3 text-right">With live fees</th>
                <th className="py-1 pr-3 text-right">Target</th>
                <th className="py-1 text-right">Short</th>
              </tr>
            </thead>
            <tbody>
              {page.coverage.map((group) => (
                <tr key={group.group} className="border-t border-gray-100 dark:border-white/[0.04]">
                  <td className="py-1 pr-3 text-gray-700 dark:text-gray-300">{group.label}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{num(group.total)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{num(group.covered)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{num(group.target)}</td>
                  <td className="py-1 text-right tabular-nums font-semibold">{group.short > 0 ? num(group.short) : "At target"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>No size group under $10B for this state, or the coverage read returned nothing.</Empty>
        )}
        <p className="mt-2 text-[11px] text-gray-400">Institutions over $10B are compared nationally and by district, so they are not in a state&apos;s groups.</p>
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Not published online" source={STATE_EXPERT_QUERIES.notOnline}>
          {page.notOnline == null ? (
            <Empty>Count unavailable.</Empty>
          ) : page.notOnline.length === 0 ? (
            <Empty>No institution in this state is marked not published online.</Empty>
          ) : (
            <ul className="space-y-1 text-sm">
              {page.notOnline.map((row) => (
                <li key={row.tier} className="flex justify-between gap-3">
                  <span className="text-gray-700 dark:text-gray-300">{label(row.tier)}</span>
                  <span className="tabular-nums text-gray-900 dark:text-gray-100">{num(row.institutions)}</span>
                </li>
              ))}
              <li className="flex justify-between gap-3 border-t border-gray-100 pt-1 font-semibold dark:border-white/[0.04]">
                <span>Total</span>
                <span className="tabular-nums">{num(notOnlineTotal ?? 0)}</span>
              </li>
            </ul>
          )}
          <p className="mt-2 text-[11px] text-gray-400">Two paid searches on the current website found no fee schedule; the ladder retries after 120 days.</p>
        </Section>

        <Section title="Work list" source={STATE_EXPERT_QUERIES.workList}>
          {page.workListTotal == null ? (
            <Empty>Work list unavailable.</Empty>
          ) : page.workList.length === 0 ? (
            <Empty>Every institution under $10B in this state has live fees.</Empty>
          ) : (
            <>
              <p className="mb-2 text-xs text-gray-500">
                First {Math.min(WORK_LIST_SHOWN, page.workListTotal)} of {num(page.workListTotal)} institutions with no live fees, in the order the paid passes take them
                (groups furthest below target first, then website on file, known platform, larger assets). Each pass applies its own filters and cap.
              </p>
              <ol className="space-y-1 text-sm">
                {page.workList.map((entry) => (
                  <li key={entry.id} className="flex justify-between gap-3">
                    <Link href={`/admin/institution/${entry.id}`} className="truncate text-gray-900 hover:underline dark:text-gray-100">
                      {entry.name}
                    </Link>
                    <span className="shrink-0 text-xs text-gray-500">
                      {sizeGroupLabel(entry.sizeGroup)}{entry.websiteUrl ? "" : ", no website"}{entry.platform ? `, ${entry.platform}` : ""}
                    </span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </Section>
      </div>

      <Section title="Peer price levels (state-wide)" source={`${STATE_EXPERT_QUERIES.memory}, peer_levels (published_fee_catalog, consumer audience)`}>
        {page.stateWidePeerLevels.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-gray-400">
                  <th className="py-1 pr-3">Fee category</th>
                  <th className="py-1 pr-3 text-right">Institutions</th>
                  <th className="py-1 pr-3 text-right">25th pct</th>
                  <th className="py-1 pr-3 text-right">Median</th>
                  <th className="py-1 text-right">75th pct</th>
                </tr>
              </thead>
              <tbody>
                {page.stateWidePeerLevels.map((level) => (
                  <tr key={level.canonicalFeeKey} className={`border-t border-gray-100 dark:border-white/[0.04] ${level.count < PEER_MIN_INSTITUTIONS ? "text-gray-400" : ""}`}>
                    <td className="py-1 pr-3 font-mono text-xs">{level.canonicalFeeKey}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{num(level.count)}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{usd(level.p25)}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{usd(level.median)}</td>
                    <td className="py-1 text-right tabular-nums">{usd(level.p75)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-gray-400">
              Greyed rows have fewer than {PEER_MIN_INSTITUTIONS} institutions, so Darwin&apos;s peer check does not use them.
            </p>
          </div>
        ) : (
          <Empty>{memory ? "No stored peer levels on the current audience policy." : "No stored memory yet."}</Empty>
        )}
      </Section>
    </div>
  );
}
