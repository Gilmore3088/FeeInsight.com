"use client";

import type { MouseEvent, ReactNode } from "react";

/**
 * Asks the plan board to open its institution lookup (pro-plan-cards.tsx). The board opens it
 * synchronously, so the search box is shown before this button scrolls to it and focuses it.
 */
export const OPEN_LOOKUP_EVENT = "fi:open-pricing-lookup";

export function openPricingLookup() {
  window.dispatchEvent(new Event(OPEN_LOOKUP_EVENT));
}

/**
 * The pricing buttons outside the plan board (closing card, sticky phone bar). It opens the lookup and lands on the institution search box itself, centred above the
 * keyboard and focused, so the buyer can type straight away (James, 9 Oct 2026). Once an
 * institution is picked there is no search box, so it scrolls to the card instead. Without
 * JavaScript it is a plain anchor to the card.
 */
export function PricingJump({ id, inputId, targetId, className, children }: {
  id?: string;
  inputId: string;
  targetId: string;
  className: string;
  children: ReactNode;
}) {
  const jump = (event: MouseEvent<HTMLAnchorElement>) => {
    openPricingLookup();
    const input = document.getElementById(inputId);
    const target = input ?? document.getElementById(targetId);
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: "smooth", block: input ? "center" : "start" });
    if (input instanceof HTMLInputElement) input.focus({ preventScroll: true });
  };
  return (
    <a id={id} href={`#${targetId}`} onClick={jump} className={className}>
      {children}
    </a>
  );
}
