"use client";

import { useEffect } from "react";
import { SNAPSHOT_EVENT_ENDPOINT, SNAPSHOT_EVENTS, type SnapshotEvent } from "@/lib/outreach-journey";

/**
 * First-party journey events for the free market snapshot (no cookie, no visitor id): one
 * "opened" per browser session, then each click on an element marked `data-snapshot-event`
 * (a source schedule, another fee, a competitor, the report request). Renders nothing.
 */
export function SnapshotTracker({ institutionId }: { institutionId: number }) {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const send = (event: SnapshotEvent, detail: string | null) => {
      try {
        void fetch(SNAPSHOT_EVENT_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            institutionId,
            event,
            detail,
            utm_campaign: params.get("utm_campaign"),
            utm_content: params.get("utm_content"),
          }),
          keepalive: true,
        }).catch(() => {});
      } catch {
        // Tracking must never break the page.
      }
    };

    try {
      const key = `fi_snapshot_opened_${institutionId}`;
      if (!window.sessionStorage.getItem(key)) {
        window.sessionStorage.setItem(key, "1");
        send("opened", null);
      }
    } catch {
      send("opened", null);
    }

    const onClick = (click: MouseEvent) => {
      const target = (click.target as Element | null)?.closest?.("[data-snapshot-event]");
      const event = target?.getAttribute("data-snapshot-event");
      if (!event || !(SNAPSHOT_EVENTS as readonly string[]).includes(event)) return;
      send(event as SnapshotEvent, target?.getAttribute("data-snapshot-detail") ?? null);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [institutionId]);

  return null;
}
