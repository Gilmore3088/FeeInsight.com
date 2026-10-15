export const dynamic = "force-dynamic";
import Link from "next/link";
import { listSavedAnalyses } from "../analyze/actions";
export default async function SavedAnalysesPage() {
  const rows = await listSavedAnalyses(50);
  return <div className="mx-auto max-w-5xl"><h1 className="text-3xl font-semibold">Saved analyses</h1><p className="mt-2 text-[var(--fi-muted)]">Reopen your questions with their original research context.</p><div className="ask-recent mt-8">{rows.map(r => <div key={r.id} className="ask-recent-row"><Link href={`/pro/analyze?analysis=${encodeURIComponent(r.id)}`}><span>{r.title}</span><span className="text-xs text-[var(--fi-muted)]">{r.updated_at.slice(0,10)}</span></Link><Link className="shrink-0 text-sm !text-[var(--fi-brick)]" href={`/pro/reports?from_analysis=${encodeURIComponent(r.id)}`}>Create board brief</Link></div>)}</div>{rows.length === 0 ? <p className="mt-8 text-sm text-[var(--fi-muted)]">No saved analyses are available. <Link className="text-[var(--fi-brick)] underline" href="/pro/analyze">Start a question</Link></p> : null}</div>;
}
