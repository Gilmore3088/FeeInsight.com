import {
  getReasoningTrace,
  type ReasoningTraceRow,
} from "@/lib/data-store/agent-console";
import { Timeline } from "./timeline";
import { ScreenHeader } from "../../room-hub";

export const dynamic = "force-dynamic";

type SearchParams = { correlation?: string };

// Simple UUID shape check — tight enough to block trivial injection before hitting
// the database (postgres client parameterizes too, see threat T-62B-10-02).
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AgentsReplayPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const correlation = params.correlation?.trim() ?? "";
  const validUuid = UUID_RE.test(correlation) ? correlation : null;

  let rows: ReasoningTraceRow[] = [];
  let loadError: string | null = null;

  if (validUuid) {
    try {
      rows = await getReasoningTrace(validUuid);
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <ScreenHeader title="Replay" lede="A read-only timeline of what an agent did." />
      <form
        method="GET"
        action="/admin/agents/replay"
        className="admin-card p-3 flex flex-wrap items-center gap-2"
      >
        <label
          htmlFor="correlation"
          className="text-[11px] font-semibold uppercase tracking-wider text-gray-500"
        >
          Correlation ID
        </label>
        <input
          id="correlation"
          name="correlation"
          type="text"
          defaultValue={correlation}
          placeholder="00000000-0000-0000-0000-000000000000"
          className="h-8 rounded-md border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.03] px-2 text-[12px] font-mono w-full max-w-[340px]"
        />
        <button
          type="submit"
          className="min-h-11 rounded-md bg-gray-900 dark:bg-white/10 text-white text-[12px] font-semibold px-3 py-2 hover:bg-gray-800 dark:hover:bg-white/20"
        >
          Replay
        </button>
        <span className="text-[11px] text-gray-500 dark:text-gray-400 ml-auto">
          Read-only trace — no re-execute (D-16)
        </span>
      </form>

      {correlation && !validUuid && (
        <div className="admin-card p-4 text-[12px] text-amber-600 dark:text-amber-400">
          Invalid UUID. Use the canonical 8-4-4-4-12 hex format.
        </div>
      )}
      {loadError && (
        <div className="admin-card p-4 text-[12px] text-red-600 dark:text-red-400">
          Query failed: {loadError}
        </div>
      )}

      {validUuid && !loadError && <Timeline rows={rows} />}

      {!correlation && (
        <div className="admin-card p-6 text-center text-sm text-gray-500 dark:text-gray-400">
          Paste a correlation_id (from Messages or agent_events) to view its timeline.
        </div>
      )}
    </section>
  );
}
