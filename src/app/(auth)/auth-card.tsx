import Link from "next/link";
import { SITE_NAME } from "@/lib/constants";

/** The single-column shell the password pages share: logo, heading, form. */
export function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-white px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 text-[#1A1815] no-underline">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px] text-[#C44B2E]" stroke="currentColor" strokeWidth="1.5">
              <rect x="4" y="13" width="4" height="8" rx="1" />
              <rect x="10" y="8" width="4" height="13" rx="1" />
              <rect x="16" y="3" width="4" height="18" rx="1" />
            </svg>
            <span className="text-[15px] font-medium tracking-tight" style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}>
              {SITE_NAME}
            </span>
          </Link>
        </div>
        <h1
          className="text-2xl font-bold tracking-tight text-[#1A1815] text-center mb-8"
          style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
        >
          {title}
        </h1>
        {children}
        <p className="mt-4 text-center text-sm text-[#6B6255]">
          <Link href="/login" className="text-[#1A1815] font-medium hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

export const AUTH_INPUT_CLASS =
  "w-full rounded-md border border-[#D5CBBF] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C44B2E] focus:border-transparent";
export const AUTH_BUTTON_CLASS =
  "w-full rounded-md bg-[#C44B2E] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#A83D25] disabled:opacity-50 disabled:cursor-not-allowed transition-colors";
export const AUTH_FORM_CLASS = "bg-[#FFFDF9] rounded-lg border border-[#E8DFD1] shadow-sm p-6 space-y-4";
