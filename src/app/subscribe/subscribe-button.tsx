"use client";

import { createCheckoutSession } from "@/lib/stripe-actions";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { trackEvent } from "@/lib/analytics";
import type { ProPlan, ProTier } from "@/lib/pro-tiers";

interface SubscribeButtonProps {
  plan: ProPlan;
  /** The bank or credit union whose assets set the tier. */
  institutionId?: number | null;
  /** A consultant or other organization: the non-institution tier. */
  otherOrganization?: boolean;
  /** The size band the buyer picked for an institution with no asset size on file. */
  pickedTier?: ProTier | null;
  label: string;
  className?: string;
  returnTo?: string;
  /** Start checkout as soon as the button mounts (post-signup hand-off). */
  autoStart?: boolean;
  /** For the checkout_start event: the price tier and where the buyer came from. */
  tier?: ProTier;
  entry?: string;
}

const DEFAULT_CLASS =
  "w-full rounded-md bg-[#C44B2E] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#A93D25] disabled:opacity-50 disabled:cursor-not-allowed transition-colors";

export function SubscribeButton({
  plan,
  institutionId = null,
  otherOrganization = false,
  pickedTier = null,
  label,
  className,
  returnTo,
  autoStart = false,
  tier,
  entry,
}: SubscribeButtonProps) {
  const router = useRouter();
  // When auto-starting, render as pending from the first paint.
  const [pending, setPending] = useState(autoStart);
  const [error, setError] = useState<string | null>(null);
  const autoStarted = useRef(false);

  const startCheckout = useCallback(async () => {
    // A signed-out visitor's click was already counted on the register link; the
    // post-signup auto-start continues that same checkout.
    if (!autoStart) trackEvent("checkout_start", { plan, signed_in: true, ...(tier ? { tier } : {}), ...(entry ? { entry } : {}) });
    setPending(true);
    setError(null);
    try {
      const result = await createCheckoutSession({ plan, institutionId, otherOrganization, pickedTier, returnTo });
      if (result.url) {
        window.location.href = result.url;
      } else if (result.needsSignIn) {
        // Same hand-off as the signed-out link: plan in both places so checkout
        // starts again by itself once the account exists.
        const back = new URLSearchParams({ plan });
        if (institutionId) back.set("inst", String(institutionId));
        else if (otherOrganization) back.set("org", "other");
        if (pickedTier) back.set("band", pickedTier);
        if (returnTo) back.set("from", returnTo);
        const registerFrom = `/subscribe?${back.toString()}`;
        router.push(`/register?plan=${plan}&from=${encodeURIComponent(registerFrom)}`);
      } else {
        setError(result.error ?? "Could not create checkout. Please try again.");
        setPending(false);
      }
    } catch {
      setError("Could not open checkout. Please try again in a moment.");
      setPending(false);
    }
  }, [plan, institutionId, otherOrganization, pickedTier, returnTo, router, autoStart, tier, entry]);

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
