import type { sql } from "@/lib/data-store/connection";

import { feedbackSchemaReady } from "@/lib/agents/learning/feedback";

import type { PlatformKnowledge } from "./finders";
import { LINK_YIELD_CHECK } from "./outcomes";
import { isReusablePath } from "./site-signals";

type SqlTag = typeof sql;

/**
 * Per-platform learning for the find team. A bank's website platform (Q2, Banno/Jack
 * Henry, Fiserv, FIS, NCR, WordPress, Drupal, ...) is detected from its homepage and
 * stored on `institution_source_profiles.platform`. Paths come from two places:
 *   - `platform_registry.fee_paths`: seeded per platform, and grown when the same
 *     reusable path is found at two or more banks on that platform;
 *   - every bank on the platform with a fee link, scored by what that link produced
 *     (Magellan's outcome ledger, `magellan.link_yield` rows in `pipeline_feedback`): a
 *     link with 3+ live fees counts 2, a link not judged yet counts 1, a thin link counts
 *     -1, a link Rosetta ruled out or a dead link counts -2; a path Rosetta rejected at a
 *     bank (`rejected_source_urls`) counts -2.
 * Peer hints come from the same platform nationwide: reusable paths that produced live
 * fees at one bank (too few to join the platform paths yet), best yield first.
 */

const MAX_PLATFORM_PATHS = 6;
const MAX_PEER_PATHS = 5;
const REGISTRY_MAX_PATHS = 12;
/** A learned path joins the registry once it has been found at this many banks. */
const REGISTRY_PROMOTE_AT = 2;

interface PathFacts {
  /** Score of the path as a fee link, summed over banks (see LINK_YIELD_SCORE). */
  found: Map<string, number>;
  /** Banks whose fee link is the path and is good or not judged yet (promotion count). */
  banks: Map<string, number>;
  /** Banks whose good fee link is the path, and their live fees (peer-hint ranking). */
  good: Map<string, number>;
  /** Banks where the path was read and was not a fee schedule. */
  rejected: Map<string, number>;
}

/** What a bank's fee link adds to its path's score, by its outcome-ledger kind. */
export const LINK_YIELD_SCORE: Record<string, number> = {
  produced_live_fees: 2,
  thin_link: -1,
  wrong_document: -2,
  dead_link: -2,
};
/** A link the ledger has not judged yet. */
const UNJUDGED_SCORE = 1;

const emptyFacts = (): PathFacts => ({ found: new Map(), banks: new Map(), good: new Map(), rejected: new Map() });

function pathOf(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

function bump(map: Map<string, number>, key: string | null, by = 1): void {
  if (key) map.set(key, (map.get(key) ?? 0) + by);
}

export interface PathFactRow {
  url: unknown;
  rejected: unknown;
  /** The link's outcome-ledger kind, or null when not judged (or no ledger yet). */
  yield_kind?: string | null;
  /** Live fees the link produced, from the ledger row's weight. */
  live_fees?: number | string | null;
}

/** Folds one bank's fee link and rejected pages into the platform's path facts. */
export function addPathFacts(facts: PathFacts, row: PathFactRow): void {
  const path = pathOf(row.url);
  const kind = row.yield_kind ?? null;
  const score = kind ? (LINK_YIELD_SCORE[kind] ?? 0) : UNJUDGED_SCORE;
  bump(facts.found, path, score);
  if (score > 0) bump(facts.banks, path);
  if (kind === "produced_live_fees") bump(facts.good, path, Math.max(1, Number(row.live_fees ?? 1)));
  const rejected = Array.isArray(row.rejected) ? row.rejected : [];
  for (const entry of rejected as Array<{ url?: unknown }>) bump(facts.rejected, pathOf(entry?.url));
}

/** Platform paths: seeds plus learned paths that recur (2+ banks), net of bad outcomes. */
export function rankPlatformPaths(facts: PathFacts, seeds: string[]): string[] {
  const learned: PathFacts = {
    ...facts,
    found: new Map([...facts.found].filter(([path]) => (facts.banks.get(path) ?? 0) >= REGISTRY_PROMOTE_AT && isReusablePath(path))),
  };
  // A seed whose links keep failing drops out too.
  for (const seed of seeds) {
    const score = facts.found.get(seed);
    if (score !== undefined && score < 0 && !learned.found.has(seed)) learned.found.set(seed, score);
  }
  return rankPaths(learned, seeds, () => true).slice(0, MAX_PLATFORM_PATHS);
}

/**
 * Peer hints: reusable paths that produced live fees at a bank on the platform anywhere
 * in the country, net of bad outcomes, best total live fees first; paths already in the
 * platform list are left to that specialist.
 */
export function rankPeerPaths(facts: PathFacts, platformPaths: string[], ownPath: string | null): string[] {
  const skip = new Set(platformPaths);
  return [...facts.good.entries()]
    .filter(([path]) => !skip.has(path) && path !== ownPath && isReusablePath(path))
    .filter(([path]) => (facts.found.get(path) ?? 0) - 2 * (facts.rejected.get(path) ?? 0) > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([path]) => path)
    .slice(0, MAX_PEER_PATHS);
}

function rankPaths(facts: PathFacts, seeds: string[], filter: (path: string) => boolean): string[] {
  const scores = new Map<string, number>();
  for (const seed of seeds) scores.set(seed, 1);
  for (const [path, count] of facts.found) if (filter(path)) scores.set(path, (scores.get(path) ?? 0) + count);
  for (const [path, count] of facts.rejected) if (scores.has(path)) scores.set(path, (scores.get(path) ?? 0) - 2 * count);
  return [...scores.entries()]
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([path]) => path);
}

export interface PlatformLearner extends PlatformKnowledge {
  /** Called after a bank's fee link is found and stored. */
  recordFind(input: { platform: string | null; url: string; foundByPlatformPath: boolean }): Promise<void>;
}

/** A learner for one discovery step; facts are read once per platform (and state) per step. */
export function createPlatformLearner(db: SqlTag, enabled = true): PlatformLearner {
  const nationwide = new Map<string, Promise<PathFacts>>();
  const seeds = new Map<string, Promise<string[]>>();
  const ownLinks = new Map<number, string | null>();

  const loadSeeds = (platform: string) => {
    if (!seeds.has(platform)) {
      seeds.set(platform, (async () => {
        const [row] = await db`SELECT fee_paths FROM platform_registry WHERE platform = ${platform}`;
        return Array.isArray(row?.fee_paths) ? (row.fee_paths as unknown[]).filter((path): path is string => typeof path === "string") : [];
      })().catch(() => []));
    }
    return seeds.get(platform)!;
  };

  const loadFacts = (platform: string) => {
    if (!nationwide.has(platform)) {
      nationwide.set(platform, (async () => {
        const ledger = await feedbackSchemaReady(db).catch(() => false);
        const rows = ledger
          ? await db<Array<PathFactRow & { id: number | string }>>`
              SELECT inst.id, COALESCE(profile.canonical_source_url, inst.fee_schedule_url) AS url,
                     COALESCE(profile.rejected_source_urls, '[]'::jsonb) AS rejected,
                     outcome.kind AS yield_kind, outcome.weight AS live_fees
                FROM institution_sources inst
                LEFT JOIN institution_source_profiles profile ON profile.institution_id = inst.id
                LEFT JOIN LATERAL (
                  SELECT f.kind, f.weight
                    FROM pipeline_feedback f
                   WHERE f.institution_id = inst.id
                     AND f.check_name = ${LINK_YIELD_CHECK}
                     AND f.source_url = COALESCE(profile.canonical_source_url, inst.fee_schedule_url)
                   ORDER BY f.updated_at DESC
                   LIMIT 1
                ) outcome ON TRUE
               WHERE COALESCE(profile.platform, inst.cms_platform) = ${platform}
                 AND COALESCE(inst.status, 'active') = 'active'
            `
          : await db<Array<PathFactRow & { id: number | string }>>`
              SELECT inst.id, COALESCE(profile.canonical_source_url, inst.fee_schedule_url) AS url,
                     COALESCE(profile.rejected_source_urls, '[]'::jsonb) AS rejected
                FROM institution_sources inst
                LEFT JOIN institution_source_profiles profile ON profile.institution_id = inst.id
               WHERE COALESCE(profile.platform, inst.cms_platform) = ${platform}
                 AND COALESCE(inst.status, 'active') = 'active'
            `;
        const facts = emptyFacts();
        for (const row of rows) {
          addPathFacts(facts, row);
          ownLinks.set(Number(row.id), pathOf(row.url));
        }
        return facts;
      })().catch(() => emptyFacts()));
    }
    return nationwide.get(platform)!;
  };

  return {
    async platformPaths(platform) {
      if (!enabled) return [];
      const [facts, seeded] = await Promise.all([loadFacts(platform), loadSeeds(platform)]);
      return rankPlatformPaths(facts, seeded);
    },

    async peerPaths(platform, _stateCode, institutionId) {
      if (!enabled) return [];
      const [facts, seeded] = await Promise.all([loadFacts(platform), loadSeeds(platform)]);
      return rankPeerPaths(facts, rankPlatformPaths(facts, seeded), ownLinks.get(institutionId) ?? null);
    },

    async recordFind({ platform, url, foundByPlatformPath }) {
      if (!enabled || !platform) return;
      const path = pathOf(url);
      const facts = await loadFacts(platform);
      if (path) {
        facts.found.set(path, (facts.found.get(path) ?? 0) + UNJUDGED_SCORE);
        facts.banks.set(path, (facts.banks.get(path) ?? 0) + 1);
      }
      const promote = Boolean(path) && isReusablePath(path!) && (facts.banks.get(path!) ?? 0) >= REGISTRY_PROMOTE_AT;
      try {
        await db`
          INSERT INTO platform_registry (platform, fee_paths, validated_count, last_updated)
          VALUES (${platform}, ARRAY[]::text[], 0, NOW())
          ON CONFLICT (platform) DO NOTHING
        `;
        await db`
          UPDATE platform_registry
             SET validated_count = validated_count + ${foundByPlatformPath ? 1 : 0},
                 fee_paths = CASE
                   WHEN ${promote}::boolean
                    AND NOT (${path}::text = ANY(COALESCE(fee_paths, ARRAY[]::text[])))
                    AND cardinality(COALESCE(fee_paths, ARRAY[]::text[])) < ${REGISTRY_MAX_PATHS}
                     THEN array_append(COALESCE(fee_paths, ARRAY[]::text[]), ${path}::text)
                   ELSE fee_paths
                 END,
                 institution_count = (
                   SELECT count(*)::int FROM institution_source_profiles WHERE platform = ${platform}
                 ),
                 last_updated = NOW()
           WHERE platform = ${platform}
        `;
      } catch (error) {
        // Learning is best effort: a failed registry write never fails the bank's find.
        console.warn("platform_registry update failed:", error instanceof Error ? error.message : error);
      }
    },
  };
}
