/**
 * HamiltonBriefing — the lead of the Benchmark page: Hamilton as the banking expert.
 * Its written read (the AI thesis) when one exists, the institution's largest gap from
 * published data, then the state, Fed district and regulatory context side by side. Every context line is a stored fact shown with its source and
 * date; nothing here is placeholder or sample text.
 * Server component — no "use client".
 */

import Link from "next/link";
import { formatAmount } from "@/lib/format";
import type { ThesisOutput } from "@/lib/hamilton/types";
import type {
  ExpertDistrictContext,
  ExpertRegulatoryItem,
  ExpertStateContext,
} from "@/lib/hamilton/expert-context";
import type { InstitutionPositioning } from "@/lib/hamilton/institution-position";
import { headlineFor } from "./PositionOverview";

interface HamiltonBriefingProps {
  thesis: ThesisOutput | null;
  blockingPolicies: string[];
  isAdmin: boolean;
  analyzeHref: string;
  positioning: InstitutionPositioning | null;
  state: ExpertStateContext | null;
  district: ExpertDistrictContext | null;
  regulation: ExpertRegulatoryItem[];
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** "3 of your 5 fees with a Texas median sit above it." */
export function stateComparison(
  positioning: InstitutionPositioning | null,
  state: ExpertStateContext | null,
): { line: string; above: number; compared: number; biggest: { name: string; yours: number; median: number } | null } | null {
  if (!positioning || !state) return null;
  let above = 0;
  let compared = 0;
  let biggest: { name: string; yours: number; median: number; pct: number } | null = null;
  for (const entry of positioning.entries) {
    const level = state.medians[entry.feeCategory];
    if (!level || level.median <= 0) continue;
    compared += 1;
    const pct = ((entry.yourAmount - level.median) / level.median) * 100;
    if (pct >= 10) above += 1;
    if (!biggest || Math.abs(pct) > Math.abs(biggest.pct)) {
      biggest = { name: entry.displayName, yours: entry.yourAmount, median: level.median, pct };
    }
  }
  if (compared === 0) return null;
  return {
    line: `${above} of your ${compared} fee${compared === 1 ? "" : "s"} with a ${state.stateName} median sit${above === 1 ? "s" : ""} 10% or more above it.`,
    above,
    compared,
    biggest: biggest ? { name: biggest.name, yours: biggest.yours, median: biggest.median } : null,
  };
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3
      className="text-xs font-semibold"
      style={{ color: "var(--hamilton-text-secondary)", fontFamily: "var(--hamilton-font-sans)" }}
    >
      {children}
    </h3>
  );
}

export function HamiltonBriefing({
  thesis,
  blockingPolicies,
  isAdmin,
  analyzeHref,
  positioning,
  state,
  district,
  regulation,
}: HamiltonBriefingProps) {
  const comparison = stateComparison(positioning, state);
  const headline = positioning ? headlineFor(positioning) : null;
  const lead = thesis?.core_thesis ?? headline;
  return (
    <section
      className="rounded-xl border"
      style={{ borderColor: "var(--hamilton-outline-variant)", backgroundColor: "var(--hamilton-surface-container-lowest)" }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-3.5" style={{ borderColor: "var(--hamilton-border)" }}>
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
            style={{ background: "var(--hamilton-gradient-cta)" }}
            aria-hidden="true"
          >
            H
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold" style={{ color: "var(--hamilton-on-surface)", fontFamily: "var(--hamilton-font-sans)" }}>
              Hamilton&apos;s briefing
            </h2>
            <p className="text-xs" style={{ color: "var(--hamilton-text-tertiary)" }}>
              Your fees read against state, local and regulatory context
            </p>
          </div>
        </div>
        <Link href={analyzeHref} className="text-sm font-medium no-underline hover:underline" style={{ color: "var(--hamilton-primary)" }}>
          Ask Hamilton a follow-up →
        </Link>
      </div>

      {/* Lead: Hamilton's written read, then the largest gap from published data */}
      <div className="px-6 py-5">
        {lead && (
          <p className="text-balance text-xl font-medium leading-snug sm:text-2xl" style={{ color: "var(--hamilton-on-surface)" }}>
            {lead}
          </p>
        )}
        {thesis?.narrative_summary && (
          <p className="mt-2 max-w-3xl text-pretty text-sm leading-relaxed" style={{ color: "var(--hamilton-text-secondary)" }}>
            {thesis.narrative_summary}
          </p>
        )}
        {thesis && headline && (
          <p className="mt-3 text-pretty text-sm font-medium" style={{ color: "var(--hamilton-on-surface)" }}>
            For your institution: {headline}
          </p>
        )}
        {!thesis && (
          <>
            <p className={`${lead ? "mt-2 " : ""}max-w-3xl text-pretty text-sm leading-relaxed`} style={{ color: "var(--hamilton-text-secondary)" }}>
              Hamilton&apos;s written analysis is paused right now. Everything in this briefing comes straight from
              published fee data and the sources named below.
            </p>
            {isAdmin && blockingPolicies.length > 0 && (
              <p className="mt-2 rounded-md px-3 py-2 text-xs" style={{ backgroundColor: "#fff7ed", color: "#9a3412" }}>
                Admin only: AI spending is switched off for{" "}
                {blockingPolicies.map((key, i) => (
                  <span key={key}>
                    {i > 0 && ", "}
                    <code>{key}</code>
                  </span>
                ))}
                . Turn these on with spending caps to bring the analysis back.
              </p>
            )}
          </>
        )}
      </div>

      {/* Context: state, Fed district and regulation side by side */}
      <div
        className="grid grid-cols-1 divide-y border-t lg:grid-cols-3 lg:divide-x lg:divide-y-0"
        style={{ borderColor: "var(--hamilton-border)" }}
      >
        <div className="px-6 py-4">
          <SectionLabel>{state ? state.stateName : "State"}</SectionLabel>
          {!state ? (
            <p className="mt-1 text-pretty text-sm" style={{ color: "var(--hamilton-text-secondary)" }}>
              Choose your institution to see how its fees compare within its state.
            </p>
          ) : (
            <>
              {comparison ? (
                <p className="mt-1 text-pretty text-sm font-medium" style={{ color: "var(--hamilton-on-surface)" }}>
                  {comparison.line}
                  {comparison.biggest && (
                    <span className="font-normal" style={{ color: "var(--hamilton-text-secondary)" }}>
                      {" "}Widest gap: {comparison.biggest.name}, {formatAmount(comparison.biggest.yours)} against a state median of{" "}
                      {formatAmount(comparison.biggest.median)}.
                    </span>
                  )}
                </p>
              ) : (
                <p className="mt-1 text-pretty text-sm" style={{ color: "var(--hamilton-text-secondary)" }}>
                  {Object.keys(state.medians).length === 0
                    ? `Too few ${state.stateName} institutions publish fees yet for state medians.`
                    : `None of these fees has a ${state.stateName} median yet.`}
                </p>
              )}
              {state.regulator && (
                <p className="mt-2 text-pretty text-xs" style={{ color: "var(--hamilton-text-secondary)" }}>
                  State regulator:{" "}
                  {state.regulatorUrl ? (
                    <a href={state.regulatorUrl} target="_blank" rel="noreferrer" className="underline">
                      {state.regulator}
                    </a>
                  ) : (
                    state.regulator
                  )}
                  {state.creditUnionRegulator && ` (credit unions: ${state.creditUnionRegulator})`}
                </p>
              )}
              {state.expertName && (
                <p className="mt-1 text-pretty text-xs" style={{ color: "var(--hamilton-text-tertiary)" }}>
                  Hamilton&apos;s {state.stateName} desk is named for {state.expertName}. {state.expertBio}
                </p>
              )}
            </>
          )}
        </div>

        <div className="px-6 py-4">
          <SectionLabel>{district ? `${district.name} Fed district` : "Fed district"}</SectionLabel>
          {district?.beigeBook ? (
            <>
              <p className="mt-1 text-pretty text-sm" style={{ color: "var(--hamilton-on-surface)" }}>
                &ldquo;{district.beigeBook.text}&rdquo;
              </p>
              <p className="mt-1 text-pretty text-xs" style={{ color: "var(--hamilton-text-tertiary)" }}>
                Federal Reserve Beige Book, {district.beigeBook.releaseDate}
              </p>
            </>
          ) : (
            <p className="mt-1 text-pretty text-sm" style={{ color: "var(--hamilton-text-secondary)" }}>
              {district
                ? "No Beige Book summary is stored for this district yet."
                : "Choose your institution to see its Federal Reserve district outlook."}
            </p>
          )}
        </div>

        <div className="px-6 py-4">
          <SectionLabel>Regulation</SectionLabel>
          {regulation.length === 0 ? (
            <p className="mt-1 text-pretty text-sm" style={{ color: "var(--hamilton-text-secondary)" }}>
              No fee-related regulatory items in the news feed yet.
            </p>
          ) : (
            <ul className="mt-1 flex flex-col gap-2">
              {regulation.map((item) => (
                <li key={item.link}>
                  <a href={item.link} target="_blank" rel="noreferrer" className="text-pretty text-sm no-underline hover:underline" style={{ color: "var(--hamilton-on-surface)" }}>
                    {item.title}
                  </a>
                  <p className="text-xs" style={{ color: "var(--hamilton-text-tertiary)" }}>
                    {item.source} · {item.topic}
                    {item.publishedAt && ` · ${formatDate(item.publishedAt)}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
