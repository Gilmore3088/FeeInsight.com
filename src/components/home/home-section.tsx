import Link from "next/link";
import type { ReactNode } from "react";

const TONES = {
  paper: "bg-paper",
  surface: "bg-surface-0",
} as const;

/** One homepage section: page width, the brand's section spacing and a surface tone. */
export function Section({
  children,
  tone = "paper",
  id,
  dark = false,
}: {
  children: ReactNode;
  tone?: keyof typeof TONES;
  id?: string;
  /** A navy band: the brand's dark theme, so every token inside flips with it. */
  dark?: boolean;
}) {
  return (
    <section
      id={id}
      data-theme={dark ? "dark" : undefined}
      className={`border-b border-border ${dark ? "bg-paper text-ink" : TONES[tone]}`}
    >
      <div className="mx-auto max-w-page px-4 py-16 sm:px-6 sm:py-24">{children}</div>
    </section>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-muted">{children}</p>;
}

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="mt-6 inline-flex items-center gap-1.5 text-[15px] font-semibold text-ink underline decoration-control-border decoration-1 underline-offset-4 hover:decoration-ink"
    >
      {children}
      <span aria-hidden="true">→</span>
    </Link>
  );
}
