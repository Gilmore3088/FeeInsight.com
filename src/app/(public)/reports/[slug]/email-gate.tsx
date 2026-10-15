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

import { useState } from "react";

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

  if (!artifactExists) {
    return (
      <p style={{ color: "#55606f", fontSize: "14px", fontStyle: "italic" }}>
        PDF generation is in progress — check back soon.
      </p>
    );
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
        <p style={{ color: "#132338", fontSize: "14px", marginBottom: "12px" }}>
          Your download is ready.
        </p>
        <a
          href={downloadUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-block",
            background: "#132338",
            color: "#FEFCF9",
            padding: "10px 20px",
            borderRadius: "6px",
            fontSize: "14px",
            fontWeight: 500,
            textDecoration: "none",
          }}
        >
          Download full report PDF &darr;
        </a>
        <p style={{ marginTop: "8px", fontSize: "12px", color: "#55606f" }}>
          Link valid for 1 hour. Check your email for a copy.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "400px" }}>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="your@email.com"
        required
        disabled={state === "submitting"}
        style={{
          border: "1px solid #ddd5c6",
          borderRadius: "6px",
          padding: "10px 14px",
          fontSize: "14px",
          color: "#132338",
          width: "100%",
          boxSizing: "border-box",
          outline: "none",
        }}
        onFocus={(e) => (e.target.style.borderColor = "#b23a32")}
        onBlur={(e) => (e.target.style.borderColor = "#ddd5c6")}
      />

      <button
        type="submit"
        disabled={state === "submitting"}
        style={{
          background: state === "submitting" ? "#354252" : "#132338",
          color: "#FEFCF9",
          border: "none",
          borderRadius: "6px",
          padding: "10px 20px",
          fontSize: "14px",
          fontWeight: 500,
          cursor: state === "submitting" ? "not-allowed" : "pointer",
          transition: "background 0.2s",
          alignSelf: "flex-start",
        }}
      >
        {state === "submitting" ? "Sending..." : "Get full report"}
      </button>

      {state === "error" && errorMessage && (
        <p style={{ color: "#DC2626", fontSize: "13px", margin: 0 }}>
          {errorMessage}
        </p>
      )}

      <p style={{ fontSize: "11px", color: "#55606f", margin: 0 }}>
        No spam. One-time link delivered instantly.
      </p>
    </form>
  );
}
