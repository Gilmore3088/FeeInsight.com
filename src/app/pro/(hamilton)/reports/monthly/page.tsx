// Auth-gated and built from live data on request; not statically prerendered.
export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { redirectWithoutPremium } from "@/lib/team-billing";
import { getHamiltonReportById, getHamiltonReportsByType } from "@/lib/hamilton/pro-tables";
import { resolveHamiltonInstitutionContext } from "@/lib/hamilton/workspace-context";
import { MONTHLY_BRIEFING_REPORT_TYPE, MONTHLY_BRIEFING_SECTIONS, briefingMonth, dayLabel } from "@/lib/hamilton/monthly-briefing";
import { LinkButton, MemoHeader, MemoPage, MemoSection } from "@/components/hamilton/memo/memo";
import { MonthlyBriefingEditor } from "@/components/hamilton/reports/MonthlyBriefingEditor";
import { createMonthlyBriefing } from "./actions";

export const metadata: Metadata = { title: "Monthly briefing" };

const PATH = "/pro/reports/monthly";

const ERRORS: Record<string, string> = {
  build: "The briefing could not be built just now. Try again in a minute.",
  access: "Your account cannot build new briefings right now. Saved briefings stay open to read.",
};

export default async function MonthlyBriefingPage({
  searchParams,
}: {
  searchParams: Promise<{ report_id?: string; instId?: string; error?: string }>;
}) {
  const params = await searchParams;
  const returnPath = params.report_id
    ? `${PATH}?report_id=${encodeURIComponent(params.report_id)}`
    : params.instId ? `${PATH}?instId=${encodeURIComponent(params.instId)}` : PATH;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?from=${encodeURIComponent(returnPath)}`);
  await redirectWithoutPremium(user, returnPath);

  if (params.report_id) {
    const saved = await getHamiltonReportById(params.report_id, user.id).catch(() => null);
    const briefing = saved?.report_type === MONTHLY_BRIEFING_REPORT_TYPE ? saved.report_json.monthlyBriefing : undefined;
    if (!saved || !briefing) return <p role="alert" className="mx-auto max-w-3xl text-sm text-warm-800">Saved briefing not found or unavailable.</p>;
    return <MonthlyBriefingEditor key={saved.id} reportId={saved.id} title={saved.report_json.title} briefing={briefing} />;
  }

  const { institution } = await resolveHamiltonInstitutionContext({ userId: user.id, instId: params.instId, intent: "reports", persistUrlSelection: false });
  if (!institution) {
    return (
      <MemoPage width="reading">
        <MemoHeader kicker="Reports" title="Monthly briefing" dek="Choose your bank or credit union first, and Hamilton builds its monthly briefing here." />
        <div><LinkButton href="/pro/settings">Choose your institution</LinkButton></div>
      </MemoPage>
    );
  }

  // Every briefing for this institution, however old: the list is read by type, not from the 90-day library.
  const earlier = await getHamiltonReportsByType({ userId: user.id, reportType: MONTHLY_BRIEFING_REPORT_TYPE, institutionId: String(institution.id) }).catch(() => []);
  const { monthLabel } = briefingMonth(new Date());
  const error = params.error ? ERRORS[params.error] : null;

  return (
    <MemoPage width="reading">
      <MemoHeader
        kicker={institution.name}
        title="Monthly briefing"
        dek={`One briefing for ${monthLabel} on a fixed template, built from your filings, your peer group's published fees, the state economy and the regulatory record. Every figure shows its source and period.`}
      />
      {error ? <p role="alert" className="rounded-md border border-[var(--fi-brick)] p-3 text-sm text-[var(--fi-brick)]">{error}</p> : null}

      <MemoSection title="What it covers" note="You can edit the words in every section before you download the PDF. The figures stay as Hamilton built them.">
        <ol className="grid list-decimal grid-cols-1 gap-x-8 gap-y-1 pl-5 text-base text-warm-900 sm:grid-cols-2">
          {MONTHLY_BRIEFING_SECTIONS.map((s) => <li key={s.id}>{s.heading}</li>)}
        </ol>
        <form action={createMonthlyBriefing} className="pt-2">
          <input type="hidden" name="instId" value={String(institution.id)} />
          <button type="submit" className="inline-flex min-h-11 items-center rounded-md bg-terra px-3.5 py-2 text-sm font-medium text-white hover:bg-terra-dark sm:min-h-9">
            Build the {monthLabel} briefing
          </button>
        </form>
        <p className="text-xs text-warm-600">Built only when you ask. Nothing is scheduled or sent by email.</p>
      </MemoSection>

      <MemoSection title="Earlier briefings">
        {earlier.length ? (
          <ul className="flex flex-col divide-y divide-warm-200 rounded-md border border-warm-300 bg-warm-50">
            {earlier.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-4 px-3 py-2 text-sm">
                <Link href={`${PATH}?report_id=${encodeURIComponent(r.id)}`} className="min-w-0 text-terra-text underline">{r.title}</Link>
                <span className="text-xs text-warm-600">Built {dayLabel(new Date(r.created_at).toISOString())}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-warm-700">No briefings for {institution.name} yet.</p>
        )}
      </MemoSection>
    </MemoPage>
  );
}
