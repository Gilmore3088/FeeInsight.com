import Link from "next/link";
import type { Guide } from "@/lib/guides/types";
import { PRODUCT_NAME } from "@/lib/constants";
import { getCheckExampleInputsCached, getStateFeeIndexesCached } from "@/lib/data-store/public-cached-reads";
import { formatAbsoluteDate, getPublicNationalIndex, getPublicStatsSummary } from "@/lib/public-stats";
import { STATE_NAMES } from "@/lib/us-states";
import { SourceNote } from "../research/district/[id]/district-hub";
import { isVerifiedFee } from "../institution/[id]/profile-data";
import { titleCase } from "../fees/city/[state]/[city]/city-lookup";
import {
  avoidGuideHref,
  buildCheckRows,
  checkCounts,
  leadChip,
  stateGroupLabel,
  type CheckCounts,
  type CheckRow,
} from "../check/check-data";
import { CheckTable } from "../check/check-table";
import { ResultStat } from "../check/check-result";

/** Rows the example shows; the full check shows every headline fee. */
const EXAMPLE_ROWS = 3;

export interface CheckExampleData {
  id: number;
  name: string;
  place: string;
  rows: CheckRow[];
  counts: CheckCounts | null;
  chip: { label: string; gap: string } | null;
  stateCode: string | null;
  stateName: string | null;
  stateLabel: string | null;
  guideHrefs: Record<string, string | null>;
  collectedOn: string | null;
  mediansOn: string | null;
}

/**
 * A real fee-check result for one named institution, read the way /check reads it (from the public
 * cache, since every visitor sees the same example), cut to its first rows. Null when the
 * institution or its comparisons are not available, so the page can leave the example out.
 */
export async function loadCheckExample(id: number, guides: Guide[]): Promise<CheckExampleData | null> {
  const input = await getCheckExampleInputsCached(id).catch((error: unknown) => {
    console.error("Fee check example failed:", error);
    return null;
  });
  if (!input) return null;
  const { inst } = input;
  const verifiedFees = input.fees.filter(isVerifiedFee);
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
  return {
    id,
    name: inst.institution_name,
    place: [inst.city ? titleCase(inst.city) : null, inst.state_code].filter(Boolean).join(", "),
    rows,
    counts: checkCounts(allRows),
    chip: leadChip(allRows, stateLabel ? stateCode : null),
    stateCode,
    stateName,
    stateLabel,
    guideHrefs: Object.fromEntries(rows.map((row) => [row.category, avoidGuideHref(row.category, guides)])),
    collectedOn: formatAbsoluteDate(inst.latest_source_collected_at ?? null),
    // The same date /check gives its medians.
    mediansOn: stats?.refreshedOn ?? null,
  };
}

function ExampleSource({ example }: { example: CheckExampleData }) {
  const medianScope = example.stateLabel && example.stateName ? `${example.stateName} and U.S. medians` : "U.S. medians";
  return (
    <SourceNote>
      {example.name}&apos;s own published fee schedule
      {example.collectedOn ? `, collected ${example.collectedOn}` : ""}. {medianScope} from the {PRODUCT_NAME}
      {example.mediansOn ? `, as of ${example.mediansOn}` : ""}.{" "}
      <Link href="/methodology" className="underline decoration-border underline-offset-2 hover:decoration-ink">
        Methodology
      </Link>
    </SourceNote>
  );
}

/**
 * The example as a figure. "wide" sets the result beside its table (a full-width band on /consumer);
 * "card" stacks them in one light card for a page hero's right column (/check).
 */
export function CheckExample({ example, layout = "wide" }: { example: CheckExampleData; layout?: "wide" | "card" }) {
  const { id, name, place, rows, counts, chip, stateCode, stateName, stateLabel, guideHrefs } = example;
  const table = (
    <CheckTable rows={rows} stateCode={stateLabel ? stateCode : null} stateLabel={stateLabel} guideHrefs={guideHrefs} />
  );
  const fullLink = (
    <Link
      href={`/check?id=${id}`}
      className="inline-flex min-h-11 items-center text-[14px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
    >
      See {name}&apos;s full fee check
    </Link>
  );
  const label = (
    <p className="text-[13px] text-ink-muted">
      <span className="font-semibold text-ink">Example:</span> {name}
      {place ? `, ${place}` : ""}
    </p>
  );

  if (layout === "card") {
    return (
      <figure className="min-w-0 rounded-2xl bg-paper p-3 text-left text-ink shadow-fi-2 sm:p-6">
        <figcaption className="min-w-0">
          {label}
          {counts && (
            <div className="mt-3">
              <ResultStat counts={counts} chip={chip} stateName={stateLabel ? stateName : null} size="md" center={false} />
            </div>
          )}
        </figcaption>
        <div className="mt-5 min-w-0 space-y-3">
          {table}
          <ExampleSource example={example} />
          {fullLink}
        </div>
      </figure>
    );
  }

  return (
    <figure className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-10">
      <figcaption className="min-w-0 text-left">
        {label}
        {counts && (
          <div className="mt-3">
            <ResultStat counts={counts} chip={chip} stateName={stateLabel ? stateName : null} size="md" center={false} />
          </div>
        )}
        <div className="mt-3">{fullLink}</div>
      </figcaption>
      <div className="min-w-0 space-y-3">
        {table}
        <ExampleSource example={example} />
      </div>
    </figure>
  );
}
