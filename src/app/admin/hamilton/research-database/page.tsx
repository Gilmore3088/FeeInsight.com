import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { getResearchReadiness, getResearchTableProfiles } from "@/lib/data-store/research-database";
import { RESEARCH_METRICS } from "@/lib/research-database/metrics";
import { createResearchReport } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Research database" };

export default async function ResearchDatabasePage({ searchParams }: { searchParams: Promise<{ profile?: string }> }) {
  await requireAuth("operate");
  const audit = await getResearchReadiness();
  const profiles = (await searchParams).profile === "1" ? await getResearchTableProfiles() : [];
  return <div className="space-y-8 p-6">
    <h1 className="text-3xl font-semibold">Research database</h1>
    <p>Review public-source readiness, then prepare a national outlook or an institution footprint report. Publication requires editorial approval.</p>
    <form action={createResearchReport} className="flex flex-wrap items-end gap-4 rounded-xl border p-5">
      <label>Research scope<select name="scope" className="block rounded border p-2"><option value="national">National</option><option value="footprint">Institution footprint</option></select></label>
      <label>Institution ID<input type="number" name="institutionId" min="1" step="1" className="block rounded border p-2" aria-describedby="institution-help" /></label>
      <label>Edition<select name="cadence" className="block rounded border p-2"><option value="quarterly">Quarterly outlook</option><option value="monthly">Monthly pulse</option></select></label>
      <button className="rounded bg-blue-700 px-4 py-2 text-white">Prepare research report</button>
      <p id="institution-help" className="w-full text-sm">Footprint reports require a canonical institution ID. <Link href="/admin/institutions" className="underline">Find an institution</Link>. Preparation uses deterministic calculations and the agent run ledger.</p>
    </form>
    <section><h2 className="mb-3 text-xl font-semibold">Table coverage audit</h2>
      <Link href="?profile=1" className="underline">Run exact row, missing-field and duplicate counts</Link>
      <p className="text-sm">Read-only profiling covers the initial research tables. Missing counts refer to essential fields; they do not grade every column.</p>
      {profiles.map(p => <p key={p.table} className="mt-2 break-words">{p.table}: {p.error ? `Read failed: ${p.error}` : `${p.rows} rows; ${p.missing} rows missing essential fields; ${p.duplicates} duplicate keys; periods ${p.earliest ?? "Unavailable"} to ${p.latest ?? "Unavailable"}.`}</p>)}
    </section>
    <section><h2 className="mb-3 text-xl font-semibold">Source readiness</h2>
      <p className="mb-3 text-sm">These are recorded ingestion receipts, not table row counts or a certification of completeness. Each report measures its own usable observations.</p>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Source</th><th>Status</th><th>Latest loaded period</th><th>Loaded partitions</th><th>Evidence</th></tr></thead>
        <tbody>{audit.map(row => <tr key={row.source} className="border-t"><th scope="row" className="p-3">{row.source}<span className="block font-normal">{row.publisher}</span></th><td className="p-3">{row.status}</td><td className="p-3">{row.latestPeriod ?? "Unmeasured"}</td><td className="p-3">{row.loadedPartitions}</td><td className="max-w-lg p-3">{row.reason}<br />Licence: {row.licence}</td></tr>)}</tbody>
      </table></div>
    </section>
    <section><h2 className="mb-3 text-xl font-semibold">Metric catalog</h2><dl className="space-y-3">{RESEARCH_METRICS.map(metric => <div key={metric.key}><dt className="font-semibold">{metric.label}</dt><dd>{metric.definition} Freshness limit: {metric.maxAgeDays} days.</dd></div>)}</dl></section>
    <Link href="/admin/hamilton/reports" className="underline">Review prepared reports</Link>
  </div>;
}
