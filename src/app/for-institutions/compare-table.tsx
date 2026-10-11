import { REPORT_OFFER, SITE_NAME } from "@/lib/constants";
import type { PublicStatsSummary } from "@/lib/public-stats";
import { BAND, EYEBROW, GLASS, GLASS_SOFT, H2 } from "@/components/public/site-look";

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
      cost: "Paid subscription",
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
      cost: `Free national and district reports; institution report ${REPORT_OFFER.priceLabel.toLowerCase()}`,
      highlight: true,
    },
  ];
}

const HEAD_CELL = "px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-warm-700";

export function CompareTableSection({
  summary,
}: {
  summary: Pick<PublicStatsSummary, "institutionsLabel" | "refreshedOn">;
}) {
  const rows = buildRows(summary);
  return (
    <section aria-labelledby="compare-title" className={BAND}>
      <div className="mx-auto max-w-page px-6 py-14 sm:py-16">
        <p className={EYEBROW}>How this compares</p>
        <h2 id="compare-title" className={`mt-3 ${H2}`}>
          Four ways to find out what competitors charge
        </h2>

        {/* Table from 640px up; stacked cards below. */}
        <div
          role="region"
          aria-label="Comparison of four ways to find competitor fees (scrolls sideways)"
          tabIndex={0}
          className={`mt-8 hidden overflow-x-auto sm:block ${GLASS}`}
        >
          <table className="w-full min-w-[720px] text-sm">
            <caption className="sr-only">
              Four ways to find out what competitors charge, by coverage, refresh, source tracing, peer-group control and cost
            </caption>
            <thead>
              <tr className="bg-[#F3EEE6]/70 text-left">
                <th scope="col" className={HEAD_CELL}>Option</th>
                {COLUMNS.map((column) => (
                  <th scope="col" key={column.key} className={HEAD_CELL}>
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.option}
                  className={`border-t border-[#E8E1D6] ${row.highlight ? "bg-terra-soft/70" : ""}`}
                >
                  <th scope="row" className="px-4 py-3.5 text-left font-semibold text-warm-900">
                    {row.option}
                  </th>
                  {COLUMNS.map((column) => (
                    <td key={column.key} className="px-4 py-3.5 text-warm-800">
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
              className={`p-5 ${row.highlight ? `${GLASS} ring-terra/40` : GLASS_SOFT}`}
            >
              <p className="text-[15px] font-semibold text-warm-900">{row.option}</p>
              <dl className="mt-3 space-y-2">
                {COLUMNS.map((column) => (
                  <div key={column.key} className="flex flex-col">
                    <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-warm-700">
                      {column.label}
                    </dt>
                    <dd className="text-sm text-warm-800">{row[column.key]}</dd>
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
