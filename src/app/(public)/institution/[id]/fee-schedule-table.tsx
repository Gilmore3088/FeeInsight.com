import { ExternalLink } from "lucide-react";
import { FEE_FAMILIES, getFeeFamily } from "@/lib/fee-taxonomy";
import { formatFeeAmount } from "@/lib/format";
import { getFrequencyLabel } from "./enum-labels";

export interface DisplayFee {
  id: string;
  feeName: string;
  feeCategory: string | null;
  amount: number | null;
  frequency: string | null;
  conditions: string | null;
  status: "verified" | "provisional";
  sourceUrl: string | null;
}

interface FeeGroup {
  family: string;
  rows: DisplayFee[];
  verifiedCount: number;
  provisionalCount: number;
}

const OTHER_FAMILY = "Other fees";
const FAMILY_ORDER = [...Object.keys(FEE_FAMILIES), OTHER_FAMILY];

function familyFor(fee: DisplayFee): string {
  return (fee.feeCategory ? getFeeFamily(fee.feeCategory) : null) ?? OTHER_FAMILY;
}

function dedupeKey(fee: DisplayFee): string {
  return `${fee.feeName.trim().toLowerCase()}|${fee.amount ?? "null"}`;
}

/** Groups fees by family, collapses duplicate name + amount pairs, keeps taxonomy order. */
export function groupFeesByFamily(fees: DisplayFee[]): FeeGroup[] {
  const groups = new Map<string, FeeGroup>();
  const seen = new Set<string>();

  for (const fee of fees) {
    const family = familyFor(fee);
    const key = `${family}|${dedupeKey(fee)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const group = groups.get(family) ?? { family, rows: [], verifiedCount: 0, provisionalCount: 0 };
    group.rows.push(fee);
    if (fee.status === "verified") group.verifiedCount += 1;
    else group.provisionalCount += 1;
    groups.set(family, group);
  }

  return FAMILY_ORDER.filter((family) => groups.has(family)).map((family) => {
    const group = groups.get(family) as FeeGroup;
    return {
      ...group,
      rows: [...group.rows].sort((a, b) => a.feeName.localeCompare(b.feeName)),
    };
  });
}

function GroupBadge({ group }: { group: FeeGroup }) {
  const verified = group.verifiedCount > 0;
  const className = verified
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : "border-amber-200 bg-amber-50 text-amber-900";
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${className}`}>
        {verified ? "Verified" : "Under review"}
      </span>
      {verified && group.provisionalCount > 0 && (
        <span className="text-[11px] text-[#6B6255]">{group.provisionalCount} under review</span>
      )}
    </span>
  );
}

const HEADER_CELL = "px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#6B6255]";
const SERIF_STYLE = { fontFamily: "var(--font-newsreader), Georgia, serif" } as const;

const FOCUSED_ROW = "border-l-2 border-l-[#C44B2E] bg-[#C44B2E]/[0.035]";

/**
 * @param focusCategory The fee the reader came to compare (`?fee=`), highlighted and
 *   anchored so the guide → directory → profile handoff lands on the right row.
 */
export function FeeScheduleTable({
  fees,
  disclosureUrl,
  focusCategory = null,
}: {
  fees: DisplayFee[];
  disclosureUrl: string | null;
  focusCategory?: string | null;
}) {
  const groups = groupFeesByFamily(fees);
  const isFocused = (fee: DisplayFee) => focusCategory !== null && fee.feeCategory === focusCategory;

  return (
    <>
      <FeeScheduleStack groups={groups} disclosureUrl={disclosureUrl} isFocused={isFocused} />
      <div className="hidden sm:block">
        <p className="border-b border-[#F0EBE3] px-4 py-1.5 text-xs text-[#6B6255] lg:hidden">
          Swipe for source and notes &rarr;
        </p>
        <div className="table-scroll">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[#E0D7C9] bg-[#FDFBF8]">
                <th scope="col" className={HEADER_CELL}>Fee</th>
                <th scope="col" className={`${HEADER_CELL} text-right`}>Amount</th>
                <th scope="col" className={HEADER_CELL}>Basis</th>
                <th scope="col" className={HEADER_CELL}>Note</th>
                <th scope="col" className={`${HEADER_CELL} text-right`}>Source</th>
              </tr>
            </thead>
            {groups.map((group) => (
              <tbody key={group.family} className="border-t border-[#E0D7C9]">
                <tr className="bg-[#FAF7F2]">
                  <th scope="rowgroup" colSpan={5} className="px-4 py-2.5 text-left">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-[#1A1815]">{group.family}</span>
                      <GroupBadge group={group} />
                    </div>
                  </th>
                </tr>
                {group.rows.map((fee) => (
                  <FeeRow
                    key={fee.id}
                    fee={fee}
                    disclosureUrl={disclosureUrl}
                    mixedGroup={group.verifiedCount > 0}
                    focused={isFocused(fee)}
                  />
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </div>
    </>
  );
}

function UnderReviewChip() {
  return (
    <span className="ml-2 inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">
      Under review
    </span>
  );
}

function SourceLink({ href }: { href: string | null }) {
  if (!href) return <span className="text-xs text-[#6B6255]">&mdash;</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs font-semibold text-[#A93D25] hover:text-[#A93D25]"
    >
      Source
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

function FeeRow({
  fee,
  disclosureUrl,
  mixedGroup,
  focused = false,
}: {
  fee: DisplayFee;
  disclosureUrl: string | null;
  mixedGroup: boolean;
  focused?: boolean;
}) {
  const sourceUrl = fee.sourceUrl ?? disclosureUrl;
  const amount = formatFeeAmount(fee.amount);
  const basis = getFrequencyLabel(fee.frequency);
  const showUnderReview = mixedGroup && fee.status === "provisional";

  return (
    <tr
      id={focused && fee.feeCategory ? `fee-${fee.feeCategory}` : undefined}
      data-fee-anchor={focused ? fee.feeCategory ?? undefined : undefined}
      className={`fi-row-interaction scroll-mt-24 border-b border-[#F0EBE3] last:border-0 ${focused ? FOCUSED_ROW : ""}`}
    >
      <td className="max-w-[320px] px-4 py-2.5 align-top">
        <span className="break-words font-medium text-[#1A1815]">{fee.feeName}</span>
        {showUnderReview && <UnderReviewChip />}
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 text-right align-top text-base tabular-nums text-[#1A1815]" style={SERIF_STYLE}>
        {amount ?? "\u2014"}
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 align-top text-[#5A5347]">{basis || "\u2014"}</td>
      <td className="max-w-[280px] px-4 py-2.5 align-top text-xs leading-relaxed text-[#6B6255]">
        {fee.conditions ? <span className="break-words">{fee.conditions}</span> : "\u2014"}
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 text-right align-top">
        <SourceLink href={sourceUrl} />
      </td>
    </tr>
  );
}

/** Below 640px: stacked rows — fee + amount on one line; basis, note and source beneath. */
function FeeScheduleStack({
  groups,
  disclosureUrl,
  isFocused,
}: {
  groups: FeeGroup[];
  disclosureUrl: string | null;
  isFocused: (fee: DisplayFee) => boolean;
}) {
  return (
    <div className="sm:hidden">
      {groups.map((group) => (
        <section key={group.family} className="border-t border-[#E0D7C9]">
          <div className="flex flex-wrap items-center justify-between gap-2 bg-[#FAF7F2] px-4 py-2.5">
            <span className="text-sm font-semibold text-[#1A1815]">{group.family}</span>
            <GroupBadge group={group} />
          </div>
          <ul>
            {group.rows.map((fee) => {
              const sourceUrl = fee.sourceUrl ?? disclosureUrl;
              const basis = getFrequencyLabel(fee.frequency);
              const showUnderReview = group.verifiedCount > 0 && fee.status === "provisional";
              const focused = isFocused(fee);
              return (
                <li
                  key={fee.id}
                  data-fee-anchor={focused ? fee.feeCategory ?? undefined : undefined}
                  className={`scroll-mt-24 border-b border-[#F0EBE3] px-4 py-2.5 last:border-0 ${focused ? FOCUSED_ROW : ""}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0 break-words text-sm font-medium text-[#1A1815]">
                      {fee.feeName}
                      {showUnderReview && <UnderReviewChip />}
                    </span>
                    <span className="shrink-0 text-base tabular-nums text-[#1A1815]" style={SERIF_STYLE}>
                      {formatFeeAmount(fee.amount) ?? "\u2014"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-[#6B6255]">
                    {[basis || null, fee.conditions].filter(Boolean).join(" \u00b7 ")}
                    {(basis || fee.conditions) && sourceUrl ? " \u00b7 " : null}
                    {sourceUrl && <SourceLink href={sourceUrl} />}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
