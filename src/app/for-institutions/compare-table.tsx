import { SITE_NAME } from "@/lib/constants";
import type { PublicStatsSummary } from "@/lib/public-stats";

interface CompareRow {
  option: string;
  coverage: string;
  refresh: string;
  sourceTraceable: string;
  peerGroupControl: string;
  cost: string;
  highlight?: boolean;
}

const COLUMNS: { key: keyof Omit<CompareRow, "option" | "highlight">; label: string }[] = [
  { key: "coverage", label: "Coverage" },
  { key: "refresh", label: "Refresh" },
  { key: "sourceTraceable", label: "Source-traceable" },
  { key: "peerGroupControl", label: "Peer-group control" },
  { key: "cost", label: "Cost" },
];

function buildRows(summary: Pick<PublicStatsSummary, "institutionsLabel" | "refreshedOn">): CompareRow[] {
  const refreshed = summary.refreshedOn ? `; index updated ${summary.refreshedOn}` : "";
  return [
    {
      option: "Annual fee survey",
      coverage: "Sample-based; whoever responded",
      refresh: "Annual",
      sourceTraceable: "No",
      peerGroupControl: "No — fixed segments",
      cost: "Typically $3–8k/yr",
    },
    {
      option: "Core/vendor peer report",
      coverage: "Your vendor's client base",
      refresh: "Quarterly or on request",
      sourceTraceable: "Rarely",
      peerGroupControl: "Limited to vendor segments",
      cost: "Bundled or per report",
    },
    {
      option: "DIY web scrape",
      coverage: "Whatever your team builds",
      refresh: "Whenever you rerun it",
      sourceTraceable: "Partial",
      peerGroupControl: "Manual",
      cost: "Your team's time",
    },
    {
      option: SITE_NAME,
      coverage: `${summary.institutionsLabel} institutions with verified fees`,
      refresh: `Rolling — every schedule rechecked at least quarterly${refreshed}`,
      sourceTraceable: "Every figure linked to its disclosure",
      peerGroupControl: "Yes — charter, asset tier, district",
      cost: "Free report",
      highlight: true,
    },
  ];
}

const HEAD_CELL = "px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-warm-600";

export function CompareTableSection({
  summary,
}: {
  summary: Pick<PublicStatsSummary, "institutionsLabel" | "refreshedOn">;
}) {
  const rows = buildRows(summary);
  return (
    <section className="bg-white border-b border-warm-200">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#6B6255]">
          How this compares
        </p>
        <h2
          className="mt-3 text-warm-900 text-[28px]"
          style={{ fontFamily: "var(--font-newsreader), Georgia, serif" }}
        >
          Four ways to find out what competitors charge
        </h2>

        {/* Table from 640px up; stacked cards below. */}
        <div className="mt-8 hidden overflow-x-auto rounded-lg border border-warm-300 sm:block">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead>
              <tr className="bg-warm-150 text-left">
                <th className={HEAD_CELL}>Option</th>
                {COLUMNS.map((column) => (
                  <th key={column.key} className={HEAD_CELL}>
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.option}
                  className={`border-t border-warm-200 ${row.highlight ? "bg-terra-soft/60" : "bg-white"}`}
                >
                  <td className="px-4 py-3 font-semibold text-warm-900">{row.option}</td>
                  {COLUMNS.map((column) => (
                    <td key={column.key} className="px-4 py-3 text-warm-700">
                      {row[column.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-8 grid gap-3 sm:hidden">
          {rows.map((row) => (
            <div
              key={row.option}
              className={`rounded-lg border p-4 ${
                row.highlight ? "border-terra/40 bg-terra-soft/60" : "border-warm-300 bg-white"
              }`}
            >
              <p className="text-[15px] font-semibold text-warm-900">{row.option}</p>
              <dl className="mt-3 space-y-2">
                {COLUMNS.map((column) => (
                  <div key={column.key} className="flex flex-col">
                    <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-warm-600">
                      {column.label}
                    </dt>
                    <dd className="text-[13px] text-warm-700">{row[column.key]}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
