"use client";

/**
 * EmailGate — client component for email-gated PDF download.
 * Collects visitor email, POSTs to /api/reports/email-gate, and returns
 * a presigned download URL without exposing artifact_key to the client.
 *
 * Props:
 *   slug          — report slug (for the API call)
 *   artifactExists — false if PDF not yet generated; shows pending message
 */

import { useEffect, useRef, useState } from "react";

type GateState = "idle" | "submitting" | "success" | "error";

interface EmailGateProps {
  slug: string;
  artifactExists: boolean;
}

const EMAIL_REGEX = /.+@.+\..+/;

export function EmailGate({ slug, artifactExists }: EmailGateProps) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<GateState>("idle");
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const downloadRef = useRef<HTMLAnchorElement>(null);

  // The form unmounts on success; move focus to the link so keyboard and screen reader users land on it.
  useEffect(() => {
    if (state === "success") downloadRef.current?.focus();
  }, [state]);

  if (!artifactExists) {
    return <p className="text-[14px] text-ink-muted">The PDF is being built. Check back soon.</p>;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    // Client-side email format validation
    if (!EMAIL_REGEX.test(email)) {
      setErrorMessage("Please enter a valid email address.");
      setState("error");
      return;
    }

    setState("submitting");
    setErrorMessage("");

    try {
      const res = await fetch("/api/reports/email-gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, slug }),
      });

      if (res.status === 202) {
        // PDF still pending
        setState("error");
        setErrorMessage("The report PDF is not yet available. Please check back soon.");
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setState("error");
        setErrorMessage(
          (body as { error?: string }).error ?? "Something went wrong. Please try again."
        );
        return;
      }

      const body = await res.json() as { downloadUrl: string };
      setDownloadUrl(body.downloadUrl);
      setState("success");
    } catch {
      setState("error");
      setErrorMessage("A network error occurred. Please try again.");
    }
  }

  if (state === "success" && downloadUrl) {
    return (
      <div>
        <p className="text-[14px] text-ink">Your download is ready.</p>
        <a
          ref={downloadRef}
          href={downloadUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex min-h-11 items-center rounded-full bg-ink px-5 text-[14px] font-semibold text-on-ink hover:opacity-90"
        >
          Download the PDF
        </a>
        <p className="mt-2 text-[12px] text-ink-muted">The link works for one hour.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label htmlFor="report-gate-email" className="text-[13px] font-medium text-ink">
        Work email
      </label>
      <input
        id="report-gate-email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@yourbank.com"
        autoComplete="email"
        required
        disabled={state === "submitting"}
        aria-invalid={state === "error" || undefined}
        aria-describedby={state === "error" && errorMessage ? "report-gate-error" : undefined}
        className="w-full rounded-lg border border-control-border bg-white px-3 py-2.5 text-[15px] text-ink placeholder:text-ink-muted focus:outline-2 focus:outline-offset-1 focus:outline-ink"
      />
      <button
        type="submit"
        disabled={state === "submitting"}
        className="inline-flex min-h-11 items-center justify-center rounded-full bg-ink px-5 text-[14px] font-semibold text-on-ink hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {state === "submitting" ? "Getting your link..." : "Get the download link"}
      </button>
      {state === "error" && errorMessage && (
        <p id="report-gate-error" role="alert" className="text-[13px] text-brick">
          {errorMessage}
        </p>
      )}
      <p className="text-[12px] text-ink-muted">Your download link opens right here.</p>
    </form>
  );
}
