"use client";

import { useEffect } from "react";
import {
  MARKETING_TOUCH_ENDPOINT,
  readFirstTouch,
  saveFirstTouch,
  touchFromLocation,
} from "@/lib/marketing-touch";

/**
 * Records a visit from a tracked link (utm_ tags) once per browser session. Does nothing on
 * a URL without utm_ values or when this session already has a first touch. The touch is kept
 * in sessionStorage (no cookie, no visitor id) so the report and contact forms can send it
 * with the lead. Renders nothing.
 */
export function MarketingTouchRecorder() {
  useEffect(() => {
    try {
      if (!window.location.search.includes("utm_")) return;
      if (readFirstTouch()) return;
      const touch = touchFromLocation(window.location.href, document.referrer);
      if (!touch) return;
      saveFirstTouch(touch);
      void fetch(MARKETING_TOUCH_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(touch),
        keepalive: true,
      }).catch(() => {});
    } catch {
      // Tracking must never break the page.
    }
  }, []);

  return null;
}
