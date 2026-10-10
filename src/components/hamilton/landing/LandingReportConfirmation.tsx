"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { saveLandingResearchReport } from "@/app/pro/(hamilton)/reports/actions";
import type { LandingResearchHandoff } from "@/lib/hamilton/landing-research-handoff";
import { LandingResearchResults } from "./LandingResearchResults";

export function LandingReportConfirmation({ selection }: { selection: LandingResearchHandoff }) {
  // Consent applies only to the selection the user reviewed, including its subject.
  return <ConfirmationForSelection key={JSON.stringify(selection)} selection={selection} />;
}

function ConfirmationForSelection({ selection }: { selection: LandingResearchHandoff }) {
  const router = useRouter();
  const mounted = useRef(true);
  const saving = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    if (!confirmed || saving.current) return;
    saving.current = true;
    setBusy(true); setError(null);
    try {
      const result = await saveLandingResearchReport({ research: selection, confirmed: true });
      // The confirmed save may finish, but must not hijack a different selection.
      if (!mounted.current) return;
      if (!result.success) throw new Error(result.error);
      router.push(`/pro/reports?report_id=${encodeURIComponent(result.reportId)}`);
    } catch (e) {
      if (!mounted.current) return;
      saving.current = false;
      setError(e instanceof Error ? e.message : "Could not save the draft.");
      setBusy(false);
    }
  }
  return <div className="space-y-5">
    <LandingResearchResults selection={{ ...selection, task: "compare" }} />
    <section aria-label="Confirm board report" className="space-y-3 rounded-xl border p-5">
      <h2 className="text-lg font-semibold">Save a board research draft</h2>
      <p className="text-sm">Save current published figures for exactly this selection to your Reports library. Open it again there and download the PDF. This is a data-only draft for review, with no generated pricing advice.</p>
      <label className="block"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={busy} /> I confirm this selection and want to create a saved report.</label>
      <button type="button" onClick={() => void save()} disabled={!confirmed || busy} className="rounded bg-warm-900 px-4 py-2 text-white disabled:opacity-50">{busy ? "Saving report…" : "Create and save board draft"}</button>
      {error && <p role="alert">{error}</p>}
    </section>
  </div>;
}
