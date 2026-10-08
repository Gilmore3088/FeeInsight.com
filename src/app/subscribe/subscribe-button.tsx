"use client";

import { createCheckoutSession } from "@/lib/stripe-actions";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { trackEvent } from "@/lib/analytics";
import type { ProPlan } from "@/lib/pro-tiers";

interface SubscribeButtonProps {
  plan: ProPlan;
  /** The bank or credit union whose assets set the tier. */
  institutionId?: number | null;
  /** A consultant or other organization: the non-institution tier. */
  otherOrganization?: boolean;
  label: string;
  className?: string;
  returnTo?: string;
  /** Start checkout as soon as the button mounts (post-signup hand-off). */
  autoStart?: boolean;
}

const DEFAULT_CLASS =
  "w-full rounded-md bg-[#C44B2E] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#A93D25] disabled:opacity-50 disabled:cursor-not-allowed transition-colors";

export function SubscribeButton({
  plan,
  institutionId = null,
  otherOrganization = false,
  label,
  className,
  returnTo,
  autoStart = false,
}: SubscribeButtonProps) {
  const router = useRouter();
  // When auto-starting, render as pending from the first paint.
  const [pending, setPending] = useState(autoStart);
  const [error, setError] = useState<string | null>(null);
  const autoStarted = useRef(false);

  const startCheckout = useCallback(async () => {
    // A signed-out visitor's click was already counted on the register link; the
    // post-signup auto-start continues that same checkout.
    if (!autoStart) trackEvent("checkout_start", { plan, signed_in: true });
    setPending(true);
    setError(null);
    try {
      const { url } = await createCheckoutSession({ plan, institutionId, otherOrganization, returnTo });
      if (url) {
        window.location.href = url;
      } else {
        setError("Could not create checkout. Please try again.");
        setPending(false);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong";
      if (msg.includes("Not authenticated")) {
        const back = new URLSearchParams({ plan });
        if (institutionId) back.set("inst", String(institutionId));
        else if (otherOrganization) back.set("org", "other");
        if (returnTo) back.set("from", returnTo);
        const registerFrom = `/subscribe?${back.toString()}`;
        router.push(`/register?from=${encodeURIComponent(registerFrom)}`);
      } else {
        setError(msg);
        setPending(false);
      }
    }
  }, [plan, institutionId, otherOrganization, returnTo, router, autoStart]);

  useEffect(() => {
    if (!autoStart || autoStarted.current) return;
    // Deferred so the hand-off to Stripe happens after mount, not inside the effect body.
    const timer = window.setTimeout(() => {
      autoStarted.current = true;
      void startCheckout();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [autoStart, startCheckout]);

  return (
    <div>
      <button onClick={startCheckout} disabled={pending} className={className || DEFAULT_CLASS}>
        {pending ? "Redirecting to checkout..." : label}
      </button>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
