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

interface WorkspaceInstitutionFormProps {
  selectedInstitution: HamiltonSelectedInstitutionContext | null;
  selectedSource: HamiltonWorkspaceContextSource | "none";
  selectedClaim: InstitutionClaimState | null;
  selectedMembership: InstitutionWorkspaceMembership | null;
}

const initialState: WorkspaceInstitutionState = { success: false };
const initialClaimState: InstitutionClaimActionState = { success: false };

function sourceLabelFor(source: HamiltonWorkspaceContextSource | "none"): string | null {
  if (source === "url") return "URL selected";
  if (source === "manual") return "Manual";
  if (source === "profile") return "Profile";
  if (source === "watchlist") return "Watchlist";
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
    <div>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-bold" style={{ color: "var(--hamilton-text-primary)" }}>
            {activeName ?? "No selected institution"}
          </p>
          {selectedInstitution ? (
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: "var(--hamilton-text-secondary)" }}>
              <span>ID {selectedInstitution.id}</span>
              <span>{selectedInstitution.feePublicationLabel}</span>
              <span>{selectedInstitution.publishedFeeCount} verified</span>
              <span>{selectedInstitution.provisionalFeeCount} provisional</span>
              {sourceLabel && <span>Source: {sourceLabel}</span>}
            </div>
          ) : (
            <p className="mt-1 text-xs" style={{ color: "var(--hamilton-text-tertiary)" }}>
              Search and select an institution to anchor Analyze, Reports, Scenarios, and Watchlist.
            </p>
          )}
        </div>

        <Link
          href={selectedInstitution ? `/pro/analyze?instId=${selectedInstitution.id}` : "/institutions"}
          className="text-xs font-semibold no-underline hover:opacity-80"
          style={{ color: "var(--hamilton-accent)" }}
        >
          {selectedInstitution ? "Open in Analyze" : "Find an institution"}
        </Link>
      </div>

      <div className="space-y-4">
        <form id="workspace-institution-context-form" action={formAction} className="space-y-4">
          <InstitutionPicker
            inputId="workspace_institution_search"
            label="Search Institution"
            initialId={activeId}
            initialName={activeName}
            required
            onSelect={handleSelect}
          />
        </form>

        {selectedSummary && (
          <div
            className="rounded-md border p-3"
            style={{
              borderColor: "var(--hamilton-border)",
              backgroundColor: "var(--hamilton-surface-container-low)",
            }}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-bold" style={{ color: "var(--hamilton-text-primary)" }}>
                    {selectedSummary.name}
                  </p>
                  {hasActiveMembership && (
                    <span
                      className="rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                      style={{
                        borderColor: "oklch(0.7 0.12 145)",
                        backgroundColor: "oklch(0.96 0.04 145)",
                        color: "oklch(0.42 0.12 145)",
                      }}
                    >
                      Verified workspace {membershipRoleLabel}
                    </span>
                  )}
                </div>
                <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs" style={{ color: "var(--hamilton-text-secondary)" }}>
                  <span>ID {selectedSummary.id}</span>
                  {selectedSummary.location && <span>{selectedSummary.location}</span>}
                  <span>{selectedSummary.status}</span>
                  {typeof selectedSummary.verified === "number" && <span>{selectedSummary.verified} verified</span>}
                  {typeof selectedSummary.provisional === "number" && <span>{selectedSummary.provisional} provisional</span>}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Link
                  href={submitSourceHref}
                  className="rounded-md border px-3 py-2 text-xs font-semibold no-underline hover:opacity-80"
                  style={{
                    borderColor: "var(--hamilton-border)",
                    color: "var(--hamilton-text-primary)",
                  }}
                >
                  Submit Source
                </Link>
                <Link
                  href={claimHref}
                  className="rounded-md border px-3 py-2 text-xs font-semibold no-underline hover:opacity-80"
                  style={{
                    borderColor: "var(--hamilton-border)",
                    color: "var(--hamilton-text-primary)",
                  }}
                >
                  Source Intake
                </Link>
              </div>
            </div>
          </div>
        )}

        {selectedSummary && (
          <div
            className="rounded-md border p-3"
            style={{
              borderColor: "var(--hamilton-border)",
              backgroundColor: "white",
            }}
          >
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-bold" style={{ color: "var(--hamilton-text-primary)" }}>
                  Institution Claim Review
                </p>
                <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--hamilton-text-secondary)" }}>
                  Use this when your team represents this institution and wants the Data Trust queue to review profile authority.
                </p>
                {claimBelongsToSelection && claimStatusLabel && (
                  <p className="mt-2 text-xs font-semibold" style={{ color: "var(--hamilton-text-accent)" }}>
                    Current claim: {claimStatusLabel}
                    {visibleClaim?.resolution ? ` · ${visibleClaim.resolution.replaceAll("_", " ")}` : ""}
                  </p>
                )}
                {hasActiveMembership && (
                  <p className="mt-2 text-xs font-semibold" style={{ color: "oklch(0.45 0.13 145)" }}>
                    Workspace authority active since {new Date(selectedMembership.grantedAt).toLocaleDateString()}.
                  </p>
                )}
                {claimBelongsToSelection && visibleClaim?.reviewNotes && (
                  <p className="mt-2 rounded-md p-2 text-xs leading-relaxed" style={{
                    backgroundColor: "var(--hamilton-surface-container-low)",
                    color: "var(--hamilton-text-secondary)",
                  }}>
                    {visibleClaim.reviewNotes}
                  </p>
                )}
              </div>

              <form action={claimAction} className="min-w-0 space-y-2 lg:w-[320px]">
                <input type="hidden" name="institution_id" value={selectedSummary.id} />
                <label
                  htmlFor="claim_notes"
                  className="text-[11px] font-semibold uppercase tracking-wider"
                  style={{ color: "var(--hamilton-text-secondary)" }}
                >
                  Claim Notes
                </label>
                <textarea
                  id="claim_notes"
                  name="claim_notes"
                  rows={3}
                  placeholder="Role, team, branch, or source context for admin review"
                  disabled={hasActiveMembership}
                  className="w-full resize-y rounded-md border px-3 py-2 text-sm outline-none transition-colors"
                  style={{
                    borderColor: "var(--hamilton-border)",
                    color: "var(--hamilton-text-primary)",
                    opacity: hasActiveMembership ? 0.6 : 1,
                  }}
                />
                <button
                  type="submit"
                  disabled={isClaimPending || hasActiveMembership}
                  className="w-full rounded-md px-4 py-2.5 text-sm font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
                  style={{ background: "var(--hamilton-gradient-cta)" }}
                >
                  {hasActiveMembership
                    ? "Workspace Authority Active"
                    : isClaimPending
                      ? "Submitting..."
                      : "Request Claim Review"}
                </button>
              </form>
            </div>

            {claimState.success && claimState.message && (
              <p className="mt-3 text-sm font-medium" style={{ color: "oklch(0.55 0.15 145)" }}>
                {claimState.message}
              </p>
            )}
            {!claimState.success && claimState.error && (
              <p className="mt-3 text-sm font-medium" style={{ color: "oklch(0.55 0.22 25)" }}>
                {claimState.error}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs" style={{ color: "var(--hamilton-text-tertiary)" }}>
            {selectedId
              ? "Saving sets this institution as the default Hamilton context."
              : "Select a matched institution before saving."}
          </p>
          <button
            form="workspace-institution-context-form"
            type="submit"
            disabled={isPending || !selectedId}
            className="rounded-md px-5 py-2.5 text-sm font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
            style={{ background: "var(--hamilton-gradient-cta)" }}
          >
            {isPending ? "Saving..." : "Set Context"}
          </button>
        </div>
      </div>

      {state.success && (
        <p className="mt-3 text-sm font-medium" style={{ color: "oklch(0.55 0.15 145)" }}>
          Hamilton context updated.
        </p>
      )}
      {!state.success && state.error && (
        <p className="mt-3 text-sm font-medium" style={{ color: "oklch(0.55 0.22 25)" }}>
          {state.error}
        </p>
      )}
    </div>
  );
}
