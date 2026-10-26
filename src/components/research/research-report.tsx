import { researchExhibits } from "@/lib/research-database/presentation";
import type { ResearchSnapshot } from "@/lib/research-database/types";

export function ResearchReport({ snapshot }: { snapshot: ResearchSnapshot }) {
  const exhibits = researchExhibits(snapshot);
  return <div className="space-y-8">
    <p className="text-sm text-ink-muted">Evidence captured {snapshot.capturedAt.slice(0, 10)}. Fee benchmarks use verified published evidence.</p>
    {snapshot.footprint && <section aria-label="Institution footprint" className="rounded-xl border border-border p-5">
      <h2 className="text-xl font-semibold">Institution footprint</h2>
      <p>{snapshot.footprint.matchedBranches} of {snapshot.footprint.branches} branches mapped across {snapshot.footprint.counties.length} counties. Branch vintage: {snapshot.footprint.vintage ?? "Unavailable"}.</p>
      <p>Coverage: {snapshot.footprint.status}. {snapshot.footprint.unmatchedBranches} branches have no current county placement.</p>
      <details><summary>County identifiers</summary><p className="break-words">{snapshot.footprint.counties.join(", ")}</p></details>
    </section>}
    {snapshot.request.modules.map(module => <section key={module}>
      <h2 className="mb-4 text-2xl font-semibold">{({ market: "Market opportunity", performance: "Institution performance", fees: "Fees and consumer costs" })[module]}</h2>
      {!exhibits.some(c => c.module === module) && <p>No comparable observations are available for this section.</p>}
      <div className="grid gap-4 md:grid-cols-2">{exhibits.filter(c => c.module === module).map((cell, i) => <article key={`${cell.key}:${cell.cohort}:${i}`} className="min-w-0 rounded-xl border border-border p-5">
        <h3 className="font-semibold">{cell.label}</h3><p className="text-sm text-ink-muted">{cell.cohort.replaceAll("_", " ")}</p>
        <p className="my-3 text-3xl tabular-nums">{cell.formatted}</p>
        <p className="text-sm">Period: {cell.period ?? "Unavailable"}. Coverage: {cell.observed} / {cell.eligible}. Status: {cell.status}.</p>
        {snapshot.request.cadence === "monthly" && <p className="text-sm">{({ first_edition: "First observation in this series of reports.", new_period: "New source reporting period.", same_period: "Source reporting period unchanged.", snapshot_refresh: "Current catalog snapshot; fee movement is not inferred." })[cell.releaseStatus ?? "first_edition"]}</p>}
        <details className="mt-3 text-sm"><summary className="cursor-pointer">Calculation and sources</summary>
          <p className="mt-2">{cell.definition}</p><p>{cell.note}</p>
          <ul>{cell.sourceUrls.map(url => <li key={url}><a className="underline break-words" href={url} target="_blank" rel="noopener noreferrer">{new URL(url).hostname}</a></li>)}</ul>
        </details>
      </article>)}</div>
    </section>)}
    <section><h2 className="mb-3 text-xl font-semibold">Methodology and limitations</h2>
      <ul className="list-disc space-y-2 pl-5">{snapshot.limitations.map(l => <li key={l}>{l}</li>)}</ul>
      <p className="mt-4 break-all text-xs text-ink-muted">Method {snapshot.metricVersion}. Snapshot {snapshot.snapshotHash}.</p>
    </section>
  </div>;
}
