"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import {
  requestInstitutionClaim,
  updateWorkspaceInstitution,
  type InstitutionClaimActionState,
  type InstitutionClaimState,
  type WorkspaceInstitutionState,
} from "./actions";
import type { HamiltonSelectedInstitutionContext } from "@/lib/hamilton/institution-context";
import type { InstitutionWorkspaceMembership } from "@/lib/hamilton/institution-membership";
import type { HamiltonWorkspaceContextSource } from "@/lib/hamilton/workspace-context";
import {
  InstitutionPicker,
  institutionLocation,
  type InstitutionSearchResult,
} from "@/components/hamilton/InstitutionPicker";
import { SERIF } from "@/components/hamilton/memo/memo";

interface WorkspaceInstitutionFormProps {
  selectedInstitution: HamiltonSelectedInstitutionContext | null;
  selectedSource: HamiltonWorkspaceContextSource | "none";
  selectedClaim: InstitutionClaimState | null;
  selectedMembership: InstitutionWorkspaceMembership | null;
}

const inputClass =
  "w-full rounded-md border border-warm-300 bg-white px-3 py-2 text-sm text-warm-900 focus:border-terra focus:outline-none focus:ring-1 focus:ring-terra";
const secondaryButton =
  "inline-block rounded-md border border-warm-300 bg-warm-50 px-3 py-1.5 text-sm font-medium text-warm-800 hover:border-warm-500";

const initialState: WorkspaceInstitutionState = { success: false };
const initialClaimState: InstitutionClaimActionState = { success: false };

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
  selectedClaim,
  selectedMembership,
}: WorkspaceInstitutionFormProps) {
  const [state, formAction, isPending] = useActionState(
    updateWorkspaceInstitution,
    initialState,
  );
  const [claimState, claimAction, isClaimPending] = useActionState(
    requestInstitutionClaim,
    initialClaimState,
  );

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
  const visibleClaim = claimState.claim ?? selectedClaim;
  const claimBelongsToSelection =
    !!visibleClaim && !!selectedSummary && visibleClaim.institutionId === selectedSummary.id;
  const claimStatusLabel =
    visibleClaim?.reviewStatus === "accepted"
      ? "Accepted"
      : visibleClaim?.reviewStatus === "rejected"
        ? "Rejected"
        : visibleClaim?.reviewStatus === "needs_info"
          ? "Needs info"
          : visibleClaim?.reviewStatus === "pending"
            ? "Pending review"
            : null;
  const hasActiveMembership =
    !!selectedMembership && !!selectedSummary && selectedMembership.institutionId === selectedSummary.id;
  const membershipRoleLabel = selectedMembership?.role
    ? selectedMembership.role.replaceAll("_", " ")
    : null;

  function handleSelect(result: InstitutionSearchResult | null) {
    setSelectedResult(result);
    setCleared(result === null);
  }

  const submitSourceHref = selectedSummary
    ? `/submit-fees?institutionId=${selectedSummary.id}&institutionName=${encodeURIComponent(selectedSummary.name)}`
    : "/submit-fees";
  const claimHref = selectedSummary
    ? `/submit-fees?source=claim&institutionId=${selectedSummary.id}&institutionName=${encodeURIComponent(selectedSummary.name)}&submitterRole=institution_employee&notes=${encodeURIComponent("Claim or validate institution profile from Hamilton Settings.")}`
    : "/submit-fees?source=claim&submitterRole=institution_employee";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-lg text-warm-900" style={SERIF}>
            {activeName ?? "No bank picked yet"}
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
              Search for your bank below. Hamilton uses it for your briefing, fee comparisons, reports and alerts.
            </p>
          )}
        </div>

        <Link
          href={selectedInstitution ? `/pro/analyze?instId=${selectedInstitution.id}` : "/institutions"}
          className="shrink-0 text-sm font-medium text-terra-text underline decoration-terra/40 underline-offset-2 hover:decoration-terra"
        >
          {selectedInstitution ? "Ask Hamilton about this bank" : "Browse institutions"}
        </Link>
      </div>

      <form id="workspace-institution-context-form" action={formAction}>
        <InstitutionPicker
          inputId="workspace_institution_search"
          label="Find your bank or credit union"
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
              {hasActiveMembership && (
                <span className="rounded-full bg-warm-150 px-2.5 py-0.5 text-xs font-medium text-warm-800">
                  Your team&apos;s workspace{membershipRoleLabel ? ` (${membershipRoleLabel})` : ""}
                </span>
              )}
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
            <Link href={claimHref} className={`${secondaryButton} no-underline`}>
              Claim this bank&apos;s profile
            </Link>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-warm-600">
          {selectedId
            ? "Saving makes this the bank Hamilton opens on."
            : "Choose a match from the list before saving."}
        </p>
        <button
          form="workspace-institution-context-form"
          type="submit"
          disabled={isPending || !selectedId}
          className="rounded-md bg-terra px-3.5 py-2 text-sm font-medium text-white hover:bg-terra-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Saving..." : "Use this bank"}
        </button>
      </div>

      {state.success && (
        <p role="status" className="text-sm font-medium text-warm-900">
          Saved. Hamilton now opens on this bank.
        </p>
      )}
      {!state.success && state.error && (
        <p role="alert" className="text-sm font-medium text-terra-text">
          {state.error}
        </p>
      )}

      {selectedSummary && (
        <div className="flex flex-col gap-4 rounded-md border border-warm-200 bg-white p-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h3 className="text-base text-warm-900" style={SERIF}>
              Do you work at this bank?
            </h3>
            <p className="mt-1 text-sm leading-relaxed text-warm-700">
              Ask us to confirm it. Once confirmed, your team owns this bank&apos;s workspace and can add colleagues.
            </p>
            {claimBelongsToSelection && claimStatusLabel && (
              <p className="mt-2 text-sm font-medium text-terra-text">
                Your request: {claimStatusLabel}
                {visibleClaim?.resolution ? ` · ${visibleClaim.resolution.replaceAll("_", " ")}` : ""}
              </p>
            )}
            {hasActiveMembership && (
              <p className="mt-2 text-sm font-medium text-warm-900">
                Confirmed since {new Date(selectedMembership.grantedAt).toLocaleDateString()}.
              </p>
            )}
            {claimBelongsToSelection && visibleClaim?.reviewNotes && (
              <p className="mt-2 rounded-md bg-warm-150 p-2 text-sm leading-relaxed text-warm-700">
                {visibleClaim.reviewNotes}
              </p>
            )}
          </div>

          <form action={claimAction} className="flex min-w-0 flex-col gap-2 lg:w-80">
            <input type="hidden" name="institution_id" value={selectedSummary.id} />
            <label htmlFor="claim_notes" className="text-sm font-medium text-warm-800">
              Your role and team
            </label>
            <textarea
              id="claim_notes"
              name="claim_notes"
              rows={3}
              placeholder="For example, Deposit product manager, retail banking"
              disabled={hasActiveMembership}
              className={`${inputClass} resize-y disabled:opacity-60`}
            />
            <button
              type="submit"
              disabled={isClaimPending || hasActiveMembership}
              className="rounded-md bg-terra px-3.5 py-2 text-sm font-medium text-white hover:bg-terra-dark disabled:cursor-not-allowed disabled:opacity-60"
            >
              {hasActiveMembership
                ? "Already confirmed"
                : isClaimPending
                  ? "Sending..."
                  : "Ask us to confirm"}
            </button>
            {claimState.success && claimState.message && (
              <p role="status" className="text-sm font-medium text-warm-900">
                {claimState.message}
              </p>
            )}
            {!claimState.success && claimState.error && (
              <p role="alert" className="text-sm font-medium text-terra-text">
                {claimState.error}
              </p>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
