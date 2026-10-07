"use client";

export function PrintButton({ label = "Print or save as PDF" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-md bg-terra px-3.5 py-2 text-sm font-medium text-white hover:bg-terra-dark print:hidden"
    >
      {label}
    </button>
  );
}
