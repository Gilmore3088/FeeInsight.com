/**
 * A peer list as a CSV file (#977, H02-T08): the rows, criteria, notes and published fees the
 * screen shows, from the same `PeerListData`, so the file and the screen never differ. A missing
 * value stays blank with its reason, never 0; a fee charged as a rate keeps its rate and is never
 * written as dollars. Pure: no read, no write; safe to run in the browser.
 */
import { MAX_PEER_LIST_ROWS, type PeerListData } from "./peer-list";

/** A cell a spreadsheet reads as text: quoted when needed, and never run as a formula. */
export function peerCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function line(cells: Array<string | number | null | undefined>): string {
  return cells.map(peerCsvCell).join(",");
}

const charter = (type: PeerListData["rows"][number]["charterType"]) =>
  type === "credit_union" ? "Credit union" : type === "bank" ? "Bank" : "Type unavailable";

/** The file name: the subject, the page and the day the list was read. */
export function peerListCsvFilename(data: PeerListData): string {
  const subject = (data.subject?.name ?? "peers").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "peers";
  const page = data.offset ? `-from-${data.offset + 1}` : "";
  return `hamilton-peer-list-${subject}${page}-${data.queriedAt.slice(0, 10)}.csv`;
}

/**
 * The CSV text for a ready list: a header block (subject, criteria, notes), the institution table,
 * then each published fee on its own line when the list compared fees. Null for a list that is not ready.
 */
export function peerListCsv(data: PeerListData): string | null {
  if (data.status !== "ready" || !data.subject) return null;
  const out: string[] = [];
  const offset = data.offset ?? 0;
  out.push(line(["Peer list for", data.subject.name]));
  out.push(line(["Read on", data.queriedAt]));
  out.push(line(["Rows in this file", data.rows.length === 0 ? "0" : `${offset + 1} to ${offset + data.rows.length} of ${data.totalMatches ?? "an unknown number of"} matching institutions`]));
  for (const description of data.criteria?.descriptions ?? []) out.push(line(["Criteria", description]));
  for (const note of data.notes) out.push(line(["Note", note]));
  out.push(line(["Note", "Amounts are in US dollars. A blank amount is not available on file; it is not zero."]));
  out.push("");
  out.push(line(["row", "institution_id", "institution", "type", "city", "state", "total_assets_usd", "asset_report_date", "asset_source", "asset_source_url", "asset_record_id", "fee_data", "why_included"]));
  data.rows.slice(0, MAX_PEER_LIST_ROWS).forEach((row, i) => {
    out.push(line([
      offset + i + 1, row.institutionId, row.name, charter(row.charterType), row.city, row.stateCode,
      row.totalAssetsUsd, row.reportDate, row.source ? row.source.toUpperCase() : null, row.sourceUrl, row.recordId,
      row.feeCoverage === "available" ? "Published fees available" : "No published fees on file", row.inclusionReason,
    ]));
  });
  const comparison = data.feeComparison;
  if (comparison) {
    const label = comparison.label ?? "NSF";
    out.push("");
    out.push(line(["Note", comparison.note]));
    out.push(line(["institution_id", "institution", "fee", `${label}_amount_usd`, "rate", "frequency", "published_at", "fee_record_id", "source_document_id", "source_url"]));
    const institutions = [
      ...data.rows.map((row) => ({ id: row.institutionId, name: row.name })),
      ...(comparison.account ? [{ id: comparison.account.institutionId, name: `${comparison.account.name} (your institution)` }] : []),
    ];
    for (const item of institutions) {
      const fees = comparison.fees.filter((fee) => fee.institutionId === item.id);
      const rates = (comparison.rateFees ?? []).filter((fee) => fee.institutionId === item.id);
      if (fees.length + rates.length === 0) {
        out.push(line([item.id, item.name, `No published consumer ${label} fee on file`, null, null, null, null, null, null, null]));
        continue;
      }
      for (const fee of fees) {
        out.push(line([item.id, item.name, fee.name, fee.amount, null, fee.frequency, fee.publishedAt, fee.id, fee.sourceDocumentId, fee.documentUrl ?? fee.sourceUrl]));
      }
      for (const fee of rates) {
        out.push(line([item.id, item.name, fee.name, null, fee.rateLabel, fee.frequency, fee.publishedAt, fee.id, fee.sourceDocumentId, fee.documentUrl ?? fee.sourceUrl]));
      }
    }
  }
  return `${out.join("\n")}\n`;
}
