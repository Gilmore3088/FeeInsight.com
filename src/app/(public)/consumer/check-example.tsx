import Link from "next/link";
import type { Guide } from "@/lib/guides/types";
import { getStateFeeIndexesCached } from "@/lib/data-store/public-cached-reads";
import { formatAbsoluteDate, getPublicNationalIndex } from "@/lib/public-stats";
import { STATE_NAMES } from "@/lib/us-states";
import { SourceNote } from "../research/district/[id]/district-hub";
import { getPublicInstitutionForPage, getVisibleFeesForPage, isVerifiedFee } from "../institution/[id]/profile-data";
import { titleCase } from "../fees/city/[state]/[city]/city-lookup";
import { avoidGuideHref, buildCheckRows, checkFinding, stateGroupLabel } from "../check/check-data";
import { CheckTable } from "../check/check-table";

/** Rows the consumer page shows; the full check shows every headline fee. */
const EXAMPLE_ROWS = 3;

/**
 * A real fee-check result for one named institution, read the way /check reads it, cut to its
 * first rows. Renders nothing when the institution or its comparisons are not available.
 */
export async function CheckExample({ id, guides }: { id: number; guides: Guide[] }) {
  const inst = await getPublicInstitutionForPage(id).catch(() => null);
  if (!inst || Number(inst.fee_count ?? 0) === 0) return null;
  const verifiedFees = (await getVisibleFeesForPage(id)).filter(isVerifiedFee);
  if (verifiedFees.length === 0) return null;
  const stateCode = inst.state_code && STATE_NAMES[inst.state_code] ? inst.state_code : null;
  const stateName = stateCode ? STATE_NAMES[stateCode] : null;
  const [nationalIndex, stateIndexes] = await Promise.all([
    getPublicNationalIndex().catch(() => []),
    stateCode ? getStateFeeIndexesCached(stateCode).catch(() => null) : Promise.resolve(null),
  ]);
  const rows = buildCheckRows({
    verifiedFees,
    nationalIndex,
    stateIndex: stateIndexes?.all ?? [],
    fallbackSourceUrl: inst.fee_schedule_url ?? null,
  }).slice(0, EXAMPLE_ROWS);
  if (rows.length === 0) return null;
  const stateLabel = stateGroupLabel(rows, stateName);
  const finding = checkFinding(rows, inst.institution_name, stateName);
  const guideHrefs = Object.fromEntries(rows.map((row) => [row.category, avoidGuideHref(row.category, guides)]));
  const place = [inst.city ? titleCase(inst.city) : null, inst.state_code].filter(Boolean).join(", ");
  const collectedOn = formatAbsoluteDate(inst.latest_source_collected_at ?? null);

  return (
    <figure className="min-w-0 space-y-3">
      <figcaption className="text-left">
        <span className="text-[13px] text-ink-muted">
          <span className="font-semibold text-ink">Example:</span> {inst.institution_name}
          {place ? `, ${place}` : ""}
        </span>
        {finding?.price && (
          <span className="mt-1 block text-[15px] font-medium leading-snug text-ink">{finding.price}</span>
        )}
        {finding?.benchmark && (
          <span className="mt-0.5 block text-[13px] leading-snug text-ink-muted">{finding.benchmark}</span>
        )}
      </figcaption>
      <CheckTable
        rows={rows}
        stateCode={stateLabel ? stateCode : null}
        stateLabel={stateLabel}
        guideHrefs={guideHrefs}
      />
      <SourceNote>
        From {inst.institution_name}&apos;s own published fee schedule
        {collectedOn ? `, collected ${collectedOn}` : ""}.
      </SourceNote>
      <p className="mx-0 flex flex-wrap gap-x-6 text-left">
        <Link
          href={`/check?id=${id}`}
          className="inline-flex min-h-11 items-center text-[14px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
        >
          See {inst.institution_name}&apos;s full fee check
        </Link>
        <a
          href="#find-bank"
          className="inline-flex min-h-11 items-center text-[14px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
        >
          Check your own bank
        </a>
      </p>
    </figure>
  );
}
