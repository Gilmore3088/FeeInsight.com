"use client";

import { createPortalSession } from "@/lib/stripe-actions";
import { CONTACT_EMAIL } from "@/lib/constants";
import { useState } from "react";

export function ManageBillingButton({
  label = "Manage billing",
  returnPath = "/account",
}: { label?: string; returnPath?: string } = {}) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleClick() {
    setPending(true);
    setFailed(false);
    try {
      await createPortalSession(returnPath);
    } catch {
      // Without a message the button just stopped spinning and the customer was stuck.
      setPending(false);
      setFailed(true);
    }
  }

  return (
    <div>
      <button
        onClick={handleClick}
        disabled={pending}
        className="inline-flex items-center rounded-md border border-[#D5CBBF] bg-[#FFFDF9] px-4 py-2 text-sm font-medium text-[#1A1815] hover:border-[#1A1815] disabled:opacity-50 transition-colors"
      >
        {pending ? "Loading..." : label}
      </button>
      {failed && (
        <p role="alert" className="mt-2 text-[13px] text-[#A93D25]">
          The billing page did not open. Try again, or email{" "}
          <a href={`mailto:${CONTACT_EMAIL}?subject=Billing`} className="underline">
            {CONTACT_EMAIL}
          </a>{" "}
          and we will sort it out.
        </p>
      )}
    </div>
  );
}
