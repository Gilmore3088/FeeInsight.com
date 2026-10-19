"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { InstitutionPicker } from "@/components/hamilton/InstitutionPicker";
import { trackEvent } from "@/lib/analytics";
import { CHOOSER_INPUT_ID } from "./plan-ids";

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
  /** The chosen institution, from ?inst= or the buyer's saved choice, kept when a band is picked. */
  institutionId?: number | null;
  /** Where the buyer came from ("Regulatory Wire", or "direct"), sent with each funnel event. */
  entry: string;
}

/**
 * Picks who the plan covers. The choice lives in the URL (?inst= or ?org=other) so it
 * survives sign-up and the server can price it; checkout re-checks the tier itself.
 */
export function ProTierChooser({ chosenLabel, chosenDetail = null, problem = null, bandChoices = null, pickedBand = null, institutionId = null, entry }: ProTierChooserProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function go(update: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("inst");
    params.delete("org");
    params.delete("checkout");
    params.delete("band");
    params.delete("change");
    update(params);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}#pro-heading` : `${pathname}#pro-heading`, { scroll: false });
  }

  if (chosenLabel) {
    return (
      <div className="text-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[15px] font-semibold leading-snug text-ink">{chosenLabel}</p>
            {chosenDetail && <p className="mt-0.5 text-sm text-ink-muted">{chosenDetail}</p>}
          </div>
          <button
            type="button"
            onClick={() => go((params) => params.set("change", "1"))}
            className="inline-flex min-h-11 flex-shrink-0 items-start text-sm font-medium text-ink underline underline-offset-2"
          >
            Change
          </button>
        </div>
        {problem && <p className="mt-2 text-brick">{problem}</p>}
        {bandChoices && (
          <fieldset className="mt-3">
            <legend className="text-xs font-medium text-ink">Its total assets</legend>
            <div className="mt-1 grid gap-2">
              {bandChoices.map((band) => (
                <button
                  key={band.key}
                  type="button"
                  aria-pressed={pickedBand === band.key}
                  onClick={() => {
                    const inst = institutionId ?? searchParams.get("inst");
                    go((params) => {
                      if (inst) params.set("inst", String(inst));
                      params.set("band", band.key);
                    });
                  }}
                  className={
                    "min-h-11 rounded-md border px-3 text-left text-sm " +
                    (pickedBand === band.key
                      ? "border-brick ring-1 ring-brick text-ink"
                      : "border-border text-ink hover:border-ink")
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
        inputId={CHOOSER_INPUT_ID}
        name="pro_tier_institution_id"
        label="Your bank or credit union"
        help="Its total assets set the price."
        labelClassName="text-sm font-semibold text-ink"
        labelStyle={{}}
        inputClassName="w-full rounded-lg border-2 border-ink bg-white px-3.5 py-3 text-base text-ink outline-none focus:border-brick focus:ring-2 focus:ring-brick/20"
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
        className="mt-1 inline-flex min-h-11 items-center text-left text-sm text-ink underline underline-offset-2 hover:text-ink"
      >
        Consultant or another organization?
      </button>
    </div>
  );
}
