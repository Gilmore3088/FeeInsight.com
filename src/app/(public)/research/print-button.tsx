"use client";

/** Opens the browser's print dialog; the page's print styles turn it into a clean PDF. */
export function PrintButton({ className = "" }: { className?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={className}>
      Download as PDF
    </button>
  );
}
