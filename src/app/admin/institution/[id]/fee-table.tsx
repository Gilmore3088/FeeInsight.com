import type { InstitutionFee } from "@/lib/data-store/institution";
import { HoldFeeButton } from "./fee-hold-controls";

interface Props {
  fees: InstitutionFee[];
  institutionName: string;
  /** Show the Hold action: the viewer may hold fees. */
  canHold: boolean;
}

function formatAmount(amount: number | null): string {
  if (amount === null) return "varies";
  if (amount === 0) return "Free";
  return `$${amount.toFixed(2)}`;
}

function confidenceLabel(confidence: number | null): string {
  return confidence === null ? "-" : `${Math.round(confidence * 100)}%`;
}

export function FeeTable({ fees, institutionName, canHold }: Props) {
  const grouped = new Map<string, InstitutionFee[]>();
  fees.forEach((fee) => {
    const category = fee.fee_category || "other";
    if (!grouped.has(category)) grouped.set(category, []);
    grouped.get(category)!.push(fee);
  });

  return (
    <div className="overflow-x-auto">
      <table className="admin-table w-full text-xs">
        <thead>
          <tr className="text-left">
            <th>Fee Name</th>
            <th className="text-right">Amount</th>
            <th>Frequency</th>
            <th>Coverage</th>
            <th className="text-center">Conf.</th>
            <th>Published</th>
            <th>Source</th>
            {canHold && <th />}
          </tr>
        </thead>
        <tbody>
          {Array.from(grouped.entries()).map(([category, categoryFees]) => (
            <FragmentRows
              key={category}
              category={category}
              fees={categoryFees}
              institutionName={institutionName}
              canHold={canHold}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FragmentRows({
  category,
  fees,
  institutionName,
  canHold,
}: {
  category: string;
  fees: InstitutionFee[];
  institutionName: string;
  canHold: boolean;
}) {
  return (
    <>
      <tr>
        <td
          colSpan={canHold ? 8 : 7}
          className="bg-gray-50/80 py-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-gray-400 dark:bg-white/[0.03]"
        >
          {category.replace(/_/g, " ")}
        </td>
      </tr>
      {fees.map((fee) => (
        <tr
          key={fee.id}
          className="transition-colors hover:bg-gray-50/50 dark:hover:bg-white/[0.04]"
        >
          <td className="font-medium text-gray-900 dark:text-gray-100">
            {fee.fee_name}
            {fee.is_fee_cap && (
              <span className="ml-1.5 inline-block rounded bg-amber-50 px-1 py-px text-[9px] font-bold text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
                CAP
              </span>
            )}
            {fee.conditions && (
              <p className="mt-0.5 max-w-xl text-[11px] font-normal text-gray-500 dark:text-gray-400">
                {fee.conditions}
              </p>
            )}
          </td>
          <td className="text-right font-medium tabular-nums text-gray-900 dark:text-gray-100">
            {formatAmount(fee.amount)}
          </td>
          <td className="text-gray-500">{fee.frequency ?? "-"}</td>
          <td>
            <span className="inline-block rounded bg-gray-100 px-1.5 py-0.5 text-[9px] font-medium text-gray-600 dark:bg-white/[0.06] dark:text-gray-400">
              {fee.coverage_tier ?? fee.variant_type ?? "published"}
            </span>
          </td>
          <td className="text-center tabular-nums text-gray-400">
            {confidenceLabel(fee.extraction_confidence)}
          </td>
          <td className="tabular-nums text-gray-500">{fee.created_at}</td>
          <td>
            {fee.source_url ? (
              <a
                href={fee.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline dark:text-blue-400"
              >
                Open
              </a>
            ) : (
              <span className="text-gray-300">-</span>
            )}
          </td>
          {canHold && (
            <td className="text-right">
              <HoldFeeButton feeId={fee.id} feeName={fee.fee_name} amount={fee.amount} institutionName={institutionName} />
            </td>
          )}
        </tr>
      ))}
    </>
  );
}
