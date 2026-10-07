"use client";

/**
 * A small spinner inside a link while the page it opens is loading, so a tap on a slow
 * connection shows that something is happening. Renders nothing once the page arrives.
 */
import { useLinkStatus } from "next/link";
import { Loader2 } from "lucide-react";

export function LinkPending() {
  const { pending } = useLinkStatus();
  return pending ? <Loader2 aria-label="Loading" className="ml-1.5 inline h-3.5 w-3.5 animate-spin align-[-2px]" /> : null;
}
