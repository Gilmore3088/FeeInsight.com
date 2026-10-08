"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { InstitutionPicker } from "@/components/hamilton/InstitutionPicker";

interface ProTierChooserProps {
  /** What the price below is for, once chosen: "First Bank, Huntsville, AL · Under $500M in assets". */
  chosenLabel: string | null;
  /** Shown instead of a price when the chosen institution has no asset size on file. */
  problem?: string | null;
}

/**
 * Picks who the plan covers. The choice lives in the URL (?inst= or ?org=other) so it
 * survives sign-up and the server can price it; checkout re-checks the tier itself.
 */
export function ProTierChooser({ chosenLabel, problem = null }: ProTierChooserProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function go(update: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("inst");
    params.delete("org");
    params.delete("checkout");
    update(params);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}#pro-heading` : `${pathname}#pro-heading`, { scroll: false });
  }

  if (chosenLabel) {
    return (
      <div className="rounded-lg border border-[#E0D7C9] bg-white p-4 text-sm">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#6B6255]">Your price is for</p>
        <p className="mt-1 font-semibold text-[#1A1815]">{chosenLabel}</p>
        {problem && <p className="mt-2 text-[#A93D25]">{problem}</p>}
        <button
          type="button"
          onClick={() => go(() => {})}
          className="mt-2 text-xs font-medium text-[#A93D25] underline underline-offset-2"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[#E0D7C9] bg-white p-4">
      <InstitutionPicker
        inputId="pro_tier_institution"
        name="pro_tier_institution_id"
        label="Your bank or credit union"
        help="Your price is set by its total assets. Start typing, then pick it from the list."
        labelClassName="text-sm font-medium text-[#1A1815]"
        labelStyle={{}}
        inputClassName="w-full rounded-md border border-[#D5CBBF] bg-white px-3 py-2 text-sm text-[#1A1815] outline-none focus:border-[#C44B2E]"
        inputStyle={{}}
        onSelect={(result) => {
          if (result) go((params) => params.set("inst", String(result.id)));
        }}
      />
      <button
        type="button"
        onClick={() => go((params) => params.set("org", "other"))}
        className="mt-3 text-xs font-medium text-[#5A5347] underline underline-offset-2 hover:text-[#1A1815]"
      >
        I&apos;m a consultant or another organization
      </button>
    </div>
  );
}
