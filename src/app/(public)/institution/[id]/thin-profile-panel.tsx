import Link from "next/link";
import { ClipboardCheck, FileText } from "lucide-react";
import type { FeePublicationStatus } from "@/lib/institution-quality";
import { getPublicStatusLabel } from "./enum-labels";
import { MIN_VERIFIED_FEES_FOR_OFFER } from "./profile-copy";
import { GLASS_SOFT } from "@/components/public/site-look";

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
    <section className={`px-5 py-5 sm:px-6 ${GLASS_SOFT}`}>
      <div>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#A93D25]">
            Status: {getPublicStatusLabel(status)}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-[#5A5347]">{statusLine}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href={correctSourceHref}
              className="inline-flex items-center gap-2 min-h-11 rounded-lg bg-[#C44B2E] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors duration-200 hover:bg-[#A93D25]"
            >
              <FileText className="h-4 w-4" />
              Send us the fee schedule
            </Link>
            <Link
              href={claimHref}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-white/70 px-4 py-2 text-sm font-semibold text-[#1A1815] ring-1 ring-[#E8E1D6] transition-colors duration-200 hover:bg-white hover:text-[#A93D25] hover:ring-[#C44B2E]/40"
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
