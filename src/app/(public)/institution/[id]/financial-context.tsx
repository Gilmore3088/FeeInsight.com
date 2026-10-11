import { formatCompactDollars, formatStoredPercent } from "@/lib/format";
import { Metric } from "./institution-metrics";
import { formatReportQuarter, type NormalizedFinancial } from "./financial-units";

const SOURCE_LABELS: Record<string, string> = {
  fdic: "FDIC call report",
  ncua: "NCUA call report",
  ffiec: "FFIEC call report",
};

function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? "Call report";
}

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "N/A";
  return formatStoredPercent(value, Math.abs(value) < 1 ? 2 : 1);
}

export function FinancialContext({
  latest,
  history,
}: {
  latest: NormalizedFinancial | null;
  history: NormalizedFinancial[];
}) {
  const asOf = latest ? formatReportQuarter(latest.reportDate) : null;

  return (
    <section className="border border-[#E0D7C9] bg-white p-5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#6B6255]">
            Financial Context
          </p>
          <h2 className="text-lg font-semibold text-[#1A1815]">Size and fee revenue</h2>
        </div>
        {latest && asOf && (
          <p className="text-sm text-[#6B6255]">
            Financials as of {asOf} · {sourceLabel(latest.source)}
          </p>
        )}
      </div>

      {latest ? (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Metric framed label="Total assets" value={formatCompactDollars(latest.totalAssets)} />
            <Metric framed label="Total deposits" value={formatCompactDollars(latest.totalDeposits)} />
            <Metric
              framed
              label={latest.source === "ncua" ? "Service charge income (year to date)" : "Service charge income"}
              value={formatCompactDollars(latest.serviceChargeIncome)}
            />
            <Metric framed label="Fee income ratio" value={formatPercent(latest.feeIncomeRatioPct)} />
            {latest.roaPct !== null && (
              <Metric framed label="Return on assets" value={formatStoredPercent(latest.roaPct, 2)} />
            )}
            {latest.branchCount !== null && (
              <Metric framed label="Branches" value={latest.branchCount.toLocaleString("en-US")} />
            )}
          </div>

          {history.length > 1 && latest.source !== "ncua" && (
            <div className="mt-5 rounded-lg border border-[#E0D7C9] bg-[#FAF7F2] p-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#6B6255]">
                Service charge income by quarter
              </p>
              <div className="mt-3 space-y-2">
                {history.map((quarter) => (
                  <div
                    key={quarter.reportDate}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="font-medium text-[#1A1815]">
                      {formatReportQuarter(quarter.reportDate)}
                    </span>
                    <span className="tabular-nums text-[#5A5347]">
                      {formatCompactDollars(quarter.serviceChargeIncome)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="mt-4 rounded-lg border border-[#E0D7C9] bg-[#FAF7F2] p-4 text-sm text-[#6B6255]">
          Financial context is not available for this institution in the current dataset.
        </p>
      )}
    </section>
  );
}
