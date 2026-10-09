import { sql } from "@/lib/data-store/connection";
import { KNOX_RULES_STRATEGY } from "@/lib/agents/knox/specialists";
import { countKnoxRereadsDue } from "@/lib/agents/knox/extract";
import { CATEGORY_GUARD_VERSION } from "@/lib/fee-category-guard";
import { FREQUENCY_FILL_VERSION } from "@/lib/agents/hamilton/frequency-fill";
import { countCurrentCopyPairs, CURRENT_COPY_STRATEGY } from "@/lib/agents/hamilton/current-copy";
import { countRetidyReplay, NAME_RETIDY_STRATEGY } from "@/lib/agents/knox/name-retidy";

type SqlTag = typeof sql;

/**
 * Bayes's impact manifests (Agentic OS PRD 8.3): every versioned rule or parser declares what
 * an older version processed and how today's version reaches it. The ledger counts each one
 * per change (`ledger.ts`); a change whose reach cannot be counted yet says so instead of
 * reading as finished.
 *
 * Counts use the owning agent's own selection where one exists (Knox's due-text query, the
 * registry scheduler's stale-parser test, the retidy's due institutions), so "queued" means work the agent will really pick up.
 */

export interface ReplayCount {
  /** Records an older version processed, or the one run a change needs. */
  affected: number;
  /** Already processed at this version. */
  done: number;
  /** The owner's own selection will process these again. */
  queued: number;
  /** Left on the older result on purpose, by reason. */
  exclusions: Record<string, number>;
  note?: string;
}

export interface ReplayManifest {
  key: string;
  owner: "knox" | "darwin" | "hamilton" | "magellan" | "rosetta";
  stage: string | null;
  strategy: string | null;
  version: number;
  /** The change key's version part when one number does not name the change. */
  versionLabel?: string;
  unit: string;
  affects: string;
  /** Null when the reach of this change cannot be counted yet; `notCounted` says why. */
  count: ((db: SqlTag) => Promise<ReplayCount>) | null;
  notCounted?: string;
}

const n = (value: unknown): number => (Number.isFinite(Number(value)) ? Number(value) : 0);

export function changeKey(manifest: Pick<ReplayManifest, "key" | "version" | "versionLabel">): string {
  return `${manifest.key}@${manifest.versionLabel ?? manifest.version}`;
}

/** Knox rules: every current copy an older rules version read. */
async function countKnoxRules(db: SqlTag): Promise<ReplayCount> {
  const [row] = await db<Array<{ affected: number | string; done: number | string }>>`
    WITH read_version AS (
      SELECT institution_id, input_fingerprint, MAX(strategy_version) AS version
        FROM pipeline_attempts
       WHERE stage = 'extract' AND strategy = ${KNOX_RULES_STRATEGY.strategy}
       GROUP BY institution_id, input_fingerprint
    )
    SELECT COUNT(*) FILTER (WHERE rv.version IS NOT NULL) AS affected,
           COUNT(*) FILTER (WHERE rv.version >= ${KNOX_RULES_STRATEGY.version}) AS done
      FROM agent_source_texts t
      JOIN source_documents doc ON doc.id = t.source_document_id AND doc.superseded_by_id IS NULL
      LEFT JOIN read_version rv ON rv.institution_id = t.institution_id AND rv.input_fingerprint = t.text_hash
     WHERE t.status = 'completed' AND t.char_count > 0
  `;
  const affected = n(row?.affected);
  const done = n(row?.done);
  const queued = Math.min((await countKnoxRereadsDue(db)).due, Math.max(0, affected - done));
  return {
    affected,
    done,
    queued,
    exclusions: { knox_keeps_older_read: Math.max(0, affected - done - queued) },
    note: "Knox re-reads a current copy only when its own rules ask (thin text, $10B+ bank, missing fees, older copy still live, stale or unnamed read, priority bank); the rest keep their older read.",
  };
}

/** One registry source: every partition an older parser recorded. */
function countRegistrySource(source: string, version: number) {
  return async (db: SqlTag): Promise<ReplayCount> => {
    const [row] = await db<Array<Record<string, number | string>>>`
      SELECT COUNT(*) AS affected,
             COUNT(*) FILTER (
               WHERE status IN ('succeeded', 'empty') AND COALESCE((detail->>'parser_version')::int, 1) >= ${version}
             ) AS done,
             COUNT(*) FILTER (
               WHERE (status IN ('succeeded', 'empty') AND COALESCE((detail->>'parser_version')::int, 1) < ${version})
                  OR status = 'scheduled'
             ) AS queued,
             COUNT(*) FILTER (WHERE status = 'failed') AS failed,
             COUNT(*) FILTER (WHERE status NOT IN ('succeeded', 'empty', 'scheduled', 'failed')) AS other
        FROM registry_ingest_partitions
       WHERE source = ${source}
    `;
    const exclusions: Record<string, number> = {};
    if (n(row?.failed) > 0) exclusions.failed_partition = n(row?.failed);
    if (n(row?.other) > 0) exclusions.other_status = n(row?.other);
    return { affected: n(row?.affected), done: n(row?.done), queued: n(row?.queued), exclusions };
  };
}

/** Category guard and frequency fill: one catch-up run per version pair re-checks every live fee. */
async function countGuardCatchUp(db: SqlTag): Promise<ReplayCount> {
  const { GUARD_CATCH_UP_SOURCE } = await import("@/lib/agents/hamilton/guard-catch-up");
  const marker = {
    source: GUARD_CATCH_UP_SOURCE,
    category_guard_version: CATEGORY_GUARD_VERSION,
    frequency_fill_version: FREQUENCY_FILL_VERSION,
  };
  const [run] = await db<Array<{ id: number | string; status: string }>>`
    SELECT id, status FROM agent_runs
     WHERE agent_name = 'hamilton' AND params_json @> ${JSON.stringify(marker)}::jsonb
     ORDER BY id DESC
     LIMIT 1
  `;
  return guardRunCount(run ? { id: Number(run.id), status: run.status } : null);
}

/** Pure: the catch-up run's state as a count. A failed run blocks a re-run (the scheduler keys on params). */
export function guardRunCount(run: { id: number; status: string } | null): ReplayCount {
  if (!run) return { affected: 1, done: 0, queued: 1, exclusions: {}, note: "No catch-up run yet; the next tick schedules it." };
  if (run.status === "completed") return { affected: 1, done: 1, queued: 0, exclusions: {}, note: `Run ${run.id} re-checked every live fee.` };
  if (run.status === "failed" || run.status === "cancelled") {
    return {
      affected: 1,
      done: 0,
      queued: 0,
      exclusions: { failed_run_blocks_rerun: 1 },
      note: `Run ${run.id} ended ${run.status}; the tick will not schedule another for this version pair.`,
    };
  }
  return { affected: 1, done: 0, queued: 1, exclusions: {}, note: `Run ${run.id} is ${run.status}.` };
}

/** Current copy: older/current pairs with a fee the current copy does not restate. */
async function countCurrentCopy(db: SqlTag): Promise<ReplayCount> {
  return currentCopyCount(await countCurrentCopyPairs(db));
}

/** Pure: the current-copy pair counts as a replay count. */
export function currentCopyCount(c: { pairs: number; done: number; queued: number; noText: number }): ReplayCount {
  return {
    affected: c.pairs,
    done: c.done,
    queued: c.queued,
    exclusions: c.noText > 0 ? { no_completed_text: c.noText } : {},
    note: "A checked pair can keep live fees: the check flags them for a second look rather than taking them down.",
  };
}

/** Name retidy: institutions with a messy live name, due now or tidied at this version. */
async function countNameRetidy(db: SqlTag): Promise<ReplayCount> {
  return retidyCount(await countRetidyReplay(db));
}

/** Pure: due and done institution ids as a replay count; an institution due again after a new fee counts as queued. */
export function retidyCount({ due, doneCurrent }: { due: number[]; doneCurrent: number[] }): ReplayCount {
  const queued = new Set(due);
  const done = doneCurrent.filter((id) => !queued.has(id)).length;
  return { affected: queued.size + done, done, queued: queued.size, exclusions: {} };
}

export async function loadManifests(): Promise<ReplayManifest[]> {
  const { REGISTRY_PARSER_VERSIONS } = await import("@/lib/agents/registry-scheduler");
  const manifests: ReplayManifest[] = [
    {
      key: "knox.rules",
      owner: "knox",
      stage: "extract",
      strategy: KNOX_RULES_STRATEGY.strategy,
      version: KNOX_RULES_STRATEGY.version,
      unit: "current-copy text",
      affects: "Fees Knox reads from each current fee schedule. A rules fix reaches a text only when Knox reads it again.",
      count: countKnoxRules,
    },
    {
      key: "hamilton.guard_catch_up",
      owner: "hamilton",
      stage: "publish",
      strategy: "hamilton.guard_catch_up",
      version: CATEGORY_GUARD_VERSION,
      versionLabel: `g${CATEGORY_GUARD_VERSION}.f${FREQUENCY_FILL_VERSION}`,
      unit: "catch-up run",
      affects: `Every live fee's category (guard v${CATEGORY_GUARD_VERSION}) and frequency (fill v${FREQUENCY_FILL_VERSION}).`,
      count: countGuardCatchUp,
    },
    ...Object.entries(REGISTRY_PARSER_VERSIONS).map(([source, version]): ReplayManifest => ({
      key: `magellan.registry.${source}`,
      owner: "magellan",
      stage: "registry",
      strategy: source,
      version,
      unit: "registry partition",
      affects: `Rows Magellan parsed from the ${source} registry.`,
      count: countRegistrySource(source, version),
    })),
    {
      key: "hamilton.current_copy",
      owner: "hamilton",
      stage: "publish",
      strategy: CURRENT_COPY_STRATEGY.strategy,
      version: CURRENT_COPY_STRATEGY.version,
      unit: "older/current document pair",
      affects: "Live fees on a superseded copy that the current copy no longer states.",
      count: countCurrentCopy,
    },
    {
      key: "knox.name_retidy",
      owner: "knox",
      stage: "publish",
      strategy: NAME_RETIDY_STRATEGY.strategy,
      version: NAME_RETIDY_STRATEGY.version,
      unit: "institution",
      affects: "Live fee names Knox tidies in place.",
      count: countNameRetidy,
    },
    {
      key: "darwin.envelopes",
      owner: "darwin",
      stage: "verify",
      strategy: "verify.rules",
      version: 0,
      unit: "held raw fee",
      affects: "Fees Darwin held as outside a category's amount envelope.",
      count: null,
      notCounted: "Envelope edits carry no version, so there is no change to count against.",
    },
  ];
  return manifests;
}
