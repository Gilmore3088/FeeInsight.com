"use client";

import { useEffect } from "react";
import { trackEvent, type AnalyticsEvent, type AnalyticsProps } from "@/lib/analytics";

/**
 * Records one analytics event when the page it sits on is viewed. Renders nothing.
 * With `onceKey`, the event fires once per browser for that key, so reloading a page
 * (such as the post-checkout welcome) doesn't count the same moment twice.
 */
export function TrackView({
  event,
  eventProps,
  onceKey,
}: {
  event: AnalyticsEvent;
  eventProps?: AnalyticsProps;
  onceKey?: string;
}) {
  const key = JSON.stringify(eventProps ?? {});
  useEffect(() => {
    if (onceKey) {
      const storageKey = `track-once:${onceKey}`;
      try {
        if (window.localStorage.getItem(storageKey)) return;
        window.localStorage.setItem(storageKey, "1");
      } catch {
        // Storage blocked: fall through and record the event.
      }
    }
    trackEvent(event, JSON.parse(key) as AnalyticsProps);
  }, [event, key, onceKey]);
  return null;
}
