"use client";

import { ErrorContent } from "@/components/public/error-content";

/** Inside the public layout, which provides the header, footer and main landmark. */
export default function PublicError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorContent reset={reset} />;
}
