"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  updateWorkspaceInstitution,
  type WorkspaceInstitutionState,
} from "./actions";
import type { HamiltonSelectedInstitutionContext } from "@/lib/hamilton/institution-context";
import type { HamiltonWorkspaceContextSource } from "@/lib/hamilton/workspace-context";
import {
  InstitutionPicker,
  institutionLocation,
  type InstitutionSearchResult,
} from "@/components/hamilton/InstitutionPicker";
import { SERIF } from "@/components/hamilton/memo/memo";
import { normalizeCanonicalInstitutionId } from "@/lib/hamilton/context-link";

interface WorkspaceInstitutionFormProps {
  selectedInstitution: HamiltonSelectedInstitutionContext | null;
  selectedSource: HamiltonWorkspaceContextSource | "none";
}

const inputClass =
  "w-full rounded-md border border-warm-300 bg-white px-3 py-2 text-sm text-warm-900 focus:border-terra focus:outline-none focus:ring-1 focus:ring-terra";
const secondaryButton =
  "inline-block rounded-md border border-warm-300 bg-warm-50 px-3 py-1.5 text-sm font-medium text-warm-800 hover:border-warm-500";

const initialState: WorkspaceInstitutionState = { success: false };

function sourceLabelFor(source: HamiltonWorkspaceContextSource | "none"): string | null {
  if (source === "url") return "link";
  if (source === "manual") return "your choice";
  if (source === "profile") return "your profile";
  if (source === "watchlist") return "your watchlist";
  return null;
}

export function WorkspaceInstitutionForm({
  selectedInstitution,
  selectedSource,
}: WorkspaceInstitutionFormProps) {
  const { replace } = useRouter();
  const [state, formAction, isPending] = useActionState(
    updateWorkspaceInstitution,
    initialState,
  );
  useEffect(() => {
    if (!state.success) return;
    const institutionId = normalizeCanonicalInstitutionId(state.institutionId);
    if (institutionId) replace(`/pro/settings?instId=${institutionId}`);
  }, [state.success, state.institutionId, replace]);

  const activeName = state.institutionName ?? selectedInstitution?.name ?? null;
  const activeId = state.institutionId ?? selectedInstitution?.id ?? null;
  const effectiveSource = state.success ? "manual" : selectedSource;
  const sourceLabel = sourceLabelFor(effectiveSource);
  const [selectedResult, setSelectedResult] = useState<InstitutionSearchResult | null>(null);
  const [cleared, setCleared] = useState(false);
  const selectedId = selectedResult?.id ?? (cleared ? null : activeId);

  const selectedSummary = useMemo(() => {
    if (selectedResult) {
      return {
        name: selectedResult.institution_name,
        id: selectedResult.id,
        location: institutionLocation(selectedResult),
        status: selectedResult.fee_publication_label,
        verified: selectedResult.published_fee_count,
        provisional: selectedResult.provisional_fee_count,
      };
    }
    if (selectedInstitution) {
      return {
        name: selectedInstitution.name,
        id: selectedInstitution.id,
        location: [selectedInstitution.city, selectedInstitution.stateCode].filter(Boolean).join(", "),
        status: selectedInstitution.feePublicationLabel,
        verified: selectedInstitution.publishedFeeCount,
        provisional: selectedInstitution.provisionalFeeCount,
      };
    }
    if (state.institutionId && state.institutionName) {
      return {
        name: state.institutionName,
        id: state.institutionId,
        location: "",
        status: "Saved",
        verified: null,
        provisional: null,
      };
    }
    return null;
  }, [selectedInstitution, selectedResult, state.institutionId, state.institutionName]);

  function handleSelect(result: InstitutionSearchResult | null) {
    setSelectedResult(result);
    setCleared(result === null);
  }

  const submitSourceHref = selectedSummary
    ? `/submit-fees?institutionId=${selectedSummary.id}&institutionName=${encodeURIComponent(selectedSummary.name)}`
    : "/submit-fees";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-lg text-warm-900" style={SERIF}>
            {activeName ?? "No research institution selected"}
          </p>
          {selectedInstitution ? (
            <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-warm-600">
              <span>{selectedInstitution.feePublicationLabel}</span>
              <span className="[font-variant-numeric:tabular-nums]">{selectedInstitution.publishedFeeCount} verified fees</span>
              <span className="[font-variant-numeric:tabular-nums]">
                {selectedInstitution.provisionalFeeCount} still being checked
              </span>
              {sourceLabel && <span>Picked from: {sourceLabel}</span>}
              <span className="[font-variant-numeric:tabular-nums]">ID {selectedInstitution.id}</span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-warm-700">
              Select an institution for briefings, fee comparisons, reports and alerts.
            </p>
          )}
        </div>

        <Link
          href={selectedInstitution ? `/pro/analyze?instId=${selectedInstitution.id}` : "/institutions"}
          className="shrink-0 text-sm font-medium text-terra-text underline decoration-terra/40 underline-offset-2 hover:decoration-terra"
        >
          {selectedInstitution ? "Ask Hamilton about this institution" : "Browse institutions"}
        </Link>
      </div>

      <form id="workspace-institution-context-form" action={formAction}>
        <InstitutionPicker
          inputId="workspace_institution_search"
          label="Find an institution to research"
          help="Start typing a name, then choose a match from the list."
          initialId={activeId}
          initialName={activeName}
          required
          onSelect={handleSelect}
          labelClassName="text-sm font-medium text-warm-800"
          labelStyle={{}}
          inputClassName={inputClass}
          inputStyle={{}}
        />
      </form>

      {selectedSummary && (
        <div className="flex flex-col gap-3 border-y border-warm-200 py-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-medium text-warm-900">{selectedSummary.name}</p>
            </div>
            <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-sm text-warm-600">
              {selectedSummary.location && <span>{selectedSummary.location}</span>}
              <span>{selectedSummary.status}</span>
              {typeof selectedSummary.verified === "number" && (
                <span className="[font-variant-numeric:tabular-nums]">{selectedSummary.verified} verified fees</span>
              )}
              {typeof selectedSummary.provisional === "number" && (
                <span className="[font-variant-numeric:tabular-nums]">{selectedSummary.provisional} still being checked</span>
              )}
              <span className="[font-variant-numeric:tabular-nums]">ID {selectedSummary.id}</span>
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Link href={submitSourceHref} className={`${secondaryButton} no-underline`}>
              Send us a fee schedule
            </Link>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-warm-600">
          {selectedId
            ? "Saving sets your default research institution. It does not grant workspace access."
            : "Choose a match from the list before saving."}
        </p>
        <button
          form="workspace-institution-context-form"
          type="submit"
          disabled={isPending || !selectedId}
          className="rounded-md bg-terra px-3.5 py-2 text-sm font-medium text-white hover:bg-terra-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Saving..." : "Use for research"}
        </button>
      </div>

      {state.success && (
        <p role="status" className="text-sm font-medium text-warm-900">
          Saved. Hamilton now opens on this research institution.
        </p>
      )}
      {!state.success && state.error && (
        <p role="alert" className="text-sm font-medium text-terra-text">
          {state.error}
        </p>
      )}
    </div>
  );
}
