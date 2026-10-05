/**
 * HamiltonBriefing — Hamilton as the banking expert beside the numbers: its written
 * read (the AI thesis) when one exists, then the state, Fed district and regulatory
 * context it draws on. Every context line is a stored fact shown with its source and
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
  return (
    <section
      className="rounded-xl border"
      style={{ borderColor: "var(--hamilton-outline-variant)", backgroundColor: "var(--hamilton-surface-container-lowest)" }}
    >
      <div className="flex items-center gap-2.5 border-b px-5 py-3" style={{ borderColor: "var(--hamilton-border)" }}>
        <span
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
          style={{ background: "var(--hamilton-gradient-cta)" }}
          aria-hidden="true"
        >
          H
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold" style={{ color: "var(--hamilton-on-surface)", fontFamily: "var(--hamilton-font-sans)" }}>
            Hamilton&apos;s briefing
          </h2>
          <p className="text-xs" style={{ color: "var(--hamilton-text-tertiary)" }}>
            State, local and regulatory context behind these fees
          </p>
        </div>
      </div>

      <div className="flex flex-col divide-y" style={{ borderColor: "var(--hamilton-border)" }}>
        {/* Hamilton's written read */}
        <div className="px-5 py-4">
          {thesis ? (
            <>
              <p className="text-[15px] font-medium leading-relaxed" style={{ color: "var(--hamilton-on-surface)" }}>
                {thesis.core_thesis}
              </p>
              {thesis.narrative_summary && (
                <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--hamilton-text-secondary)" }}>
                  {thesis.narrative_summary}
                </p>
              )}
              <Link href={analyzeHref} className="mt-2 inline-block text-xs font-medium no-underline hover:underline" style={{ color: "var(--hamilton-primary)" }}>
                Ask Hamilton a follow-up →
              </Link>
            </>
          ) : (
            <>
              <p className="text-sm leading-relaxed" style={{ color: "var(--hamilton-text-secondary)" }}>
                Hamilton&apos;s written analysis is paused right now. The context below and every number on
                this page come straight from published data.
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

        {/* State */}
        {state && (
          <div className="px-5 py-4">
            <SectionLabel>{state.stateName}</SectionLabel>
            {comparison ? (
              <p className="mt-1 text-sm font-medium" style={{ color: "var(--hamilton-on-surface)" }}>
                {comparison.line}
                {comparison.biggest && (
                  <span className="font-normal" style={{ color: "var(--hamilton-text-secondary)" }}>
                    {" "}Widest gap: {comparison.biggest.name}, {formatAmount(comparison.biggest.yours)} against a state median of{" "}
                    {formatAmount(comparison.biggest.median)}.
                  </span>
                )}
              </p>
            ) : (
              <p className="mt-1 text-sm" style={{ color: "var(--hamilton-text-secondary)" }}>
                {Object.keys(state.medians).length === 0
                  ? `Too few ${state.stateName} institutions publish fees yet for state medians.`
                  : `None of these fees has a ${state.stateName} median yet.`}
              </p>
            )}
            {state.regulator && (
              <p className="mt-1.5 text-xs" style={{ color: "var(--hamilton-text-secondary)" }}>
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
              <p className="mt-1 text-xs" style={{ color: "var(--hamilton-text-tertiary)" }}>
                Hamilton&apos;s {state.stateName} desk is named for {state.expertName}. {state.expertBio}
              </p>
            )}
          </div>
        )}

        {/* Fed district */}
        {district && (
          <div className="px-5 py-4">
            <SectionLabel>{district.name} Fed district</SectionLabel>
            {district.beigeBook ? (
              <>
                <p className="mt-1 text-sm" style={{ color: "var(--hamilton-on-surface)" }}>
                  &ldquo;{district.beigeBook.text}&rdquo;
                </p>
                <p className="mt-1 text-xs" style={{ color: "var(--hamilton-text-tertiary)" }}>
                  Federal Reserve Beige Book, {district.beigeBook.releaseDate}
                </p>
              </>
            ) : (
              <p className="mt-1 text-sm" style={{ color: "var(--hamilton-text-secondary)" }}>
                No Beige Book summary is stored for this district yet.
              </p>
            )}
          </div>
        )}

        {/* Regulation */}
        <div className="px-5 py-4">
          <SectionLabel>Regulation</SectionLabel>
          {regulation.length === 0 ? (
            <p className="mt-1 text-sm" style={{ color: "var(--hamilton-text-secondary)" }}>
              No fee-related regulatory items in the news feed yet.
            </p>
          ) : (
            <ul className="mt-1 flex flex-col gap-2">
              {regulation.map((item) => (
                <li key={item.link}>
                  <a href={item.link} target="_blank" rel="noreferrer" className="text-sm no-underline hover:underline" style={{ color: "var(--hamilton-on-surface)" }}>
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
