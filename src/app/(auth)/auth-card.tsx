import Link from "next/link";
import { Logo } from "@/brand/components";

/** The single-column shell the password pages share: logo, heading, form. */
export function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-white px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 text-ink no-underline">
            <Logo mark="fee-insight-oneline" height={22} />
          </Link>
        </div>
        <h1
          className="text-2xl font-extrabold tracking-tight text-ink text-center mb-8"
          style={{ fontFamily: "var(--fi-font-sans)" }}
        >
          {title}
        </h1>
        {children}
        <p className="mt-4 text-center text-sm text-ink-muted">
          <Link href="/login" className="text-ink font-medium hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

export const AUTH_INPUT_CLASS =
  "w-full rounded-md border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brick focus:border-transparent";
export const AUTH_BUTTON_CLASS =
  "w-full rounded-md bg-brick px-4 py-2.5 text-sm font-medium text-white hover:bg-brick-ink disabled:opacity-50 disabled:cursor-not-allowed transition-colors";
export const AUTH_FORM_CLASS = "bg-surface-0 rounded-lg border border-border shadow-sm p-6 space-y-4";
