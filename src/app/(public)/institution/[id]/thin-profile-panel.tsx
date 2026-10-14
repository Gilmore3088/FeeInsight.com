import Link from "next/link";
import { ClipboardCheck, FileText } from "lucide-react";
import type { FeePublicationStatus } from "@/lib/institution-quality";
import { getPublicStatusLabel } from "./enum-labels";
import { MIN_VERIFIED_FEES_FOR_OFFER } from "./profile-copy";

/**
 * Replaces the report offer band on profiles with fewer than
 * MIN_VERIFIED_FEES_FOR_OFFER verified fees: status, a source-intake path,
 * and the source-intake path. The "tell me when verified" save lives in the
 * page's FeeAlertControl, in its "verify" mode.
 */
export function ThinProfilePanel({
  status,
  verifiedCount,
  correctSourceHref,
  claimHref,
}: {
  status: FeePublicationStatus;
  verifiedCount: number;
  correctSourceHref: string;
  claimHref: string;
}) {
  const statusLine =
    verifiedCount > 0
      ? `${verifiedCount} verified ${verifiedCount === 1 ? "fee" : "fees"} so far. Once ${MIN_VERIFIED_FEES_FOR_OFFER} are verified, this profile gets a national-median comparison and a competitive report on request.`
      : "No verified fees yet, so there is nothing to benchmark on this page.";

  return (
    <section className="border border-border bg-white px-4 py-4 sm:px-5">
      <div>
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-muted">
            Status: {getPublicStatusLabel(status)}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-ink-soft">{statusLine}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href={correctSourceHref}
              className="inline-flex items-center gap-2 rounded-md bg-brick px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-brick-ink"
            >
              <FileText className="h-4 w-4" />
              Send us the fee schedule
            </Link>
            <Link
              href={claimHref}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:border-brick hover:text-brick"
            >
              <ClipboardCheck className="h-4 w-4" />
              Work here? Claim or validate
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
