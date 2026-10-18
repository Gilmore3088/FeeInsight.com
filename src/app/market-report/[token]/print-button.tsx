"use client";

import { Printer } from "lucide-react";

/** Opens the browser's print dialog, which saves the report as a PDF. */
export function PrintButton({ className = "", icon = false }: { className?: string; icon?: boolean }) {
  return (
    <button type="button" onClick={() => window.print()} className={className}>
      {icon && <Printer aria-hidden="true" className="size-4" />}
      Save as PDF
    </button>
  );
}
