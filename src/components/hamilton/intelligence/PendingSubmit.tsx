"use client";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

export function PendingSubmit({ children, pendingLabel, className }: { children: ReactNode; pendingLabel: string; className?: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} aria-busy={pending} className={`${className ?? ""} disabled:opacity-60`}>{pending ? pendingLabel : children}</button>;
}
