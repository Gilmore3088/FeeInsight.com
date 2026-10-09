"use client";

import { useEffect, useState } from "react";
import { PricingJump } from "./pricing-jump";

/**
 * The phone's sticky pricing button (the skill's "Hero (sticky) + Bottom" CTA pattern). It
 * shows only once the hero button has scrolled away and hides whenever the purchase card is
 * on screen, so it never covers the card it points to. Desktop has the sticky card instead.
 */
export function StickyCta({ heroId, cardId, label, className }: { heroId: string; cardId: string; label: string; className: string }) {
  const [heroGone, setHeroGone] = useState(false);
  const [cardShown, setCardShown] = useState(false);

  useEffect(() => {
    const hero = document.getElementById(heroId);
    const card = document.getElementById(cardId);
    if (!hero || !card || typeof IntersectionObserver === "undefined") return;
    const watch = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === hero) setHeroGone(!entry.isIntersecting && entry.boundingClientRect.top < 0);
        if (entry.target === card) setCardShown(entry.isIntersecting);
      }
    });
    watch.observe(hero);
    watch.observe(card);
    return () => watch.disconnect();
  }, [heroId, cardId]);

  const shown = heroGone && !cardShown;
  return (
    <div
      aria-hidden={!shown}
      inert={!shown}
      className={`fixed inset-x-0 bottom-0 z-40 border-t border-white/60 bg-white/75 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-8px_24px_-12px_rgba(26,24,21,0.25)] backdrop-blur-xl transition-transform duration-300 motion-reduce:transition-none lg:hidden ${
        shown ? "translate-y-0" : "translate-y-full"
      }`}
    >
      <PricingJump inputId="pro_tier_institution" targetId={cardId} className={className}>
        {label}
      </PricingJump>
    </div>
  );
}
