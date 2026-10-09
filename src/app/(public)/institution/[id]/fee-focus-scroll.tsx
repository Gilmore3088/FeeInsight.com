"use client";

import { useEffect } from "react";

/**
 * Scrolls the focused fee row into view once, on arrival from `?fee=`.
 *
 * The schedule renders twice (a table above 640px, a stacked list below), so the anchor
 * is a data attribute on both copies and we scroll whichever one is actually displayed.
 * This also covers readers who arrive with `?fee=` but no `#fee-` hash.
 *
 * Focus moves to that row too, so a keyboard or screen reader user who followed a link
 * such as "Compare all 4 in the fee table" continues from the rows they asked for
 * instead of from the link they left.
 */
export function FeeFocusScroll({ category }: { category: string }) {
  useEffect(() => {
    const anchors = Array.from(
      document.querySelectorAll<HTMLElement>(`[data-fee-anchor="${CSS.escape(category)}"]`),
    );
    const visible = anchors.find((el) => el.offsetParent !== null);
    if (!visible) return;
    visible.scrollIntoView({ block: "start", behavior: "auto" });
    if (!visible.hasAttribute("tabindex")) visible.setAttribute("tabindex", "-1");
    visible.focus({ preventScroll: true });
  }, [category]);
  return null;
}
