"use client";

import { useCallback, useState } from "react";
import { FileText } from "lucide-react";
import { PRODUCT_NAME } from "@/lib/constants";
import { submitFees, searchInstitutions } from "./actions";
import { SubmitSuccessCard } from "./submit-success";
import { FeeRowsEditor, type FeeRow } from "./fee-rows-editor";

const FEE_CATEGORIES = [
  { value: "monthly_maintenance", label: "Monthly Maintenance" },
  { value: "overdraft", label: "Overdraft" },
  { value: "nsf", label: "NSF / Returned Item" },
  { value: "atm_non_network", label: "ATM (Non-Network)" },
  { value: "wire_domestic_outgoing", label: "Wire Transfer (Outgoing)" },
] as const;

const DEFAULT_FEE_NAMES = new Set<string>(FEE_CATEGORIES.map((category) => category.label));

const SUBMITTER_ROLES = [
  { value: "consumer", label: "Consumer" },
  { value: "institution_employee", label: "Institution employee" },
  { value: "consultant", label: "Consultant or advisor" },
  { value: "other", label: "Other" },
] as const;

interface SubmitFormProps {
  initialInstitutionId?: number | null;
  initialInstitutionName?: string;
  initialSourceUrl?: string;
  initialSubmitterRole?: string;
  initialNotes?: string;
  claimFlow?: boolean;
  profileHref?: string | null;
}

const EMPTY_FEE: FeeRow = {
  fee_category: "",
  fee_name: "",
  amount: "",
  frequency: "per_occurrence",
};

function defaultFeeRows(): FeeRow[] {
  return FEE_CATEGORIES.map((category) => ({
    fee_category: category.value,
    fee_name: category.label,
    amount: "",
    frequency: category.value === "monthly_maintenance" ? "monthly" : "per_occurrence",
  }));
}

export function SubmitForm({
  initialInstitutionId = null,
  initialInstitutionName = "",
  initialSourceUrl = "",
  initialSubmitterRole = "consumer",
  initialNotes = "",
  claimFlow = false,
  profileHref = null,
}: SubmitFormProps) {
  const [institutionId, setInstitutionId] = useState<number | null>(initialInstitutionId);
  const [institutionName, setInstitutionName] = useState(initialInstitutionName);
  const [sourceUrl, setSourceUrl] = useState(initialSourceUrl);
  const [submitterRole, setSubmitterRole] = useState(
    SUBMITTER_ROLES.some((role) => role.value === initialSubmitterRole)
      ? initialSubmitterRole
      : "consumer",
  );
  const [notes, setNotes] = useState(initialNotes);
  const [contactEmail, setContactEmail] = useState("");
  const [submittedWithEmail, setSubmittedWithEmail] = useState(false);
  const [fees, setFees] = useState<FeeRow[]>(defaultFeeRows);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [suggestions, setSuggestions] = useState<
    { id: number; name: string; state: string | null }[]
  >([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const handleSearch = useCallback(async (query: string) => {
    setInstitutionName(query);
    setInstitutionId(null);
    if (query.length >= 2) {
      const results = await searchInstitutions(query);
      setSuggestions(results);
      setShowSuggestions(true);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }, []);

  function selectInstitution(selection: { id: number; name: string }) {
    setInstitutionId(selection.id);
    setInstitutionName(selection.name);
    setShowSuggestions(false);
  }

  function updateFee(index: number, field: keyof FeeRow, value: string) {
    setFees((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  function addFeeRow() {
    setFees((prev) => [...prev, EMPTY_FEE]);
  }

  function removeFeeRow(index: number) {
    setFees((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);

    const validFees = fees
      .filter((fee) => {
        const feeName = fee.fee_name.trim();
        return fee.amount.trim() || (feeName && !DEFAULT_FEE_NAMES.has(feeName));
      })
      .map((fee) => ({
        fee_name: fee.fee_name.trim(),
        fee_category: fee.fee_category,
        amount: fee.amount.trim() ? parseFloat(fee.amount) || null : null,
        frequency: fee.frequency,
      }));

    const res = await submitFees({
      institution_id: institutionId,
      institution_name: institutionName,
      source_url: sourceUrl,
      submitter_role: submitterRole,
      notes,
      contact_email: contactEmail.trim() || null,
      fees: validFees,
    });

    setResult(res);
    setSubmitting(false);

    if (res.success) {
      setSubmittedWithEmail(Boolean(contactEmail.trim()));
      setFees(defaultFeeRows());
      setSourceUrl("");
      setNotes("");
      setContactEmail("");
    }
  }

  if (result?.success) {
    return (
      <SubmitSuccessCard
        claimFlow={claimFlow}
        profileHref={profileHref}
        contactEmailProvided={submittedWithEmail}
        onSubmitAnother={() => setResult(null)}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} className="min-w-0 overflow-hidden border border-border bg-white p-5">
      <div className="space-y-5">
        <div className="relative">
          <label htmlFor="institution-name" className="block text-xs font-bold uppercase tracking-[0.12em] text-ink-muted">
            Institution
          </label>
          <input
            id="institution-name"
            type="text"
            required
            value={institutionName}
            onChange={(e) => handleSearch(e.target.value)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            placeholder="Search for a bank or credit union"
            className="mt-1 w-full min-w-0 rounded-md border border-border px-3 py-2 text-sm outline-none transition-colors focus:border-brick"
          />
          {institutionId && (
            <p className="mt-1 text-xs text-ink-muted">
              Matched to an institution in the {PRODUCT_NAME}
            </p>
          )}
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute z-10 mt-1 max-h-52 w-full overflow-y-auto rounded-md border border-border bg-white shadow-lg">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion.id}
                  type="button"
                  onMouseDown={() => selectInstitution(suggestion)}
                  className="w-full border-b border-surface-200 px-3 py-2 text-left text-sm last:border-0 hover:bg-paper"
                >
                  <span className="font-medium text-ink">{suggestion.name}</span>
                  {suggestion.state && (
                    <span className="ml-1 text-ink-muted">({suggestion.state})</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <label htmlFor="source-url" className="block text-xs font-bold uppercase tracking-[0.12em] text-ink-muted">
            Link to the published fee schedule
          </label>
          <div className="mt-1 flex min-w-0 gap-2">
            <FileText className="mt-2.5 h-4 w-4 shrink-0 text-brick" />
            <input
              id="source-url"
              type="url"
              required
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://bank.example/fee-schedule.pdf"
              className="min-w-0 flex-1 rounded-md border border-border px-3 py-2 text-sm outline-none transition-colors focus:border-brick"
            />
          </div>
          <p className="mt-1 text-xs text-ink-muted">
            Use a fee schedule page, PDF, disclosure, or account agreement from the institution.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="submitter-role" className="block text-xs font-bold uppercase tracking-[0.12em] text-ink-muted">
              Your role
            </label>
            <select
              id="submitter-role"
              value={submitterRole}
              onChange={(e) => setSubmitterRole(e.target.value)}
              className="mt-1 w-full min-w-0 rounded-md border border-border px-3 py-2 text-sm outline-none transition-colors focus:border-brick"
            >
              {SUBMITTER_ROLES.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="notes" className="block text-xs font-bold uppercase tracking-[0.12em] text-ink-muted">
              Notes
            </label>
            <input
              id="notes"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional context for reviewers"
              className="mt-1 w-full min-w-0 rounded-md border border-border px-3 py-2 text-sm outline-none transition-colors focus:border-brick"
            />
          </div>
        </div>

        <div>
          <label htmlFor="contact-email" className="block text-xs font-bold uppercase tracking-[0.12em] text-ink-muted">
            Work email <span className="font-normal normal-case tracking-normal">(optional)</span>
          </label>
          <input
            id="contact-email"
            type="email"
            autoComplete="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            placeholder="you@yourinstitution.com"
            className="mt-1 w-full min-w-0 rounded-md border border-border px-3 py-2 text-sm outline-none transition-colors focus:border-brick"
          />
          <p className="mt-1 text-xs text-ink-muted">We&apos;ll tell you when it&apos;s reviewed.</p>
        </div>

        <FeeRowsEditor fees={fees} onUpdate={updateFee} onAdd={addFeeRow} onRemove={removeFeeRow} />

        <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center justify-center rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#2C2822] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Sending…" : "Send for review"}
          </button>
          {result && !result.success && (
            <span className="text-sm text-red-700" role="alert">
              {result.message}
            </span>
          )}
        </div>
      </div>
    </form>
  );
}
