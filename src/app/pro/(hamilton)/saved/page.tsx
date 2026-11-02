export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import { LocalDate } from "@/components/hamilton/common/LocalDate";
import { DashboardCard, signedMoney, formatFigure } from "@/components/hamilton/dashboard";
import { getCurrentUser } from "@/lib/auth";
import { getActiveScenarios } from "@/lib/hamilton/pro-tables";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { plainFeeName } from "@/lib/hamilton/briefing-observations";
import { directionalTitle } from "@/lib/hamilton/workspace/names";
import { listSavedAnalyses } from "../analyze/actions";
/** Tab title like the other Hamilton pages ("Peer group | Hamilton"); site check 2026-11-01. */
export const metadata: Metadata = { title: "Saved analyses" };

const money = (v: number) => formatFigure(v, "money");

/** The reader's saved price tests (hamilton_scenarios); none on a failed read rather than a failed page. */
async function savedScenarios() {
  const user = await getCurrentUser().catch(() => null);
  if (!user) return [];
  try {
    return await getActiveScenarios(user.id);
  } catch {
    return [];
  }
}

export default async function SavedAnalysesPage() {
  const [rows, scenarios] = await Promise.all([listSavedAnalyses(50), savedScenarios()]);
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 text-warm-900">
      <header className="flex flex-col gap-1.5">
        <p className="hd-label" style={{ color: "var(--fi-brick)" }}>Try a price</p>
        <h1 className="m-0 text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">Saved analyses</h1>
        <p className="m-0 text-sm text-[var(--fi-muted)]">Reopen a saved answer or price test, or turn it into a board brief.</p>
      </header>

      <DashboardCard title="Saved answers" titleId="saved-answers" actions={<span className="hd-mono text-xs text-[var(--fi-muted)]">{rows.length}</span>}>
        {rows.length > 0 ? (
          <div className="ask-recent">
            {rows.map((r) => (
              <div key={r.id} className="ask-recent-row">
                <Link href={`/pro/analyze?analysis=${encodeURIComponent(r.id)}`}>
                  <span>{r.title}</span>
                  <LocalDate iso={r.updated_at} options={{ month: "short", day: "numeric", year: "numeric" }} className="text-xs text-[var(--fi-muted)]" />
                </Link>
                <Link className="shrink-0 text-sm !text-[var(--fi-brick)]" href={`/pro/reports?from_analysis=${encodeURIComponent(r.id)}`}>Build board brief</Link>
              </div>
            ))}
          </div>
        ) : (
          <p className="m-0 text-sm text-[var(--fi-muted)]">
            No saved analyses yet. <Link className="text-[var(--fi-brick)] underline" href="/pro/analyze">Ask Hamilton a question</Link>, or use Build board brief on the{" "}
            <Link className="text-[var(--fi-brick)] underline" href="/pro/hamilton">Overview</Link>.
          </p>
        )}
      </DashboardCard>

      <DashboardCard title="Saved scenarios" titleId="saved-scenarios" actions={<span className="hd-mono text-xs text-[var(--fi-muted)]">{scenarios.length}</span>}>
        {scenarios.length > 0 ? (
          <div className="ask-recent">
            {scenarios.map((s) => {
              const fee = directionalTitle(s.fee_category) ?? plainFeeName(getDisplayName(s.fee_category));
              const from = Number(s.current_value);
              const to = Number(s.proposed_value);
              return (
                <div key={String(s.id)} className="ask-recent-row">
                  <Link href={`/pro/simulate?scenario_id=${encodeURIComponent(String(s.id))}`}>
                    <span>{fee}: {money(from)} to {money(to)} <span className="hd-mono text-xs text-[var(--fi-muted)]">({signedMoney(to - from)})</span></span>
                    <LocalDate iso={new Date(s.created_at).toISOString()} options={{ month: "short", day: "numeric", year: "numeric" }} className="text-xs text-[var(--fi-muted)]" />
                  </Link>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="m-0 text-sm text-[var(--fi-muted)]">
            No saved scenarios yet. <Link className="text-[var(--fi-brick)] underline" href="/pro/simulate">Try a price</Link> and choose Save scenario.
          </p>
        )}
      </DashboardCard>
    </div>
  );
}
