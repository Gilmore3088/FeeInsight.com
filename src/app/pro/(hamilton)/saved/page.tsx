export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import { LocalDate } from "@/components/hamilton/common/LocalDate";
import { listSavedAnalyses } from "../analyze/actions";
/** Tab title like the other Hamilton pages ("Peer group | Hamilton"); site check 2026-11-01. */
export const metadata: Metadata = { title: "Saved analyses" };

export default async function SavedAnalysesPage() {
  const rows = await listSavedAnalyses(50);
  return <div className="mx-auto max-w-5xl"><h1 className="text-3xl font-semibold">Saved analyses</h1><p className="mt-2 text-[var(--fi-muted)]">Reopen a saved answer, or turn it into a board brief.</p><div className="ask-recent mt-8">{rows.map(r => <div key={r.id} className="ask-recent-row"><Link href={`/pro/analyze?analysis=${encodeURIComponent(r.id)}`}><span>{r.title}</span><LocalDate iso={r.updated_at} options={{ month: "short", day: "numeric", year: "numeric" }} className="text-xs text-[var(--fi-muted)]" /></Link><Link className="shrink-0 text-sm !text-[var(--fi-brick)]" href={`/pro/reports?from_analysis=${encodeURIComponent(r.id)}`}>Build board brief</Link></div>)}</div>{rows.length === 0 ? <p className="mt-8 text-sm text-[var(--fi-muted)]">No saved analyses yet. <Link className="text-[var(--fi-brick)] underline" href="/pro/analyze">Ask Hamilton a question</Link>, or use Build board brief on the <Link className="text-[var(--fi-brick)] underline" href="/pro/hamilton">Overview</Link>.</p> : null}</div>;
}
