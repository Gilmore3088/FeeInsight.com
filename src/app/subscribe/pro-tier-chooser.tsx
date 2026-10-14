"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { InstitutionPicker } from "@/components/hamilton/InstitutionPicker";
import { trackEvent } from "@/lib/analytics";

interface ProTierChooserProps {
  /** What the price below is for, once chosen: "First Bank, Huntsville, AL · Under $500M in assets". */
  chosenLabel: string | null;
  /** The size band under the name: "Under $500M in assets". */
  chosenDetail?: string | null;
  /** Shown instead of a price when the chosen institution has no asset size on file. */
  problem?: string | null;
  /** Size bands to pick from when the chosen institution has no asset size on file. */
  bandChoices?: { key: string; label: string }[] | null;
  /** The band already picked (?band=), highlighted among the choices. */
  pickedBand?: string | null;
  /** Where the buyer came from ("Regulatory Wire", or "direct"), sent with each funnel event. */
  entry: string;
}

/**
 * Picks who the plan covers. The choice lives in the URL (?inst= or ?org=other) so it
 * survives sign-up and the server can price it; checkout re-checks the tier itself.
 */
export function ProTierChooser({ chosenLabel, chosenDetail = null, problem = null, bandChoices = null, pickedBand = null, entry }: ProTierChooserProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function go(update: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("inst");
    params.delete("org");
    params.delete("checkout");
    params.delete("band");
    update(params);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}#pro-heading` : `${pathname}#pro-heading`, { scroll: false });
  }

  if (chosenLabel) {
    return (
      <div className="text-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[15px] font-semibold leading-snug text-[#1A1815]">{chosenLabel}</p>
            {chosenDetail && <p className="mt-0.5 text-sm text-[#6B6255]">{chosenDetail}</p>}
          </div>
          <button
            type="button"
            onClick={() => go(() => {})}
            className="inline-flex min-h-11 flex-shrink-0 items-start text-sm font-medium text-[#A93D25] underline underline-offset-2"
          >
            Change
          </button>
        </div>
        {problem && <p className="mt-2 text-[#A93D25]">{problem}</p>}
        {bandChoices && (
          <fieldset className="mt-3">
            <legend className="text-xs font-medium text-[#1A1815]">Its total assets</legend>
            <div className="mt-1 grid gap-2">
              {bandChoices.map((band) => (
                <button
                  key={band.key}
                  type="button"
                  aria-pressed={pickedBand === band.key}
                  onClick={() => {
                    const inst = searchParams.get("inst");
                    go((params) => {
                      if (inst) params.set("inst", inst);
                      params.set("band", band.key);
                    });
                  }}
                  className={
                    "min-h-11 rounded-md border px-3 text-left text-sm " +
                    (pickedBand === band.key
                      ? "border-[#C44B2E] ring-1 ring-[#C44B2E] text-[#1A1815]"
                      : "border-[#E8E1D6] text-[#3D3833] hover:border-[#1A1815]")
                  }
                >
                  {band.label}
                </button>
              ))}
            </div>
          </fieldset>
        )}
      </div>
    );
  }

  return (
    <div>
      <InstitutionPicker
        inputId="pro_tier_institution"
        name="pro_tier_institution_id"
        label="Find your institution"
        help="Its size sets the price."
        labelClassName="text-sm font-semibold text-[#1A1815]"
        labelStyle={{}}
        inputClassName="w-full rounded-lg border border-[#CFC5B7] bg-white px-3.5 py-3 text-base text-[#1A1815] outline-none focus:border-[#A93D25] focus:ring-2 focus:ring-[#A93D25]/20"
        inputStyle={{}}
        onSelect={(result) => {
          if (!result) return;
          trackEvent("pricing_tier_selected", { kind: "institution", entry });
          go((params) => params.set("inst", String(result.id)));
        }}
      />
      <button
        type="button"
        onClick={() => {
          trackEvent("pricing_tier_selected", { kind: "other_organization", entry });
          go((params) => params.set("org", "other"));
        }}
        className="mt-1 inline-flex min-h-11 items-center text-left text-sm text-[#3D3833] underline underline-offset-2 hover:text-[#1A1815]"
      >
        Consultant or another organization?
      </button>
    </div>
  );
}
