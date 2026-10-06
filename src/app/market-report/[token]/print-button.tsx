"use client";

/** Opens the browser's print dialog, which saves the report as a PDF. */
export function PrintButton({ className = "" }: { className?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={className}>
      Save as PDF
    </button>
  );
}
