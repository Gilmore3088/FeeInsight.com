"use client";

import { updateProfile } from "./actions";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AccountCard } from "./account-card";

interface ProfileFormProps {
  user: {
    institution_name: string | null;
    institution_type: string | null;
    asset_tier: string | null;
    state_code: string | null;
    job_role: string | null;
  };
}

const INSTITUTION_TYPES = [
  { value: "", label: "Choose" },
  { value: "bank", label: "Bank" },
  { value: "credit_union", label: "Credit Union" },
  { value: "fintech", label: "Fintech / Vendor" },
  { value: "consulting", label: "Consulting / Advisory" },
  { value: "regulatory", label: "Regulatory / Government" },
  { value: "other", label: "Other" },
];

const ASSET_TIERS = [
  { value: "", label: "Choose" },
  { value: "micro", label: "Under $100M" },
  { value: "community", label: "$100M - $1B" },
  { value: "midsize", label: "$1B - $10B" },
  { value: "regional", label: "$10B - $250B" },
  { value: "mega", label: "Over $250B" },
];

const JOB_ROLES = [
  { value: "", label: "Choose" },
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

export function ProfileForm({ user }: ProfileFormProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isBankOrCU = user.institution_type === "bank" || user.institution_type === "credit_union";
  const [showBankFields, setShowBankFields] = useState(isBankOrCU);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const formData = new FormData(e.currentTarget);
    const result = await updateProfile(formData);
    setSaving(false);
    if (result.success) {
      setError(null);
      setEditing(false);
      setSaved(true);
      // The summary reads the profile from the server, so it shows the old values until refreshed.
      router.refresh();
      setTimeout(() => setSaved(false), 3000);
    } else {
      setError(result.error ?? "That didn't save. Try again.");
    }
  }

  const selectClass = "min-h-11 w-full rounded-md border border-[#D5CBBF] bg-white px-3 py-2 text-[16px] sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#C44B2E] focus:border-transparent";
  const inputClass = selectClass;

  if (!editing) {
    const typeLabel = INSTITUTION_TYPES.find((t) => t.value === user.institution_type)?.label;
    const roleLabel = JOB_ROLES.find((r) => r.value === user.job_role)?.label;
    const tierLabel = ASSET_TIERS.find((t) => t.value === user.asset_tier)?.label;

    return (
      <AccountCard
        id="profile"
        title="Your organization"
        compact
        action={
          <button
            onClick={() => setEditing(true)}
            className="-my-2.5 min-h-11 shrink-0 px-1 text-[14px] font-medium text-[#A93D25] hover:underline"
          >
            {user.institution_name ? "Edit" : "Add"}
          </button>
        }
      >
        {user.institution_name ? (
          <div className="space-y-1 text-[14px]">
            <div className="font-medium text-[#1A1815]">{user.institution_name}</div>
            <div className="text-[#6B6255]">
              {[typeLabel, tierLabel, user.state_code, roleLabel]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
        ) : (
          <p className="text-[14px] text-[#6B6255]">
            Add where you work and your role.
          </p>
        )}
        {saved && (
          <p role="status" className="mt-2 text-[13px] text-emerald-700">Saved.</p>
        )}
      </AccountCard>
    );
  }

  return (
    <AccountCard id="profile" title="Your organization" compact>
    <form onSubmit={handleSubmit}>
      <div className="space-y-3">
        <div>
          <label htmlFor="profile-institution-name" className="block text-[13px] font-medium text-[#1A1815] mb-1">Bank, credit union or company</label>
          <input id="profile-institution-name" name="institution_name" defaultValue={user.institution_name || ""} className={inputClass} placeholder="First National Bank" />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="profile-institution-type" className="block text-[13px] font-medium text-[#1A1815] mb-1">Type</label>
            <select
              id="profile-institution-type"
              name="institution_type"
              defaultValue={user.institution_type || ""}
              onChange={(e) => setShowBankFields(e.target.value === "bank" || e.target.value === "credit_union")}
              className={selectClass}
            >
              {INSTITUTION_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="profile-job-role" className="block text-[13px] font-medium text-[#1A1815] mb-1">Your role</label>
            <select id="profile-job-role" name="job_role" defaultValue={user.job_role || ""} className={selectClass}>
              {JOB_ROLES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
        </div>
        {showBankFields && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="profile-asset-tier" className="block text-[13px] font-medium text-[#1A1815] mb-1">Asset size</label>
              <select id="profile-asset-tier" name="asset_tier" defaultValue={user.asset_tier || ""} className={selectClass}>
                {ASSET_TIERS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="profile-state-code" className="block text-[13px] font-medium text-[#1A1815] mb-1">State</label>
              <select id="profile-state-code" name="state_code" defaultValue={user.state_code || ""} className={selectClass}>
                <option value="">Choose</option>
                {US_STATES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-[13px] text-red-700">
          {error}
        </p>
      )}
      <div className="flex gap-2 mt-4">
        <button
          type="submit"
          disabled={saving}
          className="min-h-11 rounded-md bg-[#C44B2E] px-5 text-[14px] font-medium text-white hover:bg-[#A83D25] disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="min-h-11 rounded-md border border-[#D5CBBF] px-5 text-[14px] font-medium text-[#1A1815] hover:border-[#1A1815] transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
    </AccountCard>
  );
}
