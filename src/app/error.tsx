"use client";

import { ErrorContent } from "@/components/public/error-content";

export default function RootError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main id="main-content" className="min-h-screen bg-[#FAF7F2]">
      <ErrorContent reset={reset} />
    </main>
  );
}
