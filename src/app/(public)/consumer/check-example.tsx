import Link from "next/link";
import type { Guide } from "@/lib/guides/types";
import { PRODUCT_NAME } from "@/lib/constants";
import { getStateFeeIndexesCached } from "@/lib/data-store/public-cached-reads";
import { formatAbsoluteDate, getPublicNationalIndex, getPublicStatsSummary } from "@/lib/public-stats";
import { STATE_NAMES } from "@/lib/us-states";
import { SourceNote } from "../research/district/[id]/district-hub";
import { getPublicInstitutionForPage, getVisibleFeesForPage, isVerifiedFee } from "../institution/[id]/profile-data";
import { titleCase } from "../fees/city/[state]/[city]/city-lookup";
import { avoidGuideHref, buildCheckRows, checkCounts, leadChip, stateGroupLabel } from "../check/check-data";
import { CheckTable } from "../check/check-table";
import { ResultStat } from "../check/check-result";

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
  const [nationalIndex, stateIndexes, stats] = await Promise.all([
    getPublicNationalIndex().catch(() => []),
    stateCode ? getStateFeeIndexesCached(stateCode).catch(() => null) : Promise.resolve(null),
    getPublicStatsSummary().catch(() => null),
  ]);
  const allRows = buildCheckRows({
    verifiedFees,
    nationalIndex,
    stateIndex: stateIndexes?.all ?? [],
    fallbackSourceUrl: inst.fee_schedule_url ?? null,
  });
  const rows = allRows.slice(0, EXAMPLE_ROWS);
  if (rows.length === 0) return null;
  // The figure counts every headline fee, as the full check does; the table shows the first few.
  const stateLabel = stateGroupLabel(allRows, stateName);
  const counts = checkCounts(allRows);
  const chip = leadChip(allRows, stateLabel ? stateCode : null);
  const guideHrefs = Object.fromEntries(rows.map((row) => [row.category, avoidGuideHref(row.category, guides)]));
  const place = [inst.city ? titleCase(inst.city) : null, inst.state_code].filter(Boolean).join(", ");
  const collectedOn = formatAbsoluteDate(inst.latest_source_collected_at ?? null);
  // The same date /check gives its medians.
  const mediansOn = stats?.refreshedOn ?? null;
  const medianScope = stateLabel && stateName ? `${stateName} and U.S. medians` : "U.S. medians";

  return (
    <figure className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-10">
      <figcaption className="min-w-0 text-left">
        <p className="text-[13px] text-ink-muted">
          <span className="font-semibold text-ink">Example:</span> {inst.institution_name}
          {place ? `, ${place}` : ""}
        </p>
        {counts && (
          <div className="mt-3">
            <ResultStat counts={counts} chip={chip} stateName={stateLabel ? stateName : null} size="md" center={false} />
          </div>
        )}
        <Link
          href={`/check?id=${id}`}
          className="mt-3 inline-flex min-h-11 items-center text-[14px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
        >
          See {inst.institution_name}&apos;s full fee check
        </Link>
      </figcaption>
      <div className="min-w-0 space-y-3">
        <CheckTable
          rows={rows}
          stateCode={stateLabel ? stateCode : null}
          stateLabel={stateLabel}
          guideHrefs={guideHrefs}
        />
        <SourceNote>
          {inst.institution_name}&apos;s own published fee schedule
          {collectedOn ? `, collected ${collectedOn}` : ""}. {medianScope} from the {PRODUCT_NAME}
          {mediansOn ? `, as of ${mediansOn}` : ""}.{" "}
          <Link href="/methodology" className="underline decoration-border underline-offset-2 hover:decoration-ink">
            Methodology
          </Link>
        </SourceNote>
      </div>
    </figure>
  );
}
