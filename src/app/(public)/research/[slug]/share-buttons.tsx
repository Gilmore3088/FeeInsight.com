"use client";

import { useState } from "react";

export function ShareButton() {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleCopy}
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50 transition-colors"
      >
        <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M6 3.5C6 3.5 7.5 1 10 1c2 0 3.5 1.5 3.5 3.5S12 8 10 8c-1.5 0-2.5-.5-3-1" />
          <path d="M10 12.5c0 0-1.5 2.5-4 2.5-2 0-3.5-1.5-3.5-3.5S4 8 6 8c1.5 0 2.5.5 3 1" />
        </svg>
        Share
      </button>
      {copied && (
        <div className="absolute left-0 top-full mt-2 rounded-md bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-white shadow-lg animate-fade-toast">
          Link copied
        </div>
      )}
    </div>
  );
}

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50 transition-colors"
    >
      <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <rect x="3" y="6" width="10" height="6" rx="1" />
        <path d="M4 6V2h8v4" />
        <path d="M4 12v2h8v-2" />
        <circle cx="11" cy="9" r="0.5" fill="currentColor" />
      </svg>
      Print PDF
    </button>
  );
}
