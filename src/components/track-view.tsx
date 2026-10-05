"use client";

import { useEffect } from "react";
import { trackEvent, type AnalyticsEvent, type AnalyticsProps } from "@/lib/analytics";

/** Records one analytics event when the page it sits on is viewed. Renders nothing. */
export function TrackView({ event, eventProps }: { event: AnalyticsEvent; eventProps?: AnalyticsProps }) {
  const key = JSON.stringify(eventProps ?? {});
  useEffect(() => {
    trackEvent(event, JSON.parse(key) as AnalyticsProps);
  }, [event, key]);
  return null;
}
