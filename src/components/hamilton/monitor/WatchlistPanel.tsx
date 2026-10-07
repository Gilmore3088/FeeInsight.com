/**
 * WatchlistPanel — the side column of All changes:
 *   1. The institution in context, with a button to watch it
 *   2. Institutions you watch, with add (search) and remove
 *   3. Updates waiting: reports, models and watch-list checks queued from a change
 *
 * Interactive add/remove is a client component; the server actions live in the route.
 */

"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { addToWatchlist, removeFromWatchlist } from "@/app/pro/(hamilton)/monitor/actions";
import type { WatchlistEntry } from "@/lib/hamilton/monitor-data";
import type { HamiltonRefreshJobEntry } from "@/lib/hamilton/refresh-jobs";
import type { HamiltonSelectedInstitutionContext } from "@/lib/hamilton/institution-context";
import { SERIF } from "@/components/hamilton/memo/memo";

interface WatchlistPanelProps {
  entries: WatchlistEntry[];
  refreshJobs?: HamiltonRefreshJobEntry[];
  selectedInstitution?: HamiltonSelectedInstitutionContext | null;
}

interface InstitutionSearchResult {
  id: number;
  institution_name: string;
  city: string | null;
  state_code: string | null;
  charter_type: string | null;
  asset_size_tier: string | null;
  published_fee_count: number;
  provisional_fee_count: number;
  fee_publication_label: string;
}

// ---------------------------------------------------------------------------
// Plain-language status for each watched institution
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<WatchlistEntry["status"], { dot: string; label: string }> = {
  current: { dot: "bg-warm-700", label: "Fees verified and current" },
  review_due: { dot: "bg-terra", label: "Fee schedule being re-checked" },
  unknown: { dot: "bg-warm-300", label: "Not yet checked" },
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SideHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-lg text-warm-900" style={SERIF}>
      {children}
    </h2>
  );
}

function institutionLocation(result: InstitutionSearchResult): string {
  return [result.city, result.state_code].filter(Boolean).join(", ");
}

function feeCounts(verified: number, provisional: number): string {
  const v = `${verified} verified ${verified === 1 ? "fee" : "fees"}`;
  return provisional > 0 ? `${v}, ${provisional} not yet verified` : v;
}

function WatchlistIntegrity({
  entries,
  onRemove,
  isPending,
}: {
  entries: WatchlistEntry[];
  onRemove: (id: string) => void;
  isPending: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <SideHeading>Institutions you watch</SideHeading>

      {entries.length === 0 ? (
        <p className="text-pretty text-sm leading-relaxed text-warm-700">
          You aren&apos;t watching any institutions yet. Add one below to see its fee changes here.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-warm-200 rounded-lg border border-warm-300 bg-warm-50">
          {entries.map((entry) => {
            const { dot, label } = STATUS_CONFIG[entry.status];
            return (
              <li key={entry.institutionId} className="flex items-start gap-3 px-4 py-3">
                <span className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-warm-900">{entry.displayName}</p>
                  <p className="text-xs text-warm-600">{label}</p>
                  <div className="mt-1 flex gap-3 text-xs">
                    <Link
                      href={`/pro/analyze?instId=${entry.institutionId}&intent=watchlist`}
                      className="text-terra-text underline"
                    >
                      Ask about it
                    </Link>
                    <button
                      type="button"
                      onClick={() => onRemove(entry.institutionId)}
                      disabled={isPending}
                      className="text-warm-600 underline hover:text-warm-900 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Stop watching
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function refreshJobLabel(jobType: HamiltonRefreshJobEntry["jobType"]): string {
  if (jobType === "report_refresh") return "Report to refresh";
  if (jobType === "scenario_refresh") return "Price model to rerun";
  return "Watch list to check";
}

function refreshJobLinkLabel(jobType: HamiltonRefreshJobEntry["jobType"]): string {
  if (jobType === "report_refresh") return "Open the report";
  if (jobType === "scenario_refresh") return "Open the model";
  return "See its changes";
}

function refreshJobHref(job: HamiltonRefreshJobEntry): string {
  const params = new URLSearchParams({ instId: job.institutionId });
  if (job.jobType === "report_refresh") {
    params.set("intent", "refresh-queue");
    return `/pro/reports?${params.toString()}`;
  }
  if (job.jobType === "scenario_refresh") {
    params.set("intent", "refresh-queue");
    return `/pro/simulate?${params.toString()}`;
  }
  return `/pro/monitor?${params.toString()}`;
}

function refreshJobEvidenceLabel(policy: HamiltonRefreshJobEntry["evidencePolicy"]): string | null {
  if (!policy) return null;
  if (policy === "verified-only") return "Verified fees only";
  if (policy === "provisional-first") return "Includes fees not yet verified";
  if (policy === "source-diligence") return "Source still being checked";
  return null;
}

function RefreshJobQueue({
  jobs,
  watchedCount,
}: {
  jobs: HamiltonRefreshJobEntry[];
  watchedCount: number;
}) {
  const queuedToRun = jobs.filter((job) => job.providerCallQueued).length;
  const waitingOnYou = jobs.length - queuedToRun;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <SideHeading>Updates waiting</SideHeading>
        <p className="mt-1 text-pretty text-sm text-warm-600">
          You watch {watchedCount} {watchedCount === 1 ? "institution" : "institutions"}.{" "}
          {waitingOnYou} {waitingOnYou === 1 ? "update waits" : "updates wait"} for you to rerun;{" "}
          {queuedToRun} {queuedToRun === 1 ? "is" : "are"} queued to run.
        </p>
      </div>

      {jobs.length === 0 ? (
        <p className="text-pretty text-sm leading-relaxed text-warm-700">
          No report, price model or watch-list check is waiting on a change right now.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-warm-200 rounded-lg border border-warm-300 bg-warm-50">
          {jobs.map((job) => {
            const evidence = refreshJobEvidenceLabel(job.evidencePolicy);
            return (
              <li key={job.id} className="px-4 py-3">
                <p className="text-sm font-medium text-warm-900">{refreshJobLabel(job.jobType)}</p>
                <p className="mt-0.5 text-pretty text-sm leading-relaxed text-warm-700">{job.reason}</p>
                <p className="mt-1 text-xs text-warm-600">
                  {job.providerCallQueued ? "Queued to run" : "Waiting for you to rerun"}
                  {evidence ? ` · ${evidence}` : ""}
                </p>
                <Link href={refreshJobHref(job)} className="mt-1 inline-block text-sm text-terra-text underline">
                  {refreshJobLinkLabel(job.jobType)}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function SelectedInstitutionPrompt({
  selectedInstitution,
  isTracked,
  onWatch,
  isPending,
}: {
  selectedInstitution: HamiltonSelectedInstitutionContext;
  isTracked: boolean;
  onWatch: () => void;
  isPending: boolean;
}) {
  const place = [selectedInstitution.city, selectedInstitution.stateCode].filter(Boolean).join(", ");
  return (
    <div className="rounded-lg border border-warm-300 bg-warm-50 px-4 py-4">
      <p className="text-xs text-warm-600">Looking at</p>
      <p className="mt-0.5 text-lg leading-snug text-warm-900" style={SERIF}>
        {selectedInstitution.name}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-warm-600">
        {place ? `${place} · ` : ""}
        {selectedInstitution.feePublicationLabel} ·{" "}
        {feeCounts(selectedInstitution.publishedFeeCount, selectedInstitution.provisionalFeeCount)}
      </p>
      <button
        type="button"
        onClick={onWatch}
        disabled={isPending || isTracked}
        className={
          "mt-3 w-full rounded-md px-3.5 py-2 text-sm font-medium disabled:cursor-not-allowed " +
          (isTracked
            ? "border border-warm-300 bg-warm-100 text-warm-700"
            : "bg-terra text-white hover:bg-terra-dark disabled:opacity-60")
        }
      >
        {isTracked ? "You watch this institution" : "Watch this institution"}
      </button>
    </div>
  );
}

function InstitutionSearchAdd({
  onAdd,
  isPending,
  error,
}: {
  onAdd: (result: InstitutionSearchResult) => void;
  isPending: boolean;
  error: string | null;
}) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<InstitutionSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);

  function updateQuery(value: string) {
    setQuery(value);
    setShowSuggestions(value.trim().length >= 2);
  }

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      setSearchError(null);
      setIsSearching(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setIsSearching(true);
      setSearchError(null);
      try {
        const response = await fetch(`/api/institutions?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(
            response.status === 429
              ? "Search is rate limited. Try again shortly."
              : "Search failed.",
          );
        }
        const rows = (await response.json()) as InstitutionSearchResult[];
        setSuggestions(rows);
        setShowSuggestions(true);
      } catch (fetchError) {
        if (controller.signal.aborted) return;
        setSuggestions([]);
        setSearchError(fetchError instanceof Error ? fetchError.message : "Search failed.");
      } finally {
        if (!controller.signal.aborted) setIsSearching(false);
      }
    }, 220);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="watch-search" className="text-sm font-medium text-warm-800">
        Watch another institution
      </label>
      <div className="relative">
        <input
          id="watch-search"
          type="search"
          value={query}
          onChange={(e) => updateQuery(e.target.value)}
          onFocus={() => query.trim().length >= 2 && setShowSuggestions(true)}
          onBlur={() => window.setTimeout(() => setShowSuggestions(false), 160)}
          placeholder="Search by name"
          disabled={isPending}
          className="w-full min-w-0 rounded-md border border-warm-300 bg-warm-50 px-3 py-2 text-sm text-warm-900 placeholder:text-warm-600 focus:border-warm-600 focus:outline-none disabled:opacity-60"
        />

        {showSuggestions && (suggestions.length > 0 || isSearching || searchError) && (
          <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-md border border-warm-300 bg-warm-50 shadow-lg">
            {isSearching && <div className="px-3 py-2.5 text-xs text-warm-600">Searching...</div>}
            {searchError && (
              <div role="alert" className="px-3 py-2.5 text-xs text-terra-text">
                {searchError}
              </div>
            )}
            {!isSearching &&
              !searchError &&
              suggestions.map((result) => (
                <button
                  key={result.id}
                  type="button"
                  onMouseDown={() => {
                    onAdd(result);
                    setQuery("");
                    setSuggestions([]);
                    setShowSuggestions(false);
                  }}
                  className="block w-full border-b border-warm-200 px-3 py-2.5 text-left last:border-b-0 hover:bg-warm-100"
                >
                  <span className="block truncate text-sm font-medium text-warm-900">
                    {result.institution_name}
                  </span>
                  <span className="mt-0.5 block text-xs text-warm-600">
                    {[
                      institutionLocation(result),
                      result.fee_publication_label,
                      feeCounts(result.published_fee_count, result.provisional_fee_count),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </button>
              ))}
          </div>
        )}
      </div>
      <p className="text-xs text-warm-600">Pick a name from the list to add it.</p>
      {error && (
        <p role="alert" className="text-sm text-terra-text">
          {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function WatchlistPanel({
  entries: initialEntries,
  refreshJobs = [],
  selectedInstitution,
}: WatchlistPanelProps) {
  const [entries, setEntries] = useState(initialEntries);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const selectedInstitutionId = selectedInstitution ? String(selectedInstitution.id) : null;
  const selectedIsTracked = selectedInstitutionId
    ? entries.some((entry) => entry.institutionId === selectedInstitutionId)
    : false;

  function handleAddInstitution(institutionId: string) {
    if (entries.some((entry) => entry.institutionId === institutionId)) {
      setError("You already watch this institution.");
      return;
    }
    setError(null);

    startTransition(async () => {
      const result = await addToWatchlist(institutionId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const entry = result.entry;
      if (!entry) return;
      setEntries((prev) =>
        prev.some((existing) => existing.institutionId === entry.institutionId)
          ? prev
          : [...prev, entry],
      );
    });
  }

  function handleAddSearchResult(result: InstitutionSearchResult) {
    handleAddInstitution(String(result.id));
  }

  function handleWatchSelectedInstitution() {
    if (!selectedInstitution) return;
    handleAddInstitution(String(selectedInstitution.id));
  }

  function handleRemove(institutionId: string) {
    const removedEntry = entries.find((entry) => entry.institutionId === institutionId);
    setEntries((prev) => prev.filter((e) => e.institutionId !== institutionId));
    startTransition(async () => {
      const result = await removeFromWatchlist(institutionId);
      if (result.ok) return;
      if (removedEntry) {
        setEntries((prev) =>
          prev.some((entry) => entry.institutionId === removedEntry.institutionId)
            ? prev
            : [...prev, removedEntry],
        );
      }
      setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-8 text-warm-800">
      {selectedInstitution && (
        <SelectedInstitutionPrompt
          selectedInstitution={selectedInstitution}
          isTracked={selectedIsTracked}
          onWatch={handleWatchSelectedInstitution}
          isPending={isPending}
        />
      )}

      <div className="flex flex-col gap-4">
        <WatchlistIntegrity entries={entries} onRemove={handleRemove} isPending={isPending} />
        <InstitutionSearchAdd onAdd={handleAddSearchResult} isPending={isPending} error={error} />
      </div>

      <RefreshJobQueue jobs={refreshJobs} watchedCount={entries.length} />
    </div>
  );
}
