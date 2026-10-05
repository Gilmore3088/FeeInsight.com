"use client";

import { Loader2 } from "lucide-react";
import type { ReportTemplateType } from "@/app/pro/(hamilton)/reports/actions";
import type { ReportPeerCoveragePreview } from "@/lib/hamilton/report-evidence";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";
import { REPORT_GOALS, type ReportClientGoal } from "@/lib/hamilton/report-goal";
import {
  PeerBaselineSelector,
  type HamiltonPeerSetOption,
} from "@/components/hamilton/PeerBaselineSelector";

type NarrativeTone = "consulting" | "academic" | "executive" | "technical";

interface ConfigSidebarProps {
  selectedTemplate: ReportTemplateType | null;
  selectedInstitutionId?: string | null;
  institutionName: string;
  peerSetLabel: string;
  peerSetId: string | null;
  defaultPeerSetLabel: string;
  savedPeerSets: HamiltonPeerSetOption[];
  narrativeTone: NarrativeTone;
  isGenerating: boolean;
  peerCoveragePreview: ReportPeerCoveragePreview | null;
  isPeerCoverageLoading: boolean;
  peerCoverageError: string | null;
  onPeerSetChange: (peerSetId: string | null) => void;
  onNarrativeToneChange: (v: NarrativeTone) => void;
  clientGoal: ReportClientGoal;
  onClientGoalChange: (v: ReportClientGoal) => void;
  onGenerate: () => void;
}

function OptionList<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<{ value: T; label: string; hint: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="space-y-3" role="radiogroup" aria-label={label}>
      {options.map((option) => {
        const isActive = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange(option.value)}
            className="w-full text-left p-4 cursor-pointer transition-colors"
            style={{
              border: isActive ? "1px solid var(--hamilton-primary)" : "1px solid transparent",
              backgroundColor: isActive
                ? "var(--hamilton-surface-container-lowest)"
                : "var(--hamilton-surface-container-high)",
            }}
          >
            <span
              className="text-[12px] uppercase tracking-widest block"
              style={{
                fontWeight: isActive ? 700 : 600,
                color: isActive ? "var(--hamilton-on-surface)" : "var(--hamilton-secondary)",
              }}
            >
              {option.label}
            </span>
            <span className="text-[11px] mt-0.5 block" style={{ color: "var(--hamilton-secondary)" }}>
              {option.hint}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Two knobs: the client's GOAL (how decisions are ranked) and the AUDIENCE. Everything else (institution,
 * peer set, focus area) inherits from the user's profile and the chosen
 * template. The audience values map 1:1 onto the existing NarrativeTone
 * enum so the API contract is unchanged — we just relabel the buttons.
 */
const AUDIENCES: Array<{ value: NarrativeTone; label: string; hint: string }> = [
  { value: "executive",  label: "Board",         hint: "Short, headline-led, decision first" },
  { value: "consulting", label: "Internal Team", hint: "Action-oriented, names next steps" },
  { value: "technical",  label: "Analysts",      hint: "Data-first, sample size on every benchmark" },
  { value: "academic",   label: "Research",      hint: "Fuller context, explains method and limits" },
];

function formatEvidenceCounts(preview: ReportPeerCoveragePreview): string {
  return `${preview.selectedVerifiedFeeCount} verified / ${preview.selectedProvisionalFeeCount} provisional`;
}

function formatReadinessTone(readiness: ReportPeerCoveragePreview["readiness"]): {
  color: string;
  backgroundColor: string;
} {
  switch (readiness) {
    case "verified_comparison_ready":
      return {
        color: "#166534",
        backgroundColor: "rgba(22,101,52,0.08)",
      };
    case "directional_comparison_ready":
      return {
        color: "#854d0e",
        backgroundColor: "rgba(133,77,14,0.09)",
      };
    case "peer_index_only":
      return {
        color: "var(--hamilton-on-surface)",
        backgroundColor: "var(--hamilton-surface-container-lowest)",
      };
    case "source_diligence":
    case "source_needed":
      return {
        color: "#991b1b",
        backgroundColor: "rgba(153,27,27,0.08)",
      };
  }
}

export function ConfigSidebar({
  selectedTemplate,
  selectedInstitutionId = null,
  institutionName,
  peerSetLabel,
  peerSetId,
  defaultPeerSetLabel,
  savedPeerSets,
  narrativeTone,
  isGenerating,
  peerCoveragePreview,
  isPeerCoverageLoading,
  peerCoverageError,
  onPeerSetChange,
  onNarrativeToneChange,
  clientGoal,
  onClientGoalChange,
  onGenerate,
}: ConfigSidebarProps) {
  const canGenerate = selectedTemplate !== null && !isGenerating;
  const activeAudience = AUDIENCES.find((a) => a.value === narrativeTone) ?? AUDIENCES[0];
  const settingsHref = hrefWithInstitutionContext("/pro/settings", selectedInstitutionId);

  return (
    <aside className="min-w-0 lg:sticky lg:top-32 lg:col-span-4">
      <div className="bg-surface-container-low p-5 sm:p-8">
        <div className="mb-6">
          <h2 className="font-headline text-3xl italic mb-1">Goal</h2>
          <p
            className="text-xs tracking-wide leading-relaxed"
            style={{ color: "var(--hamilton-secondary)" }}
          >
            What should these decisions achieve? Hamilton ranks its
            recommendations by this goal.
          </p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onGenerate();
          }}
        >
          <OptionList label="Goal" options={REPORT_GOALS} value={clientGoal} onChange={onClientGoalChange} />

          <div className="mt-8 mb-4">
            <h2 className="font-headline text-3xl italic mb-1">Audience</h2>
            <p
              className="text-xs tracking-wide leading-relaxed"
              style={{ color: "var(--hamilton-secondary)" }}
            >
              Who is this report for? Hamilton tunes voice, depth, and structure
              to match.
            </p>
          </div>
          <OptionList label="Audience" options={AUDIENCES} value={narrativeTone} onChange={onNarrativeToneChange} />

          {/* CTA */}
          <div className="pt-7">
            <PeerBaselineSelector
              id="report-peer-baseline"
              value={peerSetId}
              defaultLabel={defaultPeerSetLabel}
              peerSets={savedPeerSets}
              disabled={isGenerating}
              onChange={onPeerSetChange}
            />
          </div>

          <div
            className="mt-6 border-t pt-5"
            style={{ borderColor: "rgba(216,194,184,0.24)" }}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <span
                className="text-[10px] uppercase tracking-[0.2em]"
                style={{ color: "var(--hamilton-secondary)" }}
              >
                Evidence Preview
              </span>
              {isPeerCoverageLoading && (
                <span
                  className="text-[10px] uppercase tracking-[0.16em]"
                  style={{ color: "var(--hamilton-secondary)" }}
                >
                  Checking
                </span>
              )}
            </div>

            {peerCoverageError && (
              <p
                className="text-[11px] leading-relaxed"
                style={{ color: "#991b1b" }}
              >
                Coverage unavailable: {peerCoverageError}
              </p>
            )}

            {!peerCoverageError && !peerCoveragePreview && !isPeerCoverageLoading && (
              <p
                className="text-[11px] leading-relaxed"
                style={{ color: "var(--hamilton-secondary)" }}
              >
                No template selected.
              </p>
            )}

            {!peerCoverageError && peerCoveragePreview && (
              <div className="space-y-3">
                <div
                  className="rounded-md px-3 py-2 text-[12px] font-semibold"
                  style={formatReadinessTone(peerCoveragePreview.readiness)}
                >
                  {peerCoveragePreview.readinessLabel}
                </div>

                <dl className="grid grid-cols-2 gap-3 text-[11px]">
                  <div>
                    <dt style={{ color: "var(--hamilton-secondary)" }}>
                      Baseline
                    </dt>
                    <dd
                      className="mt-0.5 font-medium leading-snug"
                      style={{ color: "var(--hamilton-on-surface)" }}
                    >
                      {peerCoveragePreview.peerBaselineLabel ?? "Not resolved"}
                    </dd>
                  </div>
                  <div>
                    <dt style={{ color: "var(--hamilton-secondary)" }}>
                      Peer categories
                    </dt>
                    <dd
                      className="mt-0.5 font-medium"
                      style={{ color: "var(--hamilton-on-surface)" }}
                    >
                      {peerCoveragePreview.usablePeerCategoryCount}
                    </dd>
                  </div>
                  <div>
                    <dt style={{ color: "var(--hamilton-secondary)" }}>
                      Institution deltas
                    </dt>
                    <dd
                      className="mt-0.5 font-medium"
                      style={{ color: "var(--hamilton-on-surface)" }}
                    >
                      {peerCoveragePreview.selectedFeeDeltaCount}
                    </dd>
                  </div>
                  <div>
                    <dt style={{ color: "var(--hamilton-secondary)" }}>
                      Evidence
                    </dt>
                    <dd
                      className="mt-0.5 font-medium"
                      style={{ color: "var(--hamilton-on-surface)" }}
                    >
                      {formatEvidenceCounts(peerCoveragePreview)}
                    </dd>
                  </div>
                </dl>

                <p
                  className="text-[11px] leading-relaxed"
                  style={{ color: "var(--hamilton-secondary)" }}
                >
                  {peerCoveragePreview.readinessDetail}
                </p>

                {peerCoveragePreview.peerFallbackReason && (
                  <p
                    className="rounded-md px-3 py-2 text-[11px] leading-relaxed"
                    style={{
                      backgroundColor: "rgba(133,77,14,0.08)",
                      color: "#854d0e",
                    }}
                  >
                    {peerCoveragePreview.peerFallbackReason}
                  </p>
                )}

                {peerCoveragePreview.focusCategoryCovered === false && (
                  <p
                    className="rounded-md px-3 py-2 text-[11px] leading-relaxed"
                    style={{
                      backgroundColor: "rgba(153,27,27,0.08)",
                      color: "#991b1b",
                    }}
                  >
                    Focus category has insufficient verified peer coverage.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="pt-8">
            <button
              type="submit"
              disabled={!canGenerate}
              className="w-full burnished-cta text-white py-5 px-8 flex items-center justify-center gap-3 transition-transform active:scale-95"
              style={{ opacity: canGenerate ? 1 : 0.6, cursor: canGenerate ? "pointer" : "not-allowed" }}
            >
              {isGenerating ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <span className="material-symbols-outlined" aria-hidden="true">auto_awesome</span>
              )}
              <span className="text-[10px] uppercase tracking-[0.3em] font-bold">
                {isGenerating
                  ? "Generating..."
                  : `Generate ${activeAudience.label} Report`}
              </span>
            </button>

            {/* Implicit context — what this run will use. Quiet, single line.
                Replaces the old Institution / Peer Set / Focus Area inputs. */}
            <p
              className="text-[10px] text-center mt-4 leading-relaxed"
              style={{ color: "var(--hamilton-secondary)" }}
            >
              For{" "}
              <span style={{ color: "var(--hamilton-on-surface)" }}>
                {institutionName || "your institution"}
              </span>
              {" · "}
              {peerSetLabel || "national peers"}
              {" · "}
              <a
                href={settingsHref}
                className="underline underline-offset-2 hover:opacity-70"
              >
                change defaults
              </a>
            </p>
          </div>
        </form>
      </div>
    </aside>
  );
}
