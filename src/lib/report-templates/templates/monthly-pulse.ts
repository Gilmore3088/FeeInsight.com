/**
 * Monthly Pulse Report — HTML Template
 *
 * Pure function: (payload, narratives) => HTML string.
 * No async, no AI calls — narratives are pre-computed and injected (D-11).
 *
 * Section order:
 *   1. Cover page
 *   2. Overview: coverage cards and Hamilton's short narrative
 *   3. Fee changes at the same banks (or a plain statement that none were confirmed)
 *   4. How this was built
 */

import {
  wrapReport,
  coverPage,
  sectionHeader,
  dataTable,
  hamiltonNarrativeBlock,
  footnote,
  statCardRow,
} from "../index";
import type { MonthlyPulsePayload, PulseChange } from "../../report-assemblers/monthly-pulse";
import { PULSE_WINDOW_DAYS } from "../../report-assemblers/monthly-pulse";
import type { GenerateSectionOutput } from "../../hamilton/types";
import { HAMILTON_ATTRIBUTION, SITE_DOMAIN, SITE_NAME } from "@/lib/constants";

// ─── Input Type ────────────────────────────────────────────────────────────────

export interface MonthlyPulseReportInput {
  data: MonthlyPulsePayload;
  narratives: {
    /** 1-2 paragraphs only — Hamilton prompt must enforce 250-word max (D-09) */
    pulse_overview: GenerateSectionOutput;
  };
}

// ─── Table ─────────────────────────────────────────────────────────────────────

const CHANGE_COLUMNS = [
  { key: "institution", label: "Institution", align: "left" as const },
  { key: "fee", label: "Fee", align: "left" as const },
  { key: "old_amount", label: "Was", align: "right" as const, format: "amount" as const },
  { key: "new_amount", label: "Now", align: "right" as const, format: "amount" as const },
  { key: "changed_at", label: "Seen", align: "right" as const },
];

function toChangeRow(c: PulseChange): Record<string, string | number | null> {
  const charter = c.charter_type === "credit_union" ? "credit union" : c.charter_type === "bank" ? "bank" : null;
  const where = [c.state_code, charter].filter(Boolean).join(", ");
  return {
    institution: where ? `${c.institution_name} (${where})` : c.institution_name,
    fee: c.display_name,
    old_amount: c.old_amount,
    new_amount: c.new_amount,
    changed_at: c.changed_at,
  };
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

// ─── Renderer ──────────────────────────────────────────────────────────────────

export function renderMonthlyPulseReport(input: MonthlyPulseReportInput): string {
  const { data, narratives } = input;
  const ups = data.changes.filter((c) => c.direction === "up").length;
  const downs = data.changes.length - ups;
  const reportDate = new Date(`${data.report_date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

  const cover = coverPage({
    title: "Monthly Fee Pulse",
    subtitle: `Fee changes at the same institutions, ${data.period_label}`,
    report_date: reportDate,
    series: "Monthly Pulse Report",
  });

  const headline =
    data.changes.length === 0
      ? "No confirmed fee changes this month"
      : `${plural(data.changes.length, "confirmed fee change", "confirmed fee changes")} this month`;

  const overview = [
    sectionHeader({
      label: "This month",
      title: headline,
      subheading: `Schedules compared with the same institution's earlier schedule, ${data.window_start} to ${data.report_date}.`,
    }),
    statCardRow([
      { label: "Fee increases", value: ups.toLocaleString() },
      { label: "Fee decreases", value: downs.toLocaleString() },
      { label: "Institutions with live fees", value: data.coverage.institutions_live.toLocaleString() },
      { label: "Added this month", value: data.coverage.institutions_added_in_window.toLocaleString() },
    ]),
    hamiltonNarrativeBlock(narratives.pulse_overview.narrative),
  ].join("\n");

  const changesSection =
    data.changes.length > 0
      ? [
          sectionHeader({
            label: "Fee changes",
            title: "Where the same institution changed a published fee",
          }),
          dataTable({
            columns: CHANGE_COLUMNS,
            rows: data.changes.map(toChangeRow),
            caption: `${plural(ups, "increase", "increases")} and ${plural(downs, "decrease", "decreases")}, newest first`,
          }),
        ].join("\n")
      : `<p class="report-narrative">No institution's newest fee schedule showed a changed price this month.</p>`;

  const method = [
    `A change is reported only when an institution's newest fee schedule states the new price and no longer states the old one for the same fee.`,
    data.changes_not_confirmed > 0
      ? `${plural(data.changes_not_confirmed, "recorded change was", "recorded changes were")} left out because the newest schedule did not bear it out, for example a page that lists both prices for different accounts.`
      : "",
    `National medians are not compared month to month: ${plural(data.coverage.institutions_added_in_window, "institution", "institutions")} of ${data.coverage.institutions_live.toLocaleString()} were added in the last ${PULSE_WINDOW_DAYS} days, so a moving median would mostly show which institutions were added.`,
    `${SITE_NAME}, ${SITE_DOMAIN}. Generated ${data.report_date}.`,
  ]
    .filter(Boolean)
    .join(" ");

  const methodSection = [
    sectionHeader({ label: "Method", title: "How this was built" }),
    footnote(method),
  ].join("\n");

  return wrapReport([cover, overview, changesSection, methodSection].join("\n\n"), {
    title: `Monthly Fee Pulse, ${data.period_label}`,
    author: HAMILTON_ATTRIBUTION,
    date: data.report_date,
  });
}
