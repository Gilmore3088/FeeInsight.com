"use client";

import { useEffect } from "react";
import { CHECK_FOCUS_KEY } from "../institutions/search-bar";

/**
 * After a pick in the search box, move focus to the answer's heading and bring it into view, so a
 * keyboard or screen-reader user lands on the answer rather than back at the top of the page.
 * A direct visit to /check?id= leaves focus alone.
 */
export function CheckAnswerFocus({ targetId }: { targetId: string }) {
  useEffect(() => {
    let picked = false;
    try {
      picked = window.sessionStorage.getItem(CHECK_FOCUS_KEY) === "1";
      window.sessionStorage.removeItem(CHECK_FOCUS_KEY);
    } catch {
      return;
    }
    if (!picked) return;
    const target = document.getElementById(targetId);
    if (!target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [targetId]);
  return null;
}
