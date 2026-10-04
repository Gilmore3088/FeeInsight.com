"use client";

import { useState } from "react";
import Link from "next/link";
import { updateProfile } from "../actions";
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
  pendingWorkspaceInvitations: InstitutionWorkspaceInvitation[];
  workspaceMemberships: InstitutionWorkspaceMembership[];
}

const INSTITUTION_TYPES = [
  { value: "", label: "Select..." },
  { value: "bank", label: "Bank" },
  { value: "credit_union", label: "Credit Union" },
  { value: "fintech", label: "Fintech / Vendor" },
  { value: "consulting", label: "Consulting / Advisory" },
  { value: "regulatory", label: "Regulatory / Government" },
  { value: "other", label: "Other" },
];

const ASSET_TIERS = [
  { value: "", label: "Select..." },
  { value: "micro", label: "Under $100M" },
  { value: "community", label: "$100M - $1B" },
  { value: "midsize", label: "$1B - $10B" },
  { value: "regional", label: "$10B - $250B" },
  { value: "mega", label: "Over $250B" },
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

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN",
  "IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH",
  "NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT",
  "VT","VA","WA","WV","WI","WY",
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
  pendingWorkspaceInvitations,
  workspaceMemberships,
}: WelcomeStepsProps) {
  // Someone who already told us their organization (at signup or earlier) skips that step.
  const [step, setStep] = useState(user.institution_name ? 2 : 1);
  const [saving, setSaving] = useState(false);
  const [showBankFields, setShowBankFields] = useState(
    user.institution_type === "bank" || user.institution_type === "credit_union"
  );

  const inputClass = "w-full rounded-md border border-[#D5CBBF] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C44B2E] focus:border-transparent";

  async function handleProfileSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const formData = new FormData(e.currentTarget);
    await updateProfile(formData);
    setSaving(false);
    setStep(2);
  }

  return (
    <div className="max-w-2xl mx-auto">
      {pendingWorkspaceInvitations.length > 0 && !isPro && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">Workspace invitation ready after Pro activation</p>
          <p className="mt-1">
            Your email has delegated Hamilton access waiting. Activate a Pro seat to attach:
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
            href="/subscribe?invite=workspace"
            className="mt-4 inline-flex rounded-full bg-[#C44B2E] px-4 py-2 text-xs font-semibold text-white no-underline"
          >
            Activate Pro Seat
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
            Tell us about your organization so we can personalize your experience.
          </p>

          <form onSubmit={handleProfileSave} className="bg-[#FFFDF9] rounded-xl border border-[#E8DFD1] p-6 space-y-4">
            <div>
              <label htmlFor="welcome-institution-name" className="block text-xs font-medium text-[#1A1815] mb-1">Institution / Company</label>
              <input id="welcome-institution-name" name="institution_name" defaultValue={user.institution_name || ""} className={inputClass} placeholder="First National Bank" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="welcome-institution-type" className="block text-xs font-medium text-[#1A1815] mb-1">Type</label>
                <select id="welcome-institution-type" name="institution_type" defaultValue={user.institution_type || ""} onChange={(e) => setShowBankFields(e.target.value === "bank" || e.target.value === "credit_union")} className={inputClass}>
                  {INSTITUTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="welcome-job-role" className="block text-xs font-medium text-[#1A1815] mb-1">Your role</label>
                <select id="welcome-job-role" name="job_role" defaultValue={user.job_role || ""} className={inputClass}>
                  {JOB_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
            </div>
            {showBankFields && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="welcome-asset-tier" className="block text-xs font-medium text-[#1A1815] mb-1">Asset size</label>
                  <select id="welcome-asset-tier" name="asset_tier" defaultValue={user.asset_tier || ""} className={inputClass}>
                    {ASSET_TIERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="welcome-state-code" className="block text-xs font-medium text-[#1A1815] mb-1">State</label>
                  <select id="welcome-state-code" name="state_code" defaultValue={user.state_code || ""} className={inputClass}>
                    <option value="">Select...</option>
                    {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
            )}
            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-md bg-[#C44B2E] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#A83D25] disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving..." : "Continue"}
            </button>
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
            Here are the national median fees across key categories. With your account, you can drill into the full fee catalog with peer filters.
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
              const href = tool.requiresPro && !isPro ? "/subscribe" : tool.href;

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
