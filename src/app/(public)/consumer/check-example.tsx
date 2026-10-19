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
  CHECK_ROWS_SHOWN,
  avoidGuideHref,
  buildCheckRows,
  checkCounts,
  leadChip,
  lowerLabel,
  money,
  positionOf,
  referenceOf,
  rowPriceText,
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
  /** The compared fees the count is made of, one line each in the hero card. */
  compared: CheckRow[];
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
    compared: allRows.filter((row) => referenceOf(row)).slice(0, CHECK_ROWS_SHOWN),
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

/** "+$5", "-$0.50" or "about the same" against the row's own median. */
function gapText(row: CheckRow): { text: string; above: boolean } | null {
  const ref = referenceOf(row);
  if (!ref) return null;
  const position = positionOf(row.value, ref.band.median);
  if (position === "same") return { text: "about the same", above: false };
  const diff = Math.abs(row.value - ref.band.median);
  return { text: `${position === "above" ? "+" : "\u2212"}${money(diff)}`, above: position === "above" };
}

/**
 * The hero card's table: one line per compared fee, its price and its gap to the median. The full
 * check carries the U.S. medians, the account names and the counts behind each median.
 */
function CompactRows({ rows, placeShort }: { rows: CheckRow[]; placeShort: string | null }) {
  return (
    <table className="w-full text-[14px] [font-variant-numeric:tabular-nums]">
      <thead>
        <tr className="border-b border-border text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
          <th scope="col" className="py-2 text-left font-semibold">Fee</th>
          <th scope="col" className="py-2 text-right font-semibold">Price</th>
          <th scope="col" className="py-2 pl-3 text-right font-semibold">{placeShort ? `vs ${placeShort} median` : "vs median"}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const gap = gapText(row);
          const name = lowerLabel(row.label).replace(/^./, (c) => c.toUpperCase());
          return (
            <tr key={row.category} className="border-b border-border/60 last:border-0">
              <th scope="row" className="py-2.5 pr-3 text-left font-normal text-ink">{name}</th>
              <td className="whitespace-nowrap py-2.5 text-right font-semibold text-ink">{rowPriceText(row)}</td>
              <td className={`whitespace-nowrap py-2.5 pl-3 text-right font-semibold ${gap?.above ? "text-above-market" : "text-ink-muted"}`}>
                {gap?.text ?? ""}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * The example as a figure. "wide" sets the result beside its table (a full-width band on /consumer);
 * "card" stacks them in one light card for a page hero's right column (/check).
 */
export function CheckExample({ example, layout = "wide" }: { example: CheckExampleData; layout?: "wide" | "card" }) {
  const { id, name, place, rows, compared, counts, chip, stateCode, stateName, stateLabel, guideHrefs } = example;
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
    // A compact card beside the hero copy: the count, one line per fee it counts, the source.
    // The count is made of the lines shown, so the figure and the table always agree.
    const shown = checkCounts(compared) ?? counts;
    const placeShort = shown?.level === "state" && stateLabel && stateCode ? stateCode : shown?.level === "us" ? "U.S." : null;
    return (
      <figure className="min-w-0 rounded-2xl bg-paper p-4 text-left text-ink shadow-fi-2 sm:p-6">
        <figcaption className="min-w-0">
          {label}
          {shown && (
            <div className="mt-3">
              <ResultStat counts={shown} chip={null} stateName={stateLabel ? stateName : null} size="md" center={false} />
            </div>
          )}
        </figcaption>
        <div className="mt-4 min-w-0 space-y-3">
          <CompactRows rows={compared} placeShort={placeShort} />
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
