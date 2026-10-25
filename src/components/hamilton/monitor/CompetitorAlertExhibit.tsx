/**
 * A competitor fee change alert drawn as a report exhibit (src/lib/report-design/README.md):
 * label, a headline that states the change, a table of the competitor's old and new price
 * beside the bank's own, and a source line. It reports the change; it never recommends a price.
 *
 * Under it, the alert's baseline (#1898): the price we had on file before and the one that
 * replaced it, each with the schedule edition it came from and the day it reached our records,
 * so the reader can see what we knew and when. Server component.
 */

import { Exhibit, ReportDesign } from "@/components/report-design";
import { getDisplayName } from "@/lib/fee-taxonomy";
import type { BaselineSideDetail, CompetitorChangeDetail } from "@/lib/hamilton/competitor-alert-detail";

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

/** "Overdraft (OD)" -> "Overdraft". */
function feeHeading(feeKey: string): string {
  return getDisplayName(feeKey).replace(/\s*\([^)]*\)/g, "").trim();
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function BaselineRow({ label, side }: { label: string; side: BaselineSideDetail }) {
  const schedule = formatDate(side.edition) ?? "Not dated";
  return (
    <tr>
      <td>{label}</td>
      <td className="num">{money(side.amount)}</td>
      <td>
        {side.scheduleUrl ? (
          <a href={side.scheduleUrl} rel="noopener noreferrer" target="_blank" style={{ textDecoration: "underline" }}>
            {schedule}
          </a>
        ) : (
          schedule
        )}
      </td>
      <td>{formatDate(side.readOn) ?? "Not recorded"}</td>
    </tr>
  );
}

export function CompetitorAlertExhibit({
  signalId,
  title,
  detail,
}: {
  signalId: string;
  title: string;
  detail: CompetitorChangeDetail;
}) {
  const competitor = detail.competitorName ?? "The competitor";
  const bank = detail.bankName ?? "Your institution";
  const date = formatDate(detail.changedAt);
  const source =
    `Source: ${competitor}'s published fee schedule` +
    (date ? `, ${date}` : "") +
    ". Verified, then held for a 12-hour second look before this alert." +
    (detail.baseline
      ? " A schedule older than the one we had, or a correction to our own reading, is never reported as a change."
      : "");

  return (
    <ReportDesign>
      <Exhibit
        exhibit={{
          key: `competitor-${signalId}`,
          label: `Competitor watch · ${feeHeading(detail.feeKey)}`,
          title,
          source,
        }}
      >
        <div className="rd-table-wrap">
          <table className="rd-table">
            <thead>
              <tr>
                <th scope="col">Institution</th>
                <th scope="col" className="num">
                  Before
                </th>
                <th scope="col" className="num">
                  Now
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{competitor}</td>
                <td className="num">{money(detail.previousAmount)}</td>
                <td className="num">{money(detail.newAmount)}</td>
              </tr>
              <tr className="rd-subject">
                <td>{bank}</td>
                <td className="num" />
                <td className="num">{detail.ownAmount === null ? "Not on file" : money(detail.ownAmount)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        {detail.baseline ? (
          <div className="rd-table-wrap">
            <table className="rd-table" aria-label={`What we knew and when: ${competitor}`}>
              <caption style={{ captionSide: "top", textAlign: "left", fontWeight: 600, fontSize: "0.95em", padding: "1.25rem 0 0.25rem" }}>
                What we knew and when
              </caption>
              <thead>
                <tr>
                  <th scope="col">{competitor}</th>
                  <th scope="col" className="num">
                    Price
                  </th>
                  <th scope="col">Schedule dated</th>
                  <th scope="col">On file from</th>
                </tr>
              </thead>
              <tbody>
                <BaselineRow label="Before" side={detail.baseline.before} />
                <BaselineRow label="Now" side={detail.baseline.after} />
              </tbody>
            </table>
          </div>
        ) : null}
      </Exhibit>
    </ReportDesign>
  );
}
