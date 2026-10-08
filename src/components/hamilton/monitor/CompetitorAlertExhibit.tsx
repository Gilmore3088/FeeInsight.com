/**
 * A competitor fee change alert drawn as a report exhibit (src/lib/report-design/README.md):
 * label, a headline that states the change, a table of the competitor's old and new price
 * beside the bank's own, and a source line. It reports the change; it never recommends a price.
 * Server component.
 */

import { Exhibit, ReportDesign } from "@/components/report-design";
import { getDisplayName } from "@/lib/fee-taxonomy";
import type { CompetitorChangeDetail } from "@/lib/hamilton/competitor-alert-detail";

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
    ". Verified, then held for a 12-hour second look before this alert.";

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
      </Exhibit>
    </ReportDesign>
  );
}
