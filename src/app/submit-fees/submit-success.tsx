import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { REPORT_REQUEST_HREF } from "@/lib/report-request-href";

const REPORT_HREF = REPORT_REQUEST_HREF;

export function SubmitSuccessCard({
  claimFlow,
  profileHref,
  contactEmailProvided,
  onSubmitAnother,
}: {
  claimFlow: boolean;
  profileHref: string | null;
  contactEmailProvided: boolean;
  onSubmitAnother: () => void;
}) {
  return (
    <section className="min-w-0 border border-border bg-white p-6" aria-live="polite">
      <div className="flex gap-3">
        <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-700" />
        <div className="min-w-0">
          <h2
            className="font-bold text-2xl text-ink"
            style={{ fontFamily: "var(--fi-font-sans)" }}
          >
            Thanks — your source is in review.
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-soft">
            {contactEmailProvided
              ? "Once reviewed, verified fees appear on the profile and in benchmarks. We'll use your email only if we have a question about the source."
              : "Once reviewed, verified fees appear on the profile and in benchmarks."}
          </p>
          {claimFlow && (
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-soft">
              Institution employees can also request their{" "}
              <Link href={REPORT_HREF} className="font-semibold text-brick hover:text-brick">
                Competitive Fee Position report
              </Link>
              .
            </p>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {profileHref && (
              <Link
                href={profileHref}
                className="inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#2C2822]"
              >
                Back to the profile
                <ArrowRight className="h-4 w-4" />
              </Link>
            )}
            <button
              type="button"
              onClick={onSubmitAnother}
              className="text-sm font-semibold text-ink-muted underline-offset-2 hover:text-brick hover:underline"
            >
              Submit another source
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
