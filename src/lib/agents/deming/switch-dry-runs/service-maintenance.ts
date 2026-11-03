import {
  findServiceMaintenance,
  SERVICE_MAINTENANCE_MAX_ROWS,
  type ServiceMaintenanceLiveRow,
  type ServiceMaintenanceMatch,
} from "@/lib/agents/darwin/service-maintenance-check";
import { bounded, type Bounded, type SwitchAuditOptions, type SwitchAuditReader } from "./types";

/**
 * `SERVICE_MAINTENANCE_TAKEDOWN_LIVE` (#1092, Knox v171): the live monthly maintenance fees Darwin's
 * service-heading re-check would take down switched on, judged by the re-check's own function
 * (`findServiceMaintenance`: Knox's stored row and the line `checkFeeAgainstSource` traces the fee to,
 * on the text Knox read, must both sit under a heading that names only services). The summary is
 * pure; `serviceMaintenanceSection` reads the rows and texts through the audit's reader.
 */

export interface ServiceMaintenanceSummary {
  /** Live monthly maintenance fees the re-check's SQL selected. */
  checked: number;
  /** Selected fees whose text is gone or prints no service word: not judged. */
  noText: number;
  /** Under a service's heading on Knox's row, but the shared check traces no line: never taken down. */
  unconfirmed: number;
  /** Live rows past the audit's row cap: left unjudged (review of #2953). */
  unjudged: number;
  /** Fees the switch would take down (each after its 12-hour second look). */
  wouldTakeDown: number;
  institutions: number;
  /** Of those, $0 fees and priced fees. */
  free: number;
  priced: number;
  /** By the services the heading names ("online_banking+mobile_banking"). */
  byServices: Record<string, number>;
  samples: ServiceMaintenanceMatch[];
}

export interface ServiceMaintenanceSection {
  switch: "SERVICE_MAINTENANCE_TAKEDOWN_LIVE";
  issue: number;
  rowsRead: Bounded;
  summary: ServiceMaintenanceSummary;
}

export function emptyServiceMaintenanceSummary(): ServiceMaintenanceSummary {
  return { checked: 0, noText: 0, unconfirmed: 0, unjudged: 0, wouldTakeDown: 0, institutions: 0, free: 0, priced: 0, byServices: {}, samples: [] };
}

/** Adds one chunk of rows, judged on their texts, to the summary. Institutions are counted at the end. */
export function addServiceMaintenanceRows(
  summary: ServiceMaintenanceSummary,
  institutions: Set<number>,
  rows: readonly ServiceMaintenanceLiveRow[],
  texts: ReadonlyMap<number, string>,
  sampleCap: number,
): void {
  const found = findServiceMaintenance(rows, texts);
  summary.checked += found.checked;
  summary.noText += found.noText;
  summary.unconfirmed += found.unconfirmed;
  summary.wouldTakeDown += found.matched;
  summary.free += found.free;
  summary.priced += found.priced;
  for (const fee of found.matches) {
    institutions.add(fee.institutionId);
    const key = fee.services.join("+");
    summary.byServices[key] = (summary.byServices[key] ?? 0) + 1;
    if (summary.samples.length < sampleCap) summary.samples.push(fee);
  }
  summary.institutions = institutions.size;
}

/**
 * The section: every live monthly maintenance fee the re-check selects, a page of rows by fee id and a
 * chunk of Knox's texts at a time, up to the audit's row cap; the rows past the cap are counted unjudged.
 */
export async function serviceMaintenanceSection(reader: SwitchAuditReader, options: SwitchAuditOptions): Promise<ServiceMaintenanceSection> {
  const limit = Math.max(1, Math.min(options.rowCap, SERVICE_MAINTENANCE_MAX_ROWS));
  const rows: ServiceMaintenanceLiveRow[] = [];
  let afterId = 0;
  for (;;) {
    const page = await reader.serviceMaintenanceRows(Math.min(limit, options.rowCap - rows.length), afterId);
    rows.push(...page);
    if (page.length === 0) break;
    afterId = Math.max(...page.map((row) => Number(row.fee_published_id)));
    if (page.length < limit || rows.length >= options.rowCap) break;
  }
  const summary = emptyServiceMaintenanceSummary();
  summary.unjudged = rows.length >= options.rowCap ? await reader.serviceMaintenanceRemaining(afterId) : 0;
  const institutions = new Set<number>();
  const byArtifact = new Map<number | null, ServiceMaintenanceLiveRow[]>();
  for (const row of rows) {
    const key = row.artifact_id == null ? null : Number(row.artifact_id);
    byArtifact.set(key, [...(byArtifact.get(key) ?? []), row]);
  }
  addServiceMaintenanceRows(summary, institutions, byArtifact.get(null) ?? [], new Map(), options.sampleCap);
  const artifactIds = [...byArtifact.keys()].filter((id): id is number => id != null).sort((a, b) => a - b);
  const size = Math.max(1, options.chunkSize);
  for (let start = 0; start < artifactIds.length; start += size) {
    const chunk = artifactIds.slice(start, start + size);
    const texts = await reader.serviceMaintenanceTexts(chunk);
    addServiceMaintenanceRows(summary, institutions, chunk.flatMap((id) => byArtifact.get(id) ?? []), texts, options.sampleCap);
  }
  return { switch: "SERVICE_MAINTENANCE_TAKEDOWN_LIVE", issue: 1092, rowsRead: bounded(rows.length, options.rowCap), summary };
}
