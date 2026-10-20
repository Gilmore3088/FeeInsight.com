import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { hasPermission, requireAuth } from "@/lib/auth";
import { sql } from "@/lib/data-store/connection";
import { listFeeAuditEntries, type FeeAuditEntry } from "@/lib/data-store/fee-correction-audit";
import { categoryLabel, type FeeValues } from "@/lib/fee-correction-rules";
import type { SurfaceState } from "@/lib/fee-refresh-status";
import { affectedSavedOutputsLabel } from "@/lib/saved-output-corrections";
import { RetryRefreshButton } from "./retry-refresh-button";

export const dynamic = "force-dynamic";

/**
 * H03-T10 (#978): every operator fee action (hold, release, correction, reversal), newest first:
 * who changed what and why, the evidence, where the change stands now, each reader's refresh
 * status (T08) and the saved outputs made before it (T09). Anyone who can view the admin sees
 * it; retrying a refresh needs `edit`. A reversal is made on the institution page, as a new
 * version: nothing on this page deletes or edits a record.
 */

const ACTION_LABEL: Record<FeeAuditEntry["action"], string> = {
  hold: "Hold",
  release: "Release",
  correct: "Correction",
  reverse: "Reversal",
};

const STATE_STYLE: Record<SurfaceState, string> = {
  reached: "text-gray-600 dark:text-gray-400",
  waiting: "text-amber-700 dark:text-amber-300",
  failed: "font-semibold text-red-700 dark:text-red-400",
  hidden: "text-gray-500 italic",
};

const STATE_LABEL: Record<SurfaceState, string> = {
  reached: "updated",
  waiting: "updating",
  failed: "not updated",
  hidden: "not shown",
};

function money(amount: number | null): string {
  return amount == null ? "varies" : `$${amount.toFixed(2)}`;
}

function values(v: FeeValues | null): string {
  if (!v) return "";
  return `${money(v.amount)} ${v.canonicalFeeKey ? categoryLabel(v.canonicalFeeKey) : ""}`.trim();
}

function when(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

function parseInstitution(value: string | string[] | undefined): number | null {
  const id = Number(Array.isArray(value) ? value[0] : value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export default async function FeeCorrectionsAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ institution?: string | string[] }>;
}) {
  const user = await requireAuth("operate");
  const canRetry = hasPermission(user, "edit");
  const institutionId = parseInstitution((await searchParams).institution);
  let entries: FeeAuditEntry[] = [];
  let loadError = false;
  try {
    entries = await listFeeAuditEntries(sql, { institutionId });
  } catch (error) {
    console.error("[admin] fee audit history failed", error);
    loadError = true;
  }

  return (
    <div className="space-y-6">
      <header className="mx-auto max-w-2xl text-center sm:mx-0 sm:max-w-none sm:text-left">
        <div className="flex justify-center sm:justify-start">
          <Breadcrumbs items={[{ label: "Published data", href: "/admin/data" }, { label: "Fee corrections" }]} />
        </div>
        <p className="admin-eyebrow mt-3">Audit history</p>
        <h1 className="admin-display-title mt-1">Fee corrections and holds</h1>
        <p className="admin-lede mx-auto mt-2 sm:mx-0">
          Every hold, release, correction and reversal: who made it, why, the evidence, and whether each place that shows
          fees has the change. Records are never edited or deleted. To reverse a correction, open its institution.
        </p>
        {institutionId != null && (
          <p className="mt-2 text-xs text-gray-500">
            Showing institution #{institutionId}.{" "}
            <Link href="/admin/corrections" className="underline hover:text-gray-900 dark:hover:text-gray-200">Show all</Link>
          </p>
        )}
      </header>

      {loadError ? (
        <p className="admin-card p-4 text-sm text-red-700 dark:text-red-400" role="alert">
          The audit history could not be read. Nothing was changed; reload to try again.
        </p>
      ) : entries.length === 0 ? (
        <p className="admin-card p-6 text-center text-sm text-gray-500">No fee has been held or corrected yet.</p>
      ) : (
        <div className="admin-card overflow-x-auto">
          <table className="admin-table w-full text-left text-xs">
            <thead>
              <tr className="text-left">
                <th>When</th>
                <th>Fee</th>
                <th>Change</th>
                <th>Why and evidence</th>
                <th>By</th>
                <th>Where it stands</th>
                <th>Saved before it</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <AuditRow key={entry.key} entry={entry} canRetry={canRetry} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {entries.length > 0 && (
        <p className="text-[11px] text-gray-500">
          Saved outputs are matched by the institution they are about. One that used this institution only as a peer is not
          counted. Saved outputs keep their figures; a saved answer opened after a change says so.
        </p>
      )}
    </div>
  );
}

function AuditRow({ entry, canRetry }: { entry: FeeAuditEntry; canRetry: boolean }) {
  const superseded = entry.publication.startsWith("Superseded");
  return (
    <tr className={superseded ? "text-gray-400" : ""}>
      <td className="whitespace-nowrap tabular-nums text-gray-500">{when(entry.at)}</td>
      <td className="min-w-40">
        <p className="font-medium">{entry.feeName || "Unnamed fee"}</p>
        <p className="text-[11px] text-gray-500">
          <Link href={`/admin/institution/${entry.institutionId}`} className="underline hover:text-gray-900 dark:hover:text-gray-200">
            {entry.institutionName ?? `Institution #${entry.institutionId}`}
          </Link>
          {entry.feePublishedId != null && <> · fee #{entry.feePublishedId}</>}
        </p>
      </td>
      <td className="min-w-40 tabular-nums">
        <p className="font-medium">
          {ACTION_LABEL[entry.action]}
          {entry.version != null && <span className="font-normal text-gray-500"> · v{entry.version}</span>}
        </p>
        {entry.after ? (
          <p>{values(entry.before)} → {values(entry.after)}</p>
        ) : (
          <p>{values(entry.before)}</p>
        )}
      </td>
      <td className="min-w-56 max-w-xs">
        {entry.reason && <p>{entry.reason}</p>}
        {entry.sourceExcerpt && <p className="mt-0.5 italic text-gray-600 dark:text-gray-400">“{entry.sourceExcerpt}”</p>}
        {(entry.sourceLocation || entry.sourceDocumentId != null) && (
          <p className="text-[11px] text-gray-500">
            {entry.sourceLocation}
            {entry.sourceLocation && entry.sourceDocumentId != null && " · "}
            {entry.sourceDocumentId != null && `document #${entry.sourceDocumentId}`}
          </p>
        )}
      </td>
      <td className="whitespace-nowrap text-gray-500">
        {entry.actorName ?? "unknown"}
        {entry.runId != null && <p className="text-[11px]">run #{entry.runId}</p>}
      </td>
      <td className="min-w-56">
        <p className="font-medium">{entry.publication}</p>
        {entry.refresh ? (
          <ul className="mt-1 space-y-0.5">
            {entry.refresh.surfaces.map((surface) => (
              <li key={surface.surface} title={surface.detail} className="text-[11px]">
                <span className="text-gray-500">{surface.label}:</span>{" "}
                <span className={STATE_STYLE[surface.state]}>{STATE_LABEL[surface.state]}</span>
                {surface.state !== "reached" && <span className="block text-gray-500">{surface.detail}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-gray-500">No run recorded, so the refresh cannot be checked.</p>
        )}
        <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
          <Link href={`/admin/institution/${entry.institutionId}`} className="underline hover:text-gray-900 dark:hover:text-gray-200">
            Current result
          </Link>
          <Link href={`/institution/${entry.institutionId}`} className="underline hover:text-gray-900 dark:hover:text-gray-200">
            Public page
          </Link>
          {canRetry && entry.refresh?.needsRetry && entry.runId != null && <RetryRefreshButton runId={entry.runId} />}
        </p>
      </td>
      <td className="text-gray-500">{affectedSavedOutputsLabel(entry.savedOutputs)}</td>
    </tr>
  );
}
