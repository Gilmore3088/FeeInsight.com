/**
 * "Districts, States and Size" chapter of the National Fee Index: each Fed district,
 * a state ranking, size tiers, sixteen quarters of fee income and the highest published
 * fees. Renders only what the trends hold; a group too small for a median says so.
 * States facts and never tells an institution what to charge.
 */

import { chapterDivider, compactTable, footnote, horizontalBarChart, pageBreak, statCardRow } from "../primitives";
import type { StatCard } from "../primitives";
import { TREND_FEES, type FeeMedian, type NationalTrends, type TrendFee } from "@/lib/report-assemblers/national-trends";
import { getDisplayName } from "@/lib/fee-taxonomy";

const SUBHEAD_STYLE =
  "font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #7A7062; margin: 28px 0 10px 0;";
const NOTE_STYLE = "font-size: 12px; color: #7A7062; margin: 6px 0 0 0;";
const EMPTY_STYLE = "font-size: 13px; color: #7A7062; font-style: italic; margin: 0;";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function money(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

/** Thousands of dollars as "$11.9B" or "$842M". */
export function thousandsShort(thousands: number): string {
  const dollars = thousands * 1000;
  if (Math.abs(dollars) >= 1e9) return `$${(dollars / 1e9).toFixed(1)}B`;
  if (Math.abs(dollars) >= 1e6) return `$${(dollars / 1e6).toFixed(0)}M`;
  return `$${Math.round(dollars).toLocaleString("en-US")}`;
}

function signedPct(n: number | null): string {
  if (n === null) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function medianCell(m: FeeMedian): string {
  return m.median === null ? (m.institutions > 0 ? `too few (${m.institutions})` : "—") : money(m.median);
}

const FEE_COLUMNS = TREND_FEES.map((fee) => ({ key: fee, label: getDisplayName(fee), align: "right" as const }));

function feeCells(fees: Record<TrendFee, FeeMedian>): Record<string, string> {
  return Object.fromEntries(TREND_FEES.map((fee) => [fee, medianCell(fees[fee])]));
}

function districtPart(t: NationalTrends, withFees: boolean): string {
  const quarter = t.districts.find((d) => d.income)?.income?.quarter;
  if (!withFees) {
    if (!quarter) return `<p style="${EMPTY_STYLE}">No district service-charge filings are on file.</p>`;
    return compactTable({
      caption: `Service-charge income by Federal Reserve district, ${quarter}`,
      columns: [
        { key: "district", label: "District", align: "left" },
        { key: "filers", label: "Filers", align: "right", format: "integer" },
        { key: "income", label: "Fee income", align: "right" },
        { key: "yoy", label: "vs year ago", align: "right" },
      ],
      rows: t.districts.map((d) => ({
        district: `${d.district} ${d.name}`,
        filers: d.income?.institutions ?? null,
        income: d.income ? thousandsShort(d.income.thousands) : "\u2014",
        yoy: d.income ? signedPct(d.income.yoyPct) : "\u2014",
      })),
    });
  }
  const priced = t.districts.filter((d) => d.institutions > 0);
  if (priced.length === 0) return `<p style="${EMPTY_STYLE}">No district has published fees on file yet.</p>`;
  return compactTable({
    caption: `Median published fee by Federal Reserve district${quarter ? `, with ${quarter} service-charge income` : ""}`,
    columns: [
      { key: "district", label: "District", align: "left" },
      { key: "institutions", label: "Institutions", align: "right", format: "integer" },
      ...FEE_COLUMNS,
      { key: "income", label: "Fee income", align: "right" },
      { key: "yoy", label: "vs year ago", align: "right" },
    ],
    rows: t.districts.map((d) => ({
      district: `${d.district} ${d.name}`,
      institutions: d.institutions,
      ...feeCells(d.fees),
      income: d.income ? thousandsShort(d.income.thousands) : "—",
      yoy: d.income ? signedPct(d.income.yoyPct) : "—",
    })),
  });
}

function districtSpread(t: NationalTrends): string {
  const od = t.districts.filter((d) => d.fees.overdraft.median !== null);
  if (od.length < 2) return "";
  const sorted = [...od].sort((a, b) => (b.fees.overdraft.median ?? 0) - (a.fees.overdraft.median ?? 0));
  return horizontalBarChart({
    title: "Median overdraft fee by district",
    bars: sorted.map((d) => ({ label: d.name, value: d.fees.overdraft.median ?? 0, displayValue: money(d.fees.overdraft.median ?? 0) })),
    source: "Published fee catalog; one value per institution, highest overdraft tier.",
  });
}

function statePart(t: NationalTrends): string {
  return t.stateRankings
    .map((r) => {
      if (r.ranked.length === 0) return `<p style="${EMPTY_STYLE}">No state has enough institutions publishing a ${escapeHtml(r.feeName.toLowerCase())} to rank.</p>`;
      const table = compactTable({
        caption: `${r.feeName}: states ranked highest first by median, then 75th and 25th percentile (${r.ranked.length} states with at least five institutions)`,
        columns: [
          { key: "rank", label: "Rank", align: "right", format: "integer" },
          { key: "state", label: "State", align: "left" },
          { key: "median", label: "Median", align: "right", format: "amount" },
          { key: "range", label: "Middle half", align: "right" },
          { key: "institutions", label: "Institutions", align: "right", format: "integer" },
        ],
        rows: r.ranked.map((s) => ({
          rank: s.rank,
          state: s.state,
          median: s.median,
          range: s.p25 !== null && s.p75 !== null ? `${money(s.p25)} to ${money(s.p75)}` : "—",
          institutions: s.institutions,
        })),
      });
      const few = r.tooFew.length > 0
        ? `<p style="${NOTE_STYLE}">Not ranked (fewer than five institutions): ${r.tooFew.map((s) => `${escapeHtml(s.state)} (${s.institutions})`).join(", ")}.</p>`
        : "";
      return table + few;
    })
    .join("\n");
}

function tierPart(t: NationalTrends): string {
  if (t.tiers.length === 0) return `<p style="${EMPTY_STYLE}">No asset-size tier has published fees on file yet.</p>`;
  return compactTable({
    caption: "Median published fee by asset size",
    columns: [
      { key: "tier", label: "Asset size", align: "left" },
      { key: "institutions", label: "Institutions", align: "right", format: "integer" },
      ...FEE_COLUMNS,
    ],
    rows: t.tiers.map((tier) => ({ tier: `${tier.label} (${tier.range})`, institutions: tier.institutions, ...feeCells(tier.fees) })),
  });
}

function incomePart(t: NationalTrends): string {
  if (t.income.length === 0) return `<p style="${EMPTY_STYLE}">No FDIC or NCUA service-charge filings are on file.</p>`;
  const latest = t.income[0];
  const oldest = t.income[t.income.length - 1];
  const change = oldest.thousands > 0 ? ((latest.thousands - oldest.thousands) / oldest.thousands) * 100 : null;
  const cards: StatCard[] = [
    {
      label: `Service-charge income, ${latest.quarter}`,
      value: thousandsShort(latest.thousands),
      delta: latest.yoyPct === null ? undefined : `${signedPct(latest.yoyPct)} vs a year earlier`,
      deltaColor: "neutral",
      source: `${latest.institutions.toLocaleString("en-US")} filers`,
    },
    {
      label: `Change since ${oldest.quarter}`,
      value: change === null ? "—" : signedPct(change),
      source: `${t.income.length} quarters of FDIC and NCUA filings`,
    },
    {
      label: `Credit union share, ${latest.quarter}`,
      value: latest.thousands > 0 ? `${((latest.cuThousands / latest.thousands) * 100).toFixed(0)}%` : "—",
      source: `Banks ${thousandsShort(latest.bankThousands)}, credit unions ${thousandsShort(latest.cuThousands)}`,
    },
  ];
  const chronological = [...t.income].reverse();
  return [
    statCardRow(cards),
    horizontalBarChart({
      title: "Deposit service-charge income by quarter",
      bars: chronological.map((q) => ({ label: q.quarter, value: q.thousands, displayValue: thousandsShort(q.thousands) })),
      source: "FDIC call reports and NCUA 5300; credit-union year-to-date figures split into quarters.",
    }),
    compactTable({
      caption: "Quarterly service-charge income",
      columns: [
        { key: "quarter", label: "Quarter", align: "left" },
        { key: "total", label: "Total", align: "right" },
        { key: "banks", label: "Banks", align: "right" },
        { key: "cus", label: "Credit unions", align: "right" },
        { key: "yoy", label: "vs year ago", align: "right" },
      ],
      rows: t.income.map((q) => ({
        quarter: q.quarter,
        total: thousandsShort(q.thousands),
        banks: thousandsShort(q.bankThousands),
        cus: thousandsShort(q.cuThousands),
        yoy: signedPct(q.yoyPct),
      })),
    }),
  ].join("\n");
}

function outlierPart(t: NationalTrends): string {
  if (t.outliers.length === 0) return `<p style="${EMPTY_STYLE}">Too few institutions publish these fees to set an outlier fence.</p>`;
  return t.outliers
    .map((o) => {
      const head = `<p style="font-size: 13px; margin: 14px 0 6px 0;"><strong>${escapeHtml(o.feeName)}</strong>: median ${money(o.median)}; ${o.aboveFence.toLocaleString("en-US")} of ${o.institutionsPriced.toLocaleString("en-US")} institutions publish more than ${money(o.fence)}.</p>`;
      if (o.highest.length === 0) return head;
      return (
        head +
        compactTable({
          columns: [
            { key: "institution", label: "Institution", align: "left" },
            { key: "state", label: "State", align: "left" },
            { key: "amount", label: "Published fee", align: "right", format: "amount" },
          ],
          rows: o.highest.map((h) => ({ institution: h.institution, state: h.state, amount: h.amount })),
        })
      );
    })
    .join("\n");
}

export interface NationalTrendsSectionOptions {
  number: string;
  title?: string;
  /** Fee medians by district (off when another chapter already shows them). Default on. */
  districtFees?: boolean;
  /** Fee medians by asset size (off when another chapter already shows them). Default on. */
  tiers?: boolean;
}

export function renderNationalTrendsSection(trends: NationalTrends, options: NationalTrendsSectionOptions): string {
  const districtFees = options.districtFees !== false;
  const tiers = options.tiers !== false;
  return [
    pageBreak(),
    chapterDivider(options.number, options.title ?? "Districts, States and Size"),
    `<h4 style="${SUBHEAD_STYLE}">Federal Reserve districts</h4>`,
    districtPart(trends, districtFees),
    districtFees ? districtSpread(trends) : "",
    `<h4 style="${SUBHEAD_STYLE}">State ranking</h4>`,
    statePart(trends),
    tiers ? `<h4 style="${SUBHEAD_STYLE}">Asset size</h4>` : "",
    tiers ? tierPart(trends) : "",
    `<h4 style="${SUBHEAD_STYLE}">Fee income, ${trends.income.length} quarters</h4>`,
    incomePart(trends),
    `<h4 style="${SUBHEAD_STYLE}">Highest published fees</h4>`,
    outlierPart(trends),
    footnote(`How this was built. ${trends.provenance.join(" ")}`),
  ]
    .filter(Boolean)
    .join("\n");
}
