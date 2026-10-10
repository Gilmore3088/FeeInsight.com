"use client";

import Link from "next/link";
import type { HamiltonContextSource } from "@/lib/hamilton/context-source";
import type { HamiltonAccountContext } from "@/lib/hamilton/account-context";
import { ConsumerNav } from "@/components/consumer-nav";
import { setViewAsCustomer } from "@/app/pro/(hamilton)/view-as-actions";
import { HamiltonAskDock } from "./HamiltonAskDock";
import { SearchModal } from "@/components/public/search-modal";
import { SessionChromeProvider, type SessionChrome } from "@/components/use-session-chrome";

interface HamiltonShellProps {
  isAdmin: boolean;
  /** The signed-in user as the header needs it, read by the layout so the Pro nav shows on first paint. */
  session: SessionChrome;
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
  accountContext?: Pick<HamiltonAccountContext, "status" | "institution">;
  children: React.ReactNode;
}

/**
 * HamiltonShell - Client component.
 * Outer shell wrapper applying .hamilton-shell CSS isolation boundary.
 * Composes: admin bar (admins only), the Fee Insight site header, the page, and the docked Ask bar.
 * No sidebar and no second bar: James wants the simplicity of the living-memo samples.
 * Per D-13, ARCH-01: .hamilton-shell class scopes all editorial design tokens.
 * Per D-10: admin mode bar shown only to admin/analyst users.
 */
export function HamiltonShell({
  isAdmin,
  session,
  viewAsCustomer = false,
  institutionContext,
  selectedInstitutionId,
  accountContext,
  children,
}: HamiltonShellProps) {
  return (
    <SessionChromeProvider value={session}>
      <div
        className="hamilton-shell min-h-screen bg-warm-100 print:bg-white"
      >
        {/* Admin mode bar - only for admin/analyst users (T-40-05) */}
        {isAdmin && (
          <div className="bg-warm-900 text-white flex flex-wrap items-center justify-between gap-2 px-4 py-1.5 text-xs print:hidden">
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

        {/* The Fee Insight site header, the same one as the public site; for Pro users its links are
            Hamilton's four tabs (James, 2026-10-06: one header across the site and Pro).
            The page-reveal animation gives each shell child its own stacking context, so the
            wrapper carries the header's sticky z-index; without it the page painted over the
            account menu. */}
        <div className="sticky top-0 z-40 print:hidden">
          <ConsumerNav />
        </div>

        {accountContext ? (
          <div aria-label="Institution context" className="border-b border-warm-300 px-4 py-2 text-sm text-warm-800">
            <span>Researching: {selectedInstitutionId ? institutionContext.name ?? `Institution ${selectedInstitutionId}` : institutionContext.name === "Market research" ? "Market research" : "No research subject selected"}.</span>{" "}
            <span>Account institution: {accountContext.status === "identified" && accountContext.institution
              ? accountContext.institution.name
              : accountContext.status === "ambiguous" ? "multiple memberships; no home selected"
              : accountContext.status === "unavailable" ? "unavailable"
              : "not linked"}.</span>
          </div>
        ) : null}

        {institutionContext.makeDefaultHref ? (
          <div className="border-b border-warm-300 bg-warm-150 px-4 py-2 text-center text-sm text-warm-800 print:hidden">
            You&apos;re researching {institutionContext.name ?? "another institution"}; your saved research preference is unchanged.{" "}
            <Link href={institutionContext.makeDefaultHref} className="font-medium text-terra-text underline">
              Change research preference in Settings
            </Link>
          </div>
        ) : null}

        <main className="mx-auto min-w-0 max-w-page px-4 pb-32 pt-8 sm:px-6 lg:pt-10 print:max-w-none print:p-0">{children}</main>

        {/* Ask Hamilton, docked on every screen */}
        <HamiltonAskDock selectedInstitutionId={selectedInstitutionId} />

        {/* The header's Search button and Cmd/Ctrl+K open this; the public layout mounts its own. */}
        <SearchModal />
      </div>
    </SessionChromeProvider>
  );
}
