"use client";

import Link from "next/link";
import type { User } from "@/lib/auth";
import type { HamiltonContextSource } from "@/lib/hamilton/context-source";
import { HamiltonTopNav } from "./HamiltonTopNav";
import { setViewAsCustomer } from "@/app/pro/(hamilton)/view-as-actions";
import { HamiltonAskDock } from "./HamiltonAskDock";

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
  children: React.ReactNode;
}

/**
 * HamiltonShell - Client component.
 * Outer shell wrapper applying .hamilton-shell CSS isolation boundary.
 * Composes: admin bar (admins only), the one header, the page, and the docked Ask bar.
 * No sidebar and no second bar: James wants the simplicity of the living-memo samples.
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
  children,
}: HamiltonShellProps) {
  return (
    <div
      className="hamilton-shell min-h-screen bg-warm-100"
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

      {/* The one header: wordmark, six screens, the bank, an account menu */}
      <HamiltonTopNav
        isAdmin={isAdmin && !viewAsCustomer}
        activeHref={activeHref}
        user={user}
        selectedInstitutionId={selectedInstitutionId}
        institutionName={institutionContext.name}
        makeDefaultHref={institutionContext.makeDefaultHref ?? null}
      />

      <main className="mx-auto min-w-0 max-w-6xl px-4 pb-32 pt-8 sm:px-6 lg:pt-10">{children}</main>

      {/* Ask Hamilton, docked on every screen */}
      <HamiltonAskDock selectedInstitutionId={selectedInstitutionId} />
    </div>
  );
}
