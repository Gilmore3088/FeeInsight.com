"use client";

import { createPortalSession } from "@/lib/stripe-actions";
import { useState } from "react";

export function ManageBillingButton({ label = "Manage billing" }: { label?: string } = {}) {
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    try {
      await createPortalSession();
    } catch {
      setPending(false);
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={pending}
      className="inline-flex items-center rounded-md border border-[#D5CBBF] bg-[#FFFDF9] px-4 py-2 text-sm font-medium text-[#1A1815] hover:border-[#1A1815] disabled:opacity-50 transition-colors"
    >
      {pending ? "Loading..." : label}
    </button>
  );
}
