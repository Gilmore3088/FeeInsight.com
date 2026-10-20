"use client";

import { createPortalSession } from "@/lib/stripe-actions";
import { CONTACT_EMAIL } from "@/lib/constants";
import { useState } from "react";
import { utilityButton, type UtilityButtonVariant } from "@/components/utility/form-style";

export function ManageBillingButton({
  label = "Manage billing",
  returnPath = "/account",
  variant = "secondary",
}: { label?: string; returnPath?: string; variant?: UtilityButtonVariant } = {}) {
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
        className={utilityButton(variant)}
      >
        {pending ? "Loading..." : label}
      </button>
      {failed && (
        <p role="alert" className="mt-2 text-[13px] text-brick">
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
