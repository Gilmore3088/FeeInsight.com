"use client";

import { register } from "./actions";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { resetSessionChrome } from "@/components/use-session-chrome";
import { trackEvent } from "@/lib/analytics";
import type { RegisterVariant } from "./register-destination";
import { HoneypotField } from "@/components/public/honeypot-field";

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

export function RegisterForm({
  redirectTo = "/account",
  variant = "professional",
  checkout = false,
}: {
  redirectTo?: string;
  variant?: RegisterVariant;
  /** On the way to Pro checkout: the bank is already picked, so skip the organization fields. */
  checkout?: boolean;
}) {
  const router = useRouter();
  const isConsumer = variant === "consumer";
  const [error, setError] = useState<string | null>(null);
  const [loginHref, setLoginHref] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [showBankFields, setShowBankFields] = useState(false);

  function handleTypeChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setShowBankFields(e.target.value === "bank" || e.target.value === "credit_union");
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoginHref(null);
    setPending(true);

    const formData = new FormData(e.currentTarget);
    const result = await register(formData, redirectTo);

    if (result.success && result.redirect) {
      trackEvent("create_account", { variant });
      // The nav caches the signed-out session; drop it so the new account shows at once.
      resetSessionChrome();
      router.push(result.redirect);
      router.refresh();
    } else {
      setError(result.error || "Registration failed");
      setLoginHref(result.loginHref ?? null);
      setPending(false);
    }
  }

  const inputClass = "w-full rounded-md border border-[#D5CBBF] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C44B2E] focus:border-transparent";
  const labelClass = "block text-sm font-medium text-[#1A1815] mb-1";
  const selectClass = `${inputClass} appearance-none`;

  return (
    <form onSubmit={handleSubmit} className="relative bg-[#FFFDF9] rounded-lg border border-[#E8DFD1] shadow-sm p-6 space-y-4">
      <HoneypotField />
      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {error}
          {loginHref && (
            <>
              {" "}
              <Link href={loginHref} className="font-medium underline">
                Sign in instead
              </Link>
            </>
          )}
        </div>
      )}

      {!isConsumer && (
        <div>
          <label htmlFor="name" className={labelClass}>Full name</label>
          <input id="name" name="name" type="text" required autoComplete="name" className={inputClass} />
        </div>
      )}

      <div>
        <label htmlFor="email" className={labelClass}>{isConsumer ? "Email" : "Work email"}</label>
        <input id="email" name="email" type="email" required autoComplete="email" className={inputClass} />
      </div>

      <div>
        <label htmlFor="password" className={labelClass}>Password</label>
        <input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" className={inputClass} />
        <p className="mt-1 text-xs text-[#6B6255]">Minimum 8 characters</p>
      </div>

      {/* Professional context: only asked of people signing up for professional work. */}
      {!isConsumer && !checkout && (
      <div className="border-t border-[#E8DFD1] pt-4 mt-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#6B6255] mb-3">
          About your organization
        </p>

        <div className="space-y-3">
          <div>
            <label htmlFor="institution_name" className={labelClass}>Institution / Company</label>
            <input id="institution_name" name="institution_name" type="text" className={inputClass} placeholder="First National Bank" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="institution_type" className={labelClass}>Type</label>
              <select id="institution_type" name="institution_type" onChange={handleTypeChange} className={selectClass}>
                {INSTITUTION_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="job_role" className={labelClass}>Your role</label>
              <select id="job_role" name="job_role" className={selectClass}>
                {JOB_ROLES.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
          </div>

          {showBankFields && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="asset_tier" className={labelClass}>Asset size</label>
                <select id="asset_tier" name="asset_tier" className={selectClass}>
                  {ASSET_TIERS.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="state_code" className={labelClass}>State</label>
                <select id="state_code" name="state_code" className={selectClass}>
                  <option value="">Select...</option>
                  {US_STATES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>
      </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-[#C44B2E] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#A83D25] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {pending ? "Creating account..." : isConsumer ? "Create free account" : checkout ? "Continue to checkout" : "Create account"}
      </button>
    </form>
  );
}
