"use client";

import { useEffect } from "react";

/**
 * Scrolls the focused fee row into view once, on arrival from `?fee=`.
 *
 * The schedule renders twice (a table above 640px, a stacked list below), so the anchor
 * is a data attribute on both copies and we scroll whichever one is actually displayed.
 * This also covers readers who arrive with `?fee=` but no `#fee-` hash.
 */
export function FeeFocusScroll({ category }: { category: string }) {
  useEffect(() => {
    const anchors = Array.from(
      document.querySelectorAll<HTMLElement>(`[data-fee-anchor="${CSS.escape(category)}"]`),
    );
    const visible = anchors.find((el) => el.offsetParent !== null);
    visible?.scrollIntoView({ block: "start", behavior: "auto" });
  }, [category]);
  return null;
}
