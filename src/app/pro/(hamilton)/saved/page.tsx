export const dynamic = "force-dynamic";
import Link from "next/link";
import { listSavedAnalyses } from "../analyze/actions";
export default async function SavedAnalysesPage() {
  const rows = await listSavedAnalyses(50);
  return <div className="mx-auto max-w-5xl"><h1 className="text-3xl font-semibold">Saved analyses</h1><p className="mt-2 text-warm-600">Reopen your questions with their original research context.</p><div className="ask-recent mt-8">{rows.map(r => <Link key={r.id} href={`/pro/analyze?analysis=${encodeURIComponent(r.id)}`}><span>{r.title}</span><span className="text-xs text-warm-600">{r.updated_at.slice(0,10)}</span></Link>)}</div>{rows.length === 0 ? <p className="mt-8 text-sm text-warm-600">No saved analyses are available. <Link className="text-terra-text underline" href="/pro/analyze">Start a question</Link></p> : null}</div>;
}
