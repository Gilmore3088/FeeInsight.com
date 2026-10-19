"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { addAnswerToDecision } from "@/app/pro/(hamilton)/analyze/answer-actions";
import { addToWatchlist } from "@/app/pro/(hamilton)/monitor/actions";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";
import { proseFeeName } from "@/lib/hamilton/workspace/names";

type Outcome = { ok: true; text: string; href: string; link: string } | { ok: false; text: string } | null;

const actionClass = "min-h-11 rounded-md border border-warm-300 bg-warm-50 px-3.5 py-2 text-sm font-medium text-warm-800 hover:border-warm-500 disabled:opacity-50 sm:min-h-9";

/**
 * After an answer, the four ways to carry it into ongoing work (#2045): it is saved, it can join
 * the decision on its fee, its institution can be watched, and it can go into a report. Each
 * step points at the saved answer, so its sources and peer group go with it.
 */
export function AnswerFollowThrough({ analysisId, institutionId, institutionName, feeCategory, inDecision = false, report }: {
  /** The saved answer; nothing here works until the answer is saved. */
  analysisId: string | null;
  institutionId: string | null;
  institutionName: string | null;
  /** The fee the answer is about; a decision is kept per fee. */
  feeCategory: string | null;
  /** The Ask engine already filed this answer in the decision on its fee. */
  inDecision?: boolean;
  /** The report actions: Add to report, and Build board brief where the answer view has none. */
  report: ReactNode;
}) {
  const [decision, setDecision] = useState<Outcome>(null);
  const [watch, setWatch] = useState<Outcome>(null);
  const [pending, start] = useTransition();
  if (!analysisId) return null;
  const monitorHref = hrefWithInstitutionContext("/pro/monitor", institutionId);
  const watchName = institutionName ?? "this institution";

  const addDecision = () => start(async () => {
    if (!feeCategory) return;
    const result = await addAnswerToDecision(analysisId, feeCategory).catch(() => null);
    setDecision(result?.ok
      ? { ok: true, text: `Added to your decision on the ${result.feeName}.`, href: monitorHref, link: "See your decisions" }
      : { ok: false, text: result?.error ?? "The answer could not be added. Try again." });
  });
  const addWatch = () => start(async () => {
    if (!institutionId) return;
    const result = await addToWatchlist(institutionId).catch(() => null);
    setWatch(result?.ok
      ? { ok: true, text: `Watching ${watchName}. Its fee changes show in Alerts and watches.`, href: monitorHref, link: "Open Alerts and watches" }
      : { ok: false, text: result?.error ?? "The institution could not be watched. Try again." });
  });

  return (
    <section aria-labelledby={`use-answer-${analysisId}`} className="flex flex-col gap-3 rounded-lg border border-warm-300 bg-white p-4">
      <h2 id={`use-answer-${analysisId}`} className="text-xs font-medium uppercase tracking-[0.08em] text-warm-600">Use this answer</h2>
      <ul className="flex flex-col gap-3 text-sm text-warm-800">
        <li className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span><span aria-hidden="true">✓ </span>Saved</span>
          <Link href={hrefWithInstitutionContext("/pro/saved", institutionId)} className="text-terra-text underline-offset-2 hover:underline">Open saved analyses</Link>
        </li>
        {feeCategory && institutionId ? (
          <li className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {inDecision ? <span><span aria-hidden="true">✓ </span>In your decision on the {proseFeeName(feeCategory)} fee</span>
              : decision?.ok ? null : <button type="button" className={actionClass} disabled={pending} onClick={addDecision}>Add to a decision</button>}
            <OutcomeLine outcome={decision} />
          </li>
        ) : null}
        {institutionId ? (
          <li className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {watch?.ok ? null : <button type="button" className={actionClass} disabled={pending} onClick={addWatch}>Watch {watchName}</button>}
            <OutcomeLine outcome={watch} />
          </li>
        ) : null}
        <li className="flex flex-wrap items-center gap-x-3 gap-y-1">{report}</li>
      </ul>
      <p className="text-xs text-warm-600">A report built from this answer keeps its sources and peer group. If a fee it used changes, the saved answer says so.</p>
    </section>
  );
}

function OutcomeLine({ outcome }: { outcome: Outcome }) {
  if (!outcome) return null;
  if (!outcome.ok) return <span role="alert" className="text-xs text-terra-text">{outcome.text}</span>;
  return (
    <span role="status" className="text-sm">
      <span aria-hidden="true">✓ </span>{outcome.text} <Link href={outcome.href} className="text-terra-text underline-offset-2 hover:underline">{outcome.link}</Link>
    </span>
  );
}
