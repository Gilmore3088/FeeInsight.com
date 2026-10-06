"use client";

import Link from "next/link";
import type { User } from "@/lib/auth";
import type { HamiltonContextSource } from "@/lib/hamilton/context-source";
import { HamiltonTopNav } from "./HamiltonTopNav";
import { HamiltonContextBar } from "./HamiltonContextBar";
import { setViewAsCustomer } from "@/app/pro/(hamilton)/view-as-actions";
import { HamiltonLeftRail } from "./HamiltonLeftRail";
import { HamiltonAskDock } from "./HamiltonAskDock";

interface SavedAnalysis {
  id: string;
  title: string;
  analysis_focus: string;
  institution_id: string | null;
  updated_at: string;
}

interface RecentScenario {
  id: string;
  fee_category: string;
  institution_id: string | null;
  updated_at: string;
}

interface HamiltonShellProps {
  user: User;
  isAdmin: boolean;
  /** Admin is previewing the customer experience */
  viewAsCustomer?: boolean;
  institutionContext: {
    name: string | null;
    type: string | null;
    assetTier: string | null;
    fedDistrict: number | null;
    city?: string | null;
    stateCode?: string | null;
    feesCheckedAt?: string | null;
    makeDefaultHref?: string | null;
    feePublicationLabel?: string | null;
    publishedFeeCount?: number | null;
    provisionalFeeCount?: number | null;
    selectedSource?: HamiltonContextSource;
    selectedFromUrl?: boolean;
  };
  selectedInstitutionId?: string | null;
  activeHref: string;
  savedAnalyses?: SavedAnalysis[];
  recentScenarios?: RecentScenario[];
  pinnedInstitutions?: Array<{ id: string; name: string }>;
  peerSets?: Array<{ id: number; name: string }>;
  children: React.ReactNode;
}

/**
 * HamiltonShell - Client component (owns left rail collapse state).
 * Outer shell wrapper applying .hamilton-shell CSS isolation boundary.
 * Composes: admin bar, HamiltonTopNav, HamiltonContextBar, HamiltonLeftRail, main content and the Ask dock.
 * Per D-13, ARCH-01: .hamilton-shell class scopes all editorial design tokens.
 * Per D-10: admin mode bar shown only to admin/analyst users.
 */
export function HamiltonShell({
  user,
  isAdmin,
  viewAsCustomer = false,
  institutionContext,
  selectedInstitutionId,
  activeHref,
  savedAnalyses,
  recentScenarios,
  pinnedInstitutions,
  peerSets,
  children,
}: HamiltonShellProps) {
  return (
    <div
      className="hamilton-shell min-h-screen"
      style={{ backgroundColor: "var(--hamilton-surface)" }}
    >
      {/* Admin mode bar - only for admin/analyst users (T-40-05) */}
      {isAdmin && (
        <div className="bg-gray-900 text-white flex flex-wrap items-center justify-between gap-2 px-4 py-1.5 text-xs">
          <span className="text-gray-400">
            {viewAsCustomer
              ? "Viewing as a customer: Hamilton answers exactly as a paying customer sees it"
              : "Admin view: Hamilton answers with pipeline detail"}
          </span>
          <span className="flex items-center gap-4">
            <form action={setViewAsCustomer}>
              <input type="hidden" name="mode" value={viewAsCustomer ? "admin" : "customer"} />
              <button type="submit" className="text-blue-400 hover:text-blue-300 font-medium">
                {viewAsCustomer ? "Back to admin view" : "View as customer"}
              </button>
            </form>
            <Link
              href="/admin"
              className="text-blue-400 hover:text-blue-300 font-medium no-underline"
            >
              Back to Admin
            </Link>
          </span>
        </div>
      )}

      {/* Top navigation */}
      <HamiltonTopNav
        isAdmin={isAdmin && !viewAsCustomer}
        activeHref={activeHref}
        user={user}
        selectedInstitutionId={selectedInstitutionId}
      />

      {/* Institution context bar */}
      <HamiltonContextBar
        institutionContext={institutionContext}
        selectedInstitutionId={selectedInstitutionId}
      />

      {/* Two-column layout: left rail + main content */}
      <div className="relative flex" style={{ minHeight: "calc(100vh - 120px)" }}>
        <HamiltonLeftRail
          savedAnalyses={savedAnalyses}
          recentScenarios={recentScenarios}
          pinnedInstitutions={pinnedInstitutions}
          peerSets={peerSets}
          selectedInstitutionId={selectedInstitutionId}
        />
        <main className="min-w-0 flex-1 px-4 pb-28 pt-14 sm:px-6 lg:px-10 lg:pb-28 lg:pt-8">{children}</main>
      </div>

      {/* Ask Hamilton, docked on every screen */}
      <HamiltonAskDock selectedInstitutionId={selectedInstitutionId} />
    </div>
  );
}
