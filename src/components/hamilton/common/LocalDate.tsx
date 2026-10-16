"use client";

import { useSyncExternalStore } from "react";

const noSubscribe = () => () => {};

/** One date in the reader's time zone. Unparseable input renders as empty text. */
export function formatLocalDate(iso: string, options: Intl.DateTimeFormatOptions, timeZone?: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-US", timeZone ? { ...options, timeZone } : options);
}

/**
 * A date shown in the reader's time zone without a hydration mismatch (#1541). The server and the
 * hydrating client both render the UTC date; the client then switches to its own time zone, so a
 * question asked on the evening of Oct 15 in California reads "Oct 15", not the server's "Oct 16".
 */
export function LocalDate({ iso, options, className, title }: { iso: string; options: Intl.DateTimeFormatOptions; className?: string; title?: string }) {
  const text = useSyncExternalStore(noSubscribe, () => formatLocalDate(iso, options), () => formatLocalDate(iso, options, "UTC"));
  return <time dateTime={iso} className={className} title={title}>{text}</time>;
}
