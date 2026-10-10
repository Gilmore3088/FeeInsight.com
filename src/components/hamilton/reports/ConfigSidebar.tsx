"use client";

import { Loader2 } from "lucide-react";
import type { ReportTemplateType } from "@/app/pro/(hamilton)/reports/actions";
import type { ReportPeerCoveragePreview } from "@/lib/hamilton/report-evidence";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";
import type { HamiltonPeerSetOption } from "@/components/hamilton/PeerBaselineSelector";
import { SERIF } from "@/components/hamilton/memo/memo";
import {
  REPORT_GOALS,
  type ReportClientGoal,
} from "@/lib/hamilton/report-goal";

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
    <div
      className="grid gap-2 sm:grid-cols-2"
      role="radiogroup"
      aria-label={label}
    >
      {options.map((option) => {
        const isActive = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange(option.value)}
            className={
              "rounded-md border px-3 py-2.5 text-left transition-colors " +
              (isActive
                ? "border-terra bg-terra-soft"
                : "border-warm-300 bg-white hover:border-warm-500")
            }
          >
            <span
              className={
                "block text-sm " +
                (isActive
                  ? "font-semibold text-warm-900"
                  : "font-medium text-warm-800")
              }
            >
              {option.label}
            </span>
            <span className="mt-0.5 block text-xs text-warm-600">
              {option.hint}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Two choices: the client's goal (which decision points come first) and the
 * audience. The audience values map 1:1 onto the existing NarrativeTone enum so
 * the API contract is unchanged; only the labels are the reader's words.
 */
const AUDIENCES: Array<{
  value: NarrativeTone;
  label: string;
  forLabel: string;
  hint: string;
}> = [
  {
    value: "executive",
    label: "Board",
    forLabel: "the board",
    hint: "Short, with the main point first",
  },
  {
    value: "consulting",
    label: "Your team",
    forLabel: "your team",
    hint: "Practical, with what to look at next",
  },
  {
    value: "technical",
    label: "Analysts",
    forLabel: "analysts",
    hint: "Figures first, with the number of institutions behind each",
  },
  {
    value: "academic",
    label: "Research",
    forLabel: "research",
    hint: "Fuller context, with the method and its limits",
  },
];

const inputClass =
  "w-full rounded-md border border-warm-300 bg-white px-3 py-2 text-sm text-warm-900 focus:border-terra focus:outline-none focus:ring-1 focus:ring-terra disabled:opacity-60";

function formatPeerSetSummary(peerSet: HamiltonPeerSetOption): string {
  const charter = peerSet.charter_type
    ? peerSet.charter_type === "credit_union"
      ? "Credit unions"
      : peerSet.charter_type.replace(/_/g, " ")
    : null;
  const parts = [
    charter,
    peerSet.tiers ? `asset tiers ${peerSet.tiers}` : null,
    peerSet.districts ? `Fed districts ${peerSet.districts}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "your own list";
}

function readinessClass(
  readiness: ReportPeerCoveragePreview["readiness"],
): string {
  switch (readiness) {
    case "verified_comparison_ready":
      return "border-warm-300 bg-warm-150 text-warm-900";
    case "directional_comparison_ready":
    case "peer_index_only":
      return "border-warm-300 bg-warm-50 text-warm-800";
    case "source_diligence":
    case "source_needed":
      return "border-terra bg-terra-soft text-terra-text";
  }
}

function StepHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-lg text-warm-900" style={SERIF}>
      {children}
    </h3>
  );
}

/**
 * Report setup: who will read it, which peers it compares against, how much data
 * supports it, and the button that writes it. Sits in the page's single column, never
 * beside a finished report. (Kept under its old export name for existing imports.)
 */
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
  const activeAudience =
    AUDIENCES.find((a) => a.value === narrativeTone) ?? AUDIENCES[0];
  const settingsHref = hrefWithInstitutionContext(
    "/pro/settings",
    selectedInstitutionId,
  );
  const selectedPeerValue = peerSetId ?? "";
  const peerSetKnown =
    selectedPeerValue === "" ||
    savedPeerSets.some((p) => String(p.id) === selectedPeerValue);

  return (
    <form
      className="flex flex-col gap-6 rounded-lg border border-warm-300 bg-warm-50 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        onGenerate();
      }}
    >
      <div className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          <div>
            <StepHeading>What it should help with</StepHeading>
            <p className="mt-1 text-sm text-warm-600">
              Sets which decision points come first. The figures stay the same.
            </p>
          </div>
          <OptionList
            label="Goal"
            options={REPORT_GOALS}
            value={clientGoal}
            onChange={onClientGoalChange}
          />
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <StepHeading>Who will read it</StepHeading>
            <p className="mt-1 text-sm text-warm-600">
              Hamilton adjusts length, depth and tone to suit.
            </p>
          </div>
          <OptionList
            label="Audience"
            options={AUDIENCES}
            value={narrativeTone}
            onChange={onNarrativeToneChange}
          />
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <StepHeading>Compare against</StepHeading>
            <p className="mt-1 text-sm text-warm-600">
              The peer group behind every comparison. If it is too small for a
              fee, Hamilton uses all institutions nationally and says so.
            </p>
          </div>
          <label htmlFor="report-peer-baseline" className="sr-only">
            Peer group
          </label>
          <select
            id="report-peer-baseline"
            value={selectedPeerValue}
            disabled={isGenerating}
            onChange={(event) => onPeerSetChange(event.target.value || null)}
            className={inputClass}
          >
            <option value="">{defaultPeerSetLabel}</option>
            {!peerSetKnown && (
              <option value={selectedPeerValue}>
                Saved peer group #{selectedPeerValue}
              </option>
            )}
            {savedPeerSets.map((peerSet) => (
              <option key={peerSet.id} value={String(peerSet.id)}>
                {peerSet.name}: {formatPeerSetSummary(peerSet)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-warm-200 pt-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <StepHeading>What the data supports</StepHeading>
          {isPeerCoverageLoading && (
            <span className="text-xs text-warm-600">Checking…</span>
          )}
        </div>

        {peerCoverageError && (
          <p className="text-sm text-terra-text">
            Hamilton couldn&apos;t check the data for this report:{" "}
            {peerCoverageError}
          </p>
        )}

        {!peerCoverageError &&
          !peerCoveragePreview &&
          !isPeerCoverageLoading && (
            <p className="text-sm text-warm-600">
              Choose a report above to see how much data stands behind it.
            </p>
          )}

        {!peerCoverageError && peerCoveragePreview && (
          <div className="flex flex-col gap-3">
            <p
              className={`rounded-md border px-3 py-2 text-sm font-medium ${readinessClass(peerCoveragePreview.readiness)}`}
            >
              {peerCoveragePreview.readinessLabel}
            </p>

            <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-warm-600">Peer group</dt>
                <dd className="mt-0.5 font-medium leading-snug text-warm-900">
                  {peerCoveragePreview.peerBaselineLabel ?? "Not settled yet"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-warm-600">
                  Fees with enough peer data
                </dt>
                <dd className="mt-0.5 font-medium text-warm-900 [font-variant-numeric:tabular-nums]">
                  {peerCoveragePreview.usablePeerCategoryCount}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-warm-600">
                  Research institution fees compared with peers
                </dt>
                <dd className="mt-0.5 font-medium text-warm-900 [font-variant-numeric:tabular-nums]">
                  {peerCoveragePreview.selectedFeeDeltaCount}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-warm-600">Research institution published fees</dt>
                <dd className="mt-0.5 font-medium text-warm-900 [font-variant-numeric:tabular-nums]">
                  {peerCoveragePreview.selectedVerifiedFeeCount}
                  {peerCoveragePreview.selectedProvisionalFeeCount > 0
                    ? `, plus ${peerCoveragePreview.selectedProvisionalFeeCount} still in review`
                    : ""}
                </dd>
              </div>
            </dl>

            <p className="text-sm leading-relaxed text-pretty text-warm-700">
              {peerCoveragePreview.readinessDetail}
            </p>

            {peerCoveragePreview.peerFallbackReason && (
              <p className="rounded-md border-l-2 border-terra bg-terra-soft px-3 py-2 text-sm leading-relaxed text-warm-800">
                {peerCoveragePreview.peerFallbackReason}
              </p>
            )}

            {peerCoveragePreview.focusCategoryCovered === false && (
              <p className="rounded-md border-l-2 border-terra bg-terra-soft px-3 py-2 text-sm leading-relaxed text-warm-800">
                There isn&apos;t enough verified peer data for this fee yet, so
                the comparison will be thin.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 border-t border-warm-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-warm-600">
          For{" "}
          <span className="font-medium text-warm-900">
            {institutionName || "the research institution"}
          </span>
          {" · "}
          {peerSetLabel || "all institutions nationally"}
          {" · "}
          <a
            href={settingsHref}
            className="text-terra-text underline underline-offset-2"
          >
            Change defaults
          </a>
        </p>
        <div className="flex flex-col items-start gap-1 sm:items-end">
          <button
            type="submit"
            disabled={!canGenerate}
            className="flex items-center justify-center gap-2 rounded-md bg-terra px-4 py-2.5 text-sm font-medium text-white hover:bg-terra-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isGenerating ? (
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            ) : null}
            {isGenerating
              ? "Writing the report…"
              : `Write the report for ${activeAudience.forLabel}`}
          </button>
          {selectedTemplate === null && !isGenerating ? (
            <span className="text-xs text-warm-600">
              Choose a report above first.
            </span>
          ) : null}
        </div>
      </div>
    </form>
  );
}
