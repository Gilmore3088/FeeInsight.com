"use client";

import { useState } from "react";
import Link from "next/link";
import { CONTACT_EMAIL } from "@/lib/constants";
import { saveOnboardingProfile } from "../actions";
import { InstitutionPicker } from "@/components/hamilton/InstitutionPicker";
import type {
  InstitutionWorkspaceInvitation,
  InstitutionWorkspaceMembership,
} from "@/lib/hamilton/institution-membership";

interface WelcomeStepsProps {
  userName: string;
  user: {
    institution_name: string | null;
    institution_type: string | null;
    asset_tier: string | null;
    state_code: string | null;
    job_role: string | null;
  };
  feePreview: { category: string; displayName: string; median: number }[];
  districtName: string | null;
  districtId: number | null;
  isPro: boolean;
  /** Back from a paid checkout but Stripe has not confirmed yet: never send them to pay again. */
  activationPending?: boolean;
  pendingWorkspaceInvitations: InstitutionWorkspaceInvitation[];
  workspaceMemberships: InstitutionWorkspaceMembership[];
}

const ORGANIZATION_TYPES = [
  { value: "", label: "Select..." },
  { value: "fintech", label: "Fintech / Vendor" },
  { value: "consulting", label: "Consulting / Advisory" },
  { value: "regulatory", label: "Regulatory / Government" },
  { value: "other", label: "Other" },
];

const JOB_ROLES = [
  { value: "", label: "Select..." },
  { value: "executive", label: "Executive / C-Suite" },
  { value: "treasury", label: "Treasury / Finance" },
  { value: "compliance", label: "Compliance / Risk" },
  { value: "marketing", label: "Marketing / Product" },
  { value: "analyst", label: "Analyst / Research" },
  { value: "developer", label: "Developer / Engineer" },
  { value: "other", label: "Other" },
];

const TOOLS = [
  {
    name: "Hamilton workspace",
    description: "Benchmark, scenario, report and monitor your fee position against a verified peer set.",
    icon: "M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z",
    href: "/pro/analyze",
    requiresPro: true,
  },
  {
    name: "Peer Analysis",
    description: "Compare your institution against peers by charter type, asset tier, and Fed district.",
    icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6m14 0v-6a2 2 0 00-2-2h-2a2 2 0 00-2 2v6",
    href: "/pro/analyze",
    requiresPro: true,
  },
  {
    name: "Data Exports",
    description: "Download CSV reports for board presentations, compliance reviews, and internal analysis.",
    icon: "M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
    href: "/api/v1/fees?format=csv",
    requiresPro: true,
  },
  {
    name: "API and Exports",
    description: "Review public REST docs; Seat License users can export verified-only CSV data.",
    icon: "M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4",
    href: "/api-docs",
  },
];

export function WelcomeSteps({
  userName,
  user,
  feePreview,
  isPro,
  activationPending = false,
  pendingWorkspaceInvitations,
  workspaceMemberships,
}: WelcomeStepsProps) {
  // Someone who already told us their organization skips that step, except Pro members:
  // Hamilton needs a real institution picked from the list, not a typed name.
  const [step, setStep] = useState(user.institution_name && !isPro ? 2 : 1);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedInstitution, setSavedInstitution] = useState<string | null>(null);
  const [pickedInstitution, setPickedInstitution] = useState(false);
  const [notAnInstitution, setNotAnInstitution] = useState(
    !!user.institution_type && user.institution_type !== "bank" && user.institution_type !== "credit_union"
  );

  const inputClass = "w-full rounded-md border border-[#D5CBBF] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C44B2E] focus:border-transparent";

  async function handleProfileSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    const formData = new FormData(e.currentTarget);
    if (notAnInstitution) formData.delete("institution_id");
    const result = await saveOnboardingProfile(formData);
    setSaving(false);
    if (!result.success) {
      setSaveError(result.error ?? "Failed to save your profile.");
      return;
    }
    setSavedInstitution(result.institutionName ?? null);
    setStep(2);
  }

  return (
    <div className="max-w-2xl mx-auto">
      {activationPending && (
        <div role="status" className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">Payment received. Activating your Pro access.</p>
          <p className="mt-1">
            Stripe usually confirms within a minute. <Link href="/account/welcome?success=true" className="font-semibold underline">Refresh this page</Link>{" "}
            to check; you won&apos;t be charged again. If it still isn&apos;t active after a few minutes, write to {CONTACT_EMAIL}.
          </p>
        </div>
      )}

      {pendingWorkspaceInvitations.length > 0 && !isPro && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">Workspace invitation waiting</p>
          <p className="mt-1">
            Your email has been invited to an institution account. It includes up to five teammates, so you don&apos;t need to pay to join:
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {pendingWorkspaceInvitations.map((invitation) => (
              <span
                key={invitation.id}
                className="rounded-full border border-amber-200 bg-white/70 px-2.5 py-1 text-xs font-semibold"
              >
                {invitation.institutionName} · {invitation.role}
              </span>
            ))}
          </div>
          <Link
            href="/workspace-invite"
            className="mt-4 inline-flex rounded-full bg-[#C44B2E] px-4 py-2 text-xs font-semibold text-white no-underline"
          >
            Accept invitation
          </Link>
        </div>
      )}

      {workspaceMemberships.length > 0 && (
        <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p className="font-semibold">Hamilton workspace access is active</p>
          <div className="mt-3 grid gap-2">
            {workspaceMemberships.slice(0, 3).map((membership) => (
              <div key={membership.id} className="rounded-lg border border-emerald-100 bg-white/70 px-3 py-2">
                <p className="font-semibold text-[#1A1815]">{membership.institutionName}</p>
                <p className="text-xs text-[#6B6255]">
                  {membership.role} access · institution ID {membership.institutionId}
                </p>
              </div>
            ))}
          </div>
          <Link
            href={`/pro/analyze?instId=${workspaceMemberships[0].institutionId}`}
            className="mt-4 inline-flex rounded-full bg-[#1A1815] px-4 py-2 text-xs font-semibold text-white no-underline"
          >
            Open Hamilton
          </Link>
        </div>
      )}

      {/* Progress */}
      <div className="flex items-center gap-2 mb-8">
        {[1, 2, 3, 4].map((s) => (
          <div
            key={s}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              s <= step ? "bg-[#C44B2E]" : "bg-[#E8DFD1]"
            }`}
          />
        ))}
      </div>

      {/* Step 1: Profile */}
      {step === 1 && (
        <div>
          <h1
            className="text-2xl font-normal tracking-tight text-[#1A1815] mb-2"
            style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
          >
            Welcome to Fee Insight, {userName.split(" ")[0]}!
          </h1>
          <p className="text-sm text-[#6B6255] mb-6">
            Which institution do you work for? Hamilton compares its fees with its peers.
          </p>

          <form onSubmit={handleProfileSave} className="bg-[#FFFDF9] rounded-xl border border-[#E8DFD1] p-6 space-y-4">
            {notAnInstitution ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="welcome_organization" className="block text-xs font-medium text-[#1A1815] mb-1">Organization</label>
                  <input id="welcome_organization" name="institution_name" defaultValue={user.institution_name || ""} className={inputClass} placeholder="Your company" />
                </div>
                <div>
                  <label htmlFor="welcome_organization_type" className="block text-xs font-medium text-[#1A1815] mb-1">Type</label>
                  <select id="welcome_organization_type" name="institution_type" defaultValue={user.institution_type || ""} className={inputClass}>
                    {ORGANIZATION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
              </div>
            ) : (
              <InstitutionPicker
                inputId="welcome_institution"
                label="Your bank or credit union"
                help="Choose your institution from the list."
                initialName={null}
                onSelect={(result) => setPickedInstitution(result !== null)}
                labelClassName="block text-xs font-medium text-[#1A1815] mb-1"
                labelStyle={{}}
                inputClassName={inputClass}
                inputStyle={{}}
              />
            )}
            <button
              type="button"
              onClick={() => setNotAnInstitution((value) => !value)}
              className="text-xs font-medium text-[#C44B2E] underline-offset-2 hover:underline"
            >
              {notAnInstitution ? "I work at a bank or credit union" : "I don't work at a bank or credit union"}
            </button>
            <div>
              <label htmlFor="welcome_job_role" className="block text-xs font-medium text-[#1A1815] mb-1">Your role</label>
              <select id="welcome_job_role" name="job_role" defaultValue={user.job_role || ""} className={inputClass}>
                {JOB_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            {saveError && (
              <p role="alert" className="text-sm text-[#B42318]">{saveError}</p>
            )}
            <button
              type="submit"
              disabled={saving || (!notAnInstitution && !pickedInstitution)}
              className="w-full rounded-md bg-[#C44B2E] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#A83D25] disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving..." : "Continue"}
            </button>
            {!notAnInstitution && (
              <button
                type="button"
                onClick={() => setStep(2)}
                className="w-full text-center text-xs font-medium text-[#6B6255] hover:text-[#1A1815]"
              >
                Can&apos;t find it? Skip for now; you can choose it later in Settings.
              </button>
            )}
          </form>
        </div>
      )}

      {/* Step 2: Fee Preview */}
      {step === 2 && (
        <div>
          <h1
            className="text-2xl font-normal tracking-tight text-[#1A1815] mb-2"
            style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
          >
            Your fee intelligence
          </h1>
          <p className="text-sm text-[#6B6255] mb-6">
            {savedInstitution ? `${savedInstitution} is saved as your institution. ` : ""}
            Here are the national median fees across key categories (each institution counted once). With your account, you can drill into the full fee catalog with peer filters.
          </p>

          <div className="bg-[#FFFDF9] rounded-xl border border-[#E8DFD1] overflow-hidden mb-6">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[#E8DFD1] bg-[#FAF7F2]">
                  <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[#6B6255]">Category</th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-bold uppercase tracking-[0.12em] text-[#6B6255]">National Median</th>
                </tr>
              </thead>
              <tbody>
                {feePreview.map((fee) => (
                  <tr key={fee.category} className="border-b border-[#E8DFD1] last:border-0">
                    <td className="px-4 py-3 text-[#1A1815]">{fee.displayName}</td>
                    <td className="px-4 py-3 text-right font-medium text-[#1A1815] tabular-nums">${fee.median.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep(3)}
              className="flex-1 rounded-md bg-[#C44B2E] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#A83D25] transition-colors"
            >
              Continue
            </button>
            <Link
              href="/fees"
              className="flex-1 text-center rounded-md border border-[#D5CBBF] px-4 py-2.5 text-sm font-medium text-[#1A1815] hover:border-[#1A1815] transition-colors"
            >
              Explore the Bank Fee Index
            </Link>
          </div>
        </div>
      )}

      {/* Step 3: Tools */}
      {step === 3 && (
        <div>
          <h1
            className="text-2xl font-normal tracking-tight text-[#1A1815] mb-2"
            style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
          >
            Your tools
          </h1>
          <p className="text-sm text-[#6B6255] mb-6">
            Everything you need for fee intelligence research and analysis.
          </p>

          <div className="grid grid-cols-2 gap-3 mb-6">
            {TOOLS.map((tool) => {
              const href = tool.requiresPro && !isPro
                ? activationPending ? "/account/welcome?success=true" : "/subscribe"
                : tool.href;

              return (
                <Link
                  key={tool.name}
                  href={href}
                  className="bg-[#FFFDF9] rounded-xl border border-[#E8DFD1] p-4 no-underline transition-colors hover:border-[#C44B2E]/30 hover:bg-white"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-5 w-5 text-[#C44B2E] mb-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d={tool.icon} />
                  </svg>
                  <h3 className="text-sm font-medium text-[#1A1815] mb-1">
                    {tool.name}
                    {tool.requiresPro && !isPro && (
                      <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold bg-[#E8DFD1] text-[#6B6255] uppercase">Pro</span>
                    )}
                  </h3>
                  <p className="text-xs text-[#6B6255] leading-relaxed">{tool.description}</p>
                </Link>
              );
            })}
          </div>

          <button
            onClick={() => setStep(4)}
            className="w-full rounded-md bg-[#C44B2E] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#A83D25] transition-colors"
          >
            Continue
          </button>
        </div>
      )}

      {/* Step 4: Done */}
      {step === 4 && (
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-50 mb-4">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="w-8 h-8 text-emerald-600" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>
          <h1
            className="text-2xl font-normal tracking-tight text-[#1A1815] mb-2"
            style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
          >
            You&apos;re all set
          </h1>
          <p className="text-sm text-[#6B6255] mb-8">
            Your account is ready. Start exploring fee intelligence data.
          </p>
          <div className="flex gap-3 justify-center">
            <Link
              href={isPro ? "/pro/hamilton" : "/account"}
              className="rounded-md bg-[#C44B2E] px-6 py-2.5 text-sm font-medium text-white hover:bg-[#A83D25] transition-colors"
            >
              {isPro ? "Open Hamilton" : "Go to Account"}
            </Link>
            <Link
              href="/fees"
              className="rounded-md border border-[#D5CBBF] px-6 py-2.5 text-sm font-medium text-[#1A1815] hover:border-[#1A1815] transition-colors"
            >
              Browse the Bank Fee Index
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
