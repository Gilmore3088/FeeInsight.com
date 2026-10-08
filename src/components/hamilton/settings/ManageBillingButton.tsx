"use client";

import { useState, useTransition } from "react";
import { createPortalSession } from "@/lib/stripe-actions";

interface ManageBillingButtonProps {
  hasStripeAccount: boolean;
  subscriptionStatus: "active" | "past_due" | "canceled" | "none";
  className?: string;
  style?: React.CSSProperties;
}

export function ManageBillingButton({
  hasStripeAccount,
  subscriptionStatus,
  className,
  style,
}: ManageBillingButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Users without a Stripe account see a subscribe CTA
  if (!hasStripeAccount || subscriptionStatus === "none") {
    return (
      <a
        href="/subscribe"
        className={className}
        style={{
          display: "inline-block",
          padding: "0.5rem 1rem",
          fontSize: "0.75rem",
          fontWeight: 600,
          borderRadius: "0.375rem",
          border: "1px solid var(--hamilton-border)",
          color: "var(--hamilton-text-secondary)",
          backgroundColor: "transparent",
          textDecoration: "none",
          opacity: 0.7,
          cursor: "default",
          ...style,
        }}
      >
        Subscribe to manage billing
      </a>
    );
  }

  function handleClick() {
    setError(null);
    startTransition(async () => {
      try {
        await createPortalSession("/pro/settings");
      } catch {
        setError("Unable to open billing portal. Please try again.");
      }
    });
  }

  const buttonConfig = getButtonConfig(subscriptionStatus);

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className={className}
        style={{
          ...buttonConfig.style,
          ...style,
          opacity: isPending ? 0.7 : 1,
          cursor: isPending ? "not-allowed" : "pointer",
          transition: "opacity 0.15s",
        }}
      >
        {isPending ? "Opening..." : buttonConfig.label}
      </button>
      {error && (
        <p
          style={{
            marginTop: "0.375rem",
            fontSize: "0.75rem",
            color: "var(--hamilton-error, #ba1a1a)",
          }}
        >
          {error}
        </p>
      )}
    </div>
  );
}

interface ButtonConfig {
  label: string;
  style: React.CSSProperties;
}

function getButtonConfig(status: "active" | "past_due" | "canceled"): ButtonConfig {
  switch (status) {
    case "active":
      return {
        label: "Manage Billing",
        style: {
          padding: "0.5rem 1rem",
          fontSize: "0.75rem",
          fontWeight: 600,
          borderRadius: "0.375rem",
          border: "1px solid var(--hamilton-border)",
          color: "var(--hamilton-text-primary)",
          backgroundColor: "white",
        },
      };

    case "past_due":
      return {
        label: "Update Payment",
        style: {
          padding: "0.5rem 1rem",
          fontSize: "0.75rem",
          fontWeight: 600,
          borderRadius: "0.375rem",
          border: "2px solid var(--hamilton-warning, #f59e0b)",
          color: "rgb(180, 83, 9)",
          backgroundColor: "rgb(255, 251, 235)",
          borderLeft: "4px solid var(--hamilton-warning, #f59e0b)",
        },
      };

    case "canceled":
      return {
        label: "Reactivate",
        style: {
          padding: "0.5rem 1rem",
          fontSize: "0.75rem",
          fontWeight: 600,
          borderRadius: "0.375rem",
          border: "none",
          color: "white",
          background: "linear-gradient(135deg, var(--hamilton-primary), var(--hamilton-primary-container))",
        },
      };
  }
}
