"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { trackEvent } from "@/lib/analytics";
import { resetSessionChrome } from "@/components/use-session-chrome";
import {
  registerConsumerAndSaveAlert,
  removeInstitutionAlert,
  saveInstitutionAlert,
} from "@/app/account/alert-actions";

export interface FeeAlertControlProps {
  institutionId: number;
  institutionName: string;
  /** The fee the reader arrived to compare (`?fee=`), if any. */
  focusCategory: string | null;
  /** Display labels for the focus category and any category already followed. */
  categoryLabels: Record<string, string>;
  /** "verify": the profile has too few verified fees to compare yet. */
  mode?: "alerts" | "verify";
  initial: { signedIn: boolean; saved: boolean; feeCategories: string[] | null };
  secondaryLink?: { href: string; label: string };
}

const INPUT =
  "min-w-0 w-full rounded-md border border-[#D4C9BA] bg-white px-3 py-2 text-[14px] text-[#1A1815] placeholder:text-[#6B6255] focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#C44B2E]/30";
const PRIMARY =
  "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-md bg-[#C44B2E] px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[#A93D25] disabled:opacity-50";
const SECONDARY =
  "inline-flex items-center rounded-md border border-[#D5CBBF] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#1A1815] transition-colors hover:border-[#C44B2E] hover:text-[#A93D25] disabled:opacity-50";

/**
 * Save this bank or credit union and get an email when a fee you follow changes.
 *
 * Signed in: one click. Signed out: email and password create a free account and save the
 * institution in the same step, without leaving the page. Saved: shows what is followed,
 * with "also follow this fee", "all fees", manage and remove.
 */
export function FeeAlertControl({
  institutionId,
  institutionName,
  focusCategory,
  categoryLabels,
  mode = "alerts",
  initial,
  secondaryLink,
}: FeeAlertControlProps) {
  const router = useRouter();
  const ids = useId();
  const [pending, startTransition] = useTransition();
  const [signedIn, setSignedIn] = useState(initial.signedIn);
  const [saved, setSaved] = useState(initial.saved);
  const [categories, setCategories] = useState<string[] | null>(initial.feeCategories);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loginHref, setLoginHref] = useState<string | null>(null);

  const label = (category: string) => categoryLabels[category] ?? category;
  const focusLabel = focusCategory ? label(focusCategory) : null;
  const followsFocus = !focusCategory || categories === null || categories.includes(focusCategory);
  const backHref = `/institution/${institutionId}${focusCategory ? `?fee=${focusCategory}` : ""}`;

  const headline =
    mode === "verify"
      ? `Get an email when ${institutionName}'s fees are verified`
      : `Get an email when ${institutionName} changes ${focusLabel ? `its ${focusLabel.toLowerCase()}` : "a fee"}`;
  const body =
    mode === "verify"
      ? "We'll write once its fee schedule is verified, and again whenever a verified fee changes. Nothing else."
      : "One email when a verified fee you follow changes. Nothing else unless you ask for it.";

  function done(next: string[] | null) {
    setSaved(true);
    setCategories(next);
    setError(null);
    setLoginHref(null);
    router.refresh();
  }

  function save(allFees = false) {
    startTransition(async () => {
      const result = await saveInstitutionAlert({ institutionId, feeCategory: focusCategory, allFees });
      if (result.ok) {
        trackEvent("fee_alert_save", { all_fees: allFees, has_focus: Boolean(focusCategory) });
        done(result.feeCategories);
      } else {
        setError(result.error);
      }
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await removeInstitutionAlert(institutionId);
      if (result.ok) {
        trackEvent("fee_alert_remove");
        setSaved(false);
        setCategories(null);
        router.refresh();
      } else {
        setError(result.error ?? "Could not remove this alert.");
      }
    });
  }

  function signUpAndSave(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoginHref(null);
    startTransition(async () => {
      const result = await registerConsumerAndSaveAlert({
        email,
        password,
        institutionId,
        feeCategory: focusCategory,
        website: honeypot || undefined,
      });
      if (result.ok) {
        trackEvent("fee_alert_signup", { has_focus: Boolean(focusCategory) });
        resetSessionChrome();
        setSignedIn(true);
        setPassword("");
        done(result.feeCategories);
      } else {
        setError(result.error);
        setLoginHref(result.loginHref ?? null);
      }
    });
  }

  return (
    <section
      aria-labelledby={`${ids}-heading`}
      className="relative border border-[#E0D7C9] bg-white px-4 py-4 sm:px-5"
    >
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#6B6255]">
        {saved ? "Saved" : "Fee change alerts"}
      </p>

      {saved ? (
        <>
          <h2 id={`${ids}-heading`} className="mt-1 text-base font-semibold text-[#1A1815]">
            You&rsquo;ll get an email when {institutionName} changes{" "}
            {categories === null ? "any fee" : categories.length === 1 ? `its ${label(categories[0]).toLowerCase()}` : "a fee you follow"}.
          </h2>
          {categories !== null && categories.length > 1 && (
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Fees you follow">
              {categories.map((category) => (
                <li key={category} className="rounded-full border border-[#E0D7C9] bg-[#FAF7F2] px-2.5 py-0.5 text-[12px] text-[#5A5347]">
                  {label(category)}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {!followsFocus && focusLabel && (
              <button type="button" className={SECONDARY} disabled={pending} onClick={() => save(false)}>
                Also follow {focusLabel.toLowerCase()}
              </button>
            )}
            {categories !== null && (
              <button type="button" className={SECONDARY} disabled={pending} onClick={() => save(true)}>
                Follow every fee
              </button>
            )}
            <Link href="/account#alerts" className="text-[13px] font-medium text-[#A93D25] hover:underline">
              Manage alerts
            </Link>
            <button
              type="button"
              disabled={pending}
              onClick={remove}
              className="text-[13px] font-medium text-[#6B6255] hover:text-[#1A1815] hover:underline disabled:opacity-50"
            >
              Remove
            </button>
          </div>
        </>
      ) : (
        <>
          <h2 id={`${ids}-heading`} className="mt-1 text-base font-semibold text-[#1A1815]">
            {headline}
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-[#5A5347]">{body}</p>

          {signedIn ? (
            <button type="button" className={`${PRIMARY} mt-3`} disabled={pending} onClick={() => save(false)}>
              {pending ? "Saving…" : `Save ${institutionName}`}
            </button>
          ) : (
            <form onSubmit={signUpAndSave} className="mt-3 space-y-2">
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                <div>
                  <label htmlFor={`${ids}-email`} className="sr-only">
                    Email
                  </label>
                  <input
                    id={`${ids}-email`}
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="Email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={INPUT}
                  />
                </div>
                <div>
                  <label htmlFor={`${ids}-password`} className="sr-only">
                    Password (at least 8 characters)
                  </label>
                  <input
                    id={`${ids}-password`}
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    placeholder="Choose a password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={INPUT}
                  />
                </div>
                <button type="submit" className={PRIMARY} disabled={pending}>
                  {pending ? "Saving…" : "Create free account and save"}
                </button>
              </div>
              {/* Honeypot: hidden from people and assistive tech; bots fill it. */}
              <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
                <label>
                  Website
                  <input
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    value={honeypot}
                    onChange={(e) => setHoneypot(e.target.value)}
                  />
                </label>
              </div>
              <p className="text-[12px] text-[#6B6255]">
                Already have an account?{" "}
                <Link href={`/login?from=${encodeURIComponent(backHref)}`} className="font-medium text-[#1A1815] hover:underline">
                  Sign in
                </Link>
              </p>
            </form>
          )}
        </>
      )}

      {error && (
        <p role="alert" className="mt-2 text-[13px] text-red-700">
          {error}
          {loginHref && (
            <>
              {" "}
              <Link href={loginHref} className="font-medium underline">
                Sign in instead
              </Link>
            </>
          )}
        </p>
      )}

      {secondaryLink && (
        <p className="mt-3 border-t border-[#F0EBE3] pt-3 text-[12px] text-[#6B6255]">
          Work at {institutionName}?{" "}
          <Link href={secondaryLink.href} className="font-medium text-[#A93D25] hover:underline">
            {secondaryLink.label}
          </Link>
        </p>
      )}
    </section>
  );
}
