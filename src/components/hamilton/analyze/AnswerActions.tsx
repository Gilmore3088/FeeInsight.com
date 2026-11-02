"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { addToWatchlist } from "@/app/pro/(hamilton)/monitor/actions";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";
import type { NextStep } from "@/lib/hamilton/workspace/workbench";
import "./ask-dashboard.css";

/**
 * The answer's action buttons (Ask.dc.html): Try a price, Add to board brief, Watch and Export,
 * each wired to what the workspace already does (the simulator, the report builder, the watchlist
 * and the answer's PDF). The other next steps (Compare peers, Review assumptions) follow as links.
 */
export function AnswerActions({
  steps,
  watch,
  exportControl,
}: {
  /** The standard next steps (standardNextSteps), already carrying the institution. */
  steps: NextStep[];
  /** The institution to watch; none when the answer has no institution. */
  watch?: { institutionId: string; institutionName: string | null } | null;
  /** The answer's export, e.g. its PDF download; only once the answer is saved. */
  exportControl?: ReactNode;
}) {
  const tryPrice = steps.find((s) => s.key === "try_price");
  const brief = steps.find((s) => s.key === "add_to_brief");
  const others = steps.filter((s) => s.key !== "try_price" && s.key !== "add_to_brief");
  const [watched, setWatched] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const watchName = watch?.institutionName ?? "this institution";
  const addWatch = () => start(async () => {
    if (!watch) return;
    const result = await addToWatchlist(watch.institutionId).catch(() => null);
    setWatched(result?.ok
      ? { ok: true, text: `Watching ${watchName}. Its fee changes show in Alerts and watches.` }
      : { ok: false, text: result?.error ?? "The institution could not be watched. Try again." });
  });
  return (
    <div className="ha-actions">
      {tryPrice ? <Link href={tryPrice.href} className="ha-btn ha-btn--primary">{tryPrice.label}</Link> : null}
      {brief ? <Link href={brief.href} className="ha-btn">{brief.label}</Link> : null}
      {watch ? (
        <button type="button" className="ha-btn" aria-pressed={watched?.ok ?? false} disabled={pending || watched?.ok} onClick={addWatch}>
          {watched?.ok ? `Watching ${watchName}` : `Watch ${watchName}`}
        </button>
      ) : null}
      {exportControl}
      {others.length > 0 ? (
        <span className="hd-links">
          {others.map((s) => <Link key={s.key} href={s.href}>{s.label}</Link>)}
        </span>
      ) : null}
      {watched ? (
        <p role={watched.ok ? "status" : "alert"} className={`ha-action-note ${watched.ok ? "" : "hd-tone-bad"}`}>
          {watched.text}{" "}
          {watched.ok && watch ? <Link href={hrefWithInstitutionContext("/pro/monitor", watch.institutionId)} className="text-terra-text">Open Alerts and watches</Link> : null}
        </p>
      ) : null}
    </div>
  );
}
